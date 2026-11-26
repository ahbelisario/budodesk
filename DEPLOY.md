# Despliegue (dev/QA y producción)

Los dos ambientes usan **el mismo `compose-prd.yaml`**; lo que cambia es el
`.env` de cada servidor (dominio, puerto, secretos, nombre del proyecto).

## Despliegue con `deploy.sh` (recomendado)

Funciona con **Docker** (con el plugin `docker compose`) o con **Podman** (con
`podman-compose`). En el servidor:

```bash
git clone https://github.com/ahbelisario/budodesk.git budodesk && cd budodesk
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
| `./deploy.sh restore ARCHIVO` | Restaura un respaldo descargado del panel (`.tar.gz` o la copia cifrada `.enc`) |

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

`./deploy.sh up` muestra qué versión despliega y `./deploy.sh status` cuál está en el código.
En la app, Perfil → Cuenta muestra «BudoDesk X.Y.Z»; si el servidor tiene otra versión, lo dice
(por ejemplo, si el navegador guardó una versión vieja de la página).

Los datos no se tocan: el esquema base solo se carga cuando el volumen está vacío.
Si la versión trae cambios a la base, el backend los aplica solo al arrancar (ver «Cambios a la base»).

## Cambios a la base (migraciones)

Ya no hay SQL sueltos que correr a mano. Cada cambio de esquema es un archivo en
`backend/migrations/` y el backend aplica los pendientes al arrancar (o sea, con `./deploy.sh up`):

- Antes de aplicarlos guarda un respaldo de la base (`antes-de-migrar-*.sql.gz`, los últimos 5).
- Si uno falla, el backend no arranca y lo dice en `./deploy.sh logs backend`; la migración no se
  registra y se reintenta al volver a desplegar.

```bash
./deploy.sh migrations                          # aplicadas, pendientes y respaldos previos
./deploy.sh restore antes-de-migrar-….sql.gz    # regresar la base a antes de una migración
```

`db/schema/01-schema.sql` es la línea base (1.0.8) y ya no se modifica. Cómo crear una
migración y las reglas: `backend/migrations/README.md`.

## Versiones

La versión vive en el archivo `VERSION` (formato `MAYOR.MENOR.PARCHE`) y se repite en
`backend/package.json`, `frontend/package.json` y `frontend/app.json`. No se editan a mano:

```bash
./release.sh patch     # 1.0.8 → 1.0.9  correcciones
./release.sh minor     # 1.0.9 → 1.1.0  funciones nuevas
./release.sh major     # 1.1.0 → 2.0.0
git push origin main --follow-tags
```

`release.sh` actualiza los números, agrega al `CHANGELOG.md` los commits desde la versión
anterior, hace el commit «Versión X.Y.Z» y la etiqueta `vX.Y.Z`. Para volver a una versión:
`git checkout v1.0.8` (y `git checkout main` para regresar).

## Respaldos

Se configuran desde la app: **Plataforma → Respaldos**. Solo aparece para el
superadmin (`./deploy.sh admin` con «superadmin»).

- **Automáticos:** diario o semanal, a la hora que elijas. Se guardan de 1 a 10
  en el servidor (volumen `appbackups`) y se van ciclando. Se descargan desde
  el panel con un enlace que vence en 5 minutos.
- **Qué incluyen:** toda la base de datos (todos los dojos) y los archivos
  subidos (logos y fotos), en un `budodesk-AAAA-MM-DD-HHMM.tar.gz`.
- **Copia en S3 (opcional):** AWS, Backblaze B2, Cloudflare R2, Wasabi o
  MinIO, con su propio número de copias a guardar.
  - Van **cifradas** con `BACKUP_ENCRYPTION_KEY`, que `./deploy.sh config`
    genera sola.
  - **Guarda esa llave fuera del servidor** (gestor de contraseñas). Sin ella,
    las copias de S3 no se pueden abrir.
- **Si un respaldo falla,** llega un correo a los superadmins.

### Restaurar

Restaurar reemplaza **toda** la base actual. Se hace desde la consola del
servidor, nunca desde la app:

```bash
# 1. Descarga el respaldo desde el panel y cópialo al servidor
scp budodesk-2026-11-25-0300.tar.gz usuario@servidor:~/budodesk/
# 2. En la carpeta del repo
./deploy.sh restore budodesk-2026-11-25-0300.tar.gz
```

El script hace esto:

1. Revisa que el archivo sea un respaldo de BudoDesk.
2. Pide escribir `RESTAURAR`.
3. Guarda lo actual en `./backups/antes-de-restaurar-FECHA.sql.gz`.
4. Reemplaza la base y los archivos subidos, y reinicia el backend.

Si la importación falla, regresa la base a como estaba. Con la copia de S3
(`.tar.gz.enc`) es el mismo comando: la descifra con la llave del servidor.

### Respaldo manual por consola (sin la app)

```bash
docker compose -f compose-prd.yaml exec db sh -c \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines budodesk | gzip > /backups/budodesk-$(date +%F-%H%M).sql.gz'

