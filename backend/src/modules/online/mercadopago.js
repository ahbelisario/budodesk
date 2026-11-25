/**
 * Mercado Pago (Checkout Pro). Cada dojo usa sus propias credenciales.
 * Documentación: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro
 *
 * cfg: { mode: 'test'|'live', accessToken, publicKey, webhookSecret }
 */
const crypto = require('crypto');
const env = require('../../config/env');

const base = () => env.MP_API_BASE || 'https://api.mercadopago.com';

class ProviderError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

async function call(cfg, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Accept: 'application/json', Authorization: `Bearer ${cfg.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
  if (!res.ok) {
    const msg = res.status === 401 ? 'el Access Token no es válido' : json?.message || json?.error || `HTTP ${res.status}`;
    throw new ProviderError(`Mercado Pago: ${msg}`, res.status, json);
  }
  return json;
}

/** Prueba de credenciales: datos de la cuenta dueña del token */
async function test(cfg) {
  const me = await call(cfg, '/users/me');
  return { ok: true, account: me?.nickname || me?.email || String(me?.id || '') };
}

/** Crea la preferencia de pago y devuelve { id, checkoutUrl } */
async function createPreference(cfg, { checkoutId, dojoId, amount, currency, description, backUrls, notificationUrl, payerEmail }) {
  const pref = await call(cfg, '/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `bd-${dojoId}-${checkoutId}` },
    body: {
      items: [{ id: String(checkoutId), title: description.slice(0, 250), quantity: 1, unit_price: Number(amount.toFixed(2)), currency_id: currency }],
      external_reference: String(checkoutId),
      back_urls: backUrls,
      auto_return: 'approved',
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      ...(payerEmail ? { payer: { email: payerEmail } } : {}),
      metadata: { dojo_id: dojoId, checkout_id: checkoutId },
      statement_descriptor: 'BUDODESK',
    },
  });
  const url = cfg.mode === 'test' ? (pref.sandbox_init_point || pref.init_point) : pref.init_point;
  if (!url) throw new ProviderError('Mercado Pago no devolvió el enlace para pagar', 502, pref);
  return { id: pref.id, checkoutUrl: url };
}

/** Normaliza un pago: { paymentId, status, amount, currency, fee, externalRef, approvedAt } */
function summarize(p) {
  const fee = (p?.fee_details || []).reduce((s, f) => s + Number(f.amount || 0), 0);
  return {
    paymentId: p?.id != null ? String(p.id) : null,
    status: p?.status, // approved, pending, in_process, authorized, rejected, cancelled, refunded, charged_back
    amount: Number(p?.transaction_amount ?? 0),
    currency: p?.currency_id,
    fee: p?.fee_details ? Math.round(fee * 100) / 100 : null,
    externalRef: p?.external_reference ?? null,
    approvedAt: p?.date_approved ?? null,
    method: p?.payment_method_id ?? null,
  };
}

async function getPayment(cfg, paymentId) {
  return summarize(await call(cfg, `/v1/payments/${encodeURIComponent(paymentId)}`));
}

/** Pagos de un intento (por external_reference), el más reciente primero */
async function findPayments(cfg, externalRef) {
  const r = await call(cfg, `/v1/payments/search?external_reference=${encodeURIComponent(externalRef)}&sort=date_created&criteria=desc`);
  return (r?.results || []).map(summarize);
}

/**
 * Firma de los avisos: x-signature "ts=…,v1=…" = HMAC-SHA256(secreto, "id:{data.id};request-id:{x-request-id};ts:{ts};")
 * data.id viene en la URL (?data.id=…); si es alfanumérico se usa en minúsculas.
 */
function verifyWebhook(secret, { signature, requestId, dataId }) {
  if (!secret || !signature) return false;
  const parts = Object.fromEntries(String(signature).split(',').map((x) => x.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(String(dataId ?? '')) ? String(dataId).toLowerCase() : String(dataId ?? '');
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { test, createPreference, getPayment, findPayments, verifyWebhook, ProviderError };
