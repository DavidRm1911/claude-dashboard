# Desarrollo y alcance

Node HTTP sirve una interfaz vanilla HTML/CSS/JS. Los adaptadores leen archivos locales y normalizan uso; los stores guardan preferencias y datos privados fuera del repo. Chart.js se distribuye localmente con atribución. No hay base de datos remota ni telemetría.

## Módulos

| Módulo | Responsabilidad |
| --- | --- |
| server.js | API, lectura Claude, agregados y generadores opcionales |
| security.js | Loopback Host/Origin, protección POST, JSON acotado y confinamiento de repos |
| usage.js / pricing.js | Deltas de snapshots, TTL de caché y precios de referencia fechados |
| providers.js | Codex/Grok/AGY, cobertura de campos y opt-in persistente |
| kanban.js / planner.js | Escritura atómica privada, versiones y propuestas Claude sin herramientas |
| radar.js / aws-knowledge.js | Feeds públicos, allowlists, caché/cooldowns y búsqueda MCP manual |
| cv.js / public/job-match.js | Extraer texto PDF local y coincidencias técnicas explicables |
| scripts/demo*.mjs | Datos sintéticos en un HOME temporal |

## Verificación

`npm test` usa fixtures sintéticos y no necesita cuentas ni red. CI configura Node 22/24 en Linux/macOS. La publicación inicial tiene 50 pruebas funcionales, además de verificación Chrome del kanban, logos y responsive. El modo demo permite repetir QA sin datos personales.

## Límites conocidos

- Archivos internos de los CLIs pueden cambiar; validar cada versión antes de afirmar soporte.
- La deduplicación Claude entre perfiles que copien la misma sesión todavía no está resuelta.
- Parte de los agregados Claude usa días; otras fuentes usan timestamps exactos. Las cifras no son una contabilidad fiscal.
- Modales/interacciones heredadas requieren más pruebas de accesibilidad. El nuevo editor de tareas usa dialog nativo.
- No se afirma soporte completo Windows, Antigravity IDE o sesiones cloud sin logs locales.
- El planificador tiene pruebas de proceso/protocolo con respuestas simuladas; una llamada autenticada depende de cuenta, cuota y versión de CLI.
- Cambios del kanban pueden perderse si herramientas externas escriben su JSON directamente; los agentes deben usar la API.
- Sin importar JSON por UI en esta versión. El respaldo se restaura con el servidor detenido.

## Video

`tools/video/record.mjs` graba la demo en Chrome con Playwright y añade rótulos. El video publicado contiene solo ejemplos. Requiere herramientas de desarrollo opcionales y FFmpeg; consulta tools/video/README.md. Estas dependencias no son necesarias para usar la app.
