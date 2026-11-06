// Empleos: ranked postings from the local ai-job-search workspace. Choosing
// "Postular" records the decision and files a kanban task for Claude; the
// drafting itself happens in /postular, which asks David before writing.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = escapeHtml;
  let data = null, busy = false, runs = {}, openRef = null, pollTimer = null;

  async function api(url, body) {
    const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Dashboard-Request": "1" }, body: JSON.stringify(body) } : {});
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "No se pudo completar la acción");
    return result;
  }

  const scoreClass = (s) => (s >= 75 ? "positive" : s >= 60 ? "" : "warning");
  const link = (url, text) => (/^https?:\/\//.test(url || "") ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));

  function renderStats() {
    const s = data.stats;
    const run = data.lastRun ? `Última búsqueda: ${new Date(data.lastRun.at).toLocaleString("es-PE")} · ${data.lastRun.fetched} revisadas · ${data.lastRun.new} nuevas` : "Aún sin búsquedas registradas";
    const rk = data.ranking;
    const warn = rk?.stale
      ? ` <span class="radar-badge warning">${esc(`Ranking desactualizado: último puntaje ${rk.ageDays != null ? `hace ${rk.ageDays} días` : "desconocido"}${rk.lastRankDate ? ` (${rk.lastRankDate.slice(0, 10)})` : ""}${rk.lastRankRun?.ok === false ? " · último intento falló" : ""}`)}</span>`
      : "";
    const dup = s.duplicatesHidden > 0 ? ` · ${s.duplicatesHidden} ${s.duplicatesHidden === 1 ? "duplicada oculta" : "duplicadas ocultas"}` : "";
    $("jobsSync").innerHTML = esc(run + dup) + warn;
    $("jobsStats").innerHTML = [
      [s.high, "con 70+ para ti"], [s.open, "puntuadas abiertas"], [s.toApply, "marcadas para postular"],
      [s.backlog, "en cola por puntuar"], [s.seenTotal, "ofertas vistas (nunca se repiten)"], [s.drafted + s.applied, "redactadas / enviadas"],
    ].map(([n, l]) => `<div class="jobs-stat"><strong>${n}</strong><span>${esc(l)}</span></div>`).join("");
  }

  function renderGaps() {
    const g = data.gaps;
    if (!g.groups.length) { $("jobsGaps").innerHTML = '<p class="radar-meta">Sin brechas recurrentes todavía.</p>'; return; }
    const max = g.groups[0].count;
    $("jobsGaps").innerHTML = `<p class="radar-meta">Sobre ${g.considered} ofertas abiertas con 60+.</p>` + g.groups.map((x) => `
      <div class="jobs-gap"><div class="jobs-gap-head"><span>${esc(x.label)}</span><strong>${x.count}</strong></div>
      <div class="jobs-gap-bar" aria-hidden="true"><span style="width:${Math.round((x.count / max) * 100)}%"></span></div>
      <p>${esc(x.action)}</p></div>`).join("");
  }

  const REMOTE_LOC = /remote|remoto|anywhere|worldwide|\bworld\b|global|latam|latin america|work from anywhere/i;
  const REMOTE_PORTALS = new Set(["remote-boards-search", "freehire-search"]);
  function isRemote(j) {
    if (typeof j.isRemote === "boolean") return j.isRemote;
    const loc = String(j.location ?? "").trim();
    if (REMOTE_LOC.test(loc)) return true;
    if (REMOTE_PORTALS.has(j.portal) && (!loc || /^(global|worldwide|anywhere|n\/?a|-)?$/i.test(loc))) return true;
    return false;
  }

  function fillSelect(id, values, allLabel) {
    const el = $(id);
    if (!el) return;
    const prev = el.value;
    const opts = [`<option value="">${esc(allLabel)}</option>`]
      .concat(values.map((v) => {
        const label = v.length > 40 ? `${v.slice(0, 37)}…` : v;
        return `<option value="${esc(v)}">${esc(label)}</option>`;
      }));
    el.innerHTML = opts.join("");
    if (prev && values.includes(prev)) el.value = prev;
  }


  function ensureFilterControls() {
    const form = $("jobsFilters");
    if (!form) return;
    const specs = [
      ["jobsPortal", "Portal", '<option value="">Todos</option>'],
      ["jobsLocation", "Ubicación", '<option value="">Todas</option>'],
      ["jobsLang", "Idioma", '<option value="">Todos</option><option value="PASS">Pasa</option><option value="FLAG">Revisar</option><option value="FAIL">No apto</option>'],
      ["jobsRemote", "Remoto", '<option value="">Todos</option><option value="remote">Solo remoto</option><option value="onsite">Solo presencial/híbrido</option>'],
      ["jobsPosted", "Fecha", '<option value="">Cualquiera</option><option value="7">Últimos 7 días</option><option value="14">Últimos 14 días</option><option value="30">Últimos 30</option>'],
    ];
    for (const [id, label, options] of specs) {
      if ($(id)) continue;
      const wrap = document.createElement("div");
      wrap.innerHTML = `<label for="${id}">${label}</label><select id="${id}">${options}</select>`;
      form.append(wrap);
    }
  }

  function populateFilterOptions() {
    const jobs = data.jobs || [];
    const portals = [...new Set(jobs.map((j) => j.portal).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const locations = [...new Set(jobs.map((j) => (j.location == null ? "" : String(j.location))).filter((l) => l))].sort((a, b) => a.localeCompare(b, "es"));
    fillSelect("jobsPortal", portals, "Todos");
    fillSelect("jobsLocation", locations, "Todas");
  }

  function renderList() {
    const view = $("jobsView").value, min = Number($("jobsMin").value), q = $("jobsSearch").value.toLocaleLowerCase();
    const portal = $("jobsPortal")?.value || "";
    const location = $("jobsLocation")?.value || "";
    const lang = $("jobsLang")?.value || "";
    const remote = $("jobsRemote")?.value || "";
    const postedDays = Number($("jobsPosted")?.value || 0);
    const limaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
    const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);
    const jobs = data.jobs.filter((j) => {
      if ((j.score ?? 0) < min) return false;
      if (view === "open" && (j.decision === "descartar" || j.locationVerdict === "FAIL" || j.languageGate === "FAIL" || j.applied)) return false;
      if (view === "postular" && j.decision !== "postular") return false;
      if (view === "descartar" && j.decision !== "descartar") return false;
      if (portal && j.portal !== portal) return false;
      if (location && String(j.location ?? "") !== location) return false;
      if (lang && j.languageGate !== lang) return false;
      if (remote === "remote" && !isRemote(j)) return false;
      if (remote === "onsite" && isRemote(j)) return false;
      if (postedDays) {
        const p = j.posted;
        if (typeof p !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p) || Number.isNaN(dayMs(p))) return false;
        if (Math.round((dayMs(limaToday) - dayMs(p)) / 86400000) > postedDays) return false;
      }
      return `${j.title} ${j.company} ${j.location} ${j.strengths.join(" ")}`.toLocaleLowerCase().includes(q);
    });
    $("jobsList").innerHTML = jobs.length ? jobs.map((j) => `
      <article class="radar-item jobs-item" data-key="${esc(j.key)}">
        <div class="radar-item-main">
          <div class="radar-item-kicker"><span class="jobs-ref">#${j.ref}</span><span class="radar-badge ${scoreClass(j.score)}">${j.score ?? "?"}/100</span>
            ${j.closingSoon ? '<span class="radar-badge warning">Cierra pronto</span>' : ""}
            ${j.stretch ? '<span class="radar-badge warning">Pide más años</span>' : ""}
            ${j.locationVerdict === "FLAG" ? '<span class="radar-badge warning">Verificar ubicación</span>' : ""}
            ${j.locationVerdict === "FAIL" ? '<span class="radar-badge warning">Ubicación no elegible</span>' : ""}
            ${j.decision === "postular" ? '<span class="radar-badge positive">Para postular</span>' : ""}
            ${j.applied ? '<span class="radar-badge positive">En tracker</span>' : ""}
            ${j.deadline ? `<span class="radar-meta">Cierra ${esc(j.deadline)}</span>` : ""}</div>
          <h4>${link(j.url, j.title)}</h4>
          <div class="radar-meta">${esc(j.company)} · ${esc(j.location || "Ubicación no indicada")} · ${esc(j.portal || "")}${j.posted ? ` · ${esc(j.posted)}` : ""}</div>
          <ul class="jobs-notes">${j.strengths.slice(0, 2).map((s) => `<li class="plus">${esc(s)}</li>`).join("")}${j.gaps.slice(0, 2).map((g) => `<li class="minus">${esc(g)}</li>`).join("")}</ul>
        </div>
        <div class="radar-item-actions">
          ${runs[j.ref] && !["cancelled"].includes(runs[j.ref].stage)
            ? `<button class="radar-button primary" data-open="${j.ref}">${esc(STAGE_LABEL[runs[j.ref].stage] || "Ver postulación")}</button>`
            : `<button class="radar-button primary" data-apply="${j.ref}">Postular</button>`}
          <button class="radar-text-button" data-decide="${j.decision === "descartar" ? "pendiente" : "descartar"}">${j.decision === "descartar" ? "Restaurar" : "Descartar"}</button>
        </div>
      </article>`).join("") : '<div class="board-empty"><span aria-hidden="true">·</span><p>No hay ofertas con estos filtros.</p></div>';
  }

  function render() {
    if (!data.available) {
      $("jobsList").innerHTML = `<div class="board-empty"><p>No encontré ai-job-search en ${esc(data.repoDir || "")}. Define DASHBOARD_JOBSEARCH_DIR.</p></div>`;
      return;
    }
    ensureFilterControls(); populateFilterOptions(); renderStats(); renderGaps(); renderList();
  }

  async function load() {
    try {
      const [jobs, list] = await Promise.all([api("/api/jobsearch"), api("/api/jobsearch/apply")]);
      data = jobs; runs = Object.fromEntries(list.map((r) => [r.ref, r]));
      render(); $("jobsFeedback").textContent = "";
    }
    catch (e) { $("jobsFeedback").textContent = e.message; }
  }


  const STAGE_LABEL = { analyzing: "Analizando…", questions: "Responder preguntas", drafting: "Redactando…", revising: "Aplicando cambios…", preview: "Ver vista previa", approved: "Aprobada ✓", error: "Ver error" };
  const BUSY = ["analyzing", "drafting", "revising"];
  const dialog = document.createElement("dialog");
  dialog.className = "apply-dialog"; dialog.setAttribute("aria-labelledby", "applyTitle");
  document.body.append(dialog);
  dialog.addEventListener("close", () => { openRef = null; clearTimeout(pollTimer); });

  const gateChip = (k, v) => `<span class="radar-badge ${v === "PASS" ? "positive" : "warning"}">${esc(k)}: ${esc(v)}</span>`;
  const pdfUrl = (rel, v) => `/api/jobsearch/pdf?path=${encodeURIComponent(rel)}&v=${v}`;

  function panelBody(run) {
    const ev = run.evaluation;
    const evaluation = ev ? `<section class="apply-eval"><div class="apply-score"><strong>${esc(ev.score)}</strong><span>/100 · ${esc(ev.verdict || "")}</span></div>
      <div class="radar-item-kicker">${Object.entries(ev.gates || {}).map(([k, v]) => gateChip(k, v)).join("")}</div>
      <p>${esc(ev.summary || "")}</p></section>` : "";
    switch (run.stage) {
      case "analyzing": return `<div class="apply-wait"><span class="apply-spinner" aria-hidden="true"></span><p><strong>Claude está leyendo la oferta y tu perfil.</strong> Luego te hará solo las preguntas que falten (1–3 min). No redacta nada todavía.</p></div>`;
      case "questions": return `${evaluation}<form id="applyForm" class="apply-form">
        ${run.questions.length ? `<p class="radar-meta">Responde lo que aplique. Se guarda en tu perfil para no volver a preguntarlo.</p>` : `<p>No hay nada que preguntarte: tu perfil cubre todo lo que pide la oferta.</p>`}
        ${run.questions.map((q) => `<fieldset data-q="${esc(q.id)}"><legend>${esc(q.text)}</legend>${q.why ? `<p class="radar-meta">Por qué: ${esc(q.why)}</p>` : ""}
          ${q.options.map((o, i) => `<label class="apply-opt"><input type="${q.multi ? "checkbox" : "radio"}" name="${esc(q.id)}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}
          <input type="text" class="apply-note" maxlength="800" placeholder="Detalle u otra respuesta (opcional)"></fieldset>`).join("")}
        <footer class="apply-actions"><button class="radar-button primary" type="submit">Redactar CV y carta con esto</button><button class="radar-text-button" type="button" data-cancel>Cancelar</button></footer></form>`;
      case "drafting": case "revising": return `${evaluation}<div class="apply-wait"><span class="apply-spinner" aria-hidden="true"></span><p><strong>${run.stage === "revising" ? "Aplicando tus cambios" : "Redactando"}</strong> con revisor independiente, compilando y verificando (5–15 min). Puedes cerrar esto; sigue en segundo plano.</p><button class="radar-text-button" data-cancel>Detener</button></div>`;
      case "preview": { const p = run.preview; return `${evaluation}
        <p class="apply-note-top">Esto es <strong>exactamente</strong> lo que enviarías. Nada se envía desde aquí.</p>
        <div class="apply-pdfs"><figure><figcaption>CV · ${esc(p.cvPages)} pág. <a href="${pdfUrl(p.cv, p.version)}" target="_blank" rel="noopener">abrir ↗</a></figcaption><iframe src="${pdfUrl(p.cv, p.version)}" title="Vista previa del CV"></iframe></figure>
        <figure><figcaption>Carta · ${esc(p.coverPages)} pág. <a href="${pdfUrl(p.cover, p.version)}" target="_blank" rel="noopener">abrir ↗</a></figcaption><iframe src="${pdfUrl(p.cover, p.version)}" title="Vista previa de la carta"></iframe></figure></div>
        <div class="apply-notes"><div><h4>Decisiones de adaptación</h4><ul>${p.tailoring.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
        <div><h4>Brechas que la carta reconoce</h4><ul>${p.gapsAdmitted.map((t) => `<li>${esc(t)}</li>`).join("") || "<li>Ninguna</li>"}</ul>
        <h4>Afirmaciones sobre la empresa (verificadas)</h4><ul>${p.companyClaims.map((t) => `<li>${esc(t)}</li>`).join("") || "<li>Ninguna</li>"}</ul>
        <p class="radar-meta">Verificación: ${p.verification.filter((v) => v.ok).length}/${p.verification.length} puntos OK${p.verification.some((v) => !v.ok) ? " · revisar: " + p.verification.filter((v) => !v.ok).map((v) => esc(v.item)).join("; ") : ""}</p></div></div>
        <form id="reviseForm" class="apply-revise"><label for="reviseText">¿Algo que cambiar?</label><textarea id="reviseText" rows="2" maxlength="2000" placeholder="Ej. menciona mi proyecto de la escuela de manejo antes que Heartly"></textarea>
        <footer class="apply-actions"><button class="radar-button primary" type="button" data-approve>Aprobar</button><button class="radar-button" type="submit">Pedir cambios</button><button class="radar-text-button" type="button" data-cancel>Descartar borrador</button></footer></form>`; }
      case "approved": return `<div class="apply-done"><p><strong>Aprobada y registrada en tu tracker.</strong> Ahora envíala tú:</p>
        <p><a class="radar-button primary" href="${esc(run.url)}" target="_blank" rel="noopener noreferrer">Ir a la oferta y postular ↗</a></p>
        <p class="radar-meta">Archivos: <a href="${pdfUrl(run.preview.cv, run.preview.version)}" target="_blank" rel="noopener">CV</a> · <a href="${pdfUrl(run.preview.cover, run.preview.version)}" target="_blank" rel="noopener">Carta</a>. Cuando la envíes, en Claude Code: <code>/outcome ${esc(run.company)}</code>.</p></div>`;
      case "error": return `${evaluation}<div class="apply-error"><p>${esc(run.error || "Algo falló.")}</p><button class="radar-button" data-retry>Reintentar desde el inicio</button></div>`;
      default: return "<p>Sin datos.</p>";
    }
  }

  function renderPanel(run) {
    runs[run.ref] = run;
    dialog.innerHTML = `<header><div><span class="eyebrow">POSTULACIÓN #${esc(run.ref)}</span><h3 id="applyTitle">${esc(run.title)} · ${esc(run.company)}</h3></div><button class="ghost-btn" data-close aria-label="Cerrar">✕</button></header><div class="apply-body">${panelBody(run)}</div>`;
    clearTimeout(pollTimer);
    if (BUSY.includes(run.stage)) pollTimer = setTimeout(() => refreshPanel(run.ref), 5000);
    if (data) renderList();
  }
  async function refreshPanel(ref) {
    if (openRef !== ref) return;
    try { renderPanel(await api(`/api/jobsearch/apply?ref=${ref}`)); } catch (e) { $("jobsFeedback").textContent = e.message; }
  }
  async function openPanel(ref, start) {
    openRef = ref;
    if (!dialog.open) dialog.showModal();
    dialog.innerHTML = '<div class="apply-wait"><span class="apply-spinner"></span><p>Cargando…</p></div>';
    try { renderPanel(start ? await api("/api/jobsearch/apply/start", { ref }) : await api(`/api/jobsearch/apply?ref=${ref}`)); }
    catch (e) { dialog.innerHTML = `<div class="apply-error"><p>${esc(e.message)}</p><button class="ghost-btn" data-close>Cerrar</button></div>`; }
  }
  async function act(action, body) {
    try { renderPanel(await api(`/api/jobsearch/apply/${action}`, { ref: openRef, ...body })); }
    catch (e) { alert(e.message); }
  }
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return dialog.close();
    if (e.target.closest("[data-cancel]")) { if (confirm("¿Cancelar esta postulación?")) act("cancel"); return; }
    if (e.target.closest("[data-approve]")) { if (confirm("¿Aprobar este CV y carta? Quedará registrada para que la envíes tú.")) act("approve"); return; }
    if (e.target.closest("[data-retry]")) { const ref = openRef; api("/api/jobsearch/apply/cancel", { ref }).finally(() => openPanel(ref, true)); }
  });
  dialog.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "applyForm") {
      const answers = {};
      e.target.querySelectorAll("fieldset[data-q]").forEach((fs) => {
        answers[fs.dataset.q] = { picked: [...fs.querySelectorAll("input:checked")].map((i) => i.value), note: fs.querySelector(".apply-note").value };
      });
      act("answer", { answers });
    } else if (e.target.id === "reviseForm") {
      const feedback = $("reviseText").value.trim();
      if (feedback) act("revise", { feedback });
    }
  });

  $("jobsList").addEventListener("click", async (event) => {
    const opener = event.target.closest("[data-apply],[data-open]");
    if (opener) return openPanel(Number(opener.dataset.apply || opener.dataset.open), Boolean(opener.dataset.apply));
    const btn = event.target.closest("[data-decide]");
    if (!btn || busy) return;
    const item = btn.closest("[data-key]");
    busy = true; btn.disabled = true;
    try {
      data = await api("/api/jobsearch/decide", { key: item.dataset.key, decision: btn.dataset.decide });
      render();
      const job = data.jobs.find((j) => j.key === item.dataset.key);
      $("jobsFeedback").textContent = btn.dataset.decide === "postular"
        ? `Listo: #${job.ref} quedó en Mi trabajo como tarea de Claude. Cuando quieras, en Claude Code: /postular ${job.ref}`
        : btn.dataset.decide === "descartar" ? `#${job.ref} descartada.` : `#${job.ref} vuelve a pendientes.`;
    } catch (e) { $("jobsFeedback").textContent = e.message; btn.disabled = false; }
    finally { busy = false; }
  });
  ensureFilterControls();
  ["jobsSearch", "jobsView", "jobsMin", "jobsPortal", "jobsLocation", "jobsLang", "jobsRemote", "jobsPosted"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", () => data && renderList());
  });
  $("jobsFilters").addEventListener("submit", (e) => e.preventDefault());
  $("jobsReload").addEventListener("click", load);
  document.addEventListener("dashboard:tier", (e) => { if (e.detail === "jobs") load(); });
  if (document.body.dataset.section === "jobs") load();
})();
