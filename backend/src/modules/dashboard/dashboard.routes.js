/**
 * /api/v2/dashboard — indicadores para el admin, calculados en SQL
 * (el frontend ya no descarga todas las tablas para contar).
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { getDojo } = require('../../utils/dojo');
const { todayIn, addDays, addMonths } = require('../../utils/dates');

const router = express.Router();
router.use(authenticate, requireDojo, requireRole('admin', 'staff', 'instructor'));

const AT_RISK_DAYS = 14;

async function dates(req) {
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  return { dojo, today, monthStart, prevMonthStart: addMonths(monthStart, -1) };
}

router.get('/summary', async (req, res) => {
  const { today, monthStart, prevMonthStart, dojo } = await dates(req);
  const p = { today, monthStart, prevMonthStart, d7: addDays(today, 7), d30: addDays(today, -30), risk: addDays(today, -AT_RISK_DAYS) };
  const financial = req.auth.roles.some((r) => ['admin', 'staff'].includes(r));

  const [members] = await req.tdb.query(
    `SELECT SUM(status = 'active') AS active, SUM(status = 'pending') AS pending_approval,
            SUM(status = 'active' AND joined_at >= :monthStart) AS new_this_month,
            SUM(status = 'inactive' AND left_at >= :monthStart) AS left_this_month
       FROM dojo_members WHERE dojo_id = :dojoId`, p);

  const [ms] = await req.tdb.query(
    `SELECT SUM(ms.status = 'active') AS active, SUM(ms.status = 'past_due') AS past_due, SUM(ms.status = 'paused') AS paused,
            SUM(ms.status IN ('active','past_due') AND (ms.auto_renew = 0 OR ms.cancel_at_period_end = 1 OR pl.billing_type <> 'recurring')
                AND COALESCE(ms.end_date, ms.current_period_end) BETWEEN :today AND :d7) AS expiring_7d
       FROM memberships ms JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
      WHERE ms.dojo_id = :dojoId`, p);

  const [att] = await req.tdb.query(
    `SELECT SUM(b.status = 'attended') AS attended, SUM(b.status = 'no_show') AS no_show
       FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
      WHERE b.dojo_id = :dojoId AND s.session_date BETWEEN :d30 AND :today`, p);

  const [risk] = await req.tdb.query(
    `SELECT COUNT(*) AS n FROM dojo_members m
      WHERE m.dojo_id = :dojoId AND m.status = 'active'
        AND EXISTS (SELECT 1 FROM dojo_member_roles r WHERE r.dojo_id = m.dojo_id AND r.user_id = m.user_id AND r.role = 'student')
        AND EXISTS (SELECT 1 FROM membership_members mm JOIN memberships x ON x.dojo_id = mm.dojo_id AND x.id = mm.membership_id
                     WHERE mm.dojo_id = m.dojo_id AND mm.user_id = m.user_id AND x.status IN ('active','past_due'))
        AND NOT EXISTS (SELECT 1 FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
                         WHERE b.dojo_id = m.dojo_id AND b.user_id = m.user_id AND b.status = 'attended' AND s.session_date >= :risk)`, p);

  const [eligible] = await req.tdb.query(
    `SELECT COUNT(*) AS n FROM v_member_rank_progress v
       JOIN dojo_members m ON m.dojo_id = v.dojo_id AND m.user_id = v.user_id AND m.status = 'active'
      WHERE v.dojo_id = :dojoId AND v.next_rank_id IS NOT NULL
        AND (v.next_min_months IS NULL OR v.months_in_rank >= v.next_min_months)
        AND (v.next_min_classes IS NULL OR v.classes_in_rank >= v.next_min_classes)`, p);

  const todayClasses = await req.tdb.query(
    `SELECT s.id, s.title, s.start_time, s.end_time, s.capacity, s.booked_count, s.status,
            CONCAT_WS(' ', ip.first_name, ip.last_name) AS instructor_name,
            (SELECT COUNT(*) FROM class_bookings b WHERE b.dojo_id = s.dojo_id AND b.session_id = s.id AND b.status = 'attended') AS checked_in
       FROM class_sessions s LEFT JOIN user_profiles ip ON ip.user_id = s.instructor_id
      WHERE s.dojo_id = :dojoId AND s.session_date = :today AND s.status <> 'cancelled'
      ORDER BY s.start_time`, p);

  const upcomingExams = await req.tdb.query(
    `SELECT e.id, e.title, e.exam_date, d.name AS discipline,
            (SELECT COUNT(*) FROM exam_candidates c WHERE c.dojo_id = e.dojo_id AND c.exam_id = e.id) AS candidates
       FROM exams e JOIN disciplines d ON d.dojo_id = e.dojo_id AND d.id = e.discipline_id
      WHERE e.dojo_id = :dojoId AND e.exam_date >= :today AND e.status IN ('planned','open','closed')
      ORDER BY e.exam_date LIMIT 5`, p);

  let finance = null;
  if (financial) {
    const [rev] = await req.tdb.query(
      `SELECT COALESCE(SUM(CASE WHEN paid_at >= :monthStart THEN amount - refunded_amount END), 0) AS this_month,
              COALESCE(SUM(CASE WHEN paid_at >= :prevMonthStart AND paid_at < :monthStart THEN amount - refunded_amount END), 0) AS last_month,
              COALESCE(SUM(CASE WHEN paid_at >= :prevMonthStart AND paid_at < DATE_ADD(:prevMonthStart, INTERVAL DATEDIFF(:today, :monthStart) + 1 DAY)
                                THEN amount - refunded_amount END), 0) AS last_month_to_date
         FROM payments WHERE dojo_id = :dojoId AND status IN ('completed','partially_refunded') AND paid_at >= :prevMonthStart`, p);
    const [rec] = await req.tdb.query(
      `SELECT COALESCE(SUM(total - amount_paid), 0) AS open_balance,
              COALESCE(SUM(CASE WHEN due_date < :today THEN total - amount_paid END), 0) AS overdue_balance,
              COUNT(DISTINCT CASE WHEN due_date < :today THEN user_id END) AS overdue_people,
              COALESCE(SUM(CASE WHEN due_date BETWEEN :today AND :d7 THEN total - amount_paid END), 0) AS due_next_7d
         FROM charges WHERE dojo_id = :dojoId AND status IN ('pending','partial')`, p);
    finance = { currency: dojo.currency, revenue: rev, receivables: rec };
  }

  const n = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? 0 : Number(v)]));
  const a = n(att);
  res.json({
    status: 'success',
    data: {
      today,
      members: n(members),
      memberships: n(ms),
      attendance_30d: { ...a, rate: a.attended + a.no_show ? Math.round((a.attended / (a.attended + a.no_show)) * 100) : null },
      at_risk: Number(risk.n), at_risk_days: AT_RISK_DAYS,
      exam_eligible: Number(eligible.n),
      today_classes: todayClasses,
      upcoming_exams: upcomingExams,
      finance: finance && { currency: finance.currency, revenue: n(finance.revenue), receivables: n(finance.receivables) },
    },
  });
});

// Ingresos por mes (últimos N meses) y por método
router.get('/revenue', requireRole('admin', 'staff'), validate({ query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }) }), async (req, res) => {
  const { monthStart } = await dates(req);
  const from = addMonths(monthStart, -(req.valid.query.months - 1));
  const rows = await req.tdb.query(
    `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, method, SUM(amount - refunded_amount) AS total, COUNT(*) AS payments
       FROM payments WHERE dojo_id = :dojoId AND status IN ('completed','partially_refunded') AND paid_at >= :from
      GROUP BY month, method ORDER BY month`, { from });
  const months = [];
  for (let m = from; m <= monthStart; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const data = months.map((month) => {
    const r = rows.filter((x) => x.month === month);
    return { month, total: r.reduce((s, x) => s + Number(x.total), 0), by_method: Object.fromEntries(r.map((x) => [x.method, Number(x.total)])) };
  });
  const byPlan = await req.tdb.query(
    `SELECT pl.name AS plan, SUM(pa.amount) AS total
       FROM payment_allocations pa
       JOIN payments py ON py.dojo_id = pa.dojo_id AND py.id = pa.payment_id
       JOIN charges c ON c.dojo_id = pa.dojo_id AND c.id = pa.charge_id
       JOIN memberships ms ON ms.dojo_id = c.dojo_id AND ms.id = c.membership_id
       JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
      WHERE pa.dojo_id = :dojoId AND py.status = 'completed' AND py.paid_at >= :from
      GROUP BY pl.id ORDER BY total DESC`, { from });
  res.json({ status: 'success', data: { months: data, by_plan: byPlan } });
});

// Asistencia por día y mapa día/hora
router.get('/attendance', validate({ query: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }) }), async (req, res) => {
  const { today } = await dates(req);
  const from = addDays(today, -(req.valid.query.days - 1));
  const daily = await req.tdb.query(
    `SELECT s.session_date AS date, SUM(b.status = 'attended') AS attended, COUNT(DISTINCT s.id) AS sessions
       FROM class_sessions s LEFT JOIN class_bookings b ON b.dojo_id = s.dojo_id AND b.session_id = s.id
      WHERE s.dojo_id = :dojoId AND s.session_date BETWEEN :from AND :today AND s.status <> 'cancelled'
      GROUP BY s.session_date ORDER BY s.session_date`, { from, today });
  const heat = await req.tdb.query(
    `SELECT WEEKDAY(s.session_date) AS weekday, HOUR(s.start_time) AS hour,
            ROUND(AVG(s.booked_count), 1) AS avg_booked, ROUND(AVG(s.capacity), 0) AS avg_capacity, COUNT(*) AS sessions
       FROM class_sessions s
      WHERE s.dojo_id = :dojoId AND s.session_date BETWEEN :from AND :today AND s.status <> 'cancelled'
      GROUP BY weekday, hour ORDER BY weekday, hour`, { from, today });
  res.json({ status: 'success', data: { from, to: today, daily, by_slot: heat } });
});

/**
 * Pendientes accionables para el home del admin.
 */
