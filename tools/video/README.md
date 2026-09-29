# Regrabar el video

Herramientas opcionales; no se necesitan para ejecutar el dashboard.

1. Instala FFmpeg y Node.js 22+.
2. Desde la raíz ejecuta `npm install --prefix tools/video`.
3. Instala Chrome o ejecuta `cd tools/video && npx playwright install chromium`.
4. Desde la raíz ejecuta `npm run record --prefix tools/video`.

El script crea un HOME temporal con datos sintéticos, arranca un servidor en el puerto 4958, graba acciones reales en el navegador y exporta docs/media/uso.mp4 con rótulos en español. También genera la captura del kanban y un GIF corto. No utiliza historial personal ni proveedores de IA. El video no tiene narración; los pasos se presentan en texto.

Por defecto utiliza Chromium de Playwright; `VIDEO_BROWSER_CHANNEL=chrome` selecciona Chrome instalado. `PLAYWRIGHT_MODULE` permite señalar una ruta de módulo existente para entornos de desarrollo. El proceso necesita permiso para arrancar servidor local y navegador.
