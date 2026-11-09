import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createJobRefresh, summarizeRuns } from '../lib/jobrefresh.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobrefresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const repo = path.join(dir, 'repo'), data = path.join(dir, 'data'), runs = path.join(repo, 'job_scraper', 'pipeline_runs');
  fs.mkdirSync(path.join(repo, 'tools'), { recursive: true }); fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(repo, 'tools', 'daily.sh'), '#!/bin/zsh\n');
  const spawned = [];
  const spawnFn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    spawned.push({ bin, args, opts, child });
    return child;
  };
  const make = (extra = {}) => createJobRefresh({ repoDir: repo, dataDir: data, home: dir, claudeConfigDir: '', spawnFn, ...extra });
  return { dir, repo, data, runs, spawned, make };
}
const iso = (ms) => new Date(ms).toISOString();
const stamp = (ms) => iso(ms).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace(/^(\d{8})/, (m) => `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6)}`);
const write = (runs, name, obj) => fs.writeFileSync(path.join(runs, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
const closeWith = (child, code) => { child.emit('close', code); };

test('start spawns once, rejects a concurrent start, and aggregates both scraper runs', (t) => {
  const { runs, spawned, make } = setup(t);
  const jr = make();
  const st = jr.start();
  assert.equal(st.state, 'running');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].opts.env.DAILY_NO_OPEN, '1');
  assert.equal(spawned[0].opts.detached, true);
  assert.throws(() => jr.start(), { status: 409 });
  const t0 = Date.now() + 1000;
  write(runs, `${stamp(t0)}.json`, { run_at: iso(t0), fetched: 10, new: 3, errors: { linkedin: ['x'] } });
  write(runs, `${stamp(t0 + 5000)}.json`, { run_at: iso(t0 + 5000), fetched: 5, new: 2, errors: {} });
  write(runs, `rank_${stamp(t0 + 9000)}.json`, { run_at: iso(t0 + 9000), ok: true, exit_code: 0, reason: 'ok', ranked_total: 40, new_total: 4 });
  closeWith(spawned[0].child, 0);
  const s = jr.status();
  assert.equal(s.state, 'ok', s.error);
  assert.equal(s.result.search.fetched, 10, "max, not sum: pipeline.py re-fetches the same postings");
  assert.equal(s.result.search.newAdded, 5);
  assert.equal(s.result.search.portalErrors, 1);
  assert.equal(s.result.rank.rankedTotal, 40);
  assert.equal(s.last.search.fetched, 5);
  assert.equal(jr.start().state, 'running'); // finished, can start again
});

test('non-zero exit and missing scraper output are readable errors', (t) => {
  const { spawned, make } = setup(t);
  const jr = make();
  jr.start(); spawned[0].child.stderr.write('boom'); closeWith(spawned[0].child, 1);
  assert.equal(jr.status().state, 'error');
  assert.match(jr.status().error, /código 1/);
  jr.start(); closeWith(spawned[1].child, 0);
  assert.match(jr.status().error, /pipeline\.py falló/);
});

test('a failed rank run points at the Claude session', (t) => {
  const { runs, spawned, make } = setup(t);
  const jr = make();
  jr.start();
  const t0 = Date.now() + 1000;
  write(runs, `${stamp(t0)}.json`, { run_at: iso(t0), fetched: 4, new: 1, errors: {} });
  write(runs, `rank_${stamp(t0 + 1000)}.json`, { run_at: iso(t0 + 1000), ok: false, exit_code: 1, reason: 'claude_failed' });
  closeWith(spawned[0].child, 0);
  assert.equal(jr.status().state, 'error');
  assert.match(jr.status().error, /`claude`/);
});

test('summarizeRuns(null) takes the newest files and ignores bad JSON', (t) => {
  const { runs } = setup(t);
  write(runs, '2026-01-01T000000Z.json', { run_at: '2026-01-01T00:00:00Z', fetched: 1, new: 1, errors: {} });
  write(runs, '2026-01-02T000000Z.json', { run_at: '2026-01-02T00:00:00Z', fetched: 7, new: 2, errors: {} });
  write(runs, '2026-01-03T000000Z.json', '{not json');
  write(runs, 'rank_2026-01-02T010000Z.json', { run_at: '2026-01-02T01:00:00Z', ok: true, exit_code: 0, reason: 'no_new_scores', ranked_total: 9, new_total: 0 });
  const r = summarizeRuns(runs, null);
  assert.equal(r.search.fetched, 7);
  assert.equal(r.rank.reason, 'no_new_scores');
  assert.deepEqual(summarizeRuns(path.join(runs, 'nope'), null), { search: null, rank: null });
});

test('a persisted running state with a dead pid becomes an error on construction', (t) => {
  const { data, make } = setup(t);
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'jobsearch-refresh.json'), JSON.stringify({ state: 'running', startedAt: iso(Date.now()), pid: 999999999 }));
  const jr = make();
  const s = jr.status();
  assert.equal(s.state, 'error');
  assert.match(s.error, /interrumpió/);
});

test('no_new_scores is ok with a warning; exit 75 means the daily run already holds the lock', (t) => {
  const { runs, spawned, make } = setup(t);
  const jr = make();
  jr.start();
  const t0 = Date.now() + 1000;
  write(runs, `${stamp(t0)}.json`, { run_at: iso(t0), fetched: 1126, new: 0, errors: {} });
  write(runs, `rank_${stamp(t0 + 1000)}.json`, { run_at: iso(t0 + 1000), ok: false, exit_code: 0, reason: 'no_new_scores', ranked_total: 65, new_total: 382 });
  closeWith(spawned[0].child, 0);
  const s = jr.status();
  assert.equal(s.state, 'ok', s.error);
  assert.match(s.warning, /No se puntuaron/);
  assert.equal(s.result.search.fetched, 1126);
  jr.start(); closeWith(spawned[1].child, 75);
  assert.match(jr.status().error, /otra búsqueda diaria/);
});
