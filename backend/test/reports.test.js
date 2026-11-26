/**
 * Gastos/otros ingresos del dojo y reportes.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD, today } = require('./helpers');
const { addMonths, addDays } = require('../src/utils/dates');

let request; let app; let pool;
const T = {};
before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  app = require('../src/app').createApp();
  const login = async (identifier, extra = {}) =>
    (await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, ...extra })).body.data.access_token;
  T.admin = await login('admin@seikoukan.mx');
  T.student = await login('alumno@seikoukan.mx');
  T.sensei = await login('sensei@ambos.mx', { dojo_slug: 'seikoukan' });
  T.other = await login('admin@otro.mx');
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
const TODAY = today();
const MONTH = TODAY.slice(0, 7);
const catId = (cats, kind, name) => cats.find((c) => c.kind === kind && c.name === name)?.id;

// ===========================================================================
describe('permisos', () => {
  test('alumno e instructor no ven el dinero; el instructor sí ve asistencia y grados', async () => {
    for (const url of ['/finance/categories', '/finance/entries', '/reports/finance', '/reports/receivables']) {
      assert.equal((await api('get', url, T.student)).status, 403, url);
      assert.equal((await api('get', url, T.sensei)).status, 403, url);
    }
    for (const url of ['/reports/members', '/reports/attendance', '/reports/ranks']) {
      assert.equal((await api('get', url, T.student)).status, 403, url);
      ok(await api('get', url, T.sensei));
    }
  });
});

// ===========================================================================
describe('gastos y otros ingresos', () => {
  let cats; let taichi;

  test('categorías por omisión en español, y se pueden agregar', async () => {
    cats = ok(await api('get', '/finance/categories', T.admin));
    assert.ok(catId(cats, 'expense', 'Renta'));
    assert.ok(catId(cats, 'income', 'Otras disciplinas'));
    taichi = ok(await api('post', '/finance/categories', T.admin, { kind: 'income', name: 'Taichi' }), 201).id;
    assert.equal((await api('post', '/finance/categories', T.admin, { kind: 'income', name: 'Taichi' })).status, 409);
    cats = ok(await api('get', '/finance/categories', T.admin));
  });

  test('registrar, editar y borrar movimientos', async () => {
    const rent = catId(cats, 'expense', 'Renta');
    ok(await api('post', '/finance/entries', T.admin, { kind: 'expense', category_id: rent, amount: 15000, entry_date: `${MONTH}-01`, method: 'transfer' }), 201);
    const tc = ok(await api('post', '/finance/entries', T.admin, { kind: 'income', category_id: taichi, amount: 4800, entry_date: `${MONTH}-01`, description: 'Clases de Taichi' }), 201);
    // categoría de otro tipo: rechazada
    assert.equal((await api('post', '/finance/entries', T.admin, { kind: 'expense', category_id: taichi, amount: 1, entry_date: TODAY })).status, 400);
    const light = ok(await api('post', '/finance/entries', T.admin, { kind: 'expense', category_id: catId(cats, 'expense', 'Luz'), amount: 308, entry_date: TODAY }), 201);
    ok(await api('patch', `/finance/entries/${light.id}`, T.admin, { amount: 310.5, notes: 'bimestral' }));
    let list = ok(await api('get', `/finance/entries?from=${MONTH}-01&to=${TODAY}`, T.admin));
    assert.equal(list.length, 3);
    const meta = (await api('get', `/finance/entries?from=${MONTH}-01&to=${TODAY}`, T.admin)).body.meta;
    assert.deepEqual(meta, { income: 4800, expense: 15310.5, net: -10510.5 });
    ok(await api('delete', `/finance/entries/${tc.id}`, T.admin));
    list = ok(await api('get', `/finance/entries?from=${MONTH}-01&to=${TODAY}&kind=income`, T.admin));
    assert.equal(list.length, 0);
    ok(await api('post', '/finance/entries', T.admin, { kind: 'income', category_id: taichi, amount: 4800, entry_date: `${MONTH}-01` }), 201);
  });

  test('no se borra una categoría con movimientos; se desactiva', async () => {
    const rent = catId(cats, 'expense', 'Renta');
    assert.equal((await api('delete', `/finance/categories/${rent}`, T.admin)).status, 409);
    const unused = catId(cats, 'expense', 'Internet y teléfono');
    ok(await api('delete', `/finance/categories/${unused}`, T.admin));
  });

  test('otro dojo no ve estos movimientos', async () => {
    assert.equal(ok(await api('get', '/finance/entries', T.other)).length, 0);
    const rent = catId(cats, 'expense', 'Renta');
    assert.equal((await api('post', '/finance/entries', T.other, { kind: 'expense', category_id: rent, amount: 1, entry_date: TODAY })).status, 404);
  });

  test('movimiento fijo: crea los meses que ya tocan, una sola vez', async () => {
    const water = catId(cats, 'expense', 'Agua');
    const start = addMonths(`${MONTH}-01`, -3);
    const r = ok(await api('post', '/finance/recurring', T.admin, { kind: 'expense', category_id: water, amount: 183, day_of_month: 1, starts_on: start, description: 'Agua' }), 201);
    assert.equal(r.created, 4); // 3 meses atrás + este (día 1 ya pasó)
    // otra vez no duplica
    ok(await api('get', '/finance/entries', T.admin));
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM finance_entries WHERE recurring_id = :id', { id: r.id });
    assert.equal(Number(n), 4);
    // borrar uno generado no lo vuelve a crear
    const [[e]] = await pool.query('SELECT id FROM finance_entries WHERE recurring_id = :id ORDER BY entry_date LIMIT 1', { id: r.id });
    ok(await api('delete', `/finance/entries/${e.id}`, T.admin));
    await require('../src/modules/finance/finance.service').generateRecurringAll();
    const [[{ m }]] = await pool.query('SELECT COUNT(*) m FROM finance_entries WHERE recurring_id = :id', { id: r.id });
    assert.equal(Number(m), 3);
    // un día que aún no llega en este mes no se crea
    const day = Number(TODAY.slice(8, 10));
    if (day < 28) {
      const r2 = ok(await api('post', '/finance/recurring', T.admin, { kind: 'expense', category_id: water, amount: 10, day_of_month: day + 1, starts_on: `${MONTH}-01` }), 201);
      assert.equal(r2.created, 0);
      ok(await api('delete', `/finance/recurring/${r2.id}`, T.admin));
    }
    // borrar el fijo deja sus movimientos
    ok(await api('delete', `/finance/recurring/${r.id}`, T.admin));
    const [[{ k }]] = await pool.query("SELECT COUNT(*) k FROM finance_entries WHERE description = 'Agua'");
    assert.equal(Number(k), 3);
  });
});

// ===========================================================================
describe('reportes', () => {
  before(async () => {
    // Cargos y pagos del alumno 2 este mes: mensualidad pagada en efectivo, examen con transferencia, y uno vencido hace 45 días
    const ins = async (type, amount, due, status, paid = 0) => (await pool.query(
      `INSERT INTO charges (dojo_id, user_id, type, description, amount, amount_paid, currency, due_date, status, period_start)
       VALUES (1, 2, :type, :type, :amount, :paid, 'MXN', :due, :status, :ps)`,
      { type, amount, paid, due, status, ps: type === 'membership' ? `${due.slice(0, 7)}-01` : null }))[0].insertId;
    const pay = async (amount, method, chargeId) => {
      const [p] = await pool.query(
        `INSERT INTO payments (dojo_id, user_id, amount, currency, method, status, paid_at, provider_fee)
         VALUES (1, 2, :amount, 'MXN', :method, 'completed', UTC_TIMESTAMP(), :fee)`, { amount, method, fee: method === 'mercadopago' ? 30 : null });
      if (chargeId) await pool.query('INSERT INTO payment_allocations (dojo_id, payment_id, charge_id, amount) VALUES (1, :p, :c, :a)', { p: p.insertId, c: chargeId, a: amount });
    };
    await pay(750, 'cash', await ins('membership', 750, `${MONTH}-01`, 'paid', 750));
    await pay(500, 'mercadopago', await ins('exam_fee', 500, TODAY, 'paid', 500));
    await pay(100, 'transfer', null); // sin aplicar → saldo a favor
    await ins('membership', 750, addDays(TODAY, -45), 'pending');
    await ins('other', 200, addDays(TODAY, 10), 'pending');
  });

  test('finanzas del mes: colegiaturas, otros ingresos, gastos, comisiones y balance', async () => {
    const r = ok(await api('get', `/reports/finance?from=${MONTH}&to=${MONTH}`, T.admin));
    assert.equal(r.months.length, 1);
    const m = r.months[0];
    assert.deepEqual(m.tuition, { membership: 750, exams: 500, signup: 0, other: 0, credit: 100, total: 1350 });
    assert.deepEqual(m.methods, { cash: 750, mercadopago: 500, transfer: 100 });
    assert.equal(m.online_fees, 30);
    const taichi = r.categories.find((c) => c.name === 'Taichi').id;
    assert.equal(m.other_income[taichi], 4800);
    assert.equal(m.other_income_total, 4800);
    // renta 15000 + luz 310.5 + agua 183 (este mes) + comisión 30
    assert.equal(m.expense_total, 15523.5);
    assert.equal(m.income_total, 6150);
    assert.equal(m.net, -9373.5);
    assert.equal(r.totals.net, -9373.5);
  });

  test('por defecto: los últimos 12 meses con el saldo acumulado', async () => {
    const r = ok(await api('get', '/reports/finance', T.admin));
    assert.equal(r.months.length, 12);
    assert.equal(r.months.at(-1).month, MONTH);
    assert.equal(r.months.at(-1).cumulative, r.totals.net);
  });

  test('por cobrar con antigüedad', async () => {
    const r = ok(await api('get', '/reports/receivables', T.admin));
    assert.equal(r.people, 1);
    const row = r.rows[0];
    assert.equal(row.total, 950);
    assert.equal(row.d31_60, 750);
    assert.equal(row.current, 200);
    assert.equal(row.charges, 2);
  });

  test('alumnos, asistencia y grados', async () => {
    const mem = ok(await api('get', `/reports/members?from=${MONTH}&to=${MONTH}`, T.admin));
    assert.equal(mem.months[0].paid, 1);
    assert.equal(mem.snapshot.active, 1);
    let att = ok(await api('get', '/reports/attendance', T.admin));
    assert.equal(att.students.length, 1);
    assert.equal(att.totals.students_without, 1);
    // dos clases de la misma serie; el alumno fue a una y faltó a otra
    const [sr] = await pool.query(
      `INSERT INTO class_series (dojo_id, title, days_of_week, start_time, end_time, starts_on) VALUES (1, 'Aikido adultos', 'mon', '19:00', '20:30', :d)`, { d: addDays(TODAY, -10) });
    for (const [off, st] of [[-7, 'attended'], [-1, 'no_show']]) {
      const [ss] = await pool.query(
        `INSERT INTO class_sessions (dojo_id, series_id, title, session_date, start_time, end_time) VALUES (1, :s, 'Aikido adultos', :d, '19:00', '20:30')`,
        { s: sr.insertId, d: addDays(TODAY, off) });
      await pool.query('INSERT INTO class_bookings (dojo_id, session_id, user_id, status) VALUES (1, :s, 2, :st)', { s: ss.insertId, st });
    }
    att = ok(await api('get', '/reports/attendance', T.admin));
    assert.deepEqual(att.classes.map((c) => [c.title, c.sessions, c.attended, c.no_show, c.avg]), [['Aikido adultos', 2, 1, 1, 0.5]]);
    assert.equal(att.students[0].attended, 1);
    assert.equal(att.students[0].last_attended, addDays(TODAY, -7));
    assert.equal(att.totals.students_without, 0);
    const rk = ok(await api('get', '/reports/ranks', T.admin));
    assert.ok(Array.isArray(rk.exams) && Array.isArray(rk.distribution));
  });

  test('rangos inválidos', async () => {
    assert.equal((await api('get', '/reports/finance?from=2026-05&to=2026-01', T.admin)).status, 400);
    assert.equal((await api('get', '/reports/finance?from=2020-01&to=2026-12', T.admin)).status, 400);
  });
});
