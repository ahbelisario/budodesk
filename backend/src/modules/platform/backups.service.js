/**
 * Respaldos de la plataforma (toda la base + archivos subidos).
 *
 * Archivo: budodesk-AAAA-MM-DD-HHMM.tar.gz  con  manifest.json, budodesk.sql, uploads/
 * - Se guardan en BACKUP_DIR y se ciclan: quedan los últimos `backup_keep` (1-10).
 * - Opcional: copia cifrada a S3 con su propio número a conservar (`s3_keep`).
 * - Restaurar NO se hace desde la app: ./deploy.sh restore ARCHIVO.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const tar = require('tar');
const env = require('../../config/env');
const { pool, one } = require('../../db/pool');
const { sendMail } = require('../../services/mailer');
const { AppError, badRequest, conflict, notFound } = require('../../utils/errors');
const { dumpDatabase } = require('./dump');
const cipher = require('./crypto');
const s3 = require('./s3');

const STALE_MINUTES = 120;
const LINK_SECONDS = 300;
const dir = () => path.resolve(env.BACKUP_DIR);
const uploadsDir = () => path.resolve(env.UPLOAD_DIR);

let current = null; // respaldo en curso en este proceso

// ---------------------------------------------------------------------------
// Fechas en la zona de la plataforma
// ---------------------------------------------------------------------------
function localParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(hour), minute: Number(p.minute), hhmm: `${hour}${p.minute}` };
}
const shiftDate = (d, days) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const pad = (n) => String(n).padStart(2, '0');

/** Último horario programado (hora local 'AAAA-MM-DD HH:00') que ya pasó */
function lastSlot(s, now = new Date()) {
  const l = localParts(now, s.timezone);
  let d = l.date;
  if (s.backup_frequency === 'weekly') {
    const back = (weekday(d) - s.backup_weekday + 7) % 7;
    d = shiftDate(d, -back);
    if (back === 0 && l.hour < s.backup_hour) d = shiftDate(d, -7);
  } else if (l.hour < s.backup_hour) {
    d = shiftDate(d, -1);
  }
  return `${d} ${pad(s.backup_hour)}:00`;
}

function toLocal(utc, tz) {
  const d = utc instanceof Date ? utc : new Date(`${String(utc).replace(' ', 'T')}Z`);
  const l = localParts(d, tz);
  return `${l.date} ${pad(l.hour)}:${pad(l.minute)}`;
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
async function getSettings(executor = pool) {
  const s = await one(executor, 'SELECT * FROM platform_settings WHERE id = 1');
  if (!s) throw new AppError(500, 'PLATFORM_NOT_READY', 'Faltan los ajustes de la plataforma');
  return s;
}

function publicSettings(s) {
  const { s3_secret_enc: secret, ...rest } = s;
  return {
    ...rest,
    backup_enabled: !!s.backup_enabled, s3_enabled: !!s.s3_enabled, s3_force_path_style: !!s.s3_force_path_style,
    s3_has_secret: !!secret,
    encryption_available: cipher.hasKey(),
    next_run: s.backup_enabled ? nextRunLocal(s) : null,
  };
}

/** Próxima ejecución programada (hora local) */
function nextRunLocal(s, now = new Date()) {
  const last = lastSlot(s, now);
  const [d, t] = last.split(' ');
  return `${shiftDate(d, s.backup_frequency === 'weekly' ? 7 : 1)} ${t}`;
}

async function updateSettings(patch, userId) {
  const s = await getSettings();
  const next = { ...s, ...patch };
  if (patch.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: patch.timezone }); } catch { throw badRequest('Zona horaria no válida'); }
  }
  let secretEnc = s.s3_secret_enc;
  if (patch.s3_secret) {
    if (!cipher.hasKey()) throw new AppError(409, 'NO_ENCRYPTION_KEY', 'Falta BACKUP_ENCRYPTION_KEY en el servidor: corre ./deploy.sh config');
    secretEnc = cipher.encryptText(patch.s3_secret);
  }
  if (next.s3_enabled) {
    if (!cipher.hasKey()) throw new AppError(409, 'NO_ENCRYPTION_KEY', 'Falta BACKUP_ENCRYPTION_KEY en el servidor: corre ./deploy.sh config');
    if (!next.s3_bucket || !next.s3_access_key || !secretEnc) throw badRequest('Para activar S3 llena el bucket y las dos llaves');
  }
  await pool.query(
    `UPDATE platform_settings SET timezone = :timezone, backup_enabled = :backup_enabled, backup_frequency = :backup_frequency,
            backup_hour = :backup_hour, backup_weekday = :backup_weekday, backup_keep = :backup_keep,
            s3_enabled = :s3_enabled, s3_endpoint = :s3_endpoint, s3_region = :s3_region, s3_bucket = :s3_bucket,
            s3_prefix = :s3_prefix, s3_access_key = :s3_access_key, s3_secret_enc = :secretEnc,
            s3_force_path_style = :s3_force_path_style, s3_keep = :s3_keep, updated_by = :userId
      WHERE id = 1`,
    {
      ...next,
      backup_enabled: next.backup_enabled ? 1 : 0, s3_enabled: next.s3_enabled ? 1 : 0,
      s3_force_path_style: next.s3_force_path_style ? 1 : 0,
      s3_endpoint: next.s3_endpoint || null, s3_region: next.s3_region || null, s3_bucket: next.s3_bucket || null,
      s3_prefix: next.s3_prefix || null, s3_access_key: next.s3_access_key || null, secretEnc, userId,
    });
  const after = await getSettings();
  // Si bajó el número a conservar, se aplica de una vez
  await rotateLocal(after.backup_keep);
  if (after.s3_enabled) await rotateS3(after).catch(() => {});
  return after;
}

