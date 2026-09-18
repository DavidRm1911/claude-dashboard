# claude-dashboard

Local dashboard that reads Claude Code's session `.jsonl` files directly from disk and shows token usage, cost estimates, activity heatmaps, installed skills, MCP servers, and project graphs — across up to 3 profiles (`~/.claude`, `~/.claude-work`, `~/.claude-personal`).

## How to run

```bash
node server.js        # or: npm start / npm run dev
# Opens at http://localhost:4949
```

No build step. No dependencies to install (uses only Node built-ins). Requires Node 18+ for native `fetch`.

## Key files

| File | What it does |
|---|---|
| `server.js` | HTTP server (no framework). Reads `.jsonl` session files, parses usage/cost per turn, aggregates by day/model/account, exposes `/api/stats`, `/api/session/:id`, `/api/history`, `/api/workspace`, `/graphify-graph`. 8s cache on raw data. |
| `public/index.html` | Single-page layout. All sections are in HTML; JS fills them dynamically. Loads Chart.js from CDN (D3 was removed along with the force-directed project graph). |
| `public/app.js` | All frontend logic: fetches `/api/stats`, renders stat cards (with vs.-previous-period deltas), 4-series token chart + cache-hit-rate chart (Chart.js), activity heatmap bar chart, sorted project-usage bars, session replay modal, skill/MCP cards. Auto-refreshes every 30s. |
| `public/style.css` | Light editorial design — Playfair Display headlines, Plus Jakarta Sans body, JetBrains Mono for numbers. CSS custom properties only, no framework. |

## Profiles and data sources

Server reads from three hardcoded profile paths:
- `~/.claude.json` + `~/.claude/projects/**/*.jsonl`
- `~/.claude-work/.claude.json` + `~/.claude-work/projects/**/*.jsonl`
- `~/.claude-personal/.claude.json` + `~/.claude-personal/projects/**/*.jsonl`

Accounts with the same `oauthAccount.accountUuid` are merged automatically.

## Typical workflows with Claude Code

- **Add a new model to the pricing table**: edit `PRICING_PER_MTOK` in `server.js` (lines 32–45). The `getPricing()` fallback does prefix matching so `claude-sonnet-4-7` would already resolve correctly.
- **Add a new profile**: append to the `PROFILES` array at line 15–19 in `server.js`.
- **Add a shell command to the "Comandos" section**: edit the `COMMANDS` array at lines 29–36 in `public/app.js`.
- **Add an MCP server card**: edit `MCP_SERVERS` at lines 17–27 in `public/app.js`.
- **Change graphify targets**: edit `GRAPHIFY_TARGETS` at lines 21–24 in `server.js`.

## Information architecture

The page is split into 4 tabs by how often each thing actually changes, not by topic — a `#tierTabs` bar right under the toolbar switches which `[data-tier]` sections are visible (nav links filter to match). Nothing about section render logic changes, only visibility:

- **`daily`** (Pulso diario): resumen, cacheNote, tokens/cache chart + model bars, day drilldown, actividad, historial
- **`weekly`** (Análisis semanal): costos, insights, proyectos
- **`monthly`** (Inventario mensual): ideas-ia, mis-proyectos, auditoria
- **`yearly`** (Entorno anual): cuentas, skills, mcp, comandos, workspace

Active tier persists in `localStorage` (`claude-dashboard-tier`). The old GSAP ScrollTrigger scroll-reveal was removed — with tabs there's no scroll depth left to key a reveal off — replaced by a plain fade-in (`revealTier()`) on tab switch.

