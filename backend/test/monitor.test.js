/**
 * Monitoreo: alertas con correo configurable, recordatorio diario, cierre automático,
 * fallas de correo, tareas, webhooks, respaldos atrasados, disco y latido.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { resetDatabase, PASSWORD } = require('./helpers');

let request; let app; let pool; let outbox; let mon; let mailer;
const T = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  mailer = require('../src/services/mailer');
  ({ outbox } = mailer);
  mon = require('../src/modules/platform/monitor.service');
  app = require('../src/app').createApp();
  await pool.query('UPDATE users SET is_superadmin = 1 WHERE id = 1');
  T.super = await login('admin@seikoukan.mx');
  T.other = await login('admin@otro.mx');
});
after(async () => { await pool.end(); });

async function login(identifier) {
  const r = await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD });
  return r.body.data.access_token;
}
const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`).set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};
const ok = (r, status = 200) => {
  if (r.status !== status) assert.fail(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const alerts = (to) => outbox.filter((m) => m.template === 'platform_alert' && (!to || m.to === to));
const openAlert = async (kind, key = '') => (await pool.query(
  'SELECT * FROM platform_alerts WHERE kind = ? AND alert_key = ? AND resolved_at IS NULL', [kind, key]))[0][0];
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('ajustes', () => {
  test('solo el superadmin; valida correos y latido', async () => {
    assert.equal((await api('get', '/platform/monitoring', T.other)).status, 403);
    let r = await api('put', '/platform/monitoring/settings', T.super, { alerts_emails: 'yo@budodesk.com, malo' });
    assert.equal(r.status, 400);
    r = await api('put', '/platform/monitoring/settings', T.super, { heartbeat_url: 'http://x.com' });
    assert.equal(r.status, 400);
    const s = ok(await api('put', '/platform/monitoring/settings', T.super,
      { alerts_emails: 'Alertas@BudoDesk.com; ops@budodesk.com  alertas@budodesk.com', alerts_push: false }));
    assert.deepEqual(s.alerts_emails, ['alertas@budodesk.com', 'ops@budodesk.com']);
    assert.equal(s.alerts_push, false);
    const d = ok(await api('get', '/platform/monitoring', T.super));
    assert.ok(d.status.version);
    assert.ok(d.status.disks.backups.total > 0);
  });

  test('alerta de prueba a los correos configurados', async () => {
    outbox.length = 0;
    const r = ok(await api('post', '/platform/monitoring/test', T.super));
    assert.equal(r.ok, true);
    assert.deepEqual(alerts().map((m) => m.to).sort(), ['alertas@budodesk.com', 'ops@budodesk.com']);
    const d = ok(await api('get', '/platform/monitoring?status=resolved', T.super));
    assert.equal(d.alerts[0].kind, 'test');
  });
});

describe('alertas', () => {
  test('abre, cuenta sin repetir el correo, recuerda a las 24 h y se cierra sola', async () => {
    outbox.length = 0;
    await mon.raise({ kind: 'job', key: 'billing', title: 'Falló X', detail: 'uno' });
    assert.equal(alerts().length, 2, 'un correo por destinatario');
    await mon.raise({ kind: 'job', key: 'billing', title: 'Falló X', detail: 'dos' });
    assert.equal(alerts().length, 2, 'sin repetir');
    let a = await openAlert('job', 'billing');
    assert.equal(a.count, 2); assert.equal(a.detail, 'dos');
    await pool.query('UPDATE platform_alerts SET notified_at = NOW() - INTERVAL 25 HOUR WHERE id = ?', [a.id]);
    await mon.raise({ kind: 'job', key: 'billing', title: 'Falló X', detail: 'tres' });
    assert.equal(alerts().length, 4);
    assert.match(alerts().at(-1).vars.title, /^Sigue pendiente/);
    assert.equal(await mon.resolve('job', 'billing'), 1);
    assert.equal(await openAlert('job', 'billing'), undefined);
    // una nueva falla abre otra alerta
    await mon.raise({ kind: 'job', key: 'billing', title: 'Falló X' });
    a = await openAlert('job', 'billing');
    assert.equal(a.count, 1);
    ok(await api('post', `/platform/monitoring/alerts/${a.id}/resolve`, T.super));
    assert.equal(await openAlert('job', 'billing'), undefined);
  });

  test('sin correos configurados avisa a los superadmins', async () => {
    ok(await api('put', '/platform/monitoring/settings', T.super, { alerts_emails: '' }));
    outbox.length = 0;
    await mon.raise({ kind: 'disk', key: 'x', title: 'Disco' });
    assert.deepEqual(alerts().map((m) => m.to), ['admin@seikoukan.mx']);
    await mon.resolve('disk', 'x');
    ok(await api('put', '/platform/monitoring/settings', T.super, { alerts_emails: 'alertas@budodesk.com' }));
  });

  test('una tarea automática que falla abre su alerta y al funcionar la cierra', async () => {
    const { job } = require('../src/jobs/scheduler');
    assert.equal(await job('demo', 'demostración', async () => { throw new Error('se cayó'); }), null);
    const a = await openAlert('job', 'demo');
    assert.equal(a.severity, 'critical');
    assert.match(a.detail, /se cayó/);
    assert.equal(await job('demo', 'demostración', async () => 5), 5);
    assert.equal(await openAlert('job', 'demo'), undefined);
  });

  test('si el SMTP falla: alerta (sin bucle) y al volver se resuelve', async () => {
    mailer._setForceError('connect ECONNREFUSED');
    try {
      const r = await mailer.sendMail('notification', { to: 'x@x.mx', vars: { dojo: 'D', title: 't', body: 'b' } });
      assert.equal(r.sent, false);
      await wait();
      const a = await openAlert('mail');
      assert.ok(a);
      assert.match(a.detail, /ECONNREFUSED/);
      assert.ok(a.notify_error, 'el correo de la alerta tampoco sale (y el push está apagado)');
    } finally { mailer._setForceError(null); }
    await mailer.sendMail('notification', { to: 'x@x.mx', vars: { dojo: 'D', title: 't', body: 'b' } });
    await wait();
    assert.equal(await openAlert('mail'), undefined);
  });
});

describe('revisiones', () => {
  test('avisos de pago con error', async () => {
    await mon.sweep(); // primera vuelta: solo marca desde dónde revisar
    await pool.query(
      `INSERT INTO payment_webhook_events (dojo_id, provider, event_id, event_type, payload, verified, processed_at, error)
       VALUES (1, 'paypal', 'ev-1', 'PAYMENT.CAPTURE.COMPLETED', '{}', 0, NOW(), 'Firma no verificada'),
              (1, 'paypal', 'ev-2', 'PAYMENT.CAPTURE.COMPLETED', '{}', 0, NOW(), 'Firma no verificada')`);
    await mon.sweep();
    const a = await openAlert('webhook', 'paypal:1');
    assert.ok(a);
    assert.match(a.title, /PayPal/);
    assert.match(a.detail, /2 aviso/);
    await mon.sweep();
    assert.equal((await openAlert('webhook', 'paypal:1')).count, 1, 'no vuelve a contar los mismos');
  });

  test('respaldos activos sin uno bueno en 48 h; se resuelve con uno nuevo', async () => {
    await pool.query('UPDATE platform_settings SET backup_enabled = 1 WHERE id = 1');
    await pool.query(`INSERT INTO backups (filename, \`trigger\`, status, started_at, finished_at)
                      VALUES ('viejo.tar.gz', 'auto', 'ok', NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY)`);
    await mon.sweep();
    assert.equal((await openAlert('backup_stale')).severity, 'critical');
    await pool.query(`INSERT INTO backups (filename, \`trigger\`, status, started_at, finished_at)
                      VALUES ('nuevo.tar.gz', 'auto', 'ok', NOW(), NOW())`);
    await mon.sweep();
    assert.equal(await openAlert('backup_stale'), undefined);
    await pool.query('UPDATE platform_settings SET backup_enabled = 0 WHERE id = 1');
  });

  test('disco por debajo del umbral', async () => {
    await pool.query('UPDATE platform_settings SET disk_alert_pct = 100 WHERE id = 1');
    await mon.sweep();
    assert.ok(await openAlert('disk', 'backups'));
    await pool.query('UPDATE platform_settings SET disk_alert_pct = 1 WHERE id = 1');
    await mon.sweep();
    assert.equal(await openAlert('disk', 'backups'), undefined);
  });

  test('latido: llama a la dirección configurada', async () => {
    let hits = 0;
    const srv = http.createServer((req, res) => { hits += 1; res.end('ok'); }).listen(0);
    const url = `http://127.0.0.1:${srv.address().port}/ping`;
    try {
      await pool.query('UPDATE platform_settings SET heartbeat_url = ? WHERE id = 1', [url]); // (la API pide https)
      const hb = await mon.heartbeat();
      assert.equal(hb.ok, true);
      assert.equal(hits, 1);
      const d = ok(await api('get', '/platform/monitoring', T.super));
      assert.equal(d.status.heartbeat.ok, true);
    } finally { srv.close(); }
    await pool.query('UPDATE platform_settings SET heartbeat_url = ? WHERE id = 1', ['http://127.0.0.1:9/nada']);
    const bad = await mon.heartbeat();
    assert.equal(bad.ok, false);
  });
});
