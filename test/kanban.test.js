import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createKanbanStore, validateTask, taskBrief, validatePlan, buildPlanPrompt } from '../lib/kanban.js';
import { createPlanner } from '../lib/planner.js';
const task = { title: 'Verificar onboarding', project: 'demo', agent: 'codex', acceptance: 'Pruebas de teclado y captura móvil' };
test('tasks survive restart; stale agent cannot overwrite handoff; archive is recoverable', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kanban-test-'));t.after(()=>fs.rmSync(dir,{recursive:true}));
  const store=createKanbanStore({dataDir:dir});
  const initial=store.mutate({action:'create',task}).tasks[0];
  const updated=store.mutate({action:'update',id:initial.id,version:1,task:{status:'doing',handoff:'Implementado; falta revisar'}}).tasks[0];
  assert.equal(updated.version,2);
  assert.throws(()=>store.mutate({action:'update',id:initial.id,version:1,task:{handoff:'borrado'}}),{status:409});
  assert.equal(createKanbanStore({dataDir:dir}).get().tasks[0].handoff,'Implementado; falta revisar');
  store.mutate({action:'archive',id:initial.id,version:2});
  assert.equal(store.get().tasks[0].archived,true);
  store.mutate({action:'restore',id:initial.id,version:3});
  assert.equal(store.get().tasks[0].archived,false);
  assert.equal(fs.statSync(path.join(dir,'kanban.json')).mode & 0o777,0o600);
  assert.match(taskBrief(store.get().tasks[0]),/Pruebas de teclado/);
});
test('reject invalid states, paths, payloads, and model plans; force project and backlog', () => {
  for(const fields of [{project:'../secret'},{agent:'unknown'},{status:'executing'},{title:''},{description:'x'.repeat(6001)}]) assert.throws(()=>validateTask({...task,...fields}),{status:400});
  assert.throws(()=>validatePlan([{...task,title:''}],'demo'));
  assert.throws(()=>validatePlan(Array(9).fill(task),'demo'));
  assert.equal(validatePlan([{...task,project:'other',status:'done'}],'demo')[0].status,'backlog');
  const prompt=buildPlanPrompt({project:'demo',goal:'Mejorar',tasks:[{...task,status:'doing'},{...task,project:'private',title:'Secret'}]});
  assert.ok(!prompt.includes('Secret'));
});
test('corrupt store is reported and not replaced by an empty board',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kanban-corrupt-'));t.after(()=>fs.rmSync(dir,{recursive:true}));
 fs.writeFileSync(path.join(dir,'kanban.json'),'broken');const store=createKanbanStore({dataDir:dir});
 assert.throws(()=>store.mutate({action:'create',task}));assert.equal(fs.readFileSync(path.join(dir,'kanban.json'),'utf8'),'broken');
});
test('planner disables tools and customizations, single-flight, parses result without writing tasks',async()=>{
 let args,stdin,finish;
 const spawnFn=(bin,a)=>{args=a;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.stdin.on('data',b=>stdin=String(b));finish=()=>{child.stdout.write(JSON.stringify({result:JSON.stringify([task])}));child.emit('close',0)};return child;};
 const planner=createPlanner({bin:'claude',cwd:os.tmpdir(),spawnFn});const pending=planner({project:'demo',goal:'Mejorar',tasks:[]});
 await assert.rejects(planner({project:'demo',goal:'Otro',tasks:[]}),{status:409});
 assert.equal(args[args.indexOf('--tools')+1],'');assert.ok(args.includes('--safe-mode'));assert.ok(args.includes('--strict-mcp-config'));assert.match(stdin,/Mejorar/);
 finish();const result=await pending;assert.equal(result.tasks[0].agent,'codex');assert.equal(result.tasks[0].status,'backlog');
});
