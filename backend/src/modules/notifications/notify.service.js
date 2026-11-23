/**
 * Notificaciones: bandeja in-app + cola de envío (push con Expo, email).
 *
 * notify(dojoId, userIds, { type, title, body, data, pref })
 *   pref = columna de user_settings que la habilita (notify_class_reminders…)
 * La cola la procesa processDeliveries() (cada minuto desde el scheduler).
 */
const { pool } = require('../../db/pool');
const { sendMail } = require('../../services/mailer');
const env = require('../../config/env');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PREFS = new Set(['notify_class_reminders', 'notify_payment_reminders', 'notify_announcements']);

async function notify(dojoId, userIds, { type, title, body, data, pref, channels = ['push', 'email'] }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return 0;
  const prefCol = PREFS.has(pref) ? pref : null;
  const [users] = await pool.query(
    `SELECT u.id, u.email, COALESCE(s.notify_push, 1) AS push, COALESCE(s.notify_email, 1) AS email,
            ${prefCol ? `COALESCE(s.${prefCol}, 1)` : '1'} AS wants
       FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.id IN (:ids) AND u.deleted_at IS NULL`, { ids });

  let count = 0;
  for (const u of users) {
    const [r] = await pool.query(
      `INSERT INTO notifications (dojo_id, user_id, type, title, body, data) VALUES (:d, :u, :type, :title, :body, :data)`,
      { d: dojoId ?? null, u: u.id, type, title, body: body ?? null, data: data ? JSON.stringify(data) : null });
    count++;
    if (!u.wants) continue;
    if (channels.includes('push') && u.push) {
      await pool.query(`INSERT INTO notification_deliveries (notification_id, channel, next_attempt_at) VALUES (:n, 'push', NOW())`, { n: r.insertId });
    }
    if (channels.includes('email') && u.email && u.email) {
      await pool.query(`INSERT INTO notification_deliveries (notification_id, channel, next_attempt_at) VALUES (:n, 'email', NOW())`, { n: r.insertId });
    }
  }
  return count;
}

async function sendPush(tokens, n) {
  if (!tokens.length) return { skipped: true };
  if (env.NODE_ENV === 'test') return { ok: true };
  const messages = tokens.map((to) => ({ to, title: n.title, body: n.body ?? '', data: n.data ?? {}, sound: 'default' }));
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
  const json = await res.json();
  // Tokens inválidos → se eliminan
  const bad = (json.data || []).map((d, i) => (d.status === 'error' && d.details?.error === 'DeviceNotRegistered' ? tokens[i] : null)).filter(Boolean);
  if (bad.length) await pool.query('DELETE FROM push_tokens WHERE token IN (:bad)', { bad });
  return { ok: true };
}

/** Procesa la cola (hasta `limit` envíos). Reintenta con espera creciente, máx. 5 intentos. */
async function processDeliveries({ limit = 100 } = {}) {
  const [rows] = await pool.query(
    `SELECT d.id, d.channel, d.attempts, n.user_id, n.title, n.body, n.data, n.dojo_id, u.email,
            COALESCE(s.language, 'es') AS lang, COALESCE(dj.short_name, dj.name, 'BudoDesk') AS dojo, dj.color_primary AS color
       FROM notification_deliveries d
       JOIN notifications n ON n.id = d.notification_id
       JOIN users u ON u.id = n.user_id
       LEFT JOIN user_settings s ON s.user_id = u.id
       LEFT JOIN dojos dj ON dj.id = n.dojo_id
      WHERE d.status = 'queued' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
      ORDER BY d.id LIMIT :limit`, { limit });

  let sent = 0;
  for (const d of rows) {
    try {
      if (d.channel === 'push') {
        const [tokens] = await pool.query('SELECT token FROM push_tokens WHERE user_id = :u', { u: d.user_id });
        const r = await sendPush(tokens.map((t) => t.token), d);
        await pool.query(`UPDATE notification_deliveries SET status = :st, sent_at = NOW(), attempts = attempts + 1 WHERE id = :id`,
          { st: r.skipped ? 'skipped' : 'sent', id: d.id });
      } else {
        const r = await sendMail('notification', { to: d.email, lang: d.lang, vars: { dojo: d.dojo, color: d.color, title: d.title, body: d.body ?? '' } });
        if (r.sent === false) throw new Error(r.error);
        await pool.query(`UPDATE notification_deliveries SET status = :st, sent_at = NOW(), attempts = attempts + 1 WHERE id = :id`,
          { st: r.skipped ? 'skipped' : 'sent', id: d.id });
      }
      sent++;
    } catch (e) {
      const attempts = d.attempts + 1;
      await pool.query(
        `UPDATE notification_deliveries SET attempts = :a, error = :err,
                status = IF(:a >= 5, 'failed', 'queued'), next_attempt_at = NOW() + INTERVAL POW(2, :a) MINUTE
          WHERE id = :id`, { a: attempts, err: String(e.message).slice(0, 500), id: d.id });
    }
  }
  return sent;
}

/**
 * Recordatorios de pago (una vez por cargo y tipo):
 *  - payment_due: vence en 3 días
 *  - payment_overdue: venció hace 1 día
 */
async function paymentReminders(dojoId, today, { addDays }) {
  const out = { due: 0, overdue: 0 };
  for (const [type, dateExpr, title] of [
    ['payment_due', addDays(today, 3), 'Tu pago vence pronto'],
    ['payment_overdue', addDays(today, -1), 'Tienes un pago vencido'],
  ]) {
    const [rows] = await pool.query(
      `SELECT c.id, c.user_id, c.description, c.total - c.amount_paid AS balance, c.currency, c.due_date
         FROM charges c
        WHERE c.dojo_id = :d AND c.status IN ('pending','partial') AND c.due_date = :dt
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = c.user_id AND n.type = :type
                           AND JSON_EXTRACT(n.data, '$.charge_id') = c.id)`, { d: dojoId, dt: dateExpr, type });
    for (const c of rows) {
      await notify(dojoId, [c.user_id], {
        type, title, pref: 'notify_payment_reminders',
        body: `${c.description}: $${Number(c.balance).toFixed(2)} ${c.currency} (vence ${c.due_date})`,
        data: { screen: 'payments', charge_id: c.id },
      });
      out[type === 'payment_due' ? 'due' : 'overdue']++;
    }
  }
  return out;
}

module.exports = { notify, processDeliveries, paymentReminders };
