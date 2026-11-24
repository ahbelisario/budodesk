/**
 * /api/v2/classes — horario (series recurrentes y sesiones), reservas y asistencia.
 */
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole, hasRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest, conflict } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { buildSet } = require('../../utils/sql');
const { actingUser } = require('../../utils/acting');
const { getDojo } = require('../../utils/dojo');
const { todayIn, addDays, zonedToUtc, weekStart } = require('../../utils/dates');
const svc = require('./classes.service');

const router = express.Router();
router.use(authenticate, requireDojo);

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD');
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Hora HH:MM');
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const STAFF = ['admin', 'staff', 'instructor'];
const MANAGE = ['admin', 'staff'];
const DAY = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

async function assertInstructor(t, instructorId) {
  if (!instructorId) return;
  const ok = await t.one(
    `SELECT 1 AS ok FROM dojo_member_roles WHERE dojo_id = :dojoId AND user_id = :u AND role IN ('instructor','admin','owner')`,
    { u: instructorId });
  if (!ok) throw badRequest('El instructor debe tener rol de instructor o admin');
}

// ===========================================================================
// Series recurrentes
// ===========================================================================
const seriesFields = {
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().max(5000).nullish(),
  discipline_id: id.nullish(),
  location_id: id.nullish(),
  instructor_id: id.nullish(),
  days_of_week: z.array(DAY).min(1).transform((a) => [...new Set(a)].join(',')),
  start_time: time,
  end_time: time,
  starts_on: date,
  ends_on: date.nullish(),
  capacity: z.coerce.number().int().min(1).max(1000).nullish(),
  min_age: z.coerce.number().int().min(0).max(120).nullish(),
  max_age: z.coerce.number().int().min(0).max(120).nullish(),
  color: hex.nullish(),
};
const SERIES_COLS = Object.fromEntries(Object.keys(seriesFields).map((k) => [k, k]));
// Campos que se propagan a las sesiones futuras no editadas a mano
const PROPAGATE = ['title', 'discipline_id', 'location_id', 'instructor_id', 'start_time', 'end_time', 'capacity'];

router.get('/series', validate({ query: z.object({ include_inactive: z.stringbool().optional() }) }), async (req, res) => {
  const rows = await req.tdb.query(
    `SELECT s.id, s.title, s.description, s.discipline_id, d.name AS discipline, s.location_id, l.name AS location,
            s.instructor_id, CONCAT_WS(' ', p.first_name, p.last_name) AS instructor_name,
            s.days_of_week, s.start_time, s.end_time, s.starts_on, s.ends_on, s.capacity, s.min_age, s.max_age, s.color, s.active
       FROM class_series s
       LEFT JOIN disciplines d ON d.dojo_id = s.dojo_id AND d.id = s.discipline_id
       LEFT JOIN dojo_locations l ON l.dojo_id = s.dojo_id AND l.id = s.location_id
       LEFT JOIN user_profiles p ON p.user_id = s.instructor_id
      WHERE s.dojo_id = :dojoId ${req.valid.query.include_inactive && hasRole(req, ...MANAGE) ? '' : 'AND s.active = 1'}
      ORDER BY FIELD(SUBSTRING_INDEX(s.days_of_week, ',', 1),'mon','tue','wed','thu','fri','sat','sun'), s.start_time`);
  res.json({ status: 'success', data: rows.map((r) => ({ ...r, days_of_week: r.days_of_week.split(',') })) });
});

router.post('/series', requireRole(...MANAGE), validate({ body: z.object(seriesFields) }), async (req, res) => {
  const b = req.valid.body;
  if (b.end_time <= b.start_time) throw badRequest('La hora de fin debe ser posterior a la de inicio');
  if (b.ends_on && b.ends_on < b.starts_on) throw badRequest('La fecha final debe ser posterior a la inicial');
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const out = await req.tdb.transaction(async (t) => {
    await assertInstructor(t, b.instructor_id);
    const cols = Object.keys(SERIES_COLS).filter((k) => b[k] !== undefined);
    const r = await t.query(
      `INSERT INTO class_series (dojo_id, ${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (:dojoId, ${cols.map((c) => `:${c}`).join(', ')})`,
      Object.fromEntries(cols.map((c) => [c, b[c]])));
    const series = await t.one('SELECT * FROM class_series WHERE dojo_id = :dojoId AND id = :id', { id: r.insertId });
    const from = b.starts_on > today ? b.starts_on : today;
    const created = await svc.generateSessions(t, series, from, addDays(today, svc.HORIZON_WEEKS * 7));
    await auditReq(req, t.executor, { action: 'create', entity: 'class_series', entityId: r.insertId, after: b });
    return { id: r.insertId, sessions_created: created };
  });
  res.status(201).json({ status: 'success', data: out });
});

