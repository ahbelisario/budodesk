/**
 * /api/v2/charges   — lo que se debe
 * /api/v2/payments  — lo que se pagó
 *
 * Los pagos manuales (efectivo/transferencia) los registra admin/staff.
 * PayPal se integrará sobre estas mismas tablas (payments.provider = 'paypal').
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
const { todayIn } = require('../../utils/dates');
const svc = require('./charges.service');

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.coerce.number().positive().max(10000000);
const STAFF = ['admin', 'staff'];

// ===========================================================================
// Cargos
// ===========================================================================
const charges = express.Router();
charges.use(authenticate, requireDojo);

const CHARGE_SELECT = `
  SELECT c.id, c.user_id, CONCAT_WS(' ', p.first_name, p.last_name) AS user_name, c.membership_id, c.type,
         c.description, c.period_start, c.period_end, c.amount, c.discount_amount, c.total, c.amount_paid,
         (c.total - c.amount_paid) AS balance, c.currency, c.due_date, c.status, c.voided_reason, c.created_at,
         (SELECT GROUP_CONCAT(xp.first_name ORDER BY xp.first_name SEPARATOR ', ')
            FROM membership_members x JOIN user_profiles xp ON xp.user_id = x.user_id
           WHERE x.dojo_id = c.dojo_id AND x.membership_id = c.membership_id) AS member_names
    FROM charges c JOIN user_profiles p ON p.user_id = c.user_id`;

charges.get('/', requireRole(...STAFF), validate({
  query: z.object({
    status: z.enum(['open', 'overdue', 'pending', 'partial', 'paid', 'void', 'refunded', 'all']).default('open'),
    user_id: id.optional(),
    type: z.enum(['membership', 'signup_fee', 'exam_fee', 'late_fee', 'event', 'product', 'adjustment', 'other']).optional(),
    from: date.optional(), to: date.optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    page_size: z.coerce.number().int().positive().optional(),
  }),
}), async (req, res) => {
  const q = req.valid.query;
  const pg = pageParams(q);
  const dojo = await getDojo(req);
  const where = ['c.dojo_id = :dojoId'];
  const params = { today: todayIn(dojo.timezone) };
  if (q.status === 'open') where.push("c.status IN ('pending','partial')");
  else if (q.status === 'overdue') where.push("c.status IN ('pending','partial') AND c.due_date < :today");
  else if (q.status !== 'all') { where.push('c.status = :status'); params.status = q.status; }
  if (q.user_id) { where.push('c.user_id = :u'); params.u = q.user_id; }
  if (q.type) { where.push('c.type = :type'); params.type = q.type; }
  if (q.from) { where.push('c.due_date >= :from'); params.from = q.from; }
  if (q.to) { where.push('c.due_date <= :to'); params.to = q.to; }
  if (q.q) { where.push("(CONCAT_WS(' ', p.first_name, p.last_name) LIKE :q OR c.description LIKE :q)"); params.q = likeEscape(q.q); }

  const w = `WHERE ${where.join(' AND ')}`;
  const [agg] = await req.tdb.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(c.total - c.amount_paid), 0) AS balance
       FROM charges c JOIN user_profiles p ON p.user_id = c.user_id ${w}`, params);
  const rows = await req.tdb.query(`${CHARGE_SELECT} ${w} ORDER BY c.due_date DESC, c.id DESC LIMIT :limit OFFSET :offset`,
    { ...params, limit: pg.limit, offset: pg.offset });
  res.json({ status: 'success', data: rows, meta: { ...pageMeta(pg, agg.total), balance: agg.balance } });
});

// Estado de cuenta del alumno o del tutor (sus cargos y los de sus menores)
charges.get('/mine', validate({ query: z.object({ user_id: id.optional(), status: z.enum(['open', 'all']).default('all') }) }), async (req, res) => {
  const uid = await actingUser(req, req.valid.query.user_id, { staffRoles: STAFF, need: 'pay' });
  const open = req.valid.query.status === 'open' ? "AND c.status IN ('pending','partial')" : "AND c.status <> 'void'";
  const rows = await req.tdb.query(`${CHARGE_SELECT} WHERE c.dojo_id = :dojoId AND c.user_id = :uid ${open}
                                     ORDER BY (c.status IN ('pending','partial')) DESC, c.due_date DESC LIMIT 100`, { uid });
  const [bal] = await req.tdb.query(
    `SELECT COALESCE(SUM(total - amount_paid), 0) AS balance_due,
            COALESCE(SUM(CASE WHEN due_date < :today THEN total - amount_paid ELSE 0 END), 0) AS overdue,
            MIN(due_date) AS next_due_date
       FROM charges WHERE dojo_id = :dojoId AND user_id = :uid AND status IN ('pending','partial')`,
    { uid, today: todayIn((await getDojo(req)).timezone) });
  bal.credit = await svc.creditBalance(req.tdb, uid, (await getDojo(req)).currency);
  res.json({ status: 'success', data: { summary: bal, charges: rows } });
});

charges.get('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const c = await req.tdb.one(`${CHARGE_SELECT} WHERE c.dojo_id = :dojoId AND c.id = :id`, { id: req.valid.params.id });
  if (!c) throw notFound('Cargo no encontrado');
  await actingUser(req, c.user_id, { staffRoles: STAFF, need: 'pay' });
  c.payments = await req.tdb.query(
    `SELECT pa.payment_id, pa.amount, py.method, py.paid_at, py.reference, py.status
       FROM payment_allocations pa JOIN payments py ON py.dojo_id = pa.dojo_id AND py.id = pa.payment_id
      WHERE pa.dojo_id = :dojoId AND pa.charge_id = :id ORDER BY py.paid_at`, { id: c.id });
  res.json({ status: 'success', data: c });
});

// Cargo manual (evento, producto, ajuste…)
charges.post('/', requireRole(...STAFF), validate({
  body: z.object({
    user_id: id,
    type: z.enum(['event', 'product', 'adjustment', 'other', 'exam_fee', 'signup_fee', 'membership']).default('other'),
    description: z.string().trim().min(1).max(255),
    amount: money,
    discount_amount: z.coerce.number().min(0).max(10000000).default(0),
    due_date: date.optional(),
    membership_id: id.nullish(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  if (b.discount_amount > b.amount) throw badRequest('El descuento no puede ser mayor al monto');
  const dojo = await getDojo(req);
  const chargeId = await req.tdb.transaction(async (t) => {
    const m = await t.one('SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u', { u: b.user_id });
    if (!m) throw badRequest('La persona no es miembro del dojo');
    const cid = await svc.createCharge(t, {
      ...b, currency: dojo.currency, due_date: b.due_date ?? todayIn(dojo.timezone), created_by: req.auth.userId,
    });
    await auditReq(req, t.executor, { action: 'create', entity: 'charge', entityId: cid, after: b });
    return cid;
  });
  res.status(201).json({ status: 'success', data: await req.tdb.one(`${CHARGE_SELECT} WHERE c.dojo_id = :dojoId AND c.id = :id`, { id: chargeId }) });
});

// Anular (solo si no tiene pagos aplicados)
charges.post('/:id/void', requireRole('admin'), validate({
  params: z.object({ id }), body: z.object({ reason: z.string().trim().min(1).max(255) }),
}), async (req, res) => {
  const chargeId = req.valid.params.id;
  await req.tdb.transaction(async (t) => {
    const c = await t.one('SELECT status, amount_paid FROM charges WHERE dojo_id = :dojoId AND id = :chargeId FOR UPDATE', { chargeId });
    if (!c) throw notFound('Cargo no encontrado');
    if (c.amount_paid > 0) throw conflict('El cargo tiene pagos aplicados; cancela o reembolsa el pago primero', 'CHARGE_HAS_PAYMENTS');
    if (c.status === 'void') throw conflict('El cargo ya está anulado');
    await t.query(`UPDATE charges SET status = 'void', voided_reason = :r WHERE dojo_id = :dojoId AND id = :chargeId`,
      { chargeId, r: req.valid.body.reason });
    await auditReq(req, t.executor, { action: 'void', entity: 'charge', entityId: chargeId, before: c, after: req.valid.body });
  });
  res.json({ status: 'success' });
});

// ===========================================================================
// Pagos
// ===========================================================================
const payments = express.Router();
payments.use(authenticate, requireDojo);

const PAYMENT_SELECT = `
  SELECT py.id, py.user_id, CONCAT_WS(' ', p.first_name, p.last_name) AS user_name, py.amount, py.currency,
         py.method, py.status, py.paid_at, py.reference, py.receipt_url, py.provider, py.provider_fee,
         py.refunded_amount, py.notes, py.created_at,
         CONCAT_WS(' ', rp.first_name, rp.last_name) AS received_by_name
    FROM payments py
    JOIN user_profiles p ON p.user_id = py.user_id
    LEFT JOIN user_profiles rp ON rp.user_id = py.received_by`;

async function loadPayment(tdb, paymentId) {
  const p = await tdb.one(`${PAYMENT_SELECT} WHERE py.dojo_id = :dojoId AND py.id = :paymentId`, { paymentId });
  if (!p) return null;
  p.allocations = await tdb.query(
    `SELECT pa.charge_id, pa.amount, c.description, c.type, c.period_start
       FROM payment_allocations pa JOIN charges c ON c.dojo_id = pa.dojo_id AND c.id = pa.charge_id
      WHERE pa.dojo_id = :dojoId AND pa.payment_id = :paymentId`, { paymentId });
  p.unapplied = Math.round((p.amount - p.allocations.reduce((s, a) => s + a.amount, 0)) * 100) / 100;
  return p;
}

payments.get('/', requireRole(...STAFF), validate({
  query: z.object({
    user_id: id.optional(),
    method: z.enum(['cash', 'transfer', 'card', 'paypal', 'other']).optional(),
    status: z.enum(['pending', 'completed', 'failed', 'refunded', 'partially_refunded', 'cancelled', 'all']).default('completed'),
    from: date.optional(), to: date.optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    page_size: z.coerce.number().int().positive().optional(),
  }),
}), async (req, res) => {
  const q = req.valid.query;
  const pg = pageParams(q);
  const where = ['py.dojo_id = :dojoId'];
  const params = {};
  if (q.status !== 'all') { where.push('py.status = :status'); params.status = q.status; }
  if (q.user_id) { where.push('py.user_id = :u'); params.u = q.user_id; }
  if (q.method) { where.push('py.method = :m'); params.m = q.method; }
  if (q.from) { where.push('py.paid_at >= :from'); params.from = `${q.from} 00:00:00`; }
  if (q.to) { where.push('py.paid_at <= :to'); params.to = `${q.to} 23:59:59`; }
  if (q.q) { where.push("(CONCAT_WS(' ', p.first_name, p.last_name) LIKE :q OR py.reference LIKE :q)"); params.q = likeEscape(q.q); }
  const w = `WHERE ${where.join(' AND ')}`;
  const [agg] = await req.tdb.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(py.amount - py.refunded_amount), 0) AS sum
       FROM payments py JOIN user_profiles p ON p.user_id = py.user_id ${w}`, params);
  const rows = await req.tdb.query(`${PAYMENT_SELECT} ${w} ORDER BY py.paid_at DESC, py.id DESC LIMIT :limit OFFSET :offset`,
    { ...params, limit: pg.limit, offset: pg.offset });
  res.json({ status: 'success', data: rows, meta: { ...pageMeta(pg, agg.total), sum: agg.sum } });
});

payments.get('/mine', validate({
  query: z.object({ user_id: id.optional(), page: z.coerce.number().int().positive().optional(), page_size: z.coerce.number().int().positive().optional() }),
}), async (req, res) => {
  const uid = await actingUser(req, req.valid.query.user_id, { staffRoles: STAFF, need: 'pay' });
  const pg = pageParams(req.valid.query);
  const [{ total }] = await req.tdb.query(`SELECT COUNT(*) AS total FROM payments WHERE dojo_id = :dojoId AND user_id = :uid AND status <> 'cancelled'`, { uid });
  const rows = await req.tdb.query(
    `${PAYMENT_SELECT} WHERE py.dojo_id = :dojoId AND py.user_id = :uid AND py.status <> 'cancelled'
      ORDER BY py.paid_at DESC LIMIT :limit OFFSET :offset`, { uid, limit: pg.limit, offset: pg.offset });
  res.json({ status: 'success', data: rows, meta: pageMeta(pg, total) });
});

payments.get('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const p = await loadPayment(req.tdb, req.valid.params.id);
  if (!p) throw notFound('Pago no encontrado');
  await actingUser(req, p.user_id, { staffRoles: STAFF, need: 'pay' });
  res.json({ status: 'success', data: p });
});

/**
 * Registrar un pago manual. Si no se indica a qué cargos aplica, se aplica
 * automáticamente a los pendientes más antiguos de esa persona.
 */
