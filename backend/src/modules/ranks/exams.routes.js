/**
 * /api/v2/exams — eventos de examen, candidatos y resultados.
 * Aprobar a un candidato lo promueve automáticamente (con historial ligado al examen).
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest, conflict } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { buildSet } = require('../../utils/sql');
const { actingUser } = require('../../utils/acting');
const { getDojo } = require('../../utils/dojo');
const { addDays } = require('../../utils/dates');
const { applyRankChange } = require('./progress.service');
const { createCharge } = require('../billing/charges.service');

const router = express.Router();
router.use(authenticate, requireDojo);

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const STAFF = ['admin', 'instructor'];

const examFields = {
  discipline_id: id,
  title: z.string().trim().min(1).max(150),
  exam_date: date,
  start_time: time.nullish(),
  location_id: id.nullish(),
  examiner_name: z.string().trim().max(150).nullish(),
  examiner_user_id: id.nullish(),
  registration_deadline: date.nullish(),
  status: z.enum(['planned', 'open', 'closed', 'completed', 'cancelled']).optional(),
  notes: z.string().trim().max(5000).nullish(),
};
const COLS = Object.fromEntries(Object.keys(examFields).map((k) => [k, k]));

async function loadExam(tdb, examId) {
  const exam = await tdb.one(
    `SELECT e.*, d.name AS discipline,
            (SELECT COUNT(*) FROM exam_candidates c WHERE c.dojo_id = e.dojo_id AND c.exam_id = e.id) AS candidates_count
       FROM exams e JOIN disciplines d ON d.dojo_id = e.dojo_id AND d.id = e.discipline_id
      WHERE e.dojo_id = :dojoId AND e.id = :examId`, { examId });
  if (!exam) return null;
  delete exam.dojo_id;
  exam.candidates = await tdb.query(
    `SELECT c.id, c.user_id, p.first_name, p.last_name, p.photo_url, c.status, c.score, c.feedback,
            c.from_rank_id, fr.name AS from_rank, fr.color AS from_color,
            c.target_rank_id, tr.name AS target_rank, tr.color AS target_color,
            c.charge_id, ch.status AS fee_status, c.result_at
       FROM exam_candidates c
       JOIN user_profiles p ON p.user_id = c.user_id
       LEFT JOIN ranks fr ON fr.dojo_id = c.dojo_id AND fr.id = c.from_rank_id
       JOIN ranks tr ON tr.dojo_id = c.dojo_id AND tr.id = c.target_rank_id
       LEFT JOIN charges ch ON ch.dojo_id = c.dojo_id AND ch.id = c.charge_id
      WHERE c.dojo_id = :dojoId AND c.exam_id = :examId
      ORDER BY tr.level, p.first_name`, { examId });
  return exam;
}

router.get('/', requireRole(...STAFF, 'staff'), validate({
  query: z.object({ status: z.enum(['planned', 'open', 'closed', 'completed', 'cancelled', 'upcoming']).optional(), discipline_id: id.optional() }),
}), async (req, res) => {
  const q = req.valid.query;
  const where = ['e.dojo_id = :dojoId'];
  if (q.status === 'upcoming') where.push("e.status IN ('planned','open','closed') AND e.exam_date >= CURDATE() - INTERVAL 1 DAY");
  else if (q.status) where.push('e.status = :status');
  if (q.discipline_id) where.push('e.discipline_id = :disc');
  const rows = await req.tdb.query(
    `SELECT e.id, e.title, e.discipline_id, d.name AS discipline, e.exam_date, e.start_time, e.status, e.examiner_name,
            (SELECT COUNT(*) FROM exam_candidates c WHERE c.dojo_id = e.dojo_id AND c.exam_id = e.id) AS candidates_count,
            (SELECT COUNT(*) FROM exam_candidates c WHERE c.dojo_id = e.dojo_id AND c.exam_id = e.id AND c.status = 'passed') AS passed_count
       FROM exams e JOIN disciplines d ON d.dojo_id = e.dojo_id AND d.id = e.discipline_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.exam_date DESC`, { status: q.status, disc: q.discipline_id });
  res.json({ status: 'success', data: rows });
});

// Exámenes del alumno (o de su menor)
router.get('/mine', validate({ query: z.object({ user_id: id.optional() }) }), async (req, res) => {
  const uid = await actingUser(req, req.valid.query.user_id, { staffRoles: STAFF });
  const rows = await req.tdb.query(
    `SELECT e.id AS exam_id, e.title, e.exam_date, e.start_time, e.status AS exam_status, d.name AS discipline,
            c.id AS candidate_id, c.status, c.score, c.feedback, tr.name AS target_rank, tr.color AS target_color,
            c.charge_id, ch.status AS fee_status, ch.total AS fee
       FROM exam_candidates c
       JOIN exams e ON e.dojo_id = c.dojo_id AND e.id = c.exam_id
       JOIN disciplines d ON d.dojo_id = e.dojo_id AND d.id = e.discipline_id
       JOIN ranks tr ON tr.dojo_id = c.dojo_id AND tr.id = c.target_rank_id
       LEFT JOIN charges ch ON ch.dojo_id = c.dojo_id AND ch.id = c.charge_id
      WHERE c.dojo_id = :dojoId AND c.user_id = :uid
      ORDER BY e.exam_date DESC`, { uid });
  res.json({ status: 'success', data: rows });
});

router.get('/:id', requireRole(...STAFF, 'staff'), validate({ params: z.object({ id }) }), async (req, res) => {
  const exam = await loadExam(req.tdb, req.valid.params.id);
  if (!exam) throw notFound('Examen no encontrado');
  res.json({ status: 'success', data: exam });
});

router.post('/', requireRole(...STAFF), validate({ body: z.object(examFields) }), async (req, res) => {
  const b = req.valid.body;
  const cols = Object.keys(COLS).filter((k) => b[k] !== undefined);
  const r = await req.tdb.query(
    `INSERT INTO exams (dojo_id, created_by, ${cols.map((c) => `\`${c}\``).join(', ')})
     VALUES (:dojoId, :by, ${cols.map((c) => `:${c}`).join(', ')})`,
    { by: req.auth.userId, ...Object.fromEntries(cols.map((c) => [c, b[c]])) });
  await auditReq(req, req.tdb.executor, { action: 'create', entity: 'exam', entityId: r.insertId, after: b });
  res.status(201).json({ status: 'success', data: await loadExam(req.tdb, r.insertId) });
});

router.patch('/:id', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object(Object.fromEntries(Object.entries(examFields).filter(([k]) => k !== 'discipline_id').map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, COLS);
  const r = await req.tdb.query(`UPDATE exams SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Examen no encontrado');
  res.json({ status: 'success', data: await loadExam(req.tdb, req.valid.params.id) });
});

/**
 * POST /exams/:id/candidates { user_ids: [], charge_fee: true }
 * El grado objetivo es el siguiente de su ruta (o target_rank_id explícito).
 * Si el grado tiene cuota de examen y charge_fee, se genera el cargo.
 */
