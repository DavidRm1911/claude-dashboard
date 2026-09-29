// es-PE's CLDR data spells USD out as "USD" instead of "$" under Intl's currency style,
// and its built-in compact notation mixes "K"/"k" casing and inserts a space before the
// suffix (verified against Node's full-ICU build) — both verbose and inconsistent for a
// dense stat-card layout, so cost and compact-count formatting are built manually on top
// of plain Intl.NumberFormat instead of the "currency"/"compact" presets.
const LOCALE = "es-PE";
async function dashboardFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (options.method === "POST") headers.set("X-Dashboard-Request", "1");
  const response = await window.fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.error || `Error ${response.status}. Vuelve a intentarlo.`;
    const banner = document.getElementById("appError");
    banner.textContent = message;
    banner.hidden = false;
    throw new Error(message);
  }
  return response;
}
const nf = new Intl.NumberFormat(LOCALE, { useGrouping: "always" });
const sig3 = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 3 });
const numStd = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numSmall = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const fmt = (n) => nf.format(Math.round(n || 0));
const fmtCompact = (n) => {
  n = n || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 1000) return sign + Math.round(abs);
  const units = ["", "k", "M", "B"];
  let idx = 0, val = abs;
  while (val >= 1000 && idx < units.length - 1) { val /= 1000; idx++; }
  if (Number(sig3.format(val).replace(/,/g, "")) >= 1000 && idx < units.length - 1) { val /= 1000; idx++; }
  return sign + sig3.format(val) + units[idx];
};
const fmtCost = (n) => {
  n = n || 0;
  const small = Math.abs(n) > 0 && Math.abs(n) < 0.01;
  return "$" + (small ? numSmall : numStd).format(n);
};
const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const projectLabel = (s) => s.projectDisplayName || s.project;
// A session's own title is just its first user message, and is often
// uninformative on its own (e.g. "hola quien soy") — so the project name +
// description (from that repo's CLAUDE.md) leads instead, with the raw
// message demoted to a quoted line underneath for when it does say something.
function sessionHeadHtml(s) {
  const primary = escapeHtml(projectLabel(s) || "(proyecto sin nombre)");
  const desc = s.projectDescription ? escapeHtml(s.projectDescription) : "";
  const quote = s.title ? `<div class="session-project-desc">"${escapeHtml(s.title)}"</div>` : "";
  return { primary, desc, quote };
}

const COMMANDS = [
  { cmd: "claude", desc: "Inicia Claude Code dentro del proyecto actual." },
  { cmd: "codex", desc: "Inicia Codex CLI dentro del proyecto actual. Su autenticación se administra desde Codex." },
  { cmd: "grok", desc: "Inicia Grok CLI dentro del proyecto actual." },
  { cmd: "agy", desc: "Inicia Antigravity CLI dentro del proyecto actual." },
];

let STATE = null;
let HISTORY_DATA = null;
let WORKSPACE_DATA = null;
let PROJECTS_DATA = null;
let appState = { range: "30", account: "all", skillQuery: "", skillSort: "name", openDay: null, historyQuery: "", historyRevealed: false, tier: "daily", ideasShowOlder: false, projectOrg: "personal" };
let refreshTimer = null;
let dailyChart = null;
let cacheHitChart = null;

async function fetchStats({ dim = false } = {}) {
  const main = document.querySelector("main");
  if (dim) main.classList.add("is-loading");
  const params = new URLSearchParams();
  if (appState.range !== "all") params.set("days", appState.range);
  if (appState.account !== "all") params.set("account", appState.account);
  try {
    const res = await dashboardFetch("/api/stats?" + params.toString());
    STATE = await res.json();
    renderAll();
    document.getElementById("appError").hidden = true;
    await loadAgents();
  } catch (error) {
    const banner = document.getElementById("appError");
    banner.textContent = error.message || "No se pudo cargar el uso. Pulsa Actualizar para reintentar.";
    banner.hidden = false;
  } finally {
    main.classList.remove("is-loading");
  }
}

function renderAll() {
  renderClock(STATE.generatedAt);
  populateAccountFilter(STATE.accounts);
  renderSummary(STATE.totals, STATE.previousTotals);
  renderCacheNote(STATE.totals);
  renderChart(STATE.byDay, STATE.accounts);
  renderModels(STATE.byModel);
  renderCosts(STATE.totals, STATE.byModel, STATE.sessions);
  renderActivity(STATE.byDayActivity, STATE.byHour);
  renderInsights(STATE.insights, STATE.previousTotals);
  renderAccounts(STATE.accounts);
  renderSkills(STATE.skills);
  renderMcp();
  renderProjectGraph(STATE.sessions);
  renderGraphifyCard(STATE.tools);
  renderCommands(STATE.tools);
  if (appState.openDay) renderDrilldown(appState.openDay);
}

function renderClock(iso) {
  const d = new Date(iso);
  document.getElementById("generatedAt").textContent =
    "actualizado " + d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function populateAccountFilter(accounts) {
  const sel = document.getElementById("accountFilter");
  if (sel.dataset.populated === "1") return;
  for (const a of accounts) {
    const opt = document.createElement("option");
    opt.value = a.key;
    opt.textContent = a.org;
    sel.appendChild(opt);
  }
  sel.dataset.populated = "1";
}

// Comparison badge vs. the immediately preceding period. `mode: "pp"` is for
// rates already expressed as 0–1 (e.g. cache hit rate) and diffs in
// percentage points; the default "pct" is relative % change. Polarity decides
// which direction gets colored --ok vs --crit: "bad-up" for metrics where
// growth is undesirable (cost), "good-up" for the opposite (cache hit rate).
// "neutral" (the default) renders the delta without judging it — most usage
// metrics here are informational, not good-or-bad on their own.
function deltaBadge(current, previous, { polarity = "neutral", mode = "pct" } = {}) {
  if (previous == null || !isFinite(previous)) return "";
  let diff, label;
  if (mode === "pp") {
    diff = (current - previous) * 100;
    if (Math.abs(diff) < 0.5) return `<span class="stat-delta stat-delta--flat">≈ sin cambio vs período anterior</span>`;
    label = `${Math.abs(diff).toFixed(0)}pp`;
  } else {
    if (previous === 0) return "";
    diff = ((current - previous) / Math.abs(previous)) * 100;
    if (!isFinite(diff) || Math.round(diff) === 0) return `<span class="stat-delta stat-delta--flat">≈ sin cambio vs período anterior</span>`;
    label = `${Math.abs(Math.round(diff))}%`;
  }
  const up = diff > 0;
  let colorVar = "--muted";
  if (polarity === "bad-up") colorVar = up ? "--crit" : "--ok";
  else if (polarity === "good-up") colorVar = up ? "--ok" : "--crit";
  return `<span class="stat-delta" style="color:${cssVar(colorVar)}">${up ? "↑" : "↓"} ${label} vs período anterior</span>`;
}

function renderSummary(totals, previousTotals) {
  const warning = document.getElementById("pricingWarning");
  const pricing = STATE.pricing || {};
  warning.hidden = !STATE.pricingWarnings?.length && !pricing.unknownCacheTTL;
  warning.textContent = [STATE.pricingWarnings?.length ? `Referencia parcial. Sin precio: ${STATE.pricingWarnings.join(", ")}. Su costo es N/D, no cero.` : "", pricing.unknownCacheTTL ? `${fmt(pricing.unknownCacheTTL)} tokens de caché sin duración; se muestra un intervalo 5m–1h.` : ""].filter(Boolean).join(" ");
  renderPricingDetail();
  const prev = previousTotals || {};
  const cards = [
    { label: "Equivalente API de Claude", value: claudeReferenceValue(totals), sub: `Precios ${pricing.verifiedAt || "de referencia"}; no factura ni deuda de tu plan`, current: totals.costUSD || 0, previous: prev.costUSD, polarity: "bad-up" },
    { label: "Tokens nuevos", value: fmtCompact(totals.freshTokens), sub: "= input + output + caché creada", current: totals.freshTokens || 0, previous: prev.freshTokens },
    { label: "Sesiones · mensajes", value: `${fmt(totals.sessionCount)} · ${fmt(totals.messageCount)}`, sub: `${fmt(totals.skillCount)} skills instaladas`, current: totals.sessionCount || 0, previous: prev.sessionCount },
    { label: "Tokens totales (con caché)", value: fmtCompact(totals.totalTokens), sub: "tokens nuevos + relecturas de caché", current: totals.totalTokens || 0, previous: prev.totalTokens },
    { label: "Tokens de entrada (input)", value: fmtCompact(totals.inputTokens), sub: "lo que enviaste, sin contar caché", current: totals.inputTokens || 0, previous: prev.inputTokens },
    { label: "Tokens de salida (output)", value: fmtCompact(totals.outputTokens), sub: "lo que Claude generó como respuesta", current: totals.outputTokens || 0, previous: prev.outputTokens },
    { label: "Tool calls", value: fmt(totals.toolCallCount), sub: "llamadas a herramientas durante esas sesiones", current: totals.toolCallCount || 0, previous: prev.toolCallCount },
  ];
  document.getElementById("resumen").innerHTML = cards
    .map((c, i) => `<div class="stat-card${i === 0 ? " stat-card--cost" : ""}"><div class="stat-num">${c.value}</div><div class="stat-label">${c.label}</div><div class="stat-sub">${c.sub}</div>${deltaBadge(c.current, c.previous, { polarity: c.polarity })}</div>`)
    .join("");

  const floatStat = document.getElementById("heroFloatStat");
  if (floatStat) {
    document.getElementById("heroFloatSub").textContent = `${fmtCompact(totals.freshTokens)} tokens nuevos`;
    floatStat.hidden = false;
  }
}

function renderCacheNote(totals) {
  const cacheShare = totals.totalTokens ? (((totals.totalTokens - totals.freshTokens) / totals.totalTokens) * 100).toFixed(0) : 0;
  document.getElementById("cacheNote").innerHTML = `
    <div class="cache-note-head">
      <div><strong>¿Por qué el total parece tan alto?</strong> El ${cacheShare}% de esos tokens son relecturas de caché (<em>cache_read</em>), no tokens nuevos.</div>
      <button id="cacheNoteToggle" class="ghost-btn">Cómo funciona ↓</button>
    </div>
    <div id="cacheNoteDetail" class="cache-note-detail" hidden>
      <ol>
        <li><strong>Caché creada (cache_creation):</strong> la primera vez que un bloque de contexto se guarda en la caché de Anthropic. Cuenta como tokens "nuevos" porque es la primera vez que el modelo los procesa.</li>
        <li><strong>Caché leída (cache_read):</strong> cada turno siguiente envía todo el contexto acumulado, y la parte que no cambió se sirve desde caché. Eso se factura aparte, cada vez.</li>
        <li><strong>Por qué se acumula tan rápido:</strong> en una sesión de cientos de turnos, ese mismo contexto grande se "relee" cientos de veces.</li>
        <li><strong>Por qué es más barato:</strong> una lectura de caché cuesta una fracción del precio de un token de entrada normal.</li>
        <li><strong>Qué mirar si quieres saber cuánto "gastaste" de verdad:</strong> la card <strong>Tokens nuevos</strong> — esa sí refleja contenido nuevo, no relecturas.</li>
      </ol>
    </div>`;

  document.getElementById("cacheNoteToggle").addEventListener("click", () => {
    const detail = document.getElementById("cacheNoteDetail");
    const btn = document.getElementById("cacheNoteToggle");
    detail.hidden = !detail.hidden;
    btn.textContent = detail.hidden ? "Cómo funciona ↓" : "Ocultar ↑";
  });
}

// Sums the 4 token-type breakdowns across every currently-visible account
// (accounts already reflects the account filter server-side) for a given day.
function dayTokenBreakdown(byDay, day, accounts) {
  const out = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  for (const acc of accounts) {
    const v = byDay[day]?.[acc.key];
    if (!v) continue;
    out.input += v.input || 0;
    out.output += v.output || 0;
    out.cacheCreate += v.cacheCreate || 0;
    out.cacheRead += v.cacheRead || 0;
  }
  return out;
}

function renderChart(byDay, accounts) {
  const days = Object.keys(byDay).sort();
  const perDay = days.map((d) => dayTokenBreakdown(byDay, d, accounts));

  // Categorical-by-token-type (identity, not magnitude) — see the --tok-*
  // custom properties in style.css for the validation note. Order matches
  // the validated adjacent-pairlist ordering (blue/orange/aqua/yellow).
  const datasets = [
    { label: "Input (sin caché)", data: perDay.map((d) => d.input), backgroundColor: cssVar("--tok-input") },
    { label: "Escritura caché", data: perDay.map((d) => d.cacheCreate), backgroundColor: cssVar("--tok-cachewrite") },
    { label: "Lectura caché", data: perDay.map((d) => d.cacheRead), backgroundColor: cssVar("--tok-cacheread") },
    { label: "Output", data: perDay.map((d) => d.output), backgroundColor: cssVar("--tok-output") },
  ].map((ds) => ({ ...ds, stack: "tokens", borderRadius: 4 }));

  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(document.getElementById("dailyChart"), {
    type: "bar",
    data: { labels: days, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const day = days[elements[0].index];
        appState.openDay = appState.openDay === day ? null : day;
        if (appState.openDay) renderDrilldown(appState.openDay);
        else document.getElementById("drilldown").hidden = true;
      },
      scales: {
        // Ticks hidden here — the cache-hit-rate chart directly below shares
        // this same day axis and is where the labels live, to avoid showing
        // the same axis twice stacked on top of each other.
        x: { stacked: true, grid: { display: false }, ticks: { display: false } },
        y: { stacked: true, grid: { color: cssVar("--border") }, ticks: { color: cssVar("--muted"), callback: (v) => fmtCompact(v) } },
      },
      plugins: { legend: { labels: { color: cssVar("--ink"), font: { size: 11 } } } },
    },
  });

  renderCacheHitChart(days, perDay);
}

