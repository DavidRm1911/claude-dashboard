# Claude Dashboard — identidad de marca

## Concepto

**用** (yō, "uso") — el mark es el mismo carácter que ya aparece en el subtítulo del hero
(利用状況, "estado de uso"). No es decoración japonesa genérica: es el concepto central
del producto — medir tu *uso* de Claude Code — reducido a un solo glyph, en un bloque
sólido invertido (tinta llena, texto en `--bg`), sin clonar el mark de ninguna referencia
externa.

## Personalidad (voice)

| Rasgo | Significado | Sí | No |
|---|---|---|---|
| **Directo, no decorativo** | Todo número se puede defender; sin métricas de vanidad | "23.829 tokens · $3,40" | "🚀 ¡Progreso increíble este mes!" |
| **Honesto sobre la estimación** | Nunca esconde qué es medido vs. estimado | "Estimación basada en la tabla de precios de Anthropic" | Mostrar un costo sin decir que es estimado |
| **Denso, no ruidoso** | Prioriza información por cm², nunca sacrifica el piso de 12px / contraste AA | Tablas para comparar, tarjetas para un dato | Grillas de tarjetas para 59 filas de texto |
| **Con carácter, no genérico** | Playfair Display + JetBrains Mono + acento 用, nunca Inter+azul-de-SaaS por defecto | El hero actual | Un dashboard de analytics genérico |

**Prueba de voz:** si una frase suena a que la podría decir cualquier dashboard de SaaS
("¡Aumenta tu productividad!"), no es la voz de este proyecto. Si suena a que un ingeniero
se la diría a otro ingeniero sin adornos, sí lo es.

## Identidad visual

- **Color:** azul eléctrico `#2323D6` como único acento — reservado para lo accionable y
  lo que hay que mirar primero. Fondo casi blanco `#F7F7FB`, tinta casi negra `#0B0B14`.
  Verificado contra WCAG 2.2 (ver comentario en `server.js` junto a `ACCOUNT_COLORS`) — no
  se agregan colores nuevos sin volver a verificar contraste par a par.
- **Tipografía:** Playfair Display solo en H1/H2 (nunca bajo 32px — sus trazos finos se
  agrisan). JetBrains Mono para todo dato/cifra/label. Plus Jakarta Sans para prosa.
- **Textura:** grano SVG sutil (`feTurbulence`, opacidad 0.035) en el fondo — la única
  "imagen" que existe en la página. Sin fotografía, sin ilustración: este es un dashboard
  de datos, no un sitio de agencia — la ilustración competiría con la información real.
- **Bordes:** duros, sin radio (o radio de 2px como máximo) — el sistema se muestra, no se
  esconde detrás de sombras.
- **Acento japonés:** solo donde es semánticamente honesto (ej. 利用状況 = "estado de uso"
  junto al título que dice exactamente eso). Nunca decorativo sin traducción real detrás.

## Qué no hacer

- No agregar un segundo color de acento "porque sí" — cualquier color nuevo compite con el
  azul por atención y hay que volver a verificar separación de luminancia en toda la
  paleta de series (ver `server.js`, comentario sobre el bug de contraste 1.0 ya corregido).
- No usar el mark 用 fuera del bloque tinta-sólida — pierde el motivo de "bloque invertido"
  que lo conecta visualmente con `.stat-card--cost` y otros bloques de énfasis.
- No agregar copy en tono de marketing ("¡increíble!", "revoluciona tu flujo") — rompe la
  voz directa que el resto del dashboard ya tiene.