function s3Config(s, override = {}) {
  const secret = override.s3_secret || (s.s3_secret_enc ? cipher.decryptText(s.s3_secret_enc) : null);
  return {
    endpoint: override.s3_endpoint ?? s.s3_endpoint, region: override.s3_region ?? s.s3_region,
    bucket: override.s3_bucket ?? s.s3_bucket, prefix: override.s3_prefix ?? s.s3_prefix,
    access_key: override.s3_access_key ?? s.s3_access_key, secret,
    force_path_style: override.s3_force_path_style ?? !!s.s3_force_path_style,
  };
}

async function testS3(override) {
  if (!cipher.hasKey()) throw new AppError(409, 'NO_ENCRYPTION_KEY', 'Falta BACKUP_ENCRYPTION_KEY en el servidor: corre ./deploy.sh config');
  const cfg = s3Config(await getSettings(), override);
  if (!cfg.bucket || !cfg.access_key || !cfg.secret) throw badRequest('Llena el bucket y las dos llaves');
  try {
    await s3.test(cfg);
  } catch (e) {
    throw new AppError(400, 'S3_ERROR', s3.describe(e));
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------
function exists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

async function listBackups() {
  const [rows] = await pool.query(
    `SELECT b.*, CONCAT_WS(' ', p.first_name, p.last_name) AS created_by_name
       FROM backups b LEFT JOIN user_profiles p ON p.user_id = b.created_by
      ORDER BY b.started_at DESC, b.id DESC LIMIT 60`);
  return rows.map((b) => ({
    ...b,
    local_available: b.status === 'ok' && !b.local_deleted_at && exists(path.join(dir(), b.filename)),
    s3_available: b.s3_status === 'ok',
  }));
}

async function getBackup(id) {
  const b = await one(pool, 'SELECT * FROM backups WHERE id = :id', { id });
  if (!b) throw notFound('Respaldo no encontrado');
  return b;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------
async function sha256File(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

async function countFiles(root) {
  let n = 0;
  async function walk(d) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) await walk(path.join(d, e.name));
      else if (e.isFile()) n += 1;
    }
  }
  await walk(root);
  return n;
}

async function markStale() {
  await pool.query(
    `UPDATE backups SET status = 'failed', finished_at = NOW(), error = 'Interrumpido (el servidor se reinició durante el respaldo)'
      WHERE status = 'running' AND started_at < NOW() - INTERVAL ${STALE_MINUTES} MINUTE`);
  await pool.query(
    `UPDATE backups SET s3_status = 'failed', s3_error = 'Interrumpido (el servidor se reinició durante la subida)'
      WHERE s3_status = 'uploading' AND started_at < NOW() - INTERVAL ${STALE_MINUTES} MINUTE`);
}

/**
 * Inicia un respaldo. Devuelve { backup, done } donde `done` es la promesa del trabajo
 * (la ruta responde de inmediato; las pruebas pueden esperar `done`).
 */
async function startBackup({ trigger, userId = null }) {
  if (current) throw conflict('Ya hay un respaldo en curso', 'BACKUP_RUNNING');
  await markStale();
  const running = await one(pool, "SELECT id FROM backups WHERE status = 'running'");
  if (running) throw conflict('Ya hay un respaldo en curso', 'BACKUP_RUNNING');

  const s = await getSettings();
  const l = localParts(new Date(), s.timezone);
  let filename = `budodesk-${l.date}-${l.hhmm}.tar.gz`;
  for (let i = 2; await one(pool, 'SELECT 1 AS x FROM backups WHERE filename = :f', { f: filename }); i += 1) {
    filename = `budodesk-${l.date}-${l.hhmm}-${i}.tar.gz`;
  }
  const [r] = await pool.query(
    `INSERT INTO backups (filename, \`trigger\`, status, started_at, created_by)
     VALUES (:filename, :trigger, 'running', NOW(), :userId)`, { filename, trigger, userId });
  const id = r.insertId;
  current = id;
  const done = work(id, filename, s).finally(() => { current = null; });
  return { backup: await getBackup(id), done };
}

async function work(id, filename, settings) {
  const base = dir();
  const tmp = path.join(base, `.tmp-${id}`);
  const final = path.join(base, filename);
  const partial = `${final}.partial`;
  try {
    await fsp.mkdir(base, { recursive: true, mode: 0o700 });
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true, mode: 0o700 });

    // 1) Base de datos
    const sqlOut = fs.createWriteStream(path.join(tmp, 'budodesk.sql'), { mode: 0o600 });
    const stats = await dumpDatabase(sqlOut);
    await new Promise((res, rej) => { sqlOut.on('error', rej); sqlOut.end(res); });

    // 2) Archivos subidos (enlace simbólico: tar lo sigue sin copiar)
    const entries = ['manifest.json', 'budodesk.sql'];
    let files = 0;
    if (exists(uploadsDir()) || fs.existsSync(uploadsDir())) {
      files = await countFiles(uploadsDir());
      await fsp.symlink(uploadsDir(), path.join(tmp, 'uploads'), 'dir');
      entries.push('uploads');
    }
    const manifest = {
      app: 'BudoDesk', format: 1, created_at: new Date().toISOString(), database: env.DB_NAME,
      tables: stats.tables, views: stats.views, rows: stats.rows, uploads_files: files,
    };
    await fsp.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    // 3) Empaquetar
    await tar.create({ gzip: { level: 6 }, file: partial, cwd: tmp, follow: true, portable: true, mode: 0o600 }, entries);
    await fsp.rename(partial, final);
    await fsp.chmod(final, 0o600).catch(() => {});
    const { size } = await fsp.stat(final);
    const sha = await sha256File(final);

    await pool.query(
      `UPDATE backups SET status = 'ok', finished_at = NOW(), size_bytes = :size, sha256 = :sha,
              tables_count = :tables, rows_count = :rows, files_count = :files WHERE id = :id`,
      { id, size, sha, tables: stats.tables, rows: stats.rows, files });

    // 4) Copia a S3 (si está activa)
    if (settings.s3_enabled && cipher.hasKey()) await uploadToS3(id, final, filename, settings);
    else if (settings.s3_enabled) {
      await pool.query(`UPDATE backups SET s3_status = 'failed', s3_error = 'Falta BACKUP_ENCRYPTION_KEY' WHERE id = :id`, { id });
    }

    // 5) Ciclar
    await rotateLocal(settings.backup_keep);
  } catch (e) {
    await pool.query(
      `UPDATE backups SET status = 'failed', finished_at = NOW(), error = :err WHERE id = :id`,
      { id, err: String(e.message || e).slice(0, 990) }).catch(() => {});
    await fsp.rm(partial, { force: true }).catch(() => {});
    notifyFailure(`El respaldo ${filename} falló: ${e.message || e}`);
    console.error('[respaldos] error:', e.message);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return getBackup(id);
}

