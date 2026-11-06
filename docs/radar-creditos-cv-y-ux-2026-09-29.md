# Radar, empleo, créditos AWS y auditoría UX

**Fecha:** 2026-09-29  
**Producto:** Workbench / dashboard local para desarrolladores

## Hallazgos de UX y cambios

- Las skills, ideas y proyectos usaban tarjetas repetidas con metadatos en distintas posiciones. Se aplanaron como filas de lectura rápida, con adaptación a móvil.
- Los agentes aparecían como iniciales monocromas. La lista ahora distingue Claude, Codex, Grok y AGY con símbolos vectoriales locales y color propio, sin solicitar logos remotos.
- Se incorporó un fondo de contornos técnicos en movimiento suave, con soporte para `prefers-reduced-motion`.
- Se generaron tres mockups visibles en la conversación como dirección de diseño: resumen multi-IA, biblioteca organizada y búsqueda de empleo con perfil local. Las referencias usan superficies marfil, tipografía oscura, acento terracota, filas planas y movimiento de líneas topográficas.

## Créditos y formación AWS

- AWS Free Tier: USD 100 iniciales para clientes AWS nuevos y hasta USD 100 adicionales, según actividades elegibles. AWS describe cinco actividades (EC2, RDS, Lambda, Bedrock y Budgets) que otorgan USD 20 cada una.
- Condiciones destacadas: elegibilidad de cliente nuevo; créditos con vencimiento; plan Free con duración limitada. AWS advierte que el uso que supere créditos en un plan Paid genera cobros. La tarjeta y los servicios no cubiertos por créditos requieren revisar sus condiciones.
- AWS Activate Founders: USD 1,000 iniciales y hasta USD 5,000 para startups elegibles; solicitud y aprobación de AWS, web funcional y otros criterios. Activate Portfolio es para startups vinculadas a un proveedor y puede llegar a USD 200,000. No se presenta como un beneficio universal.
- Integración AWS Knowledge MCP: servidor remoto oficial sin autenticación, sujeto a límites. Se inicializa MCP 2025-03-26 y se invoca `aws___search_documentation` con consulta fija no personal. Resultados se limitan a `aws.amazon.com` y `docs.aws.amazon.com`; el usuario confirma elegibilidad y vigencia en la fuente. Cache local de 12 horas.

Fuentes comprobadas el 2026-09-29:

- https://aws.amazon.com/free/free-tier-faqs/
- https://aws.amazon.com/free/
- https://aws.amazon.com/startups/credits
- https://aws.amazon.com/aws-startups/learn/applying-for-aws-activate-credits-a-step-by-step-guide/
- https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server

## Trabajo remoto y Perú

- Remotive conserva su API pública y su aviso de retraso de 24 horas.
- Se añadió el feed XML público de Get on Board a las fuentes importadas. El servidor lo publica como `text/html`, pero el cuerpo es XML propio (`<source><job>`). El parser exige raíz/vacante y URL del dominio, extrae resumen y país desde `<country>` y conserva el origen. País ambiguo queda como “revisar país”.
- La bolsa ofrece páginas de búsqueda para Lima/Perú y remoto. Las páginas directas son solo alternativas de búsqueda y no se anuncian como vacantes importadas.
- El filtro inicial muestra Perú y vacantes que declaran LATAM/global. “Remoto” por sí solo no significa global.

Fuente: https://www.getonbrd.com/jobs/feed — página de empleos y formato público de vacantes consultados el 2026-09-29.

## CV y compatibilidad

- Se puede importar TXT/MD o extraer PDF localmente con `pdftotext` (si está instalado). El CV se guarda en `localStorage` del navegador y se puede borrar desde la UI.
- El extracto PDF solo pasa por el dashboard local; no se manda a proveedores de empleo, MCP ni modelos. No se envía el contenido del CV a ninguna fuente.
- La compatibilidad usa un conjunto pequeño y transparente de términos técnicos presentes en el CV y en una vista previa de la descripción. Ordena por afinidad alta/parcial/evidencia insuficiente y excluye del primer filtro anuncios que no confirman acceso desde Perú o remoto regional.
- Esto no estima probabilidad de contratación: no evalúa seniority, idioma, salario ni requisitos fuera del resumen descargado.

## Verificación

- `node --test test/*.test.js`: 46/46 pruebas pasan, incluidos parsing del XML de Get on Board, protocolo AWS Knowledge MCP simulado, salvaguardas de URL y flujos Radar existentes.
- Se verificó en vivo AWS Knowledge MCP: negoció MCP `2025-03-26`, ofreció el buscador oficial y devolvió la página de AWS Free Tier con créditos de hasta USD 200.
- Limitaciones operativas: el feed de Get on Board puede cambiar su XML; su parser descarta vacantes si la fuente no expone un enlace estable. Ninguna postulación se envía automáticamente.
