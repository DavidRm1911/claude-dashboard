import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJobSearchStore, aggregateGaps, jobIsRemote } from '../lib/jobsearch.js';
import { createKanbanStore } from '../lib/kanban.js';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsearch-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  fs.mkdirSync(path.join(dir, 'repo', 'job_scraper'), { recursive: true });
  const seen = {
    a: { status: 'ranked', ref: 1, rank_score: 82, title: 'Cloud Engineer', company: 'Acme', url: 'https://x/1', location_verdict: 'PASS', strengths: ['AWS'], gaps: ['STRETCH: requires 5 years', 'LangChain not used'] },
    b: { status: 'ranked', ref: 2, rank_score: 55, title: 'SRE', company: 'Beta', url: 'https://x/2', location_verdict: 'FAIL', strengths: [], gaps: [] },
    c: { status: 'new', title: 'DevOps', company: 'Gamma', url: 'https://x/3', first_seen: '2000-01-01' },
    d: { status: 'skipped', title: 'Senior SRE', company: 'Delta', url: 'https://x/4' },
  };
  fs.writeFileSync(path.join(dir, 'repo', 'job_scraper', 'seen_jobs.json'), JSON.stringify({ seen }));
  const kanban = createKanbanStore({ dataDir: path.join(dir, 'data') });
  return { dir, kanban, store: createJobSearchStore({ repoDir: path.join(dir, 'repo'), kanbanStore: kanban, kanbanProject: 'ai-job-search-review' }) };
}

test('lists ranked jobs by score with stats; missing workspace is reported, not thrown', (t) => {
  const { store } = workspace(t);
  const data = store.get();
  assert.equal(data.available, true);
  assert.deepEqual(data.jobs.map(j => j.ref), [1, 2]);
  assert.equal(data.stats.open, 1);
  assert.equal(data.stats.high, 1);
  assert.equal(data.stats.backlog, 1);
  assert.equal(data.stats.filtered, 1);
  assert.equal(data.jobs[0].stretch, true);
  assert.equal(createJobSearchStore({ repoDir: '/nonexistent/x' }).get().available, false);
});

function withSeen(t, extra) {
  const ctx = workspace(t);
  const file = path.join(ctx.dir, 'repo', 'job_scraper', 'seen_jobs.json');
  const seen = { ...JSON.parse(fs.readFileSync(file, 'utf8')).seen, ...extra };
  fs.writeFileSync(file, JSON.stringify({ seen }));
  return ctx;
}
const limaDay = (offset) => {
  const base = Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()) + 'T00:00:00Z');
  return new Date(base + offset * 86400000).toISOString().slice(0, 10);
};
const ranked = (ref, over) => ({ status: 'ranked', ref, rank_score: 70, title: `T${ref}`, company: `C${ref}`, url: `https://y/${ref}`, location_verdict: 'PASS', ...over });

test('hides expired deadlines and flags those closing within 7 days (Lima date)', (t) => {
  const { store } = withSeen(t, {
    e1: ranked(10, { deadline: limaDay(-1) }),
    e2: ranked(11, { deadline: limaDay(0) }),
    e3: ranked(12, { deadline: limaDay(7) }),
    e4: ranked(13, { deadline: limaDay(8) }),
    e5: ranked(14, { deadline: 'pronto' }),
    e6: ranked(15),
  });
  const data = store.get();
  const byRef = Object.fromEntries(data.jobs.map(j => [j.ref, j]));
  assert.equal(byRef[10], undefined);
  assert.equal(byRef[11].closingSoon, true);
  assert.equal(byRef[12].closingSoon, true);
  assert.equal(byRef[13].closingSoon, false);
  assert.equal(byRef[14].closingSoon, false);
  assert.equal(byRef[15].closingSoon, false);
  assert.equal(data.stats.expiredHidden, 1);
  assert.equal(data.stats.ranked, data.jobs.length);
});

test('collapses duplicates by URL or company+title, keeping best score then lowest ref', (t) => {
  const { store } = withSeen(t, {
    u1: ranked(20, { rank_score: 60, url: 'https://z/job/1?utm=a' }),
    u2: ranked(21, { rank_score: 90, url: 'HTTPS://z/job/1/' }),
    n1: ranked(22, { rank_score: 75, company: ' Foo ', title: 'Cloud Eng', url: 'https://z/a' }),
    n2: ranked(23, { rank_score: 75, company: 'foo', title: 'cloud eng ', url: 'https://z/b' }),
  });
  const data = store.get();
  const refs = data.jobs.map(j => j.ref);
  assert.ok(refs.includes(21) && !refs.includes(20));
  assert.ok(refs.includes(22) && !refs.includes(23));
  assert.equal(data.stats.duplicatesHidden, 2);
});

test('postular files exactly one kanban task for Claude; descartar hides; invalid input rejected', (t) => {
  const { store, kanban, dir } = workspace(t);
  store.decide({ key: 'a', decision: 'postular' });
  store.decide({ key: 'a', decision: 'postular' });
  const tasks = kanban.get().tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].agent, 'claude');
  assert.match(tasks[0].description, /\/postular 1/);
  assert.match(tasks[0].acceptance, /Nada enviado/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'repo', 'job_scraper', 'decisions.json'), 'utf8'));
  assert.equal(saved.decisions.a.decision, 'postular');
  assert.equal(store.decide({ key: 'a', decision: 'descartar' }).stats.open, 0);
  assert.throws(() => store.decide({ key: 'a', decision: 'enviar' }), { status: 400 });
  assert.throws(() => store.decide({ key: 'c', decision: 'postular' }), { status: 404 });
  assert.throws(() => store.decide({ key: 'zzz', decision: 'postular' }), { status: 404 });
});

test('gap aggregation counts recurring themes among 60+ jobs only', () => {
  const jobs = [
    { ref: 1, company: 'A', score: 80, gaps: ['STRETCH: requires 5 years', 'No LangChain'] },
    { ref: 2, company: 'B', score: 70, gaps: ['On-call rotation required'] },
    { ref: 3, company: 'C', score: 40, gaps: ['LangChain'] },
  ];
  const g = aggregateGaps(jobs);
  assert.equal(g.considered, 2);
  assert.equal(g.groups.find(x => x.label.startsWith('LangChain')).count, 1);
  assert.ok(g.groups.find(x => x.label.startsWith('Guardias')));
});

test('jobIsRemote: location heuristic and remote portals; get() exposes isRemote', (t) => {
  assert.equal(jobIsRemote({ location: 'Remote - LATAM' }), true);
  assert.equal(jobIsRemote({ location: 'Lima, Perú' }), false);
  assert.equal(jobIsRemote({ portal: 'remote-boards-search', location: '' }), true);
  assert.equal(jobIsRemote({ portal: 'linkedin-search', location: '' }), false);
  const { store } = withSeen(t, {
    r1: ranked(30, { location: 'Remoto global', portal: 'computrabajo-search' }),
    r2: ranked(31, { location: 'Lima', portal: 'computrabajo-search' }),
  });
  const byRef = Object.fromEntries(store.get().jobs.map(j => [j.ref, j]));
  assert.equal(byRef[30].isRemote, true);
  assert.equal(byRef[31].isRemote, false);
});
