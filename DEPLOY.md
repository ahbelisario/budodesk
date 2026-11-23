# Despliegue (dev/QA y producción)

Los dos ambientes usan **el mismo `compose-prd.yaml`**; lo que cambia es el
`.env` de cada servidor (dominio, puerto, secretos, nombre del proyecto).

## Primer despliegue en un servidor

> ⚠️ La versión 2 usa una base de datos **nueva** (`budodesk`) en un volumen de
> Docker. Los contenedores de la versión anterior (base `fsms`, sin volumen) se
> reemplazan y sus datos de prueba no se migran.

```bash
cd /ruta/al/repo
git fetch && git checkout v2 && git pull     # o main, una vez que se haga merge

# 1. Configuración del servidor (una sola vez)
cp .env.example .env
nano .env        # llena DB_ROOT_PASSWORD, DB_PASSWORD, JWT_ACCESS_SECRET, SMTP_PASS, APP_BASE_URL…
                 # secretos:  openssl rand -base64 36

# 2. Apagar la versión anterior (si sigue corriendo en este servidor)
docker compose -f compose-prd.yaml down      # SIN -v

# 3. Levantar la nueva
docker compose -f compose-prd.yaml up -d --build
docker compose -f compose-prd.yaml ps        # db "healthy", backend "healthy"

# 4. Crear tu usuario (dueño del dojo y superadmin). Pide la contraseña sin mostrarla.
docker compose -f compose-prd.yaml exec backend node scripts/create-admin.js \
  --email tu@correo.mx --name Arturo --dojo seikoukan --superadmin
```

Abre `https://seikoukan.budodesk.com` y entra con ese correo.

### Dev y producción en el mismo servidor

Dos copias del repo (o dos carpetas), cada una con su `.env`:

| Variable | dev | prod |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `budodesk-dev` | `budodesk` |
| `HTTP_PORT` | `8801` | `8800` |
| `APP_BASE_URL` | `https://dev.budodesk.com` | `https://seikoukan.budodesk.com` |
| `DEFAULT_DOJO_SLUG` | `seikoukan` | `seikoukan` |

Con nombres de proyecto distintos, cada ambiente tiene sus propios volúmenes
(base de datos y archivos) y no se pisan. Tu proxy de entrada (Cloudflare /
Nginx Proxy Manager) apunta cada dominio a su puerto. `*.budodesk.com` puede
apuntar a producción: cada subdominio es un dojo.

## Actualizar

```bash
git pull
docker compose -f compose-prd.yaml up -d --build
```

Los datos no se tocan: el esquema solo se carga cuando el volumen está vacío.
Cambios futuros de esquema llegarán como archivos de migración.

## Respaldos

```bash
# Respaldo (queda en ./backups, que no se sube a git)
docker compose -f compose-prd.yaml exec db sh -c \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines budodesk | gzip > /backups/budodesk-$(date +%F-%H%M).sql.gz'

# Restaurar
gunzip -c backups/ARCHIVO.sql.gz | docker compose -f compose-prd.yaml exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" budodesk'
```

Recomendado: el respaldo en un cron diario del servidor, copiando `./backups`
fuera de la VM (otro disco o Proxmox Backup Server).

## Nunca

- `docker compose down -v` en producción: borra el volumen con la base de datos.
- Subir `.env` a git.
- Publicar el puerto 3306 en producción.
