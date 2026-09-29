import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { codexBaseReference, CODEX_REFERENCE } from "./pricing.js";

const count = (n) => Number.isFinite(n) && n >= 0 ? n : 0;
const date = (value) => {
  if (value == null) return null;
  if (typeof value === "object" && value.seconds != null) value = Number(value.seconds) * 1000;
  const d = new Date(value);
  return Number.isFinite(d.valueOf()) ? d.toISOString() : null;
};
const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, total: 0 });
const add = (target, values) => {
  for (const key of ["input", "output", "cacheRead", "total"]) target[key] += count(values[key]);
};
const tokens = (input, output, cacheRead) => {
  input = count(input); output = count(output); cacheRead = Math.min(input, count(cacheRead));
  return { input: input - cacheRead, output, cacheRead, total: input + output };
};

const measuredNumber = (n) => Number.isFinite(n) && n >= 0;
const tickUSD = (n) => measuredNumber(n) ? n / 1e10 : null;
function usageEvent(session, at, model, value, costUSD = null) {
  session.events.push({ at, model, tokens: value, costUSD, referenceUSD: session.provider === "codex" ? codexBaseReference(model, value) : null });
  session.byDay[at.slice(0, 10)] ??= emptyTokens();
  add(session.byDay[at.slice(0, 10)], value);
  session.tokens ??= emptyTokens();
  add(session.tokens, value);
}
export function normalizeQuota(raw, at, sessionId, project) {
  if (!raw || !at) return null;
  const window = (w) => w && measuredNumber(w.used_percent) ? { usedPercent: Math.min(100, w.used_percent), windowMinutes: measuredNumber(w.window_minutes) ? w.window_minutes : null, resetsAt: measuredNumber(w.resets_at) ? date(w.resets_at * 1000) : null } : null;
  const primary = window(raw.primary), secondary = window(raw.secondary);
  if (!primary && !secondary) return null;
  return { observedAt: at, sessionId, project, plan: typeof raw.plan_type === "string" ? raw.plan_type : null, primary, secondary };
}

export function parseCodex(records, fallbackId = "session") {
  const session = { id: `codex:${fallbackId}`, provider: "codex", project: null, model: "sin modelo", startedAt: null, lastAt: null, messages: 0, tools: 0, byDay: {}, tokens: null, events: [], activity: [], models: [], quota: null };
  let previous = { input: 0, output: 0, cacheRead: 0 };
  for (const record of records) {
    const p = record.payload || {};
    const at = date(record.timestamp);
    if (at) { session.startedAt ||= at; session.lastAt = at; }
    if (record.type === "session_meta") { session.id = `codex:${p.id || p.session_id || fallbackId}`; session.project = p.cwd || null; }
    if (record.type === "turn_context") { session.model = p.model || session.model; session.project ||= p.cwd; if (p.model && !session.models.includes(p.model)) session.models.push(p.model); }
    const message = record.type === "response_item" && p.type === "message" && ["user", "assistant"].includes(p.role) ? 1 : 0;
    const tool = record.type === "response_item" && ["function_call", "custom_tool_call"].includes(p.type) ? 1 : 0;
    session.messages += message; session.tools += tool;
    if (at && (message || tool)) session.activity.push({ at, messages: message, tools: tool });
    const quota = p.type === "token_count" ? normalizeQuota(p.rate_limits, at, session.id, session.project) : null;
    if (quota && (!session.quota || at >= session.quota.observedAt)) session.quota = quota;
    const total = p.type === "token_count" && p.info?.total_token_usage;
    if (!total || !at || !measuredNumber(total.input_tokens) || !measuredNumber(total.output_tokens)) continue;
    const current = { input: count(total.input_tokens), output: count(total.output_tokens), cacheRead: count(total.cached_input_tokens) };
    // token_count repeats the running total. Keep the monotonic high-water mark;
    // repeated notifications and stale snapshots must never count as new usage.
    const delta = Object.fromEntries(Object.keys(previous).map((k) => [k, Math.max(0, current[k] - previous[k])]));
    previous = Object.fromEntries(Object.keys(previous).map((k) => [k, Math.max(previous[k], current[k])]));
    if (delta.input + delta.output > 0 || session.tokens === null) usageEvent(session, at, session.model, tokens(delta.input, delta.output, delta.cacheRead));
  }
  return session;
}

