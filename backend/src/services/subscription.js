/**
 * Límites del plan de BudoDesk de cada dojo (lo que el dojo le paga a BudoDesk; no confundir
 * con los planes de membresía que el dojo vende a sus alumnos, modules/plans).
 *
 *   Básico: hasta 50 alumnos activos, 1 sede, sin finanzas (gastos e ingresos, por cobrar)
 *   Pro:    sin límites
 *   Prueba: todo como Pro
 *
 * Si un dojo baja de plan conserva todo lo que ya tiene: nada se borra ni se oculta, solo
 * no puede agregar más mientras exceda el límite. Las finanzas se ven de nuevo al volver a Pro.
 */
const { pool, one } = require('../db/pool');
const { AppError } = require('../utils/errors');

const LIMITS = {
  basic: { students: 50, locations: 1, finance: false },
  pro: { students: null, locations: null, finance: true },
};

/** Plan que aplica: la prueba es como Pro; un 'trial' que quedó activo, también */
function effectivePlan(d) {
  if (!d || d.status === 'trial') return 'pro';
  return d.plan === 'basic' ? 'basic' : 'pro';
}

async function planOf(dojoId, executor = pool) {
  const d = await one(executor, 'SELECT plan, status FROM dojos WHERE id = :id', { id: dojoId });
  const effective = effectivePlan(d);
  return { plan: d?.plan ?? null, status: d?.status ?? null, effective, limits: LIMITS[effective] };
}

const STUDENTS_SQL = `SELECT COUNT(*) AS n FROM dojo_members m
   WHERE m.dojo_id = :d AND m.status = 'active'
     AND EXISTS (SELECT 1 FROM dojo_member_roles r WHERE r.dojo_id = m.dojo_id AND r.user_id = m.user_id AND r.role = 'student')`;

async function usage(dojoId, executor = pool) {
  const [[s]] = await executor.query(STUDENTS_SQL, { d: dojoId });
  const [[l]] = await executor.query('SELECT COUNT(*) AS n FROM dojo_locations WHERE dojo_id = :d AND active = 1', { d: dojoId });
  return { students: s.n, locations: l.n };
}

/** Todo junto, para la app: { plan, status, effective, limits, usage } */
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
      `El plan Básico permite hasta ${p.limits.students} alumnos activos y ya tienes ${s.n}. Cambia a Pro para agregar más.`,
      { limit: p.limits.students, current: s.n });
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
    throw planError('locations', 'El plan Básico incluye una sola sede. Cambia a Pro para tener varias.',
      { limit: p.limits.locations, current: l.n });
  }
}

/** Middleware: la función solo está en Pro (o en prueba) */
function requireFeature(feature) {
  const NAMES = { finance: 'Las finanzas (gastos e ingresos, por cobrar)' };
  return async (req, _res, next) => {
    try {
      const p = await planOf(req.auth.dojoId);
      if (!p.limits[feature]) return next(planError(feature, `${NAMES[feature] ?? 'Esta función'} son parte del plan Pro.`, {}));
      return next();
    } catch (e) { return next(e); }
  };
}

module.exports = { LIMITS, effectivePlan, planOf, usage, summary, assertStudents, canAddStudents, assertLocations, requireFeature };
