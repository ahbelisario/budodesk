/**
 * Migraciones de esquema.
 *
 *  - Viven en backend/migrations/ con nombre NNNN_descripcion.sql o NNNN_descripcion.js
 *    (cuatro dígitos, en orden). Un .js exporta `async up(db, h)`; `h` trae ayudas para
 *    revisar antes de cambiar (tableExists, columnExists, indexExists, addColumnIfMissing…).
 *  - La tabla schema_migrations guarda cuáles ya corrieron, con la huella (sha256) del archivo.
 *  - Al arrancar el backend se aplican las pendientes, en orden y con un candado (GET_LOCK)
 *    para que nunca corran dos a la vez. Antes de aplicar, si la base tiene datos, se hace
 *    un respaldo de la base en BACKUP_DIR (antes-de-migrar-*.sql.gz).
 *  - Si una falla, se detiene: no se registra y el backend no arranca a medias. MySQL no puede
 *    deshacer cambios de estructura (ALTER/CREATE), por eso cada migración debe ser pequeña.
 *  - Nunca se edita una migración ya aplicada: se agrega otra. Si cambia una aplicada, se avisa.
 *
 * db/schema/01-schema.sql es la línea base (versión 1.0.8) y ya no se modifica.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const mysql = require('mysql2/promise');
// La configuración se carga solo cuando hace falta (en pruebas se pasa la conexión directo)
const env = () => require('../config/env');

const DIR = path.join(__dirname, '..', '..', 'migrations');
const NAME = /^(\d{4})_([a-z0-9_]+)\.(sql|js)$/;
const LOCK = 'budodesk_schema_migrations';
const KEEP_PRE_BACKUPS = 5;

function log(quiet, ...a) { if (!quiet) console.log('[migraciones]', ...a); }

/** Lista de migraciones del directorio, validadas y en orden */
function listMigrations(dir = DIR) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.') && /\.(sql|js)$/.test(f)).sort();
  const seen = new Map();
  return files.map((file) => {
    const m = file.match(NAME);
    if (!m) throw new Error(`Nombre de migración inválido: ${file} (usa NNNN_descripcion.sql o .js, en minúsculas)`);
    if (seen.has(m[1])) throw new Error(`Dos migraciones con el número ${m[1]}: ${seen.get(m[1])} y ${file}`);
    seen.set(m[1], file);
    const full = path.join(dir, file);
    const content = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    return {
      version: file.replace(/\.(sql|js)$/, ''), file, full, kind: m[3],
      checksum: crypto.createHash('sha256').update(content).digest('hex'), content,
    };
  });
}

/** Conexión propia (varias sentencias por archivo). `db` opcional: { host, port, user, password, database, socketPath } */
function connect(db) {
  const c = db || (({ DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME }) => ({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    socketPath: process.env.TEST_DB_SOCKET || undefined,
  }))(env());
  return mysql.createConnection({ ...c, multipleStatements: true, timezone: 'Z', charset: 'utf8mb4', dateStrings: true });
}

async function ensureTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
    \`version\`     VARCHAR(120) NOT NULL COMMENT 'nombre del archivo sin extensión',
    \`checksum\`    CHAR(64) NOT NULL COMMENT 'sha256 del archivo al aplicarlo',
    \`app_version\` VARCHAR(20) NULL COMMENT 'versión de BudoDesk que la aplicó',
    \`duration_ms\` INT UNSIGNED NULL,
    \`applied_at\`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`version\`)
  ) ENGINE=InnoDB`);
}

