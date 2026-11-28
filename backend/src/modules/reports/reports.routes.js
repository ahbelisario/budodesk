/**
 * /api/v2/reports — reportes del dojo
 *
 *   GET /finance?from=AAAA-MM&to=AAAA-MM      ingresos, gastos y balance por mes        (dueño/admin)
 *   GET /receivables                           quién debe y desde cuándo                 (dueño/admin)
 *   GET /members?from&to                       altas, bajas y quién pagó por mes         (personal)
 *   GET /attendance?from=AAAA-MM-DD&to=…       asistencia por clase y por alumno         (personal)
 *   GET /ranks?from&to                         exámenes, promociones y grados actuales   (personal)
 *
 * Los meses y días son los del dojo (su zona horaria).
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { badRequest } = require('../../utils/errors');
const { todayIn, addMonths, addDays, tzOffset } = require('../../utils/dates');
const finance = require('../finance/finance.service');

const router = express.Router();
router.use(authenticate, requireDojo);
const ADMIN = requireRole('admin');
const STAFF = requireRole('admin', 'staff', 'instructor');
// Finanzas: solo en el plan Pro (o en prueba)
const FINANCE = require('../../services/subscription').requireFeature('finance');

const ym = z.string().regex(/^\d{4}-\d{2}$/, 'Mes AAAA-MM');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const NAME = "CONCAT_WS(' ', p.first_name, p.last_name)";

async function dojoInfo(tdb) {
  const d = await tdb.one('SELECT timezone, currency FROM dojos WHERE id = :dojoId');
  return { tz: d.timezone, offset: tzOffset(d.timezone), today: todayIn(d.timezone), currency: d.currency };
}

/** Lista de meses 'AAAA-MM' entre dos meses (máx. 60) */
function monthList(from, to) {
  if (from > to) throw badRequest('El mes inicial va después del final');
  const out = [];
  for (let m = `${from}-01`; m.slice(0, 7) <= to; m = addMonths(m, 1)) {
    out.push(m.slice(0, 7));
    if (out.length > 60) throw badRequest('Máximo 60 meses por reporte');
  }
  return out;
}

function defaultMonths(q, today, back = 11) {
  const to = q.to || today.slice(0, 7);
  const from = q.from || addMonths(`${to}-01`, -back).slice(0, 7);
  return { from, to, months: monthList(from, to), start: `${from}-01`, end: addDays(addMonths(`${to}-01`, 1), -1) };
}

// ---------------------------------------------------------------------------
// Finanzas
// ---------------------------------------------------------------------------
const TYPE_GROUP = { membership: 'membership', exam_fee: 'exams', signup_fee: 'signup' }; // el resto → other

