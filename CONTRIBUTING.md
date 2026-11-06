# Contribuir al espacio local de desarrolladores

Estado: preparación para un repositorio público. No hay publicación automática, y `private: true` evita publicar un paquete npm por accidente. El nombre y la licencia del código original deben confirmarse antes de distribuirlo.

## Ejecutar y verificar

Node.js 22+, `npm start` y `npm test`. Sin dependencias de servidor ni compilación. Las pruebas usan fixtures sintéticos y no consultan feeds ni cuentas. No incluyas historial de agentes, rutas personales, proyectos privados, credenciales, cachés o capturas con datos reales en un PR.

## Agregar una fuente al Radar

1. Verifica un RSS/Atom público o API explícitamente publicada por su operador, sus condiciones de uso, atribución y frecuencia. No utilices cookies, cuentas, perfiles, muros de pago, endpoints internos ni protecciones evadidas.
2. Agrega la fuente a `RADAR_SOURCES` en `lib/radar.js`, con ID estable, nombre, origen, sección, endpoint HTTPS fijo, intervalo y lista exacta de hosts. Mantén el catálogo revisado en código, no una descarga hacia URLs suministradas por usuarios.
3. Agrega sus hosts de enlaces a `allowedHosts` en `public/radar.js`. No permitas subdominios genéricos, IP locales, HTTP, credenciales embebidas ni puertos arbitrarios.
4. Para RSS/Atom comprueba el parser con un fixture pequeño. Para JSON crea un adaptador específico que solo conserve metadatos permitidos. No almacenes artículos completos ni HTML ejecutable.
5. Añade pruebas de URLs inválidas, redirecciones, respuesta vacía, campos ausentes, fechas, duplicados y errores. Respeta el límite de descarga de 4 MiB y el timeout. Un fallo debe conservar la copia y no reintentar sin pausa.
6. Documenta alcance, atribución y limitaciones en README.md. Presenta evidencia de pruebas y revisión visual en claro/oscuro, teclado y móvil.

La etiqueta "oficial" representa la fuente publicadora, no que un patrón sea apropiado para todos los proyectos. No inventes autores, experiencia, salarios, restricciones regionales, fechas o vigencia.

## Actualizar beneficios editoriales

`RADAR_RESOURCES` contiene enlaces seleccionados con `verifiedAt`, condiciones y `expiresAt` si la fuente publica un cierre. Incluye evidencia primaria. Un regalo con código, región, suscripción o selección no es universal. Sin fecha de cierre significa desconocida, no vigente para siempre. La interfaz pide revisar recursos cuya comprobación tiene más de 30 días.

## Seguridad y privacidad

Conserva loopback, validación de Host/Origin, protección de POST y CSP local. No habilites IA, escritura Git, telemetría o envío de contexto por defecto. Guarda preferencias, feeds y marcas únicamente en `DASHBOARD_DATA_DIR`. Las dependencias externas, si realmente se necesitan, deben justificar el costo de mantenimiento y llevar atribución/licencia.

## Alcance de un PR

Un cambio pequeño y verificable por PR, sin reformatear archivos ajenos. Describe qué cambió, cómo lo verificaste y qué no cubre. La revisión del historial y los archivos ya versionados, licencia, accesibilidad pendiente y nombre público siguen siendo gates de publicación; no se resuelven haciendo push de una nueva interfaz.
