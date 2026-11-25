/**
 * Pagos en línea (PayPal y Mercado Pago).
 *
 * 1. checkout: el alumno/tutor elige cargos pendientes → se crea un `online_checkouts`
 *    y la orden/preferencia en el proveedor → la app abre el enlace para pagar.
 * 2. confirmación: al regresar a la app (confirm) o por el aviso del proveedor (webhook).
 *    `complete()` es idempotente: bloquea el checkout y solo registra el pago una vez.
 * 3. el pago se registra como cualquier otro (`payments` + aplicaciones a los cargos);
 *    si se cobró comisión al alumno, se crea un cargo "Comisión de pago en línea".
 */
const env = require('../../config/env');
const { pool } = require('../../db/pool');
const { tenantDb } = require('../../db/tenant');
const { AppError, badRequest, conflict, notFound } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const { todayIn } = require('../../utils/dates');
const cipher = require('../platform/crypto');
const billing = require('../billing/charges.service');
const { notify } = require('../notifications/notify.service');
const paypal = require('./paypal');
const mercadopago = require('./mercadopago');

const NAMES = { paypal: 'PayPal', mercadopago: 'Mercado Pago' };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Configuración por dojo
// ---------------------------------------------------------------------------
async function loadSettings(dojoId) {
  const [[s]] = await pool.query(
    `SELECT s.*, d.currency, d.timezone, d.language, d.slug, COALESCE(d.short_name, d.name) AS dojo_name
       FROM dojos d LEFT JOIN dojo_payment_settings s ON s.dojo_id = d.id WHERE d.id = :dojoId`, { dojoId });
  if (!s) throw notFound('Dojo no encontrado');
  return s;
}

const dec = (v) => (v ? cipher.decryptText(String(v)) : null);

function providerConfig(s, provider) {
  if (provider === 'paypal') {
    return { mode: s.paypal_mode || 'sandbox', clientId: s.paypal_client_id, secret: dec(s.paypal_secret_enc), webhookId: s.paypal_webhook_id };
  }
  return { mode: s.mp_mode || 'test', publicKey: s.mp_public_key, accessToken: dec(s.mp_access_token_enc), webhookSecret: dec(s.mp_webhook_secret_enc) };
}

function isReady(s, provider) {
  if (provider === 'paypal') return !!(s.paypal_enabled && s.paypal_client_id && s.paypal_secret_enc);
  return !!(s.mp_enabled && s.mp_access_token_enc);
}

function feeConfig(s, provider) {
  const p = provider === 'paypal' ? 'paypal' : 'mp';
  return { percent: Number(s[`${p}_fee_percent`] || 0), fixed: Number(s[`${p}_fee_fixed`] || 0) };
}

/**
 * Comisión que paga el alumno para que al dojo le llegue completo el subtotal:
 *   total = (subtotal + fija) / (1 − %/100)
 */
function computeFee(subtotal, { percent, fixed }) {
  if (!percent && !fixed) return 0;
  const total = (subtotal + fixed) / (1 - Math.min(percent, 50) / 100);
  return round2(total - subtotal);
}

/** Métodos disponibles para el alumno */
async function options(dojoId) {
  const s = await loadSettings(dojoId);
  return ['paypal', 'mercadopago'].filter((p) => isReady(s, p)).map((p) => ({
    provider: p, name: NAMES[p], test_mode: p === 'paypal' ? s.paypal_mode !== 'live' : s.mp_mode !== 'live', fee: feeConfig(s, p),
  }));
}