// A second, separate chart (not a dual-axis overlay on the bars above) so the
// 0–100% cache-hit-rate scale never shares a y-axis with raw token counts.
function renderCacheHitChart(days, perDay) {
  const rate = perDay.map((d) => {
    const ctx = d.input + d.cacheRead;
    return ctx > 0 ? d.cacheRead / ctx : null;
  });

  if (cacheHitChart) cacheHitChart.destroy();
  cacheHitChart = new Chart(document.getElementById("cacheHitChart"), {
    type: "line",
    data: {
      labels: days,
      datasets: [{
        data: rate,
        borderColor: cssVar("--tok-cacheread"),
        backgroundColor: cssVar("--tok-cacheread") + "33",
        fill: true,
        spanGaps: true,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.25,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: cssVar("--muted"), maxRotation: 0, font: { size: 9 }, autoSkip: true, maxTicksLimit: 8 } },
        y: { min: 0, max: 1, grid: { display: false }, ticks: { color: cssVar("--muted"), font: { size: 9 }, callback: (v) => `${Math.round(v * 100)}%`, maxTicksLimit: 3 } },
      },
    },
  });
}

function renderDrilldown(day) {
  const panel = document.getElementById("drilldown");
  panel.hidden = false;
  document.getElementById("drilldownTitle").textContent = new Date(day + "T00:00:00").toLocaleDateString("es-PE", {
    weekday: "long", day: "numeric", month: "long",
  });

  const sessions = STATE.sessions
    .filter((s) => s.byDay[day])
    .sort((a, b) => b.byDay[day].fresh - a.byDay[day].fresh);

  if (!sessions.length) {
    document.getElementById("drilldownList").innerHTML = `<div class="skill-empty">No hay sesiones registradas ese día (con los filtros actuales)</div>`;
    return;
  }

  document.getElementById("drilldownList").innerHTML = sessions
    .map((s) => {
      const day_ = s.byDay[day];
      const { primary, desc, quote } = sessionHeadHtml(s);
      return `
    <div class="session-row" data-session-id="${escapeHtml(s.id)}" data-session-title="${escapeHtml(s.title || "")}" style="cursor:pointer">
      <div>
        <div class="session-title">${primary}</div>
        <div class="session-meta" title="${escapeHtml(s.projectPath || s.project)}">${desc ? desc + " · " : ""}${fmt(s.messageCount)} mensajes en total</div>
        ${quote}
      </div>
      <span class="session-account" style="background:${s.accountColor}22;color:${s.accountColor}">${escapeHtml(s.accountOrg)}</span>
      <div class="session-tokens">${fmtCompact(day_.fresh)}<small>+ ${fmtCompact(day_.cacheRead)} caché · ${fmtCost(s.totals.costUSD || 0)}</small></div>
    </div>`;
    })
    .join("");

  document.getElementById("drilldownList").querySelectorAll(".session-row").forEach((row) => {
    row.addEventListener("click", () => openReplay(row.dataset.sessionId, row.dataset.sessionTitle));
  });
}

function renderModels(byModel) {
  const entries = Object.entries(byModel)
    .filter(([, m]) => m.fresh > 0)
    .sort((a, b) => b[1].fresh - a[1].fresh);
  const max = entries[0]?.[1].fresh || 1;
  const palette = STATE.modelPalette || ["#8A2B10", "#24544A", "#2C4A63", "#7A5A1F", "#5A3D63"];
  document.getElementById("modelBars").innerHTML = entries
    .map(
      ([model, m], i) => `
    <div class="model-bar-row">
      <div class="model-bar-top">
        <span class="model-bar-name">${providerMark('claude')}${escapeHtml(model)}</span>
        <span class="model-bar-val">${fmtCompact(m.fresh)} <span class="cost-tag">${STATE.pricingWarnings?.includes(model) ? "N/D" : fmtCost(m.costUSD || 0)}</span></span>
      </div>
      <div class="model-bar-track">
        <div class="model-bar-fill" style="width:${(m.fresh / max) * 100}%; background:${palette[i % palette.length]}"></div>
      </div>
    </div>`
    )
    .join("");
}

// ─── COSTOS ───────────────────────────────────────────────────────────────────

function renderCosts(totals, byModel, sessions) {
  // Summary cards
  const monthDays = Number(appState.range) || 90;
  const monthlyRate = (totals.costUSD || 0) * (30 / Math.max(1, monthDays));
  document.getElementById("costCards").innerHTML = [
    { label: "Equivalente API del período", value: claudeReferenceValue(totals), sub: "Precios actuales, no cargos de tu suscripción" },
    { label: "Ahorro teórico por caché", value: fmtCost(totals.cacheSavingsUSD || 0), sub: "Solo modelos con tarifa; comparación frente a input sin caché" },
    { label: "Referencia por sesión", value: STATE.pricing?.complete ? fmtCost(totals.sessionCount ? (totals.costUSD || 0) / totals.sessionCount : 0) : "N/D", sub: `sobre ${fmt(totals.sessionCount)} sesiones; no gasto real` },
  ].map((c) => `<div class="stat-card"><div class="stat-num">${c.value}</div><div class="stat-label">${c.label}</div><div class="stat-sub">${c.sub}</div></div>`).join("");

  // Model cost bars
  const modelEntries = Object.entries(byModel)
    .filter(([, m]) => (m.costUSD || 0) > 0)
    .sort((a, b) => (b[1].costUSD || 0) - (a[1].costUSD || 0));
  const maxCost = modelEntries[0]?.[1].costUSD || 1;
  const palette = STATE.modelPalette || ["#8A2B10", "#24544A", "#2C4A63", "#7A5A1F", "#5A3D63"];
  document.getElementById("costModelBars").innerHTML = modelEntries.map(([model, m], i) => `
    <div class="model-bar-row">
      <div class="model-bar-top">
        <span class="model-bar-name">${escapeHtml(model)}</span>
        <span class="model-bar-val">${fmtCost(m.costUSD || 0)}</span>
      </div>
      <div class="model-bar-track">
        <div class="model-bar-fill" style="width:${((m.costUSD || 0) / maxCost) * 100}%; background:${palette[i % palette.length]}"></div>
      </div>
    </div>`).join("") || '<div class="skill-empty">Sin datos de costo</div>';

  // Top sessions by cost
  const topSessions = [...sessions]
    .filter((s) => s.totals.costUSD > 0)
    .sort((a, b) => (b.totals.costUSD || 0) - (a.totals.costUSD || 0))
    .slice(0, 8);
  document.getElementById("costTopSessions").innerHTML = topSessions.map((s) => {
    const { primary, desc, quote } = sessionHeadHtml(s);
    return `
    <div class="session-row" data-session-id="${escapeHtml(s.id)}" data-session-title="${escapeHtml(s.title || "")}" style="cursor:pointer">
      <div>
        <div class="session-title">${primary}</div>
        <div class="session-meta">${desc ? desc + " · " : ""}${fmt(s.messageCount)} msgs</div>
        ${quote}
      </div>
      <span class="session-account" style="background:${s.accountColor}22;color:${s.accountColor}">${escapeHtml(s.accountOrg)}</span>
      <div class="session-tokens">${fmtCost(s.totals.costUSD || 0)}<small>${fmtCompact(s.totals.fresh)} tokens</small></div>
    </div>`;
  }).join("") || '<div class="skill-empty">Sin datos de costo</div>';

  document.getElementById("costTopSessions").querySelectorAll(".session-row").forEach((row) => {
    row.addEventListener("click", () => openReplay(row.dataset.sessionId, row.dataset.sessionTitle));
  });
}

// ─── ACTIVIDAD ────────────────────────────────────────────────────────────────

function renderActivity(byDayActivity, byHour) {
  renderHeatmap(byDayActivity);
  renderHourChart(byHour);
}

let activityChart = null;

function renderHeatmap(byDayActivity) {
  const canvas = document.getElementById("activityHeatmap");
  const statsEl = document.getElementById("activityHeatmapStats");
  document.getElementById("activityHeatmapTitle").textContent =
    appState.range === "all" ? "Actividad diaria" : `Actividad diaria · últimos ${appState.range} días`;

  if (!byDayActivity || !Object.keys(byDayActivity).length) {
    if (activityChart) { activityChart.destroy(); activityChart = null; }
    statsEl.innerHTML = "";
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Build the day range for the selected filter (falls back to 90 for "all")
  const rangeDays = Number(appState.range) || 90;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const counts = days.map((d) => byDayActivity[d] || 0);

  if (activityChart) activityChart.destroy();
  activityChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: days,
      datasets: [{ data: counts, backgroundColor: cssVar("--accent"), borderRadius: 3, maxBarThickness: 14 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const day = days[elements[0].index];
        appState.openDay = appState.openDay === day ? null : day;
        if (appState.openDay) renderDrilldown(appState.openDay);
        else document.getElementById("drilldown").hidden = true;
      },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: cssVar("--muted"), maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 10 } } },
        y: { grid: { color: cssVar("--border") }, ticks: { color: cssVar("--muted"), precision: 0 } },
      },
    },
  });

  const totalDays = Object.keys(byDayActivity).length;
  const totalMsgs = Object.values(byDayActivity).reduce((a, b) => a + b, 0);
  const streak = calcStreak(byDayActivity);
  statsEl.innerHTML = `
    <span><strong>${totalDays}</strong> días activos</span>
    <span><strong>${fmt(totalMsgs)}</strong> mensajes</span>
    <span><strong>${streak}</strong> días de racha</span>`;
}

function calcStreak(byDayActivity) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; i <= 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (byDayActivity[key]) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function renderHourChart(byHour) {
  const el = document.getElementById("hourChart");
  if (!byHour || !byHour.length) {
    el.innerHTML = '<div class="skill-empty">Sin datos horarios</div>';
    return;
  }
  const max = Math.max(...byHour, 1);
  const peak = byHour.indexOf(max);
  const labels = ["0h","","","","4h","","","","8h","","","","12h","","","","16h","","","","20h","","",""];
  let html = '<div class="hour-bars">';
  for (let h = 0; h < 24; h++) {
    const pct = (byHour[h] / max) * 100;
    const isNight = h < 6 || h >= 22;
    const cls = h === peak ? "peak" : isNight ? "night" : "";
    html += `<div class="hour-col" title="${h}:00 — ${byHour[h]} mensajes">
      <div class="hour-bar-wrap">
        <div class="hour-bar-fill ${cls}" style="transform:scaleY(${pct / 100})"></div>
      </div>
      <div class="hour-label">${labels[h]}</div>
    </div>`;
  }
  html += "</div>";

  const peakHour = byHour.indexOf(Math.max(...byHour));
  html += `<div class="heatmap-stats" style="margin-top:0.7rem"><span>Hora pico: <strong>${peakHour}:00–${peakHour + 1}:00</strong></span><span>${byHour[peakHour]} mensajes en esa hora</span></div>`;
  el.innerHTML = html;
}

// ─── INSIGHTS ─────────────────────────────────────────────────────────────────

