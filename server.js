import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validateRequest, resolveProject, readJson } from "./lib/security.js";
import { createProviderStore } from "./lib/providers.js";
import { takeUsageDelta } from "./lib/usage.js";
import { getPricing, estimateCost, pricingCoverage } from "./lib/pricing.js";
import { createRadarStore } from "./lib/radar.js";
import { extractPdfText } from "./lib/cv.js";
import { createKanbanStore, taskBrief } from "./lib/kanban.js";
import { createPlanner } from "./lib/planner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PORT = Number(process.env.PORT || 4949);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("PORT inválido");
const RAW_CACHE_TTL_MS = 8000;
const SKILLS_CACHE_TTL_MS = 60000;

const PROFILES = [
  { key: "claude", credsPath: path.join(HOME, ".claude.json"), home: path.join(HOME, ".claude") },
  { key: "claude-work", credsPath: path.join(HOME, ".claude-work", ".claude.json"), home: path.join(HOME, ".claude-work") },
  { key: "claude-personal", credsPath: path.join(HOME, ".claude-personal", ".claude.json"), home: path.join(HOME, ".claude-personal") },
];

const GRAPHIFY_TARGETS = [
  { key: "personal", label: "Grafo personal", sourcePath: process.env.DASHBOARD_GRAPH_DIR || path.join(HOME, "Documents", "my-graph") },
  { key: "empresa", label: "Grafo de trabajo", sourcePath: process.env.DASHBOARD_WORK_DIR || path.join(HOME, "dev", "Work") },
];
const GRAPHIFY_BIN = path.join(HOME, ".local", "bin", "graphify");
const graphifyJobs = new Map();

const LOCAL_GITHUB_DIR = process.env.DASHBOARD_PROJECTS_DIR || path.join(HOME, "dev", "GitHub");
const NEO_GITHUB_DIR = process.env.DASHBOARD_WORK_DIR || path.join(HOME, "dev", "Work");
const OBSIDIAN_VAULT = process.env.DASHBOARD_VAULT_DIR || path.join(HOME, "Documents", "obsidian-vault");
const IDEAS_DIR = process.env.DASHBOARD_DATA_DIR || path.join(HOME, ".claude-dashboard");
const AI_ENABLED = (() => {
  if (process.env.DASHBOARD_ENABLE_AI != null) return process.env.DASHBOARD_ENABLE_AI === '1';
  try { return JSON.parse(fs.readFileSync(path.join(IDEAS_DIR, 'ai-settings.json'), 'utf8')).enabled === true; } catch { return false; }
})();
const providerStore = createProviderStore({ home: HOME, dataDir: IDEAS_DIR });
const radarStore = createRadarStore({ dataDir: IDEAS_DIR });
const kanbanStore = createKanbanStore({ dataDir: IDEAS_DIR });
const IDEAS_FILE = path.join(IDEAS_DIR, "ideas.json");
let ideasJob = { status: "idle", startedAt: null, finishedAt: null, error: null };

// Luminance-separated (verified via WCAG relative-luminance contrast, not eyeballed) so
// series stay distinguishable in grayscale and under deuteranopia. The first two — used
// for personal/empresa in the stacked chart, the only case with no adjacent text label —
// sit at contrast 2.45:1 against the near-white background floor and 3:1 against each
// other; a prior version of this array had its first two entries at an exact 1.0 tie.
const ACCOUNT_COLORS = ["#12106B", "#D21E3C", "#0E6E6E", "#8A5A16"];
const MODEL_PALETTE = ["#12106B", "#D21E3C", "#0E6E6E", "#8A5A16", "#5B3FA0"];

async function calcDirSize(dir) {
  try {
    const files = await walk(dir, { skip: new Set([".git"]) });
    const sizes = await Promise.all(files.map(async (f) => {
      try { return (await fs.promises.stat(f)).size; } catch { return 0; }
    }));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

function graphifyPaths(target) {
  const dir = path.join(target.sourcePath, "graphify-out");
  return { dir, html: path.join(dir, "graph.html"), json: path.join(dir, "graph.json") };
}

async function checkPortUp(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 700);
    await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

function getToolsInfo() {
  const graphs = GRAPHIFY_TARGETS.map((target) => {
    const { html, json } = graphifyPaths(target);
    const info = { key: target.key, label: target.label, available: fs.existsSync(html) };
    if (info.available) {
      try {
        const g = JSON.parse(fs.readFileSync(json, "utf8"));
        info.nodes = g.nodes?.length || 0;
        info.links = g.links?.length || 0;
        info.updatedAt = fs.statSync(json).mtime.toISOString();
      } catch {
        info.nodes = null;
        info.links = null;
      }
    }
    const job = graphifyJobs.get(target.key);
    info.job = job ? { status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt } : { status: "idle" };
    return info;
  });
  return { graphs };
}

function startGraphifyUpdate(targetKey) {
  const target = GRAPHIFY_TARGETS.find((t) => t.key === targetKey);
  if (!target) return { ok: false, error: "destino desconocido" };
  const current = graphifyJobs.get(targetKey);
  if (current?.status === "running") return { ok: false, error: "ya hay una actualización corriendo para este grafo" };

  const job = { status: "running", startedAt: new Date().toISOString(), finishedAt: null, log: "" };
  graphifyJobs.set(targetKey, job);

  // `update` re-extracts changed files with no LLM call at all — free, instant,
  // the right choice for routine refreshes. Only the very first run for a
  // target (no graph.json yet) needs `extract`, which does need a backend —
  // uses the free external Ollama box instead of the old paid `openai`
  // backend, since a stray forgotten click here used to cost real money.
  const hasGraph = fs.existsSync(path.join(target.sourcePath, "graphify-out", "graph.json"));
  const args = hasGraph
    ? ["update", target.sourcePath]
    : ["extract", target.sourcePath, "--backend", "ollama", "--model", "glm-4.7-flash:latest"];
  const env = process.env;

  const child = spawn(GRAPHIFY_BIN, args, { stdio: ["ignore", "pipe", "pipe"], env });
  child.stdout.on("data", (d) => (job.log += d.toString()));
  child.stderr.on("data", (d) => (job.log += d.toString()));
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "error";
    job.finishedAt = new Date().toISOString();
  });
  child.on("error", (err) => {
    job.status = "error";
    job.finishedAt = new Date().toISOString();
    job.log += String(err);
  });

  return { ok: true };
}

// ─── IDEAS ─────────────────────────────────────────────────────────────────
// Sources feed the generation prompt server-side only — raw repo/vault content
// never reaches the frontend, just the synthesized ideas and source counts.

function readClaudeMdSummaries(dir, orgLabel) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const claudePath = path.join(dir, entry.name, "CLAUDE.md");
    if (!fs.existsSync(claudePath)) continue;
    try {
      const summary = fs.readFileSync(claudePath, "utf8").slice(0, 1200);
      out.push({ name: entry.name, org: orgLabel, summary });
    } catch {}
  }
  return out;
}

// Resuelve la ruta absoluta de un binario de CLI de IA en vez de confiar en el
// PATH heredado por el proceso — encontrado al probar de verdad: cuando este
// server corre detached/en background (systemd-like, o cualquier restart que
// no venga de una shell interactiva con el profile cargado), el PATH puede
// llegar recortado al mínimo del sistema (sin /opt/homebrew/bin ni
// ~/.local/bin) y el spawn revienta con ENOENT aunque el binario exista.
function resolveBin(name) {
  for (const dir of [...(process.env.PATH || "").split(path.delimiter), path.join(HOME, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return name; // deja que el PATH del proceso lo resuelva si lo tiene
}
const CLAUDE_BIN = resolveBin("claude");
const GROK_BIN = resolveBin("grok");
const AGY_BIN = resolveBin("agy");
const planTasks = createPlanner({ bin: CLAUDE_BIN, cwd: os.tmpdir() });

function collectMcpServers() {
  const servers = [];
  for (const profile of PROFILES) {
    try {
      const config = JSON.parse(fs.readFileSync(profile.credsPath, "utf8"));
      for (const [name, settings] of Object.entries(config.mcpServers || {})) {
        servers.push({ name, profile: profile.key, transport: settings.type || (settings.url ? "http" : "stdio") });
      }
    } catch {}
  }
  return servers; // Never expose command arguments, tokens, env or headers.
}

function execCapture(cmd, args, { timeoutMs = 15000, input, cwd, onSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: [input != null ? "pipe" : "ignore", "pipe", "pipe"], cwd });
    onSpawn?.(child);
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e) });
    });
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

// Headless generators try Grok, then Claude. Both may consume the user's
// quota or billed usage; a subscription does not imply a free call.
// Only enabled generators use this path, and results identify the provider.
async function runWithFallback({ prompt, timeoutMs, cwd, grokArgs, claudeArgs, verify }) {
  // Found by actually running this against a real project, not assumed: grok's
  // "dontAsk" silently declines instead of auto-approving (unlike Claude's,
  // which does auto-approve) — it narrates a plan in prose and exits 0
  // without ever touching a file. bypassPermissions is what actually lets it
  // finish the task. Exit code alone isn't proof of that either — the same
  // truncated-narration output still exits 0, so every call site must pass
  // `verify` to check the actual thing it needed (a JSON array in the text,
  // a file that should now exist), not just "did the process exit clean."
  const grok = await execCapture(GROK_BIN, ["-p", prompt, "--no-auto-update", "--permission-mode", "dontAsk", ...grokArgs], { timeoutMs, cwd });
  const grokOk = grok.code === 0 && (!verify || verify(grok));
  if (grokOk) return { ...grok, provider: "grok" };

  const claude = await execCapture(CLAUDE_BIN, ["-p", prompt, "--permission-mode", "dontAsk", ...claudeArgs], { timeoutMs, cwd });
  return { ...claude, provider: "claude", grokError: grok.err?.slice(0, 300) || `exit ${grok.code} (output didn't verify)` };
}

async function gatherRemoteRepos() {
  const { code, out } = await execCapture("gh", ["repo", "list", "--limit", "40", "--json", "name,description,updatedAt,isPrivate,isFork"], { timeoutMs: 15000 });
  if (code !== 0) return [];
  try {
    const repos = JSON.parse(out);
    return repos.filter((r) => !r.isFork).map((r) => ({ name: r.name, description: r.description || "", updatedAt: r.updatedAt, private: r.isPrivate }));
  } catch {
    return [];
  }
}