payments.post('/', requireRole(...STAFF), validate({
  body: z.object({
    user_id: id,
    amount: money,
    method: z.enum(['cash', 'transfer', 'card', 'other']),
    paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/).optional(),
    reference: z.string().trim().max(100).nullish(),
    notes: z.string().trim().max(255).nullish(),
    allocations: z.array(z.object({ charge_id: id, amount: money })).optional(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  const dojo = await getDojo(req);
  const paymentId = await req.tdb.transaction(async (t) => {
    const m = await t.one('SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u', { u: b.user_id });
    if (!m) throw badRequest('La persona no es miembro del dojo');
    const r = await t.query(
      `INSERT INTO payments (dojo_id, user_id, amount, currency, method, status, paid_at, reference, notes, received_by)
       VALUES (:dojoId, :u, :amount, :cur, :method, 'completed', :paidAt, :ref, :notes, :by)`,
      { u: b.user_id, amount: b.amount, cur: dojo.currency, method: b.method,
        paidAt: b.paid_at ?? new Date(), ref: b.reference ?? null, notes: b.notes ?? null, by: req.auth.userId });
    const result = await svc.allocatePayment(t, {
      paymentId: r.insertId, userId: b.user_id, amount: b.amount, currency: dojo.currency, allocations: b.allocations,
    });
    await svc.reactivatePaidMemberships(t, b.user_id, todayIn(dojo.timezone));
    await auditReq(req, t.executor, { action: 'create', entity: 'payment', entityId: r.insertId, after: { ...b, applied: result.applied } });
    return r.insertId;
  });
  res.status(201).json({ status: 'success', data: await loadPayment(req.tdb, paymentId) });
});

// Cancelar un pago registrado por error: revierte las aplicaciones
payments.post('/:id/cancel', requireRole('admin'), validate({
  params: z.object({ id }), body: z.object({ reason: z.string().trim().min(1).max(255) }),
}), async (req, res) => {
  const paymentId = req.valid.params.id;
  await req.tdb.transaction(async (t) => {
    const p = await t.one('SELECT status, provider FROM payments WHERE dojo_id = :dojoId AND id = :paymentId FOR UPDATE', { paymentId });
    if (!p) throw notFound('Pago no encontrado');
    if (p.status !== 'completed') throw conflict('Solo se pueden cancelar pagos completados');
    if (p.provider) throw conflict('Los pagos en línea se reembolsan desde el proveedor', 'USE_REFUND');
    const reversed = await svc.reversePayment(t, paymentId);
    await t.query(`UPDATE payments SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, :r) WHERE dojo_id = :dojoId AND id = :paymentId`,
      { paymentId, r: `Cancelado: ${req.valid.body.reason}` });
    await auditReq(req, t.executor, { action: 'cancel', entity: 'payment', entityId: paymentId, before: reversed, after: req.valid.body });
  });
  res.json({ status: 'success', data: await loadPayment(req.tdb, paymentId) });
});

// Aplicar el saldo a favor de un pago a cargos nuevos
payments.post('/:id/allocate', requireRole(...STAFF), validate({
  params: z.object({ id }), body: z.object({ allocations: z.array(z.object({ charge_id: id, amount: money })).optional() }),
}), async (req, res) => {
  const paymentId = req.valid.params.id;
  const dojo = await getDojo(req);
  await req.tdb.transaction(async (t) => {
    const p = await loadPayment(t, paymentId);
    if (!p) throw notFound('Pago no encontrado');
    if (p.status !== 'completed') throw conflict('El pago no está completado');
    if (p.unapplied <= 0) throw conflict('El pago no tiene saldo por aplicar');
    await svc.allocatePayment(t, { paymentId, userId: p.user_id, amount: p.unapplied, currency: p.currency, allocations: req.valid.body.allocations });
    await svc.reactivatePaidMemberships(t, p.user_id, todayIn(dojo.timezone));
  });
  res.json({ status: 'success', data: await loadPayment(req.tdb, paymentId) });
});

module.exports = { charges, payments };
