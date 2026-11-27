/**
 * Plantillas de grados guardadas en la base (rank_templates).
 * Las precargadas viven en templates.js y se copian a la tabla si faltan (al arrancar o al primer uso).
 */
const { z } = require('zod');
const { pool, one } = require('../../db/pool');

const query = async (ex, sql, params) => (await ex.query(sql, params))[0];
const { notFound, badRequest } = require('../../utils/errors');
const builtin = require('./templates');

const hex = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Color inválido');
const n = (max) => z.number().int().min(0).max(max).nullable().default(null);

const rankSchema = z.object({
  name: z.string().trim().min(1).max(100),
  short_name: z.string().trim().max(20).nullable().default(null),
  kind: z.enum(['kyu', 'dan', 'belt', 'other']).default('belt'),
  color: hex.default('#FFFFFF'),
  stripe_color: hex.nullable().default(null),
  max_stripes: z.number().int().min(0).max(10).default(0),
  min_months: n(600), min_classes: n(5000), min_age: n(99),
  requires_exam: z.boolean().default(true),
});
const trackSchema = z.object({
  name: z.string().trim().min(1).max(100),
  min_age: n(99), max_age: n(99),
  display_style: z.enum(['rank', 'belt']).default('rank'),
  ranks: z.array(rankSchema).min(1).max(60),
});
const templateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  style: z.string().trim().max(150).nullable().default(null),
  org: z.string().trim().max(200).nullable().default(null),
  source: z.string().trim().max(500).nullable().default(null),
  notes: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  tracks: z.array(trackSchema).min(1).max(10),
  active: z.boolean().default(true),
});

function check(data) {
  const r = templateSchema.safeParse(data);
  if (!r.success) {
    throw badRequest('Datos inválidos', r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const shape = (r) => r && ({
  key: r.tkey, name: r.name, style: r.style, org: r.org, source: r.source,
  notes: parse(r.notes) ?? [], tracks: parse(r.tracks) ?? [],
  builtin: !!r.builtin, active: !!r.active, sort_order: r.sort_order, updated_at: r.updated_at,
});

let seeded = null;
/** Copia a la tabla las precargadas que falten. No pisa las que ya existen. */
function ensureBuiltins() {
  if (!seeded) {
    seeded = (async () => {
      const list = builtin.listTemplates();
      for (const [i, t] of list.entries()) {
        await query(pool,
          `INSERT IGNORE INTO rank_templates (tkey, name, style, org, source, notes, tracks, builtin, active, sort_order)
           VALUES (:k, :name, :style, :org, :source, :notes, :tracks, 1, 1, :sort)`,
          { k: t.key, name: t.name, style: t.style, org: t.org, source: t.source,
            notes: JSON.stringify(t.notes), tracks: JSON.stringify(t.tracks), sort: (i + 1) * 10 });
      }
    })().catch((e) => { seeded = null; throw e; });
  }
  return seeded;
}

async function list({ activeOnly = false } = {}) {
  await ensureBuiltins();
  const rows = await query(pool, `SELECT * FROM rank_templates ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, name, tkey`);
  return rows.map(shape);
}

async function get(key) {
  await ensureBuiltins();
  return shape(await one(pool, 'SELECT * FROM rank_templates WHERE tkey = :k', { k: key }));
}

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'plantilla';
}

async function create(data, userId) {
  await ensureBuiltins();
  const t = check(data);
  const base = slugify(`${t.name} ${t.style ?? ''}`);
  let key = base;
  for (let i = 2; await one(pool, 'SELECT tkey FROM rank_templates WHERE tkey = :k', { k: key }); i += 1) key = `${base}-${i}`;
  const [{ s }] = await query(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 10 AS s FROM rank_templates');
  await query(pool,
    `INSERT INTO rank_templates (tkey, name, style, org, source, notes, tracks, builtin, active, sort_order, updated_by)
     VALUES (:k, :name, :style, :org, :source, :notes, :tracks, 0, :active, :sort, :by)`,
    { k: key, ...t, notes: JSON.stringify(t.notes), tracks: JSON.stringify(t.tracks), active: t.active ? 1 : 0, sort: Number(s), by: userId });
  return get(key);
}

async function update(key, data, userId) {
  const cur = await get(key);
  if (!cur) throw notFound('Plantilla no encontrada');
  const t = check({ ...cur, ...data });
  await query(pool,
    `UPDATE rank_templates SET name = :name, style = :style, org = :org, source = :source, notes = :notes,
            tracks = :tracks, active = :active, updated_by = :by WHERE tkey = :k`,
    { k: key, ...t, notes: JSON.stringify(t.notes), tracks: JSON.stringify(t.tracks), active: t.active ? 1 : 0, by: userId });
  return get(key);
}

async function remove(key) {
  const cur = await get(key);
  if (!cur) throw notFound('Plantilla no encontrada');
  if (cur.builtin) throw badRequest('Las plantillas precargadas no se borran: desactívala para que los dojos no la vean.');
  await query(pool, 'DELETE FROM rank_templates WHERE tkey = :k', { k: key });
}

/** Vuelve una precargada a lo que trae el código. */
async function restore(key, userId) {
  const orig = builtin.getTemplate(key);
  if (!orig) throw badRequest('Solo se pueden restaurar las plantillas precargadas');
  const t = builtin.listTemplates().find((x) => x.key === key);
  return update(key, { name: t.name, style: t.style, org: t.org, source: t.source, notes: t.notes, tracks: t.tracks }, userId);
}

/** Arma una plantilla con la estructura de una disciplina del dojo actual. */
async function fromDiscipline(tdb, disciplineId) {
  const d = await tdb.one('SELECT id, name, style FROM disciplines WHERE dojo_id = :dojoId AND id = :id', { id: disciplineId });
  if (!d) throw notFound('Disciplina no encontrada');
  const tracks = await tdb.query(
    `SELECT id, name, min_age, max_age, display_style FROM rank_tracks
      WHERE dojo_id = :dojoId AND discipline_id = :id AND active = 1 ORDER BY sort_order, id`, { id: disciplineId });
  const ranks = await tdb.query(
    `SELECT track_id, name, short_name, kind, color, stripe_color, max_stripes, min_months, min_classes, min_age, requires_exam
       FROM ranks WHERE dojo_id = :dojoId AND discipline_id = :id AND active = 1 ORDER BY level`, { id: disciplineId });
  const out = tracks.map((tr) => ({
    name: tr.name, min_age: tr.min_age, max_age: tr.max_age, display_style: tr.display_style,
    ranks: ranks.filter((r) => Number(r.track_id) === Number(tr.id)).map(({ track_id: _t, ...r }) => ({
      ...r, max_stripes: Number(r.max_stripes) || 0, requires_exam: !!r.requires_exam,
    })),
  })).filter((tr) => tr.ranks.length);
  if (!out.length) throw badRequest('La disciplina no tiene grados activos');
  return { name: d.name, style: d.style, tracks: out };
}

module.exports = { list, get, create, update, remove, restore, fromDiscipline, ensureBuiltins, templateSchema };
