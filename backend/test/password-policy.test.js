/**
 * Política de contraseñas configurable (Plataforma → Seguridad).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD } = require('./helpers');
const { failures } = require('../src/services/passwordPolicy');

let request; let app; let pool;
const T = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  await pool.query('UPDATE users SET is_superadmin = 1 WHERE id = 1');
  T.super = await login('admin@seikoukan.mx');
  T.student = await login('alumno@seikoukan.mx');
});
after(async () => { await pool.end(); });

async function login(identifier) {
  const r = await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, dojo_slug: 'seikoukan' });
  return r.body.data.access_token;
}
const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};

test('reglas: mayúsculas, números y símbolos con acentos y ñ', () => {
  const p = { min_length: 8, require_upper: true, require_lower: true, require_number: true, require_symbol: true };
  assert.deepEqual(failures('corta', p), ['min_length', 'upper', 'number', 'symbol']);
  assert.deepEqual(failures('Ñandú2026!', p), []);
  assert.deepEqual(failures('ÑANDÚ 2026', p), ['lower', 'symbol'], 'el espacio no cuenta como símbolo');
});

test('por omisión: 10 caracteres, sin más requisitos; la política es pública', async () => {
  const r = await api('get', '/account/password-policy');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.min_length, 10);
  assert.equal(r.body.data.require_symbol, false);
});

test('solo el superadmin la cambia; se aplica al cambiar contraseña', async () => {
  const body = { min_length: 12, require_upper: true, require_lower: true, require_number: true, require_symbol: true };
  assert.equal((await api('put', '/platform/security/password-policy', T.student, body)).status, 403);
  assert.equal((await api('put', '/platform/security/password-policy', T.super, { ...body, min_length: 4 })).status, 400);
  const r = await api('put', '/platform/security/password-policy', T.super, body);
  assert.equal(r.status, 200);
  assert.equal((await api('get', '/account/password-policy')).body.data.min_length, 12);

  const weak = await api('post', '/me/password', T.student, { current_password: PASSWORD, new_password: 'sololetrasminusculas' });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, 'PASSWORD_WEAK');
  assert.deepEqual(weak.body.details.map((d) => d.rule), ['upper', 'number', 'symbol']);
  assert.match(weak.body.message, /mayúscula/);

  const good = await api('post', '/me/password', T.student, { current_password: PASSWORD, new_password: 'Bien-Segura-2026' });
  assert.equal(good.status, 200, JSON.stringify(good.body));
});
