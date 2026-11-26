/**
 * Plantillas de grados precargadas y edad mínima en la elegibilidad.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD } = require('./helpers');
const { listTemplates } = require('../src/modules/ranks/templates');

let request; let app; let pool;
const T = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  T.admin = await login('admin@seikoukan.mx');
  T.sensei = await login('sensei@ambos.mx');
});
after(async () => { await pool.end(); });

async function login(identifier) {
  const r = await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, dojo_slug: 'seikoukan' });
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

test('el catálogo es coherente: llaves únicas, colores válidos, cada plantilla con fuente', () => {
  const all = listTemplates();
  assert.ok(all.length >= 10);
  assert.equal(new Set(all.map((t) => t.key)).size, all.length);
  for (const t of all) {
    assert.ok(t.source, `${t.key} sin fuente`);
    for (const tr of t.tracks) {
      assert.ok(tr.ranks.length > 0, `${t.key}/${tr.name} vacío`);
      assert.equal(new Set(tr.ranks.map((r) => r.name)).size, tr.ranks.length, `${t.key}/${tr.name} nombres repetidos`);
      for (const r of tr.ranks) {
        assert.match(r.color, /^#[0-9A-F]{6}$/i);
        if (r.stripe_color) assert.match(r.stripe_color, /^#[0-9A-F]{6}$/i);
        assert.ok(['kyu', 'dan', 'belt', 'other'].includes(r.kind));
        assert.ok(r.name.length <= 100);
      }
    }
  }
});

test('cualquier miembro ve las plantillas', async () => {
  const list = ok(await api('get', '/ranks/templates', T.sensei));
  const kendo = list.find((t) => t.key === 'kendo-fik');
  const dan8 = kendo.tracks[0].ranks.find((r) => r.name === '8º Dan');
  assert.equal(dan8.min_months, 120);
  assert.equal(dan8.min_age, 46);
});

test('solo el admin aplica plantillas', async () => {
  const r = await api('post', '/ranks/templates/kendo-fik/apply', T.sensei, {});
  assert.equal(r.status, 403);
});

test('aplicar crea la disciplina con sus rutas y grados en orden', async () => {
  const d = ok(await api('post', '/ranks/templates/bjj-ibjjf/apply', T.admin, {}), 201);
  assert.equal(d.tracks, 2);
  assert.equal(d.ranks, 21);
  const [s] = ok(await api('get', `/ranks/structure?discipline_id=${d.discipline_id}`, T.admin));
  assert.equal(s.name, 'Jiu-jitsu brasileño');
  assert.deepEqual(s.tracks.map((t) => t.name), ['Adultos', 'Infantil']);
  const adults = s.tracks[0];
  assert.deepEqual(adults.ranks.map((r) => r.level), [1, 2, 3, 4, 5, 6, 7, 8]);
  const purple = adults.ranks.find((r) => r.name === 'Morada');
  assert.equal(purple.min_months, 24);
  assert.equal(purple.min_age, 16);
  assert.equal(s.tracks[1].max_age, 15);
});

test('nombre repetido → 409; se puede elegir otro nombre y solo algunas rutas', async () => {
  const dup = await api('post', '/ranks/templates/bjj-ibjjf/apply', T.admin, {});
  assert.equal(dup.status, 409);
  const d = ok(await api('post', '/ranks/templates/bjj-ibjjf/apply', T.admin, { name: 'BJJ Kids', tracks: ['Infantil'] }), 201);
  assert.equal(d.tracks, 1);
  assert.equal(d.ranks, 13);
});

test('agregar rutas de una plantilla a una disciplina existente', async () => {
  const d = ok(await api('post', '/disciplines', T.admin, { name: 'TKD' }), 201);
  const r = ok(await api('post', '/ranks/templates/taekwondo-kukkiwon/apply', T.admin, { discipline_id: d.id, tracks: ['Poom (menores de 15)'] }), 201);
  assert.equal(r.discipline_id, d.id);
  const [s] = ok(await api('get', `/ranks/structure?discipline_id=${d.id}`, T.admin));
  assert.deepEqual(s.tracks.map((t) => t.name), ['General', 'Poom (menores de 15)']);
});

test('plantilla inexistente → 404', async () => {
  assert.equal((await api('post', '/ranks/templates/nada/apply', T.admin, {})).status, 404);
});

test('la edad mínima del siguiente grado cuenta para la elegibilidad', async () => {
  const d = ok(await api('post', '/ranks/templates/kendo-fik/apply', T.admin, {}), 201);
  const [s] = ok(await api('get', `/ranks/structure?discipline_id=${d.discipline_id}`, T.admin));
  const kyu1 = s.tracks[0].ranks.find((r) => r.name === '1er Kyu');
  const dan1 = s.tracks[0].ranks.find((r) => r.name === '1er Dan');
  assert.equal(dan1.min_age, 13);
  // Alumno 2 con 1er kyu en kendo, 11 años
  const dob = new Date(); dob.setFullYear(dob.getFullYear() - 11);
  await pool.query('UPDATE user_profiles SET date_of_birth = ? WHERE user_id = 2', [dob.toISOString().slice(0, 10)]);
  await pool.query(`INSERT INTO member_ranks (dojo_id, user_id, discipline_id, rank_id, since_date)
                    VALUES (1, 2, ?, ?, '2020-01-01')`, [d.discipline_id, kyu1.id]);

  const prog = async () => ok(await api('get', '/progress/members/2', T.admin)).disciplines.find((x) => x.discipline_id === d.discipline_id);
  const elig = async () => ok(await api('get', `/progress/eligible?discipline_id=${d.discipline_id}`, T.admin)).filter((x) => x.user_id === 2);

  let p = await prog();
  assert.equal(p.progress.age.need, 13);
  assert.equal(p.progress.age.have, 11);
  assert.equal(p.progress.age.ok, false);
  assert.equal(p.progress.eligible, false);
  assert.equal((await elig()).length, 0);

  dob.setFullYear(dob.getFullYear() - 3);
  await pool.query('UPDATE user_profiles SET date_of_birth = ? WHERE user_id = 2', [dob.toISOString().slice(0, 10)]);
  p = await prog();
  assert.equal(p.progress.age.ok, true);
  assert.equal(p.progress.eligible, true);
  assert.equal((await elig())[0].eligible, true);

  // Sin fecha de nacimiento no bloquea, pero se marca como desconocida
  await pool.query('UPDATE user_profiles SET date_of_birth = NULL WHERE user_id = 2');
  p = await prog();
  assert.equal(p.progress.age.unknown, true);
  assert.equal(p.progress.eligible, true);
});