function renderInsights(insights, previousTotals) {
  const el = document.getElementById("insightsWrap");
  if (!insights) { el.innerHTML = ""; return; }

  const { cacheHitRate, monthlyRunRate, items } = insights;
  const cacheDelta = deltaBadge(cacheHitRate, previousTotals?.cacheHitRate, { polarity: "good-up", mode: "pp" });

  let html = `<div class="insights-meta">
    <span>Cache hit rate: <strong>${(cacheHitRate * 100).toFixed(0)}%</strong>${cacheDelta ? ` ${cacheDelta}` : ""}</span>
    <span>Ritmo mensual: <strong>${fmtCost(monthlyRunRate)}</strong></span>
  </div>`;

  if (!items || items.length === 0) {
    html += '<div class="skill-empty" style="padding:1.5rem 0">Sin insights destacados — tu uso parece eficiente ✓</div>';
    el.innerHTML = html;
    return;
  }

  const severityColor = { high: cssVar("--crit"), medium: cssVar("--warn"), info: cssVar("--muted") };
  const severityBg = { high: cssVar("--crit-soft"), medium: cssVar("--warn-soft"), info: cssVar("--bg") };

  html += '<div class="insights-list">' + items.map((item) => `
    <div class="insight-card" style="border-left-color:${severityColor[item.severity] || cssVar("--muted")}">
      <div class="insight-head">
        <span class="insight-badge" style="background:${severityBg[item.severity] || cssVar("--bg")};color:${severityColor[item.severity] || cssVar("--muted")}">${item.severity}</span>
        <span class="insight-title">${escapeHtml(item.title)}</span>
        ${item.monthly_savings_usd > 0 ? `<span class="insight-savings">~${fmtCost(item.monthly_savings_usd)}/mes</span>` : ""}
      </div>
      <p class="insight-detail">${escapeHtml(item.detail)}</p>
    </div>`).join("") + "</div>";

  el.innerHTML = html;
}

// ─── IDEAS IA ─────────────────────────────────────────────────────────────────

let IDEAS_DATA = null;
let ideasPollTimer = null;

async function loadIdeas() {
  const prevStatus = IDEAS_DATA?.job?.status;
  const prevCount = IDEAS_DATA?.entries?.length;
  try {
    const res = await dashboardFetch("/api/ideas");
    IDEAS_DATA = await res.json();
  } catch {
    IDEAS_DATA = { job: { status: "idle" }, entries: [] };
  }
  // Same reasoning as loadProjectStatus: don't rebuild the whole idea-cards list on
  // every 5s poll tick, only the toolbar text, unless a generation actually finished.
  const changed = IDEAS_DATA.job?.status !== prevStatus || IDEAS_DATA.entries?.length !== prevCount;
  if (changed) renderIdeas();
  else updateIdeasToolbar();
}

function updateIdeasToolbar() {
  const btn = document.getElementById("ideasGenerate");
  const status = document.getElementById("ideasStatus");
  const customBtn = document.getElementById("customIdeaGenerate");
  const customStatus = document.getElementById("customIdeaStatus");
  const data = IDEAS_DATA || { job: { status: "idle" }, entries: [] };
  const running = data.job?.status === "running";

  btn.disabled = running;
  btn.textContent = running ? "Generando…" : "Generar ideas de este mes";
  customBtn.disabled = running;
  customBtn.textContent = running ? "Investigando…" : "Investigar esta idea";
  if (running) {
    status.textContent = "Puede tardar hasta 3 minutos — cruza repos, actividad y notas";
    status.className = "graphify-status";
    customStatus.textContent = "Investigando… puede tardar hasta 3 minutos";
    customStatus.className = "graphify-status";
  } else if (data.job?.status === "error") {
    status.textContent = "Falló: " + (data.job.error || "error desconocido");
    status.className = "graphify-status error";
    customStatus.textContent = status.textContent;
    customStatus.className = "graphify-status error";
  } else if (data.job?.status === "done") {
    status.textContent = "Listo ✓";
    status.className = "graphify-status done";
    customStatus.textContent = data.entries?.[0]?.custom ? "Listo ✓ — mira la tarjeta arriba" : "";
    customStatus.className = "graphify-status done";
  } else {
    status.textContent = "";
    status.className = "graphify-status";
    customStatus.textContent = "";
    customStatus.className = "graphify-status";
  }
}

function renderIdeas() {
  updateIdeasToolbar();
  const wrap = document.getElementById("ideasWrap");
  const data = IDEAS_DATA || { job: { status: "idle" }, entries: [] };
  const running = data.job?.status === "running";

  if (!data.entries?.length) {
    wrap.innerHTML = running
      ? '<div class="skill-empty">Generando tus primeras ideas…</div>'
      : '<div class="skill-empty">Aún no generaste ideas — clic en "Generar ideas de este mes"</div>';
    return;
  }

  const effortLabel = { bajo: "Esfuerzo bajo", medio: "Esfuerzo medio", alto: "Esfuerzo alto" };
  const verdictClass = { "vale la pena": "good", "vale la pena con ajustes": "mixed", "no vale la pena por ahora": "bad" };
  const renderBatch = (batch) => {
    const date = new Date(batch.generatedAt).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" });
    const s = batch.sources || {};
    return `<div class="ideas-batch">
      <span class="ideas-batch-date">${date}${batch.custom ? " · idea propia investigada" : ""}</span>
      ${batch.provider ? `<span class="provider-badge">vía ${escapeHtml(batch.provider)}</span>` : ""}
      <div class="ideas-cards">
        ${(batch.ideas || []).map((idea) => `
          <div class="idea-card">
            ${idea.verdict ? `<span class="idea-verdict ${verdictClass[idea.verdict] || "mixed"}">${escapeHtml(idea.verdict)}</span>` : ""}
            <div class="idea-head">
              <span class="idea-title">${escapeHtml(idea.title || "Sin título")}</span>
              ${idea.effort ? `<span class="idea-effort ${escapeHtml(idea.effort)}">${escapeHtml(effortLabel[idea.effort] || idea.effort)}</span>` : ""}
            </div>
            ${idea.trend ? `<div class="idea-trend">${escapeHtml(idea.trend)}</div>` : ""}
            <p class="idea-why">${escapeHtml(idea.why || "")}</p>
            ${idea.next_step ? `<div class="idea-next"><span class="idea-next-label">Próximo paso</span>${escapeHtml(idea.next_step)}</div>` : ""}
          </div>`).join("")}
      </div>
      <div class="ideas-sources">fuentes: ${fmt(s.localRepos || 0)} repos locales · ${fmt(s.neoRepos || 0)} repos de trabajo · ${fmt(s.remoteRepos || 0)} repos remotos · ${fmt(s.activeProjects || 0)} proyectos activos · ${fmt(s.notes || 0)} notas del vault</div>
    </div>`;
  };

  // Only the latest generation shows expanded by default — every run appends
  // a full batch of cards, so without a cap the section grows unbounded the
  // more you use the "Generar ideas" button.
  const [latest, ...older] = data.entries;
  let html = renderBatch(latest);
  if (older.length) {
    html += `<button id="ideasShowOlder" class="ghost-btn" aria-expanded="${String(appState.ideasShowOlder)}" style="margin-top:1rem">
      ${appState.ideasShowOlder ? "Ocultar generaciones anteriores" : `Ver ${older.length} generación${older.length > 1 ? "es" : ""} anterior${older.length > 1 ? "es" : ""}`}
    </button>`;
    if (appState.ideasShowOlder) html += older.map(renderBatch).join("");
  }
  wrap.innerHTML = html;

  document.getElementById("ideasShowOlder")?.addEventListener("click", () => {
    appState.ideasShowOlder = !appState.ideasShowOlder;
    renderIdeas();
  });
}

async function triggerIdeasGeneration(customIdea) {
  const qs = customIdea ? `?idea=${encodeURIComponent(customIdea)}` : "";
  const res = await dashboardFetch(`/api/ideas/generate${qs}`, { method: "POST" });
  if (res.status === 409) { await loadIdeas(); return; }
  await loadIdeas();
  if (ideasPollTimer) return;
  ideasPollTimer = setInterval(async () => {
    await loadIdeas();
    if (IDEAS_DATA?.job?.status !== "running") { clearInterval(ideasPollTimer); ideasPollTimer = null; loadProviders(); }
  }, 5000);
}

// ─── INTERVIEW PREP ─────────────────────────────────────────────────────────
// Chat de práctica "system design interview". El servidor no mantiene estado
// entre turnos (cada llamada a claude -p reconstruye la transcripción
// completa), así que el frontend solo necesita: mostrar la sesión actual,
// hacer polling mientras el job de un turno está corriendo, y listar el
// historial. `currentInterviewId` persiste en localStorage para poder
// retomar una entrevista en curso tras recargar la página.

let interviewFocus = "general";
let currentInterviewId = localStorage.getItem("claude-dashboard-interview-id") || null;
let CURRENT_INTERVIEW = null;
let INTERVIEW_SESSIONS = [];
let interviewPollTimer = null;
const INTERVIEW_VERDICT_CLASS = { "aprobado": "good", "aprobado con reservas": "mixed", "no aprobado": "bad" };

async function loadInterviewSessions() {
  try {
    const res = await dashboardFetch("/api/interview/sessions");
    const data = await res.json();
    INTERVIEW_SESSIONS = data.sessions || [];
  } catch {
    INTERVIEW_SESSIONS = [];
  }
  renderInterviewHistory();
  if (currentInterviewId && !CURRENT_INTERVIEW) await loadCurrentInterview();
  else renderInterviewChat();
}

function renderInterviewHistory() {
  const wrap = document.getElementById("interviewHistory");
  if (!INTERVIEW_SESSIONS.length) {
    wrap.innerHTML = '<div class="skill-empty">Aún no practicaste ninguna entrevista</div>';
    return;
  }
  const focusLabel = { aws: "AWS", gcp: "GCP", azure: "Azure", kubernetes: "Kubernetes", general: "General" };
  wrap.innerHTML = INTERVIEW_SESSIONS.map((s) => {
    const date = new Date(s.startedAt).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
    const statusText = s.status === "active" ? "en curso" : (s.verdict || "sin veredicto");
    const statusHtml = s.verdict
      ? `<span class="idea-verdict ${INTERVIEW_VERDICT_CLASS[s.verdict] || "mixed"}">${escapeHtml(statusText)}</span>`
      : `<span class="session-meta">${escapeHtml(statusText)}</span>`;
    return `<div class="session-row interview-session-row" data-id="${s.id}">
      <div>
        <span class="session-tag">${focusLabel[s.focus] || s.focus}</span>
        <span class="session-meta">${date} · ${s.turnCount} turno${s.turnCount === 1 ? "" : "s"} · ${s.mistakeCount} error${s.mistakeCount === 1 ? "" : "es"}</span>
      </div>
      ${statusHtml}
    </div>`;
  }).join("");

  wrap.querySelectorAll(".interview-session-row").forEach((row) => {
    row.addEventListener("click", () => {
      currentInterviewId = row.dataset.id;
      localStorage.setItem("claude-dashboard-interview-id", currentInterviewId);
      loadCurrentInterview();
    });
  });
}

async function loadCurrentInterview() {
  if (!currentInterviewId) { CURRENT_INTERVIEW = null; renderInterviewChat(); return; }
  try {
    const res = await dashboardFetch(`/api/interview/session?id=${encodeURIComponent(currentInterviewId)}`);
    if (!res.ok) {
      currentInterviewId = null;
      localStorage.removeItem("claude-dashboard-interview-id");
      CURRENT_INTERVIEW = null;
      renderInterviewChat();
      return;
    }
    CURRENT_INTERVIEW = await res.json();
  } catch {
    CURRENT_INTERVIEW = null;
  }
  renderInterviewChat();
  const running = CURRENT_INTERVIEW?.job?.status === "running";
  if (running && !interviewPollTimer) {
    interviewPollTimer = setInterval(async () => {
      await loadCurrentInterview();
      if (CURRENT_INTERVIEW?.job?.status !== "running") {
        clearInterval(interviewPollTimer);
        interviewPollTimer = null;
        loadInterviewSessions();
      }
    }, 4000);
  }
}