// ---------------------------------------------------------------------------
// URLs de regreso
// ---------------------------------------------------------------------------
/** Acepta como regreso: el dominio de la app (y sus subdominios), los CORS_ORIGINS y el esquema de la app nativa */
function safeReturnBase(requested) {
  const fallback = env.APP_BASE_URL.replace(/\/$/, '');
  if (!requested) return fallback;
  if (/^budodesk:\/\//.test(String(requested))) return 'budodesk://';
  const r = String(requested).replace(/\/$/, '');
  let u;
  try { u = new URL(r); } catch { return fallback; }
  const app = new URL(fallback);
  const parent = app.hostname.split('.').slice(-2).join('.');
  const allowed = u.hostname === app.hostname || u.hostname.endsWith(`.${parent}`)
    || env.CORS_ORIGINS.split(',').map((x) => x.trim()).filter(Boolean).includes(u.origin)
    || (env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(u.hostname));
  return allowed ? u.origin : fallback;
}

function returnUrls(baseUrl, checkoutId, provider) {
  const path = baseUrl === 'budodesk://' ? 'budodesk://pay/return' : `${baseUrl}/pay/return`;
  const q = (extra) => `${path}?checkout=${checkoutId}&provider=${provider}${extra}`;
  return { success: q(''), cancel: q('&cancelled=1'), failure: q('&failed=1'), pending: q('&pending=1') };
}

const webhookUrl = (provider, dojoId) => `${env.APP_BASE_URL.replace(/\/$/, '')}/api/v2/online-payments/webhooks/${provider}/${dojoId}`;

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------
async function createCheckout(tdb, { dojoId, userId, createdBy, provider, chargeIds, returnBase, payerEmail }) {
  const s = await loadSettings(dojoId);
  if (!isReady(s, provider)) throw new AppError(409, 'PROVIDER_DISABLED', `${NAMES[provider]} no está activo en este dojo`);
  if (!cipher.hasKey()) throw new AppError(409, 'NO_ENCRYPTION_KEY', 'Falta BACKUP_ENCRYPTION_KEY en el servidor');

  const ids = [...new Set(chargeIds.map(Number))];
  const rows = await tdb.query(
    `SELECT id, description, total - amount_paid AS open, currency FROM charges
      WHERE dojo_id = :dojoId AND user_id = :userId AND id IN (:ids) AND status IN ('pending','partial')`,
    { userId, ids });
  if (rows.length !== ids.length) throw badRequest('Algún cargo ya no está pendiente o no es tuyo. Actualiza la pantalla.');
  if (rows.some((r) => r.currency !== s.currency)) throw badRequest('La moneda de un cargo no coincide con la del dojo');
  const subtotal = round2(rows.reduce((sum, r) => sum + Number(r.open), 0));
  if (subtotal <= 0) throw badRequest('No hay nada que pagar');
  const fee = computeFee(subtotal, feeConfig(s, provider));
  const total = round2(subtotal + fee);
  const cfg = providerConfig(s, provider);

  const r = await tdb.query(
    `INSERT INTO online_checkouts (dojo_id, user_id, created_by, provider, mode, currency, subtotal, fee, total, charge_ids)
     VALUES (:dojoId, :userId, :createdBy, :provider, :mode, :currency, :subtotal, :fee, :total, :charges)`,
    { userId, createdBy, provider, mode: cfg.mode, currency: s.currency, subtotal, fee, total, charges: JSON.stringify(ids) });
  const checkoutId = r.insertId;
  const urls = returnUrls(safeReturnBase(returnBase), checkoutId, provider);
  const description = rows.length === 1 ? `${s.dojo_name}: ${rows[0].description}` : `${s.dojo_name}: ${rows.length} pagos`;

  try {
    let ref; let redirectUrl;
    if (provider === 'paypal') {
      const o = await paypal.createOrder(cfg, {
        checkoutId, dojoId, amount: total, currency: s.currency, description, returnUrl: urls.success, cancelUrl: urls.cancel,
        brand: s.dojo_name, locale: s.language === 'en' ? 'en-US' : 'es-MX',
      });
      ref = o.id; redirectUrl = o.approveUrl;
    } else {
      const p = await mercadopago.createPreference(cfg, {
        checkoutId, dojoId, amount: total, currency: s.currency, description,
        backUrls: { success: urls.success, failure: urls.failure, pending: urls.pending },
        notificationUrl: /^https:\/\//.test(env.APP_BASE_URL) ? webhookUrl('mercadopago', dojoId) : null,
        payerEmail,
      });
      ref = p.id; redirectUrl = p.checkoutUrl;
    }
    await tdb.query('UPDATE online_checkouts SET provider_ref = :ref WHERE dojo_id = :dojoId AND id = :id', { ref, id: checkoutId });
    return { checkout_id: checkoutId, provider, redirect_url: redirectUrl, subtotal, fee, total, currency: s.currency, test_mode: !['live'].includes(cfg.mode) };
  } catch (e) {
    await tdb.query("UPDATE online_checkouts SET status = 'failed', error = :err WHERE dojo_id = :dojoId AND id = :id",
      { id: checkoutId, err: String(e.message).slice(0, 490) });
    throw new AppError(502, 'PROVIDER_ERROR', e.message || `No se pudo iniciar el pago con ${NAMES[provider]}`);
  }
}

// ---------------------------------------------------------------------------
// Completar (idempotente)
// ---------------------------------------------------------------------------
/**
 * info: { amount, currency, fee, orderId, captureId, paymentRef, paidAt }
 * Devuelve el checkout actualizado.
 */
async function complete(dojoId, checkoutId, info, { via }) {
  const tdb = tenantDb(dojoId);
  const result = await tdb.transaction(async (t) => {
    const c = await t.one('SELECT * FROM online_checkouts WHERE dojo_id = :dojoId AND id = :id FOR UPDATE', { id: checkoutId });
    if (!c) throw notFound('Pago en línea no encontrado');
    if (c.status === 'completed') return { checkout: c, created: false };
    if (Math.abs(Number(info.amount) - Number(c.total)) > 0.01 || info.currency !== c.currency) {
      return { mismatch: `El monto confirmado (${info.amount} ${info.currency}) no coincide con el esperado (${c.total} ${c.currency})`, checkout: c };
    }

    const s = await loadSettings(dojoId);
    const ids = typeof c.charge_ids === 'string' ? JSON.parse(c.charge_ids) : [...c.charge_ids];

    // 1) Cargo de comisión ANTES del pago (createCharge aplica de inmediato cualquier saldo a favor)
    if (Number(c.fee) > 0) {
      const feeChargeId = await billing.createCharge(t, {
        user_id: c.user_id, type: 'other', description: `Comisión de pago en línea (${NAMES[c.provider]})`,
        amount: Number(c.fee), currency: c.currency, due_date: todayIn(s.timezone),
      });
      ids.unshift(feeChargeId);
    }

    // 2) El pago
    const pr = await t.query(
      `INSERT INTO payments (dojo_id, user_id, amount, currency, method, status, paid_at, reference, provider,
                             provider_order_id, provider_capture_id, provider_fee, notes)
       VALUES (:dojoId, :u, :amount, :cur, :method, 'completed', :paidAt, :ref, :provider, :orderId, :captureId, :pfee, :notes)`,
      {
        u: c.user_id, amount: c.total, cur: c.currency, method: c.provider, paidAt: info.paidAt ? new Date(info.paidAt) : new Date(),
        ref: info.paymentRef ?? info.captureId ?? info.orderId ?? null, provider: c.provider,
        orderId: info.orderId ?? null, captureId: info.captureId ?? null, pfee: info.fee ?? null,
        notes: `Pago en línea (${NAMES[c.provider]}${c.mode !== 'live' ? ', prueba' : ''})`,
      });
    const paymentId = pr.insertId;

    // 3) Se aplica a lo que siga pendiente de esos cargos (comisión primero)
    const allocations = [];
    let remaining = Number(c.total);
    const open = await t.query(
      `SELECT id, total - amount_paid AS open FROM charges
        WHERE dojo_id = :dojoId AND id IN (:ids) AND status IN ('pending','partial')`, { ids });
    const byId = new Map(open.map((x) => [Number(x.id), Number(x.open)]));
    for (const id of ids) {
      if (remaining <= 0) break;
      const apply = round2(Math.min(remaining, byId.get(Number(id)) ?? 0));
      if (apply > 0) allocations.push({ charge_id: id, amount: apply });
      remaining = round2(remaining - apply);
    }
    // Si mientras tanto alguno se pagó por otro lado, lo que sobra queda como saldo a favor
    const applied = await billing.allocatePayment(t, { paymentId, userId: c.user_id, amount: Number(c.total), currency: c.currency, allocations });
    await billing.reactivatePaidMemberships(t, c.user_id, todayIn(s.timezone));

    await t.query(
      `UPDATE online_checkouts SET status = 'completed', payment_id = :paymentId, provider_payment_id = :pp,
              completed_at = NOW(), error = NULL WHERE dojo_id = :dojoId AND id = :id`,
      { paymentId, pp: info.captureId ?? info.paymentRef ?? null, id: c.id });
    await audit(t.executor, {
      dojoId, userId: c.created_by, action: 'online_payment', entity: 'payment', entityId: paymentId,
      after: { checkout: c.id, provider: c.provider, total: Number(c.total), fee: Number(c.fee), via, unapplied: applied.unapplied },
    });
    return { checkout: { ...c, status: 'completed', payment_id: paymentId }, created: true };
  });

  if (result.mismatch) {
    // Fuera de la transacción: la marca de "falló" tiene que quedar guardada
    await pool.query("UPDATE online_checkouts SET status = 'failed', error = :err WHERE dojo_id = :dojoId AND id = :id",
      { dojoId, id: checkoutId, err: result.mismatch });
    await audit(pool, { dojoId, action: 'online_payment_mismatch', entity: 'online_checkout', entityId: checkoutId, after: { error: result.mismatch, info } });
    throw new AppError(409, 'AMOUNT_MISMATCH', 'El monto pagado no coincide; el dojo revisará el pago');
  }
  if (result.created) {
    notify(dojoId, [result.checkout.user_id], {
      type: 'payment_received', title: 'Pago recibido',
      body: `Recibimos tu pago de $${Number(result.checkout.total).toFixed(2)} ${result.checkout.currency} con ${NAMES[result.checkout.provider]}. ¡Gracias!`,
      data: { screen: 'payments', payment_id: result.checkout.payment_id },
    }).catch(() => {});
  }
  return result.checkout;
}

async function setStatus(dojoId, id, status, error = null) {
  await pool.query(
    `UPDATE online_checkouts SET status = :status, error = :error
      WHERE dojo_id = :dojoId AND id = :id AND status IN ('created','pending')`, { dojoId, id, status, error });
}

// ---------------------------------------------------------------------------
// Confirmar (al regresar a la app)
// ---------------------------------------------------------------------------
async function getCheckout(tdb, id) {
  const c = await tdb.one('SELECT * FROM online_checkouts WHERE dojo_id = :dojoId AND id = :id', { id });
  if (!c) throw notFound('Pago en línea no encontrado');
  return c;
}

function publicCheckout(c) {
  return {
    id: c.id, provider: c.provider, status: c.status, subtotal: Number(c.subtotal), fee: Number(c.fee), total: Number(c.total),
    currency: c.currency, payment_id: c.payment_id, error: c.error, test_mode: c.mode !== 'live', created_at: c.created_at,
  };
}

async function confirm(dojoId, checkoutId, { cancelled } = {}) {
  const tdb = tenantDb(dojoId);
  let c = await getCheckout(tdb, checkoutId);
  if (c.status === 'completed' || c.status === 'expired') return publicCheckout(c);
  const s = await loadSettings(dojoId);
  const cfg = providerConfig(s, c.provider);

  if (c.provider === 'paypal') {
    if (!c.provider_ref) return publicCheckout(c);
    let o = await paypal.getOrder(cfg, c.provider_ref);
    if (o.status === 'APPROVED') o = await paypal.captureOrder(cfg, c.provider_ref);
    if (o.status === 'COMPLETED') {
      await complete(dojoId, c.id, { amount: o.amount, currency: o.currency, fee: o.fee, orderId: o.orderId, captureId: o.captureId, paymentRef: o.captureId }, { via: 'return' });
    } else if (cancelled) {
      await setStatus(dojoId, c.id, 'cancelled');
    } else if (o.captureStatus === 'PENDING') {
      await setStatus(dojoId, c.id, 'pending');
    }
  } else {
    const payments = await mercadopago.findPayments(cfg, String(c.id));
    const approved = payments.find((p) => p.status === 'approved');
    const waiting = payments.find((p) => ['pending', 'in_process', 'authorized'].includes(p.status));
    if (approved) {
      await complete(dojoId, c.id, { amount: approved.amount, currency: approved.currency, fee: approved.fee, orderId: approved.paymentId, paymentRef: approved.paymentId, paidAt: approved.approvedAt }, { via: 'return' });
    } else if (waiting) {
      await setStatus(dojoId, c.id, 'pending');
    } else if (cancelled || payments.some((p) => ['rejected', 'cancelled'].includes(p.status))) {
      await setStatus(dojoId, c.id, cancelled ? 'cancelled' : 'failed', cancelled ? null : 'El pago fue rechazado');
    }
  }
  c = await getCheckout(tdb, checkoutId);
  return publicCheckout(c);
}

// ---------------------------------------------------------------------------
// Avisos de los proveedores (webhooks)
// ---------------------------------------------------------------------------
async function saveEvent(dojoId, provider, eventId, type, payload, verified) {
  try {
    const [r] = await pool.query(
      `INSERT INTO payment_webhook_events (dojo_id, provider, event_id, event_type, payload, verified)
       VALUES (:dojoId, :provider, :eventId, :type, :payload, :verified)`,
      { dojoId, provider, eventId: String(eventId).slice(0, 100), type: String(type).slice(0, 100), payload: JSON.stringify(payload), verified: verified ? 1 : 0 });
    return r.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return null; // ya procesado
    throw e;
  }
}

const markEvent = (id, error = null) => pool.query(
  'UPDATE payment_webhook_events SET processed_at = NOW(), error = :error WHERE id = :id', { id, error });

async function paypalWebhook(dojoId, headers, event) {
  const s = await loadSettings(dojoId);
  const cfg = providerConfig(s, 'paypal');
  const verified = await paypal.verifyWebhook(cfg, headers, event).catch(() => false);
  const eventRow = await saveEvent(dojoId, 'paypal', event?.id || `${Date.now()}`, event?.event_type || '?', event, verified);
  if (!eventRow) return { duplicate: true };
  if (!verified) { await markEvent(eventRow, 'Firma no verificada'); return { verified: false }; }
  try {
    const r = event.resource || {};
    const orderId = event.event_type === 'CHECKOUT.ORDER.APPROVED' ? r.id : r.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      const [[c]] = await pool.query(
        "SELECT id FROM online_checkouts WHERE dojo_id = :dojoId AND provider = 'paypal' AND provider_ref = :orderId", { dojoId, orderId });
      if (c) await confirm(dojoId, c.id);
    }
    await markEvent(eventRow);
  } catch (e) {
    await markEvent(eventRow, e.message);
    throw e;
  }
  return { ok: true };
}