/** Ayudas para migraciones .js: revisar antes de cambiar */
function helpers(conn) {
  const one = async (sql, p) => (await conn.query(sql, p))[0][0];
  const h = {
    query: (sql, p) => conn.query(sql, p),
    tableExists: async (t) => !!(await one(
      'SELECT 1 AS x FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t])),
    columnExists: async (t, c) => !!(await one(
      'SELECT 1 AS x FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c])),
    indexExists: async (t, i) => !!(await one(
      'SELECT 1 AS x FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [t, i])),
    /** ADD COLUMN solo si falta. `definition` es todo lo que va después del nombre (tipo, NULL, DEFAULT, COMMENT, AFTER…) */
    async addColumnIfMissing(t, c, definition) {
      if (await h.columnExists(t, c)) return false;
      await conn.query(`ALTER TABLE \`${t}\` ADD COLUMN \`${c}\` ${definition}`);
      return true;
    },
  };
  return h;
}

/** Respaldo de la base antes de migrar (solo la base: las migraciones no tocan archivos) */
async function preMigrationBackup(pending, quiet) {
  const { dumpDatabase } = require('../modules/platform/dump');
  const dir = env().BACKUP_DIR;
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const file = path.join(dir, `antes-de-migrar-${stamp}-${pending[0].version.slice(0, 4)}.sql.gz`);
  const gz = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(`${file}.partial`, { mode: 0o600 });
  gz.pipe(out);
  const done = new Promise((res, rej) => { out.on('finish', res); out.on('error', rej); gz.on('error', rej); });
  await dumpDatabase(gz);
  gz.end();
  await done;
  await fsp.rename(`${file}.partial`, file);
  // Se guardan los últimos KEEP_PRE_BACKUPS
  const old = (await fsp.readdir(dir)).filter((f) => /^antes-de-migrar-.*\.sql\.gz$/.test(f)).sort().reverse().slice(KEEP_PRE_BACKUPS);
  for (const f of old) await fsp.rm(path.join(dir, f), { force: true });
  log(quiet, `respaldo previo: ${path.basename(file)}`);
  return file;
}

/** Estado: aplicadas, pendientes y las que cambiaron después de aplicarse */
async function status({ dir = DIR, conn: given, db } = {}) {
  const conn = given || await connect(db);
  try {
    await ensureTable(conn);
    const files = listMigrations(dir);
    const [rows] = await conn.query('SELECT version, checksum, app_version, applied_at FROM schema_migrations ORDER BY version');
    const applied = new Map(rows.map((r) => [r.version, r]));
    return {
      applied: rows,
      pending: files.filter((f) => !applied.has(f.version)).map((f) => f.version),
      changed: files.filter((f) => applied.has(f.version) && applied.get(f.version).checksum !== f.checksum).map((f) => f.version),
      missing: rows.filter((r) => !files.some((f) => f.version === r.version)).map((r) => r.version),
    };
  } finally {
    if (!given) await conn.end();
  }
}

/**
 * Aplica las pendientes. Devuelve { applied: [versiones], backup: archivo|null }.
 * Opciones: dir (pruebas), backup (default true), quiet, db (conexión explícita; si no, la del .env).
 */
async function migrate({ dir = DIR, backup = true, quiet = false, db } = {}) {
  const files = listMigrations(dir);
  const conn = await connect(db);
  try {
    const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 120) AS got', [LOCK]);
    if (got !== 1) throw new Error('Otra instancia está aplicando migraciones (no se obtuvo el candado en 2 minutos)');
    try {
      await ensureTable(conn);
      const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations');
      const applied = new Map(rows.map((r) => [r.version, r.checksum]));
      for (const f of files) {
        if (applied.has(f.version) && applied.get(f.version) !== f.checksum) {
          console.warn(`[migraciones] ⚠ ${f.file} cambió después de aplicarse; no se vuelve a correr. No edites migraciones aplicadas: agrega una nueva.`);
        }
      }
      const pending = files.filter((f) => !applied.has(f.version));
      if (!pending.length) { log(quiet, `esquema al día (${applied.size} aplicadas)`); return { applied: [], backup: null }; }

      let backupFile = null;
      if (backup) {
        const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dojos'");
        const hasData = Number(n) > 0 && Number((await conn.query('SELECT COUNT(*) AS n FROM dojos'))[0][0].n) > 0;
        if (hasData) backupFile = await preMigrationBackup(pending, quiet);
      }

      const { version: appVersion } = require('../../package.json');
      const done = [];
      for (const f of pending) {
        const t0 = Date.now();
        log(quiet, `aplicando ${f.file}…`);
        try {
          if (f.kind === 'sql') {
            if (f.content.trim()) await conn.query(f.content);
          } else {
            const mod = require(f.full);
            if (typeof mod.up !== 'function') throw new Error('la migración .js debe exportar async up(db, h)');
            await mod.up(conn, helpers(conn));
          }
        } catch (e) {
          const err = new Error(`La migración ${f.file} falló: ${e.message}${backupFile ? ` · Respaldo previo: ${path.basename(backupFile)}` : ''}`);
          err.migration = f.version;
          throw err;
        }
        await conn.query(
          'INSERT INTO schema_migrations (version, checksum, app_version, duration_ms) VALUES (?, ?, ?, ?)',
          [f.version, f.checksum, appVersion, Date.now() - t0]);
        done.push(f.version);
        log(quiet, `✔ ${f.file} (${Date.now() - t0} ms)`);
      }
      return { applied: done, backup: backupFile };
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {});
    }
  } finally {
    await conn.end();
  }
}

module.exports = { migrate, status, listMigrations, helpers, DIR };
