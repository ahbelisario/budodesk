#!/usr/bin/env bash
# =============================================================================
#  BudoDesk — configuración y despliegue en un servidor (dev o prd)
#  con Docker o Podman.
#
#    ./deploy.sh              Primera vez: pregunta los datos, crea .env y despliega.
#                             Después: actualiza (reconstruye y levanta) con el .env actual.
#    ./deploy.sh config       Solo crear o cambiar el .env (no despliega).
#    ./deploy.sh up           Desplegar o actualizar con el .env actual, sin preguntas.
#    ./deploy.sh admin        Crear o actualizar un usuario administrador.
#    ./deploy.sh demo         Cargar datos de ejemplo (solo en dev).
#    ./deploy.sh status       Ver contenedores y salud del API.
#    ./deploy.sh logs [svc]   Ver logs (backend, db, gateway, frontend).
#    ./deploy.sh restore ARCH Restaurar un respaldo descargado del panel (.tar.gz o .tar.gz.enc).
#    ./deploy.sh stop         Apagar los contenedores (los datos se conservan).
#
#  Opciones:  --engine docker|podman   -y | --yes (acepta valores por omisión)
#
#  Nunca borra volúmenes: la base de datos y los archivos subidos se conservan.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE_FILE=compose-prd.yaml
ENV_FILE=.env
HEALTH_PATH=/api/v2/health

YES=0
ENGINE=""
CMD=""
LOG_SVC=""

# ---------- salida ----------
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else B=""; G=""; Y=""; R=""; D=""; N=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '%s✔ %s%s\n' "$G" "$*" "$N"; }
warn() { printf '%s! %s%s\n' "$Y" "$*" "$N" >&2; }
die()  { printf '%s✖ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# ---------- argumentos ----------
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1 ;;
    --engine) shift; ENGINE="${1-}" ;;
    --engine=*) ENGINE="${1#*=}" ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    config|up|admin|demo|status|logs|stop|restore)
      [ -z "$CMD" ] || die "Solo un comando a la vez"; CMD="$1"
      if { [ "$1" = logs ] || [ "$1" = restore ]; } && [ $# -gt 1 ] && [ "${2#-}" = "$2" ]; then LOG_SVC="$2"; shift; fi ;;
    *) die "Opción desconocida: $1  (usa --help)" ;;
  esac
  shift
done
case "$ENGINE" in ""|docker|podman) ;; *) die "--engine debe ser docker o podman" ;; esac

[ -f "$COMPOSE_FILE" ] || die "No encuentro $COMPOSE_FILE. Corre el script desde la carpeta del repo."

# ---------- preguntas ----------
# ask VAR "Pregunta" "valor por omisión" [validador]
ask() {
  local __var=$1 __q=$2 __def=${3-} __chk=${4-} __val
  while :; do
    if [ "$YES" = 1 ]; then
      __val=$__def
    else
      if [ -n "$__def" ]; then printf '%s %s[%s]%s: ' "$__q" "$D" "$__def" "$N"; else printf '%s: ' "$__q"; fi
      if ! IFS= read -r __val; then
        printf '\n'; [ -n "$__def" ] || die "Se terminó la entrada sin respuesta para «$__q»"; __val=$__def
      fi
      [ -n "$__val" ] || __val=$__def
    fi
    if [ -n "$__chk" ] && ! "$__chk" "$__val"; then
      [ "$YES" = 1 ] && die "Valor inválido para «$__q»: '$__val'"
      continue
    fi
    break
  done
  printf -v "$__var" '%s' "$__val"
}

# ask_yn "Pregunta" s|n   → 0 = sí
ask_yn() {
  local q=$1 def=$2 a hint
  if [ "$def" = s ]; then hint="S/n"; else hint="s/N"; fi
  if [ "$YES" = 1 ]; then [ "$def" = s ]; return; fi
  while :; do
    printf '%s [%s]: ' "$q" "$hint"
    IFS= read -r a || { printf '\n'; a=$def; }
    a=$(printf '%s' "${a:-$def}" | tr '[:upper:]' '[:lower:]')
    case "$a" in
      s|si|sí|y|yes) return 0 ;;
      n|no) return 1 ;;
    esac
  done
}

