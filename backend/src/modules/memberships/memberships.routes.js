/**
 * /api/v2/memberships — contratos de planes.
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest, conflict } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { actingUser } = require('../../utils/acting');
const { getDojo } = require('../../utils/dojo');
const { pageParams, pageMeta, likeEscape } = require('../../utils/sql');
const { todayIn, addDays, daysBetween } = require('../../utils/dates');
const { createCharge } = require('../billing/charges.service');
const svc = require('./memberships.service');

const router = express.Router();
router.use(authenticate, requireDojo);

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STAFF = ['admin', 'staff'];

async function loadMembership(tdb, msId) {
  const ms = await tdb.one(
    `SELECT ms.id, ms.plan_id, pl.name AS plan_name, pl.billing_type, pl.interval_unit, pl.interval_count, pl.max_members,
            ms.payer_user_id, CONCAT_WS(' ', pp.first_name, pp.last_name) AS payer_name,
            ms.status, ms.start_date, ms.end_date, ms.current_period_start, ms.current_period_end, ms.next_billing_date,
            ms.price, ms.currency, ms.discount_id, ms.discount_type, ms.discount_value, ms.discount_reason,
            ms.sessions_per_week, ms.sessions_remaining, ms.auto_renew, ms.cancel_at_period_end,
            ms.cancelled_at, ms.cancel_reason, ms.notes, ms.created_at,
            (SELECT COALESCE(SUM(c.total - c.amount_paid), 0) FROM charges c
              WHERE c.dojo_id = ms.dojo_id AND c.membership_id = ms.id AND c.status IN ('pending','partial')) AS balance_due
       FROM memberships ms
       JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
       JOIN user_profiles pp ON pp.user_id = ms.payer_user_id
      WHERE ms.dojo_id = :dojoId AND ms.id = :msId`, { msId });
  if (!ms) return null;
  ms.final_price = ms.price - svc.discountAmount(ms.price, ms.discount_type, ms.discount_value);
  ms.members = await tdb.query(
    `SELECT mm.user_id, p.first_name, p.last_name, p.photo_url FROM membership_members mm
       JOIN user_profiles p ON p.user_id = mm.user_id
      WHERE mm.dojo_id = :dojoId AND mm.membership_id = :msId ORDER BY p.first_name`, { msId });
  ms.pauses = await tdb.query(
    `SELECT id, start_date, end_date, reason FROM membership_pauses
      WHERE dojo_id = :dojoId AND membership_id = :msId ORDER BY start_date DESC`, { msId });
  ms.charges = await tdb.query(
    `SELECT id, type, description, period_start, period_end, total, amount_paid, status, due_date
       FROM charges WHERE dojo_id = :dojoId AND membership_id = :msId ORDER BY period_start DESC, id DESC LIMIT 24`, { msId });
  return ms;
}

// ---------------------------------------------------------------------------
// Listado (admin/staff)
// ---------------------------------------------------------------------------
router.get('/', requireRole(...STAFF), validate({
  query: z.object({
    status: z.enum(['pending', 'active', 'paused', 'past_due', 'cancelled', 'expired', 'current', 'all']).default('current'),
    plan_id: id.optional(),
    user_id: id.optional(),
    expiring_days: z.coerce.number().int().min(1).max(365).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    page_size: z.coerce.number().int().positive().optional(),
  }),
}), async (req, res) => {
  const q = req.valid.query;
  const pg = pageParams(q);
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const where = ['ms.dojo_id = :dojoId'];
  const params = { today };
  if (q.status === 'current') where.push("ms.status IN ('pending','active','paused','past_due')");
  else if (q.status !== 'all') { where.push('ms.status = :status'); params.status = q.status; }
  if (q.plan_id) { where.push('ms.plan_id = :plan'); params.plan = q.plan_id; }
  if (q.user_id) {
    where.push('(ms.payer_user_id = :u OR EXISTS (SELECT 1 FROM membership_members x WHERE x.dojo_id = ms.dojo_id AND x.membership_id = ms.id AND x.user_id = :u))');
    params.u = q.user_id;
  }
  if (q.expiring_days) {
    // Vencen pronto: no se renuevan solas y su periodo termina en N días
    where.push(`(ms.auto_renew = 0 OR ms.cancel_at_period_end = 1 OR pl.billing_type <> 'recurring')
                AND COALESCE(ms.end_date, ms.current_period_end) BETWEEN :today AND :limit`);
    params.limit = addDays(today, q.expiring_days);
  }
  if (q.q) {
    where.push(`EXISTS (SELECT 1 FROM membership_members x JOIN user_profiles xp ON xp.user_id = x.user_id
                 WHERE x.dojo_id = ms.dojo_id AND x.membership_id = ms.id
                   AND CONCAT_WS(' ', xp.first_name, xp.last_name) LIKE :q)`);
    params.q = likeEscape(q.q);
  }
  const from = `FROM memberships ms JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id WHERE ${where.join(' AND ')}`;
  const [{ total }] = await req.tdb.query(`SELECT COUNT(*) AS total ${from}`, params);
  const rows = await req.tdb.query(
    `SELECT ms.id, ms.plan_id, pl.name AS plan_name, pl.billing_type, ms.status, ms.start_date, ms.end_date,
            ms.current_period_end, ms.next_billing_date, ms.price, ms.currency, ms.discount_type, ms.discount_value,
            ms.sessions_remaining, ms.auto_renew, ms.cancel_at_period_end, ms.payer_user_id,
            (SELECT GROUP_CONCAT(CONCAT_WS(' ', xp.first_name, xp.last_name) ORDER BY xp.first_name SEPARATOR ', ')
               FROM membership_members x JOIN user_profiles xp ON xp.user_id = x.user_id
              WHERE x.dojo_id = ms.dojo_id AND x.membership_id = ms.id) AS members,
            (SELECT COALESCE(SUM(c.total - c.amount_paid), 0) FROM charges c
              WHERE c.dojo_id = ms.dojo_id AND c.membership_id = ms.id AND c.status IN ('pending','partial')) AS balance_due
       ${from}
      ORDER BY FIELD(ms.status,'past_due','active','paused','pending','expired','cancelled'), ms.current_period_end
      LIMIT :limit OFFSET :offset`, { ...params, limit: pg.limit, offset: pg.offset });
  res.json({ status: 'success', data: rows, meta: pageMeta(pg, total) });
});

// Membresías del alumno (o de su menor / del tutor que paga)
router.get('/mine', validate({ query: z.object({ user_id: id.optional() }) }), async (req, res) => {
  const uid = await actingUser(req, req.valid.query.user_id, { staffRoles: STAFF });
  const ids = await req.tdb.query(
    `SELECT DISTINCT ms.id FROM memberships ms
      LEFT JOIN membership_members mm ON mm.dojo_id = ms.dojo_id AND mm.membership_id = ms.id
      WHERE ms.dojo_id = :dojoId AND (ms.payer_user_id = :uid OR mm.user_id = :uid)
      ORDER BY ms.id DESC LIMIT 20`, { uid });
  const data = [];
  for (const r of ids) data.push(await loadMembership(req.tdb, r.id));
  data.sort((a, b) => ['active', 'past_due', 'paused', 'pending'].includes(a.status) ? -1 : 1);
  res.json({ status: 'success', data });
});

router.get('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const ms = await loadMembership(req.tdb, req.valid.params.id);
  if (!ms) throw notFound('Membresía no encontrada');
  const mine = ms.payer_user_id === req.auth.userId || ms.members.some((m) => m.user_id === req.auth.userId);
  if (!mine) {
    await actingUser(req, ms.members[0]?.user_id ?? ms.payer_user_id, { staffRoles: STAFF });
  }
  res.json({ status: 'success', data: ms });
});

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------
router.post('/', requireRole(...STAFF), validate({
  body: z.object({
    plan_id: id,
    member_ids: z.array(id).min(1).max(20),
    payer_user_id: id.optional(),               // default: el primer miembro
    start_date: date.optional(),                // default: hoy
    discount_id: id.nullish(),
    discount_type: z.enum(['none', 'percent', 'fixed']).optional(),
    discount_value: z.coerce.number().min(0).max(10000000).optional(),
    discount_reason: z.string().trim().max(150).optional(),
    price: z.coerce.number().min(0).max(10000000).optional(), // precio especial
    auto_renew: z.boolean().default(true),
    charge_first_period: z.boolean().default(true),
    charge_signup_fee: z.boolean().default(true),
    first_due_date: date.optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const start = b.start_date ?? today;
  const memberIds = [...new Set(b.member_ids)];
  const payer = b.payer_user_id ?? memberIds[0];

  const msId = await req.tdb.transaction(async (t) => {
    const plan = await t.one('SELECT * FROM plans WHERE dojo_id = :dojoId AND id = :id AND active = 1', { id: b.plan_id });
    if (!plan) throw badRequest('Plan no válido o inactivo');
    if (memberIds.length > plan.max_members) throw badRequest(`El plan "${plan.name}" admite máximo ${plan.max_members} persona(s)`);

    const people = await t.query(
      `SELECT user_id FROM dojo_members WHERE dojo_id = :dojoId AND status = 'active' AND user_id IN (:ids)`,
      { ids: [...new Set([...memberIds, payer])] });
    if (people.length !== new Set([...memberIds, payer]).size) throw badRequest('Todas las personas deben ser miembros activos del dojo');

    let dType = b.discount_type ?? 'none';
    let dValue = b.discount_value ?? null;
    let dReason = b.discount_reason ?? null;
    if (b.discount_id) {
      const d = await t.one('SELECT id, name, type, value FROM discounts WHERE dojo_id = :dojoId AND id = :id AND active = 1', { id: b.discount_id });
      if (!d) throw badRequest('Descuento no válido');
      dType = d.type; dValue = d.value; dReason = dReason ?? d.name;
    }
    if (dType === 'percent' && dValue > 100) throw badRequest('Un porcentaje no puede pasar de 100');

    const period = svc.initialPeriod(plan, start);
    const price = b.price ?? plan.price;
    const r = await t.query(
      `INSERT INTO memberships (dojo_id, plan_id, payer_user_id, status, start_date, end_date, current_period_start,
                                current_period_end, next_billing_date, price, currency, discount_id, discount_type,
                                discount_value, discount_reason, sessions_per_week, sessions_remaining, auto_renew, notes, created_by)
       VALUES (:dojoId, :plan, :payer, :status, :start, :end, :ps, :pe, :nb, :price, :cur, :did, :dtype, :dval, :dreason,
               :spw, :rem, :auto, :notes, :by)`,
      {
        plan: plan.id, payer, status: start > today ? 'pending' : 'active', start, end: period.end_date,
        ps: period.current_period_start, pe: period.current_period_end,
        nb: plan.billing_type === 'recurring' && b.auto_renew ? period.next_billing_date : null,
        price, cur: plan.currency, did: b.discount_id ?? null, dtype: dType, dval: dValue, dreason: dReason,
        spw: plan.sessions_per_week, rem: plan.total_sessions, auto: b.auto_renew && plan.billing_type === 'recurring' ? 1 : 0,
        notes: b.notes ?? null, by: req.auth.userId,
      });
    const newId = r.insertId;
    for (const u of memberIds) {
      await t.query('INSERT INTO membership_members (dojo_id, membership_id, user_id) VALUES (:dojoId, :m, :u)', { m: newId, u });
    }

    const ms = { id: newId, payer_user_id: payer, price, currency: plan.currency, discount_type: dType, discount_value: dValue, plan_name: plan.name };
    if (b.charge_first_period && price > 0) {
      await svc.chargePeriod(t, ms, {
        start, end: period.current_period_end ?? start, dueDate: b.first_due_date ?? start, lang: dojo.language, createdBy: req.auth.userId,
      });
    }
    if (b.charge_signup_fee && plan.signup_fee > 0) {
      await createCharge(t, {
        user_id: payer, membership_id: newId, type: 'signup_fee', description: `Inscripción · ${plan.name}`,
        period_start: start, amount: plan.signup_fee, currency: plan.currency, due_date: b.first_due_date ?? start, created_by: req.auth.userId,
      });
    }
    await auditReq(req, t.executor, { action: 'create', entity: 'membership', entityId: newId, after: { ...b, price } });
    return newId;
  });
  res.status(201).json({ status: 'success', data: await loadMembership(req.tdb, msId) });
});

// ---------------------------------------------------------------------------
// Cambios
// ---------------------------------------------------------------------------
router.patch('/:id', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object({
    price: z.coerce.number().min(0).max(10000000).optional(),
    discount_id: id.nullish(),
    discount_type: z.enum(['none', 'percent', 'fixed']).optional(),
    discount_value: z.coerce.number().min(0).max(10000000).nullish(),
    discount_reason: z.string().trim().max(150).nullish(),
    auto_renew: z.boolean().optional(),
    next_billing_date: date.optional(),
    notes: z.string().trim().max(2000).nullish(),
    payer_user_id: id.optional(),
  }).refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const msId = req.valid.params.id;
  const b = { ...req.valid.body };
  await req.tdb.transaction(async (t) => {
    const before = await t.one('SELECT * FROM memberships WHERE dojo_id = :dojoId AND id = :msId FOR UPDATE', { msId });
    if (!before) throw notFound('Membresía no encontrada');
    if (['cancelled', 'expired'].includes(before.status)) throw conflict('La membresía ya terminó', 'MEMBERSHIP_ENDED');
    if (b.discount_id) {
      const d = await t.one('SELECT name, type, value FROM discounts WHERE dojo_id = :dojoId AND id = :id AND active = 1', { id: b.discount_id });
      if (!d) throw badRequest('Descuento no válido');
      Object.assign(b, { discount_type: d.type, discount_value: d.value, discount_reason: b.discount_reason ?? d.name });
    } else if (b.discount_id === null && !b.discount_type) {
      Object.assign(b, { discount_type: 'none', discount_value: null });
    } else if (b.discount_id === undefined && b.discount_type) {
      b.discount_id = null; // descuento personalizado: ya no es uno del catálogo
    }
    if (b.payer_user_id) {
      const p = await t.one(`SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u AND status = 'active'`, { u: b.payer_user_id });
      if (!p) throw badRequest('El pagador debe ser miembro activo');
    }
    const { buildSet } = require('../../utils/sql');
    const set = buildSet(b, {
      price: 'price', discount_id: 'discount_id', discount_type: 'discount_type', discount_value: 'discount_value',
      discount_reason: 'discount_reason', auto_renew: 'auto_renew', next_billing_date: 'next_billing_date', notes: 'notes', payer_user_id: 'payer_user_id',
    });
    await t.query(`UPDATE memberships SET ${set.sql} WHERE dojo_id = :dojoId AND id = :msId`, { ...set.params, msId });
    await auditReq(req, t.executor, { action: 'update', entity: 'membership', entityId: msId, before, after: b });
  });
  res.json({ status: 'success', data: await loadMembership(req.tdb, msId) });
});

// Integrantes (plan familiar)
router.put('/:id/members', requireRole(...STAFF), validate({
  params: z.object({ id }), body: z.object({ member_ids: z.array(id).min(1).max(20) }),
}), async (req, res) => {
  const msId = req.valid.params.id;
  const ids = [...new Set(req.valid.body.member_ids)];
  await req.tdb.transaction(async (t) => {
    const ms = await t.one(
      `SELECT ms.id, pl.max_members FROM memberships ms JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
        WHERE ms.dojo_id = :dojoId AND ms.id = :msId FOR UPDATE`, { msId });
    if (!ms) throw notFound('Membresía no encontrada');
    if (ids.length > ms.max_members) throw badRequest(`Este plan admite máximo ${ms.max_members} persona(s)`);
    const ok = await t.query(`SELECT user_id FROM dojo_members WHERE dojo_id = :dojoId AND status = 'active' AND user_id IN (:ids)`, { ids });
    if (ok.length !== ids.length) throw badRequest('Todas las personas deben ser miembros activos');
    await t.query('DELETE FROM membership_members WHERE dojo_id = :dojoId AND membership_id = :msId', { msId });
    for (const u of ids) await t.query('INSERT INTO membership_members (dojo_id, membership_id, user_id) VALUES (:dojoId, :msId, :u)', { msId, u });
    await auditReq(req, t.executor, { action: 'set_members', entity: 'membership', entityId: msId, after: ids });
  });
  res.json({ status: 'success', data: await loadMembership(req.tdb, msId) });
});

/**
 * Congelar: extiende el periodo actual y la próxima facturación por los días de la pausa.
 */
