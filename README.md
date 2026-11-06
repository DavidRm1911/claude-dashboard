# Espacio local para agentes (nombre público pendiente)

Un dashboard local para consultar el uso registrado de Claude Code, Codex, Grok y Antigravity CLI. Tus registros se leen desde tu equipo; el dashboard no necesita una API key ni envía telemetría.

También incluye **Radar**: arquitecturas y novedades AWS, créditos/formación y empleo remoto para Perú y LATAM/global. El CV se guarda en el navegador y ordena vacantes por coincidencia técnica local. El nombre público definitivo está pendiente; el directorio y los identificadores existentes se conservan para no romper tu configuración.

## Ejecutar

Requiere Node.js 22 o superior. No hay dependencias de servidor que instalar ni paso de compilación.

```sh
cd claude-dashboard
npm start
```

Abre `http://127.0.0.1:4949`. El servidor escucha exclusivamente en loopback. No es un servicio para desplegar en Internet, ni un panel con autenticación multiusuario.

## Conectar tus agentes

Claude Code se detecta en sus perfiles locales. En **Tus agentes**, pulsa **Agregar Codex**, **Agregar Grok** o **Agregar AGY**. Puedes desconectarlos y copiar el comando para iniciar cada CLI dentro de un proyecto. Las conexiones se guardan en `~/.claude-dashboard/providers.json`, con permisos privados. Conectar una fuente no inicia el agente ni modifica su autenticación.

| Fuente | Registros | Lo que muestra |
| --- | --- | --- |
| Claude Code | `~/.claude/projects`, `~/.claude-work/projects`, `~/.claude-personal/projects` | Tokens, caché, referencia de costo API, proyectos, actividad y replay |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | Sesiones, tokens por modelo del turno, referencia API base y último snapshot de cuotas |
| Grok | `~/.grok/sessions/**/{summary,usage}.json` | Sesiones y uso por turno/modelo, con costos en ticks donde se registraron |
| AGY | `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript*.jsonl` | Sesiones, actividad diaria y herramientas. Tokens no disponibles en el formato verificado |

Los formatos son archivos internos de cada herramienta y pueden cambiar. `N/D` significa **sin datos verificables**, nunca cero uso. Las sesiones de ChatGPT/Codex en la nube que no produzcan registros locales no están cubiertas. El cliente de Antigravity IDE puede usar un almacenamiento distinto del CLI, que no se ha validado.

Los contadores acumulados de Codex se convierten en incrementos y no se suman de nuevo en cada notificación. En Grok se suman los turnos una sola vez, sin sumar también el total de la sesión. En AGY se elige una sola transcripción por conversación.

En **Otras IAs** puedes consultar modelos, actividad diaria UTC, proyectos y sesiones recientes. En estas fuentes, el rango usa timestamps exactos de incrementos/actividad. Claude conserva buckets diarios. Las tablas de sesiones muestran tokens y valores monetarios de **toda la sesión**, no solo del rango. El filtro de cuenta solo afecta a Claude.

El equivalente API de Claude usa tarifas verificadas el 29 de septiembre de 2026, en `lib/pricing.js`. Incluye Sonnet 5/5.5 y Opus 5/5.5; la creación de caché de 5 minutos y de 1 hora se calcula por separado. Si falta duración, se muestra un intervalo de referencia 5m–1h. Los modelos desconocidos no heredan tarifas de versiones anteriores: costo N/D, subtotal parcial y cobertura explícita. El equivalente usa precios actuales, no precios históricos efectivos, descuentos privados, cargos por servicios adicionales ni impuestos. No es una factura, deuda ni cuota de una suscripción.

Codex muestra una referencia **base API estándar** para modelos verificados (gpt-6-sol, gpt-5.6-terra, gpt-5.5 y gpt-5.4-mini), atribuyendo cada incremento al modelo del turno. No incluye recargos de contexto largo, Fast, región, ni escritura de caché sin desglose local. Nunca se presenta como gasto del plan. Sus cuotas son el último snapshot observado, con fecha, plan y sesión, independiente del rango. No identifica/verifica la cuenta actual ni mezcla snapshots de planes distintos; el reset puede haber pasado. Para límites actuales consulta `/status` o el panel oficial.

Grok convierte `costUsdTicks` con **1 USD = 10¹⁰ ticks**, sin sumar también el total de sesión. Un turno sin costo queda desconocido, no cero. El total reportado es parcial, con cobertura por sesiones; no se equipara a la factura de un plan. AGY mantiene costos/cuotas/tokens N/D cuando no aparecen en la fuente, y no inventa el proyecto o modelo.

