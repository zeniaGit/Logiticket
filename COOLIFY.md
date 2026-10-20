# Despliegue en Coolify

El Compose principal publica solo la aplicación. Usa el recurso PostgreSQL 16 que se configura aparte en Coolify; no inicia una segunda base. La aplicación escucha en el puerto interno 3001 y Coolify enruta el dominio y termina HTTPS. Los carteles se conservan en el volumen `logiticket_uploads`, montado en `/data/uploads`.

## Conectar la base PostgreSQL 16

1. Comprueba que la aplicación y el recurso PostgreSQL están desplegados en el mismo servidor/destino Docker de Coolify.
2. En la configuración del recurso Docker Compose de la aplicación, activa **Connect To Predefined Network** (en Advanced, según la versión de Coolify). Así podrá resolver y alcanzar el hostname interno de PostgreSQL. No publiques el puerto 5432 ni asignes dominio al recurso de base de datos.
3. En el recurso PostgreSQL, copia el valor **Internal URL**. En las variables de entorno de la aplicación define `DATABASE_URL` con esa URL completa. No la pongas en Git ni en el chat; Coolify debe guardarla como variable secreta.
4. Define además `NODE_ENV=production`, `TRUST_PROXY=1` y un `SESSION_SECRET` aleatorio largo. No hacen falta `POSTGRES_USER`, `POSTGRES_PASSWORD` ni `POSTGRES_DB` en la aplicación: esos parámetros pertenecen al recurso de base y ya están incluidos en la Internal URL.
5. Si Coolify ofrece la opción de hacer literal la variable, actívala para `DATABASE_URL`: la contraseña podría contener caracteres reservados o `$`.

El Internal URL suele tener la forma `postgres://usuario:contraseña@hostname-interno:5432/nombre_base`. Usa el valor generado por Coolify literalmente, incluido su hostname y base de datos. No uses `localhost`: dentro del contenedor apuntaría a la propia aplicación.

## Repositorio, dominio y despliegue

El código está publicado en `zeniaGit/Logiticket`, rama `main`, con este proyecto en la raíz del repositorio. En Coolify crea un recurso de aplicación desde GitHub que use **Docker Compose** y selecciona `compose.yaml` como Compose path. Deja Compose en modo normal; no actives Raw Compose. Si el repositorio es privado, autoriza la GitHub App de Coolify para acceder a él.

1. Añade un dominio al servicio `app`, con el puerto interno `3001`.
2. Apunta el registro DNS del dominio al VPS y comprueba que el proxy de Coolify puede recibir tráfico por HTTPS.
3. Despliega y revisa que el servicio `app` quede saludable.
4. Desde la terminal del servicio app ejecuta `npm run migrate`.
5. Crea la cuenta propietaria ejecutando `npm run create-user -- propietario@ejemplo.es "Propietario Logiticket" platform_admin` y completa la contraseña cuando se solicite.
6. Abre `/login` en el dominio configurado.

Configura copias de seguridad PostgreSQL en Coolify y guarda una copia fuera del VPS. El volumen persistente protege frente a recreaciones normales del contenedor, pero no frente a pérdida del servidor o disco. Incluye también `/data/uploads` (volumen `logiticket_uploads`) en la estrategia de copia.

## Desarrollo local

Para iniciar localmente la aplicación con una base PostgreSQL 16 propia de Compose, usa `docker compose --env-file .env -f compose.yaml -f compose.local.yaml up --build`. El override local agrega la base y el puerto 5432 ligado solo a loopback; Coolify debe usar únicamente `compose.yaml`.

## Estado y límites

La portada pública sigue leyendo el catálogo estático del CSV. Los eventos nuevos aún no aparecen automáticamente en esa portada. El checkout no crea pedidos, no emite entradas ni conecta Redsys; por tanto, el despliegue actual sirve para probar el panel y el flujo de eventos, no para vender entradas reales.