router.post('/:id/pauses', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object({ start_date: date, end_date: date, reason: z.string().trim().max(255).optional() }),
}), async (req, res) => {
  const msId = req.valid.params.id;
  const b = req.valid.body;
  if (b.end_date < b.start_date) throw badRequest('La fecha final debe ser posterior a la inicial');
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const days = daysBetween(b.start_date, b.end_date) + 1;

  await req.tdb.transaction(async (t) => {
    const ms = await t.one('SELECT status, current_period_end, next_billing_date, end_date FROM memberships WHERE dojo_id = :dojoId AND id = :msId FOR UPDATE', { msId });
    if (!ms) throw notFound('Membresía no encontrada');
    if (!['active', 'past_due', 'paused', 'pending'].includes(ms.status)) throw conflict('Solo se pueden pausar membresías vigentes', 'MEMBERSHIP_ENDED');
    const overlap = await t.one(
      `SELECT 1 AS ok FROM membership_pauses WHERE dojo_id = :dojoId AND membership_id = :msId
        AND start_date <= :e AND end_date >= :s`, { msId, s: b.start_date, e: b.end_date });
    if (overlap) throw conflict('Ya hay una pausa en esas fechas', 'PAUSE_OVERLAP');

    await t.query(
      `INSERT INTO membership_pauses (dojo_id, membership_id, start_date, end_date, reason, created_by)
       VALUES (:dojoId, :msId, :s, :e, :reason, :by)`, { msId, s: b.start_date, e: b.end_date, reason: b.reason ?? null, by: req.auth.userId });
    await t.query(
      `UPDATE memberships SET
          current_period_end = IF(current_period_end IS NULL, NULL, DATE_ADD(current_period_end, INTERVAL :days DAY)),
          next_billing_date  = IF(next_billing_date IS NULL, NULL, DATE_ADD(next_billing_date, INTERVAL :days DAY)),
          end_date           = IF(end_date IS NULL, NULL, DATE_ADD(end_date, INTERVAL :days DAY)),
          status = IF(:today BETWEEN :s AND :e AND status IN ('active','past_due'), 'paused', status)
        WHERE dojo_id = :dojoId AND id = :msId`, { msId, days, today, s: b.start_date, e: b.end_date });
    await auditReq(req, t.executor, { action: 'pause', entity: 'membership', entityId: msId, after: { ...b, days } });
  });
  res.status(201).json({ status: 'success', data: await loadMembership(req.tdb, msId) });
});

