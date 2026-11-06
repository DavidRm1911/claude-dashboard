import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { discoverAwsCredits } from "./aws-knowledge.js";

const HOUR = 3600000;
const DAY = 24 * HOUR;
const MAX_BYTES = 4 * 1024 * 1024;
export const RADAR_SOURCES = Object.freeze([
  { id: "builder", name: "AWS Builder Center", kind: "community", section: "architecture", url: "https://builder.aws.com/rss", home: "https://builder.aws.com/", intervalMs: HOUR, hosts: ["builder.aws.com"] },
  { id: "architecture", name: "AWS Architecture Blog", kind: "official", section: "architecture", url: "https://aws.amazon.com/blogs/architecture/feed/", home: "https://aws.amazon.com/blogs/architecture/", intervalMs: HOUR, hosts: ["aws.amazon.com"] },
  { id: "compute", name: "AWS Compute Blog", kind: "official", section: "architecture", url: "https://aws.amazon.com/blogs/compute/feed/", home: "https://aws.amazon.com/blogs/compute/", intervalMs: HOUR, hosts: ["aws.amazon.com"] },
  { id: "news", name: "AWS News Blog", kind: "official", section: "news", url: "https://aws.amazon.com/blogs/aws/feed/", home: "https://aws.amazon.com/blogs/aws/", intervalMs: HOUR, hosts: ["aws.amazon.com"] },
  { id: "training", name: "AWS Training & Certification", kind: "official", section: "learning", url: "https://aws.amazon.com/blogs/training-and-certification/feed/", home: "https://aws.amazon.com/blogs/training-and-certification/", intervalMs: HOUR, hosts: ["aws.amazon.com"] },
  { id: "remotive", name: "Remotive", kind: "jobs", section: "jobs", url: "https://remotive.com/api/remote-jobs", home: "https://remotive.com/", intervalMs: 6 * HOUR, hosts: ["remotive.com", "www.remotive.com"] },
  { id: "getonbrd", name: "Get on Board", kind: "jobs", section: "jobs", url: "https://www.getonbrd.com/jobs/feed", home: "https://www.getonbrd.com/jobs", intervalMs: 6 * HOUR, hosts: ["www.getonbrd.com", "getonbrd.com"] },
]);