## Radar: construir, aprender y encontrar trabajo

Abre **Radar** y pulsa **Activar Radar**. Es opt-in para cada instalación: no hace conexiones externas antes de activarlo. AWS recibe consultas a RSS cada hora como máximo; Remotive y Get on Board cada seis horas. La actualización ocurre al abrir Radar, al pulsar Actualizar o mientras esa pestaña está visible. No es un monitor permanente cuando el dashboard está cerrado.

Fuentes predefinidas:

- [AWS Builder Center, Atom público](https://builder.aws.com/rss): contenido de la comunidad. Su feed indica fecha de actualización, no necesariamente de publicación; puede omitir autores y acreditaciones. No los inventamos.
- [Architecture Blog](https://aws.amazon.com/blogs/architecture/feed/), [Compute Blog](https://aws.amazon.com/blogs/compute/feed/), [News Blog](https://aws.amazon.com/blogs/aws/feed/) y [Training & Certification](https://aws.amazon.com/blogs/training-and-certification/feed/): feeds oficiales AWS con autor y fecha cuando están presentes.
- [Remotive](https://remotive.com/remote-jobs/api): API pública de empleos, con atribución y enlace original. Sus anuncios tienen 24 horas de retraso; se consultan como máximo cuatro veces al día por instalación, incluso tras reiniciar.
- [Get on Board](https://www.getonbrd.com/jobs/feed): feed público XML propio, con enlace original, empresa, resumen y país declarado. Se importa un subconjunto tecnológico; se conservan Perú y LATAM cuando la fuente indica países compatibles. El servidor lo etiqueta `text/html`, aunque el cuerpo es XML. El feed puede cambiar sin aviso.

El catálogo inicial se concentra en cloud/AWS/backend/DevOps. El filtro inicial muestra Perú y remoto LATAM/global; “remoto” sin lista de países no cuenta como global. AWS Careers, AWS Educate y búsquedas adicionales de Get on Board son accesos, no vacantes importadas. No se rastrea LinkedIn ni se envían postulaciones.

### Créditos de AWS y CV

- AWS Free Tier: clientes nuevos pueden recibir USD 100 al crear la cuenta y ganar hasta USD 100 adicionales con actividades elegibles (AWS describe USD 20 por actividad en EC2, RDS, Lambda, Bedrock y Budgets). El plan gratuito dura hasta seis meses o hasta agotar créditos; créditos aplicables vencen a los 12 meses. Uso no elegible o que exceda créditos puede generar cargos, especialmente en plan Paid. Revisa las [preguntas frecuentes oficiales](https://aws.amazon.com/free/free-tier-faqs/) y los [términos](https://aws.amazon.com/free/terms/).
- AWS Activate Founders puede ofrecer USD 1,000 iniciales y hasta USD 5,000 para startups que califican y reciben aprobación; Activate Portfolio requiere relación con proveedor y solicitud. Consulta [requisitos actuales](https://aws.amazon.com/startups/credits). No son regalos universales.
- En **Créditos AWS**, **Descubrir con AWS Knowledge MCP** hace una búsqueda manual genérica en el servidor oficial AWS. Sin autenticación, sujeto a límites; pausa mínima de 12 horas. Resultados externos se limitan a páginas oficiales AWS. Los resultados MCP se muestran como hallazgos por verificar, no como ofertas aprobadas. El MCP recibe una consulta genérica fija y tu IP, nunca tu CV, proyectos o historial.
- Puedes pegar el CV o importar TXT/MD/PDF. PDF se extrae con `pdftotext` instalado en el equipo y solo se envía al dashboard local para esa conversión. El contenido se guarda en `localStorage` del navegador y se puede borrar desde Radar. La comparación usa una lista pequeña de tecnologías y una vista previa de la vacante; ayuda a priorizar y no estima probabilidades de contratación.

Los temas y la marca **Posible oportunidad** se detectan por palabras clave, no por IA ni verificación de gratuidad. La selección editorial de beneficios tiene fuente, condiciones, fecha de revisión y vencimiento explícito cuando se conoce. Después de 30 días se pide revisar condiciones. No se promete un cupón, crédito o regalo universal; ni se confunde una microcredencial con un examen de certificación gratuito.

Solo se almacenan títulos, extractos breves y metadatos. Los artículos completos se leen en su origen. La copia y las marcas se guardan en `DASHBOARD_DATA_DIR/radar.json`, fuera del repo, con modo `0600`. Máximo 600 entradas, 90 días de historial no guardado y 200 guardados. Las vacantes guardadas que desaparecen del feed se etiquetan como ausentes, no como abiertas. Fuentes caídas conservan la copia y muestran su antigüedad. Un intervalo de fecha excluye entradas sin fecha de publicación/actualización; la fecha de revisión editorial no se sustituye por fecha de publicación.

Puedes pausar consultas y seguir trabajando con la copia local. Las fuentes reciben tu IP y un User-Agent genérico de lector; el MCP recibe además una búsqueda fija no personal. No reciben proyectos, sesiones, CV, credenciales ni guardados. Las vacantes descargadas incluyen extracto breve; la vacante completa se lee en el sitio de origen. No hay imágenes remotas, cookies de login, claves API ni llamadas a modelos. Los endpoints de descarga son fijos: no se aceptan URLs arbitrarias y se validan redirecciones HTTPS.

### ¿Hay un MCP para Builder Center?

El [catálogo oficial AWS Labs](https://github.com/awslabs/mcp#-real-time-access-to-official-aws-documentation) incluye Builder Center entre las fuentes de **AWS Knowledge MCP**. Es conocimiento AWS general, no un conector exclusivo de noticias/promociones ni una garantía de cobertura completa. Su [documentación](https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server) publica `https://knowledge-mcp.global.api.aws`, compatible con Streamable HTTP y sin autenticación, sujeto a límites. Radar lo llama bajo demanda para buscar oportunidades oficiales relacionadas con créditos.

## Configuración

| Variable opcional | Valor predeterminado |
| --- | --- |
| `PORT` | `4949` |
| `DASHBOARD_DATA_DIR` | `~/.claude-dashboard` |
| `DASHBOARD_PROJECTS_DIR` | `~/dev/GitHub` |
| `DASHBOARD_WORK_DIR` | `~/dev/GITHUB-NEO` |
| `DASHBOARD_VAULT_DIR` | `~/Documents/obsidian-vault` |
| `CODEX_HOME` | `~/.codex` |
| `GROK_HOME` | `~/.grok` |
| `AGY_HOME` | `~/.gemini/antigravity-cli` |
| `DASHBOARD_INTERVIEW_BACKGROUND` | Contexto genérico para practicar entrevistas cloud |
| `DASHBOARD_ENABLE_AI` | Desactivado. Usa `1` para habilitar generadores |
| `DASHBOARD_ENABLE_GIT_WRITE` | Desactivado. Usa `1` para habilitar commit/push |

Ejemplo en macOS/Linux:

```sh
DASHBOARD_PROJECTS_DIR=/ruta/a/proyectos PORT=4950 npm start
```

Los generadores usan CLIs autenticados en tu equipo. Activarlos permite enviar contexto de repositorios, notas privadas y del vault a proveedores de IA. Una suscripción no garantiza costo cero. El análisis usa Grok y puede recurrir a Claude si falla; la entrevista usa AGY y puede recurrir a Claude. Estas funciones son opcionales y no fueron ejecutadas durante la verificación, para evitar consumo de cuentas y modificaciones de otros proyectos.

## Privacidad y seguridad

La interfaz utiliza recursos locales, incluyendo una copia fija de Chart.js. Historial y replay pueden contener información sensible de tus conversaciones. No compartas capturas ni respuestas de la API sin revisarlas.

El servidor valida Host y origen, exige un encabezado especial para acciones POST, limita el JSON recibido y comprueba que las rutas de proyecto permanezcan dentro de sus carpetas. El borrado permanente de repositorios está desactivado. Los documentos se muestran como texto, sin ejecutar HTML o JavaScript.

Las extensiones, otros programas o usuarios con acceso a tu sesión local quedan fuera de esta protección. No expongas el puerto mediante túneles o proxies públicos.

## Desarrollo

```sh
npm test
node --check server.js
node --check public/app.js
```

Las pruebas cubren normalización de tokens, duplicados, persistencia de conexiones, archivos parciales, validación de solicitudes/rutas y Radar: opt-in, RSS/Atom, XML Get on Board, protocolo MCP simulado, límites de red, URLs/redirecciones, caché, marcas, caducidad y fallos. La CI está configurada para Node 22 y 24 en Linux y macOS, sin credenciales ni conexión a proveedores de IA. No se ha ejecutado en GitHub en esta sesión.

Consulta [la auditoría técnica y de diseño](docs/audit-2026-09-29.md), [la revisión de precios](docs/pricing-and-agents-2026-09-29.md) y [la auditoría de empleos, créditos y UX](docs/radar-creditos-cv-y-ux-2026-09-29.md). El proyecto conserva `private: true` para evitar publicar accidentalmente un paquete npm.

Para agregar fuentes de forma segura, consulta [CONTRIBUTING.md](CONTRIBUTING.md). La licencia del código original y la revisión de historial/archivos sensibles siguen siendo requisitos antes de abrir el repositorio; esta ampliación no implica publicación ni cambio de visibilidad.

La integración de Codex se contrastó con la [documentación oficial de comandos](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [funciones de la app](https://learn.chatgpt.com/docs/features) y registros locales reales. No utiliza una API interna de autenticación o facturación.

Fuentes de precios y alcance: [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [tarifas API OpenAI](https://developers.openai.com/api/docs/pricing), [planes y cuotas de Codex](https://learn.chatgpt.com/docs/pricing) y [ticks xAI](https://docs.x.ai/developers/cost-tracking).
## Mi trabajo: kanban multiagente

La activación local de generadores puede persistirse en `ai-settings.json` dentro del directorio de datos, con `{"enabled":true}`. `DASHBOARD_ENABLE_AI=1` o `0` tiene prioridad sobre esta preferencia. El repositorio público conserva generación desactivada por defecto; no contiene tu preferencia privada.

La pestaña **Mi trabajo** organiza proyectos personales en Por hacer, En curso, En revisión y Listo. Crea tareas con responsable David/Claude/Codex/Grok/Antigravity, prioridad, objetivo, criterios de aceptación y contexto de entrega. Arrastra para mover o usa el selector de estado con teclado/touch. Archivar es recuperable. Exportar descarga una copia JSON.

El tablero se guarda en `$DASHBOARD_DATA_DIR/kanban.json` (por defecto `~/.claude-dashboard/kanban.json`), con escritura atómica y permisos 0600. Las versiones por tarea evitan que dos agentes o pestañas sobrescriban cambios simultáneos. Se refresca cada 15 segundos cuando la pestaña está visible y no estás editando.

**Planificador IA:** al pulsar «Proponer plan con Claude», el servidor usa tu Claude CLI autenticado para enviar únicamente el objetivo, nombre del proyecto y títulos/estados de hasta 30 tareas de ese proyecto. Usa el modelo predeterminado configurado en Claude. Herramientas, MCP y personalizaciones desactivadas; sin persistencia de sesión; tiempo máximo 90 s y presupuesto API máximo USD 1 por llamada (no representa tu factura de suscripción). Las propuestas no se guardan hasta que las añades al tablero. Este botón autoriza únicamente esta generación; los generadores heredados siguen usando su configuración existente `DASHBOARD_ENABLE_AI`.

La asignación no ejecuta un agente automáticamente. «Copiar entrega» prepara el contexto para tu sesión de cualquiera de las IAs. Los agentes con terminal pueden leer y actualizar el mismo tablero por HTTP local:

```sh
curl http://127.0.0.1:4949/api/kanban
curl 'http://127.0.0.1:4949/api/kanban/brief?id=ID_DE_TAREA'
curl http://127.0.0.1:4949/api/kanban \
  -H 'Content-Type: application/json' -H 'X-Dashboard-Request: 1' \
  --data '{"action":"update","id":"ID_DE_TAREA","version":1,"task":{"status":"review","handoff":"Archivos cambiados y evidencia de pruebas"}}'
```

POST `/api/kanban`: `create` + `task`; `update` + `id`,`version`,`task` parcial; `archive`/`restore` + `id`,`version`. Los proyectos creados o reasignados deben existir dentro de la carpeta personal configurada. HTTP 409 significa que debes leer la versión actual y conservar el avance del otro agente antes de reintentar. No cambies `kanban.json` directamente mientras el servidor corre.

Los logos originales se sirven desde `public/logos/`, con procedencia en THIRD_PARTY_NOTICES.md. El movimiento del fondo se pausa con el botón superior, al ocultar la pestaña y mediante `prefers-reduced-motion`; los movimientos del kanban y modales duran 120–200 ms.