router.post('/:id/candidates', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object({
    user_ids: z.array(id).min(1).max(200),
    target_rank_id: id.optional(),
    charge_fee: z.boolean().default(true),
    fee_due_date: date.optional(),
  }),
}), async (req, res) => {
  const examId = req.valid.params.id;
  const b = req.valid.body;
  const dojo = await getDojo(req);

  const summary = await req.tdb.transaction(async (t) => {
    const exam = await t.one('SELECT id, discipline_id, title, exam_date, status FROM exams WHERE dojo_id = :dojoId AND id = :examId FOR UPDATE', { examId });
    if (!exam) throw notFound('Examen no encontrado');
    if (['completed', 'cancelled'].includes(exam.status)) throw conflict('El examen ya está cerrado', 'EXAM_CLOSED');

    const added = []; const skipped = [];
    for (const uid of b.user_ids) {
      const cur = await t.one(
        `SELECT mr.rank_id, r.track_id, r.level FROM member_ranks mr JOIN ranks r ON r.dojo_id = mr.dojo_id AND r.id = mr.rank_id
          WHERE mr.dojo_id = :dojoId AND mr.user_id = :uid AND mr.discipline_id = :disc`, { uid, disc: exam.discipline_id });
      let target;
      if (b.target_rank_id) {
        target = await t.one('SELECT id, name, exam_fee FROM ranks WHERE dojo_id = :dojoId AND id = :r AND discipline_id = :disc AND active = 1',
          { r: b.target_rank_id, disc: exam.discipline_id });
      } else if (cur) {
        target = await t.one(
          `SELECT id, name, exam_fee FROM ranks WHERE dojo_id = :dojoId AND track_id = :tr AND level > :lv AND active = 1
            ORDER BY level LIMIT 1`, { tr: cur.track_id, lv: cur.level });
      }
      if (!target) { skipped.push({ user_id: uid, reason: cur ? 'Ya tiene el grado máximo' : 'Sin grado en la disciplina; indica target_rank_id' }); continue; }

      const member = await t.one(`SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :uid AND status = 'active'`, { uid });
      if (!member) { skipped.push({ user_id: uid, reason: 'No es miembro activo' }); continue; }

      const exists = await t.one('SELECT id FROM exam_candidates WHERE dojo_id = :dojoId AND exam_id = :examId AND user_id = :uid', { examId, uid });
      if (exists) { skipped.push({ user_id: uid, reason: 'Ya está inscrito' }); continue; }

      let chargeId = null;
      if (b.charge_fee && target.exam_fee > 0) {
        chargeId = await createCharge(t, {
          user_id: uid, type: 'exam_fee', description: `Examen ${target.name} · ${exam.title}`,
          amount: target.exam_fee, currency: dojo.currency,
          due_date: b.fee_due_date ?? addDays(exam.exam_date, -1), created_by: req.auth.userId,
        });
      }
      const r = await t.query(
        `INSERT INTO exam_candidates (dojo_id, exam_id, user_id, from_rank_id, target_rank_id, status, charge_id)
         VALUES (:dojoId, :examId, :uid, :from, :to, 'registered', :charge)`,
        { examId, uid, from: cur?.rank_id ?? null, to: target.id, charge: chargeId });
      added.push({ candidate_id: r.insertId, user_id: uid, target_rank: target.name, charge_id: chargeId });
    }
    await auditReq(req, t.executor, { action: 'add_candidates', entity: 'exam', entityId: examId, after: added });
    return { added, skipped };
  });
  res.status(201).json({ status: 'success', data: summary });
});

