# Despliegue en Coolify

El Compose principal está pensado para Coolify: el servicio `app` escucha en el puerto interno 3001 y no publica un puerto del host; Coolify enruta el dominio y termina HTTPS. PostgreSQL queda dentro de la red privada y conserva sus datos en un volumen persistente en `/var/lib/postgresql`, ruta de datos de la imagen PostgreSQL 18.

## Preparar el origen

Coolify necesita leer los archivos de este directorio desde un repositorio Git accesible por el servidor. Cuando el proyecto esté en Git, crea un recurso **Application → Docker Compose** conectado al repositorio y configura la carpeta base `outputs/logiticket-mvp` (o mueve este directorio a la raíz del repositorio) y el Compose path `compose.yaml`.

En **Environment Variables** define valores propios de producción:

- `NODE_ENV=production`
- `TRUST_PROXY=1`
- `SESSION_SECRET`: secreto aleatorio largo
- `POSTGRES_DB=logiticket`
- `POSTGRES_USER=logiticket`
- `POSTGRES_PASSWORD`: contraseña aleatoria larga, alfanumérica para mantener segura su interpolación dentro de `DATABASE_URL`

No uses los secretos de ejemplo. La definición Compose marca las variables críticas como requeridas, de modo que Coolify impide el despliegue si faltan.

## Dominio y primer despliegue

1. Añade el dominio en Coolify, selecciona el servicio `app` y usa el puerto interno `3001`.
2. Configura el DNS del dominio para apuntar al VPS y asegúrate de que el proxy de Coolify pueda recibir tráfico HTTPS.
3. Despliega desde Coolify y revisa que `app` y `db` queden saludables.
4. Desde la consola/terminal del servicio app, ejecuta `npm run migrate`.
5. En esa misma consola ejecuta `npm run create-user -- propietario@ejemplo.es "Propietario Logiticket" platform_admin` y completa la contraseña solicitada.
6. Abre el dominio configurado e inicia sesión.

Configura las copias de seguridad de PostgreSQL en Coolify y guarda también una copia fuera del VPS. Un volumen persistente protege frente a recreaciones normales del contenedor, pero no frente a pérdida del servidor o del disco.

Los carteles WebP se guardan en `/data/uploads`. El Compose monta allí el volumen persistente `logiticket_uploads`; conserva ese montaje en Coolify y añade ese volumen a las copias de seguridad del VPS. La base de datos guarda las URL de la miniatura y del cartel de detalle. Los márgenes de ambas variantes toman el color predominante de los bordes del cartel para evitar bandas negras.

## Estado y límites

Este directorio aún no está conectado a un repositorio remoto ni desplegado en Coolify. Redsys tampoco está configurado. Hace falta proporcionar el código al recurso Git de Coolify, añadir los secretos en su panel y confirmar previamente con banco/adquirente que el modelo de cobro y liquidación está habilitado.
