/**
 * Reglas de clases: generación de sesiones, reservas, lista de espera, cupo.
 */
const { tenantDb } = require('../../db/tenant');
const { pool } = require('../../db/pool');
const { AppError } = require('../../utils/errors');
const { todayIn, addDays, weekdayIndex, weekStart, WEEKDAYS, zonedToUtc } = require('../../utils/dates');

const HORIZON_WEEKS = 8;
const OCCUPYING = "('booked','attended','no_show')"; // ocupan lugar

const ruleError = (code, message) => new AppError(422, code, message);

/** Crea las sesiones de una serie entre from..to (inclusive). Idempotente. */
async function generateSessions(t, series, from, to) {
  const days = new Set(String(series.days_of_week).split(',').map((d) => WEEKDAYS.indexOf(d)));
  const start = series.starts_on > from ? series.starts_on : from;
  const end = series.ends_on && series.ends_on < to ? series.ends_on : to;
  let created = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!days.has(weekdayIndex(d))) continue;
    const r = await t.query(
      `INSERT IGNORE INTO class_sessions (dojo_id, series_id, discipline_id, location_id, instructor_id, title,
                                          session_date, start_time, end_time, capacity)
       VALUES (:dojoId, :sid, :disc, :loc, :inst, :title, :d, :st, :et, :cap)`,
      { sid: series.id, disc: series.discipline_id, loc: series.location_id, inst: series.instructor_id,
        title: series.title, d, st: series.start_time, et: series.end_time, cap: series.capacity });
    created += r.affectedRows;
  }
  return created;
}

/** Mantiene las sesiones generadas N semanas hacia adelante (job diario). */
async function extendAllSeries(dojoId, { now = new Date() } = {}) {
  const tdb = tenantDb(dojoId);
  const { timezone } = await tdb.one('SELECT timezone FROM dojos WHERE id = :dojoId');
  const today = todayIn(timezone, now);
  const to = addDays(today, HORIZON_WEEKS * 7);
  const series = await tdb.query('SELECT * FROM class_series WHERE dojo_id = :dojoId AND active = 1 AND (ends_on IS NULL OR ends_on >= :today)', { today });
  let created = 0;
  await tdb.transaction(async (t) => {
    for (const s of series) created += await generateSessions(t, s, today, to);
  });
  return created;
}

async function extendAllDojos(opts) {
  const [dojos] = await pool.query(`SELECT id FROM dojos WHERE status IN ('trial','active')`);
  let total = 0;
  for (const d of dojos) {
    try { total += await extendAllSeries(d.id, opts); } catch (e) { console.error(`[classes] dojo ${d.id}:`, e.message); }
  }
  return total;
}

async function recount(t, sessionId) {
  await t.query(
    `UPDATE class_sessions SET booked_count =
        (SELECT COUNT(*) FROM class_bookings b WHERE b.dojo_id = :dojoId AND b.session_id = :sessionId AND b.status IN ${OCCUPYING})
      WHERE dojo_id = :dojoId AND id = :sessionId`, { sessionId });
}

/**
 * Membresía vigente que cubre la clase para esa persona:
 * activa (o con adeudo), periodo que incluye la fecha, plan que incluye la disciplina,
 * y con clases disponibles (paquetes) / dentro del límite semanal.
 */
