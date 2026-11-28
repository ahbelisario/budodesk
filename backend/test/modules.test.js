/**
 * Pruebas de reglas de negocio de los módulos v2 (miembros, grados, membresías,
 * cobranza, clases, dashboard, cuenta, avisos). Comparten estado en orden.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, PASSWORD, today } = require('./helpers');

let request; let app; let pool; let outbox;
const T = {}; // tokens

before(async () => {
  await resetDatabase();
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  ({ outbox } = require('../src/services/mailer'));
  app = require('../src/app').createApp();
  const login = async (identifier, extra = {}) =>
    (await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, ...extra })).body.data.access_token;
  T.admin = await login('admin@seikoukan.mx');
  T.student = await login('alumno@seikoukan.mx');
  T.instructor = await login('sensei@ambos.mx', { dojo_slug: 'seikoukan' });
  T.other = await login('admin@otro.mx');
});
after(async () => { await pool.end(); });

const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`).set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};
const ok = (r, status = 200) => {
  if (r.status !== status) assert.fail(`HTTP ${r.status} (esperado ${status}): ${JSON.stringify(r.body)}`);
  return r.body.data;
};

const ids = {};

// ===========================================================================
describe('miembros', () => {
  test('alta de alumno con grado inicial y correo de acceso', async () => {
    const aikido5 = (await pool.query("SELECT id FROM ranks WHERE dojo_id=1 AND discipline_id=1 AND level=5"))[0][0].id;
    ids.aikido5 = aikido5;
    const m = ok(await api('post', '/members', T.admin, {
      email: 'Nuevo@Correo.mx', first_name: 'Nuevo', last_name: 'Alumno', date_of_birth: '1990-05-01',
      initial_ranks: [{ discipline_id: 1, rank_id: aikido5, since_date: today(-200) }], send_access_email: true,
    }), 201);
    ids.nuevo = m.id;
    assert.equal(m.email, 'nuevo@correo.mx');
    assert.deepEqual(m.roles, ['student']);
    assert.equal(m.ranks[0].rank, '6to Kyu');
    assert.equal(m.can_login, false);
    assert.equal(outbox.at(-1).template, 'account_access');
  });

  test('menor sin correo con tutor; el tutor recibe rol guardian', async () => {
    const mama = ok(await api('post', '/members', T.admin, { email: 'mama@x.mx', first_name: 'Mamá', roles: ['guardian'] }), 201);
    const nino = ok(await api('post', '/members', T.admin, {
      first_name: 'Niño', date_of_birth: today(-365 * 8), guardian_user_id: mama.id, guardian_relationship: 'mother',
    }), 201);
    ids.mama = mama.id; ids.nino = nino.id;
    assert.equal(nino.is_minor, true);
    assert.equal(nino.guardians[0].user_id, mama.id);
  });

  test('vincular por email a alguien que ya existe en otro dojo; su perfil queda protegido', async () => {
    const r = await api('post', '/members', T.other, { email: 'nuevo@correo.mx', first_name: 'Ignorado' });
    const m = ok(r, 201);
    assert.equal(m.id, ids.nuevo);
    assert.equal(m.first_name, 'Nuevo', 'no sobrescribe el perfil existente');
    const dup = await api('post', '/members', T.other, { email: 'nuevo@correo.mx', first_name: 'X' });
    assert.equal(dup.status, 409);
    const edit = await api('patch', `/members/${ids.nuevo}`, T.admin, { first_name: 'Cambiado' });
    assert.equal(edit.status, 403);
    assert.equal(edit.body.code, 'SHARED_PROFILE');
    // Datos propios del dojo sí se pueden editar
    ok(await api('patch', `/members/${ids.nuevo}`, T.admin, { member_number: 'A-001', notes: 'Viene los martes' }));
  });

  test('búsqueda, filtros y paginación; el alumno no puede listar', async () => {
    const r = await api('get', '/members?q=alum&page_size=1', T.admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 1);
    assert.ok(r.body.meta.total >= 2);
    assert.equal((await api('get', '/members', T.student)).status, 403);
    const guardians = ok(await api('get', '/members?role=guardian', T.admin));
    assert.deepEqual(guardians.map((g) => g.id), [ids.mama]);
  });

  test('el instructor ve el perfil (datos médicos) pero no saldos ni notas internas', async () => {
    const m = ok(await api('get', `/members/${ids.nuevo}`, T.instructor));
    assert.ok('medical_notes' in m);
    assert.ok(!('balance_due' in m));
    assert.ok(!('notes' in m));
  });

  test('un alumno no ve el perfil de otro', async () => {
    assert.equal((await api('get', `/members/${ids.nuevo}`, T.student)).status, 403);
    assert.equal((await api('get', '/members/2', T.student)).status, 200);
  });

  test('roles: no se puede quitar al último owner', async () => {
    const r = await api('put', '/members/1/roles', T.admin, { roles: ['admin'] });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'LAST_OWNER');
    ok(await api('put', `/members/${ids.nuevo}/roles`, T.admin, { roles: ['student', 'instructor'] }));
    ok(await api('put', `/members/${ids.nuevo}/roles`, T.admin, { roles: ['student'] }));
  });

  test('/me: perfil, ajustes y menores del tutor', async () => {
    const p = ok(await api('patch', '/me/profile', T.student, { phone: '5555555555', blood_type: 'O+' }));
    assert.equal(p.phone, '5555555555');
    const s = ok(await api('patch', '/me/settings', T.student, { theme: 'dark', notify_email: false }));
    assert.equal(s.theme, 'dark');
  });
});

// ===========================================================================
describe('grados y exámenes', () => {
  test('estructura por disciplina → tracks → grados', async () => {
    const s = ok(await api('get', '/ranks/structure', T.student));
    const aikido = s.find((d) => d.name === 'Aikido');
    assert.equal(aikido.tracks[0].ranks.length, 15);
    assert.equal(aikido.tracks[0].display_style, 'rank', 'Aikido se muestra por grado');
    assert.equal(s.find((d) => d.name === 'Karate Do').tracks[0].display_style, 'belt');
  });

  test('modo de visualización: por grado por defecto; se puede crear una ruta infantil por cinta', async () => {
    const d = ok(await api('post', '/disciplines', T.admin, { name: 'Judo' }), 201);
    const st = ok(await api('get', `/ranks/structure?discipline_id=${d.id}`, T.admin));
    assert.equal(st[0].tracks[0].display_style, 'rank');
    const kids = ok(await api('post', '/ranks/tracks', T.admin, { discipline_id: 1, name: 'Infantil', min_age: 4, max_age: 12, display_style: 'belt' }), 201);
    assert.equal(kids.display_style, 'belt');
    ok(await api('patch', `/ranks/tracks/${kids.id}`, T.admin, { display_style: 'rank' }));
    const bad = await api('patch', `/ranks/tracks/${kids.id}`, T.admin, { display_style: 'colores' });
    assert.equal(bad.status, 400);
  });

  test('insertar un grado en medio recorre los niveles', async () => {
    const r = ok(await api('post', '/ranks', T.admin, { track_id: 2, name: 'Amarilla-punta', level: 2, color: '#FDE68A' }), 201);
    assert.equal(r.level, 2);
    const s = ok(await api('get', '/ranks?track_id=2', T.admin));
    assert.deepEqual(s.map((x) => x.level), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    ok(await api('delete', `/ranks/${r.id}`, T.admin));
  });

  test('temario y progreso: tiempo y clases desde el grado actual', async () => {
    // Requisito del siguiente grado (5to Kyu)
    const next = (await pool.query("SELECT id FROM ranks WHERE dojo_id=1 AND discipline_id=1 AND level=6"))[0][0].id;
    ids.aikido6 = next;
    const q = ok(await api('post', `/ranks/${next}/requirements`, T.instructor, { name: 'Ikkyo omote', category: 'technique' }), 201);
    ids.req = q.id;
    const p = ok(await api('get', `/progress/members/${ids.nuevo}`, T.admin)).disciplines[0];
    assert.equal(p.current.name, '6to Kyu');
    assert.equal(p.display_style, 'rank');
    assert.equal(ok(await api('get', `/members/${ids.nuevo}`, T.admin)).ranks[0].display_style, 'rank');
    assert.equal(p.next.name, '5to Kyu');
    assert.ok(p.progress.months.have >= 6);
    assert.equal(p.progress.months.ok, true);
    assert.equal(p.progress.classes.ok, false); // necesita 30 clases
    assert.equal(p.progress.requirements.total, 1);
    assert.equal(p.progress.eligible, false);
    ok(await api('put', `/progress/members/${ids.nuevo}/requirements/${q.id}`, T.instructor, { status: 'approved' }));
    const p2 = ok(await api('get', `/progress/members/${ids.nuevo}`, T.admin)).disciplines[0];
    assert.equal(p2.progress.requirements.ok, true);
  });

  test('el alumno no puede promoverse a sí mismo (bug del sistema anterior)', async () => {
    const r = await api('post', '/progress/promotions', T.student, { user_id: 2, rank_id: 11 });
    assert.equal(r.status, 403);
  });

  test('examen: inscribir candidatos con cuota, aprobar = promoción automática', async () => {
    await pool.query('UPDATE ranks SET exam_fee = 350 WHERE id = ?', [ids.aikido6]);
    const ex = ok(await api('post', '/exams', T.instructor, { discipline_id: 1, title: 'Examen invierno', exam_date: today(10) }), 201);
    const add = ok(await api('post', `/exams/${ex.id}/candidates`, T.instructor, { user_ids: [ids.nuevo, ids.nino] }), 201);
    assert.equal(add.added.length, 1);
    assert.equal(add.skipped[0].user_id, ids.nino); // sin grado en la disciplina
    assert.ok(add.added[0].charge_id, 'genera la cuota de examen');
    ids.examFeeCharge = add.added[0].charge_id;

    const mine = ok(await api('get', `/exams/mine?user_id=${ids.nuevo}`, T.admin));
    assert.equal(mine[0].fee, 350);
    // También inscrito a otro examen para el mismo grado
    const ex2 = ok(await api('post', '/exams', T.instructor, { discipline_id: 1, title: 'Examen extra', exam_date: today(20) }), 201);
    const add2 = ok(await api('post', `/exams/${ex2.id}/candidates`, T.instructor, { user_ids: [ids.nuevo] }), 201);

    const res = ok(await api('put', `/exams/${ex.id}/candidates/${add.added[0].candidate_id}`, T.instructor, { status: 'passed', score: 92 }));
    assert.equal(res.promoted, true);
    const p = ok(await api('get', `/progress/members/${ids.nuevo}`, T.admin));
    assert.equal(p.disciplines[0].current.name, '5to Kyu');
    assert.equal(p.history[0].event_type, 'promotion');
    // La otra inscripción al mismo grado se da de baja sola y su cuota se anula
    const other = ok(await api('get', `/exams/${ex2.id}`, T.admin)).candidates[0];
    assert.equal(other.status, 'withdrawn');
    assert.equal(other.fee_status, 'void');
    assert.ok(add2.added[0].charge_id);
    // No se puede "desaprobar" después de promover
    const back = await api('put', `/exams/${ex.id}/candidates/${add.added[0].candidate_id}`, T.instructor, { status: 'failed' });
    assert.equal(back.status, 409);
  });

  test('un tip no reinicia el tiempo en el grado', async () => {
    await pool.query('UPDATE ranks SET max_stripes = 4 WHERE id = ?', [ids.aikido6]);
    const before = (await pool.query('SELECT since_date FROM member_ranks WHERE user_id = ? AND discipline_id = 1', [ids.nuevo]))[0][0].since_date;
    ok(await api('post', '/progress/promotions', T.instructor, { user_id: ids.nuevo, rank_id: ids.aikido6, stripes: 1, event_type: 'stripe', awarded_date: today(30) }), 201);
    const row = (await pool.query('SELECT since_date, stripes FROM member_ranks WHERE user_id = ? AND discipline_id = 1', [ids.nuevo]))[0][0];
    assert.equal(row.stripes, 1);
    assert.equal(row.since_date, before);
  });
});

// ===========================================================================
describe('membresías y facturación', () => {
  test('alta con descuento del catálogo: precio $750 − 20 % = $600, cargo del primer periodo', async () => {
    const disc = (await pool.query("SELECT id FROM discounts WHERE dojo_id=1 AND name='Familiar'"))[0][0].id;
    const ms = ok(await api('post', '/memberships', T.admin, { plan_id: 1, member_ids: [2], discount_id: disc, start_date: today() }), 201);
    ids.msAlumno = ms.id;
    assert.equal(ms.status, 'active');
    assert.equal(ms.final_price, 600);
    assert.equal(ms.charges.length, 1);
    assert.equal(ms.charges[0].total, 600);
    assert.equal(ms.balance_due, 600);
  });

  test('plan familiar: respeta el máximo de integrantes y cobra al tutor', async () => {
    const tooMany = await api('post', '/memberships', T.admin, { plan_id: 1, member_ids: [ids.nino, ids.mama] });
    assert.equal(tooMany.status, 400);
    const ms = ok(await api('post', '/memberships', T.admin, { plan_id: 2, member_ids: [ids.nino], payer_user_id: ids.mama, start_date: today(-40) }), 201);
    ids.msFam = ms.id;
    assert.equal(ms.payer_user_id, ids.mama);
    assert.equal(ms.charges[0].total, 1200);
  });

  test('la facturación diaria renueva, genera el cargo y marca adeudos vencidos (idempotente)', async () => {
    const r1 = ok(await api('post', '/memberships/billing/run', T.admin));
    assert.ok(r1.renewed >= 1, 'renueva el periodo que ya venció');
    assert.ok(r1.past_due >= 1);
    const r2 = ok(await api('post', '/memberships/billing/run', T.admin));
    assert.equal(r2.renewed, 0, 'correrla de nuevo no duplica cargos');
    const ms = ok(await api('get', `/memberships/${ids.msFam}`, T.admin));
    assert.equal(ms.status, 'past_due');
    assert.equal(ms.charges.filter((c) => c.type === 'membership').length, 2);
  });

  test('el tutor ve el estado de cuenta (cargos a su nombre) y la membresía de su hijo', async () => {
    // Tutor con contraseña para entrar
    const bcrypt = require('bcrypt');
    await pool.query('UPDATE users SET password_hash = ?, email_verified_at = NOW() WHERE id = ?', [await bcrypt.hash(PASSWORD, 4), ids.mama]);
    T.mama = (await request(app).post('/api/v2/auth/login').send({ identifier: 'mama@x.mx', password: PASSWORD })).body.data.access_token;
    const st = ok(await api('get', '/charges/mine', T.mama));
    assert.equal(st.summary.balance_due, 2400);
    assert.ok(st.summary.overdue >= 1200);
    const minors = ok(await api('get', '/me/minors', T.mama));
    assert.equal(minors[0].user_id, ids.nino);
    // El tutor edita los datos de su hijo; un tercero no
    const prof = ok(await api('patch', `/me/minors/${ids.nino}/profile`, T.mama, { blood_type: 'A+', emergency_contact_name: 'Abuela' }));
    assert.equal(prof.blood_type, 'A+');
    assert.equal((await api('patch', `/me/minors/${ids.nino}/profile`, T.student, { blood_type: 'B+' })).status, 403);
    assert.equal((await api('get', `/me/minors/${ids.nino}/profile`, T.student)).status, 403);
    const msNino = ok(await api('get', `/memberships/mine?user_id=${ids.nino}`, T.mama));
    assert.equal(msNino[0].id, ids.msFam);
    // Pero no puede ver datos de otro alumno
    assert.equal((await api('get', '/memberships/mine?user_id=2', T.mama)).status, 403);
  });

  test('pago manual se aplica al cargo más antiguo; sigue vencida mientras deba otro mes', async () => {
    const pay = ok(await api('post', '/payments', T.admin, { user_id: ids.mama, amount: 1200, method: 'transfer', reference: 'SPEI-123' }), 201);
    ids.payment = pay.id;
    assert.equal(pay.allocations.length, 1);
    assert.equal(pay.unapplied, 0);
    const ms = ok(await api('get', `/memberships/${ids.msFam}`, T.admin));
    assert.equal(ms.balance_due, 1200);
    const oldest = ms.charges.filter((c) => c.type === 'membership').sort((a, b) => a.period_start.localeCompare(b.period_start))[0];
    assert.equal(oldest.status, 'paid');
    assert.equal(ms.status, 'past_due', 'el segundo mes también está vencido');
  });

  test('pago parcial deja el cargo en "partial"; cancelar el pago lo revierte', async () => {
    const pay = ok(await api('post', '/payments', T.admin, { user_id: ids.mama, amount: 500, method: 'cash' }), 201);
    const ch = ok(await api('get', `/charges/${pay.allocations[0].charge_id}`, T.admin));
    assert.equal(ch.status, 'partial');
    assert.equal(ch.balance, 700);
    assert.equal(ok(await api('get', `/memberships/${ids.msFam}`, T.admin)).status, 'past_due', 'pago parcial no reactiva');
    ok(await api('post', `/payments/${pay.id}/cancel`, T.admin, { reason: 'Capturado por error' }));
    const ch2 = ok(await api('get', `/charges/${ch.id}`, T.admin));
    assert.equal(ch2.status, 'pending');
    assert.equal(ch2.balance, 1200);
  });

  test('al pagar todo lo vencido, la membresía vuelve a activa', async () => {
    ok(await api('post', '/payments', T.admin, { user_id: ids.mama, amount: 1200, method: 'cash' }), 201);
    const ms = ok(await api('get', `/memberships/${ids.msFam}`, T.admin));
    assert.equal(ms.balance_due, 0);
    assert.equal(ms.status, 'active');
  });

  test('no se puede anular un cargo con pagos; sí uno sin pagos', async () => {
    const paidCharge = (await pool.query('SELECT charge_id FROM payment_allocations WHERE payment_id = ?', [ids.payment]))[0][0].charge_id;
    assert.equal((await api('post', `/charges/${paidCharge}/void`, T.admin, { reason: 'x' })).status, 409);
    ok(await api('post', `/charges/${ids.examFeeCharge}/void`, T.admin, { reason: 'Beca' }));
  });

  test('pausa: extiende periodo y próxima facturación', async () => {
    const before = ok(await api('get', `/memberships/${ids.msAlumno}`, T.admin));
    const after = ok(await api('post', `/memberships/${ids.msAlumno}/pauses`, T.admin, { start_date: today(5), end_date: today(14), reason: 'Lesión' }), 201);
    const { addDays } = require('../src/utils/dates');
    assert.equal(after.next_billing_date, addDays(before.next_billing_date, 10));
    const overlap = await api('post', `/memberships/${ids.msAlumno}/pauses`, T.admin, { start_date: today(10), end_date: today(20) });
    assert.equal(overlap.status, 409);
  });

  test('reanudar: pausa en curso termina ayer y devuelve los días; una pausa futura se quita completa', async () => {
    const { addDays } = require('../src/utils/dates');
    const base = ok(await api('get', `/memberships/${ids.msAlumno}`, T.admin));
    // quitar la pausa futura del test anterior (10 días)
    const future = base.pauses.find((p) => String(p.start_date).slice(0, 10) === today(5));
    const r1 = ok(await api('post', `/memberships/${ids.msAlumno}/pauses/${future.id}/end`, T.admin));
    assert.equal(r1.next_billing_date, addDays(base.next_billing_date, -10));
    assert.ok(!r1.pauses.some((p) => p.id === future.id));

    // pausa en curso: del día -3 al +6 (10 días); reanudar hoy devuelve 7 días (hoy..+6)
    const p2 = ok(await api('post', `/memberships/${ids.msAlumno}/pauses`, T.admin, { start_date: today(-3), end_date: today(6) }), 201);
    assert.equal(p2.status, 'paused');
    const cur = p2.pauses.find((p) => String(p.start_date).slice(0, 10) === today(-3));
    const r2 = ok(await api('post', `/memberships/${ids.msAlumno}/pauses/${cur.id}/end`, T.admin));
    assert.notEqual(r2.status, 'paused');
    assert.equal(r2.next_billing_date, addDays(p2.next_billing_date, -7));
    assert.equal(String(r2.pauses.find((p) => p.id === cur.id).end_date).slice(0, 10), today(-1));

    // ya terminada → 409
    assert.equal((await api('post', `/memberships/${ids.msAlumno}/pauses/${cur.id}/end`, T.admin)).status, 409);
  });

  test('cancelar al fin de periodo y revertir', async () => {
    const c = ok(await api('post', `/memberships/${ids.msAlumno}/cancel`, T.admin, { reason: 'Se muda' }));
    assert.equal(c.cancel_at_period_end, 1);
    assert.equal(c.next_billing_date, null);
    const r = ok(await api('post', `/memberships/${ids.msAlumno}/resume`, T.admin));
    assert.equal(r.cancel_at_period_end, 0);
    assert.ok(r.next_billing_date);
  });

  test('saldo a favor: un pago sin adeudos queda como crédito y se aplica solo al siguiente cargo', async () => {
    const before = ok(await api('get', `/charges/mine?user_id=${ids.mama}`, T.admin));
    assert.equal(Number(before.summary.balance_due), 0);
    const startCredit = Number(before.summary.credit);
    ok(await api('post', '/payments', T.admin, { user_id: ids.mama, amount: 500, method: 'transfer', reference: 'ADELANTO' }), 201);
    const mid = ok(await api('get', `/charges/mine?user_id=${ids.mama}`, T.admin));
    assert.equal(Number(mid.summary.credit), startCredit + 500);
    const ch = ok(await api('post', '/charges', T.admin, { user_id: ids.mama, type: 'event', description: 'Seminario', amount: 300 }), 201);
    const after = ok(await api('get', `/charges/${ch.id}`, T.admin));
    assert.equal(after.status, 'paid');
    assert.equal(after.payments.length, 1);
    const end = ok(await api('get', `/charges/mine?user_id=${ids.mama}`, T.admin));
    assert.equal(Number(end.summary.credit), startCredit + 200);
    assert.equal(Number(end.summary.balance_due), 0);
    // Limpieza: cancelar el adelanto revierte la aplicación; luego se anula el cargo
    const adelanto = (await pool.query("SELECT id FROM payments WHERE reference = 'ADELANTO'"))[0][0].id;
    ok(await api('post', `/payments/${adelanto}/cancel`, T.admin, { reason: 'prueba' }));
    assert.equal(ok(await api('get', `/charges/${ch.id}`, T.admin)).status, 'pending');
    ok(await api('post', `/charges/${ch.id}/void`, T.admin, { reason: 'prueba' }));
    assert.equal(Number(ok(await api('get', `/charges/mine?user_id=${ids.mama}`, T.admin)).summary.credit), startCredit);
  });

  test('adelantar mensualidades: crea los cargos de los siguientes meses, el pago va a ellos y la facturación no los duplica', async () => {
    const msId = ids.msAlumno;
    const ms = ok(await api('get', `/memberships/${msId}`, T.admin));
    const prev = ok(await api('get', `/memberships/${msId}/advance-preview?periods=2`, T.admin));
    assert.equal(prev.periods.length, 2);
    assert.equal(prev.periods[0].period_start, ms.next_billing_date);
    assert.equal(prev.periods[0].total, 600);
    assert.ok(!prev.periods[0].charge_id, 'la vista previa no crea nada');

    const bad = await api('post', '/payments', T.admin, { user_id: ids.mama, amount: 600, method: 'cash', advance: { membership_id: msId, periods: 1 } });
    assert.equal(bad.status, 400, 'la membresía la paga otra persona');

    const p = ok(await api('post', '/payments', T.admin, { user_id: 2, amount: 1200, method: 'cash', reference: 'ADELANTO', advance: { membership_id: msId, periods: 2 } }), 201);
    const [rows] = await pool.query(
      "SELECT c.description, c.status, DATE_FORMAT(c.period_start, '%Y-%m-%d') AS ps FROM charges c JOIN payment_allocations a ON a.charge_id = c.id WHERE a.payment_id = ? ORDER BY c.period_start",
      [p.id]);
    assert.deepEqual(rows.map((r) => [r.ps, r.status]), prev.periods.map((x) => [x.period_start, 'paid']));
    assert.equal(rows[0].description, prev.periods[0].description);

    // la siguiente vista previa empieza después de los meses ya adelantados
    const next = ok(await api('get', `/memberships/${msId}/advance-preview?periods=1`, T.admin));
    assert.ok(next.periods[0].period_start > prev.periods[1].period_start);

    // la facturación usa el mismo cargo (llave única membresía + periodo): el mismo periodo no se puede crear dos veces
    const svc = require('../src/modules/memberships/memberships.service');
    const { tenantDb } = require('../src/db/tenant');
    const again = await tenantDb(1).transaction((t) => svc.chargePeriod(t, { ...ms, id: msId, payer_user_id: 2, plan_name: 'X', price: 600, currency: 'MXN' },
      { start: prev.periods[0].period_start, end: prev.periods[0].period_end }));
    assert.equal(again, null);

    // Limpieza para el tablero
    ok(await api('post', `/payments/${p.id}/cancel`, T.admin, { reason: 'prueba' }));
    for (const x of rows.length ? (await pool.query('SELECT id FROM charges WHERE membership_id = ? AND period_start IN (?, ?)', [msId, prev.periods[0].period_start, prev.periods[1].period_start]))[0] : []) {
      ok(await api('post', `/charges/${x.id}/void`, T.admin, { reason: 'limpieza' }));
    }
  });

  test('reactivar un cargo anulado: vuelve a pendiente y se le aplica el saldo a favor', async () => {
    const ch = ok(await api('post', '/charges', T.admin, { user_id: ids.mama, type: 'membership', description: 'Mensualidad nov', amount: 400 }), 201);
    ok(await api('post', `/charges/${ch.id}/void`, T.admin, { reason: 'baja' }));
    // regresó y pagó: el pago queda como saldo a favor porque el cargo está anulado
    const p = ok(await api('post', '/payments', T.admin, { user_id: ids.mama, amount: 400, method: 'cash', reference: 'REGRESO' }), 201);
    assert.ok(Number(p.unapplied ?? 400) > 0);
    assert.equal((await api('post', `/charges/${ch.id}/reactivate`, T.student)).status, 403);
    const r = ok(await api('post', `/charges/${ch.id}/reactivate`, T.admin));
    assert.equal(r.status, 'paid');
    assert.equal(Number(r.credit_applied), 400);
    assert.equal((await api('post', `/charges/${ch.id}/reactivate`, T.admin)).status, 409, 'ya no está anulado');
    // sin saldo a favor queda pendiente
    const ch2 = ok(await api('post', '/charges', T.admin, { user_id: ids.mama, type: 'other', description: 'Playera', amount: 150 }), 201);
    ok(await api('post', `/charges/${ch2.id}/void`, T.admin, { reason: 'error' }));
    const r2 = ok(await api('post', `/charges/${ch2.id}/reactivate`, T.admin));
    assert.equal(r2.status, 'pending');
    assert.equal(r2.voided_reason, null);
    ok(await api('post', `/charges/${ch2.id}/void`, T.admin, { reason: 'limpieza' }));
    // Limpieza para el tablero: cancelar el pago y anular el cargo
    const regreso = (await pool.query("SELECT id FROM payments WHERE reference = 'REGRESO'"))[0][0].id;
    ok(await api('post', `/payments/${regreso}/cancel`, T.admin, { reason: 'prueba' }));
    ok(await api('post', `/charges/${ch.id}/void`, T.admin, { reason: 'limpieza' }));
  });

  test('el alumno no puede editar membresías (bug del sistema anterior)', async () => {
    const r = await api('patch', `/memberships/${ids.msAlumno}`, T.student, { price: 1 });
    assert.equal(r.status, 403);
  });
});

// ===========================================================================
describe('clases y reservas', () => {
  test('una serie genera sesiones en los días indicados', async () => {
    const s = ok(await api('post', '/classes/series', T.admin, {
      title: 'Aikido adultos', discipline_id: 1, instructor_id: 3, days_of_week: ['mon', 'wed', 'fri'],
      start_time: '23:00', end_time: '23:59', starts_on: today(), capacity: 1,
    }), 201);
    ids.series = s.id;
    assert.ok(s.sessions_created >= 20);
    const [[{ n }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM class_sessions WHERE series_id = ? AND WEEKDAY(session_date) NOT IN (0,2,4)', [s.id]);
    assert.equal(n, 0);
  });

  test('reservar exige membresía vigente', async () => {
    const [[sess]] = await pool.query(
      'SELECT id FROM class_sessions WHERE series_id = ? AND session_date > ? ORDER BY session_date LIMIT 1', [ids.series, today()]);
    ids.session = sess.id;
    const r = await api('post', `/classes/sessions/${sess.id}/book`, T.admin, { user_id: ids.nuevo });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'NO_MEMBERSHIP');
  });

  test('cupo lleno → lista de espera; al cancelar, el primero de la lista entra', async () => {
    // El alumno (id 2) tiene membresía; el nuevo recibe una
    ok(await api('post', '/memberships', T.admin, { plan_id: 1, member_ids: [ids.nuevo] }), 201);
    const a = ok(await api('post', `/classes/sessions/${ids.session}/book`, T.student, {}), 201);
    assert.equal(a.status, 'booked');
    const dup = await api('post', `/classes/sessions/${ids.session}/book`, T.student, {});
    assert.equal(dup.status, 409);
    const b = ok(await api('post', `/classes/sessions/${ids.session}/book`, T.admin, { user_id: ids.nuevo }), 201);
    assert.equal(b.status, 'waitlisted');
    assert.equal(b.waitlist_position, 1);

    const list = ok(await api('get', `/classes/sessions?from=${today()}&to=${today(13)}`, T.student));
    const mine = list.find((s) => s.id === ids.session);
    assert.equal(mine.my_booking, 'booked');
    assert.equal(mine.spots_left, 0);
    assert.equal(mine.waitlist_count, 1);

    const c = ok(await api('delete', `/classes/sessions/${ids.session}/book`, T.student));
    assert.equal(c.promoted_user_id, ids.nuevo);
    const [[row]] = await pool.query('SELECT status FROM class_bookings WHERE session_id = ? AND user_id = ?', [ids.session, ids.nuevo]);
    assert.equal(row.status, 'booked');
    // Volver a reservar después de cancelar (fallaba en el sistema anterior)
    const again = ok(await api('post', `/classes/sessions/${ids.session}/book`, T.student, {}), 201);
    assert.equal(again.status, 'waitlisted');
  });

  test('límite semanal del plan', async () => {
    await pool.query('UPDATE memberships SET sessions_per_week = 1 WHERE id = ?', [ids.msAlumno]);
    await pool.query('UPDATE class_sessions SET capacity = 20 WHERE series_id = ?', [ids.series]);
    await pool.query('UPDATE dojos SET booking_window_days = 60 WHERE id = 1');
    const { weekStart, addDays } = require('../src/utils/dates');
    const ws = weekStart(today(21));
    const [week] = await pool.query(
      'SELECT id FROM class_sessions WHERE series_id = ? AND session_date BETWEEN ? AND ? ORDER BY session_date', [ids.series, ws, addDays(ws, 6)]);
    ok(await api('post', `/classes/sessions/${week[0].id}/book`, T.student, {}), 201);
    const r = await api('post', `/classes/sessions/${week[1].id}/book`, T.student, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'WEEKLY_LIMIT');
    await pool.query('UPDATE memberships SET sessions_per_week = NULL WHERE id = ?', [ids.msAlumno]);
    await pool.query('UPDATE dojos SET booking_window_days = 14 WHERE id = 1');
  });

  test('listado de clases: encuentra una clase movida a una fecha vieja', async () => {
    const [[s]] = await pool.query('SELECT id FROM class_sessions WHERE series_id = ? ORDER BY session_date DESC LIMIT 1', [ids.series]);
    ok(await api('patch', `/classes/sessions/${s.id}`, T.admin, { session_date: '2019-03-04', title: 'Clase movida' }));
    // Editadas: la última edición primero, aunque la fecha sea de hace años
    const edited = (await api('get', '/classes/sessions/list?view=edited', T.admin));
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data[0].id, s.id);
    assert.ok(edited.body.data[0].edited_at);
    // Pasadas y búsqueda
    const past = ok(await api('get', '/classes/sessions/list?view=past&q=movida', T.admin));
    assert.deepEqual(past.map((x) => x.id), [s.id]);
    assert.equal(past[0].session_date, '2019-03-04');
    // Próximas: de hoy en adelante, en orden
    const up = await api('get', '/classes/sessions/list?view=upcoming&page_size=5', T.admin);
    assert.ok(up.body.data.every((x) => x.session_date >= today()));
    assert.ok(up.body.meta.total > 5);
    assert.equal(up.body.data.length, 5);
    // Solo el personal
    assert.equal((await api('get', '/classes/sessions/list', T.student)).status, 403);
    assert.equal((await api('get', '/classes/sessions/list', T.instructor)).status, 200);
  });

  test('el tutor reserva por su hijo; un alumno no puede reservar por otro', async () => {
    const ok1 = await api('post', `/classes/sessions/${ids.session}/book`, T.mama, { user_id: ids.nino });
    assert.ok([201, 422].includes(ok1.status)); // 422 si el plan familiar no cubre la fecha; lo importante es el permiso
    const no = await api('post', `/classes/sessions/${ids.session}/book`, T.student, { user_id: ids.nino });
    assert.equal(no.status, 403);
  });

  test('pase de lista con walk-in y cierre de clase', async () => {
    const [[past]] = await pool.query(
      `SELECT id FROM class_sessions WHERE series_id = ? ORDER BY session_date DESC LIMIT 1`, [ids.series]);
    await pool.query('UPDATE class_sessions SET session_date = ? WHERE id = ?', [today(-1), past.id]);
    await pool.query("INSERT INTO class_bookings (dojo_id, session_id, user_id, status) VALUES (1, ?, 2, 'booked')", [past.id]);
    const r = ok(await api('put', `/classes/sessions/${past.id}/attendance`, T.instructor, {
      entries: [{ user_id: ids.nuevo, status: 'attended' }], complete: true,
    }));
    assert.equal(r.walk_ins, 1);
    assert.equal(r.marked_no_show, 1);
    const detail = ok(await api('get', `/classes/sessions/${past.id}`, T.instructor));
    assert.equal(detail.status, 'completed');
    assert.deepEqual(detail.roster.map((x) => x.status).sort(), ['attended', 'no_show']);
    assert.equal(detail.roster.find((x) => x.user_id === ids.nuevo).rank_name, '5to Kyu');

    const stats = ok(await api('get', `/classes/attendance/stats?user_id=${ids.nuevo}`, T.admin));
    assert.equal(stats.attended_total, 1);
    // Cuenta para el progreso de grado
    const p = ok(await api('get', `/progress/members/${ids.nuevo}`, T.admin)).disciplines[0];
    assert.equal(p.progress.classes.have, 0, 'la asistencia es anterior a su promoción del examen (fecha futura)');
  });

  test('editar la serie propaga a sesiones futuras no modificadas', async () => {
    const r = ok(await api('patch', `/classes/series/${ids.series}`, T.admin, { title: 'Aikido todos los niveles' }));
    assert.ok(r.sessions_updated > 10);
    const quitar = ok(await api('patch', `/classes/series/${ids.series}`, T.admin, { days_of_week: ['mon'] }));
    assert.ok(quitar.sessions_removed > 0);
  });

  test('clases por edad: se marcan, se filtran y no se pueden reservar fuera de rango', async () => {
    await pool.query("UPDATE user_profiles SET date_of_birth = '1990-01-15' WHERE user_id = 2");
    const s = ok(await api('post', '/classes/series', T.admin, {
      title: 'Aikido infantil', discipline_id: 1, days_of_week: ['tue', 'thu'],
      start_time: '22:00', end_time: '22:50', starts_on: today(), capacity: 10, min_age: 5, max_age: 12,
    }), 201);
    const all = ok(await api('get', `/classes/sessions?from=${today()}&to=${today(13)}`, T.student));
    const kids = all.filter((x) => x.series_id === s.id);
    assert.ok(kids.length > 0);
    assert.equal(kids[0].fits, false);
    assert.equal(kids[0].misfit_reason, 'age');
    assert.equal(kids[0].min_age, 5);
    const fit = ok(await api('get', `/classes/sessions?from=${today()}&to=${today(13)}&only_fit=true`, T.student));
    assert.ok(!fit.some((x) => x.series_id === s.id));
    assert.ok(fit.every((x) => x.fits));

    const r = await api('post', `/classes/sessions/${kids[0].id}/book`, T.student, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'AGE_RESTRICTED');
    // El personal puede forzarlo
    ok(await api('post', `/classes/sessions/${kids[0].id}/book`, T.admin, { user_id: 2, force: true }), 201);
    const detail = ok(await api('get', `/classes/sessions/${kids[0].id}`, T.admin));
    assert.equal(detail.min_age, 5);
    assert.ok('checkin_code' in detail);
  });

  test('quién impartió la clase: suplente, ficha del instructor y reporte; no cuenta como asistencia', async () => {
    const sensei = (await pool.query("SELECT id FROM users WHERE email = 'sensei@ambos.mx'"))[0][0].id;
    const s = ok(await api('post', '/classes/sessions', T.admin, {
      title: 'Clase de prueba', instructor_id: sensei, session_date: today(-2), start_time: '07:00', end_time: '08:00' }), 201);
    const stats = async (uid) => ok(await api('get', `/attendance/stats?user_id=${uid}`.replace('/attendance', '/classes/attendance'), T.admin));
    const before1 = await stats(1);
    const beforeS = await stats(sensei);

    // por omisión la dio el asignado
    assert.equal((await stats(sensei)).taught_total, beforeS.taught_total);
    // el alumno no puede cambiarlo; el instructor asignado sí
    assert.equal((await api('put', `/classes/sessions/${s.id}/taught-by`, T.student, { user_id: 1 })).status, 403);
    const r = ok(await api('put', `/classes/sessions/${s.id}/taught-by`, T.instructor, { user_id: 1 }));
    assert.equal(r.taught_by, 1);
    assert.ok(r.taught_by_name);
    assert.equal((await stats(1)).taught_total, before1.taught_total + 1);
    assert.equal((await stats(sensei)).taught_total, beforeS.taught_total - 1);
    assert.equal((await stats(1)).attended_total, before1.attended_total, 'dar clase no es asistencia');

    const rep = ok(await api('get', `/reports/attendance?from=${today(-7)}&to=${today()}`, T.admin));
    const owner = rep.instructors.find((x) => x.user_id === 1);
    assert.ok(owner && owner.as_substitute >= 1);

    // un alumno no puede ser suplente; volver al asignado limpia el campo
    assert.equal((await api('put', `/classes/sessions/${s.id}/taught-by`, T.admin, { user_id: 2 })).status, 400);
    assert.equal(ok(await api('put', `/classes/sessions/${s.id}/taught-by`, T.admin, { user_id: sensei })).taught_by, null);
  });
});

// ===========================================================================
describe('dashboard', () => {
  test('resumen con KPIs calculados en el servidor', async () => {
    const d = ok(await api('get', '/dashboard/summary', T.admin));
    assert.ok(d.members.active >= 5);
    assert.ok(d.memberships.active >= 2);
    assert.equal(d.finance.revenue.this_month, 2400); // 2 pagos de 1200 (el de 500 se canceló)
    assert.ok(d.finance.receivables.open_balance > 0);
  });
  test('el instructor ve el resumen sin finanzas; el alumno no entra', async () => {
    const d = ok(await api('get', '/dashboard/summary', T.instructor));
    assert.equal(d.finance, null);
    assert.equal((await api('get', '/dashboard/summary', T.student)).status, 403);
  });
  test('pendientes e ingresos por mes', async () => {
    const todo = ok(await api('get', '/dashboard/todo', T.admin));
    assert.ok(Array.isArray(todo.overdue));
    const rev = ok(await api('get', '/dashboard/revenue?months=3', T.admin));
    assert.equal(rev.months.length, 3);
    assert.equal(rev.months.at(-1).total, 2400);
  });
});

// ===========================================================================
describe('cuenta: registro, verificación, contraseña', () => {
  test('registro con aprobación → miembro pendiente; no entra hasta verificar el correo', async () => {
    const r = ok(await request(app).post('/api/v2/account/register').send({
      dojo_slug: 'seikoukan', email: 'registro@x.mx', password: 'unaContraseña1', first_name: 'Reg', privacy_accepted: true,
    }), 201);
    assert.equal(r.membership_status, 'pending');
    const login = await request(app).post('/api/v2/auth/login').send({ identifier: 'registro@x.mx', password: 'unaContraseña1' });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, 'EMAIL_NOT_VERIFIED');

    const mail = outbox.filter((m) => m.template === 'verify_email').at(-1);
    const token = new URL(mail.vars.url).searchParams.get('token');
    ok(await request(app).post('/api/v2/account/verify-email').send({ token }));
    const again = await request(app).post('/api/v2/account/verify-email').send({ token });
    assert.equal(again.status, 400, 'el token es de un solo uso');

    const l2 = ok(await request(app).post('/api/v2/auth/login').send({ identifier: 'registro@x.mx', password: 'unaContraseña1' }));
    assert.equal(l2.dojo, null, 'pendiente de aprobación: aún no entra al dojo');
    const pend = ok(await api('get', '/dashboard/todo', T.admin)).pending_members;
    assert.ok(pend.some((p) => p.email === 'registro@x.mx'));
  });

  test('olvidé mi contraseña: responde igual exista o no el correo; el token cambia la contraseña y cierra sesiones', async () => {
    const before = outbox.length;
    ok(await request(app).post('/api/v2/account/password/forgot').send({ email: 'noexiste@x.mx' }));
    assert.equal(outbox.length, before);
    ok(await request(app).post('/api/v2/account/password/forgot').send({ email: 'alumno@seikoukan.mx' }));
    const mail = outbox.at(-1);
    assert.equal(mail.template, 'password_reset');
    const token = new URL(mail.vars.url).searchParams.get('token');
    ok(await request(app).post('/api/v2/account/password/reset').send({ token, password: 'NuevaClave-2026' }));
    assert.equal((await api('get', '/me/profile', T.student)).status, 401, 'sesiones cerradas');
    const l = await request(app).post('/api/v2/auth/login').send({ identifier: 'alumno@seikoukan.mx', password: 'NuevaClave-2026' });
    assert.equal(l.status, 200);
    T.student = l.body.data.access_token;
  });

  test('página pública del dojo', async () => {
    const d = ok(await request(app).get('/api/v2/account/dojos/seikoukan'));
    assert.equal(d.self_registration, 'approval');
    assert.ok(!('tax_id' in d));
  });
});

// ===========================================================================
describe('avisos y notificaciones', () => {
  test('aviso a alumnos llega también a los tutores', async () => {
    const r = ok(await api('post', '/announcements', T.admin, { title: 'No hay clase el lunes', body: 'Día festivo', audience: 'students' }), 201);
    assert.ok(r.recipients >= 2);
    const inbox = await api('get', '/notifications', T.mama);
    assert.equal(inbox.body.meta.unread, 1);
    assert.equal(inbox.body.data[0].type, 'announcement');
    ok(await api('post', '/notifications/read', T.mama, { all: true }));
    assert.equal((await api('get', '/notifications', T.mama)).body.meta.unread, 0);
    const list = ok(await api('get', '/announcements', T.student));
    assert.equal(list[0].title, 'No hay clase el lunes');
    assert.equal(ok(await api('get', '/announcements', T.instructor)).length, 1, 'staff ve todos');
    // Editar: cambia lo que se ve, sin volver a notificar
    ok(await api('patch', `/announcements/${r.id}`, T.admin, { title: 'No hay clase el lunes 16', pinned: true }));
    const edited = ok(await api('get', '/announcements', T.student))[0];
    assert.equal(edited.title, 'No hay clase el lunes 16');
    assert.equal(edited.pinned, 1);
    assert.equal((await api('get', '/notifications', T.mama)).body.meta.unread, 0);
    assert.equal((await api('patch', `/announcements/${r.id}`, T.student, { title: 'x' })).status, 403);
  });

  test('registro de push token', async () => {
    ok(await api('post', '/notifications/push-tokens', T.student, { token: 'ExponentPushToken[abc123]', platform: 'ios' }));
    const bad = await api('post', '/notifications/push-tokens', T.student, { token: 'basura', platform: 'ios' });
    assert.equal(bad.status, 400);
  });

  test('la cola de envíos procesa push y email', async () => {
    const { processDeliveries } = require('../src/modules/notifications/notify.service');
    const n = await processDeliveries();
    assert.ok(n >= 1);
    const [[{ queued }]] = await pool.query("SELECT COUNT(*) AS queued FROM notification_deliveries WHERE status = 'queued'");
    assert.equal(queued, 0);
  });
});

// ===========================================================================
describe('dojo y subidas', () => {
  test('el admin edita colores y reglas; el alumno no', async () => {
    const d = ok(await api('patch', '/dojo', T.admin, { color_primary: '#0F766E', booking_cancel_hours: 4 }));
    assert.equal(d.color_primary, '#0F766E');
    assert.equal((await api('patch', '/dojo', T.student, { name: 'Hackeado' })).status, 403);
    const pub = ok(await api('get', '/dojo', T.student));
    assert.ok(!('tax_id' in pub));
  });

  test('subir foto: valida que sea una imagen real', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const r = await request(app).post('/api/v2/uploads/avatar').set('Authorization', `Bearer ${T.student}`)
      .attach('file', png, { filename: 'yo.png', contentType: 'image/png' });
    assert.equal(r.status, 201);
    assert.match(r.body.data.url, /^\/uploads\/avatars\/2\//);
    const fake = await request(app).post('/api/v2/uploads/avatar').set('Authorization', `Bearer ${T.student}`)
      .attach('file', Buffer.from('<?php echo 1; ?>'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(fake.status, 400);
  });
});
