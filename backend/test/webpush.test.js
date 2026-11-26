/**
 * Notificaciones del navegador (web push).
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { resetDatabase, PASSWORD } = require('./helpers');

let request; let app; let pool; let webpush; let notify;
const T = {};
const sent = []; // lo que "salió" hacia el servicio de push
let failWith = null;

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  webpush = require('../src/modules/notifications/webpush.service');
  notify = require('../src/modules/notifications/notify.service');
  webpush.setTransport(async (sub, payload, options) => {
    if (failWith) { const e = new Error('push'); e.statusCode = failWith; throw e; }
    sent.push({ sub, payload: JSON.parse(payload), options });
  });
  const login = async (identifier, extra = {}) =>
    (await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, ...extra })).body.data.access_token;
  T.admin = await login('admin@seikoukan.mx');
  T.student = await login('alumno@seikoukan.mx');
});
after(async () => { await pool.end(); });

const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};
const ok = (r, status = 200) => {
  if (r.status !== status) assert.fail(`HTTP ${r.status} (esperado ${status}): ${JSON.stringify(r.body)}`);
  return r.body.data;
};

/** Una suscripción "de navegador" de verdad: par de llaves ECDH P-256 + secreto */
function browserSubscription(endpoint) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = crypto.randomBytes(16);
  return {
    ecdh, authSecret,
    json: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } },
  };
}

describe('web push', () => {
  const A = browserSubscription('https://fcm.googleapis.com/fcm/send/abc123');

  test('la llave pública se genera una vez y se guarda', async () => {
    assert.equal((await api('get', '/notifications/web-push/key')).status, 401);
    const k1 = ok(await api('get', '/notifications/web-push/key', T.student)).public_key;
    assert.match(k1, /^[A-Za-z0-9_-]{80,}$/);
    const k2 = ok(await api('get', '/notifications/web-push/key', T.admin)).public_key;
    assert.equal(k1, k2);
    const [[row]] = await pool.query('SELECT vapid_public_key, vapid_private_key FROM platform_settings WHERE id = 1');
    assert.equal(row.vapid_public_key, k1);
    assert.ok(row.vapid_private_key);
  });

  test('suscribir: valida la suscripción y la guarda', async () => {
    const bad = { ...A.json, endpoint: 'http://inseguro.example/x' };
    assert.equal((await api('post', '/notifications/web-push', T.student, { subscription: bad })).status, 400);
    assert.equal((await api('post', '/notifications/web-push', T.student, { subscription: { endpoint: A.json.endpoint, keys: { p256dh: 'x', auth: 'y' } } })).status, 400);
    const r = ok(await api('post', '/notifications/web-push', T.student, { subscription: A.json, device_name: 'Chrome en Android' }));
    assert.equal(r.devices, 1);
    // Repetir no duplica
    assert.equal(ok(await api('post', '/notifications/web-push', T.student, { subscription: A.json })).devices, 1);
    const [[row]] = await pool.query("SELECT user_id, platform, token, subscription FROM push_tokens WHERE platform = 'web'");
    assert.equal(row.user_id, 2);
    assert.match(row.token, /^web:[0-9a-f]{64}$/);
  });

  test('notificación de prueba: cifrada para ese navegador, con título y a dónde lleva', async () => {
    sent.length = 0;
    const r = ok(await api('post', '/notifications/web-push/test', T.student));
    assert.equal(r.sent, 1);
    assert.equal(sent[0].payload.url, '/profile');
    assert.match(sent[0].payload.title, /Notificaciones activadas/);
    assert.ok(sent[0].options.vapidDetails.publicKey);
    // Sin suscripciones: aviso claro
    assert.equal((await api('post', '/notifications/web-push/test', T.admin)).status, 400);
  });

  test('el cifrado es el que el navegador sabe abrir (RFC 8291)', async () => {
    const real = require('web-push');
    const keys = await webpush.vapidKeys();
    const details = real.generateRequestDetails(A.json, JSON.stringify({ title: 'Hola', body: 'Prueba', url: '/payments' }), {
      TTL: 60, vapidDetails: { subject: 'mailto:no-reply@budodesk.com', publicKey: keys.publicKey, privateKey: keys.privateKey },
    });
    assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
    assert.match(details.headers.Authorization, /^vapid t=.+, k=/);
    const ece = require('http_ece');
    const plain = ece.decrypt(details.body, { version: 'aes128gcm', privateKey: A.ecdh, authSecret: A.authSecret });
    assert.deepEqual(JSON.parse(plain.toString()), { title: 'Hola', body: 'Prueba', url: '/payments' });
  });

  test('la cola de notificaciones lo envía al navegador con la pantalla correcta', async () => {
    sent.length = 0;
    await pool.query('DELETE FROM notification_deliveries');
    await notify.notify(1, [2], { type: 'payment_due', title: 'Tu pago vence pronto', body: 'Mensualidad', data: { screen: 'payments' }, channels: ['push'] });
    await notify.processDeliveries();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload, { title: 'Tu pago vence pronto', body: 'Mensualidad', url: '/payments' });
    const [[d]] = await pool.query("SELECT status FROM notification_deliveries WHERE channel = 'push' ORDER BY id DESC LIMIT 1");
    assert.equal(d.status, 'sent');
  });

  test('un error temporal se reintenta; una suscripción muerta (410) se borra', async () => {
    failWith = 500;
    await notify.notify(1, [2], { type: 'x', title: 'Reintento', channels: ['push'] });
    await notify.processDeliveries();
    let [[d]] = await pool.query("SELECT status, attempts, error FROM notification_deliveries WHERE channel = 'push' ORDER BY id DESC LIMIT 1");
    assert.equal(d.status, 'queued');
    assert.equal(d.attempts, 1);
    assert.match(d.error, /HTTP 500/);

    failWith = 410;
    await pool.query("UPDATE notification_deliveries SET next_attempt_at = NOW() - INTERVAL 1 MINUTE WHERE status = 'queued'");
    await notify.processDeliveries();
    [[d]] = await pool.query("SELECT status FROM notification_deliveries WHERE channel = 'push' ORDER BY id DESC LIMIT 1");
    assert.equal(d.status, 'skipped');
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM push_tokens WHERE platform = 'web'");
    assert.equal(Number(n), 0);
    failWith = null;
  });

  test('equipo compartido: la suscripción pasa a quien inicia sesión; quitarla solo afecta a esa cuenta', async () => {
    ok(await api('post', '/notifications/web-push', T.student, { subscription: A.json }));
    ok(await api('post', '/notifications/web-push', T.admin, { subscription: A.json }));
    const [[row]] = await pool.query("SELECT user_id FROM push_tokens WHERE platform = 'web'");
    assert.equal(row.user_id, 1);
    ok(await api('delete', '/notifications/web-push', T.student, { endpoint: A.json.endpoint })); // no es suya: nada
    assert.equal((await pool.query("SELECT COUNT(*) n FROM push_tokens WHERE platform = 'web'"))[0][0].n, 1);
    ok(await api('delete', '/notifications/web-push', T.admin, { endpoint: A.json.endpoint }));
    assert.equal((await pool.query("SELECT COUNT(*) n FROM push_tokens WHERE platform = 'web'"))[0][0].n, 0);
  });
});
