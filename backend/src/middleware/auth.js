const { pool, one } = require('../db/pool');
const { tenantDb } = require('../db/tenant');
const { verifyAccessToken } = require('../utils/tokens');
const { unauthorized, forbidden, AppError } = require('../utils/errors');

/**
 * Jerarquía: owner cumple todo lo que pide admin.
 * El resto de roles son independientes (instructor no es admin).
 */
const IMPLIED = { owner: ['admin'] };

/**
 * Dojo en solo lectura (prueba vencida): se bloquea todo lo que no sea consultar, salvo la
 * propia cuenta (perfil, contraseña, avisos, salir/cambiar de dojo).
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const READ_ONLY_ALLOWED = ['/api/v2/auth', '/api/v2/me', '/api/v2/notifications', '/api/v2/account', '/api/v2/platform'];
/** /api/v2/me sí, /api/v2/members no */
const allowedInReadOnly = (url) => READ_ONLY_ALLOWED.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));

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
 * Deja en req.auth: { userId, sessionId, dojoId, roles, isSuperadmin, support }
 * support = superadmin dentro de un dojo del que no es miembro (permisos de dueño).
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
  let support = false;
  let readOnly = false; // terminó la prueba: se puede ver todo, pero no cambiar nada
  if (claims.dojoId) {
    const [rows] = await pool.query(
      `SELECT r.role, d.status AS dojo_status
         FROM dojo_member_roles r
         JOIN dojo_members m ON m.dojo_id = r.dojo_id AND m.user_id = r.user_id
         JOIN dojos d        ON d.id = r.dojo_id
        WHERE r.dojo_id = :dojoId AND r.user_id = :uid
          AND m.status = 'active' AND d.status IN ('trial','active','expired')`,
      { dojoId: claims.dojoId, uid: claims.userId });
    if (rows.length > 0) {
      roles = expandRoles(rows.map((r) => r.role));
      readOnly = rows[0].dojo_status === 'expired' && !session.is_superadmin;
    } else if (session.is_superadmin && await one(pool, 'SELECT id FROM dojos WHERE id = :id', { id: claims.dojoId })) {
      // Modo soporte: el superadmin entra a un dojo donde no es miembro (o que está suspendido)
      roles = expandRoles(['owner']);
      support = true;
    } else {
      return next(forbidden('Ya no tienes acceso a este dojo', 'NOT_A_MEMBER'));
    }
  }

  req.auth = {
    userId: claims.userId,
    sessionId: claims.sessionId,
    dojoId: claims.dojoId,
    roles,
    isSuperadmin: !!session.is_superadmin,
    support,
    readOnly,
  };

  if (readOnly && !SAFE_METHODS.has(req.method) && !allowedInReadOnly(req.originalUrl)) {
    return next(new AppError(403, 'DOJO_READ_ONLY',
      'La prueba gratis de este dojo terminó: puedes consultar la información, pero no hacer cambios hasta activar un plan.'));
  }

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