async function gatherActivitySignal() {
  const projects = new Set();
  const skills = new Set();
  const cutoff = Date.now() - 30 * 86400000;
  for (const profile of PROFILES) {
    const projectsDir = path.join(profile.home, "projects");
    if (fs.existsSync(projectsDir)) {
      try {
        for (const entry of await fs.promises.readdir(projectsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          let mtime = 0;
          try { mtime = (await fs.promises.stat(path.join(projectsDir, entry.name))).mtimeMs; } catch {}
          if (mtime >= cutoff) projects.add(projectNameFromDir(entry.name));
        }
      } catch {}
    }
    for (const s of await getSkillsCached(profile)) skills.add(s.name);
  }
  return { projects: [...projects], skills: [...skills] };
}

async function gatherObsidianNotes() {
  const out = [];
  let total = 0;
  const CAP = 4500;
  for (const sub of ["trabajo", "tesis"]) {
    const dir = path.join(OBSIDIAN_VAULT, sub);
    if (!fs.existsSync(dir)) continue;
    const files = await walk(dir, { skip: new Set([".obsidian", ".git"]) });
    for (const file of files) {
      if (!file.endsWith(".md") || total >= CAP) continue;
      try {
        const excerpt = (await fs.promises.readFile(file, "utf8")).slice(0, 600);
        out.push({ area: sub, name: path.basename(file, ".md"), excerpt });
        total += excerpt.length;
      } catch {}
    }
  }
  return out;
}

function repoBlock(list, label) {
  return `### ${label}\n` +
    (list.length
      ? list.map((r) => `- ${r.name}: ${(r.summary || r.description || "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n")
      : "(sin datos)");
}

function buildIdeasPrompt({ localRepos, neoRepos, remoteRepos, activity, notes }) {
  const notesBlock = notes.length
    ? notes.map((n) => `- [${n.area}] ${n.name}: ${n.excerpt.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")
    : "(sin notas)";

  return `Eres un asesor senior de proyectos de software e IA. Ayuda al usuario a encontrar dos mejoras prácticas y verificables para sus proyectos.

Antes de proponer, investiga qué se está discutiendo AHORA MISMO en el sector de IA:
- Revisa con WebFetch qué hay en https://github.com/trending (y si aplica, https://github.com/trending/python?since=weekly o https://github.com/trending/typescript?since=weekly) para ver qué proyectos de IA están ganando tracción esta semana.
- Revisa con WebFetch https://news.ycombinator.com/ para pulso de lo que la comunidad técnica está comentando.
- Usa WebSearch para lanzamientos recientes, patrones que están adoptando otras consultoras/AI labs, y tendencias de agentes/modelos/herramientas.
Las ideas deben sentirse actuales y citar algo concreto que encontraste (un repo, un proyecto, un lanzamiento) — no genéricas de hace dos años.

Con esa investigación más la evidencia de abajo (proyectos, actividad y notas), propone EXACTAMENTE 2 ideas. Conecta una tendencia actual con algo que el usuario ya tiene construido y explica cómo comprobar su utilidad.

Cada idea debe ser algo que él pueda defender frente a su gerencia con evidencia de que ya tiene el contexto técnico para ejecutarla, Y que suene a que está a la vanguardia del sector, no reciclando lo de siempre.

${repoBlock(localRepos, "Repos personales (~/dev/GitHub)")}

${repoBlock(neoRepos, "Proyectos de trabajo configurados")}

${repoBlock(remoteRepos, "Repos remotos en GitHub")}

### Actividad reciente (últimos 30 días)
Proyectos activos: ${activity.projects.join(", ") || "(sin datos)"}
Skills de Claude Code que usa: ${activity.skills.join(", ") || "(sin datos)"}

### Notas de su vault (trabajo/tesis)
${notesBlock}

Responde ÚNICAMENTE con un JSON array de exactamente 2 objetos, sin texto antes ni después, con estas claves:
- "title": título corto de la idea
- "trend": la tendencia o novedad actual del sector de IA en la que se apoya (1 frase, con lo que encontraste en tu búsqueda)
- "why": por qué encaja con su contexto (2-3 frases, citando evidencia concreta de arriba)
- "effort": "bajo" | "medio" | "alto"
- "next_step": el primer paso concreto que podría dar esta semana`;
}

function buildCustomIdeaPrompt(customIdea, { localRepos, neoRepos, remoteRepos, activity, notes }) {
  return `Eres un asesor senior de proyectos de software e IA para el usuario.

el usuario tuvo esta idea y quiere que la investigues a fondo antes de decidir si la propone a su gerencia:

"${customIdea}"

Investiga en serio antes de opinar:
- Usa WebSearch para ver si algo parecido ya existe, qué tan madura es la tecnología detrás, y qué se dice del tema ahora mismo en el sector.
- Revisa con WebFetch https://github.com/trending (y la variante de lenguaje que aplique) para ver si hay proyectos relacionados ganando tracción esta semana.
- Cruza tus hallazgos con la evidencia de abajo (sus repos reales, actividad reciente, notas) para juzgar si él ya tiene el contexto técnico para ejecutarla o qué le falta.

${repoBlock(localRepos, "Repos personales (~/dev/GitHub)")}

${repoBlock(neoRepos, "Proyectos de trabajo configurados")}

${repoBlock(remoteRepos, "Repos remotos en GitHub")}

### Actividad reciente (últimos 30 días)
Proyectos activos: ${activity.projects.join(", ") || "(sin datos)"}
Skills de Claude Code que usa: ${activity.skills.join(", ") || "(sin datos)"}

### Notas de su vault (trabajo/tesis)
${notes.length ? notes.map((n) => `- [${n.area}] ${n.name}: ${n.excerpt.replace(/\s+/g, " ").slice(0, 200)}`).join("\n") : "(sin notas)"}

Responde ÚNICAMENTE con un JSON array de EXACTAMENTE 1 objeto (tu evaluación investigada de esta idea puntual), sin texto antes ni después, con estas claves:
- "title": título corto de la idea (puedes pulir el enunciado original)
- "trend": qué encontraste en tu investigación sobre el estado actual de esto en el sector (1-2 frases, concreto)
- "why": tu análisis de viabilidad citando evidencia — qué de lo que él ya tiene construido ayuda o qué le falta (2-3 frases)
- "effort": "bajo" | "medio" | "alto"
- "next_step": el primer paso concreto que podría dar esta semana si decide seguir
- "verdict": tu veredicto honesto tras investigar — uno de "vale la pena", "vale la pena con ajustes", "no vale la pena por ahora"`;
}

async function runIdeasGeneration(customIdea) {
  ideasJob = { status: "running", startedAt: new Date().toISOString(), finishedAt: null, error: null };
  try {
    const localRepos = readClaudeMdSummaries(LOCAL_GITHUB_DIR, "personal");
    const neoRepos = readClaudeMdSummaries(NEO_GITHUB_DIR, "neo");
    const remoteRepos = await gatherRemoteRepos();
    const activity = await gatherActivitySignal();
    const notes = await gatherObsidianNotes();

    const ctx = { localRepos, neoRepos, remoteRepos, activity, notes };
    const prompt = customIdea ? buildCustomIdeaPrompt(customIdea, ctx) : buildIdeasPrompt(ctx);
    const { code, out, err, provider, grokError } = await runWithFallback({
      prompt,
      timeoutMs: 300000,
      grokArgs: [], // web search on by default — this prompt needs it
      claudeArgs: ["--allowedTools", "WebSearch,WebFetch"],
      verify: (r) => /\[[\s\S]*\]/.test(r.out),
    });
    if (provider === "claude" && grokError) console.error(`[ideas-ia] grok fallback to claude: ${grokError}`);
    if (code !== 0) throw new Error((err || "").slice(0, 500) || `${provider} salió con código ${code}`);

    const match = out.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("no se pudo interpretar la respuesta de Claude como JSON");
    const ideas = JSON.parse(match[0]);

    const entry = {
      generatedAt: new Date().toISOString(),
      ideas,
      provider,
      custom: !!customIdea,
      promptText: customIdea || null,
      sources: {
        localRepos: localRepos.length,
        neoRepos: neoRepos.length,
        remoteRepos: remoteRepos.length,
        activeProjects: activity.projects.length,
        notes: notes.length,
      },
    };

    fs.mkdirSync(IDEAS_DIR, { recursive: true });
    let store = [];
    try { store = JSON.parse(fs.readFileSync(IDEAS_FILE, "utf8")); } catch {}
    store.unshift(entry);
    fs.writeFileSync(IDEAS_FILE, JSON.stringify(store.slice(0, 24), null, 2));

    ideasJob = { status: "done", startedAt: ideasJob.startedAt, finishedAt: new Date().toISOString(), error: null };
  } catch (e) {
    ideasJob = { status: "error", startedAt: ideasJob.startedAt, finishedAt: new Date().toISOString(), error: String(e.message || e) };
  }
}

// ─── PROJECT STATUS (mis-proyectos: descripción, % de avance, mejoras) ────────
// La nota privada (.claude/project-notes.md) nunca sale del servidor tal cual —
// solo alimenta el prompt server-side, igual que el resto de fuentes de ideas-ia.

const PROJECT_STATUS_FILE = path.join(IDEAS_DIR, "project-status.json");
const PROJECT_NOTE_RELPATH = path.join(".claude", "project-notes.md");
let projectStatusJob = { status: "idle", startedAt: null, finishedAt: null, error: null };

function projectNoteTemplate(name) {
  return `# Notas privadas — ${name}

> Este archivo es solo local: el dashboard lo agrega automáticamente a .gitignore al crearlo,
> nunca se commitea. Úsalo para el contexto que el análisis de IA del dashboard necesita pero
> que no es para el CLAUDE.md público: bloqueos actuales, decisiones pendientes, deuda técnica,
> roadmap corto plazo.

## Estado actual

## Bloqueos / pendientes

## Roadmap corto plazo
`;
}

function ensureGitignored(repoPath, pattern) {
  const gitignorePath = path.join(repoPath, ".gitignore");
  let content = "";
  try { content = fs.readFileSync(gitignorePath, "utf8"); } catch {}
  if (content.split("\n").some((l) => l.trim() === pattern)) return;
  const sep = content && !content.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(gitignorePath, content + sep + pattern + "\n");
}

// ─── CLAUDE.md GENERATION (botón "+ Generar CLAUDE.md" en proyectos sin doc) ──

const claudeMdJobs = new Map(); // key: `${org}/${name}` -> { status, error, finishedAt }

async function runClaudeMdGeneration(org, name) {
  const key = `${org}/${name}`;
  const dir = org === "neo" ? NEO_GITHUB_DIR : LOCAL_GITHUB_DIR;
  const repoPath = path.join(dir, name);
  claudeMdJobs.set(key, { status: "running", error: null, finishedAt: null });
  try {
    if (!fs.existsSync(repoPath)) throw new Error("proyecto no encontrado");
    const prompt = `Analiza este proyecto (lee package.json, README si existe, estructura de carpetas, y el código fuente que haga falta) y escribe un CLAUDE.md en la raíz siguiendo esta convención exacta:

- Qué hace el proyecto
- Cómo correrlo
- Archivos clave
- Sugerencias de mejora

Sé específico y basado en lo que realmente encuentres en el código — nada genérico. Escribe el archivo CLAUDE.md directamente, no lo muestres solo como respuesta.`;
    const { code, err, provider, grokError } = await runWithFallback({
      prompt,
      timeoutMs: 300000,
      cwd: repoPath,
      grokArgs: [], // default toolset includes file read/write natively — no restriction to mirror
      claudeArgs: ["--allowedTools", "Read,Glob,Grep,Write"],
      verify: () => fs.existsSync(path.join(repoPath, "CLAUDE.md")), // the only proof that matters here
    });
    if (provider === "claude" && grokError) console.error(`[claude-md] grok fallback to claude: ${grokError}`);
    if (code !== 0) throw new Error((err || "").slice(0, 500) || `${provider} salió con código ${code}`);
    if (!fs.existsSync(path.join(repoPath, "CLAUDE.md"))) throw new Error(`${provider} no escribió CLAUDE.md`);
    claudeMdJobs.set(key, { status: "done", error: null, finishedAt: new Date().toISOString() });
  } catch (e) {
    claudeMdJobs.set(key, { status: "error", error: String(e.message || e), finishedAt: new Date().toISOString() });
  }
}

async function gatherProjectStatusContext() {
  const targets = [
    { dir: LOCAL_GITHUB_DIR, org: "personal" },
    { dir: NEO_GITHUB_DIR, org: "neo" },
  ];
  const projects = [];
  for (const { dir, org } of targets) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(dir, entry.name);
      const claudePath = path.join(repoPath, "CLAUDE.md");
      const notePath = path.join(repoPath, PROJECT_NOTE_RELPATH);
      const hasDoc = fs.existsSync(claudePath);
      const hasPrivateNote = fs.existsSync(notePath);
      let claudeExcerpt = "";
      if (hasDoc) { try { claudeExcerpt = fs.readFileSync(claudePath, "utf8").slice(0, 1200); } catch {} }
      let noteExcerpt = "";
      if (hasPrivateNote) { try { noteExcerpt = fs.readFileSync(notePath, "utf8").slice(0, 1200); } catch {} }
      const isGitRepo = fs.existsSync(path.join(repoPath, ".git"));
      const git = isGitRepo ? await gitInfo(repoPath) : null;
      const daysSinceCommit = git?.lastCommitAt ? Math.floor((Date.now() - new Date(git.lastCommitAt).getTime()) / 86400000) : null;
      projects.push({ name: entry.name, org, hasDoc, hasPrivateNote, claudeExcerpt, noteExcerpt, daysSinceCommit, dirty: git?.dirty ?? null });
    }
  }
  return projects;
}

async function gatherAllSkills() {
  const seen = new Map();
  for (const profile of PROFILES) {
    for (const s of await getSkillsCached(profile)) {
      if (!seen.has(s.name)) seen.set(s.name, s.description || "");
    }
  }
  return [...seen.entries()].map(([name, description]) => ({ name, description })).sort((a, b) => a.name.localeCompare(b.name));
}

function buildProjectStatusPrompt(projects, skills) {
  const block = projects.map((p) => {
    const lines = [`### ${p.name} (${p.org === "neo" ? "su organización" : "personal"})`];
    lines.push(p.daysSinceCommit === null
      ? "Actividad git: sin commits o no es repo git"
      : `Actividad git: último commit hace ${p.daysSinceCommit} días${p.dirty ? ", con cambios sin commitear" : ""}`);
    lines.push(p.hasDoc ? `CLAUDE.md:\n${p.claudeExcerpt}` : "CLAUDE.md: no tiene");
    lines.push(p.hasPrivateNote ? `Notas privadas del autor:\n${p.noteExcerpt}` : "Notas privadas: no tiene");
    return lines.join("\n");
  }).join("\n\n");

  const skillsBlock = skills.length
    ? skills.map((s) => `- ${s.name}: ${(s.description || "").replace(/\s+/g, " ").slice(0, 200)}`).join("\n")
    : "(sin skills instaladas)";

  return `Eres un asesor técnico que ayuda a el usuario a entender en qué estado está cada uno de sus proyectos de GitHub — tanto personales como de su organización.

Para cada proyecto de abajo, evalúa con la evidencia dada (CLAUDE.md, notas privadas del autor si las hay, y actividad de git) y responde con:
- "description": 1 frase de qué hace el proyecto (si no hay CLAUDE.md, infiere del nombre y dilo con cautela)
- "progress_pct": entero 0-100, qué tan avanzado/completo parece el proyecto
- "progress_reasoning": 1 frase breve justificando ese porcentaje
- "improvements": array de máximo 3 strings, mejoras concretas y accionables — nada genérico como "agregar tests" sin contexto, sé específico a lo que ves de este proyecto
- "skill_suggestion": el nombre de UNA skill de Claude Code que le convendría a este proyecto.
  REGLA ESTRICTA: si vas a marcar "skill_is_new" como false, "skill_suggestion" debe ser copiado LETRA POR LETRA de la lista "Skills que ya tiene instaladas" de abajo — no inventes ni adaptes un nombre aunque suene plausible o típico de Claude Code. Si ningún nombre de esa lista encaja de verdad, propone tú un nombre nuevo (corto, kebab-case) y marca "skill_is_new": true. Ante la duda entre inventar un nombre parecido a uno instalado o proponerlo como nuevo, SIEMPRE elige proponerlo como nuevo — es peor decirle que ya tiene algo que no tiene, que sugerirle algo que ya existe como si fuera nuevo.
- "skill_purpose": 1-2 frases de PARA QUÉ SIRVE esa skill en general — qué hace, cuándo se usaría, como si fuera la descripción que va en el frontmatter de su SKILL.md. Si "skill_is_new" es false esto se ignora (ya tenemos la descripción real, no hace falta que la escribas), pero complétalo igual. Si es una skill nueva, esta es la parte más importante: descríbela lo bastante bien como para que él pueda armarla después solo con esta frase.
- "skill_reason": 1 frase de por qué esa skill (existente o nueva) le sirve ESPECÍFICAMENTE a este proyecto puntual — no repitas "skill_purpose", conecta con algo concreto del proyecto (su stack, su estado, sus mejoras sugeridas arriba)
- "skill_is_new": true si "skill_suggestion" NO aparece literalmente en la lista de instaladas, false solo si aparece literalmente

### Skills de Claude Code que ya tiene instaladas (en cualquiera de sus perfiles)
${skillsBlock}

${block}

Responde ÚNICAMENTE con un JSON array, sin texto antes ni después, un objeto por proyecto con las claves: "name", "org", "description", "progress_pct", "progress_reasoning", "improvements", "skill_suggestion", "skill_purpose", "skill_reason", "skill_is_new".`;
}

async function runProjectStatusGeneration() {
  projectStatusJob = { status: "running", startedAt: new Date().toISOString(), finishedAt: null, error: null };
  try {
    const projects = await gatherProjectStatusContext();
    if (!projects.length) throw new Error("No se encontraron proyectos en las carpetas configuradas");
    const skills = await gatherAllSkills();

    const prompt = buildProjectStatusPrompt(projects, skills);
    const { code, out, err, provider, grokError } = await runWithFallback({
      prompt,
      timeoutMs: 300000,
      grokArgs: ["--tools", "", "--disable-web-search"], // pure reasoning over given context, no tools needed
      claudeArgs: [],
      verify: (r) => /\[[\s\S]*\]/.test(r.out),
    });
    if (provider === "claude" && grokError) console.error(`[project-status] grok fallback to claude: ${grokError}`);
    if (code !== 0) throw new Error((err || "").slice(0, 500) || `${provider} salió con código ${code}`);

    const match = out.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`no se pudo interpretar la respuesta de ${provider} como JSON`);
    const entries = JSON.parse(match[0]);

    // Defensa contra alucinaciones: el modelo a veces inventa un nombre de skill que
    // "suena" instalado y marca skill_is_new=false. No confiamos en su palabra — solo
    // false si el nombre existe literalmente en la lista real que le dimos. Y para las
    // que sí existen, el "para qué sirve" viene de su SKILL.md real, no de lo que el
    // modelo haya escrito (eso solo lo dejamos para las propuestas de skills nuevas).
    const skillByName = new Map(skills.map((s) => [s.name, s]));
    for (const entry of entries) {
      const real = entry.skill_suggestion ? skillByName.get(entry.skill_suggestion) : null;
      entry.skill_is_new = !real;
      if (real) entry.skill_purpose = real.description || entry.skill_purpose;
    }

    fs.mkdirSync(IDEAS_DIR, { recursive: true });
    fs.writeFileSync(PROJECT_STATUS_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), provider, entries }, null, 2));

    projectStatusJob = { status: "done", startedAt: projectStatusJob.startedAt, finishedAt: new Date().toISOString(), error: null };
  } catch (e) {
    projectStatusJob = { status: "error", startedAt: projectStatusJob.startedAt, finishedAt: new Date().toISOString(), error: String(e.message || e) };
  }
}

