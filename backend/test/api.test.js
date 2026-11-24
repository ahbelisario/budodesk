const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD } = require('./helpers');

let request; let app; let pool;

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
});
after(async () => { await pool.end(); });

const login = (identifier, extra = {}) =>
  request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, ...extra });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('auth', () => {
  test('login con un solo dojo entra directo a ese dojo', async () => {
    const r = await login('admin@seikoukan.mx');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.dojo.slug, 'seikoukan');
    assert.deepEqual(r.body.data.dojo.roles.sort(), ['admin', 'owner']); // owner implica admin
    assert.ok(r.body.data.access_token && r.body.data.refresh_token);
  });

  test('login con varios dojos pide elegir, y dojo_slug lo resuelve', async () => {
    const r = await login('sensei@ambos.mx');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.dojo, null);
    assert.equal(r.body.data.dojos.length, 2);

    const r2 = await login('sensei@ambos.mx', { dojo_slug: 'otro' });
    assert.equal(r2.body.data.dojo.slug, 'otro');
  });

  test('dojo_slug de un dojo ajeno → 403', async () => {
    const r = await login('alumno@seikoukan.mx', { dojo_slug: 'otro' });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'NOT_A_MEMBER');
  });

  test('contraseña incorrecta → 401 genérico, igual que usuario inexistente', async () => {
    const a = await request(app).post('/api/v2/auth/login').send({ identifier: 'alumno@seikoukan.mx', password: 'mala' });
    const b = await request(app).post('/api/v2/auth/login').send({ identifier: 'nadie@x.mx', password: 'mala' });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.equal(a.body.message, b.body.message);
  });

  test('switch-dojo cambia el contexto; los roles cambian con él', async () => {
    const r = await login('sensei@ambos.mx');
    const sw = await request(app).post('/api/v2/auth/switch-dojo')
      .set(bearer(r.body.data.access_token)).send({ dojo_id: 1 });
    assert.equal(sw.status, 200);
    const me = await request(app).get('/api/v2/auth/me').set(bearer(sw.body.data.access_token));
    assert.deepEqual(me.body.data.dojo.roles, ['instructor']);

    const bad = await request(app).post('/api/v2/auth/switch-dojo')
      .set(bearer(r.body.data.access_token)).send({ dojo_id: 999 });
    assert.equal(bad.status, 403);
  });

  test('refresh rota el token; reusar el viejo cierra toda la familia', async () => {
    const r = await login('alumno@seikoukan.mx');
    const old = r.body.data.refresh_token;

    const r1 = await request(app).post('/api/v2/auth/refresh').send({ refresh_token: old });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.body.data.refresh_token, old);
    assert.equal(r1.body.data.dojo.slug, 'seikoukan'); // conserva el dojo

    const reuse = await request(app).post('/api/v2/auth/refresh').send({ refresh_token: old });
    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.code, 'TOKEN_REUSED');

    // El token nuevo también quedó revocado
    const r2 = await request(app).post('/api/v2/auth/refresh').send({ refresh_token: r1.body.data.refresh_token });
    assert.equal(r2.status, 401);
    // Y el access token de esa familia ya no sirve
    const me = await request(app).get('/api/v2/auth/me').set(bearer(r1.body.data.access_token));
    assert.equal(me.status, 401);
  });

  test('logout invalida el access token al instante', async () => {
    const r = await login('alumno@seikoukan.mx');
    const t = r.body.data.access_token;
    assert.equal((await request(app).post('/api/v2/auth/logout').set(bearer(t))).status, 200);
    const me = await request(app).get('/api/v2/auth/me').set(bearer(t));
    assert.equal(me.status, 401);
    assert.equal(me.body.code, 'SESSION_REVOKED');
  });

  test('sin token o con token alterado → 401', async () => {
    assert.equal((await request(app).get('/api/v2/disciplines')).status, 401);
    const r = await login('alumno@seikoukan.mx');
    const forged = r.body.data.access_token.slice(0, -3) + 'abc';
    assert.equal((await request(app).get('/api/v2/disciplines').set(bearer(forged))).status, 401);
  });

  test('bloqueo tras 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v2/auth/login').send({ identifier: 'admin@otro.mx', password: 'mala' });
    }
    const r = await login('admin@otro.mx');
    assert.equal(r.status, 423);
    await pool.query("UPDATE users SET locked_until = NULL WHERE email = 'admin@otro.mx'");
  });
});

