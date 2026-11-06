import { spawn } from 'node:child_process';
import { buildPlanPrompt, validatePlan } from './kanban.js';

export function createPlanner({ bin, cwd, spawnFn = spawn }) {
  let busy = false;
  return async function plan(input) {
    if (busy) throw Object.assign(new Error('Ya hay un plan en preparación'), { status: 409 });
    const prompt = buildPlanPrompt(input);
    busy = true;
    try {
      const output = await new Promise((resolve, reject) => {
        const child = spawnFn(bin, ['-p', '--safe-mode', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--output-format', 'json', '--max-budget-usd', '1', '--system-prompt', 'Planifica tareas con criterios verificables. Responde solo JSON. No ejecutes acciones.'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '', bytes = 0;
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Object.assign(new Error('El plan tardó demasiado. Puedes crear tareas manualmente.'), { status: 504 })); }, 90000);
        const stop = error => { clearTimeout(timer); reject(error); };
        child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 262144) { child.kill('SIGKILL'); stop(new Error('Respuesta demasiado grande')); } else out += chunk; });
        child.stderr.on('data', () => {});
        child.on('error', () => stop(Object.assign(new Error('Claude CLI no está disponible'), { status: 503 })));
        child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(Object.assign(new Error('Claude no pudo preparar el plan. Revisa su sesión o cuota.'), { status: 502 })); });
        child.stdin.on('error', () => {}); child.stdin.end(prompt);
      });
      try {
        const envelope = JSON.parse(output);
        if (envelope.is_error) throw new Error();
        let result = envelope.result;
        if (typeof result === 'string') result = JSON.parse(result.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
        return { provider: 'claude', tasks: validatePlan(result, input.project) };
      } catch { throw Object.assign(new Error('El proveedor devolvió un plan inválido. Ninguna tarea fue añadida.'), { status: 502 }); }
    } finally { busy = false; }
  };
}