/**
 * PUT /exams/:id/candidates/:candidateId — resultado.
 * passed → promoción automática al grado objetivo (fecha = fecha del examen).
 */
router.put('/:id/candidates/:candidateId', requireRole(...STAFF), validate({
  params: z.object({ id, candidateId: id }),
  body: z.object({
    status: z.enum(['registered', 'passed', 'failed', 'absent', 'withdrawn']),
    score: z.coerce.number().min(0).max(100).nullish(),
    feedback: z.string().trim().max(2000).nullish(),
    certificate_number: z.string().trim().max(50).nullish(),
  }),
}), async (req, res) => {
  const { id: examId, candidateId } = req.valid.params;
  const b = req.valid.body;
  const out = await req.tdb.transaction(async (t) => {
    const c = await t.one(
      `SELECT c.id, c.user_id, c.status, c.target_rank_id, e.exam_date, e.discipline_id
         FROM exam_candidates c JOIN exams e ON e.dojo_id = c.dojo_id AND e.id = c.exam_id
        WHERE c.dojo_id = :dojoId AND c.id = :candidateId AND c.exam_id = :examId FOR UPDATE`, { candidateId, examId });
    if (!c) throw notFound('Candidato no encontrado');
    if (c.status === 'passed' && b.status !== 'passed') {
      throw conflict('Ya fue promovido. Para revertir, registra una corrección de grado.', 'ALREADY_PROMOTED');
    }

    await t.query(
      `UPDATE exam_candidates SET status = :status, score = :score, feedback = :feedback, result_by = :by, result_at = NOW()
        WHERE dojo_id = :dojoId AND id = :candidateId`,
      { status: b.status, score: b.score ?? null, feedback: b.feedback ?? null, by: req.auth.userId, candidateId });

    if (b.status === 'passed' && c.status !== 'passed') {
      await applyRankChange(t, {
        userId: c.user_id, disciplineId: c.discipline_id, rankId: c.target_rank_id, stripes: 0, eventType: 'promotion',
        awardedDate: c.exam_date, score: b.score, certificateNumber: b.certificate_number,
        examCandidateId: c.id, awardedBy: req.auth.userId,
      });
    }
    await auditReq(req, t.executor, { action: 'exam_result', entity: 'exam_candidate', entityId: c.id, before: { status: c.status }, after: b });
    const target = await t.one('SELECT name FROM ranks WHERE dojo_id = :dojoId AND id = :r', { r: c.target_rank_id });
    return { candidate_id: c.id, user_id: c.user_id, rank: target.name, status: b.status, promoted: b.status === 'passed' && c.status !== 'passed' };
  });
  if (out.promoted) req.app.emit('rank_changed', { dojoId: req.auth.dojoId, userId: out.user_id, rank: out.rank, eventType: 'promotion' });
  res.json({ status: 'success', data: out });
});

router.delete('/:id/candidates/:candidateId', requireRole(...STAFF), validate({ params: z.object({ id, candidateId: id }) }), async (req, res) => {
  const { id: examId, candidateId } = req.valid.params;
  await req.tdb.transaction(async (t) => {
    const c = await t.one('SELECT id, status, charge_id FROM exam_candidates WHERE dojo_id = :dojoId AND id = :candidateId AND exam_id = :examId FOR UPDATE', { candidateId, examId });
    if (!c) throw notFound('Candidato no encontrado');
    if (c.status === 'passed') throw conflict('No se puede quitar a un candidato aprobado', 'ALREADY_PROMOTED');
    await t.query('DELETE FROM exam_candidates WHERE dojo_id = :dojoId AND id = :candidateId', { candidateId });
    if (c.charge_id) {
      // Anula la cuota si no se ha pagado nada
      await t.query(`UPDATE charges SET status = 'void', voided_reason = 'Baja del examen'
                      WHERE dojo_id = :dojoId AND id = :ch AND amount_paid = 0 AND status = 'pending'`, { ch: c.charge_id });
    }
  });
  res.json({ status: 'success' });
});

module.exports = router;
