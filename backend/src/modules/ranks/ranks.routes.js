/**
 * /api/v2/ranks — estructura de grados del dojo: rutas (tracks), grados y temario.
 * Lectura: cualquier miembro. Escritura: admin.
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest, conflict, forbidden } = require('../../utils/errors');
const templates = require('./templates.service');
const { auditReq } = require('../../utils/audit');
const { buildSet } = require('../../utils/sql');

const router = express.Router();
router.use(authenticate, requireDojo);

const id = z.coerce.number().int().positive();
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color #RRGGBB');
const smallInt = z.coerce.number().int().min(0).max(32000);

// ---------------------------------------------------------------------------
// Estructura completa: disciplinas → tracks → grados (para pantallas de grados)
// ---------------------------------------------------------------------------
router.get('/structure', validate({ query: z.object({ discipline_id: id.optional(), include_inactive: z.stringbool().optional() }) }), async (req, res) => {
  const { discipline_id: disc, include_inactive: all } = req.valid.query;
  const params = disc ? { disc } : {};
  const fd = disc ? 'AND d.id = :disc' : '';
  const act = all ? '' : 'AND x.active = 1';

  const disciplines = await req.tdb.query(
    `SELECT d.id, d.name, d.style, d.color, d.active FROM disciplines d
      WHERE d.dojo_id = :dojoId ${fd} ${all ? '' : 'AND d.active = 1'} ORDER BY d.sort_order, d.name`, params);
  const tracks = await req.tdb.query(
    `SELECT x.id, x.discipline_id, x.name, x.min_age, x.max_age, x.display_style, x.sort_order, x.active
       FROM rank_tracks x JOIN disciplines d ON d.dojo_id = x.dojo_id AND d.id = x.discipline_id
      WHERE x.dojo_id = :dojoId ${fd} ${act} ORDER BY x.sort_order, x.name`, params);
  const ranks = await req.tdb.query(
    `SELECT x.id, x.discipline_id, x.track_id, x.name, x.short_name, x.level, x.kind, x.color, x.stripe_color,
            x.max_stripes, x.min_months, x.min_classes, x.min_age, x.requires_exam, x.exam_fee, x.description, x.active,
            (SELECT COUNT(*) FROM rank_requirements q WHERE q.dojo_id = x.dojo_id AND q.rank_id = x.id) AS requirements_count,
            (SELECT COUNT(*) FROM member_ranks mr WHERE mr.dojo_id = x.dojo_id AND mr.rank_id = x.id) AS students_count
       FROM ranks x JOIN disciplines d ON d.dojo_id = x.dojo_id AND d.id = x.discipline_id
      WHERE x.dojo_id = :dojoId ${fd} ${act} ORDER BY x.track_id, x.level`, params);

  const data = disciplines.map((d) => ({
    ...d,
    tracks: tracks.filter((t) => t.discipline_id === d.id).map((t) => ({
      ...t, ranks: ranks.filter((r) => r.track_id === t.id),
    })),
  }));
  res.json({ status: 'success', data });
});

// ---------------------------------------------------------------------------
// Plantillas precargadas (kendo, judo, BJJ…): ver templates.js
// ---------------------------------------------------------------------------
router.get('/templates', async (req, res) => {
  res.json({ status: 'success', data: await templates.list({ activeOnly: true }) });
});

// Solo el superadmin: guarda la estructura de una disciplina de este dojo como plantilla de la plataforma
router.post('/disciplines/:id/save-as-template', validate({
  params: z.object({ id }),
  body: z.object({ name: z.string().trim().min(1).max(150).optional(), style: z.string().trim().max(150).nullish() }),
}), async (req, res) => {
  if (!req.auth.isSuperadmin) throw forbidden('Solo el administrador de la plataforma crea plantillas');
  const base = await templates.fromDiscipline(req.tdb, req.valid.params.id);
  const b = req.valid.body;
  const tpl = await templates.create({
    ...base, name: b.name ?? base.name, style: b.style === undefined ? base.style : b.style,
    org: null, source: 'Creada desde la estructura de un dojo', notes: [],
  }, req.auth.userId);
  res.status(201).json({ status: 'success', data: tpl });
});

// Crea una disciplina nueva (o agrega rutas a una existente) a partir de una plantilla.
// body: { name?, style?, discipline_id?, tracks?: [nombres de ruta a incluir] }
router.post('/templates/:key/apply', requireRole('admin'), validate({
  params: z.object({ key: z.string().trim().min(1).max(60) }),
  body: z.object({
    name: z.string().trim().min(1).max(150).optional(),
    style: z.string().trim().max(150).nullish(),
    discipline_id: id.optional(),
    tracks: z.array(z.string().trim().min(1).max(100)).min(1).optional(),
  }),
}), async (req, res) => {
  const tpl = await templates.get(req.valid.params.key);
  if (!tpl || !tpl.active) throw notFound('Plantilla no encontrada');
  const b = req.valid.body;
  const tracks = b.tracks ? tpl.tracks.filter((t) => b.tracks.includes(t.name)) : tpl.tracks;
  if (!tracks.length) throw badRequest('Elige al menos un programa de la plantilla');

  const result = await req.tdb.transaction(async (t) => {
    let disciplineId = b.discipline_id;
    let sort = 0;
    if (disciplineId) {
      const d = await t.one('SELECT id FROM disciplines WHERE dojo_id = :dojoId AND id = :id FOR UPDATE', { id: disciplineId });
      if (!d) throw notFound('Disciplina no encontrada');
      const [{ s }] = await t.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS s FROM rank_tracks WHERE dojo_id = :dojoId AND discipline_id = :id', { id: disciplineId });
      sort = Number(s);
    } else {
      const name = b.name ?? tpl.name;
      const dup = await t.one('SELECT id FROM disciplines WHERE dojo_id = :dojoId AND name = :name', { name });
      if (dup) throw conflict(`Ya existe una disciplina llamada "${name}". Elige otro nombre o agrega los programas a esa disciplina.`);
      const [{ s }] = await t.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS s FROM disciplines WHERE dojo_id = :dojoId');
      const r = await t.query(
        'INSERT INTO disciplines (dojo_id, name, style, sort_order) VALUES (:dojoId, :name, :style, :sort)',
        { name, style: b.style === undefined ? tpl.style : b.style, sort: Number(s) });
      disciplineId = r.insertId;
    }

    let rankCount = 0;
    for (const [i, tr] of tracks.entries()) {
      const rt = await t.query(
        `INSERT INTO rank_tracks (dojo_id, discipline_id, name, min_age, max_age, display_style, sort_order)
         VALUES (:dojoId, :disc, :name, :min, :max, :style, :sort)`,
        { disc: disciplineId, name: tr.name, min: tr.min_age ?? null, max: tr.max_age ?? null, style: tr.display_style, sort: sort + i });
      for (const [lv, r] of tr.ranks.entries()) {
        await t.query(
          `INSERT INTO ranks (dojo_id, discipline_id, track_id, level, name, short_name, kind, color, stripe_color,
                              max_stripes, min_months, min_classes, min_age, requires_exam)
           VALUES (:dojoId, :disc, :tr, :lv, :name, :short, :kind, :color, :stripe, :maxs, :mm, :mc, :ma, :exam)`,
          { disc: disciplineId, tr: rt.insertId, lv: lv + 1, name: r.name, short: r.short_name, kind: r.kind, color: r.color,
            stripe: r.stripe_color, maxs: r.max_stripes, mm: r.min_months, mc: r.min_classes, ma: r.min_age, exam: Number(r.requires_exam) });
        rankCount += 1;
      }
    }
    await auditReq(req, t.executor, { action: 'create', entity: 'discipline', entityId: disciplineId,
      after: { template: tpl.key, tracks: tracks.map((x) => x.name), ranks: rankCount } });
    return { discipline_id: disciplineId, tracks: tracks.length, ranks: rankCount };
  });
  res.status(201).json({ status: 'success', data: result });
});

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------
const trackSchema = z.object({
  discipline_id: id,
  name: z.string().trim().min(1).max(100),
  min_age: z.coerce.number().int().min(0).max(120).nullish(),
  max_age: z.coerce.number().int().min(0).max(120).nullish(),
  display_style: z.enum(['rank', 'belt']).optional(), // rank = por grado (default), belt = por color de cinta
  sort_order: smallInt.optional(),
});

router.post('/tracks', requireRole('admin'), validate({ body: trackSchema }), async (req, res) => {
  const b = req.valid.body;
  const r = await req.tdb.query(
    `INSERT INTO rank_tracks (dojo_id, discipline_id, name, min_age, max_age, display_style, sort_order)
     VALUES (:dojoId, :disc, :name, :min, :max, :style, :sort)`,
    { disc: b.discipline_id, name: b.name, min: b.min_age ?? null, max: b.max_age ?? null, style: b.display_style ?? 'rank', sort: b.sort_order ?? 0 });
  await auditReq(req, req.tdb.executor, { action: 'create', entity: 'rank_track', entityId: r.insertId, after: b });
  res.status(201).json({ status: 'success', data: { id: r.insertId, ...b } });
});

router.patch('/tracks/:id', requireRole('admin'), validate({
  params: z.object({ id }),
  body: trackSchema.omit({ discipline_id: true }).partial().extend({ active: z.boolean().optional() })
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, { name: 'name', min_age: 'min_age', max_age: 'max_age', display_style: 'display_style', sort_order: 'sort_order', active: 'active' });
  const r = await req.tdb.query(`UPDATE rank_tracks SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Ruta de grados no encontrada');
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'rank_track', entityId: req.valid.params.id, after: req.valid.body });
  res.json({ status: 'success' });
});

// ---------------------------------------------------------------------------
// Grados
// ---------------------------------------------------------------------------
const rankFields = {
  name: z.string().trim().min(1).max(100),
  short_name: z.string().trim().max(30).nullish(),
  kind: z.enum(['kyu', 'dan', 'belt', 'other']).optional(),
  color: hex.optional(),
  stripe_color: hex.nullish(),
  max_stripes: z.coerce.number().int().min(0).max(10).optional(),
  min_months: smallInt.nullish(),
  min_classes: smallInt.nullish(),
  min_age: z.coerce.number().int().min(0).max(120).nullish(),
  requires_exam: z.boolean().optional(),
  exam_fee: z.coerce.number().min(0).max(1e7).nullish(),
  description: z.string().trim().max(5000).nullish(),
};
const RANK_COLS = Object.fromEntries(Object.keys(rankFields).map((k) => [k, k]));

async function getRank(tdb, rankId) {
  return tdb.one(
    `SELECT id, discipline_id, track_id, name, short_name, level, kind, color, stripe_color, max_stripes,
            min_months, min_classes, min_age, requires_exam, exam_fee, description, active
       FROM ranks WHERE dojo_id = :dojoId AND id = :rankId`, { rankId });
}

router.get('/', validate({ query: z.object({ discipline_id: id.optional(), track_id: id.optional() }) }), async (req, res) => {
  const q = req.valid.query;
  const rows = await req.tdb.query(
    `SELECT r.id, r.discipline_id, d.name AS discipline, r.track_id, t.name AS track, r.name, r.short_name, r.level,
            r.kind, r.color, r.stripe_color, r.max_stripes, r.min_months, r.min_classes, r.min_age,
            r.requires_exam, r.exam_fee, r.active, t.display_style
       FROM ranks r
       JOIN disciplines d ON d.dojo_id = r.dojo_id AND d.id = r.discipline_id
       JOIN rank_tracks t ON t.dojo_id = r.dojo_id AND t.id = r.track_id
      WHERE r.dojo_id = :dojoId AND r.active = 1
        ${q.discipline_id ? 'AND r.discipline_id = :disc' : ''} ${q.track_id ? 'AND r.track_id = :track' : ''}
      ORDER BY d.sort_order, d.name, t.sort_order, r.level`,
    { disc: q.discipline_id, track: q.track_id });
  res.json({ status: 'success', data: rows });
});

router.get('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  const rank = await getRank(req.tdb, req.valid.params.id);
  if (!rank) throw notFound('Grado no encontrado');
  const requirements = await req.tdb.query(
    `SELECT id, category, name, description, video_url, sort_order, mandatory
       FROM rank_requirements WHERE dojo_id = :dojoId AND rank_id = :id ORDER BY sort_order, id`, { id: rank.id });
  res.json({ status: 'success', data: { ...rank, requirements } });
});

router.post('/', requireRole('admin'), validate({
  body: z.object({ ...rankFields, track_id: id, level: z.coerce.number().int().min(1).max(999).optional() }),
}), async (req, res) => {
  const b = req.valid.body;
  const created = await req.tdb.transaction(async (t) => {
    const track = await t.one('SELECT id, discipline_id FROM rank_tracks WHERE dojo_id = :dojoId AND id = :id FOR UPDATE', { id: b.track_id });
    if (!track) throw badRequest('Ruta de grados no válida');
    const [{ maxLevel }] = await t.query('SELECT COALESCE(MAX(level), 0) AS maxLevel FROM ranks WHERE dojo_id = :dojoId AND track_id = :tr', { tr: track.id });
    let level = b.level ?? maxLevel + 1;
    if (level <= maxLevel) {
      // Insertar en medio: recorre los siguientes (en dos pasos por la llave única)
      await t.query('UPDATE ranks SET level = level + 10000 WHERE dojo_id = :dojoId AND track_id = :tr AND level >= :lv', { tr: track.id, lv: level });
      await t.query('UPDATE ranks SET level = level - 9999 WHERE dojo_id = :dojoId AND track_id = :tr AND level >= 10000', { tr: track.id });
    } else level = maxLevel + 1;

    const cols = Object.keys(RANK_COLS).filter((k) => b[k] !== undefined);
    const r = await t.query(
      `INSERT INTO ranks (dojo_id, discipline_id, track_id, level ${cols.map((c) => `, \`${c}\``).join('')})
       VALUES (:dojoId, :disc, :tr, :level ${cols.map((c) => `, :${c}`).join('')})`,
      { disc: track.discipline_id, tr: track.id, level, ...Object.fromEntries(cols.map((c) => [c, typeof b[c] === 'boolean' ? Number(b[c]) : b[c]])) });
    await auditReq(req, t.executor, { action: 'create', entity: 'rank', entityId: r.insertId, after: b });
    return getRank(t, r.insertId);
  });
  res.status(201).json({ status: 'success', data: created });
});

router.patch('/:id', requireRole('admin'), validate({
  params: z.object({ id }),
  body: z.object(Object.fromEntries(Object.entries(rankFields).map(([k, v]) => [k, v.optional()])))
    .extend({ active: z.boolean().optional() })
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, { ...RANK_COLS, active: 'active' });
  const before = await getRank(req.tdb, req.valid.params.id);
  if (!before) throw notFound('Grado no encontrado');
  await req.tdb.query(`UPDATE ranks SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: before.id });
  const after = await getRank(req.tdb, before.id);
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'rank', entityId: before.id, before, after });
  res.json({ status: 'success', data: after });
});

// Reordenar los grados de una ruta: { track_id, rank_ids: [en orden] }
router.post('/reorder', requireRole('admin'), validate({
  body: z.object({ track_id: id, rank_ids: z.array(id).min(1) }),
}), async (req, res) => {
  const { track_id: tr, rank_ids: ids } = req.valid.body;
  await req.tdb.transaction(async (t) => {
    const current = await t.query('SELECT id FROM ranks WHERE dojo_id = :dojoId AND track_id = :tr FOR UPDATE', { tr });
    const set = new Set(current.map((r) => r.id));
    if (ids.length !== set.size || !ids.every((x) => set.has(x))) throw badRequest('La lista debe incluir exactamente los grados de esa ruta');
    await t.query('UPDATE ranks SET level = level + 10000 WHERE dojo_id = :dojoId AND track_id = :tr', { tr });
    for (const [i, rankId] of ids.entries()) {
      await t.query('UPDATE ranks SET level = :lv WHERE dojo_id = :dojoId AND id = :rankId', { lv: i + 1, rankId });
    }
    await auditReq(req, t.executor, { action: 'reorder', entity: 'rank_track', entityId: tr, after: ids });
  });
  res.json({ status: 'success' });
});

// Desactivar (los alumnos con ese grado lo conservan en su historial)
router.delete('/:id', requireRole('admin'), validate({ params: z.object({ id }) }), async (req, res) => {
  const r = await req.tdb.query('UPDATE ranks SET active = 0 WHERE dojo_id = :dojoId AND id = :id', { id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Grado no encontrado');
  await auditReq(req, req.tdb.executor, { action: 'deactivate', entity: 'rank', entityId: req.valid.params.id });
  res.json({ status: 'success' });
});

// ---------------------------------------------------------------------------
// Temario
// ---------------------------------------------------------------------------
const reqFields = {
  category: z.enum(['technique', 'kata', 'sparring', 'theory', 'conduct', 'other']).optional(),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(5000).nullish(),
  video_url: z.url().max(500).nullish(),
  sort_order: smallInt.optional(),
  mandatory: z.boolean().optional(),
};
const REQ_COLS = Object.fromEntries(Object.keys(reqFields).map((k) => [k, k]));

router.post('/:id/requirements', requireRole('admin', 'instructor'), validate({ params: z.object({ id }), body: z.object(reqFields) }), async (req, res) => {
  const rank = await getRank(req.tdb, req.valid.params.id);
  if (!rank) throw notFound('Grado no encontrado');
  const b = req.valid.body;
  const r = await req.tdb.query(
    `INSERT INTO rank_requirements (dojo_id, rank_id, category, name, description, video_url, sort_order, mandatory)
     VALUES (:dojoId, :rank, :cat, :name, :desc, :video, :sort, :mand)`,
    { rank: rank.id, cat: b.category ?? 'technique', name: b.name, desc: b.description ?? null, video: b.video_url ?? null,
      sort: b.sort_order ?? 0, mand: b.mandatory === false ? 0 : 1 });
  res.status(201).json({ status: 'success', data: { id: r.insertId, rank_id: rank.id, ...b } });
});

router.patch('/requirements/:reqId', requireRole('admin', 'instructor'), validate({
  params: z.object({ reqId: id }),
  body: z.object(Object.fromEntries(Object.entries(reqFields).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, REQ_COLS);
  const r = await req.tdb.query(`UPDATE rank_requirements SET ${set.sql} WHERE dojo_id = :dojoId AND id = :reqId`,
    { ...set.params, reqId: req.valid.params.reqId });
  if (r.affectedRows === 0) throw notFound('Requisito no encontrado');
  res.json({ status: 'success' });
});

router.delete('/requirements/:reqId', requireRole('admin', 'instructor'), validate({ params: z.object({ reqId: id }) }), async (req, res) => {
  const r = await req.tdb.query('DELETE FROM rank_requirements WHERE dojo_id = :dojoId AND id = :reqId', { reqId: req.valid.params.reqId });
  if (r.affectedRows === 0) throw notFound('Requisito no encontrado');
  res.json({ status: 'success' });
});

module.exports = router;