router.get('/finance', ADMIN, FINANCE, validate({ query: z.object({ from: ym.optional(), to: ym.optional() }) }), async (req, res) => {
  const tdb = req.tdb;
  const d = await dojoInfo(tdb);
  await finance.ensureCategories(tdb);
  await finance.generateRecurring(req.auth.dojoId, d.today);
  const R = defaultMonths(req.valid.query, d.today);
  const local = "CONVERT_TZ(py.paid_at, '+00:00', :off)";
  const params = { off: d.offset, start: R.start, end: R.end };
  const inRange = `${local} >= :start AND ${local} < DATE_ADD(:end, INTERVAL 1 DAY)`;

  const byMethod = await tdb.query(
    `SELECT DATE_FORMAT(${local}, '%Y-%m') AS ym, py.method, SUM(py.amount - py.refunded_amount) AS amount,
            SUM(COALESCE(py.provider_fee, 0)) AS fees
       FROM payments py
      WHERE py.dojo_id = :dojoId AND py.status IN ('completed','partially_refunded') AND ${inRange}
      GROUP BY ym, py.method`, params);
  const byType = await tdb.query(
    `SELECT DATE_FORMAT(${local}, '%Y-%m') AS ym, c.type, SUM(a.amount) AS amount
       FROM payments py
       JOIN payment_allocations a ON a.dojo_id = py.dojo_id AND a.payment_id = py.id
       JOIN charges c ON c.dojo_id = a.dojo_id AND c.id = a.charge_id
      WHERE py.dojo_id = :dojoId AND py.status IN ('completed','partially_refunded') AND ${inRange}
      GROUP BY ym, c.type`, params);
  const entries = await tdb.query(
    `SELECT DATE_FORMAT(entry_date, '%Y-%m') AS ym, kind, category_id, SUM(amount) AS amount
       FROM finance_entries WHERE dojo_id = :dojoId AND entry_date BETWEEN :start AND :end
      GROUP BY ym, kind, category_id`, params);
  const categories = await tdb.query(
    'SELECT id, kind, name, active FROM finance_categories WHERE dojo_id = :dojoId ORDER BY kind, sort_order, name');

  const blank = () => ({
    tuition: { membership: 0, exams: 0, signup: 0, other: 0, credit: 0, total: 0 },
    methods: {}, other_income: {}, other_income_total: 0, expenses: {}, online_fees: 0, expense_total: 0,
    income_total: 0, net: 0,
  });
  const rows = Object.fromEntries(R.months.map((m) => [m, { month: m, ...blank() }]));
  for (const x of byMethod) {
    const r = rows[x.ym]; if (!r) continue;
    r.methods[x.method] = r2((r.methods[x.method] || 0) + Number(x.amount));
    r.tuition.total = r2(r.tuition.total + Number(x.amount));
    r.online_fees = r2(r.online_fees + Number(x.fees));
  }
  for (const x of byType) {
    const r = rows[x.ym]; if (!r) continue;
    const g = TYPE_GROUP[x.type] || 'other';
    r.tuition[g] = r2(r.tuition[g] + Number(x.amount));
  }
  for (const x of entries) {
    const r = rows[x.ym]; if (!r) continue;
    const bucket = x.kind === 'income' ? r.other_income : r.expenses;
    bucket[x.category_id] = r2((bucket[x.category_id] || 0) + Number(x.amount));
  }
  let running = 0;
  for (const r of Object.values(rows)) {
    const t = r.tuition;
    t.credit = r2(Math.max(0, t.total - t.membership - t.exams - t.signup - t.other)); // pagado sin aplicar: saldo a favor
    r.other_income_total = r2(Object.values(r.other_income).reduce((s, v) => s + v, 0));
    r.expense_total = r2(Object.values(r.expenses).reduce((s, v) => s + v, 0) + r.online_fees);
    r.income_total = r2(t.total + r.other_income_total);
    r.net = r2(r.income_total - r.expense_total);
    running = r2(running + r.net);
    r.cumulative = running;
  }
  const list = Object.values(rows);
  const sumBy = (f) => r2(list.reduce((s, r) => s + f(r), 0));
  const totals = {
    tuition: Object.fromEntries(Object.keys(blank().tuition).map((k) => [k, sumBy((r) => r.tuition[k])])),
    methods: {}, other_income: {}, expenses: {},
    other_income_total: sumBy((r) => r.other_income_total), online_fees: sumBy((r) => r.online_fees),
    expense_total: sumBy((r) => r.expense_total), income_total: sumBy((r) => r.income_total), net: sumBy((r) => r.net),
  };
  for (const r of list) {
    for (const k of ['methods', 'other_income', 'expenses']) {
      for (const [key, v] of Object.entries(r[k])) totals[k][key] = r2((totals[k][key] || 0) + v);
    }
  }
  res.json({ status: 'success', data: { from: R.from, to: R.to, currency: d.currency, months: list, totals, categories } });
});

