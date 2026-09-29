import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedDemo } from './demo-data.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'espacio-local-demo-'));
const demo=seedDemo(root),cwd=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port=process.env.PORT||'4950';
const child=spawn(process.execPath,['server.js'],{cwd,env:{...process.env,HOME:demo.home,USERPROFILE:demo.home,DASHBOARD_DATA_DIR:demo.dataDir,DASHBOARD_PROJECTS_DIR:demo.projectsDir,DASHBOARD_WORK_DIR:path.join(demo.home,'dev','Work'),DASHBOARD_VAULT_DIR:path.join(demo.home,'vault'),CODEX_HOME:path.join(demo.home,'.codex'),GROK_HOME:path.join(demo.home,'.grok'),AGY_HOME:path.join(demo.home,'.gemini','antigravity-cli'),DASHBOARD_ENABLE_AI:'0',DASHBOARD_ENABLE_GIT_WRITE:'0',DASHBOARD_DEMO:'1',PORT:port},stdio:'inherit'});
console.log(`DEMO · datos sintéticos · http://127.0.0.1:${port}\nNo lee tu historial real. Ctrl+C para cerrar.`);
let stopped=false;function stop(){if(stopped)return;stopped=true;child.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('error',error=>{console.error(error.message);fs.rmSync(root,{recursive:true,force:true});process.exitCode=1;});
child.on('exit',code=>{fs.rmSync(root,{recursive:true,force:true});process.exitCode=code||0;});