export function parseGrok(usage, summary = {}, fallbackId = "session") {
  const session = { id: `grok:${usage?.sessionId || summary.info?.id || fallbackId}`, provider: "grok", project: summary.info?.cwd || null, model: usage?.session?.primaryModelId || summary.current_model_id || "sin modelo", startedAt: date(summary.created_at), lastAt: date(summary.last_active_at || summary.updated_at || usage?.updatedAt), messages: count(summary.num_chat_messages), tools: null, byDay: {}, tokens: null, events: [], activity: [], models: [], quota: null };
  // The session total and the turn totals describe the same usage. Read turns
  // once (deduped by turnNumber), never add both. xAI defines 1 USD = 1e10 ticks.
  const turns = new Map();
  for (const [index, turn] of (Array.isArray(usage?.turns) ? usage.turns : []).entries()) turns.set(turn.turnNumber ?? turn.endedAt ?? index, turn);
  for (const turn of turns.values()) {
    const at = date(turn.endedAt);
    if (!at || !measuredNumber(turn.inputTokens) || !measuredNumber(turn.outputTokens)) continue;
    const modelUsage = Object.entries(turn.modelUsage || {});
    const attributed = modelUsage.length && modelUsage.every(([, m]) => measuredNumber(m.inputTokens) && measuredNumber(m.outputTokens)) && modelUsage.reduce((n, [, m]) => n + m.inputTokens + m.outputTokens, 0) === turn.inputTokens + turn.outputTokens;
    const pieces = attributed ? modelUsage : [[turn.primaryModelId || session.model, turn]];
    for (const [model, m] of pieces) {
      if (!session.models.includes(model)) session.models.push(model);
      usageEvent(session, at, model, tokens(m.inputTokens, m.outputTokens, m.cachedReadTokens), tickUSD(m.costUsdTicks));
    }
    if (attributed && pieces.every(([, m]) => !measuredNumber(m.costUsdTicks)) && measuredNumber(turn.costUsdTicks)) session.events.push({ at, model: "sin atribución de costo", tokens: null, costUSD: tickUSD(turn.costUsdTicks), referenceUSD: null });
    session.lastAt = !session.lastAt || at > session.lastAt ? at : session.lastAt;
  }
  return session;
}

export function parseAgy(records, id, metadata = {}) {
  const session = { id: `agy:${id}`, provider: "agy", project: null, model: "no registrado", startedAt: null, lastAt: date(metadata.last_modified_time), messages: 0, tools: 0, byDay: {}, tokens: null, events: [], activity: [], models: [], quota: null };
  const seen = new Set();
  for (const r of records) {
    if (r.step_index != null && seen.has(r.step_index)) continue;
    if (r.step_index != null) seen.add(r.step_index);
    const at = date(r.created_at);
    if (at) { session.startedAt ||= at; if (!session.lastAt || at > session.lastAt) session.lastAt = at; }
    const message = ["USER_INPUT", "PLANNER_RESPONSE"].includes(r.type) ? 1 : 0;
    const tool = Array.isArray(r.tool_calls) ? r.tool_calls.length : 0;
    session.messages += message; session.tools += tool;
    if (at && (message || tool)) session.activity.push({ at, messages: message, tools: tool });
  }
  return session;
}

async function walk(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (["node_modules", ".git", "browser", "terminal", "media"].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await walk(f, depth + 1, out);
    else if (e.isFile()) out.push(f); // No symlink traversal or credential reads.
  }
  return out;
}

async function json(file) {
  try { return JSON.parse(await fs.promises.readFile(file, "utf8")); } catch { return null; }
}
async function* jsonl(file, diagnostics) {
  const lines = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); } catch { diagnostics.corruptLines++; }
    }
  } catch { diagnostics.unreadableFiles++; }
}
// Parsers retain only counters/metadata, not prompts, answers or credentials.
async function records(file, diagnostics) {
  const rows = [];
  for await (const r of jsonl(file, diagnostics)) {
    if (r.type === "response_item") rows.push({ type: r.type, timestamp: r.timestamp, payload: { type: r.payload?.type, role: r.payload?.role } });
    else if (["session_meta", "turn_context", "event_msg"].includes(r.type)) rows.push({ type: r.type, timestamp: r.timestamp, payload: { id: r.payload?.id, session_id: r.payload?.session_id, cwd: r.payload?.cwd, model: r.payload?.model, type: r.payload?.type, info: r.payload?.info, rate_limits: r.payload?.rate_limits } });
    else rows.push({ type: r.type, created_at: r.created_at, step_index: r.step_index, tool_calls: r.tool_calls?.map(() => ({})) });
  }
  return rows;
}

