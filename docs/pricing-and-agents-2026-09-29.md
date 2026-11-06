# Corrección de precios y paneles multiagente

## Resultado y semántica

Versión local 1.2.0. La cifra anterior de USD 21,34 solo calculaba Haiku y cobraba toda creación de caché como 5m. Se externalizaron tarifas actuales con fuente/fecha en `lib/pricing.js`, incluyendo Sonnet 5/5.5 y Opus 5/5.5. La deduplicación conserva creación de caché 5m/1h y admite reclasificación tardía sin añadir tokens dos veces. Modelos desconocidos y duraciones ausentes se muestran como N/D, subtotal parcial o intervalo, no como costo cero.

En el snapshot de QA, el histórico produjo **USD 2.882,31 de equivalente API** y **100% de cobertura de tarifas**, con 129.146.473 tokens de creación de caché 1h. El número cambia mientras los agentes siguen activos. No es factura, deuda, gasto del plan ni reconstrucción fiscal de precios históricos. Se aplican tarifas estándar actuales; no descuentos privados, impuestos, otros recargos/modalidades o cargos de servicios adicionales.

## Interfaz

Impeccable guio la ampliación dentro de la interfaz compacta existente: pestaña **Otras IAs**, selección Codex/Grok/AGY, métricas planas, barras diarias con valores de texto y detalles progresivos para proyectos/sesiones. Se conserva identidad, fuentes nativas y recursos locales. Claude incluye tabla por modelo con input/output, creación de caché 5m/1h, duración desconocida, lectura y referencia USD.

| Fuente | Ampliación | Límite explícito |
| --- | --- | --- |
| Codex | Incrementos por modelo del turno, proyectos, días, sesiones, referencia API base y último snapshot de cuotas | No factura del plan. Modelo interno auto-review sin tarifa queda N/D; no se inventa cuenta ni cuota actual |
| Grok | Uso por modelo/turno, día y proyecto; costos registrados en ticks con cobertura | Turnos y total de sesión no se suman juntos; falta de costo no equivale a cero; no factura del plan |
| AGY CLI | Actividad diaria, mensajes, herramientas y sesiones | No inventar tokens, precio, cuotas, modelo o proyecto. Antigravity IDE no integrado |

Los nuevos proveedores filtran incrementos y actividad por timestamp exacto, no por día calendario completo. Los gráficos usan UTC. Las sesiones recientes conservan valores de toda su duración y lo explican. El filtro de cuenta afecta solo a Claude. Las cuotas Codex se obtienen del último snapshot local, independiente del rango, con fecha/plan/sesión/reset. No se identifican ni mezclan cuentas; el estado puede estar desactualizado. Para cuotas actuales usar `/status` o el panel oficial.

Codex presenta **base API estándar** para modelos verificados, sin recargos de contexto largo/Fast/región ni escritura de caché sin desglose en la telemetría. No confundir con las reglas de créditos de una suscripción.

Grok usa 1 USD = 10¹⁰ ticks. Snapshot verificado: USD 0,562318 registrados en 1 de 12 sesiones; 3/12 tienen archivos de telemetría, dos de ellos con contadores cero. Esta cobertura no permite afirmar gasto cero en el resto. AGY: 46 sesiones, 540 mensajes y 378 herramientas observadas; tokens/costos N/D.

## Verificación

- **33 pruebas Node aprobadas**, 11 nuevas sobre precios, TTL mixtos/repetidos/tardíos, modelos futuros desconocidos, cambios de modelo Codex, timestamps exactos, ticks sin doble suma, actividad AGY y selección/normalización de cuotas.
- Sintaxis del servidor e interfaz comprobada.
- Chrome real: referencia de cada modelo verificada por fórmula independiente; cobertura 100%, caché TTL desconocido cero en los datos inspeccionados; costo Haiku USD 30,6805709, no USD 21,3435839.
- Codex: modelos adicionales visibles y snapshot de cuotas presente; Grok: costo USD 0,562318 sin sumar el total de sesión otra vez; AGY: actividad fechada, tokens/costo nulos.
- Los totales por modelo/proyecto concuerdan con las agregaciones del proveedor. Los eventos internos no se entregan en la API.
- Navegación de tabs con flechas; datos con HTML malicioso mostrados como texto. Cero errores JavaScript y cero solicitudes externas durante el recorrido.
- Recorrido a 1440, 1280, 768, 390 y 320 px, temas claro/oscuro y movimiento reducido. Tablas tienen scroll interno; no desbordamiento del documento.
- Capturas de QA inspeccionadas y mantenidas fuera del repo por contener datos reales. CI remota, lectores de pantalla y todas las funciones legacy no verificados aquí.

## Pendientes que no quedan resueltos por esta corrección

No hubo publicación, commit/push, cambios de autenticación, consumo de APIs pagadas ni generación de IA. Se mantienen gates de licencia/privacidad del historial, accesibilidad legacy y rendimiento de históricos grandes. Claude aún filtra días calendario en varios gráficos heredados, no todos timestamps exactos. Los formatos de las CLIs son internos y pueden cambiar. Los modelos nuevos requieren verificar y versionar tarifas, no inventarlas.

Se comprobó que no existen las rutas locales convencionales inspeccionadas de Antigravity IDE (`~/.gemini/antigravity` y su `state.vscdb` de Application Support). No demuestra que nunca se use el IDE ni autoriza afirmar cobertura de otra ubicación.

## Fuentes primarias

- [Anthropic: tarifas y TTL de caché](https://platform.claude.com/docs/en/about-claude/pricing).
- [OpenAI: planes y límites](https://learn.chatgpt.com/docs/pricing), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
- [xAI: definición de ticks](https://docs.x.ai/developers/cost-tracking).
