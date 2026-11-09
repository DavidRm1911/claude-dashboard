import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// "Buscar ofertas nuevas": runs the ai-job-search daily script (scrape + rank) in the background
// and reports what it actually produced, reading the pipeline_runs/*.json files it leaves behind.

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const ENV_PATH = (home) => [path.join(home, 'Library/TinyTeX/bin/universal-darwin'), path.join(home, '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const SCRAPER_RE = /^\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/, RANK_RE = /^rank_\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/;
const IDLE = { state: 'idle', startedAt: null, finishedAt: null, exitCode: null, pid: null, error: null, warning: null, result: null };

const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const ts = (v) => { const n = Date.parse(v); return Number.isNaN(n) ? null : n; };

export function summarizeRuns(runsDir, sinceIso) {
  let names = [];
  try { names = fs.readdirSync(runsDir); } catch { return { search: null, rank: null }; }
  const since = sinceIso ? ts(sinceIso) : null;
  const load = (re) => names.filter(f => re.test(f)).sort().map(f => readJsonFile(path.join(runsDir, f)))
    .filter(r => r && typeof r === 'object' && ts(r.run_at) != null && (since == null || ts(r.run_at) >= since));
  const scrapes = load(SCRAPER_RE), ranks = load(RANK_RE);
  const used = since == null ? scrapes.slice(-1) : scrapes;
  const search = used.length ? {
    // daily.sh runs pipeline.py and /pipeline may run it again: the same postings are re-fetched, so take the max, not the sum.
    fetched: Math.max(0, ...used.map(r => Number(r.fetched) || 0)),
    newAdded: used.reduce((n, r) => n + (Number(r.new) || 0), 0),
    portalErrors: used.reduce((n, r) => n + Object.values(r.errors || {}).reduce((m, v) => m + (Array.isArray(v) ? v.length : v ? 1 : 0), 0), 0),
    lastAt: used.map(r => r.run_at).sort().pop(),
  } : null;
  const rk = ranks.at(-1);
  const rank = rk ? { at: rk.run_at, ok: rk.ok !== false && !rk.exit_code, exitCode: rk.exit_code ?? 0, reason: rk.reason ?? null, rankedTotal: rk.ranked_total ?? null, backlog: rk.new_total ?? null } : null;
  return { search, rank };
}

export function createJobRefresh({ repoDir, dataDir, home, claudeConfigDir, spawnFn = spawn, timeoutMs = 30 * 60e3, shell = '/bin/zsh', script = 'tools/daily.sh', now = () => new Date() }) {
  const stateFile = path.join(dataDir, 'jobsearch-refresh.json');
  const runsDir = path.join(repoDir, 'job_scraper', 'pipeline_runs');
  let current = null; // { child, timer }

  function save(s) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${stateFile}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, stateFile);
    return s;
  }
  const load = () => ({ ...IDLE, ...(readJsonFile(stateFile) || {}) });

  const alive = (pid) => { try { if (pid) { process.kill(pid, 0); return true; } } catch {} return false; };

  function logLines(offset) {
    try {
      const f = path.join(runsDir, 'daily.log'), size = fs.statSync(f).size;
      const from = Math.max(offset, size - 8192, 0), buf = Buffer.alloc(Math.max(size - from, 0));
      const fd = fs.openSync(f, 'r'); try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
      return buf.toString('utf8').split('\n').filter(l => /failed/i.test(l)).slice(-3).map(l => l.trim().slice(0, 300));
    } catch { return []; }
  }

  function finish(code, tail, logOffset) {
    const s = load();
    if (s.state !== 'running') return;
    const result = summarizeRuns(runsDir, s.startedAt);
    let error = null, warning = null;
    if (code === 75) error = 'Ya había otra búsqueda diaria corriendo (la de las 8:30). Espera a que termine y recarga la vista.';
    else if (code === null) { if (!result.search) error = 'La búsqueda anterior se interrumpió (se reinició el dashboard).'; }
    else if (code !== 0) error = `El script diario terminó con error (código ${code}).${tail ? ' ' + tail.slice(-300) : ''}`;
    else if (!result.search) error = 'La búsqueda no dejó resultados (pipeline.py falló). Revisa job_scraper/pipeline_runs/daily.log.';
    else if (result.rank && result.rank.exitCode) error = `La búsqueda funcionó, pero el ranking con Claude falló (código ${result.rank.exitCode}). Probablemente la sesión de Claude Code expiró: abre la terminal y corre \`claude\` para iniciar sesión.`;
    else if (result.rank?.reason === 'no_new_scores') warning = 'No se puntuaron ofertas nuevas en esta corrida.';
    const failed = logLines(logOffset).join(' | ');
    if (failed) { if (error) error += ` Log: ${failed}`; else warning = warning ? `${warning} ${failed}` : failed; }
    save({ ...s, state: error ? 'error' : 'ok', finishedAt: now().toISOString(), exitCode: code, error, warning, result });
  }

  // After a dashboard restart the detached script may still be running: keep reporting it
  // as running and settle it from the files it leaves once its pid is gone.
  const prev = load();
  if (prev.state === 'running') {
    if (!alive(prev.pid)) finish(null, '', Infinity);
    else {
      const watch = setInterval(() => { if (!alive(prev.pid)) { clearInterval(watch); current = null; finish(null, '', Infinity); } }, 10e3);
      watch.unref?.();
      current = { child: null, timer: watch, orphan: true };
    }
  }

  return {
    start() {
      if (current) fail('Ya hay una búsqueda en curso. Espera a que termine.', 409);
      const scriptPath = path.join(repoDir, script);
      if (!fs.existsSync(scriptPath)) fail(`No encontré ${script} en ai-job-search.`, 404);
      let logOffset = 0; try { logOffset = fs.statSync(path.join(runsDir, 'daily.log')).size; } catch {}
      const env = { ...process.env, PATH: ENV_PATH(home), DAILY_NO_OPEN: '1', DAILY_SKIP_ESTUDIOS: '1' };
      const cfg = process.env.CLAUDE_CONFIG_DIR || claudeConfigDir;
      if (cfg) env.CLAUDE_CONFIG_DIR = cfg;
      const startedAt = now().toISOString();
      const child = spawnFn(shell, [scriptPath], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
      let tail = '', done = false;
      const keep = c => { tail = (tail + c).slice(-4096); };
      child.stdout?.on('data', keep); child.stderr?.on('data', keep);
      const end = (fn) => { if (done) return; done = true; clearTimeout(timer); current = null; fn(); };
      const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
      const timer = setTimeout(() => {
        killGroup('SIGTERM'); setTimeout(() => killGroup('SIGKILL'), 5000).unref?.();
        end(() => save({ ...load(), state: 'error', finishedAt: now().toISOString(), error: 'La búsqueda tardó más de 30 min y se detuvo.' }));
      }, timeoutMs);
      timer.unref?.();
      child.on('error', e => end(() => save({ ...load(), state: 'error', finishedAt: now().toISOString(), error: `No se pudo iniciar la búsqueda: ${e.message}` })));
      child.on('close', code => end(() => finish(code ?? 1, tail.trim(), logOffset)));
      current = { child, timer };
      return save({ ...IDLE, state: 'running', startedAt, pid: child.pid ?? null });
    },
    status() { return { ...load(), last: summarizeRuns(runsDir, null) }; },
  };
}