// ---------------------------------------------------------------------------
// Por cobrar
// ---------------------------------------------------------------------------
router.get('/receivables', ADMIN, FINANCE, async (req, res) => {
  const d = await dojoInfo(req.tdb);
  const rows = await req.tdb.query(
    `SELECT c.user_id, ${NAME} AS name, COUNT(*) AS charges, MIN(c.due_date) AS oldest_due,
            SUM(c.total - c.amount_paid) AS owed,
            SUM(CASE WHEN c.due_date >= :today THEN c.total - c.amount_paid ELSE 0 END) AS not_due,
            SUM(CASE WHEN c.due_date < :today THEN c.total - c.amount_paid ELSE 0 END) AS overdue,
            SUM(CASE WHEN DATEDIFF(:today, c.due_date) BETWEEN 1 AND 30 THEN c.total - c.amount_paid ELSE 0 END) AS d1_30,
            SUM(CASE WHEN DATEDIFF(:today, c.due_date) BETWEEN 31 AND 60 THEN c.total - c.amount_paid ELSE 0 END) AS d31_60,
            SUM(CASE WHEN DATEDIFF(:today, c.due_date) BETWEEN 61 AND 90 THEN c.total - c.amount_paid ELSE 0 END) AS d61_90,
            SUM(CASE WHEN DATEDIFF(:today, c.due_date) > 90 THEN c.total - c.amount_paid ELSE 0 END) AS d90
       FROM charges c JOIN user_profiles p ON p.user_id = c.user_id
      WHERE c.dojo_id = :dojoId AND c.status IN ('pending','partial')
      GROUP BY c.user_id, name HAVING owed > 0
      ORDER BY overdue DESC, owed DESC`, { today: d.today });
  const keys = ['total', 'current', 'overdue', 'd1_30', 'd31_60', 'd61_90', 'd90'];
  const data = rows.map(({ owed, not_due: notDue, ...r }) => ({
    ...r, charges: Number(r.charges), ...Object.fromEntries(keys.map((k) => [k, r2({ ...r, total: owed, current: notDue }[k])])),
  }));
  const totals = Object.fromEntries(keys.map((k) => [k, r2(data.reduce((s, r) => s + r[k], 0))]));
  res.json({ status: 'success', data: { today: d.today, currency: d.currency, rows: data, totals, people: data.length } });
});

// ---------------------------------------------------------------------------
// Alumnos
// ---------------------------------------------------------------------------
router.get('/members', STAFF, validate({ query: z.object({ from: ym.optional(), to: ym.optional() }) }), async (req, res) => {
  const tdb = req.tdb;
  const d = await dojoInfo(tdb);
  const R = defaultMonths(req.valid.query, d.today);
  const STUDENT = `EXISTS (SELECT 1 FROM dojo_member_roles r WHERE r.dojo_id = m.dojo_id AND r.user_id = m.user_id AND r.role = 'student')`;
  const joined = await tdb.query(
    `SELECT DATE_FORMAT(m.joined_at, '%Y-%m') AS ym, COUNT(*) AS n FROM dojo_members m
      WHERE m.dojo_id = :dojoId AND ${STUDENT} AND m.joined_at BETWEEN :start AND :end GROUP BY ym`, R);
  const left = await tdb.query(
    `SELECT DATE_FORMAT(m.left_at, '%Y-%m') AS ym, COUNT(*) AS n FROM dojo_members m
      WHERE m.dojo_id = :dojoId AND ${STUDENT} AND m.left_at BETWEEN :start AND :end GROUP BY ym`, R);
  // Quién pagó su mensualidad de ese mes (por quien paga: una familia cuenta una vez)
  const paying = await tdb.query(
    `SELECT DATE_FORMAT(c.period_start, '%Y-%m') AS ym, COUNT(DISTINCT c.user_id) AS payers,
            SUM(c.status = 'paid') AS paid, SUM(c.status IN ('pending','partial')) AS unpaid
       FROM charges c WHERE c.dojo_id = :dojoId AND c.type = 'membership' AND c.status IN ('paid','partial','pending')
        AND c.period_start BETWEEN :start AND :end GROUP BY ym`, R);
  const idx = (rows, k = 'n') => Object.fromEntries(rows.map((r) => [r.ym, Number(r[k])]));
  const J = idx(joined); const L = idx(left); const P = idx(paying, 'paid'); const U = idx(paying, 'unpaid');
  const months = R.months.map((m) => ({ month: m, joined: J[m] || 0, left: L[m] || 0, paid: P[m] || 0, unpaid: U[m] || 0 }));

  const [snap] = await tdb.query(
    `SELECT SUM(m.status = 'active') AS active, SUM(m.status = 'inactive') AS inactive, SUM(m.status = 'pending') AS pending,
            SUM(m.status = 'active' AND p.date_of_birth IS NOT NULL AND p.date_of_birth > DATE_SUB(:today, INTERVAL 18 YEAR)) AS minors,
            SUM(m.status = 'active' AND u.password_hash IS NOT NULL) AS with_access
       FROM dojo_members m JOIN user_profiles p ON p.user_id = m.user_id JOIN users u ON u.id = m.user_id
      WHERE m.dojo_id = :dojoId AND ${STUDENT}`, { today: d.today });
  const snapshot = Object.fromEntries(Object.entries(snap || {}).map(([k, v]) => [k, Number(v || 0)]));
  res.json({ status: 'success', data: { from: R.from, to: R.to, months, snapshot } });
});

