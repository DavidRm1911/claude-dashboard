# Espacio local — local agent workspace

A local dashboard for Claude Code, Codex, Grok and Antigravity CLI usage, a project kanban with shared handoff context, and an opt-in AWS/jobs Radar. No dashboard account, runtime dependencies or build step.

## Quick start

Install Node.js 22+ and Git:

```sh
git clone https://github.com/DavidRm1911/claude-dashboard.git
cd claude-dashboard
npm start
```

Open http://127.0.0.1:4949. To explore without reading real logs, run `npm run demo` and open http://127.0.0.1:4950. UI and video captions are currently Spanish. macOS has been tested with real local logs; complete Windows support is not claimed.

**[Watch the walkthrough](media/uso.mp4)** · [Spanish guide](USAGE.md) · [Agent handoff API](AGENT-WORKFLOW.md)

Use the agent buttons to enable other local log sources. Assign tasks, move them through the board and copy handoff context into your agent session. Assignment does not launch an agent. The Claude planner proposes tasks for review, using your authenticated CLI.

Radar reads public AWS, Remotive and Get on Board sources only after activation. CV matching stays local; PDF text extraction needs `pdftotext`. Credits have eligibility conditions. API price equivalents are estimates, not subscription bills. Missing telemetry is shown as N/D, not zero.

Personal projects default to `~/dev/GitHub`; work projects to `~/dev/Work`. Copy `.env.example` to `.env.local`, edit absolute paths and run `npm run start:config`. Enable legacy AI generators with `DASHBOARD_ENABLE_AI=1`; they can send project documentation and notes to the provider. Do not expose the server to the Internet.

Run `npm test` before contributing. MIT for original software; third-party assets retain their own attribution and rights.