function renderInterviewChat() {
  const chatWrap = document.getElementById("interviewChat");
  const answerBox = document.getElementById("interviewAnswerBox");
  const startBtn = document.getElementById("interviewStart");
  const startStatus = document.getElementById("interviewStatus");
  const cancelBtn = document.getElementById("interviewCancelBtn");
  const respondBtn = document.getElementById("interviewRespond");
  const respondStatus = document.getElementById("interviewRespondStatus");
  const session = CURRENT_INTERVIEW?.session;
  const job = CURRENT_INTERVIEW?.job || { status: "idle" };

  startBtn.disabled = job.status === "running" && !session?.turns?.length;
  startBtn.textContent = job.status === "running" && !session?.turns?.length ? "Preparando…" : "Nueva entrevista";
  cancelBtn.hidden = job.status !== "running";

  if (!session) {
    chatWrap.innerHTML = '<div class="skill-empty">Elige un enfoque arriba y arranca una entrevista nueva.</div>';
    answerBox.hidden = true;
    startStatus.textContent = "";
    return;
  }

  chatWrap.innerHTML = session.turns.map((t) => {
    if (t.role === "candidate") {
      return `<div class="interview-turn candidate">
        <span class="interview-turn-label">Tú</span>
        <div class="interview-turn-body">${escapeHtml(t.content)}</div>
      </div>`;
    }
    const mistakesHtml = t.mistakes?.length
      ? `<div class="interview-mistakes">
          <span class="interview-mistakes-label">Errores en esta respuesta</span>
          <ul>${t.mistakes.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
        </div>`
      : "";
    const verdictHtml = t.verdict
      ? `<div><span class="idea-verdict ${INTERVIEW_VERDICT_CLASS[t.verdict] || "mixed"}">${escapeHtml(t.verdict)}</span></div>`
      : "";
    return `<div class="interview-turn interviewer">
      <span class="interview-turn-label">Entrevistador</span>
      <div class="interview-turn-body">${escapeHtml(t.speak)}</div>
      ${mistakesHtml}
      ${verdictHtml}
    </div>`;
  }).join("");

  if (job.status === "running") {
    chatWrap.innerHTML += `<div class="interview-turn interviewer"><span class="interview-turn-label">Entrevistador</span><div class="interview-turn-body">Pensando…</div></div>`;
  }

  if (session.status === "done" && (session.studyPlan?.length || session.careerGuidance)) {
    chatWrap.innerHTML += renderInterviewReport(session);
  }

  const active = session.status === "active" && job.status !== "running" && session.turns.length > 0;
  answerBox.hidden = !active;
  respondBtn.disabled = job.status === "running";
  respondStatus.textContent = job.status === "error" ? `Falló: ${job.error || "error desconocido"}` : job.status === "cancelled" ? "Cancelado." : "";
  respondStatus.className = job.status === "error" ? "graphify-status error" : "graphify-status";
  startStatus.textContent = job.status === "running" ? "Pensando…" : job.status === "cancelled" ? "Cancelado." : job.status === "error" ? `Falló: ${job.error || "error desconocido"}` : "";
  startStatus.className = job.status === "error" ? "graphify-status error" : "graphify-status";
}

function renderInterviewReport(session) {
  const g = session.careerGuidance;
  const plan = session.studyPlan || [];
  const studyHtml = plan.length
    ? `<div class="interview-study-list">${plan.map((s) => `
        <div class="interview-study-item">
          <span class="interview-study-topic">${escapeHtml(s.topic || "")}</span>
          <p class="interview-study-why">${escapeHtml(s.why || "")}</p>
          <p class="interview-study-how"><span class="interview-study-how-label">Cómo estudiarlo</span>${escapeHtml(s.how_to_study || "")}</p>
        </div>`).join("")}</div>`
    : "";
  const careerHtml = g
    ? `<div class="interview-career-grid">
        <div><span class="interview-career-label">Nivel actual</span>${escapeHtml(g.current_level || "")}</div>
        <div><span class="interview-career-label">Puesto a buscar hoy</span>${escapeHtml(g.target_role_now || "")}</div>
        <div><span class="interview-career-label">Rango Perú (soles/mes)</span>${escapeHtml(g.salary_range_peru_pen || "")}</div>
        <div><span class="interview-career-label">Rango remoto LatAm (USD/mes)</span>${escapeHtml(g.salary_range_remote_usd || "")}</div>
      </div>`
    : "";
  return `<div class="interview-report">
    <span class="card-eyebrow">REPORTE FINAL</span>
    ${careerHtml}
    ${studyHtml ? `<h4 class="interview-report-subtitle">Plan de estudio</h4>${studyHtml}` : ""}
  </div>`;
}

// Burbuja flotante estilo widget de soporte: colapsada por defecto, recuerda
// si estaba abierta (localStorage) para no perder el hilo al recargar, y solo
// carga datos (sesiones + polling) la primera vez que se abre — no tiene
// sentido pedir /api/interview/sessions si el usuario nunca la toca.
let interviewWidgetLoaded = false;

function setupInterviewWidget() {
  const bubble = document.getElementById("interviewBubbleBtn");
  const panel = document.getElementById("interviewPanel");
  const closeBtn = document.getElementById("interviewCloseBtn");

  const open = () => {
    panel.hidden = false;
    bubble.setAttribute("aria-expanded", "true");
    localStorage.setItem("claude-dashboard-interview-open", "1");
    if (!interviewWidgetLoaded) {
      interviewWidgetLoaded = true;
      loadInterviewSessions();
    }
  };
  const close = () => {
    panel.hidden = true;
    bubble.setAttribute("aria-expanded", "false");
    localStorage.removeItem("claude-dashboard-interview-open");
  };

  bubble.addEventListener("click", () => (panel.hidden ? open() : close()));
  // stopPropagation so a future parent click handler can't reopen; CSS [hidden] fix is what makes close visible
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });

  if (localStorage.getItem("claude-dashboard-interview-open") === "1") open();
}

async function startNewInterview() {
  const res = await dashboardFetch("/api/interview/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ focus: interviewFocus }),
  });
  const data = await res.json();
  if (!data.ok) return;
  currentInterviewId = data.sessionId;
  localStorage.setItem("claude-dashboard-interview-id", currentInterviewId);
  await loadCurrentInterview();
}

async function cancelInterview() {
  if (!currentInterviewId) return;
  try {
    await dashboardFetch(`/api/interview/cancel?id=${encodeURIComponent(currentInterviewId)}`, { method: "POST" });
  } catch {}
  if (interviewPollTimer) { clearInterval(interviewPollTimer); interviewPollTimer = null; }
  await loadCurrentInterview();
}

