/**
 * Límites del plan de BudoDesk de cada dojo (lo que el dojo le paga a BudoDesk; no confundir
 * con los planes de membresía que el dojo vende a sus alumnos, modules/plans).
 *
 * Los límites de cada plan están en saas_plans (Plataforma → Planes) y un dojo puede tener
 * excepciones propias (dojos.limit_*; NULL = lo del plan; 0 en alumnos/sedes = sin límite).
 * La prueba gratis usa los límites de Pro (más las excepciones del dojo, si tiene).
 *
 * Si un dojo baja de plan conserva todo lo que ya tiene: nada se borra ni se oculta, solo
 * no puede agregar más mientras exceda el límite. Las finanzas se ven de nuevo al volver.
 */
const { pool, one } = require('../db/pool');
const { AppError, badRequest, notFound } = require('../utils/errors');

// Por si la tabla aún no existe (antes de la migración 0004)
const DEFAULTS = {
  basic: { code: 'basic', name: 'Básico', max_students: 50, max_locations: 1, finance: 0 },
  pro: { code: 'pro', name: 'Pro', max_students: null, max_locations: null, finance: 1 },
};
const PLAN_CODES = ['basic', 'pro'];

/** Plan que aplica: la prueba es como Pro; un 'trial' que quedó activo, también */
function effectivePlan(d) {
  if (!d || d.status === 'trial') return 'pro';
  return d.plan === 'basic' ? 'basic' : 'pro';
}

async function listPlans(executor = pool) {
  try {
    const [rows] = await executor.query(
      `SELECT p.code, p.name, p.max_students, p.max_locations, p.finance, p.updated_at,
              (SELECT COUNT(*) FROM dojos d WHERE d.plan = p.code AND d.status IN ('active','expired')) AS dojos
         FROM saas_plans p ORDER BY FIELD(p.code, 'basic', 'pro')`);
    return rows.map((r) => ({ ...r, finance: !!r.finance }));
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return Object.values(DEFAULTS).map((p) => ({ ...p, finance: !!p.finance, dojos: null }));
    throw e;
  }
}

async function getPlan(code, executor = pool) {
  return (await listPlans(executor)).find((p) => p.code === code) ?? { ...DEFAULTS[code], finance: !!DEFAULTS[code].finance };
}

async function updatePlan(code, b, actorId) {
  if (!PLAN_CODES.includes(code)) throw notFound('Plan no encontrado');
  const sets = [];
  const p = { code, by: actorId };
  if (b.name !== undefined) { sets.push('name = :name'); p.name = b.name; }
  if (b.max_students !== undefined) { sets.push('max_students = :ms'); p.ms = b.max_students; }
  if (b.max_locations !== undefined) { sets.push('max_locations = :ml'); p.ml = b.max_locations; }
  if (b.finance !== undefined) { sets.push('finance = :fin'); p.fin = b.finance ? 1 : 0; }
  if (!sets.length) throw badRequest('Nada que actualizar');
  await pool.query(`UPDATE saas_plans SET ${sets.join(', ')}, updated_by = :by WHERE code = :code`, p);
  return getPlan(code);
}

/** Límites que aplican a un dojo: los de su plan efectivo, con sus excepciones encima */
function limitsFor(plan, d) {
  const pick = (override, base) => (override == null ? base : override === 0 ? null : override);
  return {
    students: pick(d?.limit_students, plan.max_students),
    locations: pick(d?.limit_locations, plan.max_locations),
    finance: d?.limit_finance == null ? !!plan.finance : !!d.limit_finance,
  };
}

async function planOf(dojoId, executor = pool) {
  let d;
  try {
    d = await one(executor, 'SELECT plan, status, limit_students, limit_locations, limit_finance FROM dojos WHERE id = :id', { id: dojoId });
  } catch (e) {
    if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    d = await one(executor, 'SELECT plan, status FROM dojos WHERE id = :id', { id: dojoId });
  }
  const effective = effectivePlan(d);
  const plan = await getPlan(effective, executor);
  const custom = !!d && [d.limit_students, d.limit_locations, d.limit_finance].some((v) => v != null);
  return { plan: d?.plan ?? null, status: d?.status ?? null, effective, plan_name: plan.name, custom, limits: limitsFor(plan, d) };
}

const STUDENTS_SQL = `SELECT COUNT(*) AS n FROM dojo_members m
   WHERE m.dojo_id = :d AND m.status = 'active'
     AND EXISTS (SELECT 1 FROM dojo_member_roles r WHERE r.dojo_id = m.dojo_id AND r.user_id = m.user_id AND r.role = 'student')`;

async function usage(dojoId, executor = pool) {
  const [[s]] = await executor.query(STUDENTS_SQL, { d: dojoId });
  const [[l]] = await executor.query('SELECT COUNT(*) AS n FROM dojo_locations WHERE dojo_id = :d AND active = 1', { d: dojoId });
  return { students: s.n, locations: l.n };
}

/** Todo junto, para la app: { plan, status, effective, plan_name, custom, limits, usage } */
async function summary(dojoId, executor = pool) {
  return { ...(await planOf(dojoId, executor)), usage: await usage(dojoId, executor) };
}

const planError = (feature, message, details) => new AppError(403, 'PLAN_LIMIT', message, { feature, ...details });

/** ¿Cabe(n) n alumno(s) activo(s) más? Si no, lanza PLAN_LIMIT */
async function assertStudents(dojoId, n = 1, executor = pool) {
  const p = await planOf(dojoId, executor);
  if (p.limits.students == null || n <= 0) return;
  const [[s]] = await executor.query(STUDENTS_SQL, { d: dojoId });
  if (s.n + n > p.limits.students) {
    throw planError('students',
      `Tu plan (${p.plan_name}) permite hasta ${p.limits.students} alumnos activos y ya tienes ${s.n}. Cambia de plan para agregar más.`,
      { limit: p.limits.students, current: s.n, plan_name: p.plan_name });
  }
}

/** Igual que assertStudents, pero responde sí/no en lugar de lanzar */
async function canAddStudents(dojoId, n = 1, executor = pool) {
  try { await assertStudents(dojoId, n, executor); return true; } catch (e) { if (e.code === 'PLAN_LIMIT') return false; throw e; }
}

async function assertLocations(dojoId, executor = pool) {
  const p = await planOf(dojoId, executor);
  if (p.limits.locations == null) return;
  const [[l]] = await executor.query('SELECT COUNT(*) AS n FROM dojo_locations WHERE dojo_id = :d AND active = 1', { d: dojoId });
  if (l.n + 1 > p.limits.locations) {
    throw planError('locations',
      `Tu plan (${p.plan_name}) incluye hasta ${p.limits.locations} ${p.limits.locations === 1 ? 'sede activa' : 'sedes activas'}. Cambia de plan para tener más.`,
      { limit: p.limits.locations, current: l.n, plan_name: p.plan_name });
  }
}

/** Middleware: la función depende del plan */
function requireFeature(feature) {
  const NAMES = { finance: 'Las finanzas (gastos e ingresos, por cobrar)' };
  return async (req, _res, next) => {
    try {
      const p = await planOf(req.auth.dojoId);
      if (!p.limits[feature]) {
        return next(planError(feature, `${NAMES[feature] ?? 'Esta función'} no están incluidas en tu plan (${p.plan_name}).`, { plan_name: p.plan_name }));
      }
      return next();
    } catch (e) { return next(e); }
  };
}

module.exports = {
  PLAN_CODES, effectivePlan, listPlans, getPlan, updatePlan, limitsFor, planOf, usage, summary,
  assertStudents, canAddStudents, assertLocations, requireFeature,
};
