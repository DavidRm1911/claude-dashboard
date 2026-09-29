# Contribuir

Gracias por mejorar Espacio local. Los cambios de código se distribuyen bajo MIT; las marcas y recursos de terceros conservan sus propias condiciones.

## Desarrollo

Node.js 22+, `npm start`, `npm run demo` y `npm test`. No hay dependencias de servidor ni compilación. Usa datos sintéticos para reproducir fallos y capturas; nunca adjuntes logs reales, CVs, credenciales o rutas privadas.

Describe el problema, el cambio observado y la verificación. Mantén cada PR enfocado. Para UI comprueba teclado, móvil, oscuro y movimiento reducido; para parsers añade fixtures pequeños sin contenido personal. No afirme soporte de una plataforma que no se haya probado.

## Nuevos proveedores

Distingue sesiones, actividad, tokens medidos y costos registrados. Los contadores acumulados requieren deduplicación. Datos ausentes quedan N/D; las cuotas son snapshots fechados, no verificación de la cuenta actual. Documenta versiones del formato y limita campos persistidos.

## Fuentes del Radar

Usa RSS/Atom, APIs públicas o endpoints oficialmente documentados. Mantén hosts HTTPS exactos, atribución, fecha y frecuencia; no aceptes URLs arbitrarias de descarga. Respeta cooldowns y conserva la última copia ante fallos. No recopiles perfiles, contenido tras login ni artículos completos.

Incluye pruebas de URLs/redirecciones, campos ausentes, fechas, duplicados y límites. Para beneficios editoriales añade fuente oficial, fecha de revisión y condiciones; desconocer una fecha de cierre no significa vigencia indefinida.

## Seguridad

Conserva loopback, validación Host/Origin, encabezado de POST y CSP local. La instalación pública mantiene generadores y Git push desactivados por defecto. No habilites telemetría ni incluyas datos de tu equipo en el repositorio. Consulta SECURITY.md para reportes privados.