async function sendInterviewAnswer() {
  const input = document.getElementById("interviewAnswerInput");
  const answer = input.value.trim();
  if (!answer || !currentInterviewId) return;
  input.value = "";
  const res = await dashboardFetch(`/api/interview/respond?id=${encodeURIComponent(currentInterviewId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (res.status === 409) return;
  await loadCurrentInterview();
}

// ─── ACCOUNTS ─────────────────────────────────────────────────────────────────

function renderAccounts(accounts) {
  document.getElementById("accountCards").innerHTML = accounts
    .map((a) => {
      const tagBg = a.isCompany ? cssVar("--accent-soft") : cssVar("--ok-soft");
      const tagColor = a.isCompany ? cssVar("--accent") : cssVar("--ok");
      const kind = a.isCompany ? "Cuenta de empresa" : "Cuenta personal";
      return `
    <div class="account-card">
      <span class="account-tag" style="background:${tagBg};color:${tagColor}">${kind} · ${escapeHtml(a.org)}</span>
      <div class="account-email">${escapeHtml(a.email)}</div>
      <div class="account-stats">
        <div><div class="account-stat-num">${fmtCompact(a.usage.freshTokens)}</div><div class="account-stat-label">tokens nuevos</div></div>
        <div><div class="account-stat-num">${fmtCost(a.usage.costUSD || 0)}</div><div class="account-stat-label">costo estimado</div></div>
        <div><div class="account-stat-num">${fmt(a.usage.sessionCount)}</div><div class="account-stat-label">sesiones</div></div>
        <div><div class="account-stat-num">${fmt(a.skills.length)}</div><div class="account-stat-label">skills</div></div>
      </div>
    </div>`;
    })
    .join("");
}

function renderSkills(skills) {
  document.getElementById("skillCount").textContent = `(${skills.length} únicas)`;
  const q = appState.skillQuery.trim().toLowerCase();
  let filtered = q ? skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : skills.slice();

  if (appState.skillSort === "account") {
    filtered.sort((a, b) => (a.accounts[0]?.org || "").localeCompare(b.accounts[0]?.org || "") || a.name.localeCompare(b.name));
  } else if (appState.skillSort === "source") {
    filtered.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  } else {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!filtered.length) {
    document.getElementById("skillsWrap").innerHTML = `<div class="skill-empty">No hay skills que coincidan con "${escapeHtml(appState.skillQuery)}"</div>`;
    return;
  }

  document.getElementById("skillsWrap").innerHTML = `
    <div class="skills-grid">
      ${filtered.map((s) => `
        <div class="skill-chip">
          <div class="skill-name">${escapeHtml(s.name)}</div>
          <div class="skill-desc">${escapeHtml(s.description || "Sin descripción")}</div>
          <div class="skill-badges">
            <span class="skill-badge" style="color:${cssVar("--muted")}">${escapeHtml(s.source)}</span>
            ${s.accounts.map((a) => `<span class="skill-badge" style="background:${a.color}22;color:${a.color}">${escapeHtml(a.org)}</span>`).join("")}
          </div>
        </div>`).join("")}
    </div>`;
}

function renderMcp() {
  const servers = STATE.mcpServers || [];
  document.getElementById("mcpWrap").innerHTML = servers.length ? servers.map((m) => `<div class="mcp-chip"><strong>${escapeHtml(m.name)}</strong><p class="skill-desc">Transporte: ${escapeHtml(m.transport)} · configurado en ${escapeHtml(m.profile)}</p><p class="skill-desc">Configuración detectada. Conexión no verificada.</p></div>`).join("") : '<p class="skill-empty">No hay servidores MCP detectados en las configuraciones locales de Claude.</p>';
}

// Replaces the previous D3 force-directed account→project graph: a
// force-simulated node/link layout looks lively but doesn't actually answer
// "which project used the most tokens" any faster than a sorted list would —
// sorted horizontal bars do, and read correctly for identity-by-color (the
// account pill) without needing a legend since it's already a direct label.
const PROJECT_GRAPH_LIMIT = 12;

function renderProjectGraph(sessions) {
  const el = document.getElementById("projectGraph");
  if (!sessions.length) {
    el.innerHTML = `<div class="skill-empty">Sin datos de sesiones para graficar</div>`;
    return;
  }

  const projectMap = new Map();
  for (const s of sessions) {
    const key = s.accountKey + "|" + s.project;
    if (!projectMap.has(key)) {
      projectMap.set(key, { label: projectLabel(s), accountOrg: s.accountOrg, accountColor: s.accountColor, fresh: 0 });
    }
    projectMap.get(key).fresh += s.totals.fresh || 0;
  }

  const all = [...projectMap.values()].filter((p) => p.fresh > 0).sort((a, b) => b.fresh - a.fresh);
  const projects = all.slice(0, PROJECT_GRAPH_LIMIT);
  const max = projects[0]?.fresh || 1;

  el.innerHTML = projects.map((p) => `
    <div class="model-bar-row">
      <div class="model-bar-top">
        <span class="model-bar-name">${escapeHtml(p.label)} <span class="session-account" style="background:${p.accountColor}22;color:${p.accountColor}">${escapeHtml(p.accountOrg)}</span></span>
        <span class="model-bar-val">${fmtCompact(p.fresh)}</span>
      </div>
      <div class="model-bar-track">
        <div class="model-bar-fill" style="width:${(p.fresh / max) * 100}%; background:${p.accountColor}"></div>
      </div>
    </div>`).join("") + (all.length > PROJECT_GRAPH_LIMIT
    ? `<div class="skill-empty" style="padding-top:0.6rem">+ ${all.length - PROJECT_GRAPH_LIMIT} proyectos más con menos uso</div>`
    : "");
}

function timeAgo(iso) {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days >= 1) return `hace ${days}d`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `hace ${hours}h`;
  return `hace ${Math.max(1, Math.floor(diffMs / 60000))}m`;
}

function renderGraphifyCard(tools) {
  const el = document.getElementById("graphifyCard");
  if (!tools?.graphs) return;

  el.innerHTML = `
    <span class="card-eyebrow">GRAPHIFY · TUS 2 GRAFOS RAÍZ</span>
    <div class="graphify-list">
      ${tools.graphs.map((g) => {
        const running = g.job.status === "running";
        return `
        <div class="graphify-item">
          <div class="graphify-item-head">
            <span class="graphify-item-name">${escapeHtml(g.label)}</span>
            ${g.available ? `<a class="graphify-link" href="/graphify-graph?target=${g.key}" target="_blank" rel="noopener">Abrir ↗</a>` : ""}
          </div>
          <div class="graphify-meta">${
            g.available
              ? `${fmt(g.nodes ?? 0)} nodos · ${fmt(g.links ?? 0)} relaciones · actualizado ${timeAgo(g.updatedAt)}`
              : "Sin grafo generado todavía"
          }</div>
          <button class="graphify-update-btn" data-target="${g.key}" ${running ? "disabled" : ""}>
            ${running ? "Actualizando…" : "Actualizar ahora"}
          </button>
          ${g.job.status === "error" && !running ? `<span class="graphify-status error">Falló la última actualización</span>` : ""}
          ${g.job.status === "done" && !running ? `<span class="graphify-status done">Actualizado ✓</span>` : ""}
        </div>`;
      }).join("")}
    </div>
    <div class="graphify-hint" style="margin-top:0.9rem">
      "Actualizar ahora" usa <code>graphify update</code> si el grafo existe. Una extracción inicial usa Ollama y requiere un entorno configurado. Activa los generadores para ejecutarla.
    </div>`;

  el.querySelectorAll(".graphify-update-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => triggerGraphifyUpdate(btn.dataset.target));
  });
}

let graphifyPollTimer = null;
async function triggerGraphifyUpdate(targetKey) {
  await dashboardFetch(`/api/graphify/update?target=${targetKey}`, { method: "POST" });
  await fetchStats();
  if (graphifyPollTimer) return;
  graphifyPollTimer = setInterval(async () => {
    await fetchStats();
    const stillRunning = STATE.tools.graphs.some((g) => g.job.status === "running");
    if (!stillRunning) { clearInterval(graphifyPollTimer); graphifyPollTimer = null; }
  }, 4000);
}

function renderCommands(tools) {
  document.getElementById("commandsWrap").innerHTML = COMMANDS.map((c) => {
    const hasStatus = c.statusKey && tools && c.statusKey in tools;
    const up = hasStatus ? tools[c.statusKey] : null;
    return `
    <div class="skill-chip command-chip">
      <div class="mcp-head">
        <span class="command-cmd">${escapeHtml(c.cmd)}</span>
        ${hasStatus ? `<span class="command-status ${up ? "up" : "down"}">${up ? "Corriendo" : "Detenido"}</span>` : ""}
      </div>
      <div class="skill-desc">${escapeHtml(c.desc)}</div>
    </div>`;
  }).join("");
}

// ─── HISTORIAL ────────────────────────────────────────────────────────────────

async function loadHistory() {
  if (HISTORY_DATA) { renderHistory(); return; }
  try {
    const res = await dashboardFetch("/api/history");
    HISTORY_DATA = await res.json();
  } catch {
    HISTORY_DATA = [];
  }
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById("historyWrap");
  const toggle = document.getElementById("historyToggle");
  const q = appState.historyQuery.trim().toLowerCase();
  const entries = (HISTORY_DATA || []).filter((e) =>
    !q || (e.display || "").toLowerCase().includes(q) || (e.project || "").toLowerCase().includes(q)
  );

  toggle.textContent = appState.historyRevealed ? "Ocultar historial" : "Mostrar historial";
  toggle.setAttribute("aria-expanded", String(appState.historyRevealed));

  if (!appState.historyRevealed) {
    el.innerHTML = `<div class="skill-empty">${fmt(entries.length)} entradas ocultas — clic en "Mostrar historial" para verlas</div>`;
    return;
  }

  if (!entries.length) {
    el.innerHTML = '<div class="skill-empty">Sin entradas en el historial' + (q ? ` que coincidan con "${escapeHtml(appState.historyQuery)}"` : "") + "</div>";
    return;
  }

  el.innerHTML = '<div class="history-list">' + entries.slice(0, 60).map((e) => {
    const ts = e.timestamp ? new Date(e.timestamp).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const display = (e.display || "").slice(0, 160);
    const project = e.project ? e.project.replace(/.*\//, "") : "";
    return `<div class="history-row">
      <div class="history-content">${escapeHtml(display)}</div>
      <div class="history-meta">${project ? `<span class="history-project">${escapeHtml(project)}</span>` : ""}${ts ? `<span>${ts}</span>` : ""}</div>
    </div>`;
  }).join("") + "</div>";
}

// ─── WORKSPACE ────────────────────────────────────────────────────────────────

async function loadWorkspace() {
  if (WORKSPACE_DATA) { renderWorkspace(); return; }
  try {
    const res = await dashboardFetch("/api/workspace");
    WORKSPACE_DATA = await res.json();
  } catch {
    WORKSPACE_DATA = {};
  }
  renderWorkspace();
}

function fmtBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

function renderWorkspace() {
  const el = document.getElementById("workspaceWrap");
  const ws = WORKSPACE_DATA || {};
  const keys = Object.keys(ws);

  if (!keys.length) {
    el.innerHTML = '<div class="skill-empty">Sin datos de workspace</div>';
    return;
  }

  el.innerHTML = '<div class="workspace-grid">' + keys.map((key) => {
    const p = ws[key];
    const s = p.settings || {};
    return `<div class="workspace-card">
      <div class="workspace-profile-name">${escapeHtml(key)}</div>
      <div class="workspace-stats">
        <div><div class="account-stat-num">${fmt(p.sessionCount || 0)}</div><div class="account-stat-label">sesiones JSONL</div></div>
        <div><div class="account-stat-num">${fmtBytes(p.storageBytes || 0)}</div><div class="account-stat-label">almacenamiento</div></div>
        <div><div class="account-stat-num">${p.skills?.length || 0}</div><div class="account-stat-label">skills</div></div>
        <div><div class="account-stat-num">${s.permissionCount || 0}</div><div class="account-stat-label">permisos</div></div>
      </div>
      <details class="workspace-settings">
        <summary class="ws-summary">Configuración (modelo, statusLine, plugins)</summary>
        ${s.model ? `<div class="ws-row"><span class="ws-key">modelo</span><span class="ws-val">${escapeHtml(s.model)}</span></div>` : ""}
        ${s.theme ? `<div class="ws-row"><span class="ws-key">tema</span><span class="ws-val">${escapeHtml(s.theme)}</span></div>` : ""}
        ${s.statusLine ? `<div class="ws-row"><span class="ws-key">statusLine</span><span class="ws-val">${escapeHtml(s.statusLine)}</span></div>` : ""}
        ${s.enabledPlugins?.length ? `<div class="ws-row"><span class="ws-key">plugins</span><span class="ws-val">${s.enabledPlugins.map((p) => escapeHtml(p)).join(", ")}</span></div>` : ""}
      </details>
    </div>`;
  }).join("") + "</div>";
}

// ─── SESSION REPLAY ───────────────────────────────────────────────────────────

let replayTurns = [];
let replayRevealed = false;
let replayExpanded = new Set();
const REPLAY_PREVIEW_LEN = 800;

async function openReplay(sessionId, title) {
  const modal = document.getElementById("replayModal");
  const body = document.getElementById("replayBody");
  document.getElementById("replayTitle").textContent = title || sessionId;
  body.innerHTML = '<div class="skill-empty">Cargando sesión…</div>';
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  replayRevealed = false;
  replayExpanded = new Set();

  try {
    const res = await dashboardFetch(`/api/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) throw new Error("not found");
    replayTurns = await res.json();
    renderReplay();
  } catch {
    body.innerHTML = '<div class="skill-empty">No se pudo cargar la sesión</div>';
  }
}

function closeReplay() {
  document.getElementById("replayModal").hidden = true;
  document.body.style.overflow = "";
}

// Turns arrive as Claude Code's raw JSONL shape: content is either a plain
// string or an array of blocks (text / tool_use / tool_result — the latter
// carries the actual output of a tool call, as either a string or an array
// of text blocks, and used to be dropped entirely).
function extractTurnParts(t) {
  const raw = t.message?.content;
  const parts = [];
  if (typeof raw === "string") {
    if (raw.trim()) parts.push({ kind: "text", text: raw });
    return parts;
  }
  if (!Array.isArray(raw)) return parts;
  for (const c of raw) {
    if (!c) continue;
    if (c.type === "text" && c.text) {
      parts.push({ kind: "text", text: c.text });
    } else if (c.type === "tool_use") {
      const input = c.input ? JSON.stringify(c.input).slice(0, 200) : "";
      parts.push({ kind: "tool_use", text: `[tool: ${c.name}]${input ? " " + input : ""}` });
    } else if (c.type === "tool_result") {
      let resultText = "";
      if (typeof c.content === "string") resultText = c.content;
      else if (Array.isArray(c.content)) resultText = c.content.filter((x) => x?.type === "text").map((x) => x.text).join("\n");
      parts.push({ kind: "tool_result", text: resultText || "(sin salida de texto)", isError: !!c.is_error });
    }
  }
  return parts;
}

function renderReplay() {
  const body = document.getElementById("replayBody");
  const turns = replayTurns;
  if (!turns.length) { body.innerHTML = '<div class="skill-empty">Sesión sin mensajes visibles</div>'; return; }

  const totalTokens = turns.reduce((sum, t) => {
    const u = t.message?.usage;
    return sum + (u ? (u.input_tokens || 0) + (u.output_tokens || 0) : 0);
  }, 0);

  const gate = `<div class="replay-gate">
    <div class="skill-empty">${fmt(turns.length)} turnos · ${fmtCompact(totalTokens)} tokens — contenido oculto por defecto</div>
    <button id="replayReveal" class="ghost-btn">Mostrar contenido de la conversación</button>
  </div>`;

  if (!replayRevealed) {
    body.innerHTML = gate;
    document.getElementById("replayReveal").addEventListener("click", () => {
      replayRevealed = true;
      renderReplay();
    });
    return;
  }

  body.innerHTML = turns.map((t, i) => {
    const isUser = t.type === "user";
    const parts = extractTurnParts(t);
    if (!parts.length) return "";

    const fullText = parts.map((p) =>
      p.kind === "tool_result" ? `[resultado${p.isError ? " · error" : ""}]\n${p.text}` : p.text
    ).join("\n\n");

    const isLong = fullText.length > REPLAY_PREVIEW_LEN;
    const expanded = replayExpanded.has(i);
    const shown = expanded || !isLong ? fullText : fullText.slice(0, REPLAY_PREVIEW_LEN) + "…";

    const usage = t.message?.usage;
    const tokens = usage ? `${(usage.input_tokens || 0) + (usage.output_tokens || 0)} tok` : "";
    return `<div class="replay-turn ${isUser ? "user" : "assistant"}">
      <div class="replay-role">${isUser ? "Tú" : "Claude"}${tokens ? `<span class="replay-tokens">${tokens}</span>` : ""}</div>
      <div class="replay-content">${escapeHtml(shown)}</div>
      ${isLong ? `<button class="ghost-btn replay-expand-btn" data-turn-index="${i}">${expanded ? "Mostrar menos" : "Mostrar completo"}</button>` : ""}
    </div>`;
  }).filter(Boolean).join("");

  body.querySelectorAll(".replay-expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.turnIndex);
      if (replayExpanded.has(idx)) replayExpanded.delete(idx);
      else replayExpanded.add(idx);
      renderReplay();
    });
  });
}

// ─── TOOLBAR & EVENTS ─────────────────────────────────────────────────────────