// Editorial resources are not scraped promotions. Never infer personal eligibility.
export const RADAR_RESOURCES = Object.freeze([
  { key: "free-tier", title: "USD 100 al abrir una cuenta AWS nueva", url: "https://aws.amazon.com/free/free-tier-faqs/", summary: "Crédito inicial del Free Tier para clientes nuevos; se pueden obtener hasta USD 100 adicionales con actividades elegibles.", terms: "Solo nuevos clientes AWS. Créditos no transferibles; vencen a los 12 meses. El plan gratuito dura hasta seis meses o hasta agotar créditos. En plan de pago, el exceso puede generar cargos.", offer: "credit", publishedAt: null, verifiedAt: "2026-09-29T00:00:00Z", expiresAt: null },
  { key: "free-tier-extra", title: "Hasta USD 100 más por explorar servicios", url: "https://aws.amazon.com/free/", summary: "Cinco actividades en EC2, RDS, Lambda, Bedrock y AWS Budgets pueden dar USD 20 en créditos cada una.", terms: "Solo clientes nuevos que completen actividades elegibles. Los USD 100 extra no son automáticos. AWS indica hasta USD 200 en total, sujetos a elegibilidad y vigencia.", offer: "conditional-credit", publishedAt: null, verifiedAt: "2026-09-29T00:00:00Z", expiresAt: null },
  { key: "activate-founders", title: "AWS Activate Founders para startups", url: "https://aws.amazon.com/startups/credits", summary: "Startups autofinanciadas elegibles pueden solicitar USD 1,000 iniciales; algunas califican para hasta USD 5,000.", terms: "Requiere startup y solicitud aprobada por AWS; entre otros requisitos, web funcional, empresa fundada en los últimos 10 años y cuenta AWS de pago. No es un crédito personal automático.", offer: "conditional-credit", publishedAt: null, verifiedAt: "2026-09-29T00:00:00Z", expiresAt: null },
  { key: "microcredentials", title: "Microcredenciales AWS, sin suscripción", url: "https://aws.amazon.com/blogs/training-and-certification/microcredentials-from-aws-are-now-free-heres-why-that-matters/", summary: "Validación práctica en entornos AWS. No equivale a un examen de certificación gratuito.", terms: "AWS anuncia acceso gratuito a microcredenciales. Consulta las condiciones del programa antes de inscribirte.", offer: "free-resource", publishedAt: "2026-04-23T00:00:00Z", verifiedAt: "2026-09-29T00:00:00Z", expiresAt: null },
  { key: "educate", title: "AWS Educate: cursos y laboratorios gratuitos", url: "https://aws.amazon.com/education/awseducate/", summary: "Práctica de cloud sin tarjeta de crédito; incluye una bolsa de empleo para mayores de 18 años.", terms: "Requiere registro en AWS Educate. Los recursos y requisitos pueden cambiar.", offer: "free-resource", publishedAt: null, verifiedAt: "2026-09-29T00:00:00Z", expiresAt: null },
  { key: "skillbuilder", title: "El catálogo gratuito de AWS Skill Builder", url: "https://aws.amazon.com/training/digital/", summary: "Cursos y recursos de aprendizaje gratuitos. Las suscripciones y parte de los laboratorios son de pago.", terms: "Gratuito no significa que todo Skill Builder lo sea. Revisa el precio del recurso concreto.", offer: "free-resource", publishedAt: null, verifiedAt: "2026-09-29T00:00:00Z", expiresAt: null },
  { key: "team-promotion", title: "Skill Builder Teams: oferta con código de AWS", url: "https://aws.amazon.com/legal/training-sbts-promotional-terms-and-conditions/", summary: "Prueba o descuento para equipos elegibles que hayan recibido un código. No es un regalo universal.", terms: "Requiere código recibido de AWS, cuenta elegible y restricciones regionales. La promoción de 2026 termina el 31 de diciembre, hora del Pacífico; AWS puede cancelarla.", offer: "conditional", publishedAt: null, verifiedAt: "2026-09-29T00:00:00Z", expiresAt: "2027-01-01T07:59:59Z" },
]);