router.get('/todo', async (req, res) => {
  const { today } = await dates(req);
  const financial = req.auth.roles.some((r) => ['admin', 'staff'].includes(r));
  const p = { today, d7: addDays(today, 7), risk: addDays(today, -AT_RISK_DAYS) };

  const pending = await req.tdb.query(
    `SELECT m.user_id, p.first_name, p.last_name, u.email, m.created_at
       FROM dojo_members m JOIN user_profiles p ON p.user_id = m.user_id JOIN users u ON u.id = m.user_id
      WHERE m.dojo_id = :dojoId AND m.status = 'pending' ORDER BY m.created_at LIMIT 20`);

  const overdue = financial ? await req.tdb.query(
    `SELECT c.user_id, p.first_name, p.last_name, SUM(c.total - c.amount_paid) AS amount, MIN(c.due_date) AS oldest_due, COUNT(*) AS charges
       FROM charges c JOIN user_profiles p ON p.user_id = c.user_id
      WHERE c.dojo_id = :dojoId AND c.status IN ('pending','partial') AND c.due_date < :today
      GROUP BY c.user_id ORDER BY oldest_due LIMIT 20`, p) : [];

  const expiring = financial ? await req.tdb.query(
    `SELECT ms.id AS membership_id, pl.name AS plan, COALESCE(ms.end_date, ms.current_period_end) AS ends_on,
            (SELECT GROUP_CONCAT(CONCAT_WS(' ', xp.first_name, xp.last_name) SEPARATOR ', ')
               FROM membership_members x JOIN user_profiles xp ON xp.user_id = x.user_id
              WHERE x.dojo_id = ms.dojo_id AND x.membership_id = ms.id) AS members
       FROM memberships ms JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
      WHERE ms.dojo_id = :dojoId AND ms.status IN ('active','past_due')
        AND (ms.auto_renew = 0 OR ms.cancel_at_period_end = 1 OR pl.billing_type <> 'recurring')
        AND COALESCE(ms.end_date, ms.current_period_end) BETWEEN :today AND :d7
      ORDER BY ends_on LIMIT 20`, p) : [];

  const atRisk = await req.tdb.query(
    `SELECT m.user_id, p.first_name, p.last_name, p.phone,
            (SELECT MAX(s.session_date) FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
              WHERE b.dojo_id = m.dojo_id AND b.user_id = m.user_id AND b.status = 'attended') AS last_attended
       FROM dojo_members m JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.dojo_id = :dojoId AND m.status = 'active'
        AND EXISTS (SELECT 1 FROM membership_members mm JOIN memberships x ON x.dojo_id = mm.dojo_id AND x.id = mm.membership_id
                     WHERE mm.dojo_id = m.dojo_id AND mm.user_id = m.user_id AND x.status IN ('active','past_due'))
        AND NOT EXISTS (SELECT 1 FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
                         WHERE b.dojo_id = m.dojo_id AND b.user_id = m.user_id AND b.status = 'attended' AND s.session_date >= :risk)
      ORDER BY last_attended IS NULL, last_attended LIMIT 20`, p);

  const birthdays = await req.tdb.query(
    `SELECT m.user_id, p.first_name, p.last_name, p.date_of_birth
       FROM dojo_members m JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.dojo_id = :dojoId AND m.status = 'active' AND p.date_of_birth IS NOT NULL
        AND IF(DATE_FORMAT(:today, '%m-%d') <= DATE_FORMAT(:d7, '%m-%d'),
               DATE_FORMAT(p.date_of_birth, '%m-%d') BETWEEN DATE_FORMAT(:today, '%m-%d') AND DATE_FORMAT(:d7, '%m-%d'),
               -- la semana cruza el fin de año
               DATE_FORMAT(p.date_of_birth, '%m-%d') >= DATE_FORMAT(:today, '%m-%d') OR DATE_FORMAT(p.date_of_birth, '%m-%d') <= DATE_FORMAT(:d7, '%m-%d'))
      ORDER BY DATE_FORMAT(p.date_of_birth, '%m-%d') < DATE_FORMAT(:today, '%m-%d'), DATE_FORMAT(p.date_of_birth, '%m-%d') LIMIT 20`, p);

  res.json({ status: 'success', data: { pending_members: pending, overdue, expiring, at_risk: atRisk, birthdays } });
});

module.exports = router;
