# Logiticket MVP: organización de eventos

Aplicación inicial con PostgreSQL para separar el panel de propietario de plataforma del acceso de organizadores. Incluye sesiones de servidor, contraseñas con hash, permisos por rol, eventos en borrador y revisión, promociones, sorteos en borrador, consulta de pedidos y liquidaciones.

La portada pública `/` muestra un catálogo visual inicial importado del CSV scrapeado (24 fichas resumidas). La ficha de Sebas de la Calle en Logroño, 12/12/2026, incorpora los datos comprobados en su página y el selector de entradas Anticipada/VIP con gastos de gestión. El paso de compra es solo una maqueta: no crea pedidos ni cobra. El acceso de cuentas permanece en `/login` y el panel en `/app`.

## Arranque local con Docker Compose

Requisitos: Docker Compose. Copia la configuración y sustituye ambos secretos por valores aleatorios largos:

```sh
cp .env.example .env
openssl rand -hex 32
```

Pega un valor en `SESSION_SECRET` y otro en `POSTGRES_PASSWORD`. Compose conecta automáticamente la app con la base local usando esos valores; no hace falta editar `DATABASE_URL`:

```sh
docker compose --env-file .env -f compose.yaml -f compose.local.yaml up -d --build
docker compose exec app npm run migrate
docker compose exec app npm run create-user -- propietario@ejemplo.es "Propietario Logiticket" platform_admin
```

El último comando pide la contraseña sin mostrarla y la guarda como hash. Abre `http://localhost:3001` e inicia sesión. El puerto PostgreSQL solo escucha en loopback (`localhost`) durante el desarrollo.

También puedes ejecutar el proceso Node directamente en el host con Node.js 24 LTS y una instancia PostgreSQL disponible; configura `DATABASE_URL` para esa instancia y sigue los comandos `npm install`, `npm run migrate`, `npm run create-user` y `npm start`.

## Despliegue en Hetzner con Coolify

Para desplegar en Coolify, consulta [COOLIFY.md](COOLIFY.md). El código está publicado en `zeniaGit/Logiticket`, rama `main`. Coolify termina HTTPS y enruta el dominio al puerto interno 3001; no hace falta publicar la base de datos ni ejecutar otro proxy en el stack. La aplicación aún no está desplegada en el VPS.

Para dar acceso a un organizador:

1. Crea una cuenta base desde el servidor: `docker compose exec app npm run create-user -- usuario@promotora.es "Nombre de usuario" user`.
2. Entra como propietario, abre **Organizadores**, crea la organización y asígnale esa cuenta con el rol adecuado.
3. El usuario inicia sesión y crea un evento en borrador; lo envía a revisión; el propietario lo aprueba o solicita cambios.

## Qué funciona ya en esta base

Los carteles JPG, PNG, WebP y AVIF de hasta 10 MB se convierten en el servidor a miniatura WebP de 480 × 360 y cartel de detalle WebP de 1200 × 1600. El lienzo conserva toda la imagen y toma el color predominante de sus bordes para completar márgenes sin bandas negras. En Coolify se persisten bajo `/data/uploads` mediante el volumen `logiticket_uploads`.


- Persistencia PostgreSQL de cuentas, organizaciones, miembros, eventos, tipos de entrada, promociones, sorteos, pedidos, intentos de pago, entradas, libro mayor, liquidaciones y auditoría.
- Acceso con sesión almacenada en PostgreSQL, protección CSRF para cambios, límites iniciales de intentos de inicio de sesión y validación de permisos en servidor.
- Alta de organizadores desde la vista de propietario, asignación de cuentas y roles.
- Creación de eventos y primera categoría de entrada, subida del cartel con dos variantes WebP, comisión fija o porcentual, envío a revisión y publicación por propietario.
- Alta de códigos de descuento y sorteos como borradores.
- Vistas de ventas, pedidos y liquidaciones basadas en datos persistidos.
- Portada pública con búsqueda y filtros de ubicación; selector de cantidades y resumen de precio para la ficha de Logroño verificada.
- Migración 002 para recinto y dirección, apertura de puertas, condiciones de acceso, cartel, URL de origen y gasto de gestión por tipo de entrada.

## Pendiente antes de producción

- Redsys no está conectado todavía: hacen falta TPV de pruebas y producción, contrato del adquirente, configuración de Visa/Mastercard y Bizum, y aprobación expresa del flujo para operar como intermediario/plataforma. No se deben aceptar pagos reales con esta versión.
- Falta integrar correo de invitaciones y recuperación de cuenta. La creación de cuentas ahora es una operación administrativa local.
- La tabla de ventas está preparada, pero todavía no se crean pedidos desde checkout ni se emiten entradas. La emisión debe ocurrir tras verificar una notificación Redsys firmada e idempotente.
- El libro mayor y las liquidaciones son esquema y vistas iniciales; faltan conciliación, devoluciones, contracargos, aprobación de payout y conexión bancaria.
- Los sorteos requieren definir condiciones, selección y registro del ganador; la UI solo crea el borrador.
- Falta completar gestión de sesiones múltiples, edición completa de eventos, app de check-in y conexión dinámica de eventos de PostgreSQL con el catálogo público.
- Configurar HTTPS, secretos de producción en un gestor seguro, copias de seguridad y restauración, logs/alertas, revisión de seguridad, almacenamiento de sesiones escalable y controles de despliegue. El rate limiter de inicio de sesión está en memoria y debe usar un almacén compartido al escalar a varias instancias.
- La base actual crea el esquema inicial de forma idempotente. Antes de producción se debe adoptar una herramienta de migraciones con versiones inmutables y política de rollback.

## Diseño de pagos previsto

El precio lo configura el organizador y cada evento conserva la comisión pactada (importe por entrada o porcentaje). Al confirmar el pago, el sistema registrará venta bruta, comisión, devoluciones/ajustes y saldo del organizador en movimientos inmutables. El checkout no confiará en la URL de retorno del navegador: solo una notificación firmada y validada en servidor podrá confirmar el pedido. La liquidación se mantendrá separada del pago al comprador.

## Seguridad

Este repositorio es una base MVP local, no una certificación de seguridad ni un producto listo para recaudar fondos. No guardamos datos de tarjeta. No pongas credenciales Redsys, secretos ni datos bancarios reales en el repositorio. En producción, `TRUST_PROXY=1` solo debe configurarse si existe un proxy HTTPS de confianza delante del servicio.