/**
 * Terminar una pausa antes de tiempo (reanudar hoy) o quitar una pausa futura.
 * Devuelve los días que no se usaron: el periodo y la próxima facturación se recorren hacia atrás.
 */
router.post('/:id/pauses/:pauseId/end', requireRole(...STAFF), validate({
  params: z.object({ id, pauseId: id }),
}), async (req, res) => {
  const { id: msId, pauseId } = req.valid.params;
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);

  await req.tdb.transaction(async (t) => {
    const ms = await t.one('SELECT status FROM memberships WHERE dojo_id = :dojoId AND id = :msId FOR UPDATE', { msId });
    if (!ms) throw notFound('Membresía no encontrada');
    const p = await t.one(
      `SELECT id, DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS e
         FROM membership_pauses WHERE dojo_id = :dojoId AND membership_id = :msId AND id = :pauseId FOR UPDATE`, { msId, pauseId });
    if (!p) throw notFound('Pausa no encontrada');
    if (p.e < today) throw conflict('Esa pausa ya terminó', 'PAUSE_ENDED');

    let unused;
    if (p.s >= today) {
      // Empieza hoy o en el futuro: se quita completa
      unused = daysBetween(p.s, p.e) + 1;
      await t.query('DELETE FROM membership_pauses WHERE dojo_id = :dojoId AND id = :pauseId', { pauseId });
    } else {
      // En curso: termina ayer y hoy ya cuenta como activo
      const newEnd = addDays(today, -1);
      unused = daysBetween(newEnd, p.e);
      await t.query('UPDATE membership_pauses SET end_date = :newEnd WHERE dojo_id = :dojoId AND id = :pauseId', { pauseId, newEnd });
    }
    const stillPaused = await t.one(
      `SELECT 1 AS ok FROM membership_pauses WHERE dojo_id = :dojoId AND membership_id = :msId
        AND start_date <= :today AND end_date >= :today`, { msId, today });
    await t.query(
      `UPDATE memberships SET
          current_period_end = IF(current_period_end IS NULL, NULL, DATE_SUB(current_period_end, INTERVAL :days DAY)),
          next_billing_date  = IF(next_billing_date IS NULL, NULL, DATE_SUB(next_billing_date, INTERVAL :days DAY)),
          end_date           = IF(end_date IS NULL, NULL, DATE_SUB(end_date, INTERVAL :days DAY)),
          status = IF(status = 'paused' AND :still = 0, 'active', status)
        WHERE dojo_id = :dojoId AND id = :msId`, { msId, days: unused, still: stillPaused ? 1 : 0 });
    await auditReq(req, t.executor, { action: 'pause_end', entity: 'membership', entityId: msId,
      before: { start_date: p.s, end_date: p.e }, after: { unused_days: unused, removed: p.s >= today } });
  });
  // Si quedó con adeudos vencidos, la facturación lo marca como "pago atrasado"
  await svc.runBillingForDojo(req.auth.dojoId).catch(() => {});
  res.json({ status: 'success', data: await loadMembership(req.tdb, msId) });
});

