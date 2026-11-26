/**
 * /api/v2/finance — gastos y otros ingresos del dojo (solo dueño/administrador)
 *
 *   GET    /categories?kind=            categorías (crea las de omisión la primera vez)
 *   POST   /categories                  { kind, name }
 *   PATCH  /categories/:id              { name?, active?, sort_order? }
 *   DELETE /categories/:id              solo si no tiene movimientos
 *   GET    /entries?from&to&kind&category_id   movimientos + totales
 *   POST   /entries                     { kind, category_id, amount, entry_date, description?, method?, reference?, notes? }
 *   PATCH  /entries/:id
 *   DELETE /entries/:id
 *   GET    /recurring                   movimientos fijos mensuales
 *   POST   /recurring                   { kind, category_id, amount, day_of_month, starts_on, ends_on?, description? }
 *   PATCH  /recurring/:id
 *   DELETE /recurring/:id               deja los movimientos que ya generó
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest, conflict } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { buildSet } = require('../../utils/sql');
const svc = require('./finance.service');

const router = express.Router();
router.use(authenticate, requireDojo, requireRole('admin'));

const id = z.coerce.number().int().positive();
const kind = z.enum(['expense', 'income']);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const money = z.coerce.number().positive().max(10000000);
const txt = (n) => z.string().trim().max(n).nullish().transform((v) => (v === '' ? null : v));

async function category(tdb, categoryId, k) {
  const c = await tdb.one('SELECT id, kind, name, active FROM finance_categories WHERE dojo_id = :dojoId AND id = :categoryId', { categoryId });
  if (!c) throw notFound('Categoría no encontrada');
  if (k && c.kind !== k) throw badRequest('La categoría no corresponde al tipo de movimiento');
  return c;
}
const currencyOf = async (tdb) => (await tdb.one('SELECT currency FROM dojos WHERE id = :dojoId')).currency;

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------
router.get('/categories', validate({ query: z.object({ kind: kind.optional() }) }), async (req, res) => {
  await svc.ensureCategories(req.tdb);
  const k = req.valid.query.kind;
  const rows = await req.tdb.query(
    `SELECT c.id, c.kind, c.name, c.active, c.sort_order,
            (SELECT COUNT(*) FROM finance_entries e WHERE e.dojo_id = c.dojo_id AND e.category_id = c.id) AS entries
       FROM finance_categories c WHERE c.dojo_id = :dojoId ${k ? 'AND c.kind = :k' : ''}
      ORDER BY c.kind, c.active DESC, c.sort_order, c.name`, { k });
  res.json({ status: 'success', data: rows });
});

router.post('/categories', validate({ body: z.object({ kind, name: z.string().trim().min(1).max(80) }) }), async (req, res) => {
  const b = req.valid.body;
  await svc.ensureCategories(req.tdb);
  const dup = await req.tdb.one('SELECT id, active FROM finance_categories WHERE dojo_id = :dojoId AND kind = :kind AND name = :name', b);
  if (dup) {
    if (dup.active) throw conflict('Ya existe una categoría con ese nombre');
    await req.tdb.query('UPDATE finance_categories SET active = 1 WHERE dojo_id = :dojoId AND id = :id', { id: dup.id });
    return res.status(201).json({ status: 'success', data: { id: dup.id } });
  }
  const [{ m }] = await req.tdb.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM finance_categories WHERE dojo_id = :dojoId AND kind = :kind', b);
  const r = await req.tdb.query(
    'INSERT INTO finance_categories (dojo_id, kind, name, sort_order) VALUES (:dojoId, :kind, :name, :s)', { ...b, s: Number(m) + 10 });
  await auditReq(req, req.tdb.executor, { action: 'create', entity: 'finance_category', entityId: r.insertId, after: b });
  res.status(201).json({ status: 'success', data: { id: r.insertId } });
});

router.patch('/categories/:id', validate({
  params: z.object({ id }),
  body: z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional(), sort_order: z.coerce.number().int().min(0).max(9999).optional() })
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const c = await category(req.tdb, req.valid.params.id);
  const set = buildSet(req.valid.body, { name: 'name', active: 'active', sort_order: 'sort_order' });
  try {
    await req.tdb.query(`UPDATE finance_categories SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: c.id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw conflict('Ya existe una categoría con ese nombre');
    throw e;
  }
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'finance_category', entityId: c.id, before: c, after: req.valid.body });
  res.json({ status: 'success', data: { id: c.id } });
});

router.delete('/categories/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const c = await category(req.tdb, req.valid.params.id);
  const [{ n }] = await req.tdb.query(
    `SELECT (SELECT COUNT(*) FROM finance_entries WHERE dojo_id = :dojoId AND category_id = :id)
          + (SELECT COUNT(*) FROM finance_recurring WHERE dojo_id = :dojoId AND category_id = :id) AS n`, { id: c.id });
  if (Number(n) > 0) throw conflict('La categoría tiene movimientos: desactívala en lugar de borrarla');
  await req.tdb.query('DELETE FROM finance_categories WHERE dojo_id = :dojoId AND id = :id', { id: c.id });
  await auditReq(req, req.tdb.executor, { action: 'delete', entity: 'finance_category', entityId: c.id, before: c });
  res.json({ status: 'success', data: { deleted: true } });
});

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------
const entryFields = {
  kind, category_id: id, amount: money, entry_date: ymd,
  description: txt(255), method: z.enum(['cash', 'transfer', 'card', 'other']).nullish(), reference: txt(100), notes: txt(500),
};

router.get('/entries', validate({
  query: z.object({ from: ymd.optional(), to: ymd.optional(), kind: kind.optional(), category_id: id.optional() }),
}), async (req, res) => {
  await svc.generateRecurring(req.auth.dojoId);
  const q = req.valid.query;
  const where = ['e.dojo_id = :dojoId'];
  if (q.from) where.push('e.entry_date >= :from');
  if (q.to) where.push('e.entry_date <= :to');
  if (q.kind) where.push('e.kind = :kind');
  if (q.category_id) where.push('e.category_id = :category_id');
  const rows = await req.tdb.query(
    `SELECT e.id, e.kind, e.category_id, c.name AS category, e.description, e.amount, e.currency, e.entry_date,
            e.method, e.reference, e.notes, e.recurring_id, e.created_at
       FROM finance_entries e JOIN finance_categories c ON c.dojo_id = e.dojo_id AND c.id = e.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.entry_date DESC, e.id DESC LIMIT 1000`, q);
  const sum = (k) => Math.round(rows.filter((r) => r.kind === k).reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  res.json({ status: 'success', data: rows, meta: { income: sum('income'), expense: sum('expense'), net: Math.round((sum('income') - sum('expense')) * 100) / 100 } });
});

router.post('/entries', validate({ body: z.object(entryFields) }), async (req, res) => {
  const b = req.valid.body;
  await category(req.tdb, b.category_id, b.kind);
  const r = await req.tdb.query(
    `INSERT INTO finance_entries (dojo_id, kind, category_id, description, amount, currency, entry_date, method, reference, notes, created_by)
     VALUES (:dojoId, :kind, :category_id, :description, :amount, :cur, :entry_date, :method, :reference, :notes, :by)`,
    { description: null, method: null, reference: null, notes: null, ...b, cur: await currencyOf(req.tdb), by: req.auth.userId });
  await auditReq(req, req.tdb.executor, { action: 'create', entity: 'finance_entry', entityId: r.insertId, after: b });
  res.status(201).json({ status: 'success', data: { id: r.insertId } });
});

async function entry(tdb, entryId) {
  const e = await tdb.one('SELECT * FROM finance_entries WHERE dojo_id = :dojoId AND id = :entryId', { entryId });
  if (!e) throw notFound('Movimiento no encontrado');
  return e;
}

router.patch('/entries/:id', validate({
  params: z.object({ id }),
  body: z.object(Object.fromEntries(Object.entries(entryFields).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const e = await entry(req.tdb, req.valid.params.id);
  const b = req.valid.body;
  if (b.category_id || b.kind) await category(req.tdb, b.category_id ?? e.category_id, b.kind ?? e.kind);
  const set = buildSet(b, Object.fromEntries(Object.keys(entryFields).map((k) => [k, k])));
  await req.tdb.query(`UPDATE finance_entries SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: e.id });
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'finance_entry', entityId: e.id, before: e, after: b });
  res.json({ status: 'success', data: { id: e.id } });
});

router.delete('/entries/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const e = await entry(req.tdb, req.valid.params.id);
  await req.tdb.query('DELETE FROM finance_entries WHERE dojo_id = :dojoId AND id = :id', { id: e.id });
  await auditReq(req, req.tdb.executor, { action: 'delete', entity: 'finance_entry', entityId: e.id, before: e });
  res.json({ status: 'success', data: { deleted: true } });
});

// ---------------------------------------------------------------------------
// Movimientos fijos (cada mes)
// ---------------------------------------------------------------------------
const recFields = {
  kind, category_id: id, amount: money, description: txt(255),
  day_of_month: z.coerce.number().int().min(1).max(28), starts_on: ymd, ends_on: ymd.nullish(), active: z.boolean(),
};
const firstOfMonth = (d) => (d ? `${d.slice(0, 7)}-01` : d);

router.get('/recurring', async (req, res) => {
  const rows = await req.tdb.query(
    `SELECT r.id, r.kind, r.category_id, c.name AS category, r.description, r.amount, r.currency, r.day_of_month,
            r.starts_on, r.ends_on, r.active, r.last_period
       FROM finance_recurring r JOIN finance_categories c ON c.dojo_id = r.dojo_id AND c.id = r.category_id
      WHERE r.dojo_id = :dojoId ORDER BY r.active DESC, r.kind, c.name`);
  res.json({ status: 'success', data: rows });
});

router.post('/recurring', validate({ body: z.object({ ...recFields, active: recFields.active.optional() }) }), async (req, res) => {
  const b = req.valid.body;
  await category(req.tdb, b.category_id, b.kind);
  if (b.ends_on && b.ends_on < b.starts_on) throw badRequest('El último mes no puede ser antes del primero');
  const r = await req.tdb.query(
    `INSERT INTO finance_recurring (dojo_id, kind, category_id, description, amount, currency, day_of_month, starts_on, ends_on, created_by)
     VALUES (:dojoId, :kind, :category_id, :description, :amount, :cur, :day_of_month, :starts_on, :ends_on, :by)`,
    { description: null, ...b, starts_on: firstOfMonth(b.starts_on), ends_on: firstOfMonth(b.ends_on) ?? null, cur: await currencyOf(req.tdb), by: req.auth.userId });
  await auditReq(req, req.tdb.executor, { action: 'create', entity: 'finance_recurring', entityId: r.insertId, after: b });
  const created = await svc.generateRecurring(req.auth.dojoId);
  res.status(201).json({ status: 'success', data: { id: r.insertId, created } });
});

router.patch('/recurring/:id', validate({
  params: z.object({ id }),
  body: z.object(Object.fromEntries(Object.entries(recFields).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const r = await req.tdb.one('SELECT * FROM finance_recurring WHERE dojo_id = :dojoId AND id = :id', { id: req.valid.params.id });
  if (!r) throw notFound('Movimiento fijo no encontrado');
  const b = { ...req.valid.body };
  if (b.category_id || b.kind) await category(req.tdb, b.category_id ?? r.category_id, b.kind ?? r.kind);
  if (b.starts_on) b.starts_on = firstOfMonth(b.starts_on);
  if (b.ends_on) b.ends_on = firstOfMonth(b.ends_on);
  const set = buildSet(b, Object.fromEntries(Object.keys(recFields).map((k) => [k, k])));
  await req.tdb.query(`UPDATE finance_recurring SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: r.id });
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'finance_recurring', entityId: r.id, before: r, after: req.valid.body });
  await svc.generateRecurring(req.auth.dojoId);
  res.json({ status: 'success', data: { id: r.id } });
});

router.delete('/recurring/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const r = await req.tdb.one('SELECT * FROM finance_recurring WHERE dojo_id = :dojoId AND id = :id', { id: req.valid.params.id });
  if (!r) throw notFound('Movimiento fijo no encontrado');
  await req.tdb.query('DELETE FROM finance_recurring WHERE dojo_id = :dojoId AND id = :id', { id: r.id });
  await auditReq(req, req.tdb.executor, { action: 'delete', entity: 'finance_recurring', entityId: r.id, before: r });
  res.json({ status: 'success', data: { deleted: true } });
});

module.exports = router;
