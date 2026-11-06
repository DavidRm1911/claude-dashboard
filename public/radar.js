(() => {
  const $ = (id) => document.getElementById(id);
  const esc = escapeHtml;
  const titles = { digest: "En tu edición", architecture: "Patrones para construir", news: "Lo nuevo en AWS", learning: "Aprender", credits: "Créditos AWS", jobs: "Empleos compatibles", saved: "Tu lista de trabajo" };
  const allowedHosts = ["aws.amazon.com", "builder.aws.com", "remotive.com", "www.remotive.com", "www.amazon.jobs", "www.getonbrd.com"];
  let data = null;
  let loading = false;
  let collection = "digest";
  let limit = 18;
  let actionBusy = false;
  const CV_KEY = "workbench.radar.cv.v1";
  let cvText = "";
  let cvDirty = false;
  try { cvText = localStorage.getItem(CV_KEY) || ""; } catch { /* storage can be disabled */ }
  const validUrl = (value) => {
    try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && allowedHosts.includes(u.hostname) ? u.href : null; } catch { return null; }
  };
  const link = (url, text, className = "") => validUrl(url) ? `<a class="${className}" href="${esc(validUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(text)} <span aria-hidden="true">↗</span><span class="sr-only"> (abre otra pestaña)</span></a>` : esc(text);
  const date = (iso, time = false) => iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", ...(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? { timeZone: "UTC" } : {}), ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(iso)) : "Fecha no indicada";
  const feedback = (text, error = false) => { $("radarFeedback").textContent = text; $("radarFeedback").classList.toggle("is-error", error); };
  async function request(url, body) {
    const options = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Dashboard-Request": "1" }, body: JSON.stringify(body) };
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo completar la acción.");
    return result;
  }
  const sourceName = (item) => item.kind === "community" ? "Comunidad · Builder Center" : item.sourceName;
  function badge(item) {
    if (item.expired) return '<span class="radar-badge warning">Oferta vencida</span>';
    if (item.reviewDue) return '<span class="radar-badge warning">Revisar condiciones</span>';
    if (item.offer === "credit") return '<span class="radar-badge positive">USD 100 · nuevos clientes</span>';
    if (item.offer === "conditional-credit") return '<span class="radar-badge warning">Crédito condicionado</span>';
    if (item.discovery) return '<span class="radar-badge warning">Hallazgo MCP · verificar</span>';
    if (item.offer === "free-resource") return '<span class="radar-badge positive">Recurso gratuito</span>';
    if (item.offer === "conditional") return '<span class="radar-badge warning">Oferta condicionada</span>';
    if (item.offerSignal) return '<span class="radar-badge warning">Posible oportunidad</span>';
    return `<span class="radar-badge">${esc(item.kind === "official" ? "AWS oficial" : item.kind === "jobs" ? "Remoto" : "Comunidad")}</span>`;
  }
  const dateLabel = (item) => item.discovery ? "Encontrado por AWS Knowledge MCP · fecha por confirmar" : item.resource ? `Revisado ${date(item.verifiedAt?.slice(0, 10))}` : `${item.dateKind === "updated" ? "Actualizado" : "Publicado"} ${date(item.publishedAt)}`;
  function busy(value) {
    loading = value;
    $("radarRefresh").disabled = value || !data?.enabled;
    $("radarRefresh").textContent = value ? "Consultando fuentes…" : "Actualizar fuentes";
    $("radarEnable").disabled = value;
    $("radarPause").disabled = value;
    $("radar").setAttribute("aria-busy", String(value));
  }
  async function refresh({ quiet = false } = {}) {
    if (loading || !data?.enabled) return;
    const due = data.sources.some((s) => !s.nextRefreshAt || Date.parse(s.nextRefreshAt) <= Date.now());
    if (!due) {
      if (!quiet) feedback("La copia está al día para sus intervalos. AWS se consulta cada hora; Remotive cada seis horas.");
      return;
    }
    busy(true);
    if (!quiet) feedback("Consultando fuentes públicas. Puedes seguir usando el dashboard.");
    try {
      data = await request("/api/radar/refresh", {});
      render();
      const failed = data.sources.filter((s) => s.error).length;
      feedback(failed ? `${failed} fuente${failed === 1 ? " no respondió" : "s no respondieron"}. Se conserva su copia; revisa el detalle al final.` : "Fuentes actualizadas. Tus filtros y guardados no salen de este equipo.");
    } catch (error) { feedback(error.message, true); }
    finally { busy(false); }
  }
  function filtered() {
    const query = $("radarSearch").value.trim().toLowerCase();
    const topic = $("radarTopic").value;
    const origin = $("radarOrigin").value;
    const age = $("radarAge").value;
    const unread = $("radarUnread").checked;
    const items = (data?.items || []).filter((item) => {
      if (!validUrl(item.url)) return false;
      const inCollection = collection === "saved" ? item.saved : collection === "digest" ? !item.resource && item.section !== "jobs" && item.section !== "credits" : collection === "learning" ? item.section === "learning" || item.offerSignal && item.section !== "credits" : item.section === collection;
      if (!inCollection || unread && item.read || origin !== "all" && item.kind !== origin || topic !== "all" && !item.topics?.includes(topic)) return false;
      if (collection === "jobs" && $("radarRegion").value === "eligible" && !["peru", "latam-global"].includes(item.region)) return false;
      if (collection === "jobs" && !["all", "eligible"].includes($("radarRegion").value) && item.region !== $("radarRegion").value) return false;
      if (age !== "all" && (!item.publishedAt || Date.parse(item.publishedAt) < Date.now() - Number(age) * 86400000)) return false;
      return !query || `${item.title} ${item.summary} ${item.company || ""} ${item.location || ""} ${item.author || ""} ${(item.topics || []).join(" ")} ${item.sourceName}`.toLowerCase().includes(query);
    });
    // Benefits are the reason for this collection, not an undated footnote
    // buried below a stream of training announcements.
    if (collection === "jobs" && cvText && globalThis.JobMatch) return items.map((item) => ({ item, match: JobMatch.evaluate(cvText, item) })).sort((a, b) => b.match.rank - a.match.rank || (Date.parse(b.item.publishedAt) || 0) - (Date.parse(a.item.publishedAt) || 0)).map(({ item }) => item);
    return collection === "learning" || collection === "credits" ? items.sort((a, b) => Number(Boolean(b.resource)) - Number(Boolean(a.resource))) : items;
  }
  function renderEdition() {
    const el = $("radarEdition");
    el.hidden = collection !== "digest";
    if (el.hidden || !data) return;
    const story = data.items.find((item) => item.sourceId === "architecture" && validUrl(item.url)) || data.items.find((item) => item.section === "architecture" && item.kind === "official" && validUrl(item.url));
    const resources = data.items.filter((item) => item.resource && item.section === "credits" && !item.expired).slice(0, 2);
    el.innerHTML = `<div class="radar-feature"><span class="eyebrow">PARA TU PRÓXIMO BUILD</span>${story ? `<h3>${link(story.url, story.title)}</h3><p>${esc(story.summary)}</p><div class="radar-meta">${esc(sourceName(story))} · ${esc(story.author || "Autor no indicado")} · ${esc(dateLabel(story))}</div><div class="radar-feature-actions">${link(story.url, "Explorar arquitectura", "radar-text-link")}<button class="radar-text-button" data-save="${story.id}" aria-pressed="${Boolean(story.saved)}">${story.saved ? "Guardado" : "Guardar para construir"}</button></div>` : '<h3>Tu próxima arquitectura empieza aquí.</h3><p>Activa las fuentes para recibir patrones de AWS y experiencias de otros builders, con fecha y origen.</p>'}</div><div class="radar-opportunities"><span class="eyebrow">NO DEJAR PASAR</span>${resources.map((item) => `<div class="radar-opportunity">${badge(item)}<h4>${link(item.url, item.title)}</h4><p>${esc(item.summary)}</p><span class="radar-meta">${esc(dateLabel(item))}</span></div>`).join("")}<div class="radar-feature-actions"><button class="radar-text-button" data-jump="credits">Ver créditos AWS →</button><button class="radar-text-button" data-jump="learning">Ver formación →</button></div></div>`;
  }
  function article(item) {
    const job = item.kind === "jobs";
    const ageDays = item.publishedAt ? (Date.now() - Date.parse(item.publishedAt)) / 86400000 : null;
    const stale = data.sources.find((s) => s.id === item.sourceId)?.stale;
    return `<article class="radar-item${item.read ? " is-read" : ""}" data-radar-id="${item.id}">
      <div class="radar-item-main"><div class="radar-item-kicker">${badge(item)}${item.saved ? '<span class="radar-meta">Guardado</span>' : ""}${item.retired ? '<span class="radar-badge warning">Ya no figura en el feed</span>' : stale && !item.resource ? '<span class="radar-meta">Copia anterior</span>' : ""}</div>
        <h4>${link(item.url, item.title)}</h4>
        <div class="radar-meta">${esc(job ? item.company : sourceName(item))}${!job && item.author ? ` · ${esc(item.author)}` : ""} · ${esc(dateLabel(item))}</div>
        ${job ? `<p class="radar-job-data">${esc(item.location)} · ${esc(item.jobType ? item.jobType.replace(/_/g, " ") : "Contrato no indicado")}</p><p class="radar-salary">${esc(item.salary || "Salario no publicado")}</p>${cvText && globalThis.JobMatch ? (() => { const m = JobMatch.evaluate(cvText, item); return `<div class="radar-match"><strong>${esc(m.label)}</strong><span>${m.common.length ? `Coincide: ${esc(m.common.join(", "))}` : "Sin términos técnicos coincidentes en la vista previa"}${m.missing.length ? ` · No se detectó: ${esc(m.missing.join(", "))}` : ""}${!m.locationOk ? " · Confirma que acepten postulantes desde Perú" : ""}</span></div>`; })() : ""}` : `<p class="radar-excerpt">${esc(item.summary || "La fuente no incluye un resumen. Abre la publicación original.")}</p>`}
        ${item.topics?.length ? `<div class="radar-topics">${item.topics.map((topic) => `<span>${esc(topic)}</span>`).join("")}</div>` : ""}
        ${item.resource || item.discovery ? `<details class="radar-terms"><summary>Condiciones y vigencia</summary><p>${esc(item.terms)}${item.expiresAt ? ` Fecha límite publicada: ${esc(date(item.expiresAt, true))}.` : " Sin fecha de fin publicada; comprueba la fuente."}${item.reviewDue ? " La revisión editorial tiene más de 30 días, no confirma vigencia actual." : ""}</p></details>` : item.offerSignal ? '<p class="radar-caveat">Detectado por palabras clave. No confirma gratuidad, elegibilidad ni fecha de cierre.</p>' : ""}
        ${job ? `<p class="radar-caveat">Fuente: ${esc(item.sourceName)}${item.sourceId === "remotive" ? ", API con 24 h de retraso" : ", feed público"}. ${ageDays > 30 ? "Publicación de más de 30 días. " : ""}Confirma vigencia y países admitidos en la vacante; remoto no significa global.</p>` : ""}
      </div>
      <div class="radar-item-actions">${link(item.url, job ? "Ver vacante" : "Leer en la fuente", "radar-open")}<button class="radar-save" data-save="${item.id}" aria-pressed="${Boolean(item.saved)}" aria-label="${item.saved ? "Quitar de guardados:" : "Guardar:"} ${esc(item.title)}">${item.saved ? "Guardado ✓" : "Guardar"}</button><button class="radar-text-button" data-read="${item.id}" aria-pressed="${Boolean(item.read)}" aria-label="${item.read ? "Marcar sin leer:" : "Marcar leído:"} ${esc(item.title)}">${item.read ? "Leído ✓" : "Marcar leído"}</button></div>
    </article>`;
  }
  function renderList() {
    $("radarListTitle").textContent = titles[collection];
    const items = filtered();
    $("radarResultCount").textContent = `${items.length} resultado${items.length === 1 ? "" : "s"}`;
    $("radarSavedCount").textContent = (data?.items || []).filter((i) => i.saved).length;
    $("radarRegionField").hidden = collection !== "jobs";
    $("radarCv").hidden = collection !== "jobs";
    $("radarCreditTools").hidden = collection !== "credits";
    $("radarOrigin").parentElement.hidden = collection === "jobs";
    $("radarMore").hidden = items.length <= limit;
    $("radarList").innerHTML = items.length ? items.slice(0, limit).map(article).join("") : `<div class="radar-empty"><h4>${collection === "saved" ? "Una lista para volver a lo importante." : "No hay resultados con estos filtros."}</h4><p>${collection === "saved" ? "Guarda una arquitectura para probarla, un curso para empezarlo o una vacante para revisarla. Permanecen en este equipo." : collection === "credits" ? "La selección verificada sigue arriba. AWS Knowledge MCP puede buscar novedades oficiales; no todas serán ofertas ni aplicarán a tu cuenta." : !data?.enabled && !data?.sources.some((s) => s.fetchedAt) ? "Activa las fuentes para cargar novedades. La selección de recursos AWS está disponible en Créditos AWS y Aprender." : "Prueba otro tema, amplía la antigüedad o revisa las fuentes. No inventamos publicaciones ni vacantes cuando el feed está vacío."}</p>${collection !== "saved" ? '<button type="button" class="radar-text-button" data-reset>Limpiar filtros</button>' : ""}</div>`;
    $("radarList").querySelector("[data-reset]")?.addEventListener("click", resetFilters);
    $("radarJobLinks").hidden = collection !== "jobs";
    $("radarJobLinks").innerHTML = `<h4>Ampliar la búsqueda</h4><p class="radar-caveat">Accesos a otras bolsas, no vacantes importadas. No se rastrean cuentas ni se envía tu CV.</p>${(data?.jobLinks || []).map((item) => `<div>${link(item.url, item.name, "radar-text-link")}<p>${esc(item.description)}</p></div>`).join("")}`;
  }
  function renderSources() {
    const sources = data?.sources || [];
    $("radarSources").innerHTML = `<ul class="radar-source-list">${sources.map((s) => `<li><div>${link(s.home, s.name)}<span>${s.kind === "community" ? "Comunidad, no autoría validada" : s.id === "remotive" ? "API pública · retraso de 24 h" : s.kind === "jobs" ? "Feed público de empleos" : "Publicación oficial AWS"}</span></div><div><strong>${s.error ? "No disponible" : s.fetchedAt ? s.stale ? "Copia anterior" : "Copia disponible" : "Sin consultar"}</strong><span>${s.fetchedAt ? `Última lectura: ${esc(date(s.fetchedAt, true))}` : "Sin copia descargada"}</span><span>${s.nextRefreshAt ? `Próxima consulta permitida: ${esc(date(s.nextRefreshAt, true))}` : "Disponible al activar"}</span>${s.error ? `<span>${esc(s.error)}</span>` : ""}</div></li>`).join("")}</ul><div class="radar-source-list"><p><strong>AWS Knowledge MCP</strong><span>${data?.mcp?.fetchedAt ? `Última búsqueda: ${esc(date(data.mcp.fetchedAt, true))}` : "Búsqueda manual bajo demanda"} · lecturas públicas · no verifica elegibilidad ni vigencia</span></p></div><p class="radar-footnote">${esc(data?.privacy || "")}</p>`;
  }
  function render() {
    if (!data) return;
    $("radarConsent").hidden = data.enabled;
    $("radarPause").hidden = !data.enabled;
    const fetched = data.sources.map((s) => s.fetchedAt).filter(Boolean).sort().at(-1);
    $("radarSyncTime").textContent = `${data.enabled ? "Fuentes activadas" : "Consultas pausadas"}${fetched ? ` · última lectura ${date(fetched, true)}` : " · aún sin descarga"}`;
    $("radarRefresh").disabled = loading || !data.enabled;
    $("radarCreditStatus").textContent = data.mcp?.fetchedAt ? `Última búsqueda: ${date(data.mcp.fetchedAt, true)} · ${data.mcp.count} resultados` : data.mcp?.error || "Búsqueda manual, limitada a una cada 12 horas.";
    const mcpCooling = Boolean(data.mcp?.nextRefreshAt && Date.parse(data.mcp.nextRefreshAt) > Date.now());
    $("radarCreditSearch").disabled = !data.enabled || mcpCooling;
    $("radarCreditSearch").textContent = mcpCooling ? "Buscar de nuevo más tarde" : "Descubrir con AWS Knowledge MCP";
    if (!cvDirty && document.activeElement !== $("radarCvText")) $("radarCvText").value = cvText;
    $("radarCvSaved").textContent = cvText ? "CV guardado localmente" : "Sin CV guardado";
    $("radarCvToggle").textContent = cvText ? "Editar CV" : "Añadir CV";
    renderEdition(); renderList(); renderSources();
  }
  function resetFilters() {
    $("radarSearch").value = "";
    for (const id of ["radarTopic", "radarOrigin", "radarAge"]) $(id).value = "all";
    $("radarRegion").value = "eligible";
    $("radarUnread").checked = false;
    limit = 18;
    renderList();
  }
  function select(value) {
    if (!(value in titles)) return;
    collection = value;
    $("radarCollections").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.collection === value)));
    resetFilters(); renderEdition(); feedback("");
  }
  async function mark(id, field, focusOrigin) {
    if (actionBusy) return;
    const item = data?.items.find((i) => i.id === id);
    if (!item) return;
    actionBusy = true;
    focusOrigin.disabled = true;
    const attrName = field === "saved" ? "save" : "read";
    try {
      const result = await request("/api/radar/mark", { id, [field]: !item[field] });
      Object.assign(item, result);
      renderEdition(); renderList();
      const next = $("radar").querySelector(`[data-${attrName}="${id}"]`);
      (next || $("radarSearch")).focus({ preventScroll: true });
      feedback(field === "saved" ? result.saved ? "Guardado en este equipo." : "Quitado de guardados." : result.read ? "Marcado como leído." : "Marcado como sin leer.");
    } catch (error) { focusOrigin.disabled = false; feedback(error.message, true); }
    finally { actionBusy = false; }
  }
  $("radarCollections").addEventListener("click", (e) => { const button = e.target.closest("button[data-collection]"); if (button) select(button.dataset.collection); });
  $("radarFilters").addEventListener("submit", (e) => e.preventDefault());
  $("radarFilters").addEventListener("input", () => { limit = 18; renderList(); });
  $("radarMore").addEventListener("click", () => { limit += 18; renderList(); });
  $("radarRefresh").addEventListener("click", () => refresh());
  $("radarCreditSearch").addEventListener("click", async () => {
    const button = $("radarCreditSearch"); button.disabled = true; button.textContent = "Buscando en AWS…";
    try { data = await request("/api/radar/credits/search", {}); render(); feedback(data.mcp?.error || `AWS Knowledge encontró ${data.mcp?.count || 0} páginas. Comprueba elegibilidad y vigencia en cada fuente.`); }
    catch (error) { feedback(error.message, true); button.disabled = false; button.textContent = "Reintentar búsqueda"; }
  });
  $("radarCvToggle").addEventListener("click", () => { $("radarCvEditor").hidden = !$("radarCvEditor").hidden; if (!$("radarCvEditor").hidden) $("radarCvText").focus(); });
  $("radarCvText").addEventListener("input", () => { cvDirty = true; $("radarCvFeedback").textContent = "Cambios sin guardar."; });
  $("radarCvSave").addEventListener("click", () => {
    const value = $("radarCvText").value.trim();
    if (value.length < 40) { $("radarCvFeedback").textContent = "Agrega al menos 40 caracteres para comparar."; return; }
    cvText = value.slice(0, 20000);
    cvDirty = false;
    try { localStorage.setItem(CV_KEY, cvText); $("radarCvFeedback").textContent = "CV guardado en este navegador. Se usa solo para ordenar las vacantes descargadas."; }
    catch { cvText = ""; $("radarCvFeedback").textContent = "El navegador no permitió guardar el CV. Revisa su espacio disponible."; }
    renderList(); render();
  });
  $("radarCvDelete").addEventListener("click", () => { cvText = ""; cvDirty = false; try { localStorage.removeItem(CV_KEY); } catch {} $("radarCvText").value = ""; $("radarCvFeedback").textContent = "CV borrado de este navegador."; renderList(); render(); });
  $("radarCvFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Máximo 2 MB por archivo.");
      let value;
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        const response = await fetch("/api/radar/cv/pdf", { method: "POST", headers: { "Content-Type": "application/pdf", "X-Dashboard-Request": "1" }, body: await file.arrayBuffer() });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "No se pudo leer el PDF."); value = result.text;
      } else value = await file.text();
      $("radarCvText").value = value.slice(0, 20000); cvDirty = true; $("radarCvFeedback").textContent = "Texto importado. Revísalo antes de guardarlo.";
    } catch (error) { $("radarCvFeedback").textContent = error.message; }
    finally { event.target.value = ""; }
  });
  $("radarEnable").addEventListener("click", async () => {
    busy(true);
    try { data = await request("/api/radar/settings", { enabled: true }); render(); } catch (error) { feedback(error.message, true); }
    finally { busy(false); }
    await refresh();
  });
  $("radarPause").addEventListener("click", async () => {
    busy(true);
    try { data = await request("/api/radar/settings", { enabled: false }); render(); feedback("Consultas externas pausadas. Puedes seguir leyendo y guardar la copia local."); } catch (error) { feedback(error.message, true); }
    finally { busy(false); }
  });
  $("radar").addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    if (button.dataset.save) mark(button.dataset.save, "saved", button);
    if (button.dataset.read) mark(button.dataset.read, "read", button);
    if (button.dataset.jump) select(button.dataset.jump);
  });
  document.addEventListener("dashboard:tier", (e) => { if (e.detail === "radar") refresh({ quiet: true }); });
  setInterval(() => { if (!document.hidden && appState.tier === "radar") refresh({ quiet: true }); }, 60000);
  request("/api/radar").then((result) => { data = result; render(); if (appState.tier === "radar") refresh({ quiet: true }); }).catch((error) => {
    feedback(`No se pudo cargar Radar: ${error.message}`, true);
    $("radarList").innerHTML = '<div class="radar-empty"><h4>Radar no disponible.</h4><p>Recarga la página para reintentar. El uso de tus IAs sigue disponible en sus pestañas.</p></div>';
  });
})();