describe('roles y aislamiento por dojo (disciplinas)', () => {
  let adminT; let alumnoT; let otroAdminT; let instructorT;

  before(async () => {
    adminT = (await login('admin@seikoukan.mx')).body.data.access_token;
    alumnoT = (await login('alumno@seikoukan.mx')).body.data.access_token;
    otroAdminT = (await login('admin@otro.mx')).body.data.access_token;
    instructorT = (await login('sensei@ambos.mx', { dojo_slug: 'seikoukan' })).body.data.access_token;
  });

  test('cada dojo solo ve sus disciplinas', async () => {
    const a = await request(app).get('/api/v2/disciplines').set(bearer(adminT));
    assert.deepEqual(a.body.data.map((d) => d.name).sort(), ['Aikido', 'Karate Do']);
    const b = await request(app).get('/api/v2/disciplines').set(bearer(otroAdminT));
    assert.deepEqual(b.body.data.map((d) => d.name), ['Judo']);
  });

  test('pedir por id una disciplina de otro dojo → 404 (no revela que existe)', async () => {
    const r = await request(app).get('/api/v2/disciplines/50').set(bearer(adminT));
    assert.equal(r.status, 404);
    const p = await request(app).patch('/api/v2/disciplines/50').set(bearer(adminT)).send({ name: 'Hackeado' });
    assert.equal(p.status, 404);
  });

  test('alumno e instructor pueden leer pero no crear', async () => {
    assert.equal((await request(app).get('/api/v2/disciplines').set(bearer(alumnoT))).status, 200);
    const c1 = await request(app).post('/api/v2/disciplines').set(bearer(alumnoT)).send({ name: 'X' });
    const c2 = await request(app).post('/api/v2/disciplines').set(bearer(instructorT)).send({ name: 'X' });
    assert.equal(c1.status, 403); assert.equal(c2.status, 403);
  });

  test('admin crea (con ruta "General"), edita, desactiva; se audita', async () => {
    const c = await request(app).post('/api/v2/disciplines').set(bearer(adminT))
      .send({ name: 'Iaido', color: '#112233', dojo_id: 2 /* debe ignorarse */ });
    assert.equal(c.status, 201);
    const id = c.body.data.id;

    const [[dojo]] = await pool.query('SELECT dojo_id FROM disciplines WHERE id = ?', [id]);
    assert.equal(dojo.dojo_id, 1, 'dojo_id del body se ignora; manda el del token');
    const [tracks] = await pool.query('SELECT name FROM rank_tracks WHERE discipline_id = ?', [id]);
    assert.deepEqual(tracks.map((t) => t.name), ['General']);

    const dup = await request(app).post('/api/v2/disciplines').set(bearer(adminT)).send({ name: 'Iaido' });
    assert.equal(dup.status, 409);

    const e = await request(app).patch(`/api/v2/disciplines/${id}`).set(bearer(adminT)).send({ style: 'Muso Shinden' });
    assert.equal(e.body.data.style, 'Muso Shinden');

    assert.equal((await request(app).delete(`/api/v2/disciplines/${id}`).set(bearer(adminT))).status, 200);
    const list = await request(app).get('/api/v2/disciplines').set(bearer(alumnoT));
    assert.ok(!list.body.data.some((d) => d.id === id), 'inactiva no aparece para alumnos');

    const [audit] = await pool.query("SELECT action FROM audit_log WHERE entity='discipline' AND entity_id=? ORDER BY id", [String(id)]);
    assert.deepEqual(audit.map((a) => a.action), ['create', 'update', 'deactivate']);
  });

  test('validación: color inválido → 400 con detalle', async () => {
    const r = await request(app).post('/api/v2/disciplines').set(bearer(adminT)).send({ name: 'Y', color: 'rojo' });
    assert.equal(r.status, 400);
    assert.equal(r.body.details[0].field, 'color');
  });

  test('quitarle el rol surte efecto sin esperar a que expire el token', async () => {
    await pool.query("UPDATE dojo_members SET status='suspended' WHERE dojo_id=1 AND user_id=2");
    const r = await request(app).get('/api/v2/disciplines').set(bearer(alumnoT));
    assert.equal(r.status, 403);
    await pool.query("UPDATE dojo_members SET status='active' WHERE dojo_id=1 AND user_id=2");
  });

  test('usuario sin dojo seleccionado → 409 DOJO_NOT_SELECTED', async () => {
    // Sin "último dojo usado" y con 2 dojos, el login no elige ninguno
    await pool.query('UPDATE user_settings SET last_dojo_id = NULL WHERE user_id = 3');
    const t = (await login('sensei@ambos.mx')).body.data.access_token;
    const r = await request(app).get('/api/v2/disciplines').set(bearer(t));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'DOJO_NOT_SELECTED');
  });
});

describe('guardia de consultas por dojo', () => {
  test('una consulta sin :dojoId se rechaza antes de ejecutarse', async () => {
    const { tenantDb, TenantQueryError } = require('../src/db/tenant');
    const db = tenantDb(1);
    await assert.rejects(() => db.query('SELECT * FROM disciplines'), TenantQueryError);
    await assert.rejects(() => db.query('SELECT * FROM disciplines WHERE dojo_id = :dojoId', { dojoId: 2 }), TenantQueryError);
    const rows = await db.query('SELECT name FROM disciplines WHERE dojo_id = :dojoId');
    assert.ok(rows.length >= 2);
  });
});