async function uploadToS3(id, file, filename, settings) {
  const cfg = s3Config(settings);
  const key = s3.objectKey(cfg, `${filename}.enc`);
  const enc = `${file}.enc`;
  await pool.query(`UPDATE backups SET s3_status = 'uploading', s3_key = :key, s3_error = NULL WHERE id = :id`, { id, key });
  try {
    await cipher.encryptFile(file, enc);
    await s3.upload(cfg, key, enc);
    await pool.query(`UPDATE backups SET s3_status = 'ok', s3_uploaded_at = NOW() WHERE id = :id`, { id });
    await rotateS3(settings);
  } catch (e) {
    const msg = s3.describe(e);
    await pool.query(`UPDATE backups SET s3_status = 'failed', s3_error = :msg WHERE id = :id`, { id, msg });
    notifyFailure(`La copia de ${filename} a S3 falló: ${msg}`);
  } finally {
    await fsp.rm(enc, { force: true }).catch(() => {});
  }
}

/** Deja en el servidor solo los últimos `keep` respaldos */
async function rotateLocal(keep) {
  const [rows] = await pool.query(
    `SELECT id, filename FROM backups WHERE status = 'ok' AND local_deleted_at IS NULL
      ORDER BY started_at DESC, id DESC`);
  for (const b of rows.slice(keep)) {
    await fsp.rm(path.join(dir(), b.filename), { force: true });
    await pool.query('UPDATE backups SET local_deleted_at = NOW() WHERE id = :id', { id: b.id });
  }
}