// ─── REPO AUDIT ────────────────────────────────────────────────────────────
// Read-only scan by default. Pushing and deleting only ever happen when the
// user clicks the corresponding button in their own browser — nothing here
// runs on a schedule or without a direct request.

async function calcDirSizeFull(dir) {
  try {
    const files = await walk(dir, { skip: new Set() });
    const sizes = await Promise.all(files.map(async (f) => {
      try { return (await fs.promises.stat(f)).size; } catch { return 0; }
    }));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

async function gitInfo(repoPath) {
  const run = (args) => execCapture("git", ["-C", repoPath, ...args], { timeoutMs: 8000 });
  const [branchRes, lastCommitRes, statusRes, remoteRes] = await Promise.all([
    run(["rev-parse", "--abbrev-ref", "HEAD"]),
    run(["log", "-1", "--format=%cI"]),
    run(["status", "--porcelain"]),
    run(["remote", "-v"]),
  ]);
  const branch = branchRes.out.trim() || null;
  const lastCommitAt = lastCommitRes.out.trim() || null;
  const dirty = statusRes.code === 0 && statusRes.out.trim().length > 0;
  const hasRemote = remoteRes.out.trim().length > 0;

  let ahead = null;
  if (hasRemote && branch) {
    const aheadRes = await run(["rev-list", "--left-right", "--count", `HEAD...@{u}`]);
    if (aheadRes.code === 0) {
      const [a] = aheadRes.out.trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(a) ? a : null;
    }
  }

  return { branch, lastCommitAt, dirty, hasRemote, ahead };
}

async function scanRepoAudit() {
  const targets = [
    { dir: LOCAL_GITHUB_DIR, org: "personal" },
    { dir: NEO_GITHUB_DIR, org: "neo" },
  ];
  const repos = [];
  for (const { dir, org } of targets) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(dir, entry.name);
      if (!fs.existsSync(path.join(repoPath, ".git"))) continue;
      repos.push({ name: entry.name, org, path: repoPath });
    }
  }

  return Promise.all(repos.map(async (r) => {
    const [sizeBytes, git] = await Promise.all([calcDirSizeFull(r.path), gitInfo(r.path)]);
    const daysSinceCommit = git.lastCommitAt ? Math.floor((Date.now() - new Date(git.lastCommitAt).getTime()) / 86400000) : null;
    const pushed = git.hasRemote && !git.dirty && (git.ahead === null || git.ahead === 0);

    let recommendation = "revisar";
    if (daysSinceCommit !== null && daysSinceCommit <= 30) recommendation = "uso activo";
    else if (!git.hasRemote) recommendation = "sin respaldo remoto";
    else if (git.dirty || (git.ahead ?? 0) > 0) recommendation = "cambios sin subir";
    else if (daysSinceCommit !== null && daysSinceCommit > 180) recommendation = "candidata a archivar";
    else recommendation = "mantener";

    return {
      name: r.name,
      org: r.org,
      sizeBytes,
      branch: git.branch,
      lastCommitAt: git.lastCommitAt,
      daysSinceCommit,
      dirty: git.dirty,
      hasRemote: git.hasRemote,
      aheadOfRemote: git.ahead,
      pushed,
      recommendation,
    };
  }));
}

const repoJobs = new Map(); // key: `${org}/${name}` -> { action, status, error, finishedAt }

async function pushRepoToGitHub(org, name) {
  const key = `${org}/${name}`;
  const dir = org === "neo" ? NEO_GITHUB_DIR : LOCAL_GITHUB_DIR;
  const repoPath = path.join(dir, name);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    repoJobs.set(key, { action: "push", status: "error", error: "no es un repo git", finishedAt: new Date().toISOString() });
    return;
  }
  repoJobs.set(key, { action: "push", status: "running", error: null, finishedAt: null });
  try {
    // git push only pushes existing commits — it silently no-ops on uncommitted
    // working-tree changes, which is exactly the state most "archive candidate"
    // repos are in. Commit first so the repo is actually fully backed up.
    const statusRes = await execCapture("git", ["-C", repoPath, "status", "--porcelain"], { timeoutMs: 8000 });
    if (statusRes.out.trim()) {
      const add = await execCapture("git", ["-C", repoPath, "add", "-A"], { timeoutMs: 15000 });
      if (add.code !== 0) throw new Error(add.err.slice(0, 500) || "git add falló");
      const commit = await execCapture(
        "git",
        ["-C", repoPath, "commit", "-m", "chore: snapshot antes de archivar en GitHub (vía claude-dashboard)"],
        { timeoutMs: 15000 }
      );
      if (commit.code !== 0) throw new Error(commit.err.slice(0, 500) || "git commit falló");
    }

    const remoteRes = await execCapture("git", ["-C", repoPath, "remote", "-v"], { timeoutMs: 8000 });
    if (remoteRes.out.trim()) {
      const branchRes = await execCapture("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 8000 });
      const branch = branchRes.out.trim() || "HEAD";
      const push = await execCapture("git", ["-C", repoPath, "push", "-u", "origin", branch], { timeoutMs: 60000 });
      if (push.code !== 0) throw new Error(push.err.slice(0, 500) || "git push falló");
    } else {
      const create = await execCapture("gh", ["repo", "create", name, "--private", "--source", repoPath, "--remote", "origin", "--push"], { timeoutMs: 60000 });
      if (create.code !== 0) throw new Error(create.err.slice(0, 500) || "gh repo create falló");
    }
    repoJobs.set(key, { action: "push", status: "done", error: null, finishedAt: new Date().toISOString() });
  } catch (e) {
    repoJobs.set(key, { action: "push", status: "error", error: String(e.message || e), finishedAt: new Date().toISOString() });
  }
}