# ask_secret VAR "Pregunta" "valor actual"  (Enter conserva el actual)
ask_secret() {
  local __var=$1 __q=$2 __cur=${3-} __a __b
  if [ "$YES" = 1 ]; then
    [ -n "$__cur" ] || die "Falta $__q (no se puede preguntar en modo --yes)"
    printf -v "$__var" '%s' "$__cur"; return
  fi
  while :; do
    if [ -n "$__cur" ]; then printf '%s %s[Enter = conservar la actual]%s: ' "$__q" "$D" "$N"; else printf '%s: ' "$__q"; fi
    IFS= read -rs __a || die "Se terminó la entrada sin respuesta para «$__q»"; printf '\n'
    if [ -z "$__a" ]; then
      if [ -n "$__cur" ]; then __a=$__cur; break; fi
      warn "No puede ir vacía"; continue
    fi
    case "$__a" in *"'"*) warn "No puede contener comillas simples ( ' )"; continue ;; esac
    printf 'Repítela: '; IFS= read -rs __b || __b=""; printf '\n'
    [ "$__a" = "$__b" ] && break
    warn "No coinciden, intenta de nuevo"
  done
  printf -v "$__var" '%s' "$__a"
}

# ---------- validadores ----------
v_nonempty() { [ -n "$1" ] || { warn "No puede ir vacío"; return 1; }; }
v_port()     { case "$1" in ''|*[!0-9]*) warn "Debe ser un número";  return 1 ;; esac
               [ "$1" -ge 1 ] && [ "$1" -le 65535 ] || { warn "Puerto entre 1 y 65535"; return 1; }; }
v_int()      { case "$1" in ''|*[!0-9]*) warn "Debe ser un número entero"; return 1 ;; esac; }
v_url()      { case "$1" in http://?*|https://?*) case "$1" in */) warn "Sin / al final"; return 1 ;; esac ;;
               *) warn "Debe empezar con https:// (o http://)"; return 1 ;; esac; }
v_slug()     { printf '%s' "$1" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' || { warn "Solo minúsculas, números y guiones"; return 1; }; }
v_project()  { printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9_-]*$' || { warn "Solo minúsculas, números, - y _"; return 1; }; }
v_env()      { case "$1" in dev|prd) ;; *) warn "Escribe dev o prd"; return 1 ;; esac; }
v_email()    { printf '%s' "$1" | grep -Eq '^[^@ ]+@[^@ ]+\.[^@ ]+$' || { warn "Correo no válido"; return 1; }; }
v_engine()   { case "$1" in docker|podman) ;; *) warn "Escribe docker o podman"; return 1 ;; esac; }
v_bool()     { case "$1" in true|false) ;; *) warn "Escribe true o false"; return 1 ;; esac; }

# ---------- .env ----------
# Lee KEY del .env actual (sin comillas envolventes)
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  local line v
  line=$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 || true)
  [ -n "$line" ] || return 0
  v=${line#*=}
  case "$v" in
    \'*\') v=${v#\'}; v=${v%\'} ;;
    \"*\") v=${v#\"}; v=${v%\"} ;;
    *) v=$(printf '%s' "$v" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//') ;;   # quita comentarios al final
  esac
  printf '%s' "$v"
}

gen_secret() {
  local s=""
  if command -v openssl >/dev/null 2>&1; then
    s=$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | cut -c1-48)
  fi
  if [ ${#s} -lt 40 ]; then
    s=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)
  fi
  printf '%s' "$s"
}

