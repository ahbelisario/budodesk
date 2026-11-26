/**
 * Web push (notificaciones del navegador / app instalada en la pantalla de inicio).
 *
 * Las llaves VAPID se generan solas la primera vez y se guardan en platform_settings,
 * así no hay nada que configurar. Si existen VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el
 * entorno, se usan esas. Si las llaves cambian, las suscripciones anteriores dejan de servir
 * y cada navegador se vuelve a suscribir la próxima vez que abre la app.
 */
const crypto = require('crypto');
const webpush = require('web-push');
const { pool } = require('../../db/pool');
const env = require('../../config/env');

let cached = null;

/** { publicKey, privateKey } */
async function vapidKeys() {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return cached;
  }
  await pool.query('INSERT IGNORE INTO platform_settings (id) VALUES (1)');
  const [[row]] = await pool.query('SELECT vapid_public_key, vapid_private_key FROM platform_settings WHERE id = 1');
  if (row?.vapid_public_key && row?.vapid_private_key) {
    cached = { publicKey: row.vapid_public_key, privateKey: row.vapid_private_key };
    return cached;
  }
  const k = webpush.generateVAPIDKeys();
  // Solo si nadie más las generó al mismo tiempo
  await pool.query(
    'UPDATE platform_settings SET vapid_public_key = :pub, vapid_private_key = :priv WHERE id = 1 AND vapid_public_key IS NULL',
    { pub: k.publicKey, priv: k.privateKey });
  const [[again]] = await pool.query('SELECT vapid_public_key, vapid_private_key FROM platform_settings WHERE id = 1');
  cached = { publicKey: again.vapid_public_key, privateKey: again.vapid_private_key };
  return cached;
}

/** Quién envía (lo exige el estándar): la URL pública si es https, si no un correo */
function subject() {
  if (/^https:\/\//.test(env.APP_BASE_URL)) return env.APP_BASE_URL.replace(/\/$/, '');
  const m = String(env.MAIL_FROM).match(/<([^>]+)>/);
  return `mailto:${m ? m[1] : 'no-reply@budodesk.com'}`;
}

const tokenFor = (endpoint) => `web:${crypto.createHash('sha256').update(endpoint).digest('hex')}`;

/** A dónde lleva cada aviso al tocarlo (igual que la bandeja de la app) */
function urlFor(data) {
  const d = typeof data === 'string' ? (() => { try { return JSON.parse(data); } catch { return null; } })() : data;
  switch (d?.screen) {
    case 'schedule': return d.session_id ? `/classes/${d.session_id}` : '/classes';
    case 'payments': return '/payments';
    case 'progress': return '/progress';
    case 'announcements': return '/announcements';
    default: return '/notifications';
  }
}

// En pruebas se reemplaza el envío para no salir a internet
let transport = (sub, payload, options) => webpush.sendNotification(sub, payload, options);
function setTransport(fn) { transport = fn; }

/**
 * Envía a varias suscripciones. Las que el servicio de push da por muertas (404/410) se borran.
 * Devuelve { sent, gone, failed, lastError }.
 */
async function sendToSubscriptions(rows, n) {
  const keys = await vapidKeys();
  const payload = JSON.stringify({
    title: n.title, body: n.body ?? '', url: n.url ?? urlFor(n.data), tag: n.tag ?? undefined,
  });
  const out = { sent: 0, gone: 0, failed: 0, lastError: null };
  for (const r of rows) {
    const sub = typeof r.subscription === 'string' ? JSON.parse(r.subscription) : r.subscription;
    if (!sub?.endpoint) continue;
    try {
      await transport(sub, payload, {
        TTL: 24 * 3600, urgency: 'normal',
        vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      });
      out.sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await pool.query('DELETE FROM push_tokens WHERE token = :t', { t: r.token });
        out.gone++;
      } else {
        out.failed++;
        out.lastError = e.statusCode ? `HTTP ${e.statusCode}: ${String(e.body || e.message).slice(0, 200)}` : e.message;
      }
    }
  }
  return out;
}

module.exports = { vapidKeys, tokenFor, urlFor, sendToSubscriptions, setTransport, subject };
