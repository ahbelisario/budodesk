/**
 * Monitoreo de la plataforma
 *
 * Alertas (platform_alerts) con aviso por correo —a los correos configurados en Plataforma →
 * Monitoreo, o a los superadmins si no hay— y push a los superadmins (opcional).
 *
 *   raise()   abre una alerta, o si ya está abierta suma al contador. Avisa al abrirla y
 *             recuerda una vez al día mientras siga abierta.
 *   resolve() la cierra (sola, cuando el problema desaparece, o a mano desde el panel).
 *
 * Qué se vigila:
 *   - respaldos y copia a S3 (desde backups.service) y respaldo atrasado (> 48 h)
 *   - avisos de pago (webhooks) con error
 *   - correo: si el SMTP falla (esa alerta llega por push; por correo no podría)
 *   - tareas automáticas (desde el scheduler)
 *   - disco de respaldos y archivos
 *   - latido: llama cada 5 min a una URL externa (Healthchecks.io, UptimeRobot, Better Stack…)
 *     que avisa por su cuenta si el servidor deja de llamarla. Es lo único que detecta que el
 *     servidor está caído: desde dentro no se puede.
 */
const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const { pool, one } = require('../../db/pool');
const { badRequest, notFound } = require('../../utils/errors');
const { sendMail, setFailureHook } = require('../../services/mailer');
const { version } = require('../../../package.json');