/**
 * Cancelar. immediate=false → termina al fin del periodo pagado (no se renueva).
 * immediate=true → termina hoy y anula cargos futuros sin pagar.
 */
router.post('/:id/cancel', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object({ immediate: z.boolean().default(false), reason: z.string().trim().max(255).optional() }),
}), async (req, res) => {
  const msId = req.valid.params.id;
  const b = req.valid.body;
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  await req.tdb.transaction(async (t) => {
    const ms = await t.one('SELECT status FROM memberships WHERE dojo_id = :dojoId AND id = :msId FOR UPDATE', { msId });
    if (!ms) throw notFound('Membresía no encontrada');
    if (['cancelled', 'expired'].includes(ms.status)) throw conflict('La membresía ya terminó', 'MEMBERSHIP_ENDED');
    if (b.immediate) {
      await t.query(
        `UPDATE memberships SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = :r, auto_renew = 0,
                end_date = :today, next_billing_date = NULL
          WHERE dojo_id = :dojoId AND id = :msId`, { msId, r: b.reason ?? null, today });
      await t.query(
        `UPDATE charges SET status = 'void', voided_reason = 'Membresía cancelada'
          WHERE dojo_id = :dojoId AND membership_id = :msId AND status = 'pending' AND amount_paid = 0
            AND period_start > :today`, { msId, today });
    } else {
      await t.query(
        `UPDATE memberships SET cancel_at_period_end = 1, auto_renew = 0, cancel_reason = :r, next_billing_date = NULL
          WHERE dojo_id = :dojoId AND id = :msId`, { msId, r: b.reason ?? null });
    }
    await auditReq(req, t.executor, { action: b.immediate ? 'cancel_now' : 'cancel_at_period_end', entity: 'membership', entityId: msId, after: b });
  });
  res.json({ status: 'success', data: await loadMembership(req.tdb, msId) });
});