export const RADAR_JOB_LINKS = Object.freeze([
  { name: "AWS Careers", url: "https://www.amazon.jobs/en/teams/amazon-web-services", description: "Vacantes de AWS. Filtra país y modalidad en la fuente." },
  { name: "Get on Board · Perú", url: "https://www.getonbrd.com/empleos/ciudad/lima", description: "Vacantes en Lima; confirma modalidad y vigencia en el aviso." },
  { name: "Get on Board · remoto", url: "https://www.getonbrd.com/jobs-remoto", description: "LATAM y remoto. Cada empresa define los países admitidos." },
  { name: "AWS Educate Job Board", url: "https://aws.amazon.com/education/awseducate/", description: "Acceso con AWS Educate para mayores de 18 años." },
]);

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const sourceById = (id) => RADAR_SOURCES.find((s) => s.id === id);
export function safeRadarUrl(value, hosts) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hosts.includes(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}
function entities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (named[code.toLowerCase()]) return named[code.toLowerCase()];
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}
export function radarText(value, max = 200) {
  if (typeof value !== "string") return "";
  let text = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  text = entities(text).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
  text = entities(text).replace(/<[^>]*>/g, " ").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
const iso = (value) => {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
function tag(xml, name) {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml)?.[1] || "";
}
function attr(xml, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(xml)?.[2] || "";
}
export function radarTopics(value) {
  const text = value.toLowerCase();
  return [
    ["IA / agentes", /bedrock|agentcore|\bagent\b|\bagents\b|agentes|generative|\brag\b|\bllm\b|strands/],
    ["Serverless", /serverless|lambda|step functions|eventbridge|\bsqs\b|\bsns\b/],
    ["Datos", /data|datos|pipeline|lakehouse|analytics|dynamodb|athena|\bglue\b/],
    ["Seguridad", /security|seguridad|\biam\b|zero trust|\bauth\b/],
    ["DevOps", /devops|kubernetes|\beks\b|terraform|observability|observabilidad|ci\/cd|platform engineer/],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label).slice(0, 3);
}
const idFor = (url) => createHash("sha256").update(url).digest("hex").slice(0, 24);
function baseItem(source, item) {
  return { id: idFor(item.url), sourceId: source.id, sourceName: source.name, kind: source.kind, section: source.section, ...item };
}

// Parse only the small RSS/Atom subset our allowlisted sources expose. No DTD,
// entity expansion, scripts, images, content:encoded or external resources.
export function parseRadarFeed(xml, source, now = Date.now()) {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw bad("Feed XML no permitido");
  if (!/<(?:rss|feed)\b/i.test(xml)) throw bad("La fuente no devolvió RSS/Atom");
  const atom = /<feed\b/i.test(xml);
  const blocks = xml.match(atom ? /<entry\b[^>]*>[\s\S]*?<\/entry>/gi : /<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const items = new Map();
  for (const block of blocks.slice(0, 60)) {
    const title = radarText(tag(block, "title"), 220);
    const atomLinks = [...block.matchAll(/<link\b[^>]*\/?\s*>/gi)].map((m) => m[0]);
    const link = atom ? atomLinks.find((link) => !attr(link, "rel") || attr(link, "rel") === "alternate") : null;
    const url = safeRadarUrl(entities(atom ? attr(link || "", "href") : tag(block, "link").trim()), source.hosts);
    if (!title || !url) continue;
    const publishedAt = iso(tag(block, atom ? "published" : "pubDate").trim());
    const updatedAt = atom ? iso(tag(block, "updated").trim()) : null;
    const date = publishedAt || updatedAt;
    if (date && Date.parse(date) > now + DAY) continue;
    const summary = radarText(tag(block, atom ? "summary" : "description"), 220).split(" ").slice(0, 24).join(" ");
    const author = radarText(atom ? tag(tag(block, "author"), "name") : tag(block, "dc:creator"), 100) || null;
    const categories = [...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) => radarText(m[1], 60)).slice(0, 4);
    const text = `${title} ${summary}`;
    const offerSignal = /\bfree\b|gratis|gratuit|voucher|discount|descuento|promotion|promoci[oó]n|hackathon|scholarship|beca|credits|cr[eé]ditos|giveaway|challenge/i.test(text);
    items.set(url, baseItem(source, { title, url, summary, author, publishedAt: date, dateKind: publishedAt ? "published" : updatedAt ? "updated" : "unknown", categories, topics: radarTopics(text), offerSignal, expiresAt: null }));
  }
  if (!items.size) throw bad("Feed sin entradas válidas");
  return [...items.values()];
}

export function parseRadarJobs(body, source = sourceById("remotive"), now = Date.now()) {
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  if (!parsed || !Array.isArray(parsed.jobs)) throw bad("Respuesta de empleos inválida");
  const items = new Map();
  for (const job of parsed.jobs.slice(0, 3000)) {
    const title = radarText(job.title, 200);
    const url = safeRadarUrl(job.url, source.hosts);
    const text = radarText(`${job.title || ""} ${(job.tags || []).join?.(" ") || ""} ${job.category || ""} ${job.description || ""}`, 12000);
    const role = `${title} ${radarText(job.category, 80)}`;
    if (!title || !url || !/\baws\b|cloud|back.?end|devops|platform engineer|solutions architect|site reliability|\bsre\b|full.stack|\.net|\bai\b|machine learning|data engineer|data scientist/i.test(role)) continue;
    // Remotive's timestamps without timezone are treated as UTC explicitly.
    const rawDate = typeof job.publication_date === "string" ? job.publication_date : "";
    const date = iso(rawDate && !/(Z|[+-]\d{2}:?\d{2})$/i.test(rawDate) ? `${rawDate}Z` : rawDate);
    if (date && (Date.parse(date) > now + DAY || Date.parse(date) < now - 60 * DAY)) continue;
    const location = radarText(job.candidate_required_location, 160) || "Ubicación no indicada";
    const region = /per[uú]/i.test(location) ? "peru" : /worldwide|anywhere|global|latin america|latam|south america|americas/i.test(location) ? "latam-global" : "restricted";
    const company = radarText(job.company_name, 100) || "Empresa no indicada";
    items.set(url, baseItem(source, { title, url, summary: radarText(job.description, 900), author: null, publishedAt: date, dateKind: "published", topics: radarTopics(text), offerSignal: false, company, location, region, salary: radarText(job.salary, 120) || null, jobType: radarText(job.job_type, 60) || null, expiresAt: null }));
  }
  return [...items.values()].slice(0, 160);
}

export function parseGetOnBoardJobs(xml, source = sourceById("getonbrd"), now = Date.now()) {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw bad("Feed Get on Board no permitido");
  if (!/<source\b[^>]*>[\s\S]*?<job\b/i.test(xml)) throw bad("Get on Board no devolvió su XML público de vacantes");
  const items = new Map();
  for (const block of (xml.match(/<job\b[^>]*>[\s\S]*?<\/job>/gi) || []).slice(0, 400)) {
    const title = radarText(tag(block, "title"), 200);
    const description = tag(block, "description");
    const raw = `${title} ${radarText(description, 12000)}`;
    if (!/\baws\b|cloud|back.?end|devops|platform|solutions architect|site reliability|\bsre\b|full.?stack|developer|engineer|ingenier|desarroll|\bai\b|machine learning|data engineer|data scientist|kubernetes|terraform/i.test(title)) continue;
    const url = safeRadarUrl(radarText(tag(block, "url"), 500), source.hosts);
    if (!url) continue;
    const country = radarText(tag(block, "country"), 200) || "País no indicado";
    const location = /per[uú]/i.test(country) ? country : /latin america|latam|south america/i.test(country) ? country : /global|worldwide|anywhere/i.test(country) ? country : country === "País no indicado" && /remote|remoto/i.test(`${raw} ${url}`) ? "Remoto (países por confirmar)" : country;
    const region = /per[uú]/i.test(country) ? "peru" : /latin america|latam|south america|global|worldwide|anywhere/i.test(country) ? "latam-global" : "restricted";
    const publishedAt = iso(tag(block, "date").trim());
    if (publishedAt && (Date.parse(publishedAt) > now + DAY || Date.parse(publishedAt) < now - 60 * DAY)) continue;
    const company = radarText(tag(block, "company"), 100) || "Empresa no indicada";
    const jobType = radarText(tag(block, "jobtype") || tag(block, "job_type"), 40) || null;
    items.set(url, baseItem(source, { title, url, summary: radarText(description, 900), author: null, publishedAt, dateKind: publishedAt ? "published" : "unknown", topics: radarTopics(raw), offerSignal: false, company, location, region, salary: null, jobType, expiresAt: null }));
  }
  return [...items.values()].slice(0, 160);
}

export async function fetchRadarBody(source, fetchImpl = fetch) {
  if (!RADAR_SOURCES.some((s) => s === source)) throw bad("Fuente no permitida");
  let url = source.url;
  for (let redirects = 0; redirects <= 2; redirects++) {
    if (!safeRadarUrl(url, source.hosts)) throw bad("Redirección no permitida");
    const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "LocalDeveloperRadar/1.0 (RSS reader; no personal data)", Accept: source.kind === "jobs" ? "application/json" : "application/atom+xml, application/rss+xml, application/xml, text/xml" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      url = new URL(next || "", url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw bad(`La fuente respondió HTTP ${response.status}`, 502); }
    const type = response.headers.get("content-type") || "";
    if (!/(xml|json)/i.test(type) && !(source.id === "getonbrd" && /text\/html/i.test(type))) { await response.body?.cancel(); throw bad("Tipo de contenido no permitido", 502); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw bad("Fuente demasiado grande", 502); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) { throw bad("Fuente demasiado grande", 502); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw bad("Demasiadas redirecciones", 502);
}

function resourceItems(now) {
  return RADAR_RESOURCES.map((r) => ({ ...baseItem({ id: "resources", name: "Selección con fuente AWS", kind: "official", section: r.offer.includes("credit") ? "credits" : "learning" }, r), id: idFor(r.url), resource: true, dateKind: r.publishedAt ? "published" : "unknown", topics: [], author: null, offerSignal: true, expired: Boolean(r.expiresAt && Date.parse(r.expiresAt) <= now), reviewDue: now - Date.parse(r.verifiedAt) > 30 * DAY }));
}

export function createRadarStore({ dataDir, now = Date.now, fetchBody = fetchRadarBody, discoverCredits = discoverAwsCredits } = {}) {
  const file = path.join(dataDir, "radar.json");
  let state = { version: 1, enabled: false, sources: {}, items: [], marks: {}, mcp: { items: [], attemptedAt: null, fetchedAt: null, error: null } };
  let active = null;
  let activeMcp = null;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 3 * MAX_BYTES) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (saved.version === 1) state = { ...state, enabled: saved.enabled === true, sources: saved.sources || {}, items: Array.isArray(saved.items) ? saved.items.filter((item) => { const s = sourceById(item.sourceId); return s && safeRadarUrl(item.url, s.hosts); }).slice(0, 600) : [], marks: saved.marks && typeof saved.marks === "object" ? saved.marks : {}, mcp: { ...state.mcp, ...(saved.mcp || {}), items: Array.isArray(saved.mcp?.items) ? saved.mcp.items.filter((i) => safeRadarUrl(i.url, ["aws.amazon.com", "docs.aws.amazon.com"])).slice(0, 5) : [] } };
    }
  } catch { /* First run or damaged cache: keep a usable offline state. */ }
  function persist() {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw bad("Caché local no permitida", 500);
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
  function snapshot() {
    const time = now();
    const items = [...state.items, ...resourceItems(time), ...state.mcp.items].map((item) => ({ ...item, saved: state.marks[item.id]?.saved === true, read: state.marks[item.id]?.read === true }));
    return {
      enabled: state.enabled, refreshing: Boolean(active), generatedAt: new Date(time).toISOString(),
      sources: RADAR_SOURCES.map((s) => {
        const entry = state.sources[s.id] || {};
        const lastAttempt = Date.parse(entry.attemptedAt || "") || 0;
        const next = lastAttempt ? lastAttempt + s.intervalMs : null;
        return { id: s.id, name: s.name, home: s.home, kind: s.kind, intervalHours: s.intervalMs / HOUR, fetchedAt: entry.fetchedAt || null, attemptedAt: entry.attemptedAt || null, error: entry.error || null, nextRefreshAt: next ? new Date(next).toISOString() : null, stale: !entry.fetchedAt || time - Date.parse(entry.fetchedAt) > s.intervalMs * 2, count: state.items.filter((i) => i.sourceId === s.id).length };
      }),
      items: items.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)),
      jobLinks: RADAR_JOB_LINKS, mcp: { attemptedAt: state.mcp.attemptedAt, fetchedAt: state.mcp.fetchedAt, error: state.mcp.error, count: state.mcp.items.length, nextRefreshAt: state.mcp.attemptedAt ? new Date(Date.parse(state.mcp.attemptedAt) + 12 * HOUR).toISOString() : null },
      privacy: "Solo se consultan feeds, API y MCP públicos predefinidos. Reciben tu IP y un identificador genérico; el MCP recibe una consulta genérica fija, nunca tu CV. No se envían proyectos, historial ni credenciales.",
    };
  }
  async function refresh() {
    if (!state.enabled) return snapshot();
    if (active) { await active; return snapshot(); }
    active = (async () => {
      const time = now();
      const due = RADAR_SOURCES.filter((s) => !state.sources[s.id]?.attemptedAt || time - Date.parse(state.sources[s.id].attemptedAt) >= s.intervalMs);
      // Save attempt times before I/O, so restart/failure cannot bypass cooldowns.
      for (const s of due) state.sources[s.id] = { ...state.sources[s.id], attemptedAt: new Date(time).toISOString() };
      if (due.length) persist();
      await Promise.all(due.map(async (source) => {
        try {
          const body = await fetchBody(source);
          const items = source.id === "getonbrd" ? parseGetOnBoardJobs(body, source, time) : source.kind === "jobs" ? parseRadarJobs(body, source, time) : parseRadarFeed(body, source, time);
          if (source.kind === "jobs") {
            const ids = new Set(items.map((i) => i.id));
            const retired = state.items.filter((i) => i.sourceId === source.id && state.marks[i.id]?.saved && !ids.has(i.id)).map((i) => ({ ...i, retired: true }));
            state.items = state.items.filter((i) => i.sourceId !== source.id).concat(items, retired);
          }
          else {
            const merged = new Map(state.items.map((i) => [i.id, i]));
            for (const item of items) merged.set(item.id, item);
            state.items = [...merged.values()];
          }
          state.sources[source.id] = { ...state.sources[source.id], fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (err) {
          state.sources[source.id] = { ...state.sources[source.id], error: /^La fuente respondió HTTP \d+$/.test(err.message) ? err.message : "No se pudo leer esta fuente. Conservamos la última copia disponible." };
        }
      }));
      const keep = (i) => state.marks[i.id]?.saved || (i.publishedAt && Date.parse(i.publishedAt) >= time - 90 * DAY) || !i.publishedAt;
      state.items = state.items.filter(keep).sort((a, b) => Number(state.marks[b.id]?.saved === true) - Number(state.marks[a.id]?.saved === true) || (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, 600);
      persist();
    })();
    try { await active; } finally { active = null; }
    return snapshot();
  }
  function configure(enabled) {
    if (typeof enabled !== "boolean") throw bad("Estado del Radar inválido");
    state.enabled = enabled;
    persist();
    return snapshot();
  }
  async function searchCredits() {
    if (!state.enabled) throw bad("Activa Radar para consultar AWS Knowledge MCP", 403);
    if (activeMcp) { await activeMcp; return snapshot(); }
    if (state.mcp.attemptedAt && now() - Date.parse(state.mcp.attemptedAt) < 12 * HOUR) return snapshot();
    state.mcp.attemptedAt = new Date(now()).toISOString();
    persist();
    activeMcp = (async () => {
      try {
        const found = await discoverCredits();
        if (!found.length) throw new Error("Sin resultados oficiales");
        state.mcp.items = found.map((r) => ({ ...baseItem({ id: "aws-mcp", name: "AWS Knowledge MCP", kind: "official", section: "credits" }, { ...r, publishedAt: null, dateKind: "unknown", topics: [], offerSignal: false, offer: "unverified", resource: false, discovery: true, terms: "Hallazgo del buscador MCP: abre la página oficial y confirma fecha, elegibilidad y vigencia.", verifiedAt: null, expiresAt: null }), id: idFor(r.url) }));
        state.mcp.fetchedAt = new Date(now()).toISOString();
        state.mcp.error = null;
      } catch { state.mcp.error = "AWS Knowledge MCP no respondió. La selección editorial sigue disponible."; }
      persist();
    })();
    try { await activeMcp; } finally { activeMcp = null; }
    return snapshot();
  }
  function mark({ id, saved, read }) {
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id) || !snapshot().items.some((i) => i.id === id)) throw bad("Elemento del Radar desconocido", 404);
    if (saved !== undefined && typeof saved !== "boolean" || read !== undefined && typeof read !== "boolean" || saved === undefined && read === undefined) throw bad("Marca inválida");
    if (saved === true && !state.marks[id]?.saved && Object.values(state.marks).filter((m) => m.saved === true).length >= 200) throw bad("Límite de 200 guardados: libera uno antes de agregar otro.");
    const entry = { saved: state.marks[id]?.saved === true, read: state.marks[id]?.read === true };
    if (saved !== undefined) entry.saved = saved;
    if (read !== undefined) entry.read = read;
    state.marks[id] = entry;
    persist();
    return { id, ...entry };
  }
  return { get: snapshot, refresh, searchCredits, configure, mark };
}
