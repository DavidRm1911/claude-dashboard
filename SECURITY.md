# Seguridad

Espacio local está diseñado para ejecutarse en un equipo personal, escuchando en 127.0.0.1. No expongas el servidor mediante túneles o proxies públicos: historial y replay pueden contener datos privados.

Para reportar una vulnerabilidad, usa la pestaña **Security → Report a vulnerability** del repositorio cuando esté disponible. No publiques credenciales, CVs ni logs privados en un issue. Si no hay canal privado disponible, abre un issue solicitándolo sin incluir detalles explotables ni datos sensibles.

La validación de Host/Origin y las protecciones POST reducen ataques desde páginas web; no protegen frente a programas, extensiones o usuarios con acceso a tu sesión del sistema. Los generadores activados envían contexto a sus proveedores. Revisa qué función ejecutas y utiliza una cuenta adecuada.