function setupToolbar() {
  document.getElementById("rangeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    document.querySelectorAll("#rangeSeg button").forEach((b) => { b.classList.remove("active"); b.removeAttribute("aria-current"); });
    btn.classList.add("active");
    btn.setAttribute("aria-current", "true");
    appState.range = btn.dataset.range;
    appState.openDay = null;
    document.getElementById("drilldown").hidden = true;
    fetchStats({ dim: true });
  });

  document.getElementById("accountFilter").addEventListener("change", (e) => {
    appState.account = e.target.value;
    fetchStats({ dim: true });
  });

  document.getElementById("refreshSelect").addEventListener("change", (e) => {
    setupAutoRefresh(Number(e.target.value));
  });

  document.getElementById("skillSearch").addEventListener("input", (e) => {
    appState.skillQuery = e.target.value;
    renderSkills(STATE.skills);
  });
  document.getElementById("skillSort").addEventListener("change", (e) => {
    appState.skillSort = e.target.value;
    renderSkills(STATE.skills);
  });

  document.getElementById("drilldownClose").addEventListener("click", () => {
    appState.openDay = null;
    document.getElementById("drilldown").hidden = true;
  });

  document.getElementById("replayClose").addEventListener("click", closeReplay);
  document.getElementById("replayModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeReplay();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeReplay();
  });

  document.getElementById("historySearch").addEventListener("input", (e) => {
    appState.historyQuery = e.target.value;
    if (e.target.value.trim()) appState.historyRevealed = true;
    renderHistory();
  });

  document.getElementById("historyToggle").addEventListener("click", () => {
    appState.historyRevealed = !appState.historyRevealed;
    renderHistory();
  });

  // Lazy-load history and workspace when scrolled into view
  const lazyLoad = (id, loader) => {
    const el = document.getElementById(id);
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { loader(); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
  };

  lazyLoad("historial", loadHistory);
  lazyLoad("workspace", loadWorkspace);
  lazyLoad("ideas-ia", loadIdeas);
  lazyLoad("auditoria", loadAudit);
  lazyLoad("mis-proyectos", loadProjectStatus);
  setupInterviewWidget();

  document.getElementById("interviewStart").addEventListener("click", startNewInterview);
  document.getElementById("interviewRespond").addEventListener("click", sendInterviewAnswer);
  document.getElementById("interviewCancelBtn").addEventListener("click", cancelInterview);
  document.getElementById("interviewFocusToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".org-toggle-btn");
    if (!btn || btn.classList.contains("active")) return;
    document.querySelectorAll("#interviewFocusToggle .org-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
    interviewFocus = btn.dataset.focus;
  });

  document.getElementById("ideasGenerate").addEventListener("click", () => triggerIdeasGeneration());
  document.getElementById("customIdeaGenerate").addEventListener("click", () => {
    const input = document.getElementById("customIdeaInput");
    const idea = input.value.trim();
    if (!idea) { input.focus(); return; }
    triggerIdeasGeneration(idea);
    input.value = "";
  });
  document.getElementById("projectStatusGenerate").addEventListener("click", triggerProjectStatusGeneration);
  document.getElementById("projectOrgToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".org-toggle-btn");
    if (!btn || btn.classList.contains("active")) return;
    document.querySelectorAll(".org-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
    appState.projectOrg = btn.dataset.org;
    renderGithubProjects(PROJECTS_DATA);
  });
}

function setupAutoRefresh(ms) {
  if (refreshTimer) clearInterval(refreshTimer);
  if (ms > 0) refreshTimer = setInterval(fetchStats, ms);
}

// ─── GITHUB PROJECTS ─────────────────────────────────────────────────────────

let PROJECT_STATUS_DATA = null;
let projectStatusPollTimer = null;
let claudeMdPollTimer = null;
const claudeMdPending = new Set(); // keys ("org/name") currently being generated, per-card only — never triggers a full grid rebuild while running

async function fetchProjects() {
  try {
    const res = await dashboardFetch("/api/projects");
    PROJECTS_DATA = await res.json();
    renderGithubProjects(PROJECTS_DATA);
  } catch {}
}

// Polling ticks every 5s while a job runs — rebuilding the whole card grid (dozens of
// nodes, text-heavy since the AI analysis was added) on every tick is real, avoidable
// jank. Only do the expensive full render when something a card actually shows changed;
// otherwise just touch the toolbar button/status text.
async function loadProjectStatus() {
  const prevStatus = PROJECT_STATUS_DATA?.job?.status;
  const prevGeneratedAt = PROJECT_STATUS_DATA?.generatedAt;
  try {
    const res = await dashboardFetch("/api/project-status");
    PROJECT_STATUS_DATA = await res.json();
  } catch {
    PROJECT_STATUS_DATA = { job: { status: "idle" }, generatedAt: null, entries: [] };
  }
  const changed = PROJECT_STATUS_DATA.job.status !== prevStatus || PROJECT_STATUS_DATA.generatedAt !== prevGeneratedAt;
  if (changed) renderGithubProjects(PROJECTS_DATA);
  else updateProjectStatusToolbar();
}

async function triggerProjectStatusGeneration() {
  const res = await dashboardFetch("/api/project-status/generate", { method: "POST" });
  if (res.status === 409) { await loadProjectStatus(); return; }
  await loadProjectStatus();
  if (projectStatusPollTimer) return;
  projectStatusPollTimer = setInterval(async () => {
    await loadProjectStatus();
    if (PROJECT_STATUS_DATA?.job?.status !== "running") { clearInterval(projectStatusPollTimer); projectStatusPollTimer = null; loadProviders(); }
  }, 5000);
}

function updateProjectStatusToolbar() {
  const btn = document.getElementById("projectStatusGenerate");
  const status = document.getElementById("projectStatusStatus");
  const job = PROJECT_STATUS_DATA?.job || { status: "idle" };
  const running = job.status === "running";
  if (btn) {
    btn.disabled = running;
    btn.textContent = running ? "Analizando…" : "Generar análisis";
  }
  if (status) {
    if (running) { status.textContent = "Puede tardar hasta 3 minutos"; status.className = "graphify-status"; }
    else if (job.status === "error") { status.textContent = "Falló: " + (job.error || "error desconocido"); status.className = "graphify-status error"; }
    else if (PROJECT_STATUS_DATA?.generatedAt) {
      status.textContent = "Analizado " + new Date(PROJECT_STATUS_DATA.generatedAt).toLocaleDateString("es-PE", { day: "numeric", month: "short" });
      status.className = "graphify-status done";
    } else { status.textContent = ""; status.className = "graphify-status"; }
  }
}

function triggerClaudeMdGeneration(org, name, btn) {
  const key = `${org}/${name}`;
  claudeMdPending.add(key);
  btn.disabled = true;
  btn.textContent = "Generando…";
  dashboardFetch(`/api/project-claude-md/generate?org=${encodeURIComponent(org)}&repo=${encodeURIComponent(name)}`, { method: "POST" });
  if (claudeMdPollTimer) return;
  claudeMdPollTimer = setInterval(async () => {
    let jobs = {};
    try { jobs = await (await dashboardFetch("/api/project-claude-md/jobs")).json(); } catch {}
    let anyPending = false;
    for (const key of [...claudeMdPending]) {
      const job = jobs[key];
      if (!job || job.status === "running") { anyPending = true; continue; }
      claudeMdPending.delete(key);
      if (job.status === "done") { fetchProjects(); continue; } // one full refresh, only when a job actually finished
      const failedBtn = document.querySelector(`[data-create-claude-md="${key}"]`);
      if (failedBtn) { failedBtn.disabled = false; failedBtn.textContent = "+ Generar CLAUDE.md"; failedBtn.title = job.error || "falló"; }
    }
    if (!anyPending) { clearInterval(claudeMdPollTimer); claudeMdPollTimer = null; }
  }, 5000);
}

function renderGithubProjects(projects) {
  updateProjectStatusToolbar();
  const wrap = document.getElementById("githubProjectsWrap");
  if (!wrap) return;
  if (!projects || !projects.length) { wrap.innerHTML = '<div class="skill-empty">No se encontraron proyectos en ~/dev/GitHub ni ~/dev/Work</div>'; return; }

  const org = appState.projectOrg || "personal";
  const filtered = projects.filter((p) => (p.org || "personal") === org);
  if (!filtered.length) { wrap.innerHTML = `<div class="skill-empty">Sin proyectos en esta categoría</div>`; return; }

  const analysisByKey = new Map((PROJECT_STATUS_DATA?.entries || []).map((e) => [`${e.org}/${e.name}`, e]));

  wrap.innerHTML = `<div class="skills-grid">${filtered.map((p) => {
    const key = `${p.org}/${p.name}`;
    const a = analysisByKey.get(key);
    return `
    <div class="project-card${p.hasDoc ? "" : " project-card--nodoc"}"
         data-org="${escapeHtml(p.org)}"
         ${p.content ? `data-project="${escapeHtml(p.name)}"` : ""}
         style="cursor:${p.content ? "pointer" : "default"}">
      <div class="project-card-header">
        <span class="project-dot ${p.hasDoc ? "dot-green" : "dot-red"}"></span>
        <span class="project-name">${escapeHtml(p.name)}</span>
      </div>
      <div class="project-card-sub">${p.hasDoc ? "CLAUDE.md ✓" : "sin instrucciones"}${p.hasPrivateNote ? ' · <span class="project-note-badge">nota privada ✓</span>' : ""}</div>
      ${a ? `
        <p class="project-desc">${escapeHtml(a.description || "")}${PROJECT_STATUS_DATA?.provider ? `<span class="provider-badge">vía ${escapeHtml(PROJECT_STATUS_DATA.provider)}</span>` : ""}</p>
        <div class="project-progress-row"><span>Avance</span><span class="project-progress-val">${fmt(a.progress_pct ?? 0)}%</span></div>
        <div class="model-bar-track"><div class="model-bar-fill" style="width:${Math.max(0, Math.min(100, a.progress_pct ?? 0))}%;background:var(--accent)"></div></div>
        ${a.progress_reasoning ? `<div class="project-progress-reasoning">${escapeHtml(a.progress_reasoning)}</div>` : ""}
        ${a.improvements?.length ? `<ul class="project-improvements">${a.improvements.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : ""}
        ${a.skill_suggestion ? `<div class="project-skill-suggestion ${a.skill_is_new ? "is-new" : ""}">
          <span class="project-skill-tag">${a.skill_is_new ? "Skill nueva sugerida" : "Skill que ya tienes"}</span>
          <span class="project-skill-name">${escapeHtml(a.skill_suggestion)}</span>
          ${a.skill_purpose ? `<p class="project-skill-purpose"><span class="project-skill-label">Sirve para</span>${escapeHtml(a.skill_purpose)}</p>` : ""}
          ${a.skill_reason ? `<p class="project-skill-reason"><span class="project-skill-label">Por qué aquí</span>${escapeHtml(a.skill_reason)}</p>` : ""}
        </div>` : ""}
      ` : ""}
      <div class="project-card-actions">
        ${!p.hasDoc ? `<button class="ghost-btn" data-create-claude-md="${escapeHtml(key)}" ${claudeMdPending.has(key) ? "disabled" : ""}>${claudeMdPending.has(key) ? "Generando…" : "+ Generar CLAUDE.md"}</button>` : ""}
        ${!p.hasPrivateNote ? `<button class="ghost-btn" data-create-note="${escapeHtml(p.org)}/${escapeHtml(p.name)}">+ Nota privada</button>` : ""}
      </div>
    </div>`;
  }).join("")}
  </div>`;

  wrap.querySelectorAll("[data-project]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-create-note], [data-create-claude-md]")) return;
      openProjectModal(card.dataset.project, card.dataset.org);
    });
  });
  wrap.querySelectorAll("[data-create-note]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const [org, name] = btn.dataset.createNote.split("/");
      btn.disabled = true;
      btn.textContent = "Creando…";
      try {
        await dashboardFetch(`/api/project-notes/create?org=${encodeURIComponent(org)}&repo=${encodeURIComponent(name)}`, { method: "POST" });
        await fetchProjects();
      } catch { btn.disabled = false; btn.textContent = "+ Nota privada"; }
    });
  });
  wrap.querySelectorAll("[data-create-claude-md]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const [org, name] = btn.dataset.createClaudeMd.split("/");
      triggerClaudeMdGeneration(org, name, btn);
    });
  });
}

function openProjectModal(name, org) {
  const project = PROJECTS_DATA?.find((p) => p.name === name && (!org || p.org === org));
  if (!project?.content) return;
  document.getElementById("projectModalTitle").textContent = name;
  const body = document.getElementById("projectModalBody");
  const pre = document.createElement("pre");
  pre.className = "project-document";
  pre.textContent = project.content;
  body.replaceChildren(pre);
  document.getElementById("projectModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeProjectModal() {
  document.getElementById("projectModal").hidden = true;
  document.body.style.overflow = "";
}

// ─── AUDITORÍA DE REPOS ─────────────────────────────────────────────────────

let AUDIT_DATA = null;
let auditPollTimer = null;

async function loadAudit() {
  try {
    const res = await dashboardFetch("/api/repo-audit");
    AUDIT_DATA = await res.json();
  } catch {
    AUDIT_DATA = { entries: [], jobs: {} };
  }
  renderAudit();
}

function fmtDaysAgo(days) {
  if (days === null || days === undefined) return "sin commits";
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${fmt(days)}d`;
}

