/**
 * /api/v2/plans      — lo que vende el dojo (mensualidades, paquetes de clases, prueba…)
 * /api/v2/discounts  — catálogo de descuentos (Familiar 20 %, Beca, Instructor…)
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole, hasRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { buildSet } = require('../../utils/sql');

const id = z.coerce.number().int().positive();
const money = z.coerce.number().min(0).max(10000000);

// ===========================================================================
// Planes
// ===========================================================================
const plans = express.Router();
plans.use(authenticate, requireDojo);

const planFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).nullish(),
  billing_type: z.enum(['recurring', 'class_pack', 'one_time', 'trial']),
  interval_unit: z.enum(['week', 'month', 'year']).nullish(),
  interval_count: z.coerce.number().int().min(1).max(24).nullish(),
  price: money,
  currency: z.string().length(3).toUpperCase().optional(),
  signup_fee: money.nullish(),
  sessions_per_week: z.coerce.number().int().min(1).max(50).nullish(),
  total_sessions: z.coerce.number().int().min(1).max(1000).nullish(),
  validity_days: z.coerce.number().int().min(1).max(3660).nullish(),
  max_members: z.coerce.number().int().min(1).max(20).optional(),
  all_disciplines: z.boolean().optional(),
  visible_to_students: z.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
};
const PLAN_COLS = Object.fromEntries(Object.keys(planFields).map((k) => [k, k]));

function checkPlanRules(p) {
  if (p.billing_type === 'recurring' && !p.interval_unit) throw badRequest('Un plan recurrente necesita interval_unit (week/month/year)');
  if (p.billing_type === 'class_pack' && !p.total_sessions) throw badRequest('Un paquete de clases necesita total_sessions');
  if (p.billing_type !== 'recurring') { p.interval_unit = null; p.interval_count = null; }
}

async function loadPlan(tdb, planId) {
  const p = await tdb.one(
    `SELECT id, name, description, billing_type, interval_unit, interval_count, price, currency, signup_fee,
            sessions_per_week, total_sessions, validity_days, max_members, all_disciplines, visible_to_students,
            sort_order, active,
            (SELECT COUNT(*) FROM memberships m WHERE m.dojo_id = plans.dojo_id AND m.plan_id = plans.id
               AND m.status IN ('active','past_due','paused')) AS active_memberships
       FROM plans WHERE dojo_id = :dojoId AND id = :planId`, { planId });
  if (!p) return null;
  p.discipline_ids = (await tdb.query('SELECT discipline_id FROM plan_disciplines WHERE dojo_id = :dojoId AND plan_id = :planId', { planId }))
    .map((r) => r.discipline_id);
  return p;
}

async function setPlanDisciplines(t, planId, ids) {
  await t.query('DELETE FROM plan_disciplines WHERE dojo_id = :dojoId AND plan_id = :planId', { planId });
  for (const d of new Set(ids)) {
    await t.query('INSERT INTO plan_disciplines (dojo_id, plan_id, discipline_id) VALUES (:dojoId, :planId, :d)', { planId, d });
  }
}

// Alumnos ven solo planes activos y visibles (catálogo); admin/staff ven todo
plans.get('/', validate({ query: z.object({ include_inactive: z.stringbool().optional() }) }), async (req, res) => {
  const staff = hasRole(req, 'admin', 'staff');
  const filter = staff ? (req.valid.query.include_inactive ? '' : 'AND active = 1') : 'AND active = 1 AND visible_to_students = 1';
  const rows = await req.tdb.query(
    `SELECT id FROM plans WHERE dojo_id = :dojoId ${filter} ORDER BY sort_order, price`);
  const data = [];
  for (const r of rows) data.push(await loadPlan(req.tdb, r.id));
  if (!staff) data.forEach((p) => delete p.active_memberships);
  res.json({ status: 'success', data });
});

plans.get('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const p = await loadPlan(req.tdb, req.valid.params.id);
  if (!p || (!hasRole(req, 'admin', 'staff') && (!p.active || !p.visible_to_students))) throw notFound('Plan no encontrado');
  res.json({ status: 'success', data: p });
});

plans.post('/', requireRole('admin'), validate({
  body: z.object({ ...planFields, discipline_ids: z.array(id).default([]) }),
}), async (req, res) => {
  const b = { ...req.valid.body };
  checkPlanRules(b);
  if (!b.all_disciplines && b.all_disciplines !== undefined && b.discipline_ids.length === 0) {
    throw badRequest('Indica las disciplinas que incluye el plan o marca all_disciplines');
  }
  const created = await req.tdb.transaction(async (t) => {
    if (!b.currency) b.currency = (await t.one('SELECT currency FROM dojos WHERE id = :dojoId')).currency;
    const cols = Object.keys(PLAN_COLS).filter((k) => b[k] !== undefined);
    const r = await t.query(
      `INSERT INTO plans (dojo_id, ${cols.map((c) => `\`${c}\``).join(', ')})
       VALUES (:dojoId, ${cols.map((c) => `:${c}`).join(', ')})`,
      Object.fromEntries(cols.map((c) => [c, typeof b[c] === 'boolean' ? Number(b[c]) : b[c]])));
    if (b.discipline_ids.length) await setPlanDisciplines(t, r.insertId, b.discipline_ids);
    await auditReq(req, t.executor, { action: 'create', entity: 'plan', entityId: r.insertId, after: b });
    return loadPlan(t, r.insertId);
  });
  res.status(201).json({ status: 'success', data: created });
});

// Cambiar un plan NO cambia las membresías existentes (guardan su propio precio)
plans.patch('/:id', requireRole('admin'), validate({
  params: z.object({ id }),
  body: z.object(Object.fromEntries(Object.entries(planFields).map(([k, v]) => [k, v.optional()])))
    .extend({ active: z.boolean().optional(), discipline_ids: z.array(id).optional() })
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const planId = req.valid.params.id;
  const updated = await req.tdb.transaction(async (t) => {
    const before = await loadPlan(t, planId);
    if (!before) throw notFound('Plan no encontrado');
    const merged = { ...before, ...req.valid.body };
    checkPlanRules(merged);
    const body = { ...req.valid.body };
    if (merged.billing_type !== 'recurring') { body.interval_unit = null; body.interval_count = null; }
    const set = buildSet(body, { ...PLAN_COLS, active: 'active' });
    if (!set.empty) await t.query(`UPDATE plans SET ${set.sql} WHERE dojo_id = :dojoId AND id = :planId`, { ...set.params, planId });
    if (body.discipline_ids) await setPlanDisciplines(t, planId, body.discipline_ids);
    const after = await loadPlan(t, planId);
    await auditReq(req, t.executor, { action: 'update', entity: 'plan', entityId: planId, before, after });
    return after;
  });
  res.json({ status: 'success', data: updated });
});

plans.delete('/:id', requireRole('admin'), validate({ params: z.object({ id }) }), async (req, res) => {
  const r = await req.tdb.query('UPDATE plans SET active = 0 WHERE dojo_id = :dojoId AND id = :id', { id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Plan no encontrado');
  await auditReq(req, req.tdb.executor, { action: 'deactivate', entity: 'plan', entityId: req.valid.params.id });
  res.json({ status: 'success' });
});

// ===========================================================================
// Descuentos
// ===========================================================================
const discounts = express.Router();
discounts.use(authenticate, requireDojo, requireRole('admin', 'staff'));

const discountFields = {
  name: z.string().trim().min(1).max(100),
  type: z.enum(['percent', 'fixed']),
  value: z.coerce.number().positive().max(10000000),
  description: z.string().trim().max(255).nullish(),
};

discounts.get('/', async (req, res) => {
  const rows = await req.tdb.query(
    `SELECT id, name, type, value, description, active,
            (SELECT COUNT(*) FROM memberships m WHERE m.dojo_id = discounts.dojo_id AND m.discount_id = discounts.id
               AND m.status IN ('active','past_due','paused')) AS in_use
       FROM discounts WHERE dojo_id = :dojoId ORDER BY active DESC, name`);
  res.json({ status: 'success', data: rows });
});

discounts.post('/', requireRole('admin'), validate({ body: z.object(discountFields) }), async (req, res) => {
  const b = req.valid.body;
  if (b.type === 'percent' && b.value > 100) throw badRequest('Un porcentaje no puede pasar de 100');
  const r = await req.tdb.query(
    'INSERT INTO discounts (dojo_id, name, type, value, description) VALUES (:dojoId, :name, :type, :value, :desc)',
    { name: b.name, type: b.type, value: b.value, desc: b.description ?? null });
  await auditReq(req, req.tdb.executor, { action: 'create', entity: 'discount', entityId: r.insertId, after: b });
  res.status(201).json({ status: 'success', data: { id: r.insertId, ...b, active: 1 } });
});

discounts.patch('/:id', requireRole('admin'), validate({
  params: z.object({ id }),
  body: z.object(Object.fromEntries(Object.entries(discountFields).map(([k, v]) => [k, v.optional()])))
    .extend({ active: z.boolean().optional() })
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, { name: 'name', type: 'type', value: 'value', description: 'description', active: 'active' });
  const r = await req.tdb.query(`UPDATE discounts SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Descuento no encontrado');
  res.json({ status: 'success' });
});

module.exports = { plans, discounts };
