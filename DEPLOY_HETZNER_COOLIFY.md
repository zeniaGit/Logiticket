# Despliegue Logiticket en Hetzner + Coolify

Estado: preparado para publicar como **entorno de pruebas**. No se ha creado ningún servidor ni servicio con coste.

## Qué puede probarse tras el primer despliegue

- Inicio de sesión, roles de plataforma y organizador.
- Alta de eventos como borrador, subida de cartel con dos variantes WebP, envío a revisión y publicación administrativa.
- Promociones y sorteos como borradores.
- PostgreSQL con persistencia de eventos, cuentas y configuración.

La portada pública sigue leyendo el catálogo estático del CSV. Los eventos nuevos aún no aparecen automáticamente en esa portada. El checkout no crea pedidos, no emite entradas ni conecta Redsys; por tanto, este despliegue no debe vender entradas reales.

## Opción de servidor

Si se crea un VPS nuevo para esta prueba, el punto de partida recomendado es Hetzner Cloud **CPX32**: 4 vCPU, 8 GB RAM y 160 GB NVMe en una ubicación europea como Nuremberg o Falkenstein. La tabla oficial consultada muestra 35,49 €/mes antes del coste de IPv4 e impuestos; confirma el total en la consola antes de pagar porque Hetzner cambia precios y disponibilidad. Para un entorno temporal se puede elegir CPX22 (2 vCPU, 4 GB RAM, 80 GB NVMe), pero CPX32 deja más margen para Coolify, PostgreSQL y el proceso Node.

Selecciona Ubuntu 24.04 LTS, añade una clave SSH pública, activa copias de seguridad del servidor y crea un firewall que solo permita SSH desde tu IP y HTTP/HTTPS (80/443). No publiques 3001 ni 5432 a Internet. Si el Coolify actual ya está en ese VPS, no instales una segunda instancia: añade el servidor a Coolify solo si realmente se va a desplegar en otra máquina.

Hetzner factura el servidor cloud por horas con un límite mensual; confirma precio, IPv4, IVA y coste de copias en la pantalla final antes de contratar.

## Preparación que falta fuera del código

1. Publicar este directorio en un repositorio **privado** de GitHub, GitLab o similar. El `.env` local está excluido del repositorio y de la imagen Docker.
2. Tener acceso al proyecto y a un servidor de despliegue en Coolify.
3. Decidir el dominio/subdominio público, por ejemplo `entradas.tudominio.com`, y apuntar su registro DNS A a la IPv4 del servidor.
4. Guardar en Coolify secretos nuevos de producción. No reutilices el `.env` local ni subas secretos a Git.

## Recurso Docker Compose en Coolify

Para un repositorio donde la raíz sea este proyecto:

- Build strategy: **Docker Compose**.
- Base Directory: `/`.
- Docker Compose Location: `compose.yaml`.
- Dominio del servicio `app`: `https://entradas.tudominio.com:3001`.
- Variables: `NODE_ENV=production`, `TRUST_PROXY=1`, `POSTGRES_DB=logiticket`, `POSTGRES_USER=logiticket`, `POSTGRES_PASSWORD=<64 caracteres hexadecimales>`, `SESSION_SECRET=<64 caracteres hexadecimales>`.
- Deja el modo Compose normal de Coolify; no actives Raw Compose.
- El servicio PostgreSQL no debe tener dominio público.

El Compose ya define los volúmenes `logiticket_pg` y `logiticket_uploads`; conserva ambos. PostgreSQL solo escucha en la red interna. Los carteles se guardan en `/data/uploads`. Configura copias restaurables de PostgreSQL y de los carteles fuera del VPS: un volumen persistente por sí solo no es una copia de seguridad.

## Primer arranque

1. Desplegar desde Coolify y esperar a que `app` y `db` estén saludables.
2. Abrir una terminal del servicio `app` y ejecutar `npm run migrate`.
3. Crear el usuario de plataforma desde esa terminal:

   ```sh
   npm run create-user -- propietario@tudominio.com "Propietario Logiticket" platform_admin
   ```

4. Abrir `/login` en el dominio y comprobar acceso, alta de un organizador de prueba y subida del cartel.
5. Comprobar que el cartel permanece tras un redeploy y probar una restauración de backup antes de usar datos reales.

## Después de pagar/crear el VPS

Para completar la publicación necesitaré la IPv4 resultante, el dominio elegido, el repositorio privado conectado a Coolify y saber si Coolify está instalado en el VPS nuevo o en el que ya tienes. No envíes contraseñas, claves privadas ni tokens por el chat; introdúcelos directamente en Hetzner/Coolify.

## Referencias oficiales

- [Planes Cloud y precios Hetzner](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Crear y conectar un servidor Hetzner](https://docs.hetzner.com/cloud/servers/)
- [Despliegues Docker Compose desde Git en Coolify](https://coolify.io/docs/applications/builds/docker-compose)
- [Almacenamiento persistente en Coolify](https://coolify.io/docs/applications/configuration/persistent-storage)