// ---------------------------------------------------------------------------
// Asistencia
// ---------------------------------------------------------------------------
router.get('/attendance', STAFF, validate({ query: z.object({ from: ymd.optional(), to: ymd.optional() }) }), async (req, res) => {
  const tdb = req.tdb;
  const d = await dojoInfo(tdb);
  const to = req.valid.query.to || d.today;
  const from = req.valid.query.from || addDays(to, -29);
  if (from > to) throw badRequest('La fecha inicial va después de la final');
  const p = { from, to: to > d.today ? d.today : to };

  const classes = await tdb.query(
    `SELECT COALESCE(s.series_id, CONCAT('s', s.id)) AS k, MAX(s.title) AS title, MAX(dc.name) AS discipline,
            COUNT(DISTINCT s.id) AS sessions, SUM(b.status = 'attended') AS attended, SUM(b.status = 'no_show') AS no_show
       FROM class_sessions s
       LEFT JOIN class_bookings b ON b.dojo_id = s.dojo_id AND b.session_id = s.id
       LEFT JOIN disciplines dc ON dc.dojo_id = s.dojo_id AND dc.id = s.discipline_id
      WHERE s.dojo_id = :dojoId AND s.status <> 'cancelled' AND s.session_date BETWEEN :from AND :to
      GROUP BY k ORDER BY attended DESC, title`, p);
  const students = await tdb.query(
    `SELECT m.user_id, ${NAME} AS name, m.status,
            COALESCE(SUM(b.status = 'attended'), 0) AS attended, COALESCE(SUM(b.status = 'no_show'), 0) AS no_show,
            (SELECT MAX(s2.session_date) FROM class_bookings b2 JOIN class_sessions s2 ON s2.dojo_id = b2.dojo_id AND s2.id = b2.session_id
              WHERE b2.dojo_id = m.dojo_id AND b2.user_id = m.user_id AND b2.status = 'attended') AS last_attended
       FROM dojo_members m JOIN user_profiles p ON p.user_id = m.user_id
       LEFT JOIN class_sessions s ON s.dojo_id = m.dojo_id AND s.session_date BETWEEN :from AND :to AND s.status <> 'cancelled'
       LEFT JOIN class_bookings b ON b.dojo_id = s.dojo_id AND b.session_id = s.id AND b.user_id = m.user_id
      WHERE m.dojo_id = :dojoId AND m.status = 'active'
        AND EXISTS (SELECT 1 FROM dojo_member_roles r WHERE r.dojo_id = m.dojo_id AND r.user_id = m.user_id AND r.role = 'student')
      GROUP BY m.user_id, name, m.status
      ORDER BY attended DESC, name`, p);
  // Clases impartidas por instructor (quien la dio: suplente o el asignado)
  const instructors = await tdb.query(
    `SELECT x.uid AS user_id, CONCAT_WS(' ', p.first_name, p.last_name) AS name, COUNT(*) AS sessions,
            SUM(x.sub) AS as_substitute, COALESCE(SUM(x.att), 0) AS attended
       FROM (SELECT COALESCE(s.taught_by, s.instructor_id) AS uid, s.taught_by IS NOT NULL AS sub,
                    (SELECT COUNT(*) FROM class_bookings b WHERE b.dojo_id = s.dojo_id AND b.session_id = s.id AND b.status = 'attended') AS att
               FROM class_sessions s
              WHERE s.dojo_id = :dojoId AND s.status <> 'cancelled' AND s.session_date BETWEEN :from AND :to
                AND COALESCE(s.taught_by, s.instructor_id) IS NOT NULL) x
       JOIN user_profiles p ON p.user_id = x.uid
      GROUP BY x.uid, name ORDER BY sessions DESC, name`, p);
  const num = (rows, ks) => rows.map((r) => ({ ...r, ...Object.fromEntries(ks.map((k) => [k, Number(r[k] || 0)])) }));
  const cls = num(classes, ['sessions', 'attended', 'no_show']).map((c) => ({ ...c, avg: c.sessions ? r2(c.attended / c.sessions) : 0 }));
  const st = num(students, ['attended', 'no_show']);
  const sessions = cls.reduce((s, c) => s + c.sessions, 0);
  const attended = cls.reduce((s, c) => s + c.attended, 0);
  res.json({
    status: 'success',
    data: {
      from, to: p.to, classes: cls, students: st,
      instructors: num(instructors, ['sessions', 'as_substitute', 'attended']),
      totals: { sessions, attended, avg: sessions ? r2(attended / sessions) : 0, students_without: st.filter((s) => s.attended === 0).length },
    },
  });
});

