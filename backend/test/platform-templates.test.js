/**
 * Plantillas de grados editables en la plataforma (rank_templates).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD } = require('./helpers');
const { listTemplates } = require('../src/modules/ranks/templates');
const { templateSchema } = require('../src/modules/ranks/templates.service');

let request; let app; let pool;
const T = {};

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  await pool.query('UPDATE users SET is_superadmin = 1 WHERE id = 1');
  T.super = await login('admin@seikoukan.mx');
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

test('todas las precargadas pasan la validación del editor', () => {
  for (const t of listTemplates()) {
    const r = templateSchema.safeParse(t);
    assert.ok(r.success, `${t.key}: ${JSON.stringify(r.error?.issues?.slice(0, 2))}`);
  }
});

test('las precargadas se copian a la base y solo el superadmin entra a la sección', async () => {
  const all = ok(await api('get', '/platform/rank-templates', T.super));
  assert.equal(all.length, listTemplates().length);
  assert.ok(all.every((t) => t.builtin && t.active));
  assert.equal((await api('get', '/platform/rank-templates', T.sensei)).status, 403);
});

test('editar una precargada: el dojo ve el cambio; desactivarla la oculta; restaurarla la regresa', async () => {
  const k = ok(await api('get', '/platform/rank-templates', T.super)).find((t) => t.key === 'karate-jka');
  k.tracks[0].ranks[0].min_months = 3;
  ok(await api('put', '/platform/rank-templates/karate-jka', T.super, { notes: [...k.notes, 'Nota de prueba'], tracks: k.tracks }));
  let seen = ok(await api('get', '/ranks/templates', T.sensei)).find((t) => t.key === 'karate-jka');
  assert.equal(seen.tracks[0].ranks[0].min_months, 3);
  assert.ok(seen.notes.includes('Nota de prueba'));

  ok(await api('put', '/platform/rank-templates/karate-jka', T.super, { active: false }));
  assert.ok(!ok(await api('get', '/ranks/templates', T.sensei)).some((t) => t.key === 'karate-jka'));
  assert.equal((await api('post', '/ranks/templates/karate-jka/apply', T.super, {})).status, 404);

  const r = ok(await api('post', '/platform/rank-templates/karate-jka/restore', T.super));
  assert.equal(r.tracks[0].ranks[0].min_months, null);
  assert.ok(!r.notes.includes('Nota de prueba'));
  ok(await api('put', '/platform/rank-templates/karate-jka', T.super, { active: true }));
});

test('datos inválidos → 400 con detalle', async () => {
  const r = await api('put', '/platform/rank-templates/judo', T.super, { tracks: [{ name: 'X', ranks: [{ name: 'A', color: 'rojo' }] }] });
  assert.equal(r.status, 400);
  assert.ok(r.body.details?.some((d) => d.field.includes('color')) || JSON.stringify(r.body).includes('color'));
});

test('crear, usar y borrar una plantilla propia; las precargadas no se borran', async () => {
  const t = ok(await api('post', '/platform/rank-templates', T.super, {
    name: 'Sambo', style: 'FIAS', notes: ['⚠️ Prueba'],
    tracks: [{ name: 'General', display_style: 'belt', ranks: [{ name: 'Blanca' }, { name: 'Azul', color: '#1F5FBF', min_months: 6 }] }],
  }), 201);
  assert.equal(t.key, 'sambo-fias');
  assert.equal(t.builtin, false);
  const d = ok(await api('post', '/ranks/templates/sambo-fias/apply', T.super, {}), 201);
  assert.equal(d.ranks, 2);
  ok(await api('delete', '/platform/rank-templates/sambo-fias', T.super));
  assert.equal((await api('delete', '/platform/rank-templates/judo', T.super)).status, 400);
});

test('guardar la estructura de una disciplina como plantilla (solo superadmin)', async () => {
  const [[disc]] = await pool.query('SELECT id, name FROM disciplines WHERE dojo_id = 1 ORDER BY id LIMIT 1');
  assert.equal((await api('post', `/ranks/disciplines/${disc.id}/save-as-template`, T.sensei, {})).status, 403);
  const t = ok(await api('post', `/ranks/disciplines/${disc.id}/save-as-template`, T.super, { name: 'Mi disciplina', style: 'Dojo' }), 201);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM ranks WHERE dojo_id = 1 AND discipline_id = ? AND active = 1', [disc.id]);
  assert.equal(t.tracks.reduce((a, tr) => a + tr.ranks.length, 0), Number(n));
  assert.equal(t.builtin, false);
});