The old `#topbarLinks` nav (14 anchor links) was removed entirely — an independent `impeccable` critique (dual-agent, see `.impeccable/critique/`) flagged it as duplicating the exact same 4-group taxonomy as the tier-tabs, in the same viewport. `#tierTabs` is now the sole navigation mechanism; `setupNavSpy()` (the IntersectionObserver that highlighted the nav's active link) was removed along with it since it had nothing left to observe.

## Custom idea research & per-project status

- **`ideas-ia`** now also takes a free-text idea (`#customIdeaInput` → `POST /api/ideas/generate?idea=<text>`). Same `ideasJob`/`ideas.json` store as the monthly auto-generation, just a different prompt (`buildCustomIdeaPrompt` in `server.js`) that researches that one idea specifically and adds a `"verdict"` field ("vale la pena" / "vale la pena con ajustes" / "no vale la pena por ahora"). Entries are tagged `custom: true`.
- **`mis-proyectos`** now covers both `~/dev/GitHub` and `~/dev/GITHUB-NEO`, split by an org toggle (`#projectOrgToggle`, client-side filter on `appState.projectOrg`). "Generar análisis" (`POST /api/project-status/generate`) batches all projects into one `claude -p` call (`runProjectStatusGeneration` in `server.js`) that returns, per project: `description`, `progress_pct`, `progress_reasoning`, `improvements[]`, and a skill suggestion — cached to `~/.claude-dashboard/project-status.json`.
- **Skill suggestion per project**: the prompt gets the full deduped skill list across all 3 profiles (`gatherAllSkills()`) and is told to pick either an installed skill (`skill_is_new: false`) or propose a new one. Two defenses against the model inventing a plausible-sounding installed name: (1) the prompt requires copying the name letter-for-letter from the given list, and (2) `runProjectStatusGeneration` re-checks `skill_suggestion` against the real `skills` array server-side and forces `skill_is_new` — never trust the model's own claim about what's already installed. `skill_purpose` (what the skill does in general) is likewise overwritten with the skill's real `SKILL.md` description when it's an existing one; only for genuinely new proposals is the model's own purpose text kept, since there's no ground truth to check it against.
- **Private per-project notes**: `.claude/project-notes.md` inside each project directory feeds extra context (blockers, roadmap, WIP state) into that analysis prompt. It's never shown raw on the frontend, only synthesized. "+ Nota privada" (`POST /api/project-notes/create`) creates it from a template and calls `ensureGitignored()` to append `.claude/project-notes.md` to that project's own `.gitignore` — same "local only, never pushed" convention as this repo's own `.claude/okf.jsonld`.
- **"+ Generar CLAUDE.md"** on grayed-out (`hasDoc: false`) cards runs `claude -p` with `cwd` set to that project's own directory (`execCapture` now takes a `cwd` option) and `--allowedTools Read,Glob,Grep,Write`, asking it to write a real `CLAUDE.md` there (`runClaudeMdGeneration` in `server.js`, job state in the `claudeMdJobs` Map, `GET /api/project-claude-md/jobs` / `POST /api/project-claude-md/generate`). Frontend polling for this is per-button (`claudeMdPending` Set + `triggerClaudeMdGeneration`), not a full grid rebuild — see perf note below.
- **Perf: poll ticks don't rebuild the whole card grid.** `loadProjectStatus()`/`loadIdeas()` used to call the full `renderGithubProjects()`/`renderIdeas()` (rebuild dozens of card DOM nodes) on every 5s poll tick even when nothing changed — real, avoidable jank once cards got content-heavy (progress bar, reasoning, improvements, skill box). Both now diff `job.status`/`entries.length`/`generatedAt` before/after the fetch and only do the full rebuild when something actually changed; otherwise they call the cheap `updateProjectStatusToolbar()`/`updateIdeasToolbar()` (button + status text only). Same reasoning is why the CLAUDE.md-generation poll patches individual buttons directly instead of going through `renderGithubProjects()` at all.
- **Card layout**: `.project-card` is `display:flex; flex-direction:column` with `.project-card-actions { margin-top: auto }` so the action buttons ("+ Nota privada", "+ Generar CLAUDE.md") pin to the bottom edge of every card in a row regardless of how much AI-analysis content is above them — before this, cards of different content length looked staggered/messy since the buttons just followed normal document flow.

## Entrevista Cloud Architect (system design interview prep)

- **Burbuja flotante, no un tier**: vive en `#interviewWidget` (fuera de `<main>`, junto al `#projectModal`), `position: fixed` abajo a la izquierda — no está atado a ningún `data-tier`, así que es visible siempre sin importar el tab activo. Colapsada por defecto (`#interviewBubbleBtn`, 💬); al abrirla (`setupInterviewWidget` en `app.js`) recuerda el estado en `localStorage` (`claude-dashboard-interview-open`) y solo ahí dispara `loadInterviewSessions()` la primera vez — no tiene sentido pedir `/api/interview/sessions` si nunca se abre. Antes vivía como `<section data-tier="monthly">`, se migró a burbuja a pedido explícito de David.
- Chat de práctica de entrevista "system design" para el puesto de Cloud Architect. Ningún CLI tiene estado entre llamadas, así que cada turno reconstruye el prompt completo — persona de entrevistador + `DAVID_CLOUD_BACKGROUND` (certs y stack real, editar a mano cuando cambie algo, ej. al sacar el SAP) + `contextBlock` (proyectos reales) + `memoryContext` (mem0) + la transcripción entera hasta ahora.
- **Motor del turno = Gemini primero, Claude de respaldo** (`runInterviewModelTurn`): el trabajo pesado y repetido (un turno por respuesta de David) corre en **Gemini vía `agy`** (Antigravity CLI, reutiliza el login de Google de David, sin API key) con `--model gemini-3.1-pro-high` — decisión explícita de David para no gastar su cuota de Claude en algo que se usa muchas veces por sesión. `agy` trae grounding de búsqueda nativo (confirmado corriéndolo: sabe la fecha real y eventos recientes de AWS sin pedirlo) y `--json-schema` fuerza el shape `{speak, mistakes[], verdict, done}` — el propio CLI devuelve `structured_output` ya parseado, sin regex. Si `agy` falla, cae a `claude -p` con el mismo prompt pero SIN el schema enforcement, así que ese prompt sí necesita el bloque explícito "responde solo con este JSON" (`buildInterviewTurnPrompt(session, {strictJsonInstruction: true})`) — pedirle ese bloque a Gemini a la vez que se le fuerza el schema hace que anide el JSON completo dentro de `"speak"` (bug real, confirmado corriendo el flujo).
- **Memoria = mem0, no Claude por turno**: `recallInterviewMemory()`/`saveInterviewMemory()` son las ÚNICAS dos llamadas a Claude por sesión (leer al primer turno, escribir al cerrar) — usan `claude -p --allowedTools mcp__mem0__search_memories|add_memory`, aprovechando que mem0 ya está registrado a nivel de usuario (`claude mcp list`). El resto de turnos nunca tocan Claude ni mem0.
- **Flujo**: `POST /api/interview/start` (`{focus: "aws"|"gcp"|"general"}`) crea la sesión (contextBlock/memoryContext en `null`) y dispara el primer turno en background; `POST /api/interview/respond?id=X` (`{answer}`) agrega la respuesta del candidato y dispara el siguiente turno. Ambos son `202` inmediato — el frontend hace polling de `GET /api/interview/session?id=X` cada 4s mientras `job.status === "running"`. `runInterviewTurn` llena `contextBlock`/`memoryContext` de forma perezosa (`if (session.contextBlock == null)`) solo en el primer turno, para no bloquear el `POST /start` con la recuperación en mem0.
- **Persistencia**: todas las sesiones en un solo array en `~/.claude-dashboard/interviews.json` (mismo patrón que `ideas.json`/`project-status.json`), capado a las últimas 40.
- **`resolveBin` / `CLAUDE_BIN` / `GROK_BIN` / `AGY_BIN`**: este dashboard corre como LaunchAgent (`~/Library/LaunchAgents/com.davidgallo.claude-dashboard.plist`, `KeepAlive: true`), no desde una shell interactiva — launchd no carga el profile de shell, así que el PATH real del proceso es el mínimo del sistema (`/usr/bin:/bin:/usr/sbin:/sbin`), sin `/opt/homebrew/bin` ni `~/.local/bin`. Confirmado corriéndolo de verdad (`ps eww <pid> | grep PATH`) después de que `spawn("claude")`/`spawn("agy")` reventaran con ENOENT bajo un restart normal. `resolveBin()` busca el binario en `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` en ese orden y usa la ruta absoluta — si en algún momento se agregan más binarios de IA (otro CLI), pasar por `resolveBin()`, nunca el nombre pelado.
- **Los exit codes de `claude -p` no son confiables por sí solos aquí**: un hook de `SessionEnd` de David (`session-end-obsidian.sh`) falla bajo el PATH recortado de launchd y deja `claude -p` en exit 1 aunque stdout ya tenga la respuesta correcta — confirmado corriendo el mismo comando a mano. `recallInterviewMemory` y el fallback de Claude en `runInterviewModelTurn` confían en si hay texto/JSON parseable en `stdout`, no en el exit code.
- **mem0 no siempre está sano** (ver [[mem0 testing 2026-09-01]]/[[mem0 fix 2026-08-31]] en memoria): a veces devuelve su propio error de infraestructura (ej. `"Failed to authenticate: OAuth session expired"`) en vez de un resultado — `recallInterviewMemory` filtra esos patrones para no meterlos en el prompt de la entrevista como si fueran una memoria real. Si `memoryContext` sale `null` seguido, revisar `~/Library/Logs/claude-dashboard/stderr.log` (grep `[interview]`) antes de asumir que es un bug del dashboard.
- **`sanitizeJsonControlChars`**: solo se usa ya en el fallback de Claude (regex + parseo manual) — el modelo devuelve texto multi-párrafo con saltos de línea reales sin escapar dentro del JSON, y `JSON.parse` revienta con "Bad control character in string literal". Gemini vía `--json-schema` no lo necesita, el CLI ya entrega JSON válido.
- **`currentInterviewId`** persiste en `localStorage` para retomar una entrevista activa tras recargar la página, igual que `claude-dashboard-tier`.
- **Reporte final (turno de cierre, `done: true`)**: el schema del turno tiene 2 claves extra, `study_plan[]` (3-5 temas concretos derivados de los errores reales de la sesión, con `why` y `how_to_study`) y `career_guidance` (nivel actual honesto, puesto a buscar hoy, rango salarial Perú/PEN y remoto LatAm/USD — el prompt le pide a Gemini verificar cifras con su búsqueda web en vez de inventarlas). Vacíos ([]/null) en todo turno que no sea el de cierre. `runInterviewTurn` los guarda en `session.studyPlan`/`session.careerGuidance` solo cuando `turn.done`. El frontend (`renderInterviewReport` en `app.js`) los pinta como una card `.interview-report` aparte, no como un turno de chat más. `saveInterviewMemory` incluye los topics del study_plan en el resumen que manda a mem0, para que la siguiente entrevista ya sepa qué le tocó estudiar.

## Improvement suggestions

1. **The `PROFILES`, `GRAPHIFY_TARGETS`, `MCP_SERVERS`, and `COMMANDS` arrays are all hardcoded**. Moving them to a `config.json` (or reading from `~/.claude/settings.json`) would let you change targets without touching JS source — and let Claude Code edit config without touching server logic. *(still open — the one item from the original audit not yet done.)*

### Resolved from the original audit

- **Session replay truncation** — `extractTurnParts` in `app.js` now renders `tool_result` blocks (previously dropped entirely), and turns over 800 chars get a per-turn "Mostrar completo" toggle instead of a hard cut.
- **`collectProfileRaw` blocking the event loop** — `walk()`, `collectProfileRaw`, `getProjectInfo`, `collectSkillsRaw`, `gatherActivitySignal`, `gatherObsidianNotes`, `calcDirSize(Full)` now all use `fs.promises` instead of the `*Sync` calls.
- **Heatmap hardcoded to 90 days** — `renderHeatmap` in `app.js` now derives its window from `appState.range` (falls back to 90 for "all").
- **No error boundary on `/api/stats` for corrupted `.jsonl` lines** — parse failures in `collectProfileRaw` and the session-replay handler now log `file:line` + the error to stderr.
- **KPI comparison vs. previous period** — `computeAccountView` in `server.js` now takes `{fromDay, toDay}` so `buildPayload` can recompute the same aggregate over the immediately preceding period (`previousTotals`, `null` for "all"). `deltaBadge()` in `app.js` shows the % (or pp, for rates) change with polarity: cost↑ = red/bad, cache-hit↑ = green/good, everything else neutral.
- **Chart redesign** — done via the `dataviz` skill's method (form → color-formula → validator, never eyeballed):
  - Activity heatmap → a Chart.js bar chart of daily message counts, click-through to the day drilldown (same UX as the tokens chart).
  - Force-directed D3 account→project graph → sorted horizontal bars (`.model-bar-row` reused), colored by account identity with the account org as a direct label. D3 CDN script removed — nothing else used it.
  - Tokens-by-day chart → 4 stacked categorical series (input / cache-write / cache-read / output) instead of 1 series per account. New `--tok-*` CSS custom properties in `style.css`, validated with the dataviz skill's `scripts/validate_palette.js` against this app's actual light (`#FFFFFF`) and dark (`#13131F`) surfaces — all checks PASS on the adjacent pairlist.
  - Cache-hit-rate line → added as a **separate small-multiple chart** (`#cacheHitChart`) sharing the same day x-axis, not a second y-axis on the bars — a dual-axis chart is the dataviz skill's #1 anti-pattern.
