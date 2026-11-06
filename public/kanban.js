(() => {
  const $ = id => document.getElementById(id);
  const names = { david: 'David', claude: 'Claude', codex: 'Codex', grok: 'Grok', agy: 'Antigravity' };
  const states = { backlog: 'Por hacer', doing: 'En curso', review: 'En revisión', done: 'Listo' };
  const priorities = { high: 'Alta', medium: 'Media', low: 'Baja' };
  let data = { tasks: [] }, projects = [], editing = null, suggestions = [], dragId = null, saving = false;
  const e = typeof escapeHtml === 'function' ? escapeHtml : (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const mark = typeof providerMark === 'function' ? providerMark : (() => '');
  const feedback = message => { $('boardFeedback').textContent = message; };

  function ensureExtraFields() {
    const form = $('taskForm');
    if (!form || form.querySelector('[name="due"]')) return;
    const handoff = form.querySelector('[name="handoff"]')?.closest('label');
    const wrap = document.createElement('div');
    wrap.className = 'task-extra-fields';
    wrap.innerHTML = `
      <label>Vence<input name="due" type="date" /></label>
      <label>Próximo paso<input name="nextAction" maxlength="500" placeholder="Siguiente acción concreta" /></label>
      <label>Bloqueo<input name="blocker" maxlength="500" placeholder="Qué impide avanzar (si hay)" /></label>`;
    if (handoff) handoff.after(wrap);
    else form.querySelector('footer')?.before(wrap);
  }

  function ensureSyncButton() {
    const actions = document.querySelector('.workbench-actions');
    if (!actions || $('boardSyncMem0')) return;
    const btn = document.createElement('button');
    btn.id = 'boardSyncMem0';
    btn.type = 'button';
    btn.className = 'ghost-btn';
    btn.textContent = 'Actualizar desde mem0';
    const exportBtn = $('boardExport');
    if (exportBtn) exportBtn.before(btn);
    else actions.prepend(btn);
    btn.addEventListener('click', syncMem0);
  }

  function limaToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function dueMeta(task) {
    if (!task.due) return '';
    const past = task.due < limaToday() && task.status !== 'done';
    return `<span class="task-due${past ? ' past' : ''}">vence ${e(task.due)}</span>`;
  }

  const motion = document.createElement('button'); motion.className = 'ghost-btn motion-toggle';
  let paused = false; try { paused = localStorage.getItem('workbench-motion-paused') === 'true'; } catch {}
  function setMotion() { document.body.classList.toggle('motion-paused', paused); motion.textContent = paused ? 'Activar fondo' : 'Pausar fondo'; motion.setAttribute('aria-pressed', String(paused)); }
  motion.addEventListener('click', () => { paused = !paused; setMotion(); try { localStorage.setItem('workbench-motion-paused', String(paused)); } catch {} });
  const topbar = document.querySelector('.topbar');
  if (topbar && !topbar.querySelector('.motion-toggle')) { topbar.append(motion); setMotion(); }
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('page-hidden', document.hidden));
  document.addEventListener('keydown', () => document.body.classList.add('keyboard-input'));
  document.addEventListener('pointerdown', () => document.body.classList.remove('keyboard-input'));

  async function api(url, body) {
    const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Request': '1' }, body: JSON.stringify(body) } : {});
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'No se pudo guardar el cambio');
    return result;
  }

  function options(selected = '') {
    const namesList = [...new Set([...projects.map(p => p.name), ...data.tasks.map(t => t.project)])].sort();
    return namesList.map(name => `<option value="${e(name)}" ${name === selected ? 'selected' : ''}>${e(name)}</option>`).join('');
  }

  function render() {
    ensureExtraFields();
    ensureSyncButton();
    const selected = $('boardProject').value;
    $('boardProject').innerHTML = '<option value="">Todos mis proyectos</option>' + options(selected);
    const tasks = data.tasks.filter(t => t.archived === $('boardArchived').checked && (!selected || t.project === selected) && (!$('boardAgent').value || t.agent === $('boardAgent').value) && `${t.title} ${t.description} ${t.handoff} ${t.project} ${t.nextAction || ''} ${t.blocker || ''}`.toLocaleLowerCase().includes($('boardSearch').value.toLocaleLowerCase()));
    const active = tasks.filter(t => t.status !== 'done');
    const missing = active.filter(t => !t.acceptance).length;
    $('boardSummary').innerHTML = `<span><strong>${active.length}</strong> pendientes</span><span><strong>${tasks.filter(t => t.status === 'doing').length}</strong> en curso</span><span><strong>${tasks.filter(t => t.status === 'done').length}</strong> entregadas</span><span class="board-summary-tip">${missing ? `${missing} tareas aún necesitan criterios de aceptación` : 'Cada entrega deja una base para la siguiente mejora'}</span>`;
    $('boardColumns').innerHTML = Object.entries(states).map(([status, label]) => {
      const column = tasks.filter(t => t.status === status).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) || b.updatedAt.localeCompare(a.updatedAt));
      return `<section class="board-column" data-status="${status}" aria-label="${label}"><header><span class="board-state-dot ${status}" aria-hidden="true"></span><h3>${label}</h3><span>${column.length}</span><button class="ghost-btn column-add" data-add="${status}" aria-label="Añadir tarea a ${label}">＋</button></header><div class="board-card-list">${column.length ? column.map(t => `<article class="board-task" data-id="${t.id}" draggable="${!t.archived}" aria-label="${e(t.title)}"><div class="task-meta"><span>${e(t.project)}</span><span class="task-priority ${t.priority}">${priorities[t.priority]}</span>${t.blocker ? '<span class="task-blocker">Bloqueo</span>' : ''}${dueMeta(t)}</div><button class="task-title" data-edit="${t.id}">${e(t.title)}</button>${t.nextAction ? `<p class="task-next">${e(t.nextAction.slice(0, 160))}</p>` : t.description ? `<p>${e(t.description.slice(0, 140))}</p>` : ''}<div class="task-owner">${mark(t.agent)}<span>${names[t.agent]}</span>${t.handoff ? '<span class="task-context">Contexto listo</span>' : ''}</div><div class="task-card-actions"><label class="sr-only" for="move-${t.id}">Mover ${e(t.title)}</label><select id="move-${t.id}" data-move="${t.id}" ${t.archived ? 'disabled' : ''}>${Object.entries(states).map(([key, value]) => `<option value="${key}" ${key === t.status ? 'selected' : ''}>${value}</option>`).join('')}</select><button class="ghost-btn" data-brief="${t.id}" aria-label="Copiar contexto de ${e(t.title)}">Copiar entrega ↗</button>${t.archived ? `<button class="ghost-btn" data-restore="${t.id}">Restaurar</button>` : ''}</div></article>`).join('') : `<div class="board-empty"><span aria-hidden="true">${status === 'done' ? '✓' : '·'}</span><p>${status === 'backlog' ? 'Tu siguiente mejora empieza aquí.' : status === 'doing' ? 'Enfócate en una tarea a la vez.' : status === 'review' ? 'Comprueba criterios y pruebas.' : 'Las entregas aparecerán aquí.'}</p><button class="ghost-btn" data-add="${status}">Añadir tarea</button></div>`}</div></section>`;
    }).join('');
  }

  async function load() {
    try { data = await api('/api/kanban'); render(); }
    catch (error) { feedback(error.message); }
  }

  async function mutate(body, message = 'Guardado en tu equipo') {
    if (saving) return false;
    saving = true;
    try {
      const available = data.plannerAvailable;
      data = await api('/api/kanban', body);
      data.plannerAvailable = available;
      render();
      feedback(message);
      return true;
    } catch (error) {
      feedback(error.message);
      $('taskFeedback').textContent = error.message;
      return false;
    } finally { saving = false; }
  }

  async function syncMem0() {
    const btn = $('boardSyncMem0');
    if (btn) btn.disabled = true;
    try {
      const result = await api('/api/kanban/sync-mem0', {});
      data = result;
      render();
      feedback(result.meta?.source === 'offline'
        ? `mem0 local offline. Sin cambios (${result.meta.updated || 0} actualizadas).`
        : `mem0: ${result.meta?.updated || 0} actualizadas, ${result.meta?.skipped || 0} sin cambio.`);
    } catch (error) {
      feedback(error.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openTask(task = null, status = 'backlog') {
    ensureExtraFields();
    editing = task;
    const form = $('taskForm');
    form.reset();
    form.elements.project.innerHTML = options(task?.project || $('boardProject').value);
    if (task) {
      for (const key of ['title', 'project', 'agent', 'status', 'priority', 'description', 'acceptance', 'handoff', 'due', 'nextAction', 'blocker']) {
        if (form.elements[key]) form.elements[key].value = task[key] ?? '';
      }
    } else form.elements.status.value = status;
    $('taskDialogTitle').textContent = task ? 'Editar tarea' : 'Nueva tarea';
    $('taskArchive').hidden = !task || task.archived;
    $('taskFeedback').textContent = '';
    $('taskDialog').showModal();
    form.elements.title.focus();
  }

  async function move(id, status) {
    const task = data.tasks.find(t => t.id === id); if (!task || task.status === status) return;
    if (await mutate({ action: 'update', id, version: task.version, task: { status } }, `«${task.title}» → ${states[status]}`)) {
      if (!dragId) $('boardColumns').querySelector(`[data-move="${id}"]`)?.focus();
      const element = $('boardColumns').querySelector(`[data-id="${id}"]`);
      if (element && !matchMedia('(prefers-reduced-motion: reduce)').matches && dragId) {
        element.animate([{ opacity: .5, transform: 'scale(.98)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' });
      }
    }
  }

  $('boardNew').addEventListener('click', () => openTask());
  $('taskClose').addEventListener('click', () => $('taskDialog').close());
  $('taskForm').addEventListener('submit', async event => {
    event.preventDefault();
    const task = Object.fromEntries(new FormData(event.target));
    $('taskSave').disabled = true;
    const ok = await mutate(editing ? { action: 'update', id: editing.id, version: editing.version, task } : { action: 'create', task });
    $('taskSave').disabled = false;
    if (ok) $('taskDialog').close();
  });
  $('taskArchive').addEventListener('click', async () => {
    if (await mutate({ action: 'archive', id: editing.id, version: editing.version }, 'Tarea archivada. Puedes restaurarla desde «Ver archivadas».')) $('taskDialog').close();
  });
  for (const id of ['boardProject', 'boardAgent', 'boardArchived']) $(id).addEventListener('change', render);
  $('boardSearch').addEventListener('input', render);
  $('boardColumns').addEventListener('change', event => { if (event.target.dataset.move) move(event.target.dataset.move, event.target.value); });
  $('boardColumns').addEventListener('click', async event => {
    const btn = event.target.closest('button'); if (!btn) return;
    if (btn.dataset.add) openTask(null, btn.dataset.add);
    if (btn.dataset.edit) openTask(data.tasks.find(t => t.id === btn.dataset.edit));
    if (btn.dataset.restore) { const task = data.tasks.find(t => t.id === btn.dataset.restore); await mutate({ action: 'restore', id: task.id, version: task.version }); }
    if (btn.dataset.brief) {
      try {
        const brief = await api(`/api/kanban/brief?id=${encodeURIComponent(btn.dataset.brief)}`);
        await navigator.clipboard.writeText(brief.text);
        feedback('Contexto copiado. Pégalo en Claude, Codex, Grok o AGY para retomar.');
      } catch (error) {
        feedback(`No se pudo copiar: ${error.message}. Usa Exportar para guardar el tablero.`);
      }
    }
  });
  $('boardColumns').addEventListener('dragstart', event => {
    const card = event.target.closest('[data-id]'); if (!card) return;
    dragId = card.dataset.id; event.dataTransfer.setData('text/plain', dragId); event.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging');
  });
  $('boardColumns').addEventListener('dragover', event => { if (!dragId) return; const column = event.target.closest('.board-column'); if (column) { event.preventDefault(); column.classList.add('drop-target'); } });
  $('boardColumns').addEventListener('dragleave', event => { const col = event.target.closest('.board-column'); if (col && !col.contains(event.relatedTarget)) col.classList.remove('drop-target'); });
  $('boardColumns').addEventListener('drop', async event => { event.preventDefault(); const col = event.target.closest('.board-column'); if (col && dragId) await move(dragId, col.dataset.status); dragId = null; });
  $('boardColumns').addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.dragging,.drop-target').forEach(el => el.classList.remove('dragging', 'drop-target')); });
  $('boardExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ schema: 1, revision: data.revision, tasks: data.tasks }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `mi-trabajo-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function renderSuggestions() {
    $('planSuggestions').innerHTML = suggestions.map((task, index) => `<article class="plan-suggestion"><div><span class="eyebrow">${names[task.agent]} · PRIORIDAD ${priorities[task.priority]}</span><h3>${e(task.title)}</h3><p>${e(task.description)}</p><p class="plan-acceptance">Entrega: ${e(task.acceptance)}</p></div><button class="radar-button" data-suggestion="${index}">Añadir al tablero</button></article>`).join('');
  }
  $('boardPlanForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('planSubmit').disabled = true; $('planSubmit').textContent = 'Preparando plan…'; $('boardPlanner').setAttribute('aria-busy', 'true');
    try {
      const result = await api('/api/kanban/plan', { project: $('planProject').value, goal: $('planGoal').value });
      suggestions = result.tasks; renderSuggestions();
      feedback('Plan de Claude listo para revisar. Añade las tareas que quieras trabajar.');
    } catch (error) { feedback(error.message); }
    finally {
      $('planSubmit').disabled = !data.plannerAvailable;
      $('planSubmit').textContent = 'Proponer plan con Claude';
      $('boardPlanner').removeAttribute('aria-busy');
    }
  });
  $('planSuggestions').addEventListener('click', async event => {
    const button = event.target.closest('[data-suggestion]'); if (!button) return; button.disabled = true;
    const index = Number(button.dataset.suggestion);
    if (await mutate({ action: 'create', task: suggestions[index] }, 'Propuesta añadida al tablero')) {
      suggestions.splice(index, 1); renderSuggestions();
    } else button.disabled = false;
  });

  document.addEventListener('dashboard:tier', event => { if (event.detail === 'kanban') load(); });
  ensureExtraFields();
  ensureSyncButton();
  Promise.all([api('/api/kanban'), api('/api/projects')]).then(([board, repos]) => {
    data = board; projects = repos.filter(p => p.org === 'personal');
    $('planProject').innerHTML = options();
    $('planSubmit').disabled = !data.plannerAvailable;
    if (!data.plannerAvailable) $('plannerNote').textContent = 'Instala e inicia sesión en Claude CLI para generar planes. Puedes crear y asignar tareas manualmente.';
    render();
  }).catch(error => feedback(error.message));
  setInterval(() => {
    if (document.body.dataset.section === 'kanban' && !document.hidden && !$('taskDialog').open && !saving && !dragId) load();
  }, 15000);
})();
