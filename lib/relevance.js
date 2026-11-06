// Mem0-driven bonus for Empleos ranking. AWS/Terraform stay in the base
// rank_score from the scraper; this module only adds 0–15 for active mem0
// themes: agents, LLM, evals, GCP. Soft-fails offline (bonus 0).

import { execFileSync } from 'node:child_process';

const THEME_PATTERNS = {
  agents: /\bagents?\b|\bagentes?\b|multi-?agent|langchain|langgraph|copiloto|superagente|tool[- ]use/i,
  llm: /\bllm\b|gpt-?\d|claude|anthropic|openai|gemini|foundation model|modelo de lenguaje/i,
  evals: /\bevals?\b|evaluaci[oó]n|r[uú]brica|benchmark|\bjudge\b|all-?pass/i,
  gcp: /\bgcp\b|google cloud|bigquery|\bgke\b|vertex|cloud run/i,
};

const THEME_LABELS = {
  agents: 'agentes',
  llm: 'LLM',
  evals: 'evals',
  gcp: 'GCP',
};

const THEME_KEYS = Object.keys(THEME_PATTERNS);
const BONUS_PER_THEME = 4;
const BONUS_CAP = 15;
const DEFAULT_CACHE_MS = 3600000;
const DEFAULT_TIMEOUT_MS = 1500;

let cache = null; // { at, value }

export function detectThemesInText(text) {
  const t = String(text ?? '');
  const found = new Set();
  for (const key of THEME_KEYS) {
    if (THEME_PATTERNS[key].test(t)) found.add(key);
  }
  return found;
}

/** @param {Set|Iterable} jobThemes @param {Set|Iterable|object} activeThemes */
export function computeBonus(jobThemes, activeThemes) {
  const job = jobThemes instanceof Set ? jobThemes : new Set(jobThemes || []);
  let active;
  if (activeThemes instanceof Set) active = activeThemes;
  else if (activeThemes && typeof activeThemes === 'object' && !Array.isArray(activeThemes)) {
    active = new Set(THEME_KEYS.filter(k => activeThemes[k]));
  } else {
    active = new Set(activeThemes || []);
  }
  let hits = 0;
  const matched = [];
  for (const key of THEME_KEYS) {
    if (active.has(key) && job.has(key)) {
      hits += 1;
      matched.push(key);
    }
  }
  const bonus = Math.min(BONUS_CAP, hits * BONUS_PER_THEME);
  if (!bonus) return { bonus: 0, reason: null, matched: [] };
  const reason = `mem0: ${matched.map(k => THEME_LABELS[k]).join(' + ')}`;
  return { bonus, reason, matched };
}

function payloadText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const raw = payload.data ?? payload.memory ?? payload.text ?? payload.content ?? '';
  return typeof raw === 'string' ? raw : '';
}

function emptyThemes(source) {
  return {
    themes: { agents: false, llm: false, evals: false, gcp: false },
    source,
    updatedAt: new Date().toISOString(),
  };
}

function themesFromPoints(points) {
  const blob = (points || []).map(p => payloadText(p?.payload)).join('\n');
  const found = detectThemesInText(blob);
  return Object.fromEntries(THEME_KEYS.map(k => [k, found.has(k)]));
}

function scrollUrl(qdrantUrl, collection) {
  return `${String(qdrantUrl).replace(/\/$/, '')}/collections/${encodeURIComponent(collection)}/points/scroll`;
}

/**
 * Scroll mem0 Qdrant collection and mark which of the four themes appear
 * in at least one memory. Process-local cache for cacheMs (default 1h).
 * Network/timeout failures → themes all false, source 'offline', no throw.
 */
export async function fetchMem0Themes({
  qdrantUrl = 'http://127.0.0.1:6333',
  collection = 'mem0_mcp_selfhosted',
  limit = 80,
  cacheMs = DEFAULT_CACHE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const now = Date.now();
  if (cache && now - cache.at < cacheMs) {
    return { ...cache.value, source: 'cache' };
  }
  const url = scrollUrl(qdrantUrl, collection);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, with_payload: true, with_vector: false }),
      signal: ctrl?.signal,
    });
    if (!res.ok) {
      const offline = emptyThemes('offline');
      if (!cache) cache = { at: now, value: offline };
      return offline;
    }
    const body = await res.json();
    const points = body?.result?.points ?? body?.points ?? [];
    const value = { themes: themesFromPoints(points), source: 'mem0', updatedAt: new Date().toISOString() };
    cache = { at: now, value };
    return value;
  } catch {
    const offline = emptyThemes('offline');
    if (!cache) cache = { at: now, value: offline };
    return offline;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sync twin for jobsearch.get() (keeps the HTTP handler sync). Shares the
 * same process cache as fetchMem0Themes. Uses curl with a short timeout.
 */
export function fetchMem0ThemesSync({
  qdrantUrl = 'http://127.0.0.1:6333',
  collection = 'mem0_mcp_selfhosted',
  limit = 80,
  cacheMs = DEFAULT_CACHE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const now = Date.now();
  if (cache && now - cache.at < cacheMs) {
    return { ...cache.value, source: 'cache' };
  }
  const url = scrollUrl(qdrantUrl, collection);
  const payload = JSON.stringify({ limit, with_payload: true, with_vector: false });
  try {
    const out = execFileSync('curl', [
      '-sS', '-m', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '-H', 'Content-Type: application/json',
      '-d', payload,
      url,
    ], { encoding: 'utf8', timeout: timeoutMs + 500, maxBuffer: 8 * 1024 * 1024 });
    const body = JSON.parse(out);
    const points = body?.result?.points ?? body?.points ?? [];
    const value = { themes: themesFromPoints(points), source: 'mem0', updatedAt: new Date().toISOString() };
    cache = { at: now, value };
    return value;
  } catch {
    const offline = emptyThemes('offline');
    if (!cache) cache = { at: now, value: offline };
    return offline;
  }
}

/** Clear process cache (tests). */
export function clearMem0ThemesCache() {
  cache = null;
}

/**
 * @param {object} job - title/company/strengths/gaps (+ location/portal optional)
 * @param {object} themesState - return of fetchMem0Themes (or { themes })
 */
export function scoreJobBonus(job, themesState) {
  const themes = themesState?.themes || {};
  const active = new Set(THEME_KEYS.filter(k => themes[k]));
  if (!active.size) return { bonus: 0, reason: null };
  const parts = [
    job?.title, job?.company,
    ...(Array.isArray(job?.strengths) ? job.strengths : []),
    ...(Array.isArray(job?.gaps) ? job.gaps : []),
    job?.location, job?.portal,
  ];
  const jobThemes = detectThemesInText(parts.filter(Boolean).join(' ').toLowerCase());
  const { bonus, reason } = computeBonus(jobThemes, active);
  return { bonus, reason };
}

export const MEM0_THEME_KEYS = THEME_KEYS;
export const MEM0_BONUS_CAP = BONUS_CAP;
