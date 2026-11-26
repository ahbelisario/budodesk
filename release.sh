#!/usr/bin/env bash
# =============================================================================
# BudoDesk · nueva versión
#
#   ./release.sh patch        1.0.8 → 1.0.9   (correcciones)
#   ./release.sh minor        1.0.8 → 1.1.0   (funciones nuevas)
#   ./release.sh major        1.0.8 → 2.0.0
#   ./release.sh 1.2.3        una versión exacta
#   ./release.sh patch -y     sin preguntar
#
# Actualiza VERSION, backend/frontend (package.json, package-lock.json) y la app
# (frontend/app.json); agrega la sección al CHANGELOG con los commits desde la
# versión anterior; hace el commit «Versión X.Y.Z» y la etiqueta vX.Y.Z.
# No sube nada: al final muestra el comando para hacer push.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "✗ $*" >&2; exit 1; }
[ $# -ge 1 ] || die "Uso: ./release.sh patch|minor|major|X.Y.Z [-y]"
BUMP="$1"; YES="${2:-}"
command -v node >/dev/null || die "Se necesita node para actualizar los package.json"
git rev-parse --git-dir >/dev/null 2>&1 || die "Esto no es un repositorio git"

CURRENT="$(tr -d ' \n' < VERSION)"
[[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "VERSION no tiene el formato X.Y.Z: '$CURRENT'"
MA=${BASH_REMATCH[1]}; MI=${BASH_REMATCH[2]}; PA=${BASH_REMATCH[3]}
case "$BUMP" in
  patch) NEW="$MA.$MI.$((PA + 1))" ;;
  minor) NEW="$MA.$((MI + 1)).0" ;;
  major) NEW="$((MA + 1)).0.0" ;;
  *) [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Versión inválida: $BUMP (usa patch, minor, major o X.Y.Z)"; NEW="$BUMP" ;;
esac
git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null && die "Ya existe la etiqueta v$NEW"

# Solo los archivos que va a tocar pueden tener cambios sin guardar (y la carpeta de salidas de Claude)
DIRTY="$(git status --porcelain --untracked-files=no | grep -v -E ' (VERSION|CHANGELOG\.md)$' || true)"
[ -z "$DIRTY" ] || die "Hay cambios sin commit; haz commit o guárdalos antes de crear la versión:
$DIRTY"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = main ] || echo "⚠ Estás en la rama '$BRANCH', no en main."

PREV_TAG="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
RANGE="${PREV_TAG:+$PREV_TAG..}HEAD"
COMMITS="$(git log --no-merges --pretty='- %s' $RANGE | grep -v -E '^- Versión [0-9]' || true)"

echo "Versión actual: $CURRENT   →   nueva: $NEW"
echo "Cambios desde ${PREV_TAG:-el inicio}:"
echo "${COMMITS:-  (ninguno)}"
if [ "$YES" != "-y" ]; then
  read -r -p "¿Crear la versión $NEW? [s/N] " ok
  [[ "$ok" =~ ^[sSyY]$ ]] || die "Cancelado"
fi

echo "$NEW" > VERSION
node - "$NEW" <<'JS'
const fs = require('fs');
const v = process.argv[2];
const edit = (file, fn) => {
  if (!fs.existsSync(file)) return;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(j);
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
};
for (const dir of ['backend', 'frontend']) {
  edit(`${dir}/package.json`, (j) => { j.version = v; });
  edit(`${dir}/package-lock.json`, (j) => { j.version = v; if (j.packages && j.packages['']) j.packages[''].version = v; });
}
edit('frontend/app.json', (j) => { j.expo.version = v; });
JS

TODAY="$(date +%Y-%m-%d)"
node - "$NEW" "$TODAY" "$COMMITS" <<'JS'
const fs = require('fs');
const [v, day, commits] = process.argv.slice(2);
const file = 'CHANGELOG.md';
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Cambios de BudoDesk\n';
const section = `## [${v}] - ${day}\n\n${commits || '- (sin cambios registrados)'}\n\n`;
const i = text.search(/^## \[/m);
fs.writeFileSync(file, i >= 0 ? text.slice(0, i) + section + text.slice(i) : `${text.trimEnd()}\n\n${section}`);
JS

git add VERSION CHANGELOG.md backend/package.json frontend/package.json frontend/app.json
[ -f backend/package-lock.json ] && git add backend/package-lock.json
[ -f frontend/package-lock.json ] && git add frontend/package-lock.json
git commit -q -m "Versión $NEW"
git tag -a "v$NEW" -m "Versión $NEW"

echo ""
echo "✓ Versión $NEW lista (commit y etiqueta v$NEW)."
echo "  Si quieres, edita CHANGELOG.md y corrige con: git commit --amend && git tag -f -a v$NEW -m \"Versión $NEW\""
echo "  Para subirla:   git push origin $BRANCH --follow-tags"
