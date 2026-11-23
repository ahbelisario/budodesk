/**
 * ¿Sobre quién actúa el usuario? Por defecto sobre sí mismo. Un tutor puede
 * actuar sobre sus menores (si ambos son miembros del dojo) y el staff sobre
 * cualquiera según el permiso.
 *
 *   const uid = await actingUser(req, req.query.user_id, { staffRoles: ['admin','staff'], need: 'book' })
 */
const { forbidden, notFound } = require('./errors');
const { hasRole } = require('../middleware/auth');

async function isGuardianOf(req, minorId, need) {
  const col = need === 'pay' ? 'g.can_pay' : need === 'book' ? 'g.can_book' : '1';
  const row = await req.tdb.one(
    `SELECT 1 AS ok
       FROM user_guardians g
       JOIN dojo_members m ON m.user_id = g.minor_user_id AND m.dojo_id = :dojoId
      WHERE g.guardian_user_id = :me AND g.minor_user_id = :minor AND ${col} = 1`,
    { me: req.auth.userId, minor: minorId });
  return !!row;
}

async function actingUser(req, requestedId, { staffRoles = ['admin', 'staff'], need = 'view' } = {}) {
  const target = requestedId ? Number(requestedId) : req.auth.userId;
  if (target === req.auth.userId) return target;

  if (hasRole(req, ...staffRoles)) {
    const exists = await req.tdb.one(
      'SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u', { u: target });
    if (!exists) throw notFound('Miembro no encontrado');
    return target;
  }
  if (await isGuardianOf(req, target, need)) return target;
  throw forbidden('No puedes actuar en nombre de esta persona');
}

/** IDs de los menores a cargo del usuario en este dojo */
async function myMinors(req) {
  return req.tdb.query(
    `SELECT g.minor_user_id AS user_id, g.relationship, g.can_book, g.can_pay,
            p.first_name, p.last_name, p.photo_url, p.date_of_birth
       FROM user_guardians g
       JOIN dojo_members m ON m.user_id = g.minor_user_id AND m.dojo_id = :dojoId AND m.status = 'active'
       JOIN user_profiles p ON p.user_id = g.minor_user_id
      WHERE g.guardian_user_id = :me
      ORDER BY p.first_name`, { me: req.auth.userId });
}

module.exports = { actingUser, isGuardianOf, myMinors };