// ---------------------------------------------------------------------------
// Grados
// ---------------------------------------------------------------------------
router.get('/ranks', STAFF, validate({ query: z.object({ from: ymd.optional(), to: ymd.optional() }) }), async (req, res) => {
  const tdb = req.tdb;
  const d = await dojoInfo(tdb);
  const to = req.valid.query.to || d.today;
  const from = req.valid.query.from || `${to.slice(0, 4)}-01-01`;
  const p = { from, to };
  const exams = await tdb.query(
    `SELECT e.id, e.title, e.exam_date, e.status, dc.name AS discipline,
            COUNT(ec.id) AS candidates, SUM(ec.status = 'passed') AS passed, SUM(ec.status = 'failed') AS failed,
            SUM(ec.status = 'absent') AS absent
       FROM exams e JOIN disciplines dc ON dc.dojo_id = e.dojo_id AND dc.id = e.discipline_id
       LEFT JOIN exam_candidates ec ON ec.dojo_id = e.dojo_id AND ec.exam_id = e.id
      WHERE e.dojo_id = :dojoId AND e.exam_date BETWEEN :from AND :to AND e.status <> 'cancelled'
      GROUP BY e.id ORDER BY e.exam_date DESC`, p);
  const promotions = await tdb.query(
    `SELECT h.user_id, ${NAME} AS name, h.awarded_date, rk.name AS rank_name, dc.name AS discipline
       FROM rank_history h JOIN user_profiles p ON p.user_id = h.user_id
       JOIN ranks rk ON rk.dojo_id = h.dojo_id AND rk.id = h.rank_id
       JOIN disciplines dc ON dc.dojo_id = h.dojo_id AND dc.id = h.discipline_id
      WHERE h.dojo_id = :dojoId AND h.event_type = 'promotion' AND h.awarded_date BETWEEN :from AND :to
      ORDER BY h.awarded_date DESC, name`, p);
  const distribution = await tdb.query(
    `SELECT dc.name AS discipline, rk.id AS rank_id, rk.name AS rank_name, rk.level, rk.kind, COUNT(*) AS members
       FROM member_ranks mr JOIN dojo_members m ON m.dojo_id = mr.dojo_id AND m.user_id = mr.user_id AND m.status = 'active'
       JOIN ranks rk ON rk.dojo_id = mr.dojo_id AND rk.id = mr.rank_id
       JOIN disciplines dc ON dc.dojo_id = mr.dojo_id AND dc.id = mr.discipline_id
      WHERE mr.dojo_id = :dojoId
      GROUP BY dc.name, rk.id, rk.name, rk.level, rk.kind ORDER BY dc.name, rk.level`);
  const n = (rows, ks) => rows.map((r) => ({ ...r, ...Object.fromEntries(ks.map((k) => [k, Number(r[k] || 0)])) }));
  res.json({
    status: 'success',
    data: { from, to, exams: n(exams, ['candidates', 'passed', 'failed', 'absent']), promotions, distribution: n(distribution, ['members']) },
  });
});

module.exports = router;
module.exports.tzOffset = tzOffset;
