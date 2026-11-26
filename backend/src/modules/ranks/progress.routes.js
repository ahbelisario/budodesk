/**
 * /api/v2/progress — grados de los alumnos: progreso, promociones, temario, elegibles.
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { actingUser } = require('../../utils/acting');
const { getDojo } = require('../../utils/dojo');
const { todayIn } = require('../../utils/dates');
const { memberProgress, applyRankChange, recomputeRankDates } = require('./progress.service');

const router = express.Router();
router.use(authenticate, requireDojo);

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STAFF = ['admin', 'staff', 'instructor'];

async function history(tdb, userId) {
  return tdb.query(
    `SELECT h.id, h.discipline_id, d.name AS discipline, h.rank_id, r.name AS rank_name, r.color, r.stripe_color,
            h.stripes, h.event_type, h.awarded_date, h.score, h.certificate_number, h.certificate_url, h.notes,
            CONCAT_WS(' ', p.first_name, p.last_name) AS awarded_by_name
       FROM rank_history h
       JOIN ranks r ON r.dojo_id = h.dojo_id AND r.id = h.rank_id
       JOIN disciplines d ON d.dojo_id = h.dojo_id AND d.id = h.discipline_id
       LEFT JOIN user_profiles p ON p.user_id = h.awarded_by
      WHERE h.dojo_id = :dojoId AND h.user_id = :userId
      ORDER BY h.awarded_date DESC, h.id DESC`, { userId });
}

// GET /progress/members/:userId  (self, tutor o staff)
router.get('/members/:userId', validate({ params: z.object({ userId: id }) }), async (req, res) => {
  const uid = await actingUser(req, req.valid.params.userId, { staffRoles: STAFF });
  res.json({ status: 'success', data: { disciplines: await memberProgress(req.tdb, uid), history: await history(req.tdb, uid) } });
});

// GET /progress/mine?user_id=  (alumno o tutor)
router.get('/mine', validate({ query: z.object({ user_id: id.optional() }) }), async (req, res) => {
  const uid = await actingUser(req, req.valid.query.user_id, { staffRoles: STAFF });
  res.json({ status: 'success', data: { disciplines: await memberProgress(req.tdb, uid), history: await history(req.tdb, uid) } });
});

// POST /progress/promotions — otorgar grado, tip o corrección
router.post('/promotions', requireRole('admin', 'instructor'), validate({
  body: z.object({
    user_id: id,
    rank_id: id,
    stripes: z.coerce.number().int().min(0).max(10).default(0),
    event_type: z.enum(['initial', 'promotion', 'stripe', 'demotion', 'correction']).default('promotion'),
    awarded_date: date.optional(),
    score: z.coerce.number().min(0).max(100).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    certificate_number: z.string().trim().max(50).nullish(),
    next_exam_date: date.nullish(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  const dojo = await getDojo(req);
  const result = await req.tdb.transaction(async (t) => {
    const member = await t.one(`SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u AND status = 'active'`, { u: b.user_id });
    if (!member) throw notFound('Alumno no encontrado o inactivo');
    const rank = await t.one('SELECT id, discipline_id, name, max_stripes FROM ranks WHERE dojo_id = :dojoId AND id = :r AND active = 1', { r: b.rank_id });
    if (!rank) throw badRequest('Grado no válido');
    if (b.stripes > rank.max_stripes) throw badRequest(`Este grado admite máximo ${rank.max_stripes} tips`);

    const current = await t.one('SELECT rank_id FROM member_ranks WHERE dojo_id = :dojoId AND user_id = :u AND discipline_id = :d FOR UPDATE',
      { u: b.user_id, d: rank.discipline_id });
    let ev = b.event_type;
    if (!current) ev = 'initial';
    else if (ev === 'stripe' && current.rank_id !== rank.id) throw badRequest('Un tip debe ser sobre el grado actual');

    await applyRankChange(t, {
      userId: b.user_id, disciplineId: rank.discipline_id, rankId: rank.id, stripes: b.stripes, eventType: ev,
      awardedDate: b.awarded_date ?? todayIn(dojo.timezone), score: b.score, notes: b.notes,
      certificateNumber: b.certificate_number, awardedBy: req.auth.userId, nextExamDate: b.next_exam_date,
    });
    await auditReq(req, t.executor, { action: ev, entity: 'member_rank', entityId: b.user_id, before: current, after: { rank_id: rank.id, stripes: b.stripes } });
    return { user_id: b.user_id, rank_id: rank.id, rank: rank.name, event_type: ev };
  });
  if (['promotion', 'stripe'].includes(result.event_type)) {
    req.app.emit('rank_changed', { dojoId: req.auth.dojoId, userId: b.user_id, rank: result.rank, eventType: result.event_type });
  }
  res.status(201).json({ status: 'success', data: result });
});

// ---------------------------------------------------------------------------
// Corrección del historial (dueño/admin): fechas, certificados, grados anteriores
// ---------------------------------------------------------------------------
async function notFuture(req, d) {
  const dojo = await getDojo(req);
  if (d > todayIn(dojo.timezone)) throw badRequest('La fecha no puede ser futura');
}

// PATCH /progress/history/:id — corregir fecha, certificado o notas de un registro
router.patch('/history/:id', requireRole('admin'), validate({
  params: z.object({ id }),
  body: z.object({
    awarded_date: date.optional(),
    certificate_number: z.string().trim().max(50).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  }).refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const b = req.valid.body;
  if (b.awarded_date) await notFuture(req, b.awarded_date);
  const out = await req.tdb.transaction(async (t) => {
    const h = await t.one('SELECT * FROM rank_history WHERE dojo_id = :dojoId AND id = :id FOR UPDATE', { id: req.valid.params.id });
    if (!h) throw notFound('Registro no encontrado');
    const sets = [];
    if (b.awarded_date !== undefined) sets.push('awarded_date = :awarded_date');
    if (b.certificate_number !== undefined) sets.push('certificate_number = :certificate_number');
    if (b.notes !== undefined) sets.push('notes = :notes');
    try {
      await t.query(`UPDATE rank_history SET ${sets.join(', ')} WHERE dojo_id = :dojoId AND id = :id`,
        { id: h.id, awarded_date: b.awarded_date, certificate_number: b.certificate_number || null, notes: b.notes || null });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw badRequest('Ese número de certificado ya está en otro registro');
      throw e;
    }
    await recomputeRankDates(t, h.user_id, h.discipline_id);
    await auditReq(req, t.executor, {
      action: 'correct', entity: 'rank_history', entityId: h.id,
      before: { awarded_date: h.awarded_date, certificate_number: h.certificate_number, notes: h.notes }, after: b,
    });
    return h.user_id;
  });
  res.json({ status: 'success', data: { disciplines: await memberProgress(req.tdb, out), history: await history(req.tdb, out) } });
});

// POST /progress/history — agregar un grado anterior al historial sin cambiar el grado actual
router.post('/history', requireRole('admin'), validate({
  body: z.object({
    user_id: id, rank_id: id, awarded_date: date,
    stripes: z.coerce.number().int().min(0).max(10).default(0),
    certificate_number: z.string().trim().max(50).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  await notFuture(req, b.awarded_date);
  await req.tdb.transaction(async (t) => {
    const member = await t.one('SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u', { u: b.user_id });
    if (!member) throw notFound('Miembro no encontrado');
    const rank = await t.one('SELECT id, discipline_id FROM ranks WHERE dojo_id = :dojoId AND id = :r', { r: b.rank_id });
    if (!rank) throw badRequest('Grado no válido');
    try {
      const r = await t.query(
        `INSERT INTO rank_history (dojo_id, user_id, discipline_id, rank_id, stripes, event_type, awarded_date, certificate_number, awarded_by, notes)
         VALUES (:dojoId, :u, :d, :r, :stripes, 'promotion', :date, :cert, :by, :notes)`,
        { u: b.user_id, d: rank.discipline_id, r: rank.id, stripes: b.stripes, date: b.awarded_date,
          cert: b.certificate_number || null, by: req.auth.userId, notes: b.notes || null });
      await auditReq(req, t.executor, { action: 'add_past', entity: 'rank_history', entityId: r.insertId, after: b });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw badRequest('Ese número de certificado ya está en otro registro');
      throw e;
    }
    await recomputeRankDates(t, b.user_id, rank.discipline_id);
  });
  res.status(201).json({ status: 'success', data: { disciplines: await memberProgress(req.tdb, b.user_id), history: await history(req.tdb, b.user_id) } });
});

// DELETE /progress/history/:id — borrar un registro equivocado (el grado actual no cambia)
router.delete('/history/:id', requireRole('admin'), validate({ params: z.object({ id }) }), async (req, res) => {
  const uid = await req.tdb.transaction(async (t) => {
    const h = await t.one('SELECT * FROM rank_history WHERE dojo_id = :dojoId AND id = :id FOR UPDATE', { id: req.valid.params.id });
    if (!h) throw notFound('Registro no encontrado');
    await t.query('DELETE FROM rank_history WHERE dojo_id = :dojoId AND id = :id', { id: h.id });
    await recomputeRankDates(t, h.user_id, h.discipline_id);
    await auditReq(req, t.executor, { action: 'delete', entity: 'rank_history', entityId: h.id, before: h });
    return h.user_id;
  });
  res.json({ status: 'success', data: { disciplines: await memberProgress(req.tdb, uid), history: await history(req.tdb, uid) } });
});

// PUT /progress/members/:userId/requirements/:requirementId — evaluar un requisito del temario
router.put('/members/:userId/requirements/:requirementId', requireRole('admin', 'instructor'), validate({
  params: z.object({ userId: id, requirementId: id }),
  body: z.object({ status: z.enum(['pending', 'in_progress', 'approved']), notes: z.string().trim().max(500).nullish() }),
}), async (req, res) => {
  const { userId, requirementId } = req.valid.params;
  await req.tdb.query(
    `INSERT INTO member_requirement_progress (dojo_id, user_id, requirement_id, status, evaluated_by, evaluated_at, notes)
     VALUES (:dojoId, :userId, :requirementId, :status, :by, NOW(), :notes)
     ON DUPLICATE KEY UPDATE status = VALUES(status), evaluated_by = VALUES(evaluated_by),
                             evaluated_at = VALUES(evaluated_at), notes = VALUES(notes)`,
    { userId, requirementId, status: req.valid.body.status, by: req.auth.userId, notes: req.valid.body.notes ?? null });
  res.json({ status: 'success' });
});

// PATCH /progress/members/:userId/disciplines/:disciplineId — fecha de próximo examen
router.patch('/members/:userId/disciplines/:disciplineId', requireRole('admin', 'instructor'), validate({
  params: z.object({ userId: id, disciplineId: id }),
  body: z.object({ next_exam_date: date.nullable() }),
}), async (req, res) => {
  const { userId, disciplineId } = req.valid.params;
  const r = await req.tdb.query(
    'UPDATE member_ranks SET next_exam_date = :d WHERE dojo_id = :dojoId AND user_id = :userId AND discipline_id = :disciplineId',
    { d: req.valid.body.next_exam_date, userId, disciplineId });
  if (r.affectedRows === 0) throw notFound('El alumno no tiene grado en esa disciplina');
  res.json({ status: 'success' });
});

// GET /progress/eligible?discipline_id= — alumnos que ya cumplen tiempo y clases
router.get('/eligible', requireRole(...STAFF), validate({
  query: z.object({ discipline_id: id.optional(), include_near: z.stringbool().optional() }),
}), async (req, res) => {
  const q = req.valid.query;
  const near = q.include_near ? 0.8 : 1; // "casi listos" = 80 %
  const rows = await req.tdb.query(
    `SELECT v.user_id, p.first_name, p.last_name, p.photo_url,
            v.discipline_id, d.name AS discipline, r.name AS current_rank, r.color, v.stripes,
            nr.id AS next_rank_id, nr.name AS next_rank, nr.color AS next_color,
            v.months_in_rank, v.next_min_months, v.classes_in_rank, v.next_min_classes, v.next_exam_date,
            (SELECT COUNT(*) FROM rank_requirements q WHERE q.dojo_id = v.dojo_id AND q.rank_id = v.next_rank_id AND q.mandatory = 1) AS req_total,
            (SELECT COUNT(*) FROM rank_requirements q JOIN member_requirement_progress mp
                       ON mp.dojo_id = q.dojo_id AND mp.requirement_id = q.id AND mp.user_id = v.user_id AND mp.status = 'approved'
              WHERE q.dojo_id = v.dojo_id AND q.rank_id = v.next_rank_id AND q.mandatory = 1) AS req_approved
       FROM v_member_rank_progress v
       JOIN dojo_members m ON m.dojo_id = v.dojo_id AND m.user_id = v.user_id AND m.status = 'active'
       JOIN user_profiles p ON p.user_id = v.user_id
       JOIN disciplines d ON d.dojo_id = v.dojo_id AND d.id = v.discipline_id
       JOIN ranks r ON r.dojo_id = v.dojo_id AND r.id = v.current_rank_id
       JOIN ranks nr ON nr.dojo_id = v.dojo_id AND nr.id = v.next_rank_id
      WHERE v.dojo_id = :dojoId ${q.discipline_id ? 'AND v.discipline_id = :disc' : ''}
        AND (v.next_min_months IS NULL OR v.months_in_rank >= v.next_min_months * :near)
        AND (v.next_min_classes IS NULL OR v.classes_in_rank >= v.next_min_classes * :near)
      ORDER BY d.name, r.level DESC, p.first_name`, { disc: q.discipline_id, near });

  res.json({
    status: 'success',
    data: rows.map((r) => ({
      ...r,
      eligible: (!r.next_min_months || r.months_in_rank >= r.next_min_months)
        && (!r.next_min_classes || r.classes_in_rank >= r.next_min_classes)
        && r.req_approved >= r.req_total,
    })),
  });
});

module.exports = router;
