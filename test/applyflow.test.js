import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createApplyFlow, validateAnswers, extractJson, classifyClaudeError, CLAUDE_AUTH_MESSAGE } from '../lib/applyflow.js';
import { createJobSearchStore } from '../lib/jobsearch.js';
import { createKanbanStore } from '../lib/kanban.js';

function fakeSpawn(replies, calls) {
  return (bin, args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => {};
    child.stdin.on('finish', () => setImmediate(() => {
      const reply = replies.shift();
      child.stdout.end(JSON.stringify(reply.__envelope || { is_error: false, result: '```json\n' + JSON.stringify(reply) + '\n```' }));
      setImmediate(() => child.emit('close', 0));
    }));
    return child;
  };
}
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('timeout'); };

function setup(t, replies, calls) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applyflow-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const repo = path.join(dir, 'repo');
  for (const d of ['job_scraper', 'cv', 'cover_letters']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'job_scraper', 'seen_jobs.json'), JSON.stringify({ seen: { k: { status: 'ranked', ref: 7, rank_score: 80, title: 'Cloud Engineer', company: 'Acme', url: 'https://acme/jobs/1', portal: 'linkedin-search', strengths: [], gaps: [] } } }));
  fs.writeFileSync(path.join(repo, 'cv', 'main_acme.pdf'), '%PDF-1.4');
  fs.writeFileSync(path.join(repo, 'cover_letters', 'cover_acme.pdf'), '%PDF-1.4');
  const kanban = createKanbanStore({ dataDir: path.join(dir, 'data') });
  const store = createJobSearchStore({ repoDir: repo, kanbanStore: kanban, kanbanProject: 'ai-job-search-review' });
  const flow = createApplyFlow({ repoDir: repo, dataDir: path.join(dir, 'data'), bin: 'claude', home: dir, jobSearchStore: store, kanbanStore: kanban, spawnFn: fakeSpawn(replies, calls) });
  return { repo, flow, kanban };
}

test('full flow: analyze -> questions -> draft preview -> approve writes tracker, never before', async (t) => {
  const calls = [];
  const replies = [
    { evaluation: { score: 78, verdict: 'Good Fit', gates: { eligibility: 'PASS', language: 'PASS', seniority: 'FLAG', location: 'PASS' }, summary: 'ok' }, posting_language: 'es', questions: [{ id: 'q1', text: '¿Usaste Jenkins?', options: ['Sí', 'No lo he usado'], multi: false }] },
    { cv_pdf: 'cv/main_acme.pdf', cover_pdf: 'cover_letters/cover_acme.pdf', cv_pages: 1, cover_pages: 1, tailoring: ['x'], verification: [{ item: 'a', ok: true }], tracker_row: { company: 'Acme', role: 'Cloud Engineer', fit_rating: 78 } },
  ];
  const { repo, flow, kanban } = setup(t, replies, calls);
  assert.equal(flow.start(7).stage, 'analyzing');
  await until(() => flow.status(7).stage === 'questions');
  assert.equal(flow.status(7).questions[0].options.length, 2);
  assert.ok(!calls[0].args.includes('Agent'), 'analysis must not get drafting tools');
  assert.equal(kanban.get().tasks[0].status, 'doing');
  flow.answer(7, { q1: { picked: ['No lo he usado', 'inyectado'], note: '' } });
  assert.deepEqual(flow.status(7).answers.q1.picked, ['No lo he usado']);
  await until(() => flow.status(7).stage === 'preview');
  assert.ok(calls[1].args.includes('Edit(cv/**)'));
  const tracker = path.join(repo, 'job_search_tracker.csv');
  assert.equal(fs.readFileSync(tracker, 'utf8').trim().split('\n').length, 1, 'only the header before approval');
  assert.equal(kanban.get().tasks[0].status, 'review');
  flow.approve(7);
  const csv = fs.readFileSync(path.join(repo, 'job_search_tracker.csv'), 'utf8');
  assert.match(csv, /Acme,.*Cloud Engineer,.*drafted/);
  assert.equal(kanban.get().tasks[0].status, 'done');
  assert.throws(() => flow.approve(7), { status: 409 });
});

test('a failed hard gate stops before drafting; pdf access is confined', async (t) => {
  const { flow } = setup(t, [{ evaluation: { score: 40, gates: { eligibility: 'FAIL' } }, questions: [] }], []);
  flow.start(7);
  await until(() => flow.status(7).stage === 'error');
  assert.throws(() => flow.answer(7, {}), { status: 409 });
  assert.equal(flow.pdf('cv/main_acme.pdf') !== null, true);
  for (const bad of ['../secret.pdf', 'cv/../../x.pdf', '/etc/passwd', 'documents/cv/x.pdf', 'cv/main_acme.tex']) assert.equal(flow.pdf(bad), null, bad);
});

test('answers are restricted to offered options; json extraction tolerates fences', () => {
  const qs = [{ id: 'q1', text: 'T', options: ['A', 'B'] }];
  assert.deepEqual(validateAnswers(qs, { q1: { picked: ['A', 'Z'], note: ' n ' }, q9: { picked: ['A'] } }), { q1: { question: 'T', picked: ['A'], note: 'n' } });
  assert.throws(() => validateAnswers(qs, []), { status: 400 });
  assert.deepEqual(extractJson('texto ```json\n{"a":1}\n``` fin'), { a: 1 });
});

test('an expired Claude login is reported as claude_auth with a clear message, and can be retried', async (t) => {
  const bad = { __envelope: { is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' } };
  const { flow } = setup(t, [bad, bad], []);
  flow.start(7);
  await until(() => flow.status(7).stage === 'error');
  const run = flow.status(7);
  assert.equal(run.errorCode, 'claude_auth');
  assert.equal(run.error, CLAUDE_AUTH_MESSAGE);
  assert.equal(flow.start(7).stage, 'analyzing', 'an errored run can be retried');
});

test('classifyClaudeError tells auth from quota from everything else', () => {
  assert.equal(classifyClaudeError('Failed to authenticate: OAuth session expired'), 'claude_auth');
  assert.equal(classifyClaudeError('Please run /login'), 'claude_auth');
  assert.equal(classifyClaudeError('Claude usage limit reached'), 'claude_quota');
  assert.equal(classifyClaudeError('Exceeded max-budget'), 'claude_quota');
  assert.equal(classifyClaudeError('algo raro'), null);
  assert.equal(classifyClaudeError(undefined), null);
});
