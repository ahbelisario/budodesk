const { pool, one } = require('../db/pool');
const { tenantDb } = require('../db/tenant');
const { verifyAccessToken } = require('../utils/tokens');
const { unauthorized, forbidden, AppError } = require('../utils/errors');

/**
 * Jerarquía: owner cumple todo lo que pide admin.
 * El resto de roles son independientes (instructor no es admin).
 */
const IMPLIED = { owner: ['admin'] };

function expandRoles(roles) {
  const set = new Set(roles);
  for (const r of roles) (IMPLIED[r] || []).forEach((x) => set.add(x));
  return [...set];
}

/**
 * Verifica el access token y que la sesión, el usuario y (si aplica) la
 * pertenencia al dojo sigan vigentes. Así, revocar una sesión, desactivar un
 * usuario o quitarle un rol surte efecto de inmediato, sin esperar a que
 * expire el token.
 *
 * Deja en req.auth: { userId, sessionId, dojoId, roles, isSuperadmin }
 */
async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (e) {
    return next(unauthorized(
      e.name === 'TokenExpiredError' ? 'La sesión expiró' : 'Token inválido',
      e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    ));
  }

  const session = await one(pool,
    `SELECT u.status, u.is_superadmin, u.deleted_at, s.revoked_at, (s.expires_at < NOW()) AS expired
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = :sid AND s.user_id = :uid`,
    { sid: claims.sessionId, uid: claims.userId });

  if (!session || session.revoked_at || session.expired) {
    return next(unauthorized('La sesión ya no es válida', 'SESSION_REVOKED'));
  }
  if (session.status !== 'active' || session.deleted_at) {
    return next(unauthorized('Cuenta desactivada', 'ACCOUNT_DISABLED'));
  }

  let roles = [];
  if (claims.dojoId) {
    const [rows] = await pool.query(
      `SELECT r.role
         FROM dojo_member_roles r
         JOIN dojo_members m ON m.dojo_id = r.dojo_id AND m.user_id = r.user_id
         JOIN dojos d        ON d.id = r.dojo_id
        WHERE r.dojo_id = :dojoId AND r.user_id = :uid
          AND m.status = 'active' AND d.status IN ('trial','active')`,
      { dojoId: claims.dojoId, uid: claims.userId });
    if (rows.length === 0) {
      return next(forbidden('Ya no tienes acceso a este dojo', 'NOT_A_MEMBER'));
    }
    roles = expandRoles(rows.map((r) => r.role));
  }

  req.auth = {
    userId: claims.userId,
    sessionId: claims.sessionId,
    dojoId: claims.dojoId,
    roles,
    isSuperadmin: !!session.is_superadmin,
  };

  // "Última actividad", como máximo una escritura cada 5 min por usuario
  pool.query(
    `UPDATE users SET last_seen_at = NOW()
      WHERE id = :uid AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL 5 MINUTE)`,
    { uid: claims.userId },
  ).catch(() => {});

  next();
}

/** Exige un dojo activo en la sesión y deja req.tdb (acceso a datos filtrado por dojo). */
function requireDojo(req, _res, next) {
  if (!req.auth?.dojoId) {
    return next(new AppError(409, 'DOJO_NOT_SELECTED', 'Selecciona un dojo para continuar'));
  }
  req.tdb = tenantDb(req.auth.dojoId);
  next();
}

/** requireRole('admin') · requireRole('admin', 'instructor') → basta con uno */
function requireRole(...allowed) {
  return (req, _res, next) => {
    if (!req.auth?.roles?.some((r) => allowed.includes(r))) return next(forbidden());
    next();
  };
}

const hasRole = (req, ...roles) => !!req.auth?.roles?.some((r) => roles.includes(r));

module.exports = { authenticate, requireDojo, requireRole, hasRole, expandRoles };