# Restaurar un .sql.gz hecho así
gunzip -c backups/ARCHIVO.sql.gz | docker compose -f compose-prd.yaml exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" budodesk'
```

## Pagos en línea (PayPal y Mercado Pago)

Cada dojo pone sus propias credenciales en **Ajustes del dojo → Cobro**, y el
dinero llega directo a su cuenta.

- Las credenciales se guardan cifradas con `BACKUP_ENCRYPTION_KEY`, así que sin
  esa llave no se pueden activar.
- **Prueba y Real por separado:** cada proveedor guarda dos juegos de
  credenciales (Client ID/Secret/Webhook ID en PayPal; Public Key/Access
  Token/clave secreta en Mercado Pago). El selector «Ambiente en uso» solo
  elige con cuáles se cobran los pagos nuevos; un pago que empezó en un
  ambiente se termina con las credenciales de ese ambiente. No se puede
  pasar a Real si faltan las credenciales reales.
- **Avisos (webhooks):** cada ambiente tiene su propia dirección, que termina
  en `/test` o `/live`; por ejemplo
  `https://seikoukan.budodesk.com/api/v2/online-payments/webhooks/paypal/1/live`.
  Registra la de prueba en la app Sandbox de PayPal y la real en la app Live;
  en Mercado Pago, cada una en su modo. Deben ser públicas y con `https`. Si se
  pierde un aviso, el pago se confirma igual cuando el alumno regresa a la app.
- **En local** los avisos no llegan, porque no hay dirección pública. El pago se
  confirma al regresar a la app.
- Empieza en **Prueba** y pasa a **Real** cuando todo funcione. Para probar en
  Real, haz un pago chico y reembólsalo desde el panel del proveedor.

## Registro de dojos nuevos (prueba gratis)

Cualquier dojo puede pedir su cuenta en `https://budodesk.com/signup` (también
aparece como «¿Tienes un dojo?» en la pantalla de entrada cuando no hay un dojo
en la dirección).

1. La solicitud queda **pendiente**. A quien se registra le llega «recibimos tu
   solicitud» y al superadmin un aviso con el enlace al panel.
2. En **Plataforma → Solicitudes** la apruebas (puedes corregir nombre y
   dirección, elegir los días de prueba y copiar la configuración de otro dojo)
   o la rechazas, con aviso opcional.
3. Al aprobarla se crea el dojo en prueba. Al dueño le llega el correo para
   crear su contraseña en `https://<dirección>.budodesk.com`, o para entrar si
   ya tenía cuenta.
4. Una semana antes y el último día de la prueba, los dueños reciben un aviso.
   Al terminar, el dojo queda en **solo lectura**: pueden entrar y consultar
   todo, pero no hacer cambios. El cobro automático, los recordatorios y el
   registro de alumnos se detienen.
5. Cuando paguen, en **Plataforma → Dojos → Editar** cámbialo a **Activo** con
   su plan. Para darles más tiempo, pon una fecha nueva de fin de prueba y se
   reabre.

En el mismo panel se apaga el formulario y se cambian los días de prueba (30
por omisión).

- **DNS y certificado:** cada dojo usa su subdominio, así que se necesitan un
  registro comodín `*.budodesk.com` y un certificado que lo cubra. nginx ya
  acepta cualquier nombre (`server_name _`).
- **Correo de contacto:** los avisos de fin de prueba y el aviso de solo
  lectura dicen a quién escribir para contratar. Ponlo en el `.env` con
  `SUPPORT_EMAIL=contacto@budodesk.com`. Si falta, los correos usan el del
  superadmin y la app dice «contacta a BudoDesk».

## Nunca

- `docker compose down -v` en producción: borra el volumen con la base de datos.
- Subir `.env` a git.
- Publicar el puerto 3306 en producción.