const AUDIT_REC = {
  "uso activo": { label: "Uso activo", cls: "ok" },
  "mantener": { label: "Mantener", cls: "ok" },
  "revisar": { label: "Revisar", cls: "warn" },
  "sin respaldo remoto": { label: "Sin respaldo", cls: "crit" },
  "cambios sin subir": { label: "Cambios sin subir", cls: "warn" },
  "candidata a archivar": { label: "Candidata a archivar", cls: "warn" },
};

function renderAudit() {
  const wrap = document.getElementById("auditWrap");
  const data = AUDIT_DATA || { entries: [], jobs: {} };

  if (!data.entries.length) {
    wrap.innerHTML = '<div class="skill-empty">Escaneando repos…</div>';
    return;
  }

  const sorted = [...data.entries].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = sorted.reduce((s, r) => s + r.sizeBytes, 0);

  let html = `<div class="insights-meta"><span>${fmt(sorted.length)} repos</span><span>${fmtBytes(totalBytes)} en total</span></div>`;
  html += `<div class="audit-table-wrap"><table class="audit-table"><thead><tr>
    <th>Repo</th><th>Cuenta</th><th>Tamaño</th><th>Último commit</th><th>Estado</th><th>Recomendación</th><th>Acciones</th>
  </tr></thead><tbody>`;

  for (const r of sorted) {
    const key = `${r.org}/${r.name}`;
    const job = data.jobs?.[key];
    const pushRunning = job?.action === "push" && job.status === "running";
    const rec = AUDIT_REC[r.recommendation] || { label: r.recommendation, cls: "warn" };
    const statusText = r.dirty
      ? "cambios sin commitear"
      : r.hasRemote
        ? ((r.aheadOfRemote ?? 0) > 0 ? `${r.aheadOfRemote} commits sin subir` : "al día")
        : "sin remoto";

    html += `<tr data-repo="${escapeHtml(r.name)}" data-org="${escapeHtml(r.org)}">
      <td class="audit-name">${escapeHtml(r.name)}</td>
      <td>${r.org === "neo" ? "trabajo" : "personal"}</td>
      <td class="mono">${fmtBytes(r.sizeBytes)}</td>
      <td class="mono">${fmtDaysAgo(r.daysSinceCommit)}</td>
      <td>${escapeHtml(statusText)}</td>
      <td><span class="audit-rec ${rec.cls}">${escapeHtml(rec.label)}</span></td>
      <td class="audit-actions">
        <button class="ghost-btn audit-push-btn" ${pushRunning ? "disabled" : ""}>${pushRunning ? "Subiendo…" : r.dirty ? "Commit + push" : r.hasRemote ? "Push" : "Subir a GitHub"}</button>
        <span class="audit-readonly">Borrado desactivado</span>
      </td>
    </tr>`;
    if (job?.status === "error") {
      html += `<tr><td colspan="7"><span class="graphify-status error">${escapeHtml(r.name)}: ${escapeHtml(job.error || "error")}</span></td></tr>`;
    }
  }
  html += "</tbody></table></div>";
  wrap.innerHTML = html;

  wrap.querySelectorAll(".audit-push-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const row = e.target.closest("tr");
      triggerRepoPush(row.dataset.org, row.dataset.repo);
    });
  });
  wrap.querySelectorAll(".audit-delete-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const row = e.target.closest("tr");
      promptRepoDelete(row.dataset.org, row.dataset.repo);
    });
  });
}

async function triggerRepoPush(org, repo) {
  await dashboardFetch(`/api/repo-audit/push?org=${encodeURIComponent(org)}&repo=${encodeURIComponent(repo)}`, { method: "POST" });
  await loadAudit();
  if (auditPollTimer) return;
  auditPollTimer = setInterval(async () => {
    await loadAudit();
    const stillRunning = Object.values(AUDIT_DATA?.jobs || {}).some((j) => j.status === "running");
    if (!stillRunning) { clearInterval(auditPollTimer); auditPollTimer = null; }
  }, 4000);
}

function promptRepoDelete(org, repo) {
  const typed = window.prompt(`Esto borra "${repo}" de tu disco de forma permanente (ya verificamos que está 100% respaldado en GitHub). Escribe "${repo}" para confirmar:`);
  if (typed !== repo) return;
  dashboardFetch(`/api/repo-audit/delete?org=${encodeURIComponent(org)}&repo=${encodeURIComponent(repo)}&confirm=${encodeURIComponent(typed)}`, { method: "POST" })
    .then((res) => res.json())
    .then((result) => {
      if (!result.ok) { window.alert("No se pudo borrar: " + result.error); return; }
      loadAudit();
      fetchProjects();
    });
}

// ─── TIER TABS (IA en 4 planos) ─────────────────────────────────────────────
// The page used to be one long scroll through ~17 sections. Grouped instead
// into 4 tabs by how often each thing actually changes — daily pulse, weekly
// analysis, monthly inventory, yearly-stable environment — so a glance only
// has to scan the tier that matches what you're checking right now. Sections
// carry their tier via [data-tier]; nothing about their own render logic
// changes, only which ones are visible.
const TIER_STORAGE_KEY = "claude-dashboard-tier";
const TIERS = ["kanban", "daily", "agents", "radar", "weekly", "monthly", "yearly"];

function setupTierTabs() {
  const tabs = [...document.querySelectorAll("#tierTabs .tier-tab")];
  if (!tabs.length) return;
  // Navigate before the connection inventory, especially when opening Radar.
  document.getElementById("appError").before(document.getElementById("tierTabs"));
  tabs.forEach((btn) => btn.addEventListener("click", () => applyTier(btn.dataset.tier)));
  tabs.forEach((btn, index) => btn.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next == null) return;
    event.preventDefault();
    tabs[next].focus();
    applyTier(tabs[next].dataset.tier, { skipScroll: true });
  }));

  let initial = null;
  try { initial = localStorage.getItem(TIER_STORAGE_KEY); } catch {}
  applyTier(TIERS.includes(initial) ? initial : "daily", { skipScroll: true });
}

function applyTier(tier, { skipScroll = false } = {}) {
  if (!TIERS.includes(tier)) return;

  // The day drilldown lives in the "daily" tier — closing it when leaving
  // reuses the exact same close semantics as its own "Cerrar" button, so
  // there's no separate hidden-state to fall out of sync with.
  if (tier !== "daily" && appState.openDay) {
    appState.openDay = null;
    document.getElementById("drilldown").hidden = true;
  }

  document.querySelectorAll("main > [data-tier]").forEach((sec) => {
    sec.style.display = sec.dataset.tier === tier ? "" : "none";
  });
  document.querySelectorAll("#tierTabs .tier-tab").forEach((btn) => {
    const active = btn.dataset.tier === tier;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
  });

  appState.tier = tier;
  document.body.dataset.section = tier;
  document.querySelector(".agents-section").hidden = !["daily", "agents"].includes(tier);
  document.querySelector(".toolbar").hidden = ["radar", "kanban"].includes(tier);
  document.querySelector(".hero-row").hidden = ["radar", "kanban"].includes(tier);
  document.dispatchEvent(new CustomEvent("dashboard:tier", { detail: tier }));
  try { localStorage.setItem(TIER_STORAGE_KEY, tier); } catch {}

  revealTier(tier);
  if (!skipScroll) {
    document.getElementById("tierTabs").scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }
}

// A tab switch swaps which sections are in the flow, so there's no scroll
// position for ScrollTrigger to key off — a plain fade-in on the newly shown
// sections replaces the old scroll-triggered reveal.
function revealTier(tier) {
  // Tabs switch synchronously, without decorative or layout animation.
}

function revealHero() {
  // Product UI loads directly into the task, without entrance choreography.
}

const PROVIDER_ACTION_LABEL = { ideas: "ideas", estado: "estado" };

async function loadProviders() {
  const el = document.getElementById("providerStatus");
  if (!el) return;
  try {
    const res = await dashboardFetch("/api/providers");
    const data = await res.json();
    const grokPart = `Grok CLI: ${data.grokCli ? "ok" : "no encontrado"}`;
    if (data.demo && !document.getElementById('demoBanner')) {
      const banner = document.createElement('div'); banner.id = 'demoBanner'; banner.className = 'demo-banner'; banner.textContent = 'DEMO · datos de ejemplo · tus archivos reales no se leen'; document.querySelector('main').prepend(banner);
    }
    const lastPart = data.lastGeneration?.provider
      ? ` · Última generación: ${data.lastGeneration.provider} · ${PROVIDER_ACTION_LABEL[data.lastGeneration.action] || data.lastGeneration.action}`
      : "";
    el.textContent = `${data.aiEnabled ? 'Generación IA activa' : 'Generación IA desactivada'} · ${grokPart}${lastPart}`;
  } catch {
    el.textContent = "";
  }
}

async function boot() {
  setupToolbar();
  setupAgentDetailTabs();
  setupTierTabs();
  document.getElementById("refreshAgents").addEventListener("click", () => fetchStats({ dim: true }));
  await fetchStats();
  revealHero();
  setupAutoRefresh(30000);
  fetchProjects();
  setInterval(fetchProjects, 60000); // refresca proyectos cada 60s automáticamente
  loadProviders();
}
let agentsBusy = false;
let agentsData = null;
let agentDetailId = "codex";
function providerMark(id) {
  const assets = { claude: 'claude.png', codex: 'codex.png', grok: 'grok.svg', agy: 'agy.png' };
  if (!assets[id]) return '<span class="provider-logo" aria-hidden="true">Tú</span>';
  const image = `<img src="/logos/${assets[id]}" alt="" width="24" height="24" />`;
  return `<span class="provider-logo provider-${id}" aria-hidden="true">${id === 'codex' ? `<img class="codex-dark-logo" src="/logos/codex-dark.png" alt="" width="24" height="24" /><span class="codex-light-logo">${image}</span>` : image}</span>`;
}

