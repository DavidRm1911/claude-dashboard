import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createKanbanStore, validateTask, taskBrief, validatePlan, buildPlanPrompt, syncFromMem0, seedProjects } from '../lib/kanban.js';
import { createPlanner } from '../lib/planner.js';

const task = { title: 'Verificar onboarding', project: 'demo', agent: 'codex', acceptance: 'Pruebas de teclado y captura móvil' };

test('tasks survive restart; stale agent cannot overwrite handoff; archive is recoverable', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const store = createKanbanStore({ dataDir: dir });
  const initial = store.mutate({ action: 'create', task }).tasks[0];
  const updated = store.mutate({ action: 'update', id: initial.id, version: 1, task: { status: 'doing', handoff: 'Implementado; falta revisar' } }).tasks[0];
  assert.equal(updated.version, 2);
  assert.throws(() => store.mutate({ action: 'update', id: initial.id, version: 1, task: { handoff: 'borrado' } }), { status: 409 });
  assert.equal(createKanbanStore({ dataDir: dir }).get().tasks[0].handoff, 'Implementado; falta revisar');
  store.mutate({ action: 'archive', id: initial.id, version: 2 });
  assert.equal(store.get().tasks[0].archived, true);
  store.mutate({ action: 'restore', id: initial.id, version: 3 });
  assert.equal(store.get().tasks[0].archived, false);
  assert.equal(fs.statSync(path.join(dir, 'kanban.json')).mode & 0o777, 0o600);
  assert.match(taskBrief(store.get().tasks[0]), /Pruebas de teclado/);
});

test('reject invalid states, paths, payloads, and model plans; force project and backlog', () => {
  for (const fields of [{ project: '../secret' }, { agent: 'unknown' }, { status: 'executing' }, { title: '' }, { description: 'x'.repeat(6001) }]) {
    assert.throws(() => validateTask({ ...task, ...fields }), { status: 400 });
  }
  assert.throws(() => validatePlan([{ ...task, title: '' }], 'demo'));
  assert.throws(() => validatePlan(Array(9).fill(task), 'demo'));
  assert.equal(validatePlan([{ ...task, project: 'other', status: 'done' }], 'demo')[0].status, 'backlog');
  const prompt = buildPlanPrompt({ project: 'demo', goal: 'Mejorar', tasks: [{ ...task, status: 'doing' }, { ...task, project: 'private', title: 'Secret' }] });
  assert.ok(!prompt.includes('Secret'));
});

test('corrupt store is reported and not replaced by an empty board', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-corrupt-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  fs.writeFileSync(path.join(dir, 'kanban.json'), 'broken');
  const store = createKanbanStore({ dataDir: dir });
  assert.throws(() => store.mutate({ action: 'create', task }));
  assert.equal(fs.readFileSync(path.join(dir, 'kanban.json'), 'utf8'), 'broken');
});

test('planner disables tools and customizations, single-flight, parses result without writing tasks', async () => {
  let args, stdin, finish;
  const spawnFn = (bin, a) => {
    args = a;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.on('data', b => { stdin = String(b); });
    finish = () => { child.stdout.write(JSON.stringify({ result: JSON.stringify([task]) })); child.emit('close', 0); };
    return child;
  };
  const planner = createPlanner({ bin: 'claude', cwd: os.tmpdir(), spawnFn });
  const pending = planner({ project: 'demo', goal: 'Mejorar', tasks: [] });
  await assert.rejects(planner({ project: 'demo', goal: 'Otro', tasks: [] }), { status: 409 });
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--safe-mode'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.match(stdin, /Mejorar/);
  finish();
  const result = await pending;
  assert.equal(result.tasks[0].agent, 'codex');
  assert.equal(result.tasks[0].status, 'backlog');
});

test('validateTask accepts empty due/nextAction/blocker and rejects bad due', () => {
  const ok = validateTask({ ...task, due: '', nextAction: '', blocker: '' });
  assert.equal(ok.due, '');
  assert.equal(ok.nextAction, '');
  assert.equal(ok.blocker, '');
  const dated = validateTask({ ...task, due: '2026-11-10', nextAction: 'Auditar deps', blocker: 'Créditos' });
  assert.equal(dated.due, '2026-11-10');
  assert.equal(dated.nextAction, 'Auditar deps');
  assert.equal(dated.blocker, 'Créditos');
  assert.throws(() => validateTask({ ...task, due: '10/11/2026' }), { status: 400 });
  assert.throws(() => validateTask({ ...task, nextAction: 'x'.repeat(501) }), { status: 400 });
});

