/**
 * Registro de dojos con prueba gratis: solicitud pública, aprobación del superadmin,
 * avisos de fin de prueba y solo lectura al vencer.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD, today } = require('./helpers');

let request; let app; let pool; let outbox; let svc;
const T = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  ({ outbox } = require('../src/services/mailer'));
  svc = require('../src/modules/signup/signup.service');
  app = require('../src/app').createApp();
  await pool.query('UPDATE users SET is_superadmin = 1 WHERE id = 1');
  T.super = await login('admin@seikoukan.mx');
  T.other = await login('admin@otro.mx');
});
after(async () => { await pool.end(); });

async function login(identifier, password = PASSWORD, extra = {}) {
  const r = await request(app).post('/api/v2/auth/login').send({ identifier, password, ...extra });
  if (r.status !== 200) assert.fail(`login ${identifier}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.access_token;
}
const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};
const ok = (r, status = 200) => {
  if (r.status !== status) assert.fail(`HTTP ${r.status} (esperado ${status}): ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const mails = (template, to) => outbox.filter((m) => m.template === template && (!to || m.to === to));
const form = (extra = {}) => ({
  dojo_name: 'Karate Do Norte', slug: 'karate-norte', first_name: 'Laura', last_name: 'Ruiz',
  email: 'laura@karatenorte.mx', phone: '+52 81 1234 5678', city: 'Monterrey', timezone: 'America/Monterrey',
  disciplines: 'Karate', students_estimate: 40, message: 'Hola', terms_accepted: true, ...extra,
});

describe('solicitud pública', () => {
  test('configuración y direcciones disponibles', async () => {
    assert.deepEqual(ok(await api('get', '/signup/config')), { enabled: true, trial_days: 30, contact: null });
    assert.deepEqual(ok(await api('get', '/signup/slug?slug=seikoukan')), { available: false, reason: 'taken' });
    assert.deepEqual(ok(await api('get', '/signup/slug?slug=admin')), { available: false, reason: 'reserved' });
    assert.deepEqual(ok(await api('get', '/signup/slug?slug=karate-norte')), { available: true });
    assert.equal((await api('get', '/signup/slug?slug=-mal')).status, 400);
  });

  test('envía la solicitud y avisa a quien se registra y al superadmin', async () => {
    const before = outbox.length;
    const r = ok(await api('post', '/signup', null, form()), 201);
    assert.equal(r.status, 'pending');
    const row = (await pool.query('SELECT * FROM dojo_signups WHERE id = ?', [r.id]))[0][0];
    assert.equal(row.slug, 'karate-norte');
    assert.equal(row.timezone, 'America/Monterrey');
    assert.equal((await pool.query("SELECT COUNT(*) AS n FROM dojos WHERE slug = 'karate-norte'"))[0][0].n, 0, 'aún no hay dojo');
    const sent = outbox.slice(before);
    assert.ok(sent.some((m) => m.template === 'signup_received' && m.to === 'laura@karatenorte.mx'));
    assert.ok(sent.some((m) => m.template === 'signup_new' && m.to === 'admin@seikoukan.mx' && m.vars.url.includes('/platform')));
    // la dirección ya está pedida
    assert.deepEqual(ok(await api('get', '/signup/slug?slug=karate-norte')), { available: false, reason: 'pending' });
  });

  test('rechaza duplicados, términos sin aceptar y bots', async () => {
    let r = await api('post', '/signup', null, form({ slug: 'otro-karate' }));
    assert.equal(r.status, 409); assert.equal(r.body.code, 'SIGNUP_PENDING');
    r = await api('post', '/signup', null, form({ email: 'otra@x.mx' }));
    assert.equal(r.status, 409); assert.equal(r.body.code, 'SLUG_TAKEN');
    r = await api('post', '/signup', null, form({ email: 'x@x.mx', slug: 'x-dojo', terms_accepted: false }));
    assert.equal(r.status, 400);
    const n = (await pool.query('SELECT COUNT(*) AS n FROM dojo_signups'))[0][0].n;
    ok(await api('post', '/signup', null, form({ email: 'bot@x.mx', slug: 'bot-dojo', website: 'http://spam' })), 201);
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM dojo_signups'))[0][0].n, n, 'el bot no se guarda');
  });

  test('con registros cerrados responde 403', async () => {
    ok(await api('put', '/platform/signups/settings', T.super, { signup_enabled: false }));
    const r = await api('post', '/signup', null, form({ email: 'y@y.mx', slug: 'y-dojo' }));
    assert.equal(r.status, 403); assert.equal(r.body.code, 'SIGNUP_CLOSED');
    assert.equal(ok(await api('get', '/signup/config')).enabled, false);
    ok(await api('put', '/platform/signups/settings', T.super, { signup_enabled: true, trial_days: 14 }));
  });
});

describe('revisión del superadmin', () => {
  test('solo el superadmin ve las solicitudes', async () => {
    assert.equal((await api('get', '/platform/signups', T.other)).status, 403);
    const d = ok(await api('get', '/platform/signups', T.super));
    assert.equal(d.pending, 1);
    assert.equal(d.settings.trial_days, 14);
    assert.equal(d.signups[0].email, 'laura@karatenorte.mx');
    assert.equal(d.signups[0].email_has_account, false);
    assert.equal(d.signups[0].ip_address, undefined, 'no expone la IP');
  });

  test('aprobar crea el dojo en prueba y el dueño crea su contraseña desde el correo', async () => {
    const [s] = ok(await api('get', '/platform/signups', T.super)).signups;
    const d = ok(await api('post', `/platform/signups/${s.id}/approve`, T.super, { name: 'Karate Do del Norte' }), 201);
    assert.equal(d.dojo.status, 'trial');
    assert.equal(d.dojo.name, 'Karate Do del Norte');
    assert.equal(d.email_sent, true);
    const dojo = (await pool.query("SELECT *, DATE_FORMAT(trial_ends_at, '%Y-%m-%d') AS ends FROM dojos WHERE slug = 'karate-norte'"))[0][0];
    assert.equal(dojo.timezone, 'America/Monterrey');
    assert.equal(dojo.city, 'Monterrey');
    assert.equal(dojo.ends, require('../src/utils/dates').addDays(require('../src/utils/dates').todayIn('America/Monterrey'), 14));

    const [mail] = mails('signup_approved_new', 'laura@karatenorte.mx');
    assert.ok(mail, 'correo de bienvenida');
    assert.equal(mail.vars.days, 14);
    const url = new URL(mail.vars.url);
    assert.equal(url.pathname, '/set-password');
    assert.equal(url.searchParams.get('dojo'), 'karate-norte');
    ok(await api('post', '/account/password/reset', null, { token: url.searchParams.get('token'), password: 'Karate-Norte-2026' }));
    const token = await login('laura@karatenorte.mx', 'Karate-Norte-2026', { dojo_slug: 'karate-norte' });
    const me = ok(await api('get', '/auth/me', token));
    const current = me.dojos.find((x) => x.slug === 'karate-norte');
    assert.ok(current.roles.includes('owner'));
    assert.equal(current.status, 'trial');
    assert.equal(current.trial_ends_at, dojo.ends);

    const again = await api('post', `/platform/signups/${s.id}/approve`, T.super, {});
    assert.equal(again.status, 409);
  });

  test('si el correo ya tiene cuenta, solo le avisa que entre', async () => {
    const r = ok(await api('post', '/signup', null, form({ email: 'admin@otro.mx', slug: 'judo-sur', dojo_name: 'Judo Sur' })), 201);
    const d = ok(await api('post', `/platform/signups/${r.id}/approve`, T.super, { trial_days: 7 }), 201);
    assert.equal(d.owner.has_password, true);
    const [mail] = mails('signup_approved', 'admin@otro.mx');
    assert.ok(mail);
    assert.equal(new URL(mail.vars.url).pathname, '/login');
    assert.equal(mail.vars.days, 7);
  });

  test('rechazar con motivo y aviso', async () => {
    const r = ok(await api('post', '/signup', null, form({ email: 'no@x.mx', slug: 'no-dojo' })), 201);
    const d = ok(await api('post', `/platform/signups/${r.id}/reject`, T.super, { reason: 'Datos incompletos', notify: true }));
    assert.equal(d.email_sent, true);
    assert.equal(mails('signup_rejected_reason', 'no@x.mx')[0].vars.reason, 'Datos incompletos');
    assert.equal(ok(await api('get', '/signup/slug?slug=no-dojo')).available, true, 'la dirección se libera');
    const all = ok(await api('get', '/platform/signups?status=all', T.super));
    assert.equal(all.pending, 0);
    assert.equal(all.signups.find((x) => x.id === r.id).status, 'rejected');
  });
});

describe('fin de la prueba', () => {
  let dojoId; let owner;
  before(async () => {
    dojoId = (await pool.query("SELECT id FROM dojos WHERE slug = 'karate-norte'"))[0][0].id;
    owner = await login('laura@karatenorte.mx', 'Karate-Norte-2026', { dojo_slug: 'karate-norte' });
  });
  const setEnds = (days) => pool.query("UPDATE dojos SET trial_ends_at = ?, status = 'trial' WHERE id = ?",
    [require('../src/utils/dates').addDays(require('../src/utils/dates').todayIn('America/Monterrey'), days), dojoId]);

  test('avisa una semana antes y el último día, sin repetir', async () => {
    await setEnds(5);
    let r = await svc.trialSweep();
    assert.equal(r.expired, 0);
    assert.equal(mails('trial_ending', 'laura@karatenorte.mx').length, 1);
    assert.equal(mails('trial_ending', 'laura@karatenorte.mx')[0].vars.days, 6);
    r = await svc.trialSweep();
    assert.equal(mails('trial_ending', 'laura@karatenorte.mx').length, 1, 'no repite');
    await pool.query('UPDATE dojos SET trial_ends_at = ? WHERE id = ?',
      [require('../src/utils/dates').todayIn('America/Monterrey'), dojoId]);
    await svc.trialSweep();
    assert.equal(mails('trial_last_day', 'laura@karatenorte.mx').length, 1);
  });

  test('al vencer queda en solo lectura: consulta sí, cambios no', async () => {
    await pool.query('UPDATE dojos SET trial_ends_at = ? WHERE id = ?',
      [require('../src/utils/dates').addDays(require('../src/utils/dates').todayIn('America/Monterrey'), -1), dojoId]);
    const r = await svc.trialSweep();
    assert.equal(r.expired, 1);
    assert.equal((await pool.query('SELECT status FROM dojos WHERE id = ?', [dojoId]))[0][0].status, 'expired');
    assert.equal(mails('trial_expired', 'laura@karatenorte.mx').length, 1);

    // sigue pudiendo entrar
    const token = await login('laura@karatenorte.mx', 'Karate-Norte-2026', { dojo_slug: 'karate-norte' });
    ok(await api('get', '/members', token));
    ok(await api('get', '/dojo', token));
    const w = await api('post', '/members', token, { first_name: 'Nuevo', roles: ['student'] });
    assert.equal(w.status, 403);
    assert.equal(w.body.code, 'DOJO_READ_ONLY');
    assert.equal((await api('patch', '/dojo', owner, { name: 'X' })).status, 403);
    // su propia cuenta sí
    ok(await api('patch', '/me/settings', token, { theme: 'dark' }));
    // la página pública del dojo funciona, pero sin registro de alumnos
    const pub = ok(await api('get', '/account/dojos/karate-norte'));
    assert.equal(pub.read_only, true);
    assert.equal(pub.self_registration, 'closed');
  });

  test('el superadmin extiende la prueba y se reabre', async () => {
    const ends = require('../src/utils/dates').addDays(require('../src/utils/dates').todayIn('America/Monterrey'), 10);
    const d = ok(await api('patch', `/platform/dojos/${dojoId}`, T.super, { status: 'expired', trial_ends_at: ends }));
    assert.equal(d.status, 'trial');
    const row = (await pool.query('SELECT trial_notices FROM dojos WHERE id = ?', [dojoId]))[0][0];
    assert.equal(row.trial_notices, '', 'los avisos empiezan de nuevo');
    const token = await login('laura@karatenorte.mx', 'Karate-Norte-2026', { dojo_slug: 'karate-norte' });
    ok(await api('patch', '/dojo', token, { name: 'Karate Do del Norte AC' }));
  });

  test('página pública: dojo inexistente 404, suspendido 403', async () => {
    assert.equal((await api('get', '/account/dojos/no-existe-123')).status, 404);
    await pool.query("UPDATE dojos SET status = 'suspended' WHERE id = ?", [dojoId]);
    const r = await api('get', '/account/dojos/karate-norte');
    assert.equal(r.status, 403); assert.equal(r.body.code, 'DOJO_UNAVAILABLE');
    await pool.query("UPDATE dojos SET status = 'trial' WHERE id = ?", [dojoId]);
  });

  test('la bitácora del dojo no muestra lo de la plataforma, salvo al superadmin', async () => {
    const token = await login('laura@karatenorte.mx', 'Karate-Norte-2026', { dojo_slug: 'karate-norte' });
    ok(await api('patch', '/dojo', token, { name: 'Karate Do del Norte' }));
    const own = ok(await api('get', '/dojo/audit-log', token));
    assert.ok(own.length > 0, 've su propia actividad');
    assert.ok(own.every((r) => !r.platform && !['dojo_signup', 'platform_dojo'].includes(r.entity)), JSON.stringify(own));
    // superadmin en modo soporte: ve todo, marcado
    const sup = ok(await api('post', '/auth/switch-dojo', T.super, { dojo_id: dojoId })).access_token;
    const all = ok(await api('get', '/dojo/audit-log', sup));
    assert.ok(all.some((r) => r.platform && r.entity === 'dojo_signup'));
    assert.ok(all.some((r) => r.platform && r.entity === 'platform_dojo'));
    assert.ok(all.length > own.length);
  });

  test('activo (pagado) ya no vence', async () => {
    ok(await api('patch', `/platform/dojos/${dojoId}`, T.super, { status: 'active', plan: 'basic' }));
    await pool.query('UPDATE dojos SET trial_ends_at = ? WHERE id = ?', [today(-5), dojoId]);
    const r = await svc.trialSweep();
    assert.equal(r.expired, 0);
    assert.equal((await pool.query('SELECT status FROM dojos WHERE id = ?', [dojoId]))[0][0].status, 'active');
  });
});

test('dojoUrl usa el subdominio del dojo', () => {
  const env = require('../src/config/env');
  const prev = env.APP_BASE_URL;
  try {
    env.APP_BASE_URL = 'https://seikoukan.budodesk.com';
    assert.equal(svc.dojoUrl('karate', '/login'), 'https://karate.budodesk.com/login');
    env.APP_BASE_URL = 'https://budodesk.com';
    assert.equal(svc.dojoUrl('karate'), 'https://karate.budodesk.com/');
    env.APP_BASE_URL = 'http://localhost:8081';
    assert.equal(svc.dojoUrl('karate', '/login'), 'http://localhost:8081/login?dojo=karate');
  } finally { env.APP_BASE_URL = prev; }
});

describe('eliminar un dojo (derecho de cancelación)', () => {
  test('candados: debe estar cancelado, confirmar la dirección y no estar dentro', async () => {
    const id = (await pool.query("SELECT id FROM dojos WHERE slug = 'judo-sur'"))[0][0].id;
    let r = await api('delete', `/platform/dojos/${id}`, T.super, { confirm_slug: 'judo-sur' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'DOJO_NOT_CANCELLED');
    ok(await api('patch', `/platform/dojos/${id}`, T.super, { status: 'cancelled' }));
    r = await api('delete', `/platform/dojos/${id}`, T.super, { confirm_slug: 'judo' });
    assert.equal(r.status, 400);
    const inside = ok(await api('post', '/auth/switch-dojo', T.super, { dojo_id: id })).access_token;
    r = await api('delete', `/platform/dojos/${id}`, inside, { confirm_slug: 'judo-sur' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'DOJO_IN_USE');
    assert.equal((await api('delete', `/platform/dojos/${id}`, T.other, { confirm_slug: 'judo-sur' })).status, 403);
  });

  test('borra el dojo y las cuentas que solo eran de ese dojo; quien está en otro dojo la conserva', async () => {
    const judo = (await pool.query("SELECT id FROM dojos WHERE slug = 'judo-sur'"))[0][0].id;
    const d = ok(await api('delete', `/platform/dojos/${judo}`, T.super, { confirm_slug: 'judo-sur' }));
    assert.equal(d.accounts_deleted, 0, 'admin@otro.mx también es de «otro»');
    assert.ok((await pool.query("SELECT id FROM users WHERE email = 'admin@otro.mx'"))[0][0]);

    const karate = (await pool.query("SELECT id FROM dojos WHERE slug = 'karate-norte'"))[0][0].id;
    ok(await api('patch', `/platform/dojos/${karate}`, T.super, { status: 'cancelled' }));
    const k = ok(await api('delete', `/platform/dojos/${karate}`, T.super, { confirm_slug: 'karate-norte' }));
    assert.equal(k.accounts_deleted, 1);
    assert.equal((await pool.query("SELECT COUNT(*) AS n FROM users WHERE email = 'laura@karatenorte.mx'"))[0][0].n, 0);
    for (const t of ['audit_log', 'dojo_signups', 'dojo_members']) {
      assert.equal((await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE dojo_id = ?`, [karate]))[0][0].n, 0, t);
    }
    const [[log]] = await pool.query("SELECT after_data FROM audit_log WHERE action = 'delete' AND entity = 'platform_dojo' AND entity_id = ?", [karate]);
    assert.equal(log.after_data.slug, 'karate-norte');
    assert.equal(log.after_data.email, undefined, 'sin datos personales');
    // la dirección queda libre
    assert.equal(ok(await api('get', '/signup/slug?slug=karate-norte')).available, true);
    // Seikoukan y «otro» siguen igual
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM dojos WHERE id IN (1, 2)'))[0][0].n, 2);
  });
});