// All token/cost/activity buckets use exact event timestamps; the recent-session
// table deliberately retains lifetime totals and labels that different scope.
export function summarizeProvider(allSessions, cutoff = null) {
  const inside = (at) => at && (!cutoff || new Date(at).valueOf() >= cutoff);
  const sessions = allSessions.filter((s) => !cutoff || inside(s.lastAt));
  const bucket = () => ({ ...emptyTokens(), measured: false, costUSD: null, referenceUSD: null, unpricedTokens: 0, messages: 0, tools: 0, ids: new Set() });
  const total = bucket(), byModel = new Map(), byProject = new Map(), byDay = new Map();
  let measuredSessions = 0, costSessions = 0;
  const take = (map, key) => { if (!map.has(key)) map.set(key, bucket()); return map.get(key); };
  const contribute = (b, s, e) => {
    b.ids.add(s.id);
    if (e.tokens) { add(b, e.tokens); b.measured = true; }
    if (e.costUSD != null) b.costUSD = (b.costUSD ?? 0) + e.costUSD;
    if (e.referenceUSD != null) b.referenceUSD = (b.referenceUSD ?? 0) + e.referenceUSD;
    else if (s.provider === "codex") b.unpricedTokens += e.tokens?.total || 0;
  };
  for (const s of sessions) {
    const project = s.project || "Sin proyecto registrado";
    take(byProject, project).ids.add(s.id);
    const events = s.events.filter((e) => inside(e.at));
    if (events.some((e) => e.tokens)) measuredSessions++;
    if (events.some((e) => e.costUSD != null)) costSessions++;
    for (const e of events) {
      for (const b of [total, take(byModel, e.model), take(byProject, project), take(byDay, e.at.slice(0, 10))]) contribute(b, s, e);
    }
    for (const a of s.activity.filter((a) => inside(a.at))) {
      for (const b of [total, take(byProject, project), take(byDay, a.at.slice(0, 10))]) { b.messages += a.messages; b.tools += a.tools; b.ids.add(s.id); }
    }
  }
  const output = (b) => ({ tokens: b.measured ? Object.fromEntries(Object.keys(emptyTokens()).map((k) => [k, b[k]])) : null, costUSD: b.costUSD, referenceUSD: b.referenceUSD, unpricedTokens: b.unpricedTokens, messages: b.messages, tools: b.tools, sessionCount: b.ids.size });
  const quota = allSessions.map((s) => s.quota).filter(Boolean).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] || null;
  return {
    tokens: output(total).tokens, costUSD: total.costUSD, referenceUSD: total.referenceUSD, unpricedTokens: total.unpricedTokens,
    measuredSessions, costSessions, sessionCount: sessions.length, messages: total.messages, tools: total.tools, quota,
    observedModels: [...new Set(sessions.flatMap((s) => s.models))].sort(),
    byModel: [...byModel].map(([model, b]) => ({ model, ...output(b) })).sort((a, b) => (b.tokens?.total || 0) - (a.tokens?.total || 0)),
    byProject: [...byProject].map(([project, b]) => ({ project, ...output(b) })).sort((a, b) => b.sessionCount - a.sessionCount),
    byDay: [...byDay].map(([day, b]) => ({ day, ...output(b) })).sort((a, b) => a.day.localeCompare(b.day)),
    sessions: [...sessions].sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || "")).slice(0, 24).map((s) => ({ id: s.id, provider: s.provider, project: s.project, model: s.model, models: s.models, startedAt: s.startedAt, lastAt: s.lastAt, messages: s.messages, tools: s.tools, tokens: s.tokens, costUSD: s.events.filter((e) => e.costUSD != null).reduce((n, e) => (n ?? 0) + e.costUSD, null), referenceUSD: s.events.filter((e) => e.referenceUSD != null).reduce((n, e) => (n ?? 0) + e.referenceUSD, null), tokensScope: "session" })),
  };
}

