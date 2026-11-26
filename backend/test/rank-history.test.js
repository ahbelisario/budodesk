/**
 * Corrección del historial de grados: editar fechas, agregar grados anteriores y borrar,
 * con el «desde» del grado actual recalculado.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD } = require('./helpers');

let request; let app; let pool;
const T = {}; const R = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  T.admin = await login('admin@seikoukan.mx');
  T.sensei = await login('sensei@ambos.mx');
  T.student = await login('alumno@seikoukan.mx');
  const [ranks] = await pool.query(
    "SELECT id, name FROM ranks WHERE dojo_id = 1 AND discipline_id = 1 AND kind = 'dan' ORDER BY level LIMIT 3");
  [R.dan1, R.dan2, R.dan3] = ranks.map((r) => r.id);
  // Como en la importación del Excel: 3er dan «desde» el 1 de enero del año de la hoja
  await pool.query(`INSERT INTO member_ranks (dojo_id, user_id, discipline_id, rank_id, since_date, started_discipline_at)
                    VALUES (1, 2, 1, ?, '2024-01-01', '2010-05-01')`, [R.dan3]);
  await pool.query(`INSERT INTO rank_history (dojo_id, user_id, discipline_id, rank_id, event_type, awarded_date, notes)
                    VALUES (1, 2, 1, ?, 'initial', '2024-01-01', 'Grado importado de la hoja TWA')`, [R.dan3]);
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
const since = async () => (await pool.query(
  "SELECT DATE_FORMAT(since_date, '%Y-%m-%d') AS s, DATE_FORMAT(started_discipline_at, '%Y-%m-%d') AS st FROM member_ranks WHERE dojo_id = 1 AND user_id = 2 AND discipline_id = 1"))[0][0];

test('corregir la fecha del grado actual corrige su «desde»', async () => {
  const [h] = ok(await api('get', '/progress/members/2', T.admin)).history;
  const d = ok(await api('patch', `/progress/history/${h.id}`, T.admin, { awarded_date: '2021-11-14', certificate_number: 'TWA-3D-0042' }));
  assert.equal((await since()).s, '2021-11-14');
  assert.equal(d.history[0].certificate_number, 'TWA-3D-0042');
  assert.equal(String(d.disciplines[0].current.since_date).slice(0, 10), '2021-11-14');
});

test('agregar grados anteriores no cambia el grado actual', async () => {
  ok(await api('post', '/progress/history', T.admin, { user_id: 2, rank_id: R.dan1, awarded_date: '2012-06-10' }), 201);
  const d = ok(await api('post', '/progress/history', T.admin, { user_id: 2, rank_id: R.dan2, awarded_date: '2016-06-12', notes: 'Seminario' }), 201);
  assert.equal(d.disciplines[0].current.rank_id, R.dan3);
  assert.equal(d.history.length, 3);
  assert.equal((await since()).s, '2021-11-14', 'el 3er dan sigue desde su fecha');
  assert.equal((await since()).st, '2010-05-01', '«practica desde» no se mueve si es anterior');
  ok(await api('post', '/progress/history', T.admin, { user_id: 2, rank_id: R.dan1, awarded_date: '2008-01-20', notes: 'en otro dojo' }), 201);
  assert.equal((await since()).st, '2008-01-20', 'un registro más antiguo adelanta «practica desde»');
});

test('borrar un registro equivocado', async () => {
  const { history } = ok(await api('get', '/progress/members/2', T.admin));
  const wrong = history.find((x) => x.awarded_date.startsWith('2008'));
  const d = ok(await api('delete', `/progress/history/${wrong.id}`, T.admin));
  assert.equal(d.history.length, 3);
  assert.equal((await since()).s, '2021-11-14');
});

test('validaciones y permisos', async () => {
  const [h] = ok(await api('get', '/progress/members/2', T.admin)).history;
  assert.equal((await api('patch', `/progress/history/${h.id}`, T.admin, { awarded_date: '2999-01-01' })).status, 400);
  assert.equal((await api('patch', `/progress/history/${h.id}`, T.sensei, { notes: 'x' })).status, 403, 'solo dueño/admin');
  assert.equal((await api('patch', `/progress/history/${h.id}`, T.student, { notes: 'x' })).status, 403);
  // certificado duplicado
  const other = ok(await api('get', '/progress/members/2', T.admin)).history.find((x) => x.id !== h.id);
  const dup = await api('patch', `/progress/history/${other.id}`, T.admin, { certificate_number: 'TWA-3D-0042' });
  assert.equal(dup.status, 400);
  // queda en la bitácora
  const [[a]] = await pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'rank_history'");
  assert.ok(a.n >= 4);
});