function claudeReferenceValue(totals) {
  const p = STATE.pricing || {};
  if (p.totalTokens && !p.knownTokens) return "N/D";
  const prefix = p.unknownModels?.length ? "≥ " : "";
  const value = totals.costUSD || 0;
  return prefix + (p.unknownCacheMaxDeltaUSD > 0 ? `${fmtCost(value)}–${fmtCost(value + p.unknownCacheMaxDeltaUSD)}` : fmtCost(value));
}
function renderPricingDetail() {
  const p = STATE.pricing || {};
  const rows = Object.entries(STATE.byModel || {}).sort(([, a], [, b]) => (b.costUSD || 0) - (a.costUSD || 0));
  document.getElementById("pricingDetail").innerHTML = `<p class="agents-note">Cobertura de tarifas: ${p.tokenPercent == null ? "sin tokens" : `${p.tokenPercent.toFixed(2)}% de tokens`}. Verificado ${escapeHtml(p.verifiedAt || "sin fecha")}. Precios actuales aplicados a los registros del rango, no facturación histórica. Si falta duración de caché, el valor es un intervalo. <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener noreferrer">Fuente oficial de precios</a>.</p><div class="agent-table-scroll"><table class="agent-table"><caption class="sr-only">Desglose de referencia API por modelo Claude</caption><thead><tr><th>Modelo</th><th>Input</th><th>Output</th><th>Caché 5m</th><th>Caché 1h</th><th>TTL sin dato</th><th>Lectura caché</th><th>Base API, USD</th></tr></thead><tbody>${rows.map(([model, m]) => `<tr><th scope="row">${escapeHtml(model)}</th><td>${fmtCompact(m.input)}</td><td>${fmtCompact(m.output)}</td><td>${fmtCompact(Math.max(0, m.cacheCreate - (m.cache1h || 0) - (m.cacheUnknown || 0)))}</td><td>${fmtCompact(m.cache1h)}</td><td>${fmtCompact(m.cacheUnknown)}</td><td>${fmtCompact(m.cacheRead)}</td><td>${p.unknownModels?.includes(model) ? "N/D" : `${m.cacheUnknown ? "≥ " : ""}${fmtCost(m.costUSD)}`}</td></tr>`).join("")}</tbody></table></div>`;
}
function setupAgentDetailTabs() {
  const tabs = [...document.querySelectorAll("[data-detail]")];
  const select = (id) => {
    agentDetailId = id;
    tabs.forEach((tab) => { const selected = tab.dataset.detail === id; tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1; tab.classList.toggle("active", selected); });
    document.getElementById("agentDetail").setAttribute("aria-labelledby", `detail-${id}`);
    renderAgentDetail();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.detail));
    tab.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
      if (next == null) return;
      event.preventDefault(); select(tabs[next].dataset.detail); tabs[next].focus();
    });
  });
  select(agentDetailId);
}
function renderAgentDetail() {
  const el = document.getElementById("agentDetail");
  const p = agentsData?.providers.find((p) => p.id === agentDetailId);
  if (!p) return;
  if (!p.enabled || !p.available) { el.innerHTML = `<p class="skill-empty">${!p.enabled ? `Agrega ${escapeHtml(p.name)} en Tus agentes para consultar sus registros.` : "No se encontraron registros en la fuente configurada."}</p>`; return; }
  const monetary = (value) => value == null ? "N/D" : fmtCost(value);
  const smallProject = (value) => value ? value.split(/[\\/]/).filter(Boolean).pop() : "Sin proyecto registrado";
  const dateTime = (value) => value ? new Date(value).toLocaleString(LOCALE) : "N/D";
  const table = (headers, rows, caption) => `<div class="agent-table-scroll"><table class="agent-table"><caption class="sr-only">${caption}</caption><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const metrics = [
    ["Sesiones", fmt(p.sessionCount)], ["Tokens registrados", p.tokens ? fmtCompact(p.tokens.total) : "N/D"],
    ["Input sin caché", p.tokens ? fmtCompact(p.tokens.input) : "N/D"], ["Output", p.tokens ? fmtCompact(p.tokens.output) : "N/D"], ["Lectura de caché", p.tokens ? fmtCompact(p.tokens.cacheRead) : "N/D"],
    [p.id === "grok" ? `Costo registrado · ${p.costSessions}/${p.sessionCount} sesiones` : "Costo registrado del plan", monetary(p.costUSD)],
  ];
  if (p.id === "codex") metrics.push(["Equivalente base API", `${p.referenceUSD != null && p.unpricedTokens ? "≥ " : ""}${monetary(p.referenceUSD)}`]);
  if (p.activityAvailable) metrics.push(["Mensajes registrados", fmt(p.messages)], ["Herramientas registradas", fmt(p.tools)]);
  let quota = "";
  if (p.id === "codex") {
    const q = p.quota;
    quota = `<div class="agent-quota"><h3>Cuotas observadas de Codex</h3>${q ? `<p class="agents-note">Último estado: ${escapeHtml(dateTime(q.observedAt))} · plan ${escapeHtml(q.plan || "sin dato")} · sesión en ${escapeHtml(smallProject(q.project))}. No se verifica la cuenta ni se mezclan planes. No es una lectura en vivo; consulta <code>/status</code> para el estado actual.</p><div class="quota-windows">${[q.primary, q.secondary].filter(Boolean).map((w) => `<div><label>${w.windowMinutes ? w.windowMinutes === 10080 ? "Ventana semanal" : `Ventana de ${fmt(w.windowMinutes / 60)} horas` : "Ventana registrada"}: ${w.usedPercent}% usado <progress value="${w.usedPercent}" max="100">${w.usedPercent}%</progress></label><p>Reset registrado: ${escapeHtml(dateTime(w.resetsAt))}${w.resetsAt && new Date(w.resetsAt).valueOf() < Date.now() ? " (ya pasó; estado antiguo)" : ""}</p></div>`).join("")}</div>` : '<p class="agents-note">No hay snapshots de cuotas. Consulta <code>/status</code> en Codex.</p>'}</div>`;
  }
  const modelRows = p.byModel.map((m) => `<tr><th scope="row">${escapeHtml(m.model)}</th><td>${m.tokens ? fmtCompact(m.tokens.input) : "N/D"}</td><td>${m.tokens ? fmtCompact(m.tokens.output) : "N/D"}</td><td>${m.tokens ? fmtCompact(m.tokens.cacheRead) : "N/D"}</td><td>${m.tokens ? fmtCompact(m.tokens.total) : "N/D"}</td><td>${monetary(p.id === "codex" ? m.referenceUSD : m.costUSD)}</td></tr>`);
  const dayRows = p.byDay.slice(-31);
  const activityValue = (d) => p.tokens ? d.tokens?.total || 0 : d.messages + d.tools;
  const maximum = Math.max(1, ...dayRows.map(activityValue));
  const days = dayRows.length ? `<div class="agent-day-chart" aria-label="${p.tokens ? "Tokens" : "Actividad"} por día UTC">${dayRows.map((d) => `<div class="agent-day"><span>${escapeHtml(d.day)}</span><div class="agent-day-track"><span style="width:${100 * activityValue(d) / maximum}%"></span></div><strong>${fmtCompact(activityValue(d))}</strong></div>`).join("")}</div>` : '<p class="skill-empty">Sin actividad fechada en este rango.</p>';
  const projects = table(["Proyecto", "Sesiones", "Tokens", "Mensajes", "Herramientas"], p.byProject.slice(0, 15).map((r) => `<tr><th scope="row" title="${escapeHtml(r.project)}">${escapeHtml(smallProject(r.project))}</th><td>${fmt(r.sessionCount)}</td><td>${r.tokens ? fmtCompact(r.tokens.total) : "N/D"}</td><td>${p.activityAvailable ? fmt(r.messages) : "N/D"}</td><td>${p.activityAvailable ? fmt(r.tools) : "N/D"}</td></tr>`), "Uso por proyecto, hasta 15 proyectos");
  const sessions = table(["Proyecto / sesión", "Última actividad", "Modelos observados", "Tokens de sesión", p.id === "codex" ? "Base API, USD" : "Costo registrado, USD"], p.sessions.map((s) => `<tr><td>${escapeHtml(smallProject(s.project) === "Sin proyecto registrado" ? s.id.split(":").slice(1).join(":").slice(0, 8) : smallProject(s.project))}</td><td>${escapeHtml(dateTime(s.lastAt))}</td><td>${escapeHtml(s.models?.length ? s.models.join(", ") : s.model)}</td><td>${s.tokens ? fmtCompact(s.tokens.total) : "N/D"}</td><td>${monetary(p.id === "codex" ? s.referenceUSD : s.costUSD)}</td></tr>`), "Sesiones recientes, valores de toda su duración");
  el.innerHTML = `<dl class="agent-detail-metrics">${metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl><p class="agents-note">Cobertura de tokens: ${p.measuredSessions}/${p.sessionCount} sesiones. ${p.id === "codex" ? `${escapeHtml(p.reference.note)} ${p.unpricedTokens ? `${fmt(p.unpricedTokens)} tokens sin precio.` : ""} <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener noreferrer">Tarifas oficiales</a>.` : p.id === "grok" ? 'Costo reportado en registros, con cobertura parcial, no factura del plan. <a href="https://docs.x.ai/developers/cost-tracking" target="_blank" rel="noopener noreferrer">1 USD = 10¹⁰ ticks</a>.' : "Fuente: Antigravity CLI, no Antigravity IDE. Tokens, costos, cuotas y proyecto N/D cuando el registro no los incluye."}</p>${quota}<details class="agent-breakdown" open><summary>Por modelo</summary>${modelRows.length ? table(["Modelo", "Input", "Output", "Caché", "Total", p.id === "codex" ? "Base API, USD" : "Registrado, USD"], modelRows, "Uso por modelo del turno") : '<p class="agents-note">El registro no contiene modelo y tokens verificables.</p>'}${p.observedModels.length ? `<p class="agents-note">Modelos observados en sesiones del rango: ${p.observedModels.map(escapeHtml).join(", ")}.</p>` : ""}</details><details class="agent-breakdown" open><summary>${p.tokens ? "Tokens" : "Mensajes + herramientas"} por día UTC, últimos 31 días con datos</summary>${days}</details><details class="agent-breakdown"><summary>Por proyecto, hasta 15</summary>${projects}</details><details class="agent-breakdown"><summary>Sesiones recientes, hasta 24</summary><p class="agents-note">Tokens y valores monetarios de toda la sesión, no solo del rango seleccionado.</p>${sessions}</details>`;
}
async function loadAgents() {
  if (agentsBusy) return;
  agentsBusy = true;
  try {
    const response = await dashboardFetch(`/api/agents?days=${appState.range}`);
    const data = await response.json();
    agentsData = data;
    renderAgentDetail();
    const claude = { id: "claude", name: "Claude Code", command: "claude", enabled: true, available: true, sessionCount: STATE?.totals.sessionCount || 0, tokens: STATE ? { total: STATE.totals.totalTokens, cacheRead: STATE.totals.cacheReadTokens } : null, detail: "Perfiles locales. Detalle completo en Uso de Claude.", source: "~/.claude · ~/.claude-work · ~/.claude-personal" };
    document.getElementById("agentsWrap").innerHTML = [claude, ...data.providers].map((p) => `
      <div class="agent-row">
        <div class="agent-identity">${providerMark(p.id)}<div><strong>${escapeHtml(p.name)}</strong><span class="agent-state${p.enabled ? " connected" : ""}">${p.enabled ? p.available ? "Conectado" : "Sin registros" : p.available ? "Disponible" : "Sin detectar"}</span></div></div>
        <div class="agent-description"><span>${escapeHtml(p.detail)}</span><details><summary>Fuente local</summary><code>${escapeHtml(p.source)}</code></details></div>
        <div class="agent-metric"><strong>${p.enabled ? fmt(p.sessionCount) : "·"}</strong><span>sesiones</span></div>
        <div class="agent-metric"><strong title="${p.tokens ? fmt(p.tokens.total) : "No registrado"}">${p.enabled && p.tokens ? fmtCompact(p.tokens.total) : "N/D"}</strong><span>${p.enabled && p.measuredSessions != null ? `tokens · ${fmt(p.measuredSessions)}/${fmt(p.sessionCount)} sesiones` : "tokens registrados"}</span></div>
        <div class="agent-actions">${p.id !== "claude" ? `<button class="${p.enabled ? "ghost-btn" : "agent-connect"}" data-agent="${p.id}" data-enabled="${!p.enabled}">${p.enabled ? "Desconectar" : `+ Agregar ${escapeHtml(p.name)}`}</button>` : '<span class="agent-baseline">Fuente principal</span>'}<button class="agent-command" data-command="${escapeHtml(p.command)}" aria-label="Copiar comando para iniciar ${escapeHtml(p.name)}">Copiar comando</button></div>
      </div>`).join("");
    document.querySelectorAll("[data-agent]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await dashboardFetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: button.dataset.agent, enabled: button.dataset.enabled === "true" }) });
        await loadAgents();
        document.getElementById("agentsFeedback").textContent = "Conexión actualizada. La preferencia se guarda en este equipo.";
      } catch (error) { document.getElementById("agentsFeedback").textContent = error.message; }
      finally { button.disabled = false; }
    }));
    document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(button.dataset.command); document.getElementById("agentsFeedback").textContent = `Comando copiado: ${button.dataset.command}. Ejecútalo dentro de tu proyecto.`; }
      catch { document.getElementById("agentsFeedback").textContent = `Comando: ${button.dataset.command}`; }
    }));
    const sessions = data.providers.flatMap((p) => p.sessions.map((s) => ({ ...s, name: p.name }))).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || "")).slice(0, 16);
    document.getElementById("agentSessions").innerHTML = sessions.length ? `<p class="agents-note">Tokens por sesión: toda su duración. El rango filtra las sesiones con actividad reciente.</p><div class="agent-table-scroll"><table class="agent-table"><thead><tr><th>Agente</th><th>Proyecto / sesión</th><th>Última actividad</th><th>Modelo</th><th>Tokens de sesión</th></tr></thead><tbody>${sessions.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td title="${escapeHtml(s.project || s.id)}">${escapeHtml(s.project ? s.project.split(/[\\/]/).filter(Boolean).pop() : s.id.split(":")[1].slice(0, 8))}</td><td>${s.lastAt ? escapeHtml(new Date(s.lastAt).toLocaleDateString(LOCALE)) : "N/D"}</td><td>${escapeHtml(s.model)}</td><td class="mono">${s.tokens ? fmtCompact(s.tokens.total) : "N/D"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="skill-empty">Agrega un agente para consultar sus sesiones. No necesitas una API key.</p>';
  } catch (error) {
    document.getElementById("agentsFeedback").textContent = `No se pudieron cargar los agentes: ${error.message}`;
  } finally { agentsBusy = false; }
}
boot();
