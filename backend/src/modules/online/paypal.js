/**
 * PayPal (Orders API v2). Cada dojo usa sus propias credenciales.
 * Documentación: https://developer.paypal.com/docs/api/orders/v2/
 *
 * cfg: { mode: 'sandbox'|'live', clientId, secret, webhookId }
 */
const env = require('../../config/env');

const BASE = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };
const base = (cfg) => env.PAYPAL_API_BASE || BASE[cfg.mode] || BASE.sandbox;

class ProviderError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

async function call(cfg, path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${base(cfg)}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    const msg = json?.details?.[0]?.description || json?.message || json?.error_description || `HTTP ${res.status}`;
    throw new ProviderError(`PayPal: ${msg}`, res.status, json);
  }
  return json;
}

async function accessToken(cfg) {
  const res = await fetch(`${base(cfg)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new ProviderError(res.status === 401 ? 'PayPal: el Client ID o el Secret no son correctos' : `PayPal: no se pudo autenticar (HTTP ${res.status})`, res.status, json);
  }
  return json.access_token;
}

/** Prueba de credenciales */
async function test(cfg) {
  await accessToken(cfg);
  return { ok: true };
}

/** Crea la orden y devuelve { id, approveUrl } */
async function createOrder(cfg, { checkoutId, dojoId, amount, currency, description, returnUrl, cancelUrl, brand, locale }) {
  const token = await accessToken(cfg);
  const order = await call(cfg, '/v2/checkout/orders', {
    method: 'POST', token,
    headers: { 'PayPal-Request-Id': `bd-${dojoId}-${checkoutId}-create` },
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(checkoutId),
        custom_id: String(checkoutId),
        invoice_id: `BD-${dojoId}-${checkoutId}`,
        description: description.slice(0, 127),
        amount: { currency_code: currency, value: amount.toFixed(2) },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: (brand || 'BudoDesk').slice(0, 127),
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            locale: locale || 'es-MX',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });
  const link = (order.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!link) throw new ProviderError('PayPal no devolvió el enlace para pagar', 502, order);
  return { id: order.id, approveUrl: link.href };
}

/** Normaliza una orden: { orderId, status, captureId, amount, currency, fee, customId } */
function summarize(order) {
  const pu = order?.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  return {
    orderId: order?.id,
    status: cap?.status === 'COMPLETED' ? 'COMPLETED' : order?.status,
    captureId: cap?.id ?? null,
    captureStatus: cap?.status ?? null,
    amount: Number(cap?.amount?.value ?? pu?.amount?.value ?? 0),
    currency: cap?.amount?.currency_code ?? pu?.amount?.currency_code,
    fee: cap?.seller_receivable_breakdown?.paypal_fee?.value != null ? Number(cap.seller_receivable_breakdown.paypal_fee.value) : null,
    customId: pu?.custom_id ?? pu?.reference_id ?? null,
  };
}

async function getOrder(cfg, orderId) {
  const token = await accessToken(cfg);
  return summarize(await call(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { token }));
}

/** Cobra una orden aprobada. Si ya estaba cobrada, devuelve su estado (idempotente). */
async function captureOrder(cfg, orderId) {
  const token = await accessToken(cfg);
  try {
    return summarize(await call(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST', token, body: {}, headers: { 'PayPal-Request-Id': `bd-capture-${orderId}` },
    }));
  } catch (e) {
    if (e.details?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED') return getOrder(cfg, orderId);
    throw e;
  }
}

/** Verifica la firma de un aviso (webhook) con la API de PayPal */
async function verifyWebhook(cfg, headers, event) {
  if (!cfg.webhookId) return false;
  const token = await accessToken(cfg);
  const r = await call(cfg, '/v1/notifications/verify-webhook-signature', {
    method: 'POST', token,
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: cfg.webhookId,
      webhook_event: event,
    },
  });
  return r?.verification_status === 'SUCCESS';
}

module.exports = { test, createOrder, getOrder, captureOrder, verifyWebhook, ProviderError };