async function mercadopagoWebhook(dojoId, { headers, query, body }) {
  const s = await loadSettings(dojoId);
  const cfg = providerConfig(s, 'mercadopago');
  const dataId = query['data.id'] ?? body?.data?.id;
  const type = query.type ?? body?.type ?? body?.topic ?? '?';
  const verified = mercadopago.verifyWebhook(cfg.webhookSecret, {
    signature: headers['x-signature'], requestId: headers['x-request-id'], dataId,
  });
  const eventRow = await saveEvent(dojoId, 'mercadopago', `${type}:${dataId}:${headers['x-request-id'] || ''}`, type, { query, body }, verified);
  if (!eventRow) return { duplicate: true };
  if (!verified) { await markEvent(eventRow, 'Firma no verificada'); return { verified: false }; }
  try {
    if (type === 'payment' && dataId) {
      // Se consulta el pago directo a Mercado Pago: no se confía en el contenido del aviso
      const p = await mercadopago.getPayment(cfg, dataId);
      const checkoutId = Number(p.externalRef);
      if (checkoutId) {
        const [[c]] = await pool.query(
          "SELECT id FROM online_checkouts WHERE dojo_id = :dojoId AND provider = 'mercadopago' AND id = :id", { dojoId, id: checkoutId });
        if (c) await confirm(dojoId, c.id);
      }
    }
    await markEvent(eventRow);
  } catch (e) {
    await markEvent(eventRow, e.message);
    throw e;
  }
  return { ok: true };
}

