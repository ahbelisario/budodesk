/**
 * "Ver como" (soporte): solo lectura, permisos y bitácora.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD } = require('./helpers');

let request; let app; let pool;
const T = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  // un admin (no dueño) en el dojo 1
  await pool.query("INSERT INTO users (id, email, password_hash, email_verified_at) SELECT 5, 'admin2@seikoukan.mx', password_hash, NOW() FROM users WHERE id = 1");
  await pool.query("INSERT INTO user_profiles (user_id, first_name) VALUES (5, 'Admin2')");
  await pool.query("INSERT INTO dojo_members (dojo_id, user_id, status) VALUES (1, 5, 'active')");
  await pool.query("INSERT INTO dojo_member_roles (dojo_id, user_id, role) VALUES (1, 5, 'admin')");
  T.owner = await login('admin@seikoukan.mx');
  T.admin2 = await login('admin2@seikoukan.mx');
  T.sensei = await login('sensei@ambos.mx');
});
after(async () => { await pool.end(); });

async function login(identifier, slug = 'seikoukan') {
  const r = await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, dojo_slug: slug });
  return r.body.data.access_token;
}
const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`).set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};

test('el admin ve como un alumno: mismo /auth/me, y no puede cambiar nada', async () => {
  const r = await api('post', '/impersonation', T.admin2, { user_id: 2 });
  assert.equal(r.status, 201);
  const imp = r.body.data.access_token;
  assert.equal(r.body.data.user.id, 2);
  assert.deepEqual(r.body.data.dojo.roles, ['student']);
  assert.ok(!r.body.data.refresh_token, 'no hay refresh token');

  const me = await api('get', '/auth/me', imp);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.id, 2);

  const w = await api('patch', '/me/profile', imp, { first_name: 'Hack' });
  assert.equal(w.status, 403);
  assert.equal(w.body.code, 'IMPERSONATION_READ_ONLY');
  assert.equal((await api('post', '/auth/logout', imp)).status, 403);

  // un alumno no ve la lista de miembros, tampoco "viendo como" él
  assert.equal((await api('get', '/members', imp)).status, 403);

  assert.equal((await api('post', '/impersonation/end', imp)).status, 200);
  const [rows] = await pool.query("SELECT action, user_id, entity_id FROM audit_log WHERE entity = 'user' AND action LIKE 'impersonate%' ORDER BY id");
  assert.deepEqual(rows.map((x) => [x.action, x.user_id, x.entity_id]), [['impersonate_start', 5, '2'], ['impersonate_end', 5, '2']]);
});

test('el admin no puede ver como el dueño ni como otro admin; el alumno no puede usarlo', async () => {
  assert.equal((await api('post', '/impersonation', T.admin2, { user_id: 1 })).status, 403);
  assert.equal((await api('post', '/impersonation', T.owner, { user_id: 5 })).status, 403, 'tampoco el dueño a otro admin');
  assert.equal((await api('post', '/impersonation', T.owner, { user_id: 3 })).status, 201, 'el dueño sí a un instructor');
});

test('superadmin puede ver como el dueño; nadie fuera del dojo', async () => {
  await pool.query('UPDATE users SET is_superadmin = 1 WHERE id = 4');
  const sup = await login('admin@otro.mx', 'otro');
  const sw = await api('post', '/auth/switch-dojo', sup, { dojo_id: 1 });
  const supInDojo1 = sw.body.data.access_token;
  const r = await api('post', '/impersonation', supInDojo1, { user_id: 1 });
  assert.equal(r.status, 201);
  assert.equal((await api('get', '/members', r.body.data.access_token)).status, 200, 'como dueño ve miembros');
  assert.equal((await api('post', '/impersonation', supInDojo1, { user_id: 999 })).status, 404, 'no es miembro');
  assert.equal((await api('post', '/impersonation', T.sensei, { user_id: 2 })).status, 403);
});

test('al cerrar la sesión de quien mira, el token de "ver como" deja de servir', async () => {
  const r = await api('post', '/impersonation', T.admin2, { user_id: 3 });
  const imp = r.body.data.access_token;
  assert.equal((await api('get', '/auth/me', imp)).status, 200);
  await api('post', '/auth/logout', T.admin2);
  assert.equal((await api('get', '/auth/me', imp)).status, 401);
});
