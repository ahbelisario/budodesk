# Despliegue (dev/QA y producción)

Los dos ambientes usan **el mismo `compose-prd.yaml`**; lo que cambia es el
`.env` de cada servidor (dominio, puerto, secretos, nombre del proyecto).

## Despliegue con `deploy.sh` (recomendado)

Funciona con **Docker** (con el plugin `docker compose`) o con **Podman** (con
`podman-compose`). En el servidor:

```bash
git clone https://github.com/ahbelisario/fsms.git budodesk && cd budodesk
git checkout main            # o v2 mientras no se haga merge
./deploy.sh
```

La primera vez pregunta lo necesario y crea el `.env`:

- ambiente (`dev` o `prd`), con valores por omisión distintos para cada uno;
- Docker o Podman, si el servidor tiene los dos;
- URL pública, puerto, dojo por omisión y cuántos proxies hay delante;
- correo SMTP y su contraseña (no se muestra al escribirla).

Las contraseñas de la base y el secreto JWT **se generan solas**. Después
levanta los contenedores, espera a que el API responda, ofrece crear tu usuario
administrador y, solo en dev, cargar datos de ejemplo.

Las siguientes veces `./deploy.sh` muestra el resumen y pregunta si quieres
cambiar algo antes de desplegar. Al cambiar la configuración se conservan las
contraseñas existentes y se guarda una copia `.env.bak-FECHA`.

| Comando | Qué hace |
|---|---|
| `./deploy.sh` | Configura (si hace falta) y despliega |
| `./deploy.sh up` | Actualiza sin preguntas (después de `git pull`) |
| `./deploy.sh config` | Solo crea o cambia el `.env` |
| `./deploy.sh admin` | Crea o actualiza un usuario administrador |
| `./deploy.sh demo` | Datos de ejemplo (solo `APP_ENV=dev`) |
| `./deploy.sh status` | Contenedores y salud del API |
| `./deploy.sh logs [backend\|db\|gateway\|frontend]` | Logs en vivo |
| `./deploy.sh stop` | Apaga los contenedores (los datos se conservan) |

Opciones: `--engine docker|podman` para forzar el motor y `--yes` para aceptar
los valores por omisión sin preguntar.

> ⚠️ La versión 2 usa una base de datos **nueva** (`budodesk`) en un volumen.
> Si en el servidor sigue corriendo la versión anterior, apágala primero desde
> su carpeta con `docker compose -f compose-prd.yaml down` (**sin** `-v`). Sus
> datos de prueba no se migran.

### Dev y producción en el mismo servidor

Usa dos carpetas (dos clones del repo) y corre `./deploy.sh` en cada una. Los
valores por omisión ya los separan:

| | dev | prd |
|---|---|---|
| Proyecto (volúmenes) | `budodesk-dev` | `budodesk` |
| Puerto | `8801` | `8800` |
| URL | `https://dev.budodesk.com` | `https://seikoukan.budodesk.com` |
| Correos reales | no (van al log) | sí |

Tu proxy de entrada (Cloudflare / Nginx Proxy Manager) apunta cada dominio a su
puerto. `*.budodesk.com` puede apuntar a producción: cada subdominio es un dojo.

### Podman

- Imágenes con nombre completo (`docker.io/library/...`), así que no hace falta
  configurar registros.
- El script compila en formato docker (`BUILDAH_FORMAT=docker`) para conservar
  los *healthchecks*.
- Sin root, para que los contenedores vuelvan a levantar después de reiniciar
  el servidor:
  `systemctl --user enable --now podman-restart.service && loginctl enable-linger "$USER"`

## Despliegue manual (sin el script)

```bash
cp .env.example .env && nano .env     # llena las contraseñas y el SMTP
docker compose -f compose-prd.yaml up -d --build
docker compose -f compose-prd.yaml exec backend node scripts/create-admin.js \
  --email tu@correo.mx --name Arturo --dojo seikoukan --superadmin
```

## Actualizar

```bash
git pull
./deploy.sh up
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