async function findCoveringMembership(t, userId, session) {
  const candidates = await t.query(
    `SELECT ms.id, ms.status, ms.sessions_per_week, ms.sessions_remaining, pl.billing_type, pl.all_disciplines,
            ms.current_period_start, ms.current_period_end, ms.end_date
       FROM membership_members mm
       JOIN memberships ms ON ms.dojo_id = mm.dojo_id AND ms.id = mm.membership_id
       JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
      WHERE mm.dojo_id = :dojoId AND mm.user_id = :userId
        AND ms.status IN ('active','past_due')
        AND ms.start_date <= :d
        AND (ms.end_date IS NULL OR ms.end_date >= :d)
        AND (pl.billing_type <> 'recurring' OR ms.auto_renew = 1 OR ms.current_period_end >= :d)
        AND (pl.all_disciplines = 1 OR :disc IS NULL OR EXISTS (
              SELECT 1 FROM plan_disciplines pd WHERE pd.dojo_id = ms.dojo_id AND pd.plan_id = ms.plan_id AND pd.discipline_id = :disc))
      ORDER BY (pl.billing_type = 'class_pack'), ms.id
      FOR UPDATE`,
    { userId, d: session.session_date, disc: session.discipline_id });

  if (candidates.length === 0) {
    return { error: ruleError('NO_MEMBERSHIP', 'No tienes una membresía vigente que incluya esta clase') };
  }
  const ws = weekStart(session.session_date);
  let lastError;
  for (const ms of candidates) {
    if (ms.billing_type === 'class_pack' && !(ms.sessions_remaining > 0)) {
      lastError = ruleError('NO_CREDITS', 'Tu paquete ya no tiene clases disponibles');
      continue;
    }
    if (ms.sessions_per_week) {
      const [{ n }] = await t.query(
        `SELECT COUNT(*) AS n FROM class_bookings b JOIN class_sessions s ON s.dojo_id = b.dojo_id AND s.id = b.session_id
          WHERE b.dojo_id = :dojoId AND b.membership_id = :ms AND b.user_id = :userId
            AND b.status IN ('booked','attended','no_show','late_cancel','waitlisted')
            AND s.session_date BETWEEN :ws AND :we AND s.id <> :sid`,
        { ms: ms.id, userId, ws, we: addDays(ws, 6), sid: session.id });
      if (n >= ms.sessions_per_week) {
        lastError = ruleError('WEEKLY_LIMIT', `Tu plan incluye ${ms.sessions_per_week} clase(s) por semana y ya las reservaste`);
        continue;
      }
    }
    return { membership: ms };
  }
  return { error: lastError };
}

/**
 * Reserva una clase. Devuelve { status: 'booked'|'waitlisted', booking_id }.
 * options.force (staff): omite ventana de reserva, membresía y cupo.
 */
async function book(t, { session, userId, bookedBy, dojo, force = false, now = new Date() }) {
  if (session.status !== 'scheduled') throw ruleError('CLASS_NOT_AVAILABLE', 'La clase no está disponible');
  const startsAt = zonedToUtc(session.session_date, session.start_time, dojo.timezone);
  const endsAt = zonedToUtc(session.session_date, session.end_time, dojo.timezone);
  if (!force) {
    if (endsAt <= now) throw ruleError('CLASS_ENDED', 'La clase ya terminó');
    const windowEnd = addDays(todayIn(dojo.timezone, now), dojo.booking_window_days);
    if (session.session_date > windowEnd) {
      throw ruleError('TOO_EARLY', `Puedes reservar con máximo ${dojo.booking_window_days} días de anticipación`);
    }
  }

  const existing = await t.one('SELECT id, status FROM class_bookings WHERE dojo_id = :dojoId AND session_id = :sid AND user_id = :u FOR UPDATE',
    { sid: session.id, u: userId });
  if (existing && ['booked', 'attended', 'waitlisted'].includes(existing.status)) {
    throw new AppError(409, 'ALREADY_BOOKED', existing.status === 'waitlisted' ? 'Ya estás en lista de espera' : 'Ya tienes lugar en esta clase');
  }

  let membershipId = null;
  if (dojo.require_membership_to_book || !force) {
    const found = await findCoveringMembership(t, userId, session);
    if (found.error && !force && dojo.require_membership_to_book) throw found.error;
    membershipId = found.membership?.id ?? null;
  }

  const full = session.capacity != null && session.booked_count >= session.capacity;
  if (full && force) {
    // staff puede sobrecupo
  }
  const status = full && !force ? 'waitlisted' : 'booked';
  let position = null;
  if (status === 'waitlisted') {
    const [{ p }] = await t.query(
      `SELECT COALESCE(MAX(waitlist_position), 0) + 1 AS p FROM class_bookings
        WHERE dojo_id = :dojoId AND session_id = :sid AND status = 'waitlisted'`, { sid: session.id });
    position = p;
  }

  let bookingId;
  if (existing) {
    await t.query(
      `UPDATE class_bookings SET status = :st, waitlist_position = :pos, membership_id = :ms, booked_by = :by,
              booked_at = NOW(), cancelled_at = NULL WHERE dojo_id = :dojoId AND id = :id`,
      { st: status, pos: position, ms: membershipId, by: bookedBy, id: existing.id });
    bookingId = existing.id;
  } else {
    const r = await t.query(
      `INSERT INTO class_bookings (dojo_id, session_id, user_id, membership_id, status, waitlist_position, booked_by)
       VALUES (:dojoId, :sid, :u, :ms, :st, :pos, :by)`,
      { sid: session.id, u: userId, ms: membershipId, st: status, pos: position, by: bookedBy });
    bookingId = r.insertId;
  }

  if (status === 'booked' && membershipId) await consumeCredit(t, membershipId, -1);
  await recount(t, session.id);
  return { booking_id: bookingId, status, waitlist_position: position, membership_id: membershipId };
}