router.patch('/series/:id', requireRole(...MANAGE), validate({
  params: z.object({ id }),
  body: z.object(Object.fromEntries(Object.entries(seriesFields).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const seriesId = req.valid.params.id;
  const b = req.valid.body;
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const out = await req.tdb.transaction(async (t) => {
    const before = await t.one('SELECT * FROM class_series WHERE dojo_id = :dojoId AND id = :seriesId FOR UPDATE', { seriesId });
    if (!before) throw notFound('Serie no encontrada');
    const merged = { ...before, ...b };
    if (merged.end_time <= merged.start_time) throw badRequest('La hora de fin debe ser posterior a la de inicio');
    await assertInstructor(t, b.instructor_id);

    const set = buildSet(b, SERIES_COLS);
    await t.query(`UPDATE class_series SET ${set.sql} WHERE dojo_id = :dojoId AND id = :seriesId`, { ...set.params, seriesId });

    // Propaga a sesiones futuras no modificadas a mano
    const prop = Object.fromEntries(PROPAGATE.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
    let updated = 0;
    if (Object.keys(prop).length) {
      const ps = buildSet(prop, Object.fromEntries(Object.keys(prop).map((k) => [k, k])));
      updated = (await t.query(
        `UPDATE class_sessions SET ${ps.sql}
          WHERE dojo_id = :dojoId AND series_id = :seriesId AND session_date >= :today AND is_modified = 0 AND status = 'scheduled'`,
        { ...ps.params, seriesId, today })).affectedRows;
    }

    // Cambió el calendario: quita sesiones futuras que ya no aplican (sin reservas) y genera las nuevas
    let removed = 0; let created = 0;
    if (b.days_of_week || b.starts_on || b.ends_on !== undefined) {
      const series = await t.one('SELECT * FROM class_series WHERE dojo_id = :dojoId AND id = :seriesId', { seriesId });
      const days = series.days_of_week.split(',');
      const future = await t.query(
        `SELECT s.id, s.session_date,
                (SELECT COUNT(*) FROM class_bookings b WHERE b.dojo_id = s.dojo_id AND b.session_id = s.id AND b.status IN ('booked','waitlisted')) AS bookings
           FROM class_sessions s WHERE s.dojo_id = :dojoId AND s.series_id = :seriesId AND s.session_date >= :today AND s.is_modified = 0`,
        { seriesId, today });
      const { WEEKDAYS, weekdayIndex } = require('../../utils/dates');
      for (const s of future) {
        const fits = days.includes(WEEKDAYS[weekdayIndex(s.session_date)])
          && s.session_date >= series.starts_on && (!series.ends_on || s.session_date <= series.ends_on);
        if (fits) continue;
        if (s.bookings > 0) {
          await t.query(`UPDATE class_sessions SET status = 'cancelled', cancel_reason = 'Cambio de horario' WHERE dojo_id = :dojoId AND id = :id`, { id: s.id });
          await t.query(`UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE dojo_id = :dojoId AND session_id = :id AND status IN ('booked','waitlisted')`, { id: s.id });
        } else {
          await t.query('DELETE FROM class_sessions WHERE dojo_id = :dojoId AND id = :id', { id: s.id });
        }
        removed++;
      }
      if (series.active) {
        const from = series.starts_on > today ? series.starts_on : today;
        created = await svc.generateSessions(t, series, from, addDays(today, svc.HORIZON_WEEKS * 7));
      }
    }
    await auditReq(req, t.executor, { action: 'update', entity: 'class_series', entityId: seriesId, before, after: b });
    return { sessions_updated: updated, sessions_removed: removed, sessions_created: created };
  });
  res.json({ status: 'success', data: out });
});

// Terminar una serie: no genera más y cancela las sesiones futuras
router.delete('/series/:id', requireRole(...MANAGE), validate({ params: z.object({ id }) }), async (req, res) => {
  const seriesId = req.valid.params.id;
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const out = await req.tdb.transaction(async (t) => {
    const r = await t.query('UPDATE class_series SET active = 0, ends_on = LEAST(COALESCE(ends_on, :y), :y) WHERE dojo_id = :dojoId AND id = :seriesId',
      { seriesId, y: addDays(today, -1) });
    if (r.affectedRows === 0) throw notFound('Serie no encontrada');
    const cancelled = (await t.query(
      `UPDATE class_sessions SET status = 'cancelled', cancel_reason = 'Horario eliminado'
        WHERE dojo_id = :dojoId AND series_id = :seriesId AND session_date >= :today AND status = 'scheduled'`, { seriesId, today })).affectedRows;
    await t.query(
      `UPDATE class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
          SET b.status = 'cancelled', b.cancelled_at = NOW()
        WHERE b.dojo_id = :dojoId AND s.series_id = :seriesId AND s.session_date >= :today AND b.status IN ('booked','waitlisted')`,
      { seriesId, today });
    await auditReq(req, t.executor, { action: 'end', entity: 'class_series', entityId: seriesId });
    return { sessions_cancelled: cancelled };
  });
  res.json({ status: 'success', data: out });
});

// ===========================================================================
// Sesiones (calendario)
// ===========================================================================
const SESSION_SELECT = `
  SELECT s.id, s.series_id, s.title, s.discipline_id, d.name AS discipline, COALESCE(cs.color, d.color) AS color,
         s.location_id, l.name AS location, s.instructor_id, CONCAT_WS(' ', ip.first_name, ip.last_name) AS instructor_name,
         s.session_date, s.start_time, s.end_time, s.capacity, s.booked_count, s.status, s.cancel_reason, s.notes, s.is_modified,
         cs.min_age, cs.max_age, cs.description,
         (SELECT COUNT(*) FROM class_bookings w WHERE w.dojo_id = s.dojo_id AND w.session_id = s.id AND w.status = 'waitlisted') AS waitlist_count
    FROM class_sessions s
    LEFT JOIN class_series cs ON cs.dojo_id = s.dojo_id AND cs.id = s.series_id
    LEFT JOIN disciplines d ON d.dojo_id = s.dojo_id AND d.id = s.discipline_id
    LEFT JOIN dojo_locations l ON l.dojo_id = s.dojo_id AND l.id = s.location_id
    LEFT JOIN user_profiles ip ON ip.user_id = s.instructor_id`;

/**
 * GET /classes/sessions?from&to[&discipline_id&instructor_id&user_id]
 * Incluye my_booking (estado de la reserva de la persona: yo o mi menor).
 */
router.get('/sessions', validate({
  query: z.object({
    from: date.optional(), to: date.optional(),
    discipline_id: id.optional(), instructor_id: id.optional(), user_id: id.optional(),
    include_cancelled: z.stringbool().optional(),
    only_fit: z.stringbool().optional(), // solo las clases que le corresponden (edad/disciplina)
  }),
}), async (req, res) => {
  const q = req.valid.query;
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const from = q.from ?? weekStart(today);
  const to = q.to ?? addDays(from, 6);
  if (to < from) throw badRequest('Rango inválido');
  if ((new Date(to) - new Date(from)) / 86400000 > 93) throw badRequest('El rango máximo es de 3 meses');
  const uid = await actingUser(req, q.user_id, { staffRoles: STAFF });

  const rows = await req.tdb.query(
    `${SESSION_SELECT.replace('FROM class_sessions s', `,
         (SELECT b.status FROM class_bookings b WHERE b.dojo_id = s.dojo_id AND b.session_id = s.id AND b.user_id = :uid) AS my_booking,
         (SELECT b.waitlist_position FROM class_bookings b WHERE b.dojo_id = s.dojo_id AND b.session_id = s.id AND b.user_id = :uid) AS my_waitlist_position
     FROM class_sessions s`)}
      WHERE s.dojo_id = :dojoId AND s.session_date BETWEEN :from AND :to
        ${q.include_cancelled ? '' : "AND s.status <> 'cancelled'"}
        ${q.discipline_id ? 'AND s.discipline_id = :disc' : ''} ${q.instructor_id ? 'AND s.instructor_id = :inst' : ''}
      ORDER BY s.session_date, s.start_time`,
    { from, to, disc: q.discipline_id, inst: q.instructor_id, uid });

  const fit = await svc.fitProfile(req.tdb, uid, today);
  const now = new Date();
  res.json({
    status: 'success',
    data: rows.map((s) => ({ s, why: svc.misfit(fit, s) })).filter((x) => !q.only_fit || !x.why).map(({ s, why }) => {
      const startsAt = zonedToUtc(s.session_date, s.start_time, dojo.timezone);
      const endsAt = zonedToUtc(s.session_date, s.end_time, dojo.timezone);
      return {
        ...s,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        spots_left: s.capacity == null ? null : Math.max(0, s.capacity - s.booked_count),
        is_past: endsAt <= now,
        can_cancel_free: startsAt - now > dojo.booking_cancel_hours * 3600000,
        fits: !why, misfit_reason: why,
      };
    }),
    meta: { from, to, timezone: dojo.timezone, cancel_hours: dojo.booking_cancel_hours, booking_window_days: dojo.booking_window_days },
  });
});

router.get('/sessions/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const s = await req.tdb.one(`${SESSION_SELECT} WHERE s.dojo_id = :dojoId AND s.id = :id`, { id: req.valid.params.id });
  if (!s) throw notFound('Clase no encontrada');
  if (hasRole(req, ...STAFF)) {
    const dojo = await getDojo(req);
    s.checkin_code = (await req.tdb.one('SELECT checkin_code FROM class_sessions WHERE dojo_id = :dojoId AND id = :id', { id: s.id })).checkin_code;
    s.roster = await req.tdb.query(
      `SELECT b.id AS booking_id, b.user_id, p.first_name, p.last_name, p.photo_url, b.status, b.waitlist_position,
              b.checked_in_at, b.checkin_method, b.membership_id,
              TIMESTAMPDIFF(YEAR, p.date_of_birth, :today) AS age, p.medical_notes IS NOT NULL AND p.medical_notes <> '' AS has_medical_notes,
              (SELECT r.name FROM member_ranks mr JOIN ranks r ON r.dojo_id = mr.dojo_id AND r.id = mr.rank_id
                WHERE mr.dojo_id = b.dojo_id AND mr.user_id = b.user_id AND mr.discipline_id = :disc) AS rank_name,
              (SELECT r.color FROM member_ranks mr JOIN ranks r ON r.dojo_id = mr.dojo_id AND r.id = mr.rank_id
                WHERE mr.dojo_id = b.dojo_id AND mr.user_id = b.user_id AND mr.discipline_id = :disc) AS rank_color
         FROM class_bookings b JOIN user_profiles p ON p.user_id = b.user_id
        WHERE b.dojo_id = :dojoId AND b.session_id = :id AND b.status <> 'cancelled'
        ORDER BY FIELD(b.status,'attended','booked','no_show','late_cancel','waitlisted'), b.waitlist_position, p.first_name`,
      { id: s.id, disc: s.discipline_id, today: todayIn(dojo.timezone) });
  }
  res.json({ status: 'success', data: s });
});

// Clase única (fuera de una serie)
router.post('/sessions', requireRole(...MANAGE), validate({
  body: z.object({
    title: z.string().trim().min(1).max(150),
    discipline_id: id.nullish(), location_id: id.nullish(), instructor_id: id.nullish(),
    session_date: date, start_time: time, end_time: time,
    capacity: z.coerce.number().int().min(1).max(1000).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  if (b.end_time <= b.start_time) throw badRequest('La hora de fin debe ser posterior a la de inicio');
  const r = await req.tdb.transaction(async (t) => {
    await assertInstructor(t, b.instructor_id);
    const ins = await t.query(
      `INSERT INTO class_sessions (dojo_id, title, discipline_id, location_id, instructor_id, session_date, start_time, end_time, capacity, notes, is_modified)
       VALUES (:dojoId, :title, :disc, :loc, :inst, :d, :st, :et, :cap, :notes, 1)`,
      { title: b.title, disc: b.discipline_id ?? null, loc: b.location_id ?? null, inst: b.instructor_id ?? null,
        d: b.session_date, st: b.start_time, et: b.end_time, cap: b.capacity ?? null, notes: b.notes ?? null });
    await auditReq(req, t.executor, { action: 'create', entity: 'class_session', entityId: ins.insertId, after: b });
    return ins.insertId;
  });
  res.status(201).json({ status: 'success', data: await req.tdb.one(`${SESSION_SELECT} WHERE s.dojo_id = :dojoId AND s.id = :id`, { id: r }) });
});

// Editar una sesión concreta (queda marcada: la serie ya no la sobrescribe)
router.patch('/sessions/:id', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object({
    title: z.string().trim().min(1).max(150).optional(),
    discipline_id: id.nullish(), location_id: id.nullish(), instructor_id: id.nullish(),
    session_date: date.optional(), start_time: time.optional(), end_time: time.optional(),
    capacity: z.coerce.number().int().min(1).max(1000).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  }).refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const sessionId = req.valid.params.id;
  const b = req.valid.body;
  // Instructor solo puede editar notas de sus clases
  if (!hasRole(req, ...MANAGE) && Object.keys(b).some((k) => k !== 'notes')) throw badRequest('Un instructor solo puede editar las notas de la clase');
  await req.tdb.transaction(async (t) => {
    const s = await svc.lockSession(t, sessionId);
    if (!s) throw notFound('Clase no encontrada');
    if (!hasRole(req, ...MANAGE) && s.instructor_id !== req.auth.userId) throw badRequest('Solo puedes editar tus clases');
    const merged = { ...s, ...b };
    if (merged.end_time <= merged.start_time) throw badRequest('La hora de fin debe ser posterior a la de inicio');
    await assertInstructor(t, b.instructor_id);
    const set = buildSet(b, Object.fromEntries(Object.keys(b).map((k) => [k, k])));
    await t.query(`UPDATE class_sessions SET ${set.sql}, is_modified = 1 WHERE dojo_id = :dojoId AND id = :sessionId`, { ...set.params, sessionId });
    await auditReq(req, t.executor, { action: 'update', entity: 'class_session', entityId: sessionId, after: b });
  });
  res.json({ status: 'success', data: await req.tdb.one(`${SESSION_SELECT} WHERE s.dojo_id = :dojoId AND s.id = :id`, { id: sessionId }) });
});

router.post('/sessions/:id/cancel', requireRole(...MANAGE), validate({
  params: z.object({ id }), body: z.object({ reason: z.string().trim().max(255).optional() }),
}), async (req, res) => {
  const sessionId = req.valid.params.id;
  const affected = await req.tdb.transaction(async (t) => {
    const s = await svc.lockSession(t, sessionId);
    if (!s) throw notFound('Clase no encontrada');
    if (s.status === 'cancelled') throw conflict('La clase ya está cancelada');
    await t.query(`UPDATE class_sessions SET status = 'cancelled', cancel_reason = :r, is_modified = 1 WHERE dojo_id = :dojoId AND id = :sessionId`,
      { sessionId, r: req.valid.body.reason ?? null });
    const booked = await t.query(
      `SELECT user_id, membership_id, status FROM class_bookings WHERE dojo_id = :dojoId AND session_id = :sessionId AND status IN ('booked','waitlisted')`, { sessionId });
    for (const b of booked) if (b.status === 'booked' && b.membership_id) await svc.consumeCredit(t, b.membership_id, +1);
    await t.query(`UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE dojo_id = :dojoId AND session_id = :sessionId AND status IN ('booked','waitlisted')`, { sessionId });
    await svc.recount(t, sessionId);
    await auditReq(req, t.executor, { action: 'cancel', entity: 'class_session', entityId: sessionId, after: req.valid.body });
    return booked.map((b) => b.user_id);
  });
  // Las notificaciones a los afectados se envían desde el módulo de avisos
  req.app.emit('class_cancelled', { dojoId: req.auth.dojoId, sessionId, userIds: affected });
  res.json({ status: 'success', data: { notified_users: affected.length } });
});

router.post('/sessions/:id/restore', requireRole(...MANAGE), validate({ params: z.object({ id }) }), async (req, res) => {
  const r = await req.tdb.query(
    `UPDATE class_sessions SET status = 'scheduled', cancel_reason = NULL WHERE dojo_id = :dojoId AND id = :id AND status = 'cancelled'`,
    { id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Clase cancelada no encontrada');
  res.json({ status: 'success' });
});

// ===========================================================================
// Reservas
// ===========================================================================
router.post('/sessions/:id/book', validate({
  params: z.object({ id }),
  body: z.object({ user_id: id.optional(), force: z.boolean().default(false) }),
}), async (req, res) => {
  const sessionId = req.valid.params.id;
  const uid = await actingUser(req, req.valid.body.user_id, { staffRoles: STAFF, need: 'book' });
  const force = req.valid.body.force && hasRole(req, ...STAFF);
  const dojo = await getDojo(req);
  const result = await req.tdb.transaction(async (t) => {
    const s = await svc.lockSession(t, sessionId);
    if (!s) throw notFound('Clase no encontrada');
    const member = await t.one(`SELECT status FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u`, { u: uid });
    if (member?.status !== 'active') throw svc.ruleError('MEMBER_INACTIVE', 'La cuenta no está activa en este dojo');
    return svc.book(t, { session: s, userId: uid, bookedBy: req.auth.userId, dojo, force });
  });
  res.status(201).json({ status: 'success', data: result });
});

router.delete('/sessions/:id/book', validate({
  params: z.object({ id }), query: z.object({ user_id: id.optional() }),
}), async (req, res) => {
  const sessionId = req.valid.params.id;
  const uid = await actingUser(req, req.valid.query.user_id, { staffRoles: STAFF, need: 'book' });
  const dojo = await getDojo(req);
  const result = await req.tdb.transaction(async (t) => {
    const s = await svc.lockSession(t, sessionId);
    if (!s) throw notFound('Clase no encontrada');
    return svc.cancelBooking(t, { session: s, userId: uid, dojo, byStaff: uid !== req.auth.userId && hasRole(req, ...STAFF) });
  });
  if (result.promoted_user_id) req.app.emit('waitlist_promoted', { dojoId: req.auth.dojoId, sessionId, userId: result.promoted_user_id });
  res.json({ status: 'success', data: result });
});

// Mis próximas clases (o las de mi menor)
router.get('/bookings/mine', validate({
  query: z.object({ user_id: id.optional(), scope: z.enum(['upcoming', 'past']).default('upcoming'), limit: z.coerce.number().int().min(1).max(100).default(20) }),
}), async (req, res) => {
  const q = req.valid.query;
  const uid = await actingUser(req, q.user_id, { staffRoles: STAFF });
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const upcoming = q.scope === 'upcoming';
  const rows = await req.tdb.query(
    `SELECT b.id AS booking_id, b.status, b.waitlist_position, b.checked_in_at,
            s.id AS session_id, s.title, s.session_date, s.start_time, s.end_time, s.status AS session_status,
            d.name AS discipline, COALESCE(cs.color, d.color) AS color, l.name AS location,
            CONCAT_WS(' ', ip.first_name, ip.last_name) AS instructor_name
       FROM class_bookings b
       JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
       LEFT JOIN class_series cs ON cs.dojo_id = s.dojo_id AND cs.id = s.series_id
       LEFT JOIN disciplines d ON d.dojo_id = s.dojo_id AND d.id = s.discipline_id
       LEFT JOIN dojo_locations l ON l.dojo_id = s.dojo_id AND l.id = s.location_id
       LEFT JOIN user_profiles ip ON ip.user_id = s.instructor_id
      WHERE b.dojo_id = :dojoId AND b.user_id = :uid
        AND ${upcoming ? "s.session_date >= :today AND b.status IN ('booked','waitlisted')" : "s.session_date <= :today AND b.status IN ('attended','no_show','late_cancel')"}
      ORDER BY s.session_date ${upcoming ? 'ASC' : 'DESC'}, s.start_time ${upcoming ? 'ASC' : 'DESC'}
      LIMIT :limit`, { uid, today, limit: q.limit });
  res.json({ status: 'success', data: rows });
});

// ===========================================================================
// Asistencia
// ===========================================================================

/**
 * PUT /classes/sessions/:id/attendance
 * { entries: [{ user_id, status: 'attended'|'no_show'|'booked' }], complete?: true }
 * Personas sin reserva se agregan como walk-in. complete=true marca a los que
 * no se registraron como no_show y cierra la clase.
 */
router.put('/sessions/:id/attendance', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object({
    entries: z.array(z.object({ user_id: id, status: z.enum(['attended', 'no_show', 'booked']) })).max(500).default([]),
    complete: z.boolean().default(false),
  }),
}), async (req, res) => {
  const sessionId = req.valid.params.id;
  const b = req.valid.body;
  const out = await req.tdb.transaction(async (t) => {
    const s = await svc.lockSession(t, sessionId);
    if (!s) throw notFound('Clase no encontrada');
    if (s.status === 'cancelled') throw conflict('La clase está cancelada');
    let walkIns = 0;
    for (const e of b.entries) {
      const member = await t.one('SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u', { u: e.user_id });
      if (!member) throw badRequest(`La persona ${e.user_id} no es miembro del dojo`);
      const existing = await t.one('SELECT id, status, membership_id FROM class_bookings WHERE dojo_id = :dojoId AND session_id = :sessionId AND user_id = :u FOR UPDATE',
        { sessionId, u: e.user_id });
      const checkin = e.status === 'attended';
      if (existing) {
        await t.query(
          `UPDATE class_bookings SET status = :st, waitlist_position = NULL,
                  checked_in_at = IF(:ci, COALESCE(checked_in_at, NOW()), NULL), checked_in_by = IF(:ci, :by, NULL),
                  checkin_method = IF(:ci, COALESCE(checkin_method, 'manual'), NULL)
            WHERE dojo_id = :dojoId AND id = :id`, { st: e.status, ci: checkin ? 1 : 0, by: req.auth.userId, id: existing.id });
        // De lista de espera/cancelada a ocupando lugar: consume crédito
        if (!['booked', 'attended', 'no_show'].includes(existing.status) && existing.membership_id) await svc.consumeCredit(t, existing.membership_id, -1);
      } else {
        const found = await svc.findCoveringMembership(t, e.user_id, s);
        const msId = found.membership?.id ?? null;
        await t.query(
          `INSERT INTO class_bookings (dojo_id, session_id, user_id, membership_id, status, booked_by, checked_in_at, checked_in_by, checkin_method)
           VALUES (:dojoId, :sessionId, :u, :ms, :st, :by, IF(:ci, NOW(), NULL), IF(:ci, :by, NULL), IF(:ci, 'manual', NULL))`,
          { sessionId, u: e.user_id, ms: msId, st: e.status, by: req.auth.userId, ci: checkin ? 1 : 0 });
        if (msId) await svc.consumeCredit(t, msId, -1);
        walkIns++;
      }
    }
    let noShows = 0;
    if (b.complete) {
      noShows = (await t.query(
        `UPDATE class_bookings SET status = 'no_show' WHERE dojo_id = :dojoId AND session_id = :sessionId AND status = 'booked'`, { sessionId })).affectedRows;
      await t.query(`UPDATE class_bookings SET status = 'cancelled', waitlist_position = NULL WHERE dojo_id = :dojoId AND session_id = :sessionId AND status = 'waitlisted'`, { sessionId });
      await t.query(`UPDATE class_sessions SET status = 'completed' WHERE dojo_id = :dojoId AND id = :sessionId`, { sessionId });
    }
    await svc.recount(t, sessionId);
    await auditReq(req, t.executor, { action: 'attendance', entity: 'class_session', entityId: sessionId, after: { entries: b.entries.length, complete: b.complete } });
    return { updated: b.entries.length, walk_ins: walkIns, marked_no_show: noShows };
  });
  res.json({ status: 'success', data: out });
});

// Código del día para auto check-in (se muestra en una tablet/QR en el dojo)
router.post('/sessions/:id/checkin-code', requireRole(...STAFF), validate({ params: z.object({ id }) }), async (req, res) => {
  const code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  const r = await req.tdb.query('UPDATE class_sessions SET checkin_code = :code WHERE dojo_id = :dojoId AND id = :id', { code, id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Clase no encontrada');
  res.json({ status: 'success', data: { code } });
});

// El alumno registra su llegada con el código (30 min antes y hasta el final)
router.post('/sessions/:id/checkin', validate({
  params: z.object({ id }), body: z.object({ code: z.string().trim().toUpperCase().length(6), user_id: id.optional() }),
}), async (req, res) => {
  const sessionId = req.valid.params.id;
  const uid = await actingUser(req, req.valid.body.user_id, { staffRoles: STAFF, need: 'book' });
  const dojo = await getDojo(req);
  const out = await req.tdb.transaction(async (t) => {
    const s = await svc.lockSession(t, sessionId);
    if (!s || s.status !== 'scheduled') throw notFound('Clase no encontrada');
    if (!s.checkin_code || s.checkin_code !== req.valid.body.code) throw svc.ruleError('BAD_CODE', 'Código incorrecto');
    const now = new Date();
    const opens = new Date(zonedToUtc(s.session_date, s.start_time, dojo.timezone) - 30 * 60000);
    const closes = zonedToUtc(s.session_date, s.end_time, dojo.timezone);
    if (now < opens || now > closes) throw svc.ruleError('CHECKIN_CLOSED', 'El registro de llegada abre 30 minutos antes de la clase');
    let b = await t.one('SELECT id, status FROM class_bookings WHERE dojo_id = :dojoId AND session_id = :sessionId AND user_id = :u FOR UPDATE', { sessionId, u: uid });
    if (!b || !['booked', 'attended'].includes(b.status)) {
      // Sin reserva: se intenta reservar con las reglas normales
      await svc.book(t, { session: s, userId: uid, bookedBy: req.auth.userId, dojo, now: opens });
      b = await t.one('SELECT id, status FROM class_bookings WHERE dojo_id = :dojoId AND session_id = :sessionId AND user_id = :u', { sessionId, u: uid });
      if (b.status !== 'booked') throw svc.ruleError('CLASS_FULL', 'La clase está llena');
    }
    await t.query(
      `UPDATE class_bookings SET status = 'attended', checked_in_at = COALESCE(checked_in_at, NOW()), checkin_method = COALESCE(checkin_method, 'qr')
        WHERE dojo_id = :dojoId AND id = :id`, { id: b.id });
    await svc.recount(t, sessionId);
    return { status: 'attended' };
  });
  res.json({ status: 'success', data: out });
});

// Estadísticas de asistencia de una persona
router.get('/attendance/stats', validate({ query: z.object({ user_id: id.optional() }) }), async (req, res) => {
  const uid = await actingUser(req, req.valid.query.user_id, { staffRoles: STAFF });
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const [totals] = await req.tdb.query(
    `SELECT SUM(b.status = 'attended') AS attended_total,
            SUM(b.status = 'attended' AND s.session_date >= :d30) AS attended_30d,
            SUM(b.status = 'attended' AND s.session_date >= :d90) AS attended_90d,
            SUM(b.status = 'no_show') AS no_show_total,
            SUM(b.status = 'late_cancel') AS late_cancel_total,
            MAX(CASE WHEN b.status = 'attended' THEN s.session_date END) AS last_attended
       FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
      WHERE b.dojo_id = :dojoId AND b.user_id = :uid AND s.session_date <= :today`,
    { uid, today, d30: addDays(today, -30), d90: addDays(today, -90) });
  const weeks = await req.tdb.query(
    `SELECT DISTINCT DATE_SUB(s.session_date, INTERVAL WEEKDAY(s.session_date) DAY) AS wk
       FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
      WHERE b.dojo_id = :dojoId AND b.user_id = :uid AND b.status = 'attended' AND s.session_date <= :today
      ORDER BY wk DESC LIMIT 104`, { uid, today });
  // Racha: semanas consecutivas con al menos una asistencia (la semana actual cuenta si ya asistió)
  let streak = 0;
  let expected = weekStart(today);
  const set = new Set(weeks.map((w) => (typeof w.wk === 'string' ? w.wk : w.wk.toISOString().slice(0, 10))));
  if (!set.has(expected)) expected = addDays(expected, -7);
  while (set.has(expected)) { streak++; expected = addDays(expected, -7); }

  const byDiscipline = await req.tdb.query(
    `SELECT d.id AS discipline_id, d.name AS discipline, COUNT(*) AS attended
       FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
       JOIN disciplines d ON d.dojo_id = s.dojo_id AND d.id = s.discipline_id
      WHERE b.dojo_id = :dojoId AND b.user_id = :uid AND b.status = 'attended'
      GROUP BY d.id ORDER BY attended DESC`, { uid });
  const n = (x) => Number(x ?? 0);
  const att = n(totals.attended_total); const ns = n(totals.no_show_total);
  res.json({
    status: 'success',
    data: {
      attended_total: att, attended_30d: n(totals.attended_30d), attended_90d: n(totals.attended_90d),
      no_show_total: ns, late_cancel_total: n(totals.late_cancel_total),
      attendance_rate: att + ns > 0 ? Math.round((att / (att + ns)) * 100) : null,
      last_attended: totals.last_attended, streak_weeks: streak, by_discipline: byDiscipline,
    },
  });
});

module.exports = router;