// ─── PROJECT NAMES ─────────────────────────────────────────────────────────
// Derives a real display name + one-line description from each repo's
// CLAUDE.md instead of showing the raw session title (often just the first
// prompt verbatim, e.g. "hola quien soy"). Cached to disk, mtime-invalidated.

const PROJECT_NAMES_FILE = path.join(IDEAS_DIR, "project-names.json");
let projectNamesCache = null;

function loadProjectNamesCache() {
  if (projectNamesCache) return projectNamesCache;
  try { projectNamesCache = JSON.parse(fs.readFileSync(PROJECT_NAMES_FILE, "utf8")); }
  catch { projectNamesCache = {}; }
  return projectNamesCache;
}

function saveProjectNamesCache() {
  try {
    fs.mkdirSync(IDEAS_DIR, { recursive: true });
    fs.writeFileSync(PROJECT_NAMES_FILE, JSON.stringify(projectNamesCache, null, 2));
  } catch {}
}

function parseClaudeMdSummary(content) {
  const h1Match = content.match(/^#\s+(.+)$/m);
  const displayName = h1Match ? h1Match[1].trim() : null;
  const lines = content.split("\n");
  let description = null;
  let pastH1 = !h1Match;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!pastH1) { if (/^#\s+/.test(trimmed)) pastH1 = true; continue; }
    if (!trimmed || trimmed.startsWith("#")) continue;
    description = trimmed.replace(/[*_`]/g, "").slice(0, 180);
    break;
  }
  return { displayName, description };
}

async function getProjectInfo(projectPath) {
  if (!projectPath) return null;
  let org = null, dir = null;
  if (projectPath.startsWith(NEO_GITHUB_DIR + path.sep)) { org = "neo"; dir = NEO_GITHUB_DIR; }
  else if (projectPath.startsWith(LOCAL_GITHUB_DIR + path.sep)) { org = "personal"; dir = LOCAL_GITHUB_DIR; }
  else return null;

  const repoName = path.relative(dir, projectPath).split(path.sep)[0];
  if (!repoName) return null;

  const cache = loadProjectNamesCache();
  const claudePath = path.join(dir, repoName, "CLAUDE.md");
  let mtime;
  try { mtime = (await fs.promises.stat(claudePath)).mtimeMs; } catch { return cache[repoName] || null; }

  const cached = cache[repoName];
  if (cached && cached.sourceMtime === mtime) return cached;

  try {
    const content = await fs.promises.readFile(claudePath, "utf8");
    const { displayName, description } = parseClaudeMdSummary(content);
    const entry = { org, repoName, displayName: displayName || repoName, description, sourceMtime: mtime, cachedAt: new Date().toISOString() };
    cache[repoName] = entry;
    saveProjectNamesCache();
    return entry;
  } catch {
    return cached || null;
  }
}

// ─── INTERVIEW PREP (entrevista de práctica de Cloud Architect) ───────────────
// "system design interview" chat. claude -p no tiene estado entre llamadas, así
// que cada turno reconstruye el prompt completo (persona + transcripción hasta
// ahora) y pide de vuelta un JSON. Igual patrón de job async + polling que
// ideas/project-status, una entrada por sesión en INTERVIEWS_FILE.

const INTERVIEWS_FILE = path.join(IDEAS_DIR, "interviews.json");
const interviewJobs = new Map(); // sessionId -> { status: "running"|"done"|"error"|"cancelled", error }
const interviewChildren = new Map(); // sessionId -> in-flight agy/claude child process, so cancel can kill it

// Editar a mano cuando cambie una certificación (ej. al pasar de SAA a SAP).
const INTERVIEW_BACKGROUND = process.env.DASHBOARD_INTERVIEW_BACKGROUND || "Desarrollador que practica entrevistas de arquitectura cloud. Calibra el nivel a partir de sus respuestas y del contexto que proporciona.";

const INTERVIEW_FOCUS_LABEL = { aws: "AWS", gcp: "GCP", azure: "Azure", kubernetes: "Kubernetes", general: "multi-cloud / arquitectura general" };

function loadInterviews() {
  try { return JSON.parse(fs.readFileSync(INTERVIEWS_FILE, "utf8")); } catch { return []; }
}
function saveInterviews(list) {
  fs.mkdirSync(IDEAS_DIR, { recursive: true });
  fs.writeFileSync(INTERVIEWS_FILE, JSON.stringify(list.slice(0, 40), null, 2));
}
function findInterview(list, id) {
  return list.find((s) => s.id === id);
}

// El modelo a veces devuelve el "speak" multi-línea con saltos de línea reales
// sin escapar dentro del string JSON (natural cuando redacta feedback largo) —
// JSON.parse revienta con "Bad control character in string literal" ahí donde
// las otras rutas de generación (ideas, arrays de una línea) nunca lo notaron.
// Recorre el texto respetando el estado dentro/fuera de comillas y escapa los
// caracteres de control solo cuando están dentro de un string.
function sanitizeJsonControlChars(str) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of str) {
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === "\\") {
      out += ch;
      escaped = true;
    } else if (ch === '"') {
      out += ch;
      inString = false;
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else if (ch.charCodeAt(0) < 0x20) {
      // otros caracteres de control: se descartan, no aportan nada válido
    } else {
      out += ch;
    }
  }
  return out;
}

const readJsonBody = readJson;

function buildInterviewPersonaBlock(focus, contextBlock, memoryContext) {
  const hasMemory = memoryContext && !/sin historial previo/i.test(memoryContext);
  return `Eres un entrevistador Staff/Principal Cloud Solutions Architect entrevistando a el usuario para un puesto de Cloud Architect. No eres un asistente amable — eres un entrevistador real, exigente pero justo, del tipo que contrata gente que puede sostener sus decisiones bajo presión. Tienes acceso a búsqueda web: si algo que dice el usuario depende de un precio, límite o servicio concreto de AWS/GCP, verifícalo en vez de asumir que tu conocimiento previo sigue vigente.

Contexto real de el usuario (no se lo repitas, úsalo solo para calibrar la dificultad — ni trivial para su nivel, ni imposible):
${INTERVIEW_BACKGROUND}
${contextBlock ? `\nEvidencia adicional de proyectos reales que ya construyó:\n${contextBlock}` : ""}
${hasMemory ? `\nPatrones de errores de sus entrevistas de práctica anteriores (verifica activamente si los repite; si lo hace, dilo explícito porque sería un error repetido, no nuevo):\n${memoryContext}` : ""}

Enfoque de esta entrevista: ${INTERVIEW_FOCUS_LABEL[focus] || INTERVIEW_FOCUS_LABEL.general}.

Formato "system design interview": planteas UN problema de arquitectura abierto con restricciones de negocio concretas (usuarios, latencia, presupuesto, disponibilidad, compliance) y evalúas cómo profundiza en 4 a 6 turnos, como una entrevista real de Solutions Architect:

1. Primer turno: plantea el problema. No reveles la "respuesta correcta" ni la insinúes.
2. En cada turno siguiente: evalúa la última respuesta con rigor técnico real — servicio elegido, trade-offs de costo/seguridad/escala/disponibilidad/compliance. Si hay un error concreto (servicio equivocado, olvido de seguridad, contradicción, estimación de costo absurda), dilo explícito y sin suavizarlo — el punto es que corrija errores reales, no que se sienta bien. Si la respuesta es sólida, dilo también, breve, y sube la apuesta.
3. Agrega UNA pregunta de seguimiento que empuje más hondo (10x de tráfico, falla de una zona, migración sin downtime, auditoría de compliance, costo mensual estimado) — nunca repitas la misma pregunta de otra forma.
4. Tras 4 a 6 turnos de profundización, cierra la entrevista: da un veredicto honesto y un resumen de los 2-3 errores más importantes que cometió (o "sin errores relevantes" si de verdad no los hubo).
5. SOLO en el turno de cierre (done=true), añade además:
   - "study_plan": 3-5 temas concretos a estudiar, derivados directamente de los errores reales de TODA la entrevista (y de los patrones de entrevistas anteriores si los hay) — no genéricos. Cada uno con por qué le hizo falta y cómo estudiarlo (un recurso o forma concreta de practicarlo, no "lee la documentación").
   - "career_guidance": una evaluación honesta de nivel actual, no aspiracional. Usa tu acceso a búsqueda web para verificar cifras reales y recientes de compensación en vez de inventarlas — busca rangos salariales actuales para el rol que le recomiendas, tanto en el mercado de Perú/Lima como en remoto LatAm-facing (USD). Si el desempeño de la entrevista no da para el título de "Cloud Architect" todavía, dilo directo y sugiere el puesto real que sí puede pedir hoy (ej. "Cloud Engineer Semi-Senior", no "Architect").

Tu turno tiene 6 partes: "speak" (lo que le dices a el usuario), "mistakes" (array de errores concretos de este turno puntual, vacío [] si no cometió ninguno), "verdict" (null salvo que sea el turno de cierre), "done" (true solo en el turno de cierre), "study_plan" (array vacío [] salvo en el turno de cierre) y "career_guidance" (null salvo en el turno de cierre).`;
}

// El schema (--json-schema en agy) ya fuerza estas 4 claves — pedirle además
// en el prompt "responde solo con este JSON: {...}" hace que el modelo anide
// el objeto completo DENTRO de "speak" (confirmado corriéndolo: "speak"
// terminaba conteniendo el JSON entero como texto). Para el fallback de
// Claude, que no tiene enforcement de schema, si hace falta ese literal.
function buildInterviewTurnPrompt(session, { strictJsonInstruction = false } = {}) {
  const persona = buildInterviewPersonaBlock(session.focus, session.contextBlock, session.memoryContext);
  const jsonInstruction = strictJsonInstruction
    ? `\n\nResponde SIEMPRE y ÚNICAMENTE con un objeto JSON, sin texto antes ni después, con las 6 claves descritas arriba: {"speak": "...", "mistakes": [...], "verdict": null, "done": false, "study_plan": [], "career_guidance": null}`
    : "";
  if (!session.turns.length) {
    return `${persona}${jsonInstruction}\n\nEste es el primer turno. Plantea el problema de arquitectura inicial siguiendo el formato de arriba.`;
  }
  const transcript = session.turns
    .map((t) => (t.role === "interviewer" ? `[Entrevistador]: ${t.speak}` : `[el usuario]: ${t.content}`))
    .join("\n\n");
  return `${persona}${jsonInstruction}\n\n### Transcripción de la entrevista hasta ahora\n${transcript}\n\nResponde con el siguiente turno del entrevistador.`;
}

async function gatherInterviewContext() {
  const localRepos = readClaudeMdSummaries(LOCAL_GITHUB_DIR, "personal").slice(0, 6);
  const neoRepos = readClaudeMdSummaries(NEO_GITHUB_DIR, "neo").slice(0, 6);
  return [...localRepos, ...neoRepos]
    .map((r) => `- ${r.name}: ${(r.summary || "").replace(/\s+/g, " ").slice(0, 200)}`)
    .join("\n");
}

// el usuario ya tiene mem0 self-hosted como "segundo cerebro" (registrado a nivel de
// usuario, `claude mcp list` lo confirma conectado). En vez de gastar su cuota
// de Claude en cada turno de la entrevista, Claude se usa SOLO para estas dos
// llamadas puntuales por sesión (leer y escribir en mem0) — el trabajo pesado,
// repetido, de cada turno lo hace Gemini (ver runInterviewModelTurn).
async function recallInterviewMemory() {
  const prompt = `Busca en mem0 (search_memories) patrones de errores o feedback de entrevistas de práctica de Cloud Architect guardados anteriormente. Responde SOLO en texto plano, máximo 5 líneas, con los errores recurrentes más relevantes si existen, o la frase exacta "sin historial previo" si no encuentras nada relacionado. No uses ninguna otra tool ni escribas nada más.`;
  // mem0 corre vía `uvx` (self-hosted, ver INTERVIEW_BACKGROUND/CLAUDE.md) —
  // el arranque en frío del entorno uv tarda ~90s, medido corriéndolo de
  // verdad; un timeout de 60s lo mataba a mitad de camino y esto silenciosamente
  // devolvía null cada vez.
  const res = await execCapture(CLAUDE_BIN, ["-p", prompt, "--permission-mode", "dontAsk", "--allowedTools", "mcp__mem0__search_memories"], { timeoutMs: 150000 });
  // No confiar solo en el exit code: confirmado corriéndolo a mano que un hook
  // de SessionEnd de el usuario (session-end-obsidian.sh) falla bajo el PATH
  // recortado de launchd y deja `claude -p` en exit 1 aunque la respuesta en
  // stdout ya sea correcta ("sin historial previo"). Si hay texto, es válido.
  const output = res.out.trim();
  if (!output) {
    console.error(`[interview] recallInterviewMemory sin salida (code ${res.code}): ${(res.err || "").slice(0, 300)}`);
    return null;
  }
  // mem0 (self-hosted, ver CLAUDE.md — "no siempre está sano") a veces
  // responde con su propio error de infraestructura (ej. token OAuth vencido)
  // en vez de un resultado de búsqueda — eso no es una "memoria", es mem0
  // caído. No meterlo en el prompt de la entrevista como si fuera contexto real.
  if (/failed to authenticate|oauth session expired|mcp error|connection refused/i.test(output)) {
    console.error(`[interview] mem0 devolvió un error de infraestructura, no un resultado: ${output.slice(0, 200)}`);
    return null;
  }
  return output.slice(0, 1000);
}

async function saveInterviewMemory(session) {
  const mistakes = session.turns.flatMap((t) => t.mistakes || []);
  if (!mistakes.length) return;
  const focusLabel = INTERVIEW_FOCUS_LABEL[session.focus] || session.focus;
  const date = new Date(session.startedAt).toLocaleDateString("es-PE");
  const topics = (session.studyPlan || []).map((s) => s.topic).join(", ");
  const summary = `Entrevista de práctica Cloud Architect (${focusLabel}, ${date}), veredicto: ${session.verdict || "sin veredicto"}. Errores cometidos: ${mistakes.join(" | ")}.${topics ? ` Temas de estudio recomendados: ${topics}.` : ""}`.replace(/"/g, "'");
  const prompt = `Guarda en mem0 (add_memory) esta memoria tal cual, sin modificarla ni resumirla más: "${summary}". No hagas nada más.`;
  try {
    const res = await execCapture(CLAUDE_BIN, ["-p", prompt, "--permission-mode", "dontAsk", "--allowedTools", "mcp__mem0__add_memory"], { timeoutMs: 150000 });
    if (res.code !== 0) console.error(`[interview] saveInterviewMemory falló (code ${res.code}): ${(res.err || "").slice(0, 300)}`);
  } catch (e) {
    console.error(`[interview] saveInterviewMemory excepción: ${e}`);
  }
}

const INTERVIEW_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    speak: { type: "string" },
    mistakes: { type: "array", items: { type: "string" } },
    verdict: { type: ["string", "null"] },
    done: { type: "boolean" },
    study_plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          why: { type: "string" },
          how_to_study: { type: "string" },
        },
        required: ["topic", "why", "how_to_study"],
      },
    },
    career_guidance: {
      type: ["object", "null"],
      properties: {
        current_level: { type: "string" },
        target_role_now: { type: "string" },
        salary_range_peru_pen: { type: "string" },
        salary_range_remote_usd: { type: "string" },
      },
      required: ["current_level", "target_role_now", "salary_range_peru_pen", "salary_range_remote_usd"],
    },
  },
  required: ["speak", "mistakes", "verdict", "done", "study_plan", "career_guidance"],
});