/** Paquetes de clases: delta -1 consume, +1 devuelve */
async function consumeCredit(t, membershipId, delta) {
  await t.query(
    `UPDATE memberships SET sessions_remaining = GREATEST(0, sessions_remaining + :delta)
      WHERE dojo_id = :dojoId AND id = :ms AND sessions_remaining IS NOT NULL`, { ms: membershipId, delta });
}

/**
 * Cancela una reserva. Dentro del límite de horas = late_cancel (no devuelve
 * crédito). Si se libera un lugar, pasa al primero de la lista de espera.
 * Devuelve { status, promoted_user_id }.
 */
async function cancelBooking(t, { session, userId, dojo, byStaff = false, now = new Date() }) {
  const b = await t.one('SELECT id, status, membership_id FROM class_bookings WHERE dojo_id = :dojoId AND session_id = :sid AND user_id = :u FOR UPDATE',
    { sid: session.id, u: userId });
  if (!b || !['booked', 'waitlisted'].includes(b.status)) throw new AppError(404, 'NOT_FOUND', 'No tienes reserva en esta clase');

  const startsAt = zonedToUtc(session.session_date, session.start_time, dojo.timezone);
  if (startsAt <= now && !byStaff) throw ruleError('CLASS_STARTED', 'La clase ya empezó; ya no se puede cancelar');
  const late = !byStaff && b.status === 'booked' && (startsAt - now) < dojo.booking_cancel_hours * 3600 * 1000;
  const newStatus = late ? 'late_cancel' : 'cancelled';

  await t.query(
    `UPDATE class_bookings SET status = :st, cancelled_at = NOW(), waitlist_position = NULL WHERE dojo_id = :dojoId AND id = :id`,
    { st: newStatus, id: b.id });
  if (b.status === 'booked' && !late && b.membership_id) await consumeCredit(t, b.membership_id, +1);

  let promoted = null;
  if (b.status === 'booked') {
    const next = await t.one(
      `SELECT id, user_id, membership_id FROM class_bookings
        WHERE dojo_id = :dojoId AND session_id = :sid AND status = 'waitlisted'
        ORDER BY waitlist_position, booked_at LIMIT 1 FOR UPDATE`, { sid: session.id });
    if (next) {
      await t.query(`UPDATE class_bookings SET status = 'booked', waitlist_position = NULL WHERE dojo_id = :dojoId AND id = :id`, { id: next.id });
      if (next.membership_id) await consumeCredit(t, next.membership_id, -1);
      promoted = next.user_id;
    }
  }
  await recount(t, session.id);
  return { status: newStatus, promoted_user_id: promoted };
}

async function lockSession(t, sessionId) {
  return t.one('SELECT * FROM class_sessions WHERE dojo_id = :dojoId AND id = :sessionId FOR UPDATE', { sessionId });
}

module.exports = {
  generateSessions, extendAllSeries, extendAllDojos, recount, findCoveringMembership,
  book, cancelBooking, consumeCredit, lockSession, HORIZON_WEEKS, ruleError,
};
