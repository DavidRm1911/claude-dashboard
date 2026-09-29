# Espacio local — agent dashboard

## Qué hace el proyecto

Local dashboard for Claude Code, Codex, Grok and Antigravity CLI usage, projects, kanban coordination, and an opt-in AWS/jobs Radar. Node.js 22+, no runtime dependencies. HTTP listens only on 127.0.0.1.

## Cómo correrlo

`npm start` → http://127.0.0.1:4949. `npm run demo` → isolated synthetic data at port 4950. `npm test` → deterministic Node tests. `.env.local` is loaded only by `npm run start:config`.

## Archivos clave

- `server.js`: HTTP routes, Claude usage aggregation, optional generators.
- `lib/security.js`, `usage.js`, `pricing.js`, `providers.js`: request/path validation, deduplication, price coverage and other agents.
- `lib/kanban.js`, `planner.js`: versioned task storage and reviewable Claude proposals.
- `lib/radar.js`, `aws-knowledge.js`, `cv.js`: public sources, manual MCP search, localhost PDF extraction.
- `public/`: vanilla UI; third-party assets attributed in THIRD_PARTY_NOTICES.md.
- `scripts/demo*.mjs`: isolated demo fixtures; never seed a real home directory.
- `docs/AGENT-WORKFLOW.md`: handoff protocol for all terminal agents.

## Sugerencias de mejora

Validate more CLI versions/platforms; improve legacy modal keyboard behavior; measure large-history parsing before indexing; keep pricing and promotional sources current. Never fabricate missing usage, cost, hiring likelihood or eligibility.

Preserve opt-in network features, loopback, Host/Origin and POST validation. Do not commit real logs, credentials, preferences, CVs, generated graphs or screenshots with private data. `.claude/okf.jsonld` stays local and ignored. Run relevant tests before changes are published.