// Gemini (via `agy`, el CLI de Antigravity — reutiliza el login de Google de
// el usuario, sin API key) hace el turno pesado: tiene grounding de búsqueda nativo
// (confirmado: sabe la fecha real y eventos recientes de AWS sin que se lo
// pidamos explícito) y `--json-schema` le fuerza el shape exacto sin que haga
// falta regex ni parchar caracteres de control — el propio CLI ya entrega
// `structured_output` ya parseado. Si `agy` no está instalado o falla, cae a
// Claude con el parseo por regex + sanitizeJsonControlChars de antes, mismo
// patrón "barato primero, Claude de respaldo" que ya usa runWithFallback.
async function runInterviewModelTurn(session) {
  const onSpawn = (child) => interviewChildren.set(session.id, child);
  const geminiPrompt = buildInterviewTurnPrompt(session, { strictJsonInstruction: false });
  const gemini = await execCapture(AGY_BIN, [
    "-p", geminiPrompt,
    "--model", "gemini-3.1-pro-high",
    "--json-schema", INTERVIEW_JSON_SCHEMA,
    "--output-format", "json",
    "--sandbox",
  ], { timeoutMs: 120000, onSpawn });
  if (gemini.code === 0) {
    try {
      const parsed = JSON.parse(gemini.out);
      const turn = parsed.structured_output;
      if (turn && typeof turn.speak === "string") return { turn, provider: "gemini" };
    } catch {}
  } else {
    console.error(`[interview] agy falló (code ${gemini.code}): ${(gemini.err || "").slice(0, 300)}`);
  }

  if (interviewJobs.get(session.id)?.status === "cancelled") throw new Error("cancelado");

  const claudePrompt = buildInterviewTurnPrompt(session, { strictJsonInstruction: true });
  const claude = await execCapture(CLAUDE_BIN, ["-p", claudePrompt, "--permission-mode", "dontAsk"], { timeoutMs: 90000, onSpawn });
  // Igual que en recallInterviewMemory: un hook de SessionEnd puede dejar
  // exit 1 con stdout perfectamente válido — solo tratar como error real
  // cuando no hay nada que parsear.
  const match = claude.out.match(/\{[\s\S]*\}/);
  if (!match) throw new Error((claude.err || "").slice(0, 500) || `agy y claude fallaron (claude salió con código ${claude.code}, sin JSON en la salida)`);
  const turn = JSON.parse(sanitizeJsonControlChars(match[0]));
  return { turn, provider: "claude-fallback" };
}

async function runInterviewTurn(sessionId) {
  interviewJobs.set(sessionId, { status: "running", error: null });
  try {
    let list = loadInterviews();
    let session = findInterview(list, sessionId);
    if (!session) throw new Error("sesión no encontrada");

    if (session.contextBlock == null) {
      session.contextBlock = await gatherInterviewContext();
      session.memoryContext = await recallInterviewMemory().catch(() => null);
      saveInterviews(list);
    }

    const { turn, provider } = await runInterviewModelTurn(session);
    if (interviewJobs.get(sessionId)?.status === "cancelled") return; // turno cancelado, ignorar resultado tardío

    list = loadInterviews();
    session = findInterview(list, sessionId);
    if (!session) throw new Error("sesión no encontrada al guardar");
    session.turns.push({
      role: "interviewer",
      speak: turn.speak || "",
      mistakes: Array.isArray(turn.mistakes) ? turn.mistakes : [],
      verdict: turn.verdict || null,
      provider,
      at: new Date().toISOString(),
    });
    if (turn.done) {
      session.status = "done";
      session.finishedAt = new Date().toISOString();
      session.verdict = turn.verdict || null;
      session.studyPlan = Array.isArray(turn.study_plan) ? turn.study_plan : [];
      session.careerGuidance = turn.career_guidance || null;
    }
    saveInterviews(list);
    if (turn.done) await saveInterviewMemory(session).catch(() => {});
    interviewJobs.set(sessionId, { status: "done", error: null });
  } catch (e) {
    if (interviewJobs.get(sessionId)?.status === "cancelled") return; // ya cancelado, no pisar ese estado con un error
    interviewJobs.set(sessionId, { status: "error", error: String(e.message || e) });
  } finally {
    interviewChildren.delete(sessionId);
  }
}

