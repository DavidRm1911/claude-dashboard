import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Read-only view over an ai-job-search workspace (job_scraper/seen_jobs.json +
// job_search_tracker.csv) plus one writable file, job_scraper/decisions.json,
// where David's "postular / descartar" choices live. Choosing "postular" also
// files a kanban task for Claude; nothing here drafts or submits anything.

export const DECISIONS = ['postular', 'descartar', 'pendiente'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

// Recurring gaps, grouped into things David can actually work on.
const GAP_GROUPS = [
  ['Años de experiencia exigidos', /\bstretch\b|\byears?\b|\baños\b/i, 'Se compensa con proyectos visibles y métricas; no con más certificados.'],
  ['Título universitario completo', /degree|bachelor|título/i, 'Se resuelve al egresar en dic-2026; menciona la fecha.'],
  ['LangChain / LangGraph', /langchain|langgraph/i, 'Un agente pequeño en LangGraph con evals publicado en GitHub.'],
  ['Guardias formales y SLOs', /on-?call|slo\b|error budget|follow-the-sun/i, 'Ya tienes operación en producción bajo SLA en Manantial: cuéntalo como incidentes resueltos y define SLOs en un proyecto propio.'],
  ['Operación de bases de datos (PostgreSQL/Aurora)', /postgres|aurora|mongo|documentdb|mssql|mysql|database/i, 'Tu brecha real (poca operación de BD). EcoMovil ya usa RDS PostgreSQL/MySQL: súmale un lab de failover, réplicas y backups con Terraform.'],
  ['GitOps / ArgoCD', /argocd|gitops/i, 'Desplegar en EKS con ArgoCD desde un repo propio.'],
  ['Ansible / Pulumi', /ansible|pulumi|puppet|chef/i, 'Playbook de Ansible para hardening; menor prioridad.'],
  ['Jenkins / GitLab CI', /jenkins|gitlab|drone/i, 'Un pipeline equivalente en GitLab CI basta para mencionarlo.'],
  ['Terragrunt / OpenTofu', /terragrunt|opentofu/i, 'Migrar uno de tus módulos Terraform a OpenTofu + Terragrunt (1 día).'],
  ['Go / Java / Node como lenguaje', /\bgo\b|golang|\bjava\b|node\.?js|typescript/i, 'Go básico para tooling cloud es lo más rentable.'],
  ['Seguridad operativa a escala (Control Tower, SCPs, Security Hub)', /control tower|scp|security hub|guardduty|network firewall|transit gateway|privatelink/i, 'Landing zone propia con Control Tower + remediación automática.'],
  ['Compliance (SOC 2, PCI, ITIL)', /soc ?2|pci|itil|nist|fedramp|compliance/i, 'Saber explicar controles; no requiere certificación.'],
  ['Experiencia GCP en producción', /gcp experience|months on gcp|gke cluster/i, 'Se acumula en Neo; mostrar los proyectos GCP en el portafolio.'],
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(Boolean)) rows.push(row); row = []; }
    else field += c;
  }
  if (field || row.length) { row.push(field); if (row.some(Boolean)) rows.push(row); }
  const [head = [], ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}


const REMOTE_LOC = /remote|remoto|anywhere|worldwide|\bworld\b|global|latam|latin america|work from anywhere/i;
const REMOTE_PORTALS = new Set(['remote-boards-search', 'freehire-search']);
/** Heurística: location remota, o portal remoto con location vacía/global. */
export function jobIsRemote(job) {
  const loc = String(job?.location ?? '').trim();
  if (REMOTE_LOC.test(loc)) return true;
  if (REMOTE_PORTALS.has(job?.portal) && (!loc || /^(global|worldwide|anywhere|n\/?a|-)?$/i.test(loc))) return true;
  return false;
}

export function aggregateGaps(jobs) {
  const pool = jobs.filter(j => (j.score ?? 0) >= 60);
  const out = GAP_GROUPS.map(([label, re, action]) => {
    const hits = pool.filter(j => j.gaps.some(g => re.test(g)));
    return { label, action, count: hits.length, examples: hits.slice(0, 3).map(j => `#${j.ref} ${j.company}`) };
  }).filter(g => g.count > 0).sort((a, b) => b.count - a.count);
  return { considered: pool.length, groups: out };
}

