# Guía de uso

## Primera instalación

1. Instala Node.js 22+ y Git.
2. Clona el repo y ejecuta `npm start` como indica el README.
3. Abre http://127.0.0.1:4949 en el mismo equipo.

No necesitas API keys ni CLIs para crear tareas. Si no hay registros locales, las métricas estarán vacías. Usa `npm run demo` en el puerto 4950 para conocer la interfaz con datos sintéticos.

## Conectar y comprobar registros

Claude se detecta automáticamente en las carpetas convencionales. En Tus agentes puedes agregar o quitar Codex/Grok/AGY. **Disponible** significa que se detectó la carpeta; **Conectado** significa que autorizaste leerla; **Sin registros** significa que no se encontraron sesiones utilizables.

Si una fuente no aparece:

- Usa esa herramienta al menos una vez para que genere registros locales.
- Comprueba las rutas documentadas en el README.
- Selecciona el rango **Todo** para descartar que la sesión sea antigua.
- Si el formato cambió, abre un issue con versión de CLI y un fixture sintético; evita subir tu conversación.

`CODEX_HOME`, `GROK_HOME` y `AGY_HOME` permiten ajustar raíces de los proveedores. No debes copiar claves de autenticación al dashboard. Las cuotas y costos solo se muestran si existen en los registros. Instalar un CLI, iniciar sesión y ejecutar tareas sigue siendo responsabilidad de cada herramienta.

## Tu primer proyecto y tarea

El kanban lista carpetas de `~/dev/GitHub`, o de `DASHBOARD_PROJECTS_DIR`. Si no hay proyectos, crea o clona uno en esa carpeta, o configura una ruta absoluta en `.env.local`. No exige que cada repo tenga CLAUDE.md para crear tareas, aunque ese documento mejora el contexto del agente.

Abre Mi trabajo → Nueva tarea. Selecciona proyecto y responsable, escribe un resultado concreto y describe cómo comprobarlo. Ejemplo:

> Título: verificar formulario de contacto. Responsable: Codex. Criterios: envío válido, entrada inválida y recorrido por teclado comprobados.

Arrastra entre columnas o cambia el selector de estado. En móvil usa el selector. Filtra por proyecto/responsable y busca por título o contexto. **Archivar** oculta una tarea; **Ver archivadas → Restaurar** la recupera. **Exportar** descarga todo el tablero como JSON para guardar una copia; no hay importador automático en esta versión.

## Retomar con otra IA

En una tarea pulsa Copiar entrega. Pega ese texto en Claude/Codex/Grok/AGY dentro del proyecto correspondiente. Antes de empezar, el agente debe leer las instrucciones del repo y el contexto anterior. Al terminar deja archivos cambiados, pruebas y bloqueos en Contexto para la siguiente IA. [Ejemplos de API](AGENT-WORKFLOW.md).

Si aparece un conflicto, otra pestaña o agente cambió la tarea. Cierra el editor conservando tu texto aparte, actualiza el tablero y combina el avance antes de guardar. El servidor evita sobrescribir la versión nueva silenciosamente.

## Planificador y generadores

El Planificador de Mi trabajo requiere Claude CLI instalado y autenticado. Elige proyecto, escribe objetivo y pulsa Proponer plan con Claude. El servidor devuelve propuestas de tareas; pulsa Añadir al tablero solo para las que quieras trabajar. No inicia agentes ni lee todo el repositorio. La generación tiene timeout de 90 s y límite API de USD 1; ese límite no describe la facturación de una suscripción.

Ideas/análisis/entrevista requieren `DASHBOARD_ENABLE_AI=1`. Copia `.env.example` a `.env.local`, cambia el valor y usa `npm run start:config`. Pueden enviar contexto de repositorios/notas a la IA y consumir cuota. Detén con Ctrl+C antes de volver a arrancar. No se habilitan automáticamente al agregar una fuente de uso.

## Radar y empleo

Radar → Activar Radar inicia las consultas públicas predefinidas. Los feeds AWS tienen intervalo mínimo de una hora; los empleos, seis horas. Una actualización fallida conserva la copia anterior y muestra su estado. Builder Center es contenido de comunidad; no todos sus autores están verificados por la app.

En Créditos AWS encontrarás fuentes, condiciones y fecha de revisión. La búsqueda MCP consulta documentación AWS y muestra descubrimientos por revisar, no promociones garantizadas.

En Empleo, filtra Perú, LATAM/global o todos los países. Una vacante remota puede limitar los países desde donde admite postulantes. Revisa la oferta original antes de enviar documentos.

Pega CV o importa TXT/MD/PDF. El texto se guarda solo en ese navegador; otro navegador o puerto tiene almacenamiento distinto. Borrar el CV lo elimina de la app. TXT/MD hasta 2 MiB y texto hasta 20.000 caracteres. PDF usa `pdftotext` local; documentos escaneados sin texto requieren OCR fuera de la app o pegar el contenido. Si falta `pdftotext`, el tablero y los demás formatos siguen funcionando.

El orden de compatibilidad compara tecnologías mencionadas en el CV con título/resumen de la vacante. Muestra términos coincidentes y ausentes; no evalúa toda la oferta, experiencia real, idioma ni probabilidad de contratación.

## Errores habituales

| Mensaje | Qué hacer |
| --- | --- |
| Generadores desactivados | Usa `DASHBOARD_ENABLE_AI=1` en `.env.local` y arranca con `npm run start:config` |
| Puerto en uso / EADDRINUSE | Cierra la otra instancia o cambia PORT en la configuración |
| Sin proyectos | Ajusta DASHBOARD_PROJECTS_DIR a una carpeta con repos, no a un único repo |
| Claude CLI no disponible | Instala/autentica Claude y comprueba que `claude --version` funcione en terminal |
| Plan inválido / cuota / timeout | Reintenta con un objetivo breve o crea tareas manualmente; ninguna propuesta fallida se guarda |
| Otra IA actualizó esta tarea | Relee la versión actual y combina contexto; no reintentes con la versión vieja |
| Solicitud rechazada | Abre 127.0.0.1/localhost con el puerto correcto y conserva X-Dashboard-Request para POST desde agentes |
| PDF sin texto | Pega el texto o procesa OCR por separado |

## Respaldo y desinstalación

Los datos privados están en `~/.claude-dashboard` o DASHBOARD_DATA_DIR. Con el servidor detenido, copia ese directorio para respaldarlo. El CV debe respaldarse desde su texto en el navegador. Borrar el repo no elimina el historial de tus CLIs ni los datos privados del dashboard. No borres carpetas de agentes para desinstalar esta herramienta.