const REMIND_HOURS = 24;
const STARTED_AT = new Date();
const state = { heartbeat: { at: null, ok: null, error: null }, lastSweep: null, webhookWatermark: null };

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
const splitEmails = (s) => String(s || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

async function getSettings(executor = pool) {
  const s = await one(executor,
    'SELECT alerts_emails, alerts_push, heartbeat_url, disk_alert_pct FROM platform_settings WHERE id = 1');
  return {
    alerts_emails: splitEmails(s?.alerts_emails),
    alerts_push: !!(s?.alerts_push ?? 1),
    heartbeat_url: s?.heartbeat_url || null,
    disk_alert_pct: s?.disk_alert_pct ?? 10,
  };
}

async function updateSettings(b, actorId) {
  const sets = [];
  const p = { by: actorId };
  if (b.alerts_emails !== undefined) {
    const list = [...new Set(splitEmails(b.alerts_emails))];
    const bad = list.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad.length) throw badRequest(`Correo no válido: ${bad.join(', ')}`);
    if (list.length > 10) throw badRequest('Máximo 10 correos');
    sets.push('alerts_emails = :emails'); p.emails = list.join(', ') || null;
  }
  if (b.alerts_push !== undefined) { sets.push('alerts_push = :push'); p.push = b.alerts_push ? 1 : 0; }
  if (b.heartbeat_url !== undefined) {
    if (b.heartbeat_url && !/^https:\/\//i.test(b.heartbeat_url)) throw badRequest('La dirección de latido debe empezar con https://');
    sets.push('heartbeat_url = :hb'); p.hb = b.heartbeat_url || null;
  }
  if (b.disk_alert_pct !== undefined) { sets.push('disk_alert_pct = :pct'); p.pct = b.disk_alert_pct; }
  if (sets.length) await pool.query(`UPDATE platform_settings SET ${sets.join(', ')}, updated_by = :by WHERE id = 1`, p);
  if (b.heartbeat_url !== undefined) heartbeat().catch(() => {});
  return getSettings();
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------
async function superadmins() {
  const [rows] = await pool.query(
    `SELECT u.id, u.email, COALESCE(s.language, 'es') AS lang FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.is_superadmin = 1 AND u.status = 'active' AND u.deleted_at IS NULL`);
  return rows;
}

/** Avisa por correo y push. Devuelve un texto de error si no llegó por ningún lado. */
async function notify(a, { reminder = false } = {}) {
  const s = await getSettings();
  const admins = await superadmins();
  const emails = s.alerts_emails.length ? s.alerts_emails : admins.map((x) => x.email).filter(Boolean);
  const url = new URL(a.url || '/platform?tab=monitoring', env.APP_BASE_URL).toString();
  const title = reminder ? `Sigue pendiente: ${a.title}` : a.title;
  const errors = [];
  let delivered = 0;
  for (const to of emails) {
    const r = await sendMail('platform_alert', {
      to, lang: 'es',
      vars: { dojo: 'BudoDesk', color: a.severity === 'critical' ? '#B91C1C' : '#B45309', title, detail: a.detail || '', url, count: a.count ?? 1 },
    });
    if (r.sent) delivered += 1; else if (r.error) errors.push(`correo a ${to}: ${r.error}`);
  }
  if (s.alerts_push && admins.length) {
    try {
      const [tokens] = await pool.query(
        'SELECT token, subscription FROM push_tokens WHERE subscription IS NOT NULL AND user_id IN (:ids)', { ids: admins.map((x) => x.id) });
      if (tokens.length) {
        const out = await require('../notifications/webpush.service').sendToSubscriptions(tokens, {
          title: `BudoDesk · ${title}`, body: (a.detail || '').slice(0, 180), url, tag: `alert-${a.kind}-${a.alert_key}`,
        });
        delivered += out.sent;
        if (out.failed) errors.push(`push: ${out.lastError}`);
      }
    } catch (e) { errors.push(`push: ${e.message}`); }
  }
  return delivered ? null : (errors.join(' · ') || 'No hay a quién avisar: configura un correo o activa el push');
}

/**
 * Abre o actualiza una alerta. key distingue alertas del mismo tipo (p. ej. el dojo o la tarea).
 * No lanza: el monitoreo nunca debe tumbar lo que vigila.
 */
async function raise({ kind, key = '', severity = 'warning', title, detail = null, url = null }) {
  try {
    const open = await one(pool,
      'SELECT * FROM platform_alerts WHERE kind = :kind AND alert_key = :key AND resolved_at IS NULL ORDER BY id DESC LIMIT 1',
      { kind, key });
    if (open) {
      await pool.query(
        `UPDATE platform_alerts SET count = count + 1, last_at = NOW(), detail = :detail, title = :title,
                severity = IF(:sev = 'critical', 'critical', severity) WHERE id = :id`,
        { id: open.id, detail, title, sev: severity });
      const due = !open.notified_at || Date.now() - new Date(open.notified_at).getTime() >= REMIND_HOURS * 3600e3;
      if (!due) return { id: open.id, notified: false };
      const err = await notify({ ...open, title, detail, count: open.count + 1 }, { reminder: true });
      await pool.query('UPDATE platform_alerts SET notified_at = NOW(), notify_error = :err WHERE id = :id', { id: open.id, err });
      return { id: open.id, notified: !err };
    }
    const [r] = await pool.query(
      `INSERT INTO platform_alerts (kind, alert_key, severity, title, detail, url) VALUES (:kind, :key, :severity, :title, :detail, :url)`,
      { kind, key, severity, title, detail, url });
    const err = await notify({ kind, alert_key: key, severity, title, detail, url });
    await pool.query('UPDATE platform_alerts SET notified_at = NOW(), notify_error = :err WHERE id = :id', { id: r.insertId, err });
    return { id: r.insertId, notified: !err };
  } catch (e) {
    console.error('[monitoreo] no se pudo registrar la alerta:', e.message);
    return null;
  }
}

/** Cierra las alertas abiertas de ese tipo (y clave, si se da). Devuelve cuántas cerró. */
async function resolve(kind, key = null, userId = null) {
  try {
    const [r] = await pool.query(
      `UPDATE platform_alerts SET resolved_at = NOW(), resolved_by = :by
        WHERE kind = :kind AND (:key IS NULL OR alert_key = :key) AND resolved_at IS NULL`, { kind, key, by: userId });
    return r.affectedRows;
  } catch (e) {
    console.error('[monitoreo] no se pudo resolver la alerta:', e.message);
    return 0;
  }
}

async function resolveById(id, userId) {
  const a = await one(pool, 'SELECT id FROM platform_alerts WHERE id = :id', { id });
  if (!a) throw notFound('Alerta no encontrada');
  await pool.query('UPDATE platform_alerts SET resolved_at = COALESCE(resolved_at, NOW()), resolved_by = COALESCE(resolved_by, :by) WHERE id = :id',
    { id, by: userId });
}

async function listAlerts({ status = 'open', limit = 100 } = {}) {
  const [rows] = await pool.query(
    `SELECT a.*, CONCAT_WS(' ', p.first_name, p.last_name) AS resolved_by_name
       FROM platform_alerts a LEFT JOIN user_profiles p ON p.user_id = a.resolved_by
      WHERE (:status = 'all' OR (:status = 'open') = (a.resolved_at IS NULL))
      ORDER BY a.resolved_at IS NULL DESC, a.last_at DESC LIMIT :limit`, { status, limit });
  return rows;
}

/** Alerta de prueba: avisa por los mismos canales y se cierra sola */
async function sendTest(userId) {
  const err = await notify({
    kind: 'test', alert_key: String(Date.now()), severity: 'warning',
    title: 'Alerta de prueba', detail: 'Si te llegó esto, las alertas de BudoDesk funcionan.', url: '/platform?tab=monitoring',
  });
  await pool.query(
    `INSERT INTO platform_alerts (kind, alert_key, title, detail, notified_at, notify_error, resolved_at, resolved_by)
     VALUES ('test', '', 'Alerta de prueba', 'Enviada desde el panel', NOW(), :err, NOW(), :by)`, { err, by: userId });
  return { ok: !err, error: err };
}

// ---------------------------------------------------------------------------
// Revisiones periódicas
// ---------------------------------------------------------------------------
async function diskInfo(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const st = await fs.promises.statfs(dir);
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    return { path: dir, total, free, free_pct: total ? Math.round((free / total) * 1000) / 10 : null };
  } catch (e) {
    return { path: dir, error: e.message };
  }
}

async function disks() {
  const dirs = { backups: path.resolve(env.BACKUP_DIR), uploads: path.resolve(env.UPLOAD_DIR) };
  const out = {};
  for (const [k, d] of Object.entries(dirs)) out[k] = await diskInfo(d);
  return out;
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;

async function checkDisks(settings) {
  for (const [k, d] of Object.entries(await disks())) {
    if (d.free_pct == null) continue;
    if (d.free_pct < settings.disk_alert_pct) {
      await raise({
        kind: 'disk', key: k, severity: d.free_pct < settings.disk_alert_pct / 2 ? 'critical' : 'warning',
        title: `Queda poco espacio en disco (${k === 'backups' ? 'respaldos' : 'archivos'})`,
        detail: `${d.path}: ${gb(d.free)} libres de ${gb(d.total)} (${d.free_pct} %). Si se llena, fallan los respaldos y las fotos.`,
      });
    } else {
      await resolve('disk', k);
    }
  }
}

/** Avisos de pago con error desde la última revisión, agrupados por dojo y proveedor */
async function checkWebhooks() {
  if (state.webhookWatermark == null) {
    const [[m]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS id FROM payment_webhook_events');
    state.webhookWatermark = m.id; // al arrancar no se repasa la historia
    return;
  }
  const [rows] = await pool.query(
    `SELECT e.dojo_id, e.provider, COUNT(*) AS n, MAX(e.id) AS last_id,
            SUBSTRING_INDEX(GROUP_CONCAT(e.error ORDER BY e.id DESC SEPARATOR '\\n'), '\\n', 1) AS last_error,
            d.name AS dojo_name, d.slug
       FROM payment_webhook_events e LEFT JOIN dojos d ON d.id = e.dojo_id
      WHERE e.id > :w AND e.error IS NOT NULL
      GROUP BY e.dojo_id, e.provider, d.name, d.slug`, { w: state.webhookWatermark });
  const [[m]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS id FROM payment_webhook_events');
  state.webhookWatermark = m.id;
  for (const r of rows) {
    const provider = r.provider === 'paypal' ? 'PayPal' : 'Mercado Pago';
    await raise({
      kind: 'webhook', key: `${r.provider}:${r.dojo_id ?? 0}`, severity: 'warning',
      title: `Fallan avisos de ${provider}${r.dojo_name ? ` en ${r.dojo_name}` : ''}`,
      detail: `${r.n} aviso(s) con error. El último: ${r.last_error}. Los pagos se confirman igual cuando el alumno regresa a la app; revisa las credenciales y la dirección del webhook.`,
    });
  }
}

/** Respaldos automáticos activos pero sin uno bueno en 48 h */
async function checkBackupAge() {
  const s = await one(pool, 'SELECT backup_enabled FROM platform_settings WHERE id = 1');
  if (!s?.backup_enabled) { await resolve('backup_stale'); return; }
  const last = await one(pool,
    "SELECT finished_at FROM backups WHERE status = 'ok' ORDER BY finished_at DESC LIMIT 1");
  const age = last ? (Date.now() - new Date(last.finished_at).getTime()) / 3600e3 : Infinity;
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM backups');
  if (age > 48 && n > 0) {
    await raise({
      kind: 'backup_stale', severity: 'critical', url: '/platform?tab=backups',
      title: 'No hay un respaldo reciente',
      detail: last ? `El último respaldo bueno terminó hace ${Math.round(age)} horas.` : 'No hay ningún respaldo bueno.',
    });
  } else {
    await resolve('backup_stale');
  }
}

/** Latido: llamar a la URL externa. Si falla aquí no se alerta: el servicio externo es quien avisa. */
async function heartbeat() {
  const { heartbeat_url: url } = await getSettings();
  if (!url) { state.heartbeat = { at: null, ok: null, error: null }; return state.heartbeat; }
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    state.heartbeat = { at: new Date(), ok: r.ok, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    state.heartbeat = { at: new Date(), ok: false, error: e.cause?.code || e.message };
  }
  return state.heartbeat;
}

async function sweep() {
  const settings = await getSettings();
  await checkDisks(settings);
  await checkWebhooks();
  await checkBackupAge();
  state.lastSweep = new Date();
}

// ---------------------------------------------------------------------------
// Correo: si el SMTP falla, alerta (por push); al volver a funcionar, se resuelve sola
// ---------------------------------------------------------------------------
setFailureHook(({ template, to, error, ok }) => {
  if (template === 'platform_alert') return; // no alertar sobre las propias alertas (evita el bucle)
  if (ok) { resolve('mail').catch(() => {}); return; }
  raise({
    kind: 'mail', severity: 'critical',
    title: 'No se pueden enviar correos',
    detail: `Falló el envío a ${to}: ${error}. Revisa SMTP_HOST, SMTP_USER y SMTP_PASS en el .env del servidor.`,
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Estado para el panel
// ---------------------------------------------------------------------------
async function status() {
  const [[open]] = await pool.query('SELECT COUNT(*) AS n FROM platform_alerts WHERE resolved_at IS NULL');
  const lastBackup = await one(pool,
    "SELECT finished_at, status FROM backups WHERE status IN ('ok','failed') ORDER BY started_at DESC LIMIT 1");
  return {
    version, started_at: STARTED_AT, open_alerts: open.n, last_sweep: state.lastSweep,
    heartbeat: state.heartbeat, disks: await disks(), last_backup: lastBackup || null,
    smtp_configured: !!env.SMTP_HOST,
  };
}

function startScheduler() {
  const run = () => sweep().catch((e) => console.error('[monitoreo] revisión:', e.message));
  const beat = () => heartbeat().catch(() => {});
  setTimeout(run, 45_000).unref();
  setTimeout(beat, 15_000).unref();
  setInterval(run, 10 * 60 * 1000).unref();
  setInterval(beat, 5 * 60 * 1000).unref();
}

module.exports = {
  getSettings, updateSettings, raise, resolve, resolveById, listAlerts, sendTest, sweep, heartbeat, status,
  startScheduler, splitEmails, _state: state,
};