export function createJobSearchStore({ repoDir, kanbanStore, kanbanProject }) {
  const stateFile = path.join(repoDir, 'job_scraper', 'seen_jobs.json');
  const decisionsFile = path.join(repoDir, 'job_scraper', 'decisions.json');
  const trackerFile = path.join(repoDir, 'job_search_tracker.csv');
  const runsDir = path.join(repoDir, 'job_scraper', 'pipeline_runs');

  function decisions() { return readJson(decisionsFile, { schema: 1, decisions: {} }); }

  function get() {
    if (!fs.existsSync(stateFile)) return { available: false, repoDir };
    const seen = readJson(stateFile, { seen: {} }).seen || {};
    const decided = decisions().decisions;
    const tracker = fs.existsSync(trackerFile) ? parseCsv(fs.readFileSync(trackerFile, 'utf8')) : [];
    const applied = new Set(tracker.map(r => `${(r.company || '').toLowerCase()}|${(r.role || '').toLowerCase()}`));
    const entries = Object.entries(seen).filter(([, e]) => e && typeof e === 'object');
    const limaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
    const dayMs = d => Date.parse(`${d}T00:00:00Z`);
    const deadlineDays = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(dayMs(d)) ? Math.round((dayMs(d) - dayMs(limaToday)) / 86400000) : null);
    const allRanked = entries
      .filter(([, e]) => e.status === 'ranked' && Number.isInteger(e.ref))
      .map(([key, e]) => ({
        key, ref: e.ref, score: e.rank_score ?? null, verdict: e.rank_verdict ?? null,
        title: e.title, company: e.company, location: e.location, url: e.url, portal: e.portal,
        posted: e.posted_date ?? null, deadline: e.deadline ?? null,
        locationVerdict: e.location_verdict ?? null, languageGate: e.language_gate ?? null,
        strengths: Array.isArray(e.strengths) ? e.strengths : [], gaps: Array.isArray(e.gaps) ? e.gaps : [],
        stretch: (e.gaps || []).some(g => /^(stretch|senior)/i.test(g)),
        applied: applied.has(`${(e.company || '').toLowerCase()}|${(e.title || '').toLowerCase()}`),
        decision: decided[key]?.decision ?? 'pendiente', taskId: decided[key]?.taskId ?? null,
      }))
      .map(j => { const d = deadlineDays(j.deadline); return { ...j, isRemote: jobIsRemote(j), closingSoon: d !== null && d >= 0 && d <= 7, _days: d }; });
    const live = allRanked.filter(j => j._days === null || j._days >= 0);
    const expiredHidden = allRanked.length - live.length;
    // Best score wins; tie → lower ref. Same normalized URL or same (company, title) is a duplicate.
    const norm = s => String(s ?? '').trim().toLowerCase();
    const urlKey = u => { const k = norm(u).split(/[?#]/)[0].replace(/\/+$/, ''); return k || null; };
    const better = (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.ref - b.ref;
    const kept = [];
    const byUrl = new Map(), byName = new Map();
    for (const j of [...live].sort(better)) {
      const uk = urlKey(j.url), nk = `${norm(j.company)}|${norm(j.title)}`;
      if ((uk && byUrl.has(uk)) || byName.has(nk)) continue;
      if (uk) byUrl.set(uk, j);
      byName.set(nk, j);
      kept.push(j);
    }
    const duplicatesHidden = live.length - kept.length;
    const jobs = kept.map(({ _days, ...j }) => j);
    const today = new Date().toISOString().slice(0, 10);
    const count = s => entries.filter(([, e]) => e.status === s).length;
    let lastRun = null;
    try {
      const runs = fs.readdirSync(runsDir).filter(f => /^\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/.test(f)).sort();
      if (runs.length) lastRun = readJson(path.join(runsDir, runs.at(-1)), null);
    } catch {}
    const lastRankDate = entries.reduce((m, [, e]) => (typeof e.rank_date === 'string' && e.rank_date > m ? e.rank_date : m), '') || null;
    let lastRankRun = null;
    try {
      const ranks = fs.readdirSync(runsDir).filter(f => /^rank_\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/.test(f)).sort();
      const r = ranks.length ? readJson(path.join(runsDir, ranks.at(-1)), null) : null;
      if (r) lastRankRun = { run_at: r.run_at, ok: r.ok, exit_code: r.exit_code, rank_limit: r.rank_limit, new_total: r.new_total };
    } catch {}
    const ageDays = lastRankDate ? Math.floor((Date.parse(limaToday) - Date.parse(lastRankDate.slice(0, 10))) / 86400000) : null;
    const ranking = { lastRankDate, lastRankRun, stale: (ageDays ?? 0) > 2 || lastRankRun?.ok === false, ageDays };
    const open = jobs.filter(j => j.decision !== 'descartar' && j.locationVerdict !== 'FAIL' && j.languageGate !== 'FAIL' && !j.applied);
    return {
      available: true, updatedAt: fs.statSync(stateFile).mtime.toISOString(),
      stats: {
        ranked: jobs.length, duplicatesHidden, expiredHidden, open: open.length, high: open.filter(j => (j.score ?? 0) >= 70).length,
        backlog: count('new') + count('unreachable'), newToday: entries.filter(([, e]) => e.status === 'new' && e.first_seen === today).length,
        filtered: count('skipped'), seenTotal: entries.length,
        toApply: jobs.filter(j => j.decision === 'postular').length,
        drafted: tracker.filter(r => r.status === 'drafted').length, applied: tracker.filter(r => r.status === 'applied').length,
      },
      lastRun: lastRun && { at: lastRun.run_at, fetched: lastRun.fetched, new: lastRun.new, skipped: lastRun.skipped, portals: lastRun.portals },
      ranking, jobs, gaps: aggregateGaps(open),
      tracker: tracker.map(r => ({ company: r.company, role: r.role, status: r.status, fit: r.fit_rating, date: r.date, source: r.source })),
    };
  }

  function decide(body) {
    if (!body || typeof body.key !== 'string' || body.key.length > 300) fail('Oferta inválida');
    if (!DECISIONS.includes(body.decision)) fail('Decisión inválida');
    const seen = readJson(stateFile, { seen: {} }).seen || {};
    const job = seen[body.key];
    if (!job || job.status !== 'ranked') fail('La oferta no está puntuada', 404);
    const data = decisions();
    const prev = data.decisions[body.key];
    let taskId = prev?.taskId ?? null;
    if (body.decision === 'postular' && !taskId && kanbanStore) {
      const description = `Oferta #${job.ref} (${job.rank_score ?? '?'}/100): ${job.title} en ${job.company} · ${job.location ?? ''}\n${job.url}\n\nEn ~/dev/GitHub/ai-job-search-review/ai-job-search ejecuta: /postular ${job.ref}\nPrimero pregunta a David todo lo que el perfil no confirme; recién después redacta. Nunca envía.`;
      const result = kanbanStore.mutate({ action: 'create', task: {
        title: `Postular #${job.ref}: ${job.title}`.slice(0, 180), project: kanbanProject, agent: 'claude',
        priority: (job.rank_score ?? 0) >= 75 ? 'high' : 'medium', status: 'backlog', description: description.slice(0, 6000),
        acceptance: 'CV de 1 página y carta revisados y aprobados por David. Nada enviado por Claude; David postula desde el link.',
      } });
      taskId = result.tasks.at(-1).id;
    }
    data.decisions[body.key] = { decision: body.decision, ref: job.ref, at: new Date().toISOString(), taskId };
    fs.mkdirSync(path.dirname(decisionsFile), { recursive: true });
    const tmp = `${decisionsFile}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(tmp, decisionsFile); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    return get();
  }

  return { get, decide };
}