async function startInterview(focus) {
  const id = `iv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session = {
    id,
    focus,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "active",
    verdict: null,
    contextBlock: null, // se llena en runInterviewTurn (junto con memoryContext) para no bloquear este POST con la recuperación en mem0
    memoryContext: null,
    turns: [],
  };
  const list = loadInterviews();
  list.unshift(session);
  saveInterviews(list);
  runInterviewTurn(id); // corre en background; el frontend hace polling del job
  return id;
}

function readAccount(profile) {
  try {
    const j = JSON.parse(fs.readFileSync(profile.credsPath, "utf8"));
    const acc = j.oauthAccount;
    if (!acc) return null;
    return {
      accountUuid: acc.accountUuid,
      email: acc.emailAddress,
      org: acc.organizationName,
      isCompany: acc.organizationType === "claude_team",
    };
  } catch {
    return null;
  }
}

async function walk(dir, { skip = new Set([".git", "node_modules"]), maxDepth = 8 } = {}, depth = 0, out = []) {
  if (depth > maxDepth) return out;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, { skip, maxDepth }, depth + 1, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields = {};
  let currentKey = null;
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      const val = m[2].trim();
      fields[currentKey] = val === ">" || val === "|" ? "" : val.replace(/^["']|["']$/g, "");
      continue;
    }
    if (currentKey && /^\s+\S/.test(line)) {
      fields[currentKey] = (fields[currentKey] ? fields[currentKey] + " " : "") + line.trim();
    } else if (!line.trim()) {
      currentKey = null;
    }
  }
  return fields;
}

async function collectSkillsRaw(profile) {
  const seen = new Map();
  const roots = [path.join(profile.home, "skills"), path.join(profile.home, "plugins", "marketplaces")];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = (await walk(root)).filter((f) => f.endsWith("SKILL.md"));
    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, "utf8");
        const fm = parseFrontmatter(content);
        const name = fm.name || path.basename(path.dirname(file));
        if (seen.has(name)) continue;
        const rel = path.relative(profile.home, file);
        const source = rel.startsWith("plugins") ? rel.split(path.sep)[2] || "plugin" : "skills";
        seen.set(name, { name, description: fm.description || "", source });
      } catch {}
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const SKILLS_CACHE = new Map();
async function getSkillsCached(profile) {
  const cached = SKILLS_CACHE.get(profile.key);
  if (cached && Date.now() - cached.ts < SKILLS_CACHE_TTL_MS) return cached.data;
  const data = await collectSkillsRaw(profile);
  SKILLS_CACHE.set(profile.key, { ts: Date.now(), data });
  return data;
}

function projectNameFromDir(dirName) {
  const stripped = dirName.replace(/^-Users-[^-]+-?/, "");
  if (!stripped) return "~";
  const segments = stripped.split("-");
  return segments[segments.length - 1] || stripped;
}

function extractTitle(content) {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) text = content.find((c) => c?.type === "text")?.text || "";
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<") || trimmed.startsWith("[Request interrupted")) return null;
  return trimmed.length > 90 ? trimmed.slice(0, 90) + "…" : trimmed;
}

async function collectProfileRaw(profile) {
  const projectsDir = path.join(profile.home, "projects");
  const raw = { byDayModel: {}, byDayMeta: {}, byHour: Array(24).fill(0), sessions: [] };
  if (!fs.existsSync(projectsDir)) return raw;

  const jsonlFiles = (await walk(projectsDir)).filter((f) => f.endsWith(".jsonl"));
  const seenUsage = new Map();

  for (const file of jsonlFiles) {
    const sessionId = path.basename(file, ".jsonl");
    const projectDir = path.basename(path.dirname(file));
    const session = {
      id: sessionId,
      project: null,
      projectPath: null,
      title: null,
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, fresh: 0, costUSD: 0 },
      byDay: {},
      messageCount: 0,
    };

    const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
    let lineNum = 0;
    for await (const line of rl) {
      lineNum++;
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        console.error(`[collectProfileRaw] línea corrupta en ${file}:${lineNum}: ${e.message}`);
        continue;
      }

      if (obj.type === "user" || obj.type === "assistant") {
        session.messageCount++;
        if (obj.timestamp) raw.byHour[new Date(obj.timestamp).getHours()]++;
      }
      if (obj.type === "user" && !session.title) {
        const title = extractTitle(obj.message?.content);
        if (title) session.title = title;
      }
      if (!session.projectPath && obj.cwd) session.projectPath = obj.cwd;

      const day = (obj.timestamp || "").slice(0, 10);
      if (day) {
        raw.byDayMeta[day] ??= { messageCount: 0, toolCallCount: 0 };
        if (obj.type === "user" || obj.type === "assistant") raw.byDayMeta[day].messageCount++;
        const content = obj.message?.content;
        if (Array.isArray(content) && content.some((c) => c?.type === "tool_use")) {
          raw.byDayMeta[day].toolCallCount++;
        }
      }

      const snapshot = obj.message?.usage;
      if (!snapshot || obj.type !== "assistant" || !day) continue;
      const usage = takeUsageDelta(seenUsage, obj.message?.id, snapshot, { includeCacheTTL: true });

      const model = obj.message.model || "unknown";
      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const fresh = input + output + cacheCreate;
      if (fresh + cacheRead === 0 && !usage.cache1h && !usage.cacheUnknown) continue;

      const cost = estimateCost(model, input, output, cacheCreate, cacheRead, usage.cache1h) || 0;

      raw.byDayModel[day] ??= {};
      raw.byDayModel[day][model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cache1h: 0, cacheUnknown: 0, costUSD: 0 };
      raw.byDayModel[day][model].input += input;
      raw.byDayModel[day][model].output += output;
      raw.byDayModel[day][model].cacheRead += cacheRead;
      raw.byDayModel[day][model].cacheCreate += cacheCreate;
      raw.byDayModel[day][model].cache1h += usage.cache1h;
      raw.byDayModel[day][model].cacheUnknown += usage.cacheUnknown;
      raw.byDayModel[day][model].costUSD += cost;

      session.totals.input += input;
      session.totals.output += output;
      session.totals.cacheRead += cacheRead;
      session.totals.cacheCreate += cacheCreate;
      session.totals.fresh += fresh;
      session.totals.costUSD += cost;
      session.byDay[day] ??= { input: 0, output: 0, cacheRead: 0, fresh: 0 };
      session.byDay[day].input += input;
      session.byDay[day].output += output;
      session.byDay[day].cacheRead += cacheRead;
      session.byDay[day].fresh += fresh;
    }

    if (session.projectPath) {
      if (session.projectPath === HOME) session.project = "~";
      else session.project = path.basename(session.projectPath) || session.projectPath;
    } else {
      session.project = projectNameFromDir(projectDir);
    }

    const projectInfo = await getProjectInfo(session.projectPath);
    if (projectInfo) {
      session.projectDisplayName = projectInfo.displayName;
      session.projectDescription = projectInfo.description;
    }

    if (session.totals.fresh + session.totals.cacheRead > 0) raw.sessions.push(session);
  }

  return raw;
}

const RAW_CACHE = new Map();
async function getProfileRawCached(profile) {
  const cached = RAW_CACHE.get(profile.key);
  if (cached && Date.now() - cached.ts < RAW_CACHE_TTL_MS) return cached.data;
  const data = await collectProfileRaw(profile);
  RAW_CACHE.set(profile.key, { ts: Date.now(), data });
  return data;
}

function cutoffDateStr(days) {
  if (!days) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeAccountView(acc, { fromDay = null, toDay = null } = {}) {
  const usage = {
    totalTokens: 0, freshTokens: 0, inputTokens: 0, outputTokens: 0,
    cacheCreateTokens: 0, cacheReadTokens: 0, messageCount: 0, toolCallCount: 0,
    costUSD: 0, cacheSavingsUSD: 0,
  };
  const byDay = {};
  const byModel = {};
  const byDayActivity = {};

  for (const [day, models] of Object.entries(acc.byDayModel)) {
    if (fromDay && day < fromDay) continue;
    if (toDay && day >= toDay) continue;
    let dayFresh = 0;
    let dayInput = 0;
    let dayOutput = 0;
    let dayCacheCreate = 0;
    let dayCacheRead = 0;
    for (const [model, m] of Object.entries(models)) {
      const fresh = m.input + m.output + m.cacheCreate;
      const total = fresh + m.cacheRead;
      byModel[model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cache1h: 0, cacheUnknown: 0, total: 0, fresh: 0, costUSD: 0 };
      byModel[model].input += m.input;
      byModel[model].output += m.output;
      byModel[model].cacheRead += m.cacheRead;
      byModel[model].cacheCreate += m.cacheCreate;
      byModel[model].cache1h += m.cache1h || 0;
      byModel[model].cacheUnknown += m.cacheUnknown || 0;
      byModel[model].total += total;
      byModel[model].fresh += fresh;
      byModel[model].costUSD += m.costUSD || 0;

      usage.inputTokens += m.input;
      usage.outputTokens += m.output;
      usage.cacheCreateTokens += m.cacheCreate;
      usage.cacheReadTokens += m.cacheRead;
      usage.totalTokens += total;
      usage.freshTokens += fresh;
      usage.costUSD += m.costUSD || 0;
      dayFresh += fresh;
      dayInput += m.input;
      dayOutput += m.output;
      dayCacheCreate += m.cacheCreate;
      dayCacheRead += m.cacheRead;
    }
    byDay[day] = { fresh: dayFresh, input: dayInput, output: dayOutput, cacheCreate: dayCacheCreate, cacheRead: dayCacheRead };
  }

  for (const [day, meta] of Object.entries(acc.byDayMeta)) {
    if (fromDay && day < fromDay) continue;
    if (toDay && day >= toDay) continue;
    usage.messageCount += meta.messageCount;
    usage.toolCallCount += meta.toolCallCount;
    byDayActivity[day] = meta.messageCount;
  }

  // Cache savings: what we saved vs paying input price for all those cache reads
  for (const [model, m] of Object.entries(byModel)) {
    const p = getPricing(model);
    usage.cacheSavingsUSD += m.cacheRead * (p.input - p.cacheRead) / 1e6;
  }

  const sessionCount = acc.sessions.filter((s) =>
    Object.keys(s.byDay).some((day) => (!fromDay || day >= fromDay) && (!toDay || day < toDay))
  ).length;

  return { usage: { ...usage, sessionCount }, byDay, byModel, byDayActivity };
}

function computeInsights(byModel, totalCostUSD, windowDays, totalCacheRead, totalContext) {
  const insights = [];
  const cacheHitRate = totalContext > 0 ? totalCacheRead / totalContext : 0;
  const monthlyFactor = 30 / Math.max(1, windowDays);
  const monthlyRunRate = totalCostUSD * monthlyFactor;

  if (cacheHitRate < 0.8 && totalContext > 50000) {
    let potentialSavings = 0;
    for (const [model, m] of Object.entries(byModel)) {
      const p = getPricing(model);
      const total = m.input + m.cacheRead;
      const missed = Math.max(0, total * 0.9 - m.cacheRead);
      potentialSavings += missed * (p.input - p.cacheRead) / 1e6;
    }
    const monthly = potentialSavings * monthlyFactor;
    if (monthly > 0.1) {
      insights.push({
        id: "low-cache",
        severity: cacheHitRate < 0.5 ? "high" : "medium",
        title: `Cache hit rate: ${(cacheHitRate * 100).toFixed(0)}%`,
        detail: `El ${(cacheHitRate * 100).toFixed(0)}% de tu contexto se sirve desde caché. Llegar al 90% ahorraría ~$${monthly.toFixed(2)}/mes. Causas comunes: gaps de >5 min entre mensajes (la caché expira), /clear frecuentes, o sesiones cortas que no reúsan contexto.`,
        monthly_savings_usd: monthly,
      });
    }
  }

  if (monthlyRunRate > 30) {
    const tiers = [{ name: "Max 20x", monthly: 200 }, { name: "Max 5x", monthly: 100 }];
    const tier = tiers.find((t) => monthlyRunRate > t.monthly * 1.5);
    if (tier) {
      insights.push({
        id: "plan-fit",
        severity: "info",
        title: `Ritmo mensual: $${monthlyRunRate.toFixed(0)}`,
        detail: `Al ritmo actual, un plan ${tier.name} ($${tier.monthly}/mes) costaría ~$${Math.max(0, monthlyRunRate - tier.monthly).toFixed(0)}/mes menos que pagar por API. Si ya tienes suscripción, este número es lo que vale al precio de API.`,
        monthly_savings_usd: Math.max(0, monthlyRunRate - tier.monthly),
      });
    }
  }

  return { cacheHitRate, monthlyRunRate, insights };
}

async function buildPayload({ days, account } = {}) {
  const cutoffDay = cutoffDateStr(days);
  const accountsByUuid = new Map();

  for (const profile of PROFILES) {
    if (!fs.existsSync(profile.home)) continue;
    const raw = await getProfileRawCached(profile);
    const skills = await getSkillsCached(profile);
    const acctInfo = readAccount(profile);
    const uuid = acctInfo?.accountUuid || `unknown-${profile.key}`;

    if (!accountsByUuid.has(uuid)) {
      const i = accountsByUuid.size;
      accountsByUuid.set(uuid, {
        key: uuid,
        email: acctInfo?.email || "(sin cuenta detectada)",
        org: acctInfo?.org || profile.key,
        isCompany: !!acctInfo?.isCompany,
        color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
        configDirs: [],
        byDayModel: {},
        byDayMeta: {},
        byHour: Array(24).fill(0),
        sessions: [],
        skillsMap: new Map(),
      });
    }
    const acc = accountsByUuid.get(uuid);
    acc.configDirs.push(profile.key);

    for (const [day, models] of Object.entries(raw.byDayModel)) {
      acc.byDayModel[day] ??= {};
      for (const [model, m] of Object.entries(models)) {
        acc.byDayModel[day][model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cache1h: 0, cacheUnknown: 0, costUSD: 0 };
        for (const k of ["input", "output", "cacheRead", "cacheCreate", "cache1h", "cacheUnknown", "costUSD"]) acc.byDayModel[day][model][k] += m[k] || 0;
      }
    }
    for (const [day, meta] of Object.entries(raw.byDayMeta)) {
      acc.byDayMeta[day] ??= { messageCount: 0, toolCallCount: 0 };
      acc.byDayMeta[day].messageCount += meta.messageCount;
      acc.byDayMeta[day].toolCallCount += meta.toolCallCount;
    }
    for (let h = 0; h < 24; h++) acc.byHour[h] += raw.byHour?.[h] || 0;
    for (const s of raw.sessions) acc.sessions.push({ ...s, accountKey: uuid });
    for (const skill of skills) if (!acc.skillsMap.has(skill.name)) acc.skillsMap.set(skill.name, skill);
  }

  let accounts = [...accountsByUuid.values()];
  if (account) accounts = accounts.filter((a) => a.key === account);

  // Snapshot before .map() below replaces `accounts` with the current-period
  // view — this raw shape (byDayModel/byDayMeta untouched) is what lets us
  // recompute the same accounts over the previous period for comparison.
  const rawAccountsForComparison = accounts;

  accounts = accounts.map((a) => {
    const view = computeAccountView(a, { fromDay: cutoffDay });
    return {
      key: a.key,
      email: a.email,
      org: a.org,
      isCompany: a.isCompany,
      color: a.color,
      configDirs: a.configDirs,
      usage: view.usage,
      byDay: view.byDay,
      byModel: view.byModel,
      byDayActivity: view.byDayActivity,
      byHour: a.byHour,
      skills: [...a.skillsMap.values()].sort((x, y) => x.name.localeCompare(y.name)),
      sessions: a.sessions,
    };
  });

  const skillsByName = new Map();
  for (const acc of accounts) {
    for (const skill of acc.skills) {
      const entry = skillsByName.get(skill.name) ?? { name: skill.name, description: skill.description, source: skill.source, accounts: [] };
      entry.accounts.push({ key: acc.key, org: acc.org, color: acc.color });
      if (!entry.description && skill.description) entry.description = skill.description;
      skillsByName.set(skill.name, entry);
    }
  }
  const skills = [...skillsByName.values()].sort((a, b) => a.name.localeCompare(b.name));

  const totals = accounts.reduce(
    (acc, a) => {
      acc.totalTokens += a.usage.totalTokens;
      acc.freshTokens += a.usage.freshTokens;
      acc.inputTokens += a.usage.inputTokens;
      acc.outputTokens += a.usage.outputTokens;
      acc.cacheCreateTokens += a.usage.cacheCreateTokens;
      acc.cacheReadTokens += a.usage.cacheReadTokens;
      acc.messageCount += a.usage.messageCount;
      acc.toolCallCount += a.usage.toolCallCount;
      acc.sessionCount += a.usage.sessionCount;
      acc.costUSD += a.usage.costUSD || 0;
      acc.cacheSavingsUSD += a.usage.cacheSavingsUSD || 0;
      return acc;
    },
    { totalTokens: 0, freshTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0, messageCount: 0, toolCallCount: 0, sessionCount: 0, costUSD: 0, cacheSavingsUSD: 0 }
  );
  totals.skillCount = skills.length;

  // Comparison vs. the immediately preceding period of equal length (e.g. for
  // a 30-day view, the 30 days before that). Only meaningful when a range is
  // selected — "all time" has no natural "previous period".
  let previousTotals = null;
  if (days) {
    const prevCutoffDay = cutoffDateStr(days * 2);
    const prevViews = rawAccountsForComparison.map((a) =>
      computeAccountView(a, { fromDay: prevCutoffDay, toDay: cutoffDay })
    );
    previousTotals = prevViews.reduce(
      (acc, v) => {
        acc.totalTokens += v.usage.totalTokens;
        acc.freshTokens += v.usage.freshTokens;
        acc.inputTokens += v.usage.inputTokens;
        acc.outputTokens += v.usage.outputTokens;
        acc.cacheReadTokens += v.usage.cacheReadTokens;
        acc.messageCount += v.usage.messageCount;
        acc.toolCallCount += v.usage.toolCallCount;
        acc.sessionCount += v.usage.sessionCount;
        acc.costUSD += v.usage.costUSD || 0;
        return acc;
      },
      { totalTokens: 0, freshTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, messageCount: 0, toolCallCount: 0, sessionCount: 0, costUSD: 0 }
    );
    const prevContext = previousTotals.inputTokens + previousTotals.cacheReadTokens;
    previousTotals.cacheHitRate = prevContext > 0 ? previousTotals.cacheReadTokens / prevContext : 0;
  }

  const byDay = {};
  for (const a of accounts) {
    for (const [day, vals] of Object.entries(a.byDay)) {
      byDay[day] ??= {};
      byDay[day][a.key] = vals;
    }
  }

  const byModel = {};
  for (const a of accounts) {
    for (const [model, m] of Object.entries(a.byModel)) {
      byModel[model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cache1h: 0, cacheUnknown: 0, total: 0, fresh: 0, costUSD: 0 };
      for (const k of ["input", "output", "cacheRead", "cacheCreate", "cache1h", "cacheUnknown", "total", "fresh", "costUSD"]) byModel[model][k] += m[k] || 0;
    }
  }

  const byDayActivity = {};
  for (const a of accounts) {
    for (const [day, count] of Object.entries(a.byDayActivity || {})) {
      byDayActivity[day] = (byDayActivity[day] || 0) + count;
    }
  }

  const byHour = Array(24).fill(0);
  for (const a of accounts) {
    for (let h = 0; h < 24; h++) byHour[h] += a.byHour?.[h] || 0;
  }

  const sessions = accounts.flatMap((a) =>
    a.sessions.map((s) => ({
      id: s.id,
      project: s.project,
      projectPath: s.projectPath,
      projectDisplayName: s.projectDisplayName,
      projectDescription: s.projectDescription,
      title: s.title,
      messageCount: s.messageCount,
      totals: s.totals,
      byDay: s.byDay,
      accountKey: a.key,
      accountOrg: a.org,
      accountColor: a.color,
    }))
  );

  const { cacheHitRate, monthlyRunRate, insights } = computeInsights(
    byModel, totals.costUSD, days || 90, totals.cacheReadTokens, totals.inputTokens + totals.cacheReadTokens
  );

  const tools = { ...getToolsInfo(), agentmemoryUp: await checkPortUp("http://localhost:3113") };

  return {
    generatedAt: new Date().toISOString(),
    range: { days: days || null, cutoffDay },
    totals,
    previousTotals,
    byDay,
    byDayActivity,
    byHour,
    byModel,
    accounts: accounts.map((a) => ({ ...a, sessions: undefined, byDayActivity: undefined, byHour: undefined })),
    skills,
    sessions,
    modelPalette: MODEL_PALETTE,
    pricingWarnings: Object.keys(byModel).filter((model) => getPricing(model).unknown),
    pricing: pricingCoverage(byModel),
    mcpServers: collectMcpServers(),
    tools,
    insights: { cacheHitRate, monthlyRunRate, items: insights },
  };
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const denied = validateRequest(req, PORT);
    if (denied) { res.writeHead(denied, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Solicitud rechazada: usa la interfaz local del dashboard" })); return; }
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === '/api/kanban' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...kanbanStore.get(), plannerAvailable: process.env.DASHBOARD_DEMO !== '1' && fs.existsSync(CLAUDE_BIN) })); return;
    }
    if (url.pathname === '/api/kanban' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.action === 'create' || (body.action === 'update' && body.task?.project)) resolveProject(LOCAL_GITHUB_DIR, body.task?.project);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(kanbanStore.mutate(body))); return;
    }
    if (url.pathname === '/api/kanban/brief' && req.method === 'GET') {
      const task = kanbanStore.get().tasks.find(t => t.id === url.searchParams.get('id'));
      if (!task) throw Object.assign(new Error('Tarea no encontrada'), { status: 404 });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: taskBrief(task, {baseUrl:`http://${req.headers.host}`}) })); return;
    }
    if (url.pathname === '/api/kanban/plan' && req.method === 'POST') {
      if (process.env.DASHBOARD_DEMO === '1') throw Object.assign(new Error('La demo usa datos de ejemplo y no ejecuta llamadas IA.'), {status:403});
      const body = await readJson(req, 8192);
      resolveProject(LOCAL_GITHUB_DIR, body.project);
      const result = await planTasks({ project: body.project, goal: body.goal, tasks: kanbanStore.get().tasks });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return;
    }

    if (req.method === "POST" && url.searchParams.has("repo")) {
      const root = url.searchParams.get("org") === "personal" ? LOCAL_GITHUB_DIR : url.searchParams.get("org") === "neo" ? NEO_GITHUB_DIR : null;
      resolveProject(root, url.searchParams.get("repo"));
    }
    const aiActions = new Set(["/api/graphify/update", "/api/ideas/generate", "/api/project-status/generate", "/api/project-claude-md/generate", "/api/interview/start", "/api/interview/respond", "/api/interview/finish"]);
    if (process.env.DASHBOARD_DEMO === '1' && req.method === 'POST' && ['/api/radar/settings','/api/radar/refresh','/api/radar/credits/search'].includes(url.pathname)) throw Object.assign(new Error('Las conexiones externas están desactivadas en la demo.'), {status:403});
    if (req.method === "POST" && aiActions.has(url.pathname) && !AI_ENABLED) {
      res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Generadores desactivados. Activa DASHBOARD_ENABLE_AI=1 para enviar contexto a tus proveedores de IA." })); return;
    }
    if (url.pathname === "/api/repo-audit/push" && process.env.DASHBOARD_ENABLE_GIT_WRITE !== "1") {
      res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Push desactivado. Activa DASHBOARD_ENABLE_GIT_WRITE=1 para habilitarlo." })); return;
    }
    if (url.pathname === "/api/repo-audit/delete") {
      res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "El borrado permanente de repositorios está desactivado. Usa tu gestor de archivos." })); return;
    }
    if (url.pathname === "/api/radar" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(radarStore.get())); return;
    }
    if (url.pathname === "/api/radar/settings" && req.method === "POST") {
      const body = await readJson(req, 1024);
      const data = radarStore.configure(body.enabled);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); return;
    }
    if (url.pathname === "/api/radar/refresh" && req.method === "POST") {
      const data = await radarStore.refresh();
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); return;
    }
    if (url.pathname === "/api/radar/credits/search" && req.method === "POST") {
      const data = await radarStore.searchCredits();
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); return;
    }
    if (url.pathname === "/api/radar/cv/pdf" && req.method === "POST") {
      const value = await extractPdfText(req, resolveBin("pdftotext"));
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ text: value })); return;
    }
    if (url.pathname === "/api/radar/mark" && req.method === "POST") {
      const body = await readJson(req, 1024);
      const data = radarStore.mark(body);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); return;
    }
    if (url.pathname === "/api/agents" && req.method === "GET") {
      const days = url.searchParams.get("days");
      if (days && days !== "all" && (!["1", "7", "30"].includes(days))) throw Object.assign(new Error("Rango inválido"), { status: 400 });
      const data = await providerStore.get(days && days !== "all" ? Number(days) : null);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); return;
    }
    if (url.pathname === "/api/agents" && req.method === "POST") {
      const body = await readJsonBody(req);
      providerStore.setEnabled(body.provider, body.enabled);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;
    }

    if (url.pathname === "/api/stats") {
      const days = url.searchParams.get("days");
      if (days && days !== "all" && !["1", "7", "30"].includes(days)) throw Object.assign(new Error("Rango inválido"), { status: 400 });
      const account = url.searchParams.get("account");
      const payload = await buildPayload({
        days: days && days !== "all" ? Number(days) : null,
        account: account && account !== "all" ? account : null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (url.pathname === "/graphify-graph") {
      const targetKey = url.searchParams.get("target") || "personal";
      const target = GRAPHIFY_TARGETS.find((t) => t.key === targetKey);
      const html = target ? graphifyPaths(target).html : null;
      if (!target || !fs.existsSync(html)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`No se encontró el grafo "${targetKey}" — usa el botón "Generar/Actualizar grafo" en el dashboard.`);
        return;
      }
      const data = await fs.promises.readFile(html);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
      return;
    }

    if (url.pathname === "/api/graphify/update" && req.method === "POST") {
      const targetKey = url.searchParams.get("target");
      const result = startGraphifyUpdate(targetKey);
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === "/api/providers" && req.method === "GET") {
      const grokCli = GROK_BIN !== "grok" && fs.existsSync(GROK_BIN);
      const claudeCli = CLAUDE_BIN !== "claude" && fs.existsSync(CLAUDE_BIN);
      let ideasLatest = null, statusLatest = null;
      try { ideasLatest = JSON.parse(fs.readFileSync(IDEAS_FILE, "utf8"))[0] || null; } catch {}
      try { statusLatest = JSON.parse(fs.readFileSync(PROJECT_STATUS_FILE, "utf8")); } catch {}
      const candidates = [
        ideasLatest?.provider && { action: "ideas", provider: ideasLatest.provider, at: ideasLatest.generatedAt },
        statusLatest?.provider && statusLatest?.generatedAt && { action: "estado", provider: statusLatest.provider, at: statusLatest.generatedAt },
      ].filter(Boolean).sort((a, b) => new Date(b.at) - new Date(a.at));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ grokCli, claudeCli, aiEnabled: AI_ENABLED, demo: process.env.DASHBOARD_DEMO === '1', lastGeneration: candidates[0] || null }));
      return;
    }

    if (url.pathname === "/api/ideas" && req.method === "GET") {
      let store = [];
      try { store = JSON.parse(fs.readFileSync(IDEAS_FILE, "utf8")); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ job: ideasJob, entries: store }));
      return;
    }

    if (url.pathname === "/api/ideas/generate" && req.method === "POST") {
      if (ideasJob.status === "running") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "ya hay una generación en curso" }));
        return;
      }
      const customIdea = (url.searchParams.get("idea") || "").trim().slice(0, 500) || null;
      runIdeasGeneration(customIdea);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/project-status" && req.method === "GET") {
      let data = { generatedAt: null, entries: [] };
      try { data = JSON.parse(fs.readFileSync(PROJECT_STATUS_FILE, "utf8")); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ job: projectStatusJob, ...data }));
      return;
    }

    if (url.pathname === "/api/project-status/generate" && req.method === "POST") {
      if (projectStatusJob.status === "running") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "ya hay un análisis en curso" }));
        return;
      }
      runProjectStatusGeneration();
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/project-claude-md/jobs" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Object.fromEntries(claudeMdJobs)));
      return;
    }

    if (url.pathname === "/api/project-claude-md/generate" && req.method === "POST") {
      const org = url.searchParams.get("org");
      const name = url.searchParams.get("repo");
      if (!name || (org !== "personal" && org !== "neo")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "org/repo inválidos" }));
        return;
      }
      const key = `${org}/${name}`;
      if (claudeMdJobs.get(key)?.status === "running") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "ya se está generando para este proyecto" }));
        return;
      }
      runClaudeMdGeneration(org, name);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/project-notes/create" && req.method === "POST") {
      const org = url.searchParams.get("org");
      const name = url.searchParams.get("repo");
      const dir = org === "neo" ? NEO_GITHUB_DIR : org === "personal" ? LOCAL_GITHUB_DIR : null;
      if (!dir || !name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "org/repo inválidos" }));
        return;
      }
      const repoPath = path.join(dir, name);
      if (!fs.existsSync(repoPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "proyecto no encontrado" }));
        return;
      }
      try {
        const claudeDir = path.join(repoPath, ".claude");
        fs.mkdirSync(claudeDir, { recursive: true });
        const notePath = path.join(repoPath, PROJECT_NOTE_RELPATH);
        if (!fs.existsSync(notePath)) fs.writeFileSync(notePath, projectNoteTemplate(name));
        ensureGitignored(repoPath, ".claude/project-notes.md");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
      return;
    }

    if (url.pathname === "/api/interview/sessions" && req.method === "GET") {
      const list = loadInterviews();
      const sessions = list.map((s) => ({
        id: s.id,
        focus: s.focus,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        status: s.status,
        verdict: s.verdict,
        turnCount: s.turns.filter((t) => t.role === "interviewer").length,
        mistakeCount: s.turns.reduce((n, t) => n + (t.mistakes?.length || 0), 0),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    if (url.pathname === "/api/interview/session" && req.method === "GET") {
      const id = url.searchParams.get("id");
      const session = findInterview(loadInterviews(), id);
      if (!session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "sesión no encontrada" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ session, job: interviewJobs.get(id) || { status: "idle" } }));
      return;
    }

    if (url.pathname === "/api/interview/start" && req.method === "POST") {
      const body = await readJsonBody(req);
      const focus = ["aws", "gcp", "azure", "kubernetes", "general"].includes(body.focus) ? body.focus : "general";
      const id = await startInterview(focus);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessionId: id }));
      return;
    }

    if (url.pathname === "/api/interview/respond" && req.method === "POST") {
      const id = url.searchParams.get("id");
      const body = await readJsonBody(req);
      const answer = (body.answer || "").trim().slice(0, 4000);
      if (!id || !answer) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "falta id o respuesta" }));
        return;
      }
      if (interviewJobs.get(id)?.status === "running") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "ya se está procesando un turno" }));
        return;
      }
      const list = loadInterviews();
      const session = findInterview(list, id);
      if (!session || session.status !== "active") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "sesión no encontrada o ya terminada" }));
        return;
      }
      session.turns.push({ role: "candidate", content: answer, at: new Date().toISOString() });
      saveInterviews(list);
      runInterviewTurn(id);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/interview/cancel" && req.method === "POST") {
      const id = url.searchParams.get("id");
      const child = interviewChildren.get(id);
      if (child) { try { child.kill("SIGKILL"); } catch {} }
      interviewChildren.delete(id);
      interviewJobs.set(id, { status: "cancelled", error: null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/interview/delete" && req.method === "POST") {
      const id = url.searchParams.get("id");
      const list = loadInterviews().filter((s) => s.id !== id);
      saveInterviews(list);
      interviewJobs.delete(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/repo-audit" && req.method === "GET") {
      const entries = await scanRepoAudit();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries, jobs: Object.fromEntries(repoJobs) }));
      return;
    }

    if (url.pathname === "/api/repo-audit/push" && req.method === "POST") {
      const org = url.searchParams.get("org");
      const name = url.searchParams.get("repo");
      if (!name || (org !== "personal" && org !== "neo")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "org/repo inválidos" }));
        return;
      }
      const key = `${org}/${name}`;
      if (repoJobs.get(key)?.status === "running") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "ya hay una operación en curso para este repo" }));
        return;
      }
      pushRepoToGitHub(org, name);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Session replay: returns parsed turns for a session ID
    if (url.pathname.startsWith("/api/session/")) {
      const sessionId = decodeURIComponent(url.pathname.slice("/api/session/".length));
      let sessionFile = null;
      for (const profile of PROFILES) {
        if (!fs.existsSync(profile.home)) continue;
        const projectsDir = path.join(profile.home, "projects");
        if (!fs.existsSync(projectsDir)) continue;
        const found = (await walk(projectsDir)).find((f) => path.basename(f, ".jsonl") === sessionId);
        if (found) { sessionFile = found; break; }
      }
      if (!sessionFile) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
      const turns = [];
      const rl2 = readline.createInterface({ input: fs.createReadStream(sessionFile, "utf8"), crlfDelay: Infinity });
      let replayLineNum = 0;
      for await (const line of rl2) {
        replayLineNum++;
        if (!line.trim()) continue;
        try { turns.push(JSON.parse(line)); } catch (e) {
          console.error(`[session replay] línea corrupta en ${sessionFile}:${replayLineNum}: ${e.message}`);
        }
      }
      const display = turns.filter((t) => t.type === "user" || t.type === "assistant").slice(-200);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(display));
      return;
    }

    // GitHub projects: reads CLAUDE.md from every ~/dev/GitHub/<project>/ and ~/dev/Work/<project>/
    if (url.pathname === "/api/projects") {
      const targets = [
        { dir: LOCAL_GITHUB_DIR, org: "personal" },
        { dir: NEO_GITHUB_DIR, org: "neo" },
      ];
      const projects = [];
      for (const { dir, org } of targets) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const repoPath = path.join(dir, entry.name);
          const claudePath = path.join(repoPath, "CLAUDE.md");
          const hasDoc = fs.existsSync(claudePath);
          const hasPrivateNote = fs.existsSync(path.join(repoPath, PROJECT_NOTE_RELPATH));
          let content = null;
          if (hasDoc) {
            try { content = fs.readFileSync(claudePath, "utf8"); } catch {}
          }
          projects.push({ name: entry.name, org, hasDoc, hasPrivateNote, content });
        }
      }
      projects.sort((a, b) => (b.hasDoc ? 1 : 0) - (a.hasDoc ? 1 : 0) || a.name.localeCompare(b.name));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(projects));
      return;
    }

    // History: recent CLI commands from history.jsonl
    if (url.pathname === "/api/history") {
      const entries = [];
      for (const profile of PROFILES) {
        const histFile = path.join(profile.home, "history.jsonl");
        if (!fs.existsSync(histFile)) continue;
        const content = fs.readFileSync(histFile, "utf8");
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try { entries.push({ ...JSON.parse(line), profile: profile.key }); } catch {}
        }
      }
      entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(entries.slice(0, 150)));
      return;
    }

    // Tasks: todo files from todos/ directory
    if (url.pathname === "/api/tasks") {
      const todos = [];
      for (const profile of PROFILES) {
        const todosDir = path.join(profile.home, "todos");
        if (!fs.existsSync(todosDir)) continue;
        let files;
        try { files = fs.readdirSync(todosDir); } catch { continue; }
        for (const file of files) {
          if (!file.endsWith(".json") && !file.endsWith(".jsonl")) continue;
          try {
            const content = fs.readFileSync(path.join(todosDir, file), "utf8");
            const data = JSON.parse(content);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) todos.push({ ...item, profile: profile.key });
          } catch {}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(todos));
      return;
    }

    // Workspace: settings, skills, storage per profile
    if (url.pathname === "/api/workspace") {
      const workspace = {};
      for (const profile of PROFILES) {
        if (!fs.existsSync(profile.home)) continue;
        let settings = {};
        const settingsFile = path.join(profile.home, "settings.json");
        if (fs.existsSync(settingsFile)) {
          try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch {}
        }
        const skills = await getSkillsCached(profile);
        const projectsDir = path.join(profile.home, "projects");
        const storageBytes = fs.existsSync(projectsDir) ? await calcDirSize(projectsDir) : 0;
        const sessionCount = fs.existsSync(projectsDir)
          ? (await walk(projectsDir)).filter((f) => f.endsWith(".jsonl")).length
          : 0;
        workspace[profile.key] = {
          settings: {
            model: settings.model,
            theme: settings.theme,
            statusLine: settings.statusLine
              ? (typeof settings.statusLine === "string"
                  ? settings.statusLine
                  : settings.statusLine.command || settings.statusLine.type || JSON.stringify(settings.statusLine))
              : null,
            enabledPlugins: settings.enabledPlugins || [],
            permissionCount: settings.permissions?.allow?.length || 0,
          },
          skills,
          storageBytes,
          sessionCount,
        };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(workspace));
      return;
    }

    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const publicRoot = path.join(__dirname, "public");
    const fullPath = path.resolve(publicRoot, "." + decodeURIComponent(filePath));
    if (!fullPath.startsWith(publicRoot + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const ext = path.extname(fullPath);
    const data = await fs.promises.readFile(fullPath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    res.writeHead(err.status || (err.code === "ENOENT" ? 404 : 500), { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.status ? err.message : "No se pudo completar la solicitud" }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Espacio local corriendo en http://127.0.0.1:${PORT}`);
});
