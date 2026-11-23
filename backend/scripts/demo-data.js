/**
 * Datos de ejemplo para desarrollo (NO correr en producción).
 * Crea alumnos, un tutor con dos hijos, membresías, pagos, clases con
 * asistencia, un examen y un aviso en el dojo indicado.
 *
 *   docker compose -f compose-dev.yaml exec backend node scripts/demo-data.js --dojo seikoukan --admin tu@correo.mx
 *   (pide la contraseña del admin; o ADMIN_PASSWORD=...)
 *
 * Todas las cuentas demo tienen la contraseña: Demo-BudoDesk-1
 */
const readline = require('readline');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const { pool, one } = require('../src/db/pool');
const { todayIn, addDays, weekdayIndex } = require('../src/utils/dates');

const DEMO_PASSWORD = 'Demo-BudoDesk-1';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const API = process.env.DEMO_API_URL || `http://127.0.0.1:${env.PORT}/api/v2`;

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

let token;
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.code}: ${json?.message} ${JSON.stringify(json?.details ?? '')}`);
  return json.data;
}

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Este script es solo para desarrollo');
  const slug = arg('dojo') || 'seikoukan';
  const adminEmail = arg('admin');
  if (!adminEmail) throw new Error('Falta --admin tu@correo.mx');
  const password = process.env.ADMIN_PASSWORD || await askHidden(`Contraseña de ${adminEmail}: `);

  const login = await call('POST', '/auth/login', { identifier: adminEmail, password, dojo_slug: slug });
  token = login.access_token;
  const dojo = await one(pool, 'SELECT id, timezone FROM dojos WHERE slug = :slug', { slug });
  const today = todayIn(dojo.timezone);
  const exists = await one(pool, `SELECT 1 AS ok FROM users WHERE email = 'laura.demo@budodesk.mx'`);
  if (exists) { console.log('Los datos demo ya existen en esta base.'); return; }

  const rank = async (disc, level) => (await one(pool,
    'SELECT r.id FROM ranks r JOIN disciplines d ON d.id = r.discipline_id WHERE r.dojo_id = :dojo AND d.name = :disc AND r.level = :level',
    { dojo: dojo.id, disc, level })).id;
  const aikido = (await one(pool, `SELECT id FROM disciplines WHERE dojo_id = :d AND name = 'Aikido'`, { d: dojo.id })).id;
  const karate = (await one(pool, `SELECT id FROM disciplines WHERE dojo_id = :d AND name = 'Karate Do'`, { d: dojo.id })).id;

  // ---------------- Personas ----------------
  const member = (body) => call('POST', '/members', body);
  const raul = await member({ email: 'raul.demo@budodesk.mx', first_name: 'Raúl', last_name: 'Uribe', roles: ['instructor', 'student'],
    initial_ranks: [{ discipline_id: aikido, rank_id: await rank('Aikido', 12), since_date: addDays(today, -900) }] });
  const laura = await member({ email: 'laura.demo@budodesk.mx', first_name: 'Laura', last_name: 'Ortega', phone: '5512345678', roles: ['student', 'guardian'],
    initial_ranks: [{ discipline_id: aikido, rank_id: await rank('Aikido', 3), since_date: addDays(today, -150) }] });
  const sofia = await member({ first_name: 'Sofía', last_name: 'Ortega', date_of_birth: addDays(today, -365 * 9 - 40), guardian_user_id: laura.id, guardian_relationship: 'mother',
    initial_ranks: [{ discipline_id: aikido, rank_id: await rank('Aikido', 3), since_date: addDays(today, -110) }] });
  const mateo = await member({ first_name: 'Mateo', last_name: 'Ortega', date_of_birth: addDays(today, -365 * 11 - 100), guardian_user_id: laura.id, guardian_relationship: 'mother',
    initial_ranks: [{ discipline_id: karate, rank_id: await rank('Karate Do', 2), since_date: addDays(today, -60) }] });
  const diego = await member({ email: 'diego.demo@budodesk.mx', first_name: 'Diego', last_name: 'Martínez', date_of_birth: '1992-03-14',
    blood_type: 'O+', medical_notes: 'Lesión de rodilla izquierda (2025). Evitar suwari waza prolongado.',
    emergency_contact_name: 'Paola Ruiz', emergency_contact_phone: '5587654321', emergency_contact_relation: 'Esposa',
    initial_ranks: [{ discipline_id: aikido, rank_id: await rank('Aikido', 6), since_date: addDays(today, -215) }] });
  const ana = await member({ email: 'ana.demo@budodesk.mx', first_name: 'Ana', last_name: 'Pérez',
    initial_ranks: [{ discipline_id: aikido, rank_id: await rank('Aikido', 2), since_date: addDays(today, -90) }] });
  await member({ email: 'jorge.demo@budodesk.mx', first_name: 'Jorge', last_name: 'Treviño', status: 'pending' });

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await pool.query(
    `UPDATE users SET password_hash = :h, email_verified_at = NOW() WHERE email IN
       ('raul.demo@budodesk.mx','laura.demo@budodesk.mx','diego.demo@budodesk.mx','ana.demo@budodesk.mx')`, { h: hash });
  await pool.query(`UPDATE dojo_members SET joined_at = :d WHERE dojo_id = :dojo AND user_id = :u`, { d: addDays(today, -400), dojo: dojo.id, u: diego.id });
  await pool.query(`UPDATE user_profiles SET date_of_birth = :d WHERE user_id = :u`, { d: `1990-${today.slice(5, 7)}-${String(Math.min(28, Number(today.slice(8)) + 2)).padStart(2, '0')}`, u: ana.id });

  // Temario del siguiente grado de Diego y de Sofía
  for (const [lv, names] of [[7, ['Ikkyo omote y ura', 'Kotegaeshi', 'Shihonage', 'Iriminage', 'Ukemi adelante y atrás']], [4, ['Tenkan', 'Ikkyo omote', 'Ukemi atrás', 'Etiqueta del dojo']]]) {
    const r = await rank('Aikido', lv);
    for (const name of names) await call('POST', `/ranks/${r}/requirements`, { name, category: 'technique' });
  }
  const reqs = await pool.query(`SELECT q.id, r.level FROM rank_requirements q JOIN ranks r ON r.id = q.rank_id WHERE q.dojo_id = :d`, { d: dojo.id });
  for (const q of reqs[0]) {
    if (q.level === 7) await call('PUT', `/progress/members/${diego.id}/requirements/${q.id}`, { status: 'approved' });
  }
  for (const q of reqs[0].filter((x) => x.level === 4).slice(0, 3)) await call('PUT', `/progress/members/${sofia.id}/requirements/${q.id}`, { status: 'approved' });

  // ---------------- Dojo ----------------
  await call('PATCH', '/dojo/payment-settings', { transfer_instructions: 'BBVA · CLABE 012 180 00000000000 0\nA nombre de Seikoukan A.C.\nEnvía tu comprobante por WhatsApp.' });

  // ---------------- Membresías y pagos ----------------
  const disc = (await one(pool, `SELECT id FROM discounts WHERE dojo_id = :d AND name = 'Familiar'`, { d: dojo.id }))?.id;
  const msFam = await call('POST', '/memberships', { plan_id: (await one(pool, `SELECT id FROM plans WHERE dojo_id = :d AND name = 'Familiar'`, { d: dojo.id })).id,
    member_ids: [sofia.id, mateo.id], payer_user_id: laura.id, start_date: addDays(today, -38) });
  const indiv = (await one(pool, `SELECT id FROM plans WHERE dojo_id = :d AND name = 'Individual Mensual'`, { d: dojo.id })).id;
  await call('POST', '/memberships', { plan_id: indiv, member_ids: [laura.id], discount_id: disc, start_date: addDays(today, -38) });
  const msDiego = await call('POST', '/memberships', { plan_id: indiv, member_ids: [diego.id], start_date: addDays(today, -20) });
  await pool.query('UPDATE memberships SET sessions_per_week = 3 WHERE id = :id', { id: msDiego.id });
  await call('POST', '/memberships', { plan_id: indiv, member_ids: [ana.id], start_date: addDays(today, -50) });
  await call('POST', '/memberships', { plan_id: indiv, member_ids: [raul.id], discount_id: disc, start_date: addDays(today, -10) });
  await call('POST', '/memberships/billing/run');

  await call('POST', '/payments', { user_id: diego.id, amount: 750, method: 'cash' });
  await call('POST', '/payments', { user_id: laura.id, amount: 1800, method: 'transfer', reference: 'SPEI 8821', paid_at: addDays(today, -35) });
  await call('POST', '/payments', { user_id: ana.id, amount: 1500, method: 'transfer', reference: 'SPEI 7710', paid_at: addDays(today, -30) });
  await call('POST', '/payments', { user_id: raul.id, amount: 600, method: 'cash' });
  await pool.query(`UPDATE payments SET paid_at = DATE_SUB(paid_at, INTERVAL 1 MONTH) WHERE dojo_id = :d AND user_id = :u`, { d: dojo.id, u: ana.id });

  // ---------------- Clases ----------------
  const starts = addDays(today, -56);
  const series = async (b) => call('POST', '/classes/series', { starts_on: starts, location_id: 1, ...b });
  await series({ title: 'Aikido infantil', discipline_id: aikido, instructor_id: raul.id, days_of_week: ['mon', 'wed', 'fri'], start_time: '17:00', end_time: '18:00', capacity: 15 });
  await series({ title: 'Aikido adultos', discipline_id: aikido, instructor_id: login.user.id, days_of_week: ['tue', 'thu'], start_time: '19:00', end_time: '20:30', capacity: 3 });
  await series({ title: 'Karate Do', discipline_id: karate, instructor_id: login.user.id, days_of_week: ['sat'], start_time: '10:00', end_time: '11:30', capacity: 20 });
  await series({ title: 'Aikido adultos (mañana)', discipline_id: aikido, instructor_id: raul.id, days_of_week: ['mon', 'wed', 'fri', 'sun'], start_time: '07:00', end_time: '08:00', capacity: 12 });

  // Historial: sesiones pasadas con asistencia (las series solo generan de hoy en adelante)
  for (let d = addDays(today, -56); d < today; d = addDays(d, 1)) {
    const wd = weekdayIndex(d);
    if ([0, 2, 4].includes(wd)) {
      const s = await call('POST', '/classes/sessions', { title: 'Aikido infantil', discipline_id: aikido, instructor_id: raul.id, session_date: d, start_time: '17:00', end_time: '18:00', capacity: 15 });
      const entries = [{ user_id: sofia.id, status: Math.random() < 0.85 ? 'attended' : 'no_show' }];
      await call('PUT', `/classes/sessions/${s.id}/attendance`, { entries, complete: true });
    }
    if ([1, 3].includes(wd)) {
      const s = await call('POST', '/classes/sessions', { title: 'Aikido adultos', discipline_id: aikido, instructor_id: login.user.id, session_date: d, start_time: '19:00', end_time: '20:30', capacity: 12 });
      const entries = [{ user_id: diego.id, status: 'attended' }, { user_id: laura.id, status: Math.random() < 0.7 ? 'attended' : 'no_show' }];
      if (d < addDays(today, -30)) entries.push({ user_id: ana.id, status: 'attended' });
      await call('PUT', `/classes/sessions/${s.id}/attendance`, { entries, complete: true });
    }
  }
  // Diego necesita 40 clases en su grado: le sumamos historial anterior
  await pool.query(
    `INSERT INTO class_sessions (dojo_id, title, discipline_id, session_date, start_time, end_time, status, is_modified)
     SELECT :d, 'Aikido adultos', :disc, DATE_SUB(:today, INTERVAL 57 + n DAY), '19:00', '20:30', 'completed', 1
       FROM (SELECT 0 n UNION SELECT 3 UNION SELECT 7 UNION SELECT 10 UNION SELECT 14 UNION SELECT 17 UNION SELECT 21 UNION SELECT 24
             UNION SELECT 28 UNION SELECT 31 UNION SELECT 35 UNION SELECT 38 UNION SELECT 42 UNION SELECT 45 UNION SELECT 49
             UNION SELECT 52 UNION SELECT 56 UNION SELECT 59 UNION SELECT 63 UNION SELECT 66 UNION SELECT 70 UNION SELECT 73) x`,
    { d: dojo.id, disc: aikido, today });
  await pool.query(
    `INSERT INTO class_bookings (dojo_id, session_id, user_id, status, checked_in_at)
     SELECT :d, id, :u, 'attended', NOW() FROM class_sessions WHERE dojo_id = :d AND session_date < DATE_SUB(:today, INTERVAL 56 DAY)`,
    { d: dojo.id, u: diego.id, today });

  // Próximas reservas
  const upcoming = (await pool.query(
    `SELECT id, title FROM class_sessions WHERE dojo_id = :d AND session_date >= :today AND status = 'scheduled' ORDER BY session_date, start_time`,
    { d: dojo.id, today }))[0];
  const firstOf = (title, skip = 0) => upcoming.filter((s) => s.title === title)[skip];
  const kids = firstOf('Aikido infantil');
  if (kids) await call('POST', `/classes/sessions/${kids.id}/book`, { user_id: sofia.id });
  const adults = firstOf('Aikido adultos');
  if (adults) {
    for (const u of [diego.id, raul.id, laura.id]) await call('POST', `/classes/sessions/${adults.id}/book`, { user_id: u, force: true });
    await call('POST', `/classes/sessions/${adults.id}/book`, { user_id: ana.id, force: false }).catch(() => {});
  }

  // ---------------- Examen y aviso ----------------
  const exam = await call('POST', '/exams', { discipline_id: aikido, title: 'Examen de invierno', exam_date: addDays(today, 20), start_time: '10:00' });
  await call('POST', `/exams/${exam.id}/candidates`, { user_ids: [diego.id, sofia.id] });
  await call('POST', '/announcements', { title: `Examen de invierno · ${addDays(today, 20)}`, body: 'Revisen con su sensei si están convocados. La cuota de examen ya aparece en su estado de cuenta.', audience: 'all', send_push: false });

  console.log(`Listo. Cuentas demo (contraseña ${DEMO_PASSWORD}):
  Tutora con 2 hijos: laura.demo@budodesk.mx
  Alumno listo para examen: diego.demo@budodesk.mx
  Instructor: raul.demo@budodesk.mx
  Alumna que dejó de venir: ana.demo@budodesk.mx`);
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
