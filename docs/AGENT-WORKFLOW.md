# Un tablero para todos tus agentes

Claude, Codex, Grok y Antigravity pueden trabajar con el mismo kanban si tienen terminal o HTTP local. El tablero coordina tareas; no despacha procesos automáticamente.

## Instrucción para añadir a tu AGENTS.md / CLAUDE.md

```text
Antes de trabajar en una tarea del dashboard local, consulta GET
http://127.0.0.1:4949/api/kanban y lee su ID, versión, objetivo, criterios
y contexto de entrega. Trabaja únicamente en el proyecto indicado.
Actualiza por POST al mismo endpoint con Content-Type: application/json
y X-Dashboard-Request: 1. Deja archivos, decisiones, pruebas y bloqueos
en handoff. Estados: backlog, doing, review, done. Un HTTP 409 exige
releer la versión y preservar el avance del otro agente antes de guardar.
No escribas directamente kanban.json mientras el servidor corre.
```

Usa tu puerto configurado si es distinto de 4949. Copiar entrega ya incorpora este contexto y la tarea concreta.

## Leer

```sh
curl http://127.0.0.1:4949/api/kanban
curl 'http://127.0.0.1:4949/api/kanban/brief?id=ID_DE_TAREA'
```

## Crear

```sh
curl http://127.0.0.1:4949/api/kanban \
  -H 'Content-Type: application/json' -H 'X-Dashboard-Request: 1' \
  --data '{"action":"create","task":{"title":"Comprobar onboarding","project":"nombre-del-repo","agent":"codex","priority":"high","acceptance":"Instalación limpia y pruebas pasan"}}'
```

Responsables: `human`, `claude`, `codex`, `grok`, `agy`. Prioridades: high/medium/low. El proyecto debe ser una carpeta existente dentro de DASHBOARD_PROJECTS_DIR.

## Actualizar sin perder cambios

```sh
curl http://127.0.0.1:4949/api/kanban \
  -H 'Content-Type: application/json' -H 'X-Dashboard-Request: 1' \
  --data '{"action":"update","id":"ID_DE_TAREA","version":1,"task":{"status":"review","handoff":"Cambios: README.md. Verificación: npm test. Pendiente: revisión humana."}}'
```

La respuesta incluye la nueva versión. Sustituye 1 por la versión que acabas de leer. Una actualización no debe borrar el contexto anterior de otro agente. No declares Listo hasta comprobar los criterios de aceptación.

Para archivar o restaurar envía `action: archive` o `restore`, ID y versión. No hay borrado permanente en la API.

## Respuestas

200 = guardado; 400 = entrada inválida/proyecto fuera de carpeta; 403 = Host/Origin/encabezado rechazado; 404 = tarea ausente; 409 = conflicto de versión. Texto limitado por campo y máximo de 2.000 tareas contando las archivadas.

Si el servidor está apagado, continúa con contexto del repo y deja una nota de entrega; sincroniza el tablero cuando vuelva a estar disponible.