/** Deja en S3 solo las últimas `s3_keep` copias */
async function rotateS3(settings) {
  const cfg = s3Config(settings);
  const [rows] = await pool.query(
    `SELECT id, s3_key FROM backups WHERE s3_status = 'ok' ORDER BY started_at DESC, id DESC`);
  for (const b of rows.slice(settings.s3_keep)) {
    try {
      await s3.remove(cfg, b.s3_key);
      await pool.query(`UPDATE backups SET s3_status = 'deleted' WHERE id = :id`, { id: b.id });
    } catch (e) {
      console.error('[respaldos] no se pudo borrar de S3:', s3.describe(e));
    }
  }
}

async function notifyFailure(message) {
  try {
    const [admins] = await pool.query(
      `SELECT u.email, COALESCE(s.language, 'es') AS lang FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
        WHERE u.is_superadmin = 1 AND u.status = 'active' AND u.deleted_at IS NULL AND u.email IS NOT NULL`);
    for (const a of admins) {
      await sendMail('notification', {
        to: a.email, lang: a.lang,
        vars: {
          dojo: 'BudoDesk', title: a.lang === 'en' ? 'Backup failed' : 'Falló un respaldo',
          body: message, url: `${env.APP_BASE_URL}/platform?tab=backups`,
        },
      });
    }
  } catch (e) {
    console.error('[respaldos] no se pudo avisar por correo:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Programación (se revisa cada 10 minutos)
// ---------------------------------------------------------------------------
async function isDue(s, now = new Date()) {
  if (!s.backup_enabled) return false;
  const slot = lastSlot(s, now);
  const last = await one(pool,
    "SELECT started_at FROM backups WHERE `trigger` = 'auto' ORDER BY started_at DESC LIMIT 1");
  return !last || toLocal(last.started_at, s.timezone) < slot;
}

async function tick(now = new Date()) {
  if (current) return null;
  const s = await getSettings();
  if (!(await isDue(s, now))) return null;
  const { done } = await startBackup({ trigger: 'auto' });
  return done;
}

function startScheduler() {
  markStale().catch(() => {});
  const run = () => tick().catch((e) => console.error('[respaldos] programación:', e.message));
  setTimeout(run, 30_000).unref();
  setInterval(run, 10 * 60 * 1000).unref();
}

// ---------------------------------------------------------------------------
// Descarga con enlace temporal (5 minutos)
// ---------------------------------------------------------------------------
const linkSecret = () => `${env.JWT_ACCESS_SECRET}:backup-download`;

async function issueLink(id, source) {
  const b = await getBackup(id);
  if (source === 's3') {
    if (b.s3_status !== 'ok') throw badRequest('Este respaldo no está en S3');
  } else if (!(b.status === 'ok' && !b.local_deleted_at && exists(path.join(dir(), b.filename)))) {
    throw badRequest('Este respaldo ya no está en el servidor');
  }
  const token = jwt.sign({ p: 'backup_dl', id, src: source }, linkSecret(), { expiresIn: LINK_SECONDS });
  return { url: `/api/v2/platform/backups/download?token=${encodeURIComponent(token)}`, expires_in: LINK_SECONDS };
}

function verifyLink(token) {
  try {
    const c = jwt.verify(token, linkSecret());
    if (c.p !== 'backup_dl') throw new Error();
    return c;
  } catch {
    throw new AppError(401, 'LINK_EXPIRED', 'El enlace de descarga venció o no es válido. Genera otro desde el panel.');
  }
}

async function openDownload(claims) {
  const b = await getBackup(claims.id);
  if (claims.src === 's3') {
    const cfg = s3Config(await getSettings());
    try {
      const { body, size } = await s3.download(cfg, b.s3_key);
      return { stream: body, size, filename: `${b.filename}.enc` };
    } catch (e) {
      throw new AppError(502, 'S3_ERROR', s3.describe(e));
    }
  }
  const file = path.join(dir(), b.filename);
  if (!exists(file)) throw notFound('Este respaldo ya no está en el servidor');
  return { stream: fs.createReadStream(file), size: fs.statSync(file).size, filename: b.filename };
}

module.exports = {
  getSettings, publicSettings, updateSettings, testS3, listBackups, getBackup, startBackup,
  tick, isDue, lastSlot, startScheduler, issueLink, verifyLink, openDownload, rotateLocal,
  isRunning: () => current !== null,
};