# Valor para el .env: sin comillas si es seguro; si no, entre comillas simples.
env_val() {
  # shellcheck disable=SC1003
  case "$1" in
    *'$'*|*'"'*|*'\'*|*'`'*|*' #'*|' '*|*' ') printf "'%s'" "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

mask() { local s=$1; [ -n "$s" ] || { printf '(vacío)'; return; }; printf '%s…(%s caracteres)' "${s:0:3}" "${#s}"; }

KNOWN_KEYS="APP_ENV CONTAINER_ENGINE COMPOSE_PROJECT_NAME HTTP_PORT DEFAULT_DOJO_SLUG APP_BASE_URL DB_ROOT_PASSWORD DB_USER DB_PASSWORD DB_NAME JWT_ACCESS_SECRET BACKUP_ENCRYPTION_KEY ACCESS_TOKEN_TTL_MIN REFRESH_TOKEN_TTL_DAYS CORS_ORIGINS TRUST_PROXY SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS MAIL_FROM BILLING_SCHEDULER BACKUP_SCHEDULER"

# Variables del .env actual que este script no maneja (se conservan tal cual).
# Va en su propia función: la bash 3.2 de macOS no acepta un case dentro de $( ).
extra_env_lines() {
  local l k
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | while IFS= read -r l; do
    k=${l%%=*}
    case " $KNOWN_KEYS " in
      *" $k "*) ;;
      *) printf '%s\n' "$l" ;;
    esac
  done || true
}

write_env() {
  local tmp k extra
  tmp=$(mktemp "./.env.tmp.XXXXXX")
  trap 'rm -f "$tmp"' EXIT
  chmod 600 "$tmp"
  {
    printf '# BudoDesk — generado por deploy.sh el %s\n' "$(date '+%Y-%m-%d %H:%M')"
    printf '# NO subir a git. Para cambiarlo: ./deploy.sh config\n\n'
    printf '# ---- Instancia ----\n'
    printf 'APP_ENV=%s\n' "$APP_ENV"
    printf 'CONTAINER_ENGINE=%s\n' "$CONTAINER_ENGINE"
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME"
    printf 'HTTP_PORT=%s\n' "$HTTP_PORT"
    printf 'DEFAULT_DOJO_SLUG=%s\n' "$DEFAULT_DOJO_SLUG"
    printf 'APP_BASE_URL=%s\n\n' "$APP_BASE_URL"
    printf '# ---- Base de datos (no cambiar las contraseñas después del primer arranque) ----\n'
    printf 'DB_ROOT_PASSWORD=%s\n' "$DB_ROOT_PASSWORD"
    printf 'DB_USER=%s\n' "$DB_USER"
    printf 'DB_PASSWORD=%s\n' "$DB_PASSWORD"
    printf 'DB_NAME=budodesk\n\n'
    printf '# ---- Seguridad ----\n'
    printf 'JWT_ACCESS_SECRET=%s\n' "$JWT_ACCESS_SECRET"
    printf 'ACCESS_TOKEN_TTL_MIN=%s\n' "$ACCESS_TOKEN_TTL_MIN"
    printf 'REFRESH_TOKEN_TTL_DAYS=%s\n' "$REFRESH_TOKEN_TTL_DAYS"
    printf 'CORS_ORIGINS=%s\n' "$CORS_ORIGINS"
    printf 'TRUST_PROXY=%s\n\n' "$TRUST_PROXY"
    printf '# ---- Llave de cifrado: copias de respaldo en S3 y credenciales de pago. ¡Guárdala también fuera del servidor! ----\n'
    printf 'BACKUP_ENCRYPTION_KEY=%s\n\n' "$BACKUP_ENCRYPTION_KEY"
    printf '# ---- Correo (SMTP_HOST vacío = los correos solo se imprimen en el log) ----\n'
    printf 'SMTP_HOST=%s\n' "$SMTP_HOST"
    printf 'SMTP_PORT=%s\n' "$SMTP_PORT"
    printf 'SMTP_SECURE=%s\n' "$SMTP_SECURE"
    printf 'SMTP_USER=%s\n' "$(env_val "$SMTP_USER")"
    printf 'SMTP_PASS=%s\n' "$(env_val "$SMTP_PASS")"
    printf 'MAIL_FROM=%s\n\n' "$(env_val "$MAIL_FROM")"
    printf '# ---- Tareas automáticas ----\n'
    printf 'BILLING_SCHEDULER=%s\n' "$BILLING_SCHEDULER"
    printf 'BACKUP_SCHEDULER=%s\n' "${BACKUP_SCHEDULER:-true}"
    # Conserva otras variables que ya existían (p. ej. LOGIN_MAX_FAILED)
    if [ -f "$ENV_FILE" ]; then
      extra=$(extra_env_lines)
      if [ -n "$extra" ]; then printf '\n# ---- Otras (conservadas) ----\n%s\n' "$extra"; fi
    fi
  } > "$tmp"
  if [ -f "$ENV_FILE" ]; then
    local bak
    bak=".env.bak-$(date +%Y%m%d-%H%M%S)"
    cp -p "$ENV_FILE" "$bak"; chmod 600 "$bak"
    say "${D}Copia del .env anterior: $bak${N}"
  fi
  mv "$tmp" "$ENV_FILE"
  trap - EXIT
  chmod 600 "$ENV_FILE"
  ok "Configuración guardada en $ENV_FILE (solo tu usuario puede leerla)"
}

load_env() {
  [ -f "$ENV_FILE" ] || die "No existe $ENV_FILE. Corre primero: ./deploy.sh config"
  APP_ENV=$(env_get APP_ENV); COMPOSE_PROJECT_NAME=$(env_get COMPOSE_PROJECT_NAME)
  HTTP_PORT=$(env_get HTTP_PORT); DEFAULT_DOJO_SLUG=$(env_get DEFAULT_DOJO_SLUG)
  APP_BASE_URL=$(env_get APP_BASE_URL); SMTP_HOST=$(env_get SMTP_HOST)
  CONTAINER_ENGINE=$(env_get CONTAINER_ENGINE)
  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-budodesk}; HTTP_PORT=${HTTP_PORT:-8800}
  local miss="" k
  for k in DB_ROOT_PASSWORD DB_USER DB_PASSWORD JWT_ACCESS_SECRET; do [ -n "$(env_get $k)" ] || miss="$miss $k"; done
  [ -z "$miss" ] || die "Faltan valores en $ENV_FILE:$miss  → corre ./deploy.sh config"
  [ "${#APP_ENV}" -gt 0 ] || APP_ENV=prd
}

show_summary() {
  say ""
  say "${B}Resumen${N}"
  say "  Ambiente ............ $APP_ENV"
  say "  Motor ............... $CONTAINER_ENGINE"
  say "  Proyecto ............ $COMPOSE_PROJECT_NAME"
  say "  URL ................. $APP_BASE_URL"
  say "  Puerto HTTP ......... $HTTP_PORT"
  say "  Dojo por omisión .... $DEFAULT_DOJO_SLUG"
  say "  Proxies delante ..... $((TRUST_PROXY - 1))  (TRUST_PROXY=$TRUST_PROXY)"
  if [ -n "$SMTP_HOST" ]; then
    say "  Correo .............. $SMTP_USER @ $SMTP_HOST:$SMTP_PORT  contraseña $(mask "$SMTP_PASS")"
  else
    say "  Correo .............. desactivado (solo se imprime en el log)"
  fi
  say "  Tareas automáticas .. $BILLING_SCHEDULER"
  say "  Secretos ............ DB root $(mask "$DB_ROOT_PASSWORD"), DB app $(mask "$DB_PASSWORD"), JWT $(mask "$JWT_ACCESS_SECRET")"
  say "  Llave de respaldos .. $(mask "${BACKUP_ENCRYPTION_KEY:-}")"
}

# ---------- motor de contenedores ----------
COMPOSE=()
pick_engine() {
  local want=${ENGINE:-${CONTAINER_ENGINE:-}} have=""
  command -v docker >/dev/null 2>&1 && have="$have docker"
  command -v podman >/dev/null 2>&1 && have="$have podman"
  [ -n "$have" ] || die "No encontré Docker ni Podman. Instala uno de los dos y vuelve a correr el script."
  if [ -z "$want" ]; then
    case "$have" in
      " docker podman") ask want "Encontré Docker y Podman. ¿Cuál uso? (docker/podman)" docker v_engine ;;
      *) want=${have# } ;;
    esac
  fi
  case " $have " in *" $want "*) ;; *) die "Elegiste $want pero no está instalado en este servidor." ;; esac
  CONTAINER_ENGINE=$want
  if [ "$want" = docker ]; then
    if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose)
    elif command -v docker-compose >/dev/null 2>&1; then COMPOSE=(docker-compose)
    else die "Falta Docker Compose (paquete docker-compose-plugin)."; fi
    docker info >/dev/null 2>&1 || die "No puedo hablar con Docker. ¿Está corriendo? ¿Tu usuario está en el grupo docker? (o usa sudo)"
  else
    if command -v podman-compose >/dev/null 2>&1; then COMPOSE=(podman-compose)
    elif podman compose version >/dev/null 2>&1; then COMPOSE=(podman compose)
    else die "Falta podman-compose (dnf/apt install podman-compose, o pip install podman-compose)."; fi
    # Formato docker para conservar el HEALTHCHECK de las imágenes
    export BUILDAH_FORMAT=docker
  fi
}

compose() { "${COMPOSE[@]}" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"; }

volume_exists() { "$CONTAINER_ENGINE" volume inspect "${COMPOSE_PROJECT_NAME}_dbdata" >/dev/null 2>&1; }

http_ok() {
  local url="http://127.0.0.1:$HTTP_PORT$HEALTH_PATH"
  if command -v curl >/dev/null 2>&1; then curl -fsS -m 5 "$url" >/dev/null 2>&1
  else wget -q -T 5 -O /dev/null "$url" >/dev/null 2>&1; fi
}

port_busy() {
  if command -v ss >/dev/null 2>&1; then ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  elif command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else return 1; fi
}

# ---------- configurar ----------
configure() {
  step "Configuración"
  local first=1
  if [ -f "$ENV_FILE" ]; then
    first=0
    say "Ya existe un $ENV_FILE: sus valores son las respuestas por omisión (Enter para conservarlas)."
  else
    say "Te haré unas preguntas para crear el $ENV_FILE. Las contraseñas internas se generan solas."
  fi
  say "${D}Enter acepta el valor entre corchetes.${N}"
  say ""

  ask APP_ENV "Ambiente (dev/prd)" "$(env_get APP_ENV)" v_env
  local d_proj d_port d_url d_mail d_sched
  if [ "$APP_ENV" = dev ]; then d_proj=budodesk-dev; d_port=8801; d_url=https://dev.budodesk.com; d_mail=n; d_sched=true
  else d_proj=budodesk; d_port=8800; d_url=https://seikoukan.budodesk.com; d_mail=s; d_sched=true; fi

  pick_engine
  local cur
  cur=$(env_get COMPOSE_PROJECT_NAME); ask COMPOSE_PROJECT_NAME "Nombre del proyecto (separa volúmenes si dev y prd viven en el mismo servidor)" "${cur:-$d_proj}" v_project
  cur=$(env_get APP_BASE_URL);         ask APP_BASE_URL "URL pública (se usa en los enlaces de los correos)" "${cur:-$d_url}" v_url
  cur=$(env_get HTTP_PORT);            ask HTTP_PORT "Puerto donde escucha BudoDesk en este servidor (tu proxy apunta aquí)" "${cur:-$d_port}" v_port
  if port_busy "$HTTP_PORT" && ! http_ok; then
    warn "El puerto $HTTP_PORT ya está ocupado por otro programa."
    ask_yn "¿Usarlo de todos modos?" n || { ask HTTP_PORT "Otro puerto" "" v_port; }
  fi
  cur=$(env_get DEFAULT_DOJO_SLUG);    ask DEFAULT_DOJO_SLUG "Dojo por omisión (cuando el subdominio no lo indica)" "${cur:-seikoukan}" v_slug

  local proxies
  cur=$(env_get TRUST_PROXY); [ -n "$cur" ] && [ "$cur" -ge 1 ] 2>/dev/null && proxies=$((cur - 1)) || proxies=1
  say "${D}Proxies delante de BudoDesk: 0 = llegan directo a este servidor, 1 = Cloudflare Tunnel o Nginx Proxy Manager, 2 = Cloudflare + NPM${N}"
  ask proxies "¿Cuántos proxies hay delante?" "$proxies" v_int
  TRUST_PROXY=$((proxies + 1))

  # Correo
  say ""
  cur=$(env_get SMTP_HOST)
  if [ "$first" = 0 ]; then [ -n "$cur" ] && d_mail=s || d_mail=n; fi
  if ask_yn "¿Enviar correos reales (verificación, recuperar contraseña, avisos)?" "$d_mail"; then
    ask SMTP_HOST "Servidor SMTP" "${cur:-smtp.hostinger.com}" v_nonempty
    cur=$(env_get SMTP_PORT); ask SMTP_PORT "Puerto SMTP (465 = SSL, 587 = STARTTLS)" "${cur:-465}" v_port
    if [ "$SMTP_PORT" = 465 ]; then SMTP_SECURE=true; else SMTP_SECURE=false; fi
    cur=$(env_get SMTP_USER); ask SMTP_USER "Usuario SMTP" "${cur:-no-reply@budodesk.com}" v_email
    ask_secret SMTP_PASS "Contraseña SMTP" "$(env_get SMTP_PASS)"
    cur=$(env_get MAIL_FROM); ask MAIL_FROM "Remitente" "${cur:-BudoDesk <$SMTP_USER>}" v_nonempty
  else
    SMTP_HOST=""; SMTP_PORT=$(env_get SMTP_PORT); SMTP_PORT=${SMTP_PORT:-465}; SMTP_SECURE=true
    SMTP_USER=$(env_get SMTP_USER); SMTP_PASS=$(env_get SMTP_PASS); MAIL_FROM=$(env_get MAIL_FROM)
    MAIL_FROM=${MAIL_FROM:-BudoDesk <no-reply@budodesk.com>}
    say "${D}Los correos se imprimirán en el log del backend (./deploy.sh logs backend).${N}"
  fi

  cur=$(env_get BILLING_SCHEDULER)
  if ask_yn "¿Activar tareas automáticas (cargos, recordatorios y sesiones cada hora)?" "$([ "${cur:-$d_sched}" = true ] && echo s || echo n)"; then
    BILLING_SCHEDULER=true; else BILLING_SCHEDULER=false; fi

  # Valores que no se preguntan
  DB_USER=$(env_get DB_USER); DB_USER=${DB_USER:-budodesk_app}
  ACCESS_TOKEN_TTL_MIN=$(env_get ACCESS_TOKEN_TTL_MIN); ACCESS_TOKEN_TTL_MIN=${ACCESS_TOKEN_TTL_MIN:-15}
  REFRESH_TOKEN_TTL_DAYS=$(env_get REFRESH_TOKEN_TTL_DAYS); REFRESH_TOKEN_TTL_DAYS=${REFRESH_TOKEN_TTL_DAYS:-30}
  CORS_ORIGINS=$(env_get CORS_ORIGINS)
  BACKUP_SCHEDULER=$(env_get BACKUP_SCHEDULER); BACKUP_SCHEDULER=${BACKUP_SCHEDULER:-true}

  # Secretos: se conservan si ya existen; si no, se generan
  DB_ROOT_PASSWORD=$(env_get DB_ROOT_PASSWORD); DB_PASSWORD=$(env_get DB_PASSWORD); JWT_ACCESS_SECRET=$(env_get JWT_ACCESS_SECRET)
  BACKUP_ENCRYPTION_KEY=$(env_get BACKUP_ENCRYPTION_KEY)
  NEW_BACKUP_KEY=0
  if [ "${#BACKUP_ENCRYPTION_KEY}" -lt 32 ]; then BACKUP_ENCRYPTION_KEY=$(gen_secret); NEW_BACKUP_KEY=1; fi
  if { [ -z "$DB_ROOT_PASSWORD" ] || [ -z "$DB_PASSWORD" ]; } && volume_exists; then
    warn "Ya existe una base de datos (volumen ${COMPOSE_PROJECT_NAME}_dbdata) pero el .env no tiene sus contraseñas."
    warn "Si genero contraseñas nuevas, el backend no podrá entrar a esa base."
    ask_yn "¿Generar contraseñas nuevas de todos modos?" n || die "Recupera DB_ROOT_PASSWORD y DB_PASSWORD (p. ej. de un .env.bak-*) y vuelve a intentar."
  fi
  [ -n "$DB_ROOT_PASSWORD" ] || DB_ROOT_PASSWORD=$(gen_secret)
  [ -n "$DB_PASSWORD" ] || DB_PASSWORD=$(gen_secret)
  if [ "${#JWT_ACCESS_SECRET}" -lt 32 ]; then
    [ -z "$JWT_ACCESS_SECRET" ] || warn "JWT_ACCESS_SECRET tenía menos de 32 caracteres: genero uno nuevo (habrá que volver a iniciar sesión)."
    JWT_ACCESS_SECRET=$(gen_secret)
  fi

  show_summary
  say ""
  ask_yn "¿Guardar esta configuración?" s || die "Cancelado; no se cambió nada."
  write_env
  if [ "$NEW_BACKUP_KEY" = 1 ]; then
    say ""
    warn "Se generó BACKUP_ENCRYPTION_KEY (cifra las copias de respaldo en S3 y las credenciales de PayPal y Mercado Pago)."
    warn "Guárdala en tu gestor de contraseñas: sin ella no se pueden abrir esas copias si pierdes este servidor."
    say  "  Para verla:  grep BACKUP_ENCRYPTION_KEY $ENV_FILE"
  fi
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git check-ignore -q "$ENV_FILE" || warn "¡$ENV_FILE NO está en .gitignore! No lo subas a git."
  fi
}

# ---------- desplegar ----------
wait_healthy() {
  local _
  printf 'Esperando a que el API responda en el puerto %s ' "$HTTP_PORT"
  for _ in $(seq 1 60); do
    if http_ok; then printf '\n'; ok "BudoDesk responde"; return 0; fi
    printf '.'; sleep 3
  done
  printf '\n'
  warn "El API no respondió en 3 minutos. Estado y últimos logs:"
  compose ps || true
  compose logs --tail 40 db backend || true
  die "Revisa los logs de arriba. Cuando lo corrijas: ./deploy.sh up"
}

count_users() {
  compose exec -T backend node -e "require('./src/db/pool').pool.query('SELECT COUNT(*) AS n FROM users').then(([r])=>{console.log(r[0].n);process.exit(0)}).catch(()=>process.exit(1))" 2>/dev/null | tr -dc '0-9'
}

create_admin() {
  step "Usuario administrador"
  local email name dojo sa=""
  ask email "Correo del administrador" "" v_email
  ask name "Nombre" "" v_nonempty
  ask dojo "Dojo del que será dueño" "$DEFAULT_DOJO_SLUG" v_slug
  ask_yn "¿También superadmin de la plataforma (todos los dojos)?" s && sa="--superadmin"
  say "${D}Ahora te pedirá la contraseña (mínimo 10 caracteres; no se muestra).${N}"
  # shellcheck disable=SC2086
  compose exec backend node scripts/create-admin.js --email "$email" --name "$name" --dojo "$dojo" $sa
  ADMIN_EMAIL=$email
  ok "Usuario listo: $email"
}

load_demo() {
  [ "$APP_ENV" = dev ] || die "Los datos de ejemplo solo se cargan en dev (este .env es $APP_ENV)."
  step "Datos de ejemplo"
  local email=${ADMIN_EMAIL:-}
  ask email "Correo de un administrador del dojo" "$email" v_email
  say "${D}Te pedirá la contraseña de ese administrador.${N}"
  compose exec backend node scripts/demo-data.js --dojo "$DEFAULT_DOJO_SLUG" --admin "$email"
  ok "Datos de ejemplo cargados (las cuentas demo usan la contraseña Demo-BudoDesk-1)"
}

app_version() { if [ -f VERSION ]; then tr -d ' \n' < VERSION; else echo "(sin versión)"; fi; }

deploy() {
  step "Despliegue de BudoDesk $(app_version) ($APP_ENV con $CONTAINER_ENGINE, proyecto $COMPOSE_PROJECT_NAME)"
  mkdir -p backups
  local fresh=0
  volume_exists || fresh=1
  [ "$fresh" = 1 ] && say "Primera vez en este servidor: se creará la base de datos con el esquema inicial."
  if [ "$CONTAINER_ENGINE" = podman ]; then
    # podman-compose reconstruye las imágenes pero no reemplaza los contenedores que ya existen:
    # se construye, se bajan (sin -v: la base y los archivos se conservan) y se vuelven a crear.
    compose build
    compose down
    compose up -d
  else
    compose up -d --build
  fi
  wait_healthy
  compose ps

  local n
  n=$(count_users || true)
  if [ "$n" = 0 ]; then
    say ""
    say "La base no tiene usuarios todavía."
    if [ "$YES" = 0 ] && ask_yn "¿Crear tu usuario administrador ahora?" s; then create_admin; fi
  fi
  if [ "$APP_ENV" = dev ] && [ "$YES" = 0 ] && [ "$fresh" = 1 ]; then
    ask_yn "¿Cargar datos de ejemplo (alumnos, clases, pagos, examen)?" n && load_demo
  fi

  say ""
  ok "Listo: $APP_BASE_URL  (en este servidor: http://127.0.0.1:$HTTP_PORT)"
  say ""
  say "${B}Pendientes del servidor${N}"
  say "  • Tu proxy (Cloudflare / Nginx Proxy Manager) debe mandar ${APP_BASE_URL#*://} → este servidor, puerto $HTTP_PORT."
  if [ "$CONTAINER_ENGINE" = podman ]; then
    say "  • Para que los contenedores vuelvan a levantar después de reiniciar el servidor (podman sin root):"
    say "      systemctl --user enable --now podman-restart.service && loginctl enable-linger \"\$USER\""
  fi
  say "  • Actualizar después de un git pull:  ./deploy.sh up"
  say "  • Nunca uses 'compose down -v': borra la base de datos."
}

# ---------- restaurar ----------
restore() {
  local file=${1:-}
  [ -n "$file" ] || die "Indica el archivo: ./deploy.sh restore budodesk-AAAA-MM-DD-HHMM.tar.gz"
  [ -f "$file" ] || die "No encuentro el archivo: $file"
  command -v tar >/dev/null 2>&1 || die "Falta el comando tar en este servidor"
  http_ok || die "BudoDesk no está corriendo. Levántalo primero: ./deploy.sh up"

  local work; work=$(mktemp -d "${TMPDIR:-/tmp}/budodesk-restore.XXXXXX")
  chmod 700 "$work"
  trap 'rm -rf "$work"' EXIT
  local tgz="$file"

  step "Revisando el respaldo"
  case "$file" in
    *.enc)
      say "Es una copia cifrada: la descifro con la llave del servidor…"
      compose exec -T backend node scripts/backup-decrypt.js < "$file" > "$work/respaldo.tar.gz" \
        || die "No se pudo descifrar. ¿Es la misma BACKUP_ENCRYPTION_KEY con la que se creó?"
      tgz="$work/respaldo.tar.gz" ;;
  esac
  mkdir -p "$work/x"
  tar -xzf "$tgz" -C "$work/x" || die "El archivo no es un respaldo válido (.tar.gz dañado)"
  [ -f "$work/x/manifest.json" ] && [ -f "$work/x/budodesk.sql" ] || die "El archivo no es un respaldo de BudoDesk (falta manifest.json o budodesk.sql)"
  grep -q '"app": "BudoDesk"' "$work/x/manifest.json" || die "El archivo no es un respaldo de BudoDesk"
  local created rows files
  created=$(sed -n 's/.*"created_at": "\([^"]*\)".*/\1/p' "$work/x/manifest.json")
  rows=$(sed -n 's/.*"rows": \([0-9]*\).*/\1/p' "$work/x/manifest.json")
  files=$(sed -n 's/.*"uploads_files": \([0-9]*\).*/\1/p' "$work/x/manifest.json")
  say "  Creado .............. ${created:-?} (UTC)"
  say "  Registros ........... ${rows:-?}"
  say "  Archivos subidos .... ${files:-0}"
  say ""
  warn "Esto REEMPLAZA TODA la base de datos actual ($COMPOSE_PROJECT_NAME, $APP_ENV) por la del respaldo."
  warn "Antes guardo una copia de lo actual en ./backups/."
  if [ "$YES" = 1 ]; then die "Por seguridad, restore no acepta --yes: hay que confirmarlo a mano."; fi
  local answer
  printf 'Escribe RESTAURAR para continuar: '
  IFS= read -r answer || answer=""
  [ "$answer" = RESTAURAR ] || die "Cancelado; no se cambió nada."

  step "Copia de seguridad de lo actual"
  mkdir -p backups
  local before
  before="backups/antes-de-restaurar-$(date +%Y%m%d-%H%M%S).sql.gz"
  # shellcheck disable=SC2016
  compose exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines budodesk' | gzip > "$before"
  [ -s "$before" ] || die "No se pudo respaldar la base actual; no se cambió nada."
  chmod 600 "$before"
  ok "Copia de lo actual: $before"

  step "Restaurando"
  compose stop backend
  # shellcheck disable=SC2016
  local recreate='mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS budodesk; CREATE DATABASE budodesk CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"'
  # shellcheck disable=SC2016
  if ! compose exec -T db sh -c "$recreate" \
     || ! compose exec -T db sh -c 'mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" budodesk' < "$work/x/budodesk.sql"; then
    warn "Falló la restauración. Regreso la base a como estaba…"
    compose exec -T db sh -c "$recreate" || true
    # shellcheck disable=SC2016
    gunzip -c "$before" | compose exec -T db sh -c 'mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" budodesk' \
      || warn "Tampoco pude regresarla sola: importa $before a mano (ver DEPLOY.md, Restaurar)."
    compose start backend
    die "No se restauró el respaldo."
  fi
  ok "Base de datos restaurada"
  compose start backend
  wait_healthy
  if [ -d "$work/x/uploads" ]; then
    if tar -C "$work/x/uploads" -cf - . | compose exec -T backend tar -C /usr/src/app/uploads -xf -; then
      ok "Archivos subidos restaurados"
    else
      warn "No se pudieron restaurar los archivos subidos (logos, fotos)"
    fi
  fi
  rm -rf "$work"; trap - EXIT
  say ""
  ok "Listo. Las sesiones abiertas siguen siendo las del respaldo: si algo se ve raro, cierra sesión y vuelve a entrar."
}

# ---------- main ----------
case "$CMD" in
  "")
    if [ ! -f "$ENV_FILE" ]; then
      configure
    else
      load_env; pick_engine
      TRUST_PROXY=$(env_get TRUST_PROXY); TRUST_PROXY=${TRUST_PROXY:-2}
      SMTP_USER=$(env_get SMTP_USER); SMTP_PORT=$(env_get SMTP_PORT); SMTP_PASS=$(env_get SMTP_PASS)
      BILLING_SCHEDULER=$(env_get BILLING_SCHEDULER)
      DB_ROOT_PASSWORD=$(env_get DB_ROOT_PASSWORD); DB_PASSWORD=$(env_get DB_PASSWORD); JWT_ACCESS_SECRET=$(env_get JWT_ACCESS_SECRET)
      BACKUP_ENCRYPTION_KEY=$(env_get BACKUP_ENCRYPTION_KEY)
      show_summary; say ""
      if ask_yn "¿Cambiar algo de la configuración antes de desplegar?" n; then configure; fi
    fi
    load_env; pick_engine
    ask_yn "¿Desplegar ahora?" s || { say "Cuando quieras: ./deploy.sh up"; exit 0; }
    deploy ;;
  config) configure ;;
  up)     load_env; pick_engine; deploy ;;
  admin)  load_env; pick_engine; create_admin ;;
  demo)   load_env; pick_engine; load_demo ;;
  status) load_env; pick_engine; say "Código: BudoDesk $(app_version) ($(git describe --tags --always 2>/dev/null || echo 'sin git'))"; compose ps; if http_ok; then ok "API responde en el puerto $HTTP_PORT"; else warn "El API no responde en el puerto $HTTP_PORT"; fi ;;
  logs)   load_env; pick_engine; compose logs -f --tail 100 ${LOG_SVC:+"$LOG_SVC"} ;;
  restore) load_env; pick_engine; restore "$LOG_SVC" ;;
  stop)   load_env; pick_engine; compose down; ok "Contenedores apagados. Los datos siguen en los volúmenes." ;;
esac