export function createProviderStore({ home, dataDir }) {
  const definitions = [
    { id: "codex", name: "Codex", root: process.env.CODEX_HOME || path.join(home, ".codex"), relative: "sessions", command: "codex", detail: "App y CLI: tokens, caché y sesiones locales." },
    { id: "grok", name: "Grok", root: process.env.GROK_HOME || path.join(home, ".grok"), relative: "sessions", command: "grok", detail: "CLI: uso por turno y actividad de sesiones." },
    { id: "agy", name: "AGY", root: process.env.AGY_HOME || path.join(home, ".gemini", "antigravity-cli"), relative: "brain", command: "agy", detail: "Antigravity CLI: sesiones y actividad; tokens no registrados." },
  ];
  const configFile = path.join(dataDir, "providers.json");
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configFile, "utf8")); } catch {}
  const cache = new Map();

  async function collect(def) {
    const cached = cache.get(def.id);
    if (cached && Date.now() - cached.at < 8000) return cached.value;
    const diagnostics = { corruptLines: 0, unreadableFiles: 0 };
    const files = await walk(path.join(def.root, def.relative));
    const sessions = new Map();
    if (def.id === "codex") {
      for (const file of files.filter((f) => path.basename(f).startsWith("rollout-") && f.endsWith(".jsonl"))) {
        const s = parseCodex(await records(file, diagnostics), path.basename(file, ".jsonl"));
        const old = sessions.get(s.id);
        if (!old || (s.tokens?.total || 0) > (old.tokens?.total || 0)) sessions.set(s.id, s);
      }
    } else if (def.id === "grok") {
      for (const file of files.filter((f) => path.basename(f) === "summary.json")) {
        const summary = await json(file);
        if (!summary) { diagnostics.unreadableFiles++; continue; }
        const usage = await json(path.join(path.dirname(file), "usage.json"));
        const s = parseGrok(usage, summary, path.basename(path.dirname(file)));
        sessions.set(s.id, s);
      }
    } else {
      const metadata = await json(path.join(def.root, "cache", "conversation_metadata.json"));
      // Read transcript.jsonl OR its full counterpart, never both.
      const dirs = new Set(files.filter((f) => /\/transcript(_full)?\.jsonl$/.test(f)).map((f) => path.dirname(f)));
      for (const dir of dirs) {
        const id = path.relative(path.join(def.root, def.relative), dir).split(path.sep)[0];
        const file = files.includes(path.join(dir, "transcript_full.jsonl")) ? path.join(dir, "transcript_full.jsonl") : path.join(dir, "transcript.jsonl");
        const s = parseAgy(await records(file, diagnostics), id, metadata?.conversations?.[id]);
        sessions.set(s.id, s);
      }
    }
    const value = { sessions: [...sessions.values()], diagnostics };
    cache.set(def.id, { at: Date.now(), value });
    return value;
  }

  return {
    setEnabled(id, enabled) {
      if (!definitions.some((d) => d.id === id) || typeof enabled !== "boolean") throw Object.assign(new Error("Proveedor o estado inválido"), { status: 400 });
      const next = { ...config, [id]: enabled };
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const temp = `${configFile}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(temp, configFile);
      config = next;
      cache.delete(id);
    },
    async get(days = null) {
      const cutoff = days ? Date.now() - days * 86400000 : null;
      const providers = await Promise.all(definitions.map(async (def) => {
        const enabled = config[def.id] === true;
        const available = fs.existsSync(path.join(def.root, def.relative));
        const data = enabled && available ? await collect(def) : { sessions: [], diagnostics: {} };
        return { id: def.id, name: def.name, command: def.command, detail: def.detail, enabled, available, source: path.join(def.root, def.relative), ...summarizeProvider(data.sessions, cutoff), reference: def.id === "codex" ? CODEX_REFERENCE : null, costSource: def.id === "grok" ? "https://docs.x.ai/developers/cost-tracking" : null, activityAvailable: def.id !== "grok", diagnostics: data.diagnostics };
      }));
      return { generatedAt: new Date().toISOString(), days, providers, note: "Uso local del rango, costos registrados parciales y referencia API base, nunca facturas. Cuotas: último estado observado, independiente del rango. Sesiones recientes: toda su duración." };
    },
  };
}
