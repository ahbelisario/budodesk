/**
 * Límites del plan de BudoDesk: Básico (50 alumnos activos, 1 sede, sin finanzas),
 * Pro y prueba sin límites; bajar de plan no quita nada.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD } = require('./helpers');

let request; let app; let pool;
const T = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  await pool.query("UPDATE dojos SET plan = 'basic', status = 'active', self_registration = 'open' WHERE id = 1");
  T.admin = await login('admin@seikoukan.mx');
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
const ok = (r, status = 200) => {
  if (r.status !== status) assert.fail(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const students = async () => (await pool.query(
  `SELECT COUNT(*) AS n FROM dojo_members m WHERE m.dojo_id = 1 AND m.status = 'active'
     AND EXISTS (SELECT 1 FROM dojo_member_roles r WHERE r.dojo_id = 1 AND r.user_id = m.user_id AND r.role = 'student')`))[0][0].n;

/** Llena el dojo con alumnos activos hasta tener `total` */
async function fillTo(total) {
  const missing = total - await students();
  for (let i = 0; i < missing; i++) {
    const [u] = await pool.query('INSERT INTO users (email) VALUES (NULL)');
    await pool.query("INSERT INTO user_profiles (user_id, first_name) VALUES (?, 'Relleno')", [u.insertId]);
    await pool.query("INSERT INTO dojo_members (dojo_id, user_id, status, joined_at) VALUES (1, ?, 'active', CURDATE())", [u.insertId]);
    await pool.query("INSERT INTO dojo_member_roles (dojo_id, user_id, role) VALUES (1, ?, 'student')", [u.insertId]);
  }
}

describe('plan Básico', () => {
  test('resumen del plan para la app', async () => {
    const s = ok(await api('get', '/dojo/subscription', T.admin));
    assert.equal(s.effective, 'basic');
    assert.deepEqual(s.limits, { students: 50, locations: 1, finance: false });
    assert.ok(s.usage.students >= 1);
  });

  test('hasta 50 alumnos activos; staff e inactivos no cuentan', async () => {
    await fillTo(49);
    ok(await api('post', '/members', T.admin, { first_name: 'Cincuenta', roles: ['student'] }), 201);
    const r = await api('post', '/members', T.admin, { first_name: 'Cincuenta y uno', roles: ['student'] });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'PLAN_LIMIT');
    assert.equal(r.body.details.feature, 'students');
    assert.equal(r.body.details.limit, 50);
    // staff no es alumno; un alumno inactivo tampoco cuenta
    ok(await api('post', '/members', T.admin, { first_name: 'Recepción', roles: ['staff'] }), 201);
    const inactive = ok(await api('post', '/members', T.admin, { first_name: 'Inactivo', roles: ['student'], status: 'inactive' }), 201);
    // reactivarlo, o volver alumno al staff, ya no cabe
    const re = await api('patch', `/members/${inactive.id}`, T.admin, { status: 'active' });
    assert.equal(re.body.code, 'PLAN_LIMIT');
    const staff = (await pool.query("SELECT user_id FROM user_profiles WHERE first_name = 'Recepción'"))[0][0].user_id;
    const ro = await api('put', `/members/${staff}/roles`, T.admin, { roles: ['staff', 'student'] });
    assert.equal(ro.body.code, 'PLAN_LIMIT');
  });

  test('el autorregistro con el dojo lleno queda pendiente', async () => {
    const r = ok(await api('post', '/account/register', null, {
      dojo_slug: 'seikoukan', email: 'nuevo@alumno.mx', password: 'Alumno-Nuevo-2026', first_name: 'Nuevo', privacy_accepted: true,
    }), 201);
    assert.equal(r.membership_status, 'pending');
  });

  test('una sola sede', async () => {
    const r = await api('post', '/dojo/locations', T.admin, { name: 'Sede norte' });
    assert.equal(r.status, 403);
    assert.equal(r.body.details.feature, 'locations');
    // desactivar la única y crear otra sí se puede (sigue siendo una activa)
    ok(await api('patch', '/dojo/locations/1', T.admin, { active: false }));
    const n = ok(await api('post', '/dojo/locations', T.admin, { name: 'Sede nueva' }), 201);
    assert.equal((await api('patch', '/dojo/locations/1', T.admin, { active: true })).body.code, 'PLAN_LIMIT');
    ok(await api('patch', `/dojo/locations/${n.id}`, T.admin, { active: false }));
    ok(await api('patch', '/dojo/locations/1', T.admin, { active: true }));
  });

  test('sin finanzas; los reportes de alumnos y asistencia sí', async () => {
    for (const url of ['/finance/entries', '/finance/categories', '/reports/finance', '/reports/receivables']) {
      const r = await api('get', url, T.admin);
      assert.equal(r.status, 403, url);
      assert.equal(r.body.code, 'PLAN_LIMIT', url);
    }
    ok(await api('get', '/reports/members', T.admin));
    ok(await api('get', '/reports/attendance', T.admin));
  });
});

describe('Pro, prueba y bajar de plan', () => {
  test('en Pro no hay límites', async () => {
    await pool.query("UPDATE dojos SET plan = 'pro' WHERE id = 1");
    ok(await api('post', '/members', T.admin, { first_name: 'Cincuenta y uno', roles: ['student'] }), 201);
    ok(await api('post', '/dojo/locations', T.admin, { name: 'Sede sur' }), 201);
    ok(await api('get', '/finance/entries', T.admin));
    assert.equal(ok(await api('get', '/dojo/subscription', T.admin)).limits.students, null);
  });

  test('en prueba, todo como Pro aunque el plan diga Básico', async () => {
    await pool.query("UPDATE dojos SET plan = 'basic', status = 'trial' WHERE id = 1");
    ok(await api('post', '/members', T.admin, { first_name: 'En prueba', roles: ['student'] }), 201);
    assert.equal(ok(await api('get', '/dojo/subscription', T.admin)).effective, 'pro');
  });

  test('al bajar a Básico conserva todo, pero no agrega más', async () => {
    await pool.query("UPDATE dojos SET plan = 'basic', status = 'active' WHERE id = 1");
    const s = ok(await api('get', '/dojo/subscription', T.admin));
    assert.ok(s.usage.students > 50, 'nadie se desactivó');
    assert.equal(s.usage.locations, 2, 'las dos sedes siguen activas');
    ok(await api('get', '/members?page_size=100', T.admin));
    assert.equal((await api('post', '/members', T.admin, { first_name: 'Otro', roles: ['student'] })).body.code, 'PLAN_LIMIT');
    // editar a quien ya está sí se puede
    const [[m]] = await pool.query("SELECT user_id FROM user_profiles WHERE first_name = 'En prueba'");
    ok(await api('patch', `/members/${m.user_id}`, T.admin, { notes: 'sigue igual' }));
  });
});
