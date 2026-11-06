// Estudios: fully funded international study opportunities verified by /estudios.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = escapeHtml;
  const TYPE = { master: "Maestría", research: "Investigación", short: "Programa corto" };
  let data = null;

  async function api(url, body) {
    const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Dashboard-Request": "1" }, body: JSON.stringify(body) } : {});
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "No se pudo completar la acción");
    return result;
  }
  const link = (u, t) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t));
  function deadlineBadge(i) {
    if (i.excluded) return `<span class="radar-badge warning">No aplica: ${esc(i.excluded)}</span>`;
    if (i.status === "closed") return '<span class="radar-badge">Cerrada (ver próxima)</span>';
    if (i.daysLeft != null && i.daysLeft >= 0) return `<span class="radar-badge ${i.daysLeft <= 45 ? "warning" : "positive"}">Cierra ${esc(i.deadline)} · ${i.daysLeft} días</span>`;
    if (i.opens) return `<span class="radar-badge">Abre ${esc(i.opens)}</span>`;
    return '<span class="radar-badge">Fecha por confirmar</span>';
  }
  function render() {
    if (!data.available) { $("studiesList").innerHTML = '<div class="board-empty"><p>Aún no hay resultados. Corre /estudios en ai-job-search.</p></div>'; $("studiesSync").textContent = ""; return; }
    const s = data.stats;
    $("studiesSync").textContent = data.updatedAt ? `Verificado: ${esc(String(data.updatedAt).slice(0, 10))}` : "";
    $("studiesStats").innerHTML = [[s.eligible, "elegibles para ti"], [s.open, "convocatorias abiertas"], [s.closingSoon, "cierran en ≤45 días"], [s.saved, "guardadas"], [s.excluded, "revisadas que no aplican"]]
      .map(([n, l]) => `<div class="jobs-stat"><strong>${n}</strong><span>${esc(l)}</span></div>`).join("");
    const q = $("studiesSearch").value.toLocaleLowerCase(), type = $("studiesType").value, region = $("studiesRegion").value, view = $("studiesView").value;
    const items = data.items.filter((i) => {
      if (type !== "all" && i.type !== type) return false;
      if (region !== "all" && i.region !== region) return false;
      if (view === "eligible" && (i.excluded || i.mark === "dismissed")) return false;
      if (view === "saved" && i.mark !== "saved") return false;
      if (view === "excluded" && !(i.excluded || i.mark === "dismissed")) return false;
      return `${i.name} ${i.provider} ${i.country} ${i.fields.join(" ")}`.toLocaleLowerCase().includes(q);
    });
    $("studiesList").innerHTML = items.length ? items.map((i) => `
      <article class="radar-item" data-study="${esc(i.id)}">
        <div class="radar-item-main">
          <div class="radar-item-kicker">${i.fit != null ? `<span class="radar-badge ${i.fit >= 70 ? "positive" : ""}">${i.fit}/100</span>` : ""}<span class="radar-badge">${esc(TYPE[i.type] || i.type || "")}</span>${deadlineBadge(i)}
            ${i.peruEligible === false ? '<span class="radar-badge warning">Perú no elegible</span>' : i.peruEligible == null ? '<span class="radar-badge warning">Elegibilidad Perú por confirmar</span>' : ""}
            ${i.mark === "saved" ? '<span class="radar-badge positive">Guardada</span>' : ""}</div>
          <h4>${link(i.url, i.name)}</h4>
          <div class="radar-meta">${esc(i.provider || "")} · ${esc(i.country || i.region || "")}${i.intake ? ` · inicio ${esc(i.intake)}` : ""}${i.languageTest ? ` · idioma: ${esc(i.languageTest)}` : ""}</div>
          ${i.funding ? `<p class="radar-meta">Cubre: ${esc(i.funding)}</p>` : ""}
          <ul class="jobs-notes">${i.notes.map((n) => `<li class="${/^-/.test(n) ? "minus" : "plus"}">${esc(n.replace(/^[+-]\s*/, ""))}</li>`).join("")}</ul>
          ${i.nextStep ? `<p class="studies-next"><strong>Siguiente paso:</strong> ${esc(i.nextStep)}</p>` : ""}
          <p class="radar-meta">${i.verifiedAt ? `Verificado ${esc(i.verifiedAt)} en ${link(i.source, "fuente oficial")}` : "Sin verificar"}</p>
        </div>
        <div class="radar-item-actions">
          <button class="radar-button ${i.mark === "saved" ? "" : "primary"}" data-mark="${i.mark === "saved" ? "none" : "saved"}">${i.mark === "saved" ? "Quitar de guardadas" : "Guardar"}</button>
          <button class="radar-text-button" data-mark="${i.mark === "dismissed" ? "none" : "dismissed"}">${i.mark === "dismissed" ? "Restaurar" : "No me interesa"}</button>
        </div>
      </article>`).join("") : '<div class="board-empty"><span aria-hidden="true">·</span><p>Nada con estos filtros.</p></div>';
  }
  async function load() {
    try { data = await api("/api/studies"); render(); $("studiesFeedback").textContent = ""; }
    catch (e) { $("studiesFeedback").textContent = e.message; }
  }
  $("studiesList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mark]"); if (!b) return;
    try { data = await api("/api/studies/mark", { id: b.closest("[data-study]").dataset.study, mark: b.dataset.mark }); render(); }
    catch (err) { $("studiesFeedback").textContent = err.message; }
  });
  ["studiesSearch", "studiesType", "studiesRegion", "studiesView"].forEach((id) => $(id).addEventListener("input", () => data && render()));
  $("studiesFilters").addEventListener("submit", (e) => e.preventDefault());
  $("studiesReload").addEventListener("click", load);
  document.addEventListener("dashboard:tier", (e) => { if (e.detail === "studies") load(); });
  if (document.body.dataset.section === "studies") load();
})();
