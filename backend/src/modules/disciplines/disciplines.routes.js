/**
 * Módulo de referencia: muestra el patrón que seguirán las demás rutas.
 *   - authenticate + requireDojo a nivel de router
 *   - requireRole en cada escritura
 *   - validación zod (solo pasan los campos declarados)
 *   - todas las consultas vía req.tdb (filtradas por :dojoId)
 *   - transacción + auditoría en cambios
 *   - "eliminar" = desactivar (no se pierde la historia de grados)
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole, hasRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');

const router = express.Router();
router.use(authenticate, requireDojo);

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color hexadecimal #RRGGBB');
const idParam = z.object({ id: z.coerce.number().int().positive() });

const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  style: z.string().trim().max(150).nullish(),
  description: z.string().trim().max(5000).nullish(),
  color: hexColor.nullish(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
  display_style: z.enum(['rank', 'belt']).optional(), // modo de su ruta "General"
});
const updateSchema = createSchema.omit({ display_style: true }).partial().extend({ active: z.boolean().optional() })
  .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar');

const SELECT = `
  SELECT d.id, d.name, d.style, d.description, d.color, d.sort_order, d.active,
         (SELECT COUNT(*) FROM ranks r WHERE r.dojo_id = d.dojo_id AND r.discipline_id = d.id AND r.active = 1) AS ranks_count,
         (SELECT COUNT(*) FROM member_ranks mr WHERE mr.dojo_id = d.dojo_id AND mr.discipline_id = d.id) AS students_count
    FROM disciplines d`;

async function findById(tdb, id) {
  return tdb.one(`${SELECT} WHERE d.dojo_id = :dojoId AND d.id = :id`, { id });
}

// GET /api/v2/disciplines?include_inactive=true (inactivas solo para admin)
router.get('/', validate({ query: z.object({ include_inactive: z.stringbool().optional() }) }), async (req, res) => {
  const all = req.valid.query.include_inactive && hasRole(req, 'admin');
  const rows = await req.tdb.query(
    `${SELECT} WHERE d.dojo_id = :dojoId ${all ? '' : 'AND d.active = 1'} ORDER BY d.sort_order, d.name`);
  res.json({ status: 'success', data: rows });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const row = await findById(req.tdb, req.valid.params.id);
  if (!row || (!row.active && !hasRole(req, 'admin'))) throw notFound('Disciplina no encontrada');
  res.json({ status: 'success', data: row });
});

router.post('/', requireRole('admin'), validate({ body: createSchema }), async (req, res) => {
  const b = req.valid.body;
  const created = await req.tdb.transaction(async (t) => {
    const r = await t.query(
      `INSERT INTO disciplines (dojo_id, name, style, description, color, sort_order)
       VALUES (:dojoId, :name, :style, :description, :color, :sort)`,
      { name: b.name, style: b.style ?? null, description: b.description ?? null,
        color: b.color ?? null, sort: b.sort_order ?? 0 });
    // Toda disciplina nace con una ruta de grados "General"
    await t.query(
      `INSERT INTO rank_tracks (dojo_id, discipline_id, name, display_style) VALUES (:dojoId, :id, 'General', :style)`,
      { id: r.insertId, style: b.display_style ?? 'rank' });
    const row = await findById(t, r.insertId);
    await auditReq(req, t.executor, { action: 'create', entity: 'discipline', entityId: r.insertId, after: row });
    return row;
  });
  res.status(201).json({ status: 'success', data: created });
});

router.patch('/:id', requireRole('admin'), validate({ params: idParam, body: updateSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const b = req.valid.body;
  const updated = await req.tdb.transaction(async (t) => {
    const before = await findById(t, id);
    if (!before) throw notFound('Disciplina no encontrada');

    const cols = { name: 'name', style: 'style', description: 'description', color: 'color', sort_order: 'sort_order', active: 'active' };
    const sets = [];
    const params = { id };
    for (const [key, col] of Object.entries(cols)) {
      if (b[key] === undefined) continue;
      sets.push(`${col} = :${key}`);
      params[key] = typeof b[key] === 'boolean' ? Number(b[key]) : b[key];
    }
    await t.query(`UPDATE disciplines SET ${sets.join(', ')} WHERE dojo_id = :dojoId AND id = :id`, params);
    const after = await findById(t, id);
    await auditReq(req, t.executor, { action: 'update', entity: 'discipline', entityId: id, before, after });
    return after;
  });
  res.json({ status: 'success', data: updated });
});

// DELETE = desactivar. Los alumnos conservan su historial de grados.
router.delete('/:id', requireRole('admin'), validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  await req.tdb.transaction(async (t) => {
    const r = await t.query(`UPDATE disciplines SET active = 0 WHERE dojo_id = :dojoId AND id = :id`, { id });
    if (r.affectedRows === 0) throw notFound('Disciplina no encontrada');
    await auditReq(req, t.executor, { action: 'deactivate', entity: 'discipline', entityId: id });
  });
  res.json({ status: 'success' });
});

module.exports = router;