// Revertir una cancelación programada
router.post('/:id/resume', requireRole(...STAFF), validate({ params: z.object({ id }) }), async (req, res) => {
  const msId = req.valid.params.id;
  await req.tdb.transaction(async (t) => {
    const ms = await t.one(
      `SELECT ms.status, ms.cancel_at_period_end, ms.current_period_end, pl.billing_type
         FROM memberships ms JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
        WHERE ms.dojo_id = :dojoId AND ms.id = :msId FOR UPDATE`, { msId });
    if (!ms) throw notFound('Membresía no encontrada');
    if (!ms.cancel_at_period_end) throw conflict('La membresía no tiene una cancelación programada');
    await t.query(
      `UPDATE memberships SET cancel_at_period_end = 0, cancel_reason = NULL,
              auto_renew = IF(:rec, 1, auto_renew),
              next_billing_date = IF(:rec, DATE_ADD(current_period_end, INTERVAL 1 DAY), next_billing_date)
        WHERE dojo_id = :dojoId AND id = :msId`, { msId, rec: ms.billing_type === 'recurring' ? 1 : 0 });
  });
  res.json({ status: 'success', data: await loadMembership(req.tdb, msId) });
});

// Ejecutar la facturación del dojo a mano (también corre sola cada hora)
router.post('/billing/run', requireRole('admin'), async (req, res) => {
  res.json({ status: 'success', data: await svc.runBillingForDojo(req.auth.dojoId) });
});

module.exports = router;