test('create/update persist due nextAction blocker; brief includes them', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-due-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const store = createKanbanStore({ dataDir: dir });
  const created = store.mutate({
    action: 'create',
    task: { ...task, due: '2026-11-12', nextAction: 'Abrir PR', blocker: '' },
  }).tasks[0];
  assert.equal(created.due, '2026-11-12');
  assert.equal(created.nextAction, 'Abrir PR');
  assert.equal(created.blocker, '');
  const updated = store.mutate({
    action: 'update',
    id: created.id,
    version: 1,
    task: { blocker: 'Esperando review' },
  }).tasks[0];
  assert.equal(updated.blocker, 'Esperando review');
  assert.equal(updated.nextAction, 'Abrir PR');
  const brief = taskBrief(updated);
  assert.match(brief, /Due: 2026-11-12/);
  assert.match(brief, /Next: Abrir PR/);
  assert.match(brief, /Blocker: Esperando review/);
});

test('syncFromMem0 fills empty fields only; offline safe', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sync-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const store = createKanbanStore({ dataDir: dir });
  const kept = store.mutate({
    action: 'create',
    task: { ...task, title: 'Kept', project: 'Heartly', nextAction: 'Ya escrito por David', blocker: '' },
  }).tasks[0];
  const empty = store.mutate({
    action: 'create',
    task: { ...task, title: 'Empty', project: 'CUMPA', status: 'doing', nextAction: '', blocker: '' },
  }).tasks[0];
  const done = store.mutate({
    action: 'create',
    task: { ...task, title: 'Done', project: 'CUMPA', status: 'done', nextAction: '', blocker: '' },
  }).tasks[0];

  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      result: {
        points: [
          { id: 1, payload: { data: 'Heartly login médico pendiente', updated_at: '2026-11-01' } },
          { id: 2, payload: { data: 'CUMPA bloqueado: créditos Gemini agotados. Siguiente: S3 corpus-raw.', updated_at: '2026-11-05' } },
        ],
      },
    }),
  });

  const result = await syncFromMem0(store, { fetchImpl });
  assert.equal(result.source, 'mem0');
  assert.ok(result.updated >= 1);
  const tasks = Object.fromEntries(store.get().tasks.map(t => [t.title, t]));
  assert.equal(tasks.Kept.nextAction, 'Ya escrito por David');
  assert.ok(tasks.Empty.nextAction);
  assert.match(tasks.Empty.nextAction, /CUMPA|S3|créditos|Gemini/i);
  assert.ok(tasks.Empty.blocker);
  assert.match(tasks.Empty.blocker, /bloque|créditos|Gemini/i);
  assert.equal(tasks.Done.nextAction, '');
  assert.ok(tasks.Empty.version > empty.version);
  assert.equal(tasks.Kept.version, kept.version);

  const offline = await syncFromMem0(store, { fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(offline.source, 'offline');
});

test('seed-projects creates then updates idempotently without wiping fields', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-seed-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const store = createKanbanStore({ dataDir: dir });
  const first = seedProjects(store, [
    { name: 'EcoMovil', status: 'doing', nextAction: 'POST panic', blocker: '', due: '' },
    { name: 'Jev', status: 'backlog', nextAction: 'Piloto router', priority: 'high' },
  ]);
  assert.equal(first.created, 2);
  assert.equal(first.updated, 0);
  const titles = store.get().tasks.map(t => t.title).sort();
  assert.deepEqual(titles, ['Próximo paso — EcoMovil', 'Próximo paso — Jev']);
  const eco = store.get().tasks.find(t => t.project === 'EcoMovil');
  store.mutate({ action: 'update', id: eco.id, version: eco.version, task: { nextAction: 'Escrito a mano' } });
  const second = seedProjects(store, [
    { name: 'EcoMovil', status: 'doing', nextAction: 'NO PISAR', blocker: 'API caída', due: '2026-11-20' },
    { name: 'Jev', status: 'doing', nextAction: 'Piloto router', blocker: 'Esperando OK' },
  ]);
  assert.equal(second.created, 0);
  assert.ok(second.updated >= 1);
  const after = Object.fromEntries(store.get().tasks.map(t => [t.project, t]));
  assert.equal(after.EcoMovil.nextAction, 'Escrito a mano');
  assert.equal(after.EcoMovil.blocker, 'API caída');
  assert.equal(after.EcoMovil.due, '2026-11-20');
  assert.equal(after.Jev.blocker, 'Esperando OK');
  assert.equal(store.get().tasks.filter(t => t.project === 'EcoMovil' && !t.archived).length, 1);
});
