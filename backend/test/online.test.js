/**
 * Pagos en línea contra servidores simulados de PayPal y Mercado Pago.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { resetDatabase, PASSWORD, today } = require('./helpers');

process.env.BACKUP_ENCRYPTION_KEY = 'llave-de-prueba-llave-de-prueba-1234567';

// ---------------------------------------------------------------------------
// Proveedores simulados
// ---------------------------------------------------------------------------
const fake = { orders: new Map(), mpPayments: [], mpOrders: new Map(), prefs: new Map(), seq: 0 };
function fakeServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  // --- PayPal ---
  app.post('/v1/oauth2/token', (req, res) => {
    const auth = Buffer.from(String(req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
    const tokens = { 'cid:sec': 'tok', 'lcid:lsec': 'tok-live' };
    if (!tokens[auth]) return res.status(401).json({ error: 'invalid_client' });
    fake.lastPaypalToken = tokens[auth];
    res.json({ access_token: tokens[auth], expires_in: 3600 });
  });
  app.post('/v2/checkout/orders', (req, res) => {
    const id = `ORDER-${++fake.seq}`;
    const pu = req.body.purchase_units[0];
    fake.orders.set(id, { id, status: 'CREATED', pu, return_url: req.body.payment_source.paypal.experience_context.return_url });
    res.status(201).json({ id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://paypal.test/checkoutnow?token=${id}` }] });
  });
  const orderJson = (o) => ({
    id: o.id, status: o.status,
    purchase_units: [{ ...o.pu, ...(o.capture ? { payments: { captures: [o.capture] } } : {}) }],
  });
  app.get('/v2/checkout/orders/:id', (req, res) => {
    const o = fake.orders.get(req.params.id);
    if (!o) return res.status(404).json({ message: 'not found' });
    res.json(orderJson(o));
  });
  app.post('/v2/checkout/orders/:id/capture', (req, res) => {
    const o = fake.orders.get(req.params.id);
    if (o.status === 'COMPLETED') return res.status(422).json({ details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
    if (o.status !== 'APPROVED') return res.status(422).json({ details: [{ issue: 'ORDER_NOT_APPROVED', description: 'no aprobada' }] });
    o.status = 'COMPLETED';
    o.capture = { id: `CAP-${o.id}`, status: 'COMPLETED', amount: o.pu.amount, seller_receivable_breakdown: { paypal_fee: { value: '12.34' } } };
    res.status(201).json(orderJson(o));
  });
  app.post('/v1/notifications/verify-webhook-signature', (req, res) => {
    const expected = req.headers.authorization === 'Bearer tok-live' ? 'WH-LIVE' : 'WH-1';
    fake.lastWebhookId = req.body.webhook_id;
    res.json({ verification_status: req.body.transmission_sig === 'firma-buena' && req.body.webhook_id === expected ? 'SUCCESS' : 'FAILURE' });
  });
  // --- Mercado Pago ---
  const mpAuth = (req, res, next) => (req.headers.authorization === 'Bearer TEST-ok' ? next() : res.status(401).json({ message: 'invalid token' }));
  app.get('/users/me', mpAuth, (_req, res) => res.json({ id: 1, nickname: 'DOJO_PRUEBA' }));
  app.post('/checkout/preferences', mpAuth, (req, res) => {
    const id = `PREF-${++fake.seq}`;
    fake.prefs.set(id, req.body);
    res.status(201).json({ id, init_point: `https://mp.test/live/${id}`, sandbox_init_point: `https://mp.test/sandbox/${id}` });
  });
  app.get('/v1/payments/search', mpAuth, (req, res) => {
    res.json({ results: fake.mpPayments.filter((p) => p.external_reference === req.query.external_reference).reverse() });
  });
  app.get('/merchant_orders/:id', mpAuth, (req, res) => {
    const ext = fake.mpOrders.get(req.params.id);
    return ext ? res.json({ id: Number(req.params.id), external_reference: ext, status: 'closed' }) : res.status(404).json({ message: 'not found' });
  });
  app.get('/v1/payments/:id', mpAuth, (req, res) => {
    const p = fake.mpPayments.find((x) => String(x.id) === req.params.id);
    return p ? res.json(p) : res.status(404).json({ message: 'not found' });
  });
  return new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
}
function mpPay(checkoutId, status, amount) {
  const p = { id: 9000 + fake.mpPayments.length, status, transaction_amount: amount, currency_id: 'MXN', external_reference: String(checkoutId),
    fee_details: [{ amount: 40.5 }], date_approved: status === 'approved' ? new Date().toISOString() : null };
  fake.mpPayments.push(p);
  return p;
}
function mpSignature(secret, dataId, requestId) {
  const ts = String(Date.now());
  const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

// ---------------------------------------------------------------------------
let request; let app; let pool; let server; let outbox;
const T = {};
before(async () => {
  await resetDatabase();
  server = await fakeServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.PAYPAL_API_BASE = base;
  process.env.MP_API_BASE = base;
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  ({ outbox } = require('../src/services/mailer'));
  app = require('../src/app').createApp();
  const login = async (identifier, extra = {}) =>
    (await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, ...extra })).body.data.access_token;
  T.admin = await login('admin@seikoukan.mx');
  T.student = await login('alumno@seikoukan.mx');
  T.other = await login('sensei@ambos.mx', { dojo_slug: 'seikoukan' });
});
after(async () => { await pool.end(); server.close(); });

const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};
const ok = (r, status = 200) => {
  if (r.status !== status) assert.fail(`HTTP ${r.status} (esperado ${status}): ${JSON.stringify(r.body)}`);
  return r.body.data;
};
async function charge(amount, desc = 'Mensualidad') {
  const [r] = await pool.query(
    `INSERT INTO charges (dojo_id, user_id, type, description, amount, currency, due_date) VALUES (1, 2, 'other', :desc, :amount, 'MXN', :d)`,
    { desc, amount, d: today() });
  return r.insertId;
}
const chargeRow = async (id) => (await pool.query('SELECT status, amount_paid, total FROM charges WHERE id = :id', { id }))[0][0];
const paymentsCount = async () => Number((await pool.query("SELECT COUNT(*) n FROM payments WHERE dojo_id = 1 AND provider IS NOT NULL"))[0][0].n);

// ===========================================================================
describe('configuración', () => {
  test('sin métodos activos el alumno no ve opciones', async () => {
    assert.deepEqual(ok(await api('get', '/online-payments/options', T.student)), []);
  });

  test('PayPal: no se activa sin credenciales; la llave secreta nunca se devuelve', async () => {
    assert.equal((await api('patch', '/dojo/payment-settings', T.admin, { paypal_enabled: true })).status, 400);
    const s = ok(await api('patch', '/dojo/payment-settings', T.admin, {
      paypal_test_client_id: 'cid', paypal_test_secret: 'sec', paypal_test_webhook_id: 'WH-1', paypal_mode: 'sandbox', paypal_enabled: true,
    }));
    assert.equal(s.paypal_enabled, 1);
    assert.equal(s.paypal_test_secret_set, 1);
    assert.equal(s.paypal_live_secret_set, 0);
    assert.equal(JSON.stringify(s).includes('"sec"'), false);
    assert.match(s.webhook_urls.paypal.test, /\/api\/v2\/online-payments\/webhooks\/paypal\/1\/test$/);
    assert.match(s.webhook_urls.paypal.live, /\/webhooks\/paypal\/1\/live$/);
    const [[row]] = await pool.query('SELECT paypal_test_secret_enc FROM dojo_payment_settings WHERE dojo_id = 1');
    assert.match(String(row.paypal_test_secret_enc), /^v1:/);
  });

  test('PayPal: no se puede pasar a modo real sin las credenciales reales', async () => {
    const r = await api('patch', '/dojo/payment-settings', T.admin, { paypal_mode: 'live' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /reales/);
    const s = ok(await api('get', '/dojo/payment-settings', T.admin));
    assert.equal(s.paypal_mode, 'sandbox'); // no se guardó nada
    assert.equal(s.paypal_enabled, 1);
  });

  test('probar credenciales: buenas y malas, por ambiente', async () => {
    ok(await api('post', '/dojo/payment-settings/test/paypal', T.admin, {}));
    ok(await api('post', '/dojo/payment-settings/test/paypal', T.admin, { mode: 'live', client_id: 'lcid', secret: 'lsec' }));
    const none = await api('post', '/dojo/payment-settings/test/paypal', T.admin, { mode: 'live' });
    assert.equal(none.status, 400);
    assert.match(none.body.message, /reales/);
    const bad = await api('post', '/dojo/payment-settings/test/paypal', T.admin, { secret: 'otra' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /Client ID o el Secret/);
    assert.equal((await api('post', '/dojo/payment-settings/test/paypal', T.student, {})).status, 403);
  });

  test('el alumno ve PayPal disponible (modo prueba)', async () => {
    const o = ok(await api('get', '/online-payments/options', T.student));
    assert.equal(o.length, 1);
    assert.equal(o[0].provider, 'paypal');
    assert.equal(o[0].test_mode, true);
  });
});

// ===========================================================================
describe('PayPal', () => {
  let c1; let c2; let checkout;

  test('crear el pago de dos cargos', async () => {
    c1 = await charge(750); c2 = await charge(600);
    checkout = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [c1, c2] }), 201);
    assert.equal(checkout.total, 1350);
    assert.equal(checkout.fee, 0);
    assert.match(checkout.redirect_url, /paypal\.test\/checkoutnow\?token=ORDER-/);
    const order = [...fake.orders.values()].at(-1);
    assert.equal(order.pu.amount.value, '1350.00');
    assert.equal(order.pu.custom_id, String(checkout.checkout_id));
    assert.match(order.return_url, /\/pay\/return\?checkout=\d+&provider=paypal$/);
  });

  test('si el alumno no aprobó, confirmar no registra nada', async () => {
    const r = ok(await api('post', `/online-payments/${checkout.checkout_id}/confirm`, T.student, {}));
    assert.equal(r.status, 'created');
    assert.equal(await paymentsCount(), 0);
  });

  test('otra persona no puede ver ni confirmar el pago', async () => {
    assert.equal((await api('get', `/online-payments/${checkout.checkout_id}`, T.other)).status, 403);
    assert.equal((await api('post', `/online-payments/${checkout.checkout_id}/confirm`, T.other, {})).status, 403);
  });

  test('aprobado: al regresar se cobra y se registra el pago (una sola vez)', async () => {
    fake.orders.get([...fake.orders.keys()].at(-1)).status = 'APPROVED';
    outbox.length = 0;
    const r = ok(await api('post', `/online-payments/${checkout.checkout_id}/confirm`, T.student, {}));
    assert.equal(r.status, 'completed');
    assert.equal((await chargeRow(c1)).status, 'paid');
    assert.equal((await chargeRow(c2)).status, 'paid');
    const [[p]] = await pool.query('SELECT * FROM payments WHERE id = :id', { id: r.payment_id });
    assert.equal(p.method, 'paypal');
    assert.equal(Number(p.amount), 1350);
    assert.equal(Number(p.provider_fee), 12.34);
    assert.match(p.provider_capture_id, /^CAP-/);
    // Confirmar otra vez no duplica
    ok(await api('post', `/online-payments/${checkout.checkout_id}/confirm`, T.student, {}));
    assert.equal(await paymentsCount(), 1);
    await new Promise((res) => setTimeout(res, 100));
    const [[n]] = await pool.query("SELECT title FROM notifications WHERE user_id = 2 AND type = 'payment_received' ORDER BY id DESC LIMIT 1");
    assert.equal(n.title, 'Pago recibido');
  });

  test('aviso (webhook) con firma buena completa el pago aunque el alumno cierre la ventana', async () => {
    const c = await charge(500);
    const co = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [c] }), 201);
    const orderId = [...fake.orders.keys()].at(-1);
    fake.orders.get(orderId).status = 'APPROVED';
    const event = { id: 'WH-EVT-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId } };
    const hdr = { 'paypal-transmission-sig': 'firma-mala', 'paypal-auth-algo': 'x', 'paypal-cert-url': 'x', 'paypal-transmission-id': 't', 'paypal-transmission-time': 'now' };
    // Firma mala: se rechaza y no se procesa
    assert.equal((await request(app).post('/api/v2/online-payments/webhooks/paypal/1/test').set(hdr).send({ ...event, id: 'WH-EVT-0' })).status, 400);
    assert.equal((await chargeRow(c)).status, 'pending');
    // Firma buena
    assert.equal((await request(app).post('/api/v2/online-payments/webhooks/paypal/1/test').set({ ...hdr, 'paypal-transmission-sig': 'firma-buena' }).send(event)).status, 200);
    assert.equal((await chargeRow(c)).status, 'paid');
    // El mismo aviso repetido se ignora
    assert.equal((await request(app).post('/api/v2/online-payments/webhooks/paypal/1/test').set({ ...hdr, 'paypal-transmission-sig': 'firma-buena' }).send(event)).status, 200);
    assert.equal(await paymentsCount(), 2);
    assert.equal(ok(await api('get', `/online-payments/${co.checkout_id}`, T.student)).status, 'completed');
  });

  test('comisión al alumno: al dojo le llega completo lo que se debía', async () => {
    ok(await api('patch', '/dojo/payment-settings', T.admin, { paypal_fee_percent: 4, paypal_fee_fixed: 4 }));
    const c = await charge(1000);
    const co = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [c] }), 201);
    // (1000 + 4) / 0.96 = 1045.83
    assert.equal(co.total, 1045.83);
    assert.equal(co.fee, 45.83);
    fake.orders.get([...fake.orders.keys()].at(-1)).status = 'APPROVED';
    const r = ok(await api('post', `/online-payments/${co.checkout_id}/confirm`, T.student, {}));
    assert.equal(r.status, 'completed');
    assert.equal((await chargeRow(c)).status, 'paid');
    const [[fee]] = await pool.query("SELECT status, total FROM charges WHERE dojo_id = 1 AND user_id = 2 AND description LIKE 'Comisión de pago en línea%' ORDER BY id DESC LIMIT 1");
    assert.equal(fee.status, 'paid');
    assert.equal(Number(fee.total), 45.83);
    ok(await api('patch', '/dojo/payment-settings', T.admin, { paypal_fee_percent: null, paypal_fee_fixed: null }));
  });

  test('si un cargo se pagó en efectivo mientras tanto, lo pagado en línea queda como saldo a favor', async () => {
    const c = await charge(300);
    const co = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [c] }), 201);
    ok(await api('post', '/payments', T.admin, { user_id: 2, amount: 300, method: 'cash', allocations: [{ charge_id: c, amount: 300 }] }), 201);
    fake.orders.get([...fake.orders.keys()].at(-1)).status = 'APPROVED';
    const r = ok(await api('post', `/online-payments/${co.checkout_id}/confirm`, T.student, {}));
    assert.equal(r.status, 'completed');
    const acc = ok(await api('get', '/charges/mine', T.student));
    assert.equal(Number(acc.summary.credit), 300);
  });

  test('no se puede pagar un cargo ajeno o que ya no está pendiente', async () => {
    const [r] = await pool.query("INSERT INTO charges (dojo_id, user_id, type, description, amount, currency, due_date) VALUES (1, 3, 'other', 'Ajeno', 100, 'MXN', CURDATE())");
    assert.equal((await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [r.insertId] })).status, 400);
    assert.equal((await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [c1] })).status, 400);
    assert.equal((await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [await charge(10)] })).status, 409);
  });

  test('regreso solo a dominios permitidos', () => {
    const { safeReturnBase } = require('../src/modules/online/online.service');
    assert.equal(safeReturnBase('https://evil.example.com'), 'http://localhost:8081');
    assert.equal(safeReturnBase('budodesk://'), 'budodesk://');
    assert.equal(safeReturnBase('http://localhost:19006'), 'http://localhost:19006');
  });
});

// ===========================================================================
describe('Mercado Pago', () => {
  let c; let co;
  const SECRET = 'secreto-avisos';

  test('activar con credenciales de prueba', async () => {
    const bad = await api('post', '/dojo/payment-settings/test/mercadopago', T.admin, { mode: 'test', access_token: 'TEST-malo' });
    assert.equal(bad.status, 400);
    const s = ok(await api('patch', '/dojo/payment-settings', T.admin, {
      mp_test_access_token: 'TEST-ok', mp_test_public_key: 'TEST-pk', mp_test_webhook_secret: SECRET, mp_mode: 'test', mp_enabled: true,
    }));
    assert.equal(s.mp_enabled, 1);
    assert.equal(s.mp_test_access_token_set, 1);
    assert.equal(s.mp_live_access_token_set, 0);
    assert.equal(ok(await api('post', '/dojo/payment-settings/test/mercadopago', T.admin, {})).account, 'DOJO_PRUEBA');
    assert.equal(ok(await api('get', '/online-payments/options', T.student)).length, 2);
  });

  test('crear el pago usa el enlace de prueba', async () => {
    c = await charge(750);
    co = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [c] }), 201);
    assert.match(co.redirect_url, /mp\.test\/sandbox\/PREF-/);
    const pref = [...fake.prefs.values()].at(-1);
    assert.equal(pref.external_reference, String(co.checkout_id));
    assert.equal(pref.items[0].unit_price, 750);
    assert.match(pref.back_urls.pending, /pending=1/);
  });

  test('pago pendiente (OXXO): queda pendiente sin registrar nada', async () => {
    mpPay(co.checkout_id, 'pending', 750);
    const r = ok(await api('post', `/online-payments/${co.checkout_id}/confirm`, T.student, {}));
    assert.equal(r.status, 'pending');
    assert.equal((await chargeRow(c)).status, 'pending');
  });

  test('aviso falso o de otra cuenta: no cambia nada', async () => {
    const r = await request(app).post('/api/v2/online-payments/webhooks/mercadopago/1/test?data.id=123456&type=payment')
      .set({ 'x-signature': mpSignature('otro-secreto', '123456', 'req-0'), 'x-request-id': 'req-0' }).send({ type: 'payment', data: { id: '123456' } });
    assert.equal(r.status, 200);
    assert.equal((await chargeRow(c)).status, 'pending');
    const [[ev]] = await pool.query("SELECT verified, error FROM payment_webhook_events WHERE provider = 'mercadopago' ORDER BY id DESC LIMIT 1");
    assert.equal(ev.verified, 0);
    assert.match(ev.error, /Mercado Pago/);
  });

  test('cuando se acredita, el aviso (webhook) firmado lo registra', async () => {
    const p = mpPay(co.checkout_id, 'approved', 750);
    const good = await request(app).post(`/api/v2/online-payments/webhooks/mercadopago/1/test?data.id=${p.id}&type=payment`)
      .set({ 'x-signature': mpSignature(SECRET, p.id, 'req-2'), 'x-request-id': 'req-2' }).send({ type: 'payment', data: { id: String(p.id) } });
    assert.equal(good.status, 200);
    assert.equal((await chargeRow(c)).status, 'paid');
    const [[ev]] = await pool.query("SELECT verified, error FROM payment_webhook_events WHERE provider = 'mercadopago' ORDER BY id DESC LIMIT 1");
    assert.equal(ev.verified, 1);
    assert.equal(ev.error, null);
    const [[pay]] = await pool.query("SELECT method, provider_fee, amount FROM payments WHERE provider = 'mercadopago' ORDER BY id DESC LIMIT 1");
    assert.equal(pay.method, 'mercadopago');
    assert.equal(Number(pay.provider_fee), 40.5);
  });

  test('avisos IPN sin firma (pago y orden comercial) también registran el pago', async () => {
    // IPN de pago: ?id=…&topic=payment
    const c3 = await charge(320);
    const co3 = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [c3] }), 201);
    const p3 = mpPay(co3.checkout_id, 'approved', 320);
    const r3 = await request(app).post(`/api/v2/online-payments/webhooks/mercadopago/1/test?id=${p3.id}&topic=payment`)
      .set({ 'x-request-id': 'ipn-1' }).send({ topic: 'payment', resource: String(p3.id) });
    assert.equal(r3.status, 200);
    assert.equal((await chargeRow(c3)).status, 'paid');
    // IPN de orden comercial: ?id=…&topic=merchant_order, resource con la URL
    const c4 = await charge(330);
    const co4 = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [c4] }), 201);
    mpPay(co4.checkout_id, 'approved', 330);
    fake.mpOrders.set('777001', String(co4.checkout_id));
    const r4 = await request(app).post('/api/v2/online-payments/webhooks/mercadopago/1/test?id=777001&topic=merchant_order')
      .set({ 'x-request-id': 'ipn-2' }).send({ topic: 'merchant_order', resource: 'https://api.mercadolibre.com/merchant_orders/777001' });
    assert.equal(r4.status, 200);
    assert.equal((await chargeRow(c4)).status, 'paid');
    const [evs] = await pool.query("SELECT event_type, event_id, verified, error FROM payment_webhook_events WHERE provider = 'mercadopago' ORDER BY id DESC LIMIT 2");
    assert.deepEqual(evs.map((e) => [e.event_type, e.verified, e.error]), [['merchant_order', 0, null], ['payment', 0, null]]);
    assert.doesNotMatch(evs[0].event_id, /undefined/);
  });

  test('webhook firmado de orden comercial (topic_merchant_order_wh)', async () => {
    const c5 = await charge(340);
    const co5 = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [c5] }), 201);
    mpPay(co5.checkout_id, 'approved', 340);
    fake.mpOrders.set('777002', String(co5.checkout_id));
    const r5 = await request(app).post('/api/v2/online-payments/webhooks/mercadopago/1/test?data.id=777002&type=topic_merchant_order_wh')
      .set({ 'x-signature': mpSignature(SECRET, '777002', 'req-5'), 'x-request-id': 'req-5' })
      .send({ id: '777002', type: 'topic_merchant_order_wh', action: 'update', status: 'closed' });
    assert.equal(r5.status, 200);
    assert.equal((await chargeRow(c5)).status, 'paid');
  });

  test('monto alterado: no se registra y queda para revisión', async () => {
    const c2 = await charge(900);
    const co2 = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [c2] }), 201);
    mpPay(co2.checkout_id, 'approved', 9);
    const r = await api('post', `/online-payments/${co2.checkout_id}/confirm`, T.student, {});
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'AMOUNT_MISMATCH');
    assert.equal((await chargeRow(c2)).status, 'pending');
    const st = ok(await api('get', `/online-payments/${co2.checkout_id}`, T.student));
    assert.equal(st.status, 'failed');
    assert.match(st.error, /no coincide/);
  });

  test('cancelar en el proveedor deja el intento como cancelado', async () => {
    const co3 = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [await charge(50)] }), 201);
    assert.equal(ok(await api('post', `/online-payments/${co3.checkout_id}/confirm`, T.student, { cancelled: true })).status, 'cancelled');
  });

  test('intentos abandonados se marcan vencidos', async () => {
    const co4 = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'mercadopago', charge_ids: [await charge(60)] }), 201);
    await pool.query('UPDATE online_checkouts SET created_at = NOW() - INTERVAL 3 DAY WHERE id = :id', { id: co4.checkout_id });
    assert.ok(await require('../src/modules/online/online.service').expireStale() >= 1);
    assert.equal(ok(await api('get', `/online-payments/${co4.checkout_id}`, T.student)).status, 'expired');
  });
});

// ===========================================================================
describe('credenciales de prueba y reales por separado', () => {
  const hdr = { 'paypal-transmission-sig': 'firma-buena', 'paypal-auth-algo': 'x', 'paypal-cert-url': 'x', 'paypal-transmission-id': 't', 'paypal-transmission-time': 'now' };
  let sandboxCo; let sandboxOrder;

  test('un pago iniciado en prueba se confirma con las credenciales de prueba aunque se cambie a real', async () => {
    const c = await charge(400);
    sandboxCo = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [c] }), 201);
    sandboxOrder = [...fake.orders.keys()].at(-1);
    assert.equal(sandboxCo.test_mode, true);

    const s = ok(await api('patch', '/dojo/payment-settings', T.admin, {
      paypal_live_client_id: 'lcid', paypal_live_secret: 'lsec', paypal_live_webhook_id: 'WH-LIVE', paypal_mode: 'live',
    }));
    assert.equal(s.paypal_mode, 'live');
    assert.equal(s.paypal_test_client_id, 'cid'); // las de prueba siguen guardadas
    assert.equal(s.paypal_test_secret_set, 1);
    assert.equal(ok(await api('get', '/online-payments/options', T.student)).find((o) => o.provider === 'paypal').test_mode, false);

    fake.orders.get(sandboxOrder).status = 'APPROVED';
    const r = ok(await api('post', `/online-payments/${sandboxCo.checkout_id}/confirm`, T.student, {}));
    assert.equal(r.status, 'completed');
    assert.equal(fake.lastPaypalToken, 'tok');
    assert.equal((await chargeRow(c)).status, 'paid');
  });

  test('los pagos nuevos usan las credenciales reales y su aviso se verifica con su Webhook ID', async () => {
    const c = await charge(450);
    const co = ok(await api('post', '/online-payments/checkout', T.student, { provider: 'paypal', charge_ids: [c] }), 201);
    assert.equal(co.test_mode, false);
    assert.equal(fake.lastPaypalToken, 'tok-live');
    const orderId = [...fake.orders.keys()].at(-1);
    fake.orders.get(orderId).status = 'APPROVED';
    const event = { id: 'WH-EVT-LIVE', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId } };
    assert.equal((await request(app).post('/api/v2/online-payments/webhooks/paypal/1/live').set(hdr).send(event)).status, 200);
    assert.equal(fake.lastWebhookId, 'WH-LIVE');
    assert.equal((await chargeRow(c)).status, 'paid');
    const [[p]] = await pool.query("SELECT notes FROM payments WHERE provider = 'paypal' ORDER BY id DESC LIMIT 1");
    assert.doesNotMatch(p.notes, /prueba/);
  });

  test('volver a prueba no borra las reales', async () => {
    const s = ok(await api('patch', '/dojo/payment-settings', T.admin, { paypal_mode: 'sandbox' }));
    assert.equal(s.paypal_live_client_id, 'lcid');
    assert.equal(s.paypal_live_secret_set, 1);
  });
});