/** Intentos abandonados → expired (lo corre el programador cada hora) */
async function expireStale() {
  const [r] = await pool.query(
    "UPDATE online_checkouts SET status = 'expired' WHERE status = 'created' AND created_at < NOW() - INTERVAL 2 DAY");
  return r.affectedRows;
}

/** Prueba de credenciales (las guardadas o las del formulario) */
async function testProvider(dojoId, provider, override = {}) {
  const s = await loadSettings(dojoId);
  const cfg = providerConfig(s, provider);
  const merged = provider === 'paypal'
    ? { ...cfg, mode: override.paypal_mode ?? cfg.mode, clientId: override.paypal_client_id || cfg.clientId, secret: override.paypal_secret || cfg.secret }
    : { ...cfg, mode: override.mp_mode ?? cfg.mode, accessToken: override.mp_access_token || cfg.accessToken };
  if (provider === 'paypal' && (!merged.clientId || !merged.secret)) throw badRequest('Llena el Client ID y el Secret de PayPal');
  if (provider === 'mercadopago' && !merged.accessToken) throw badRequest('Llena el Access Token de Mercado Pago');
  try {
    return provider === 'paypal' ? await paypal.test(merged) : await mercadopago.test(merged);
  } catch (e) {
    throw new AppError(400, 'PROVIDER_ERROR', e.message);
  }
}

module.exports = {
  options, createCheckout, confirm, complete, getCheckout, publicCheckout, paypalWebhook, mercadopagoWebhook,
  expireStale, testProvider, computeFee, webhookUrl, safeReturnBase, NAMES, conflict,
};
