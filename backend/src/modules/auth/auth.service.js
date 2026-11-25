const crypto = require('crypto');
const bcrypt = require('bcrypt');
const env = require('../../config/env');
const { pool, withTransaction, one } = require('../../db/pool');
const { signAccessToken, randomToken, sha256 } = require('../../utils/tokens');
const { AppError, unauthorized, forbidden } = require('../../utils/errors');
const { expandRoles } = require('../../middleware/auth');

const BCRYPT_ROUNDS = 12;
// Hash fijo para comparar cuando el usuario no existe: el tiempo de respuesta
// es el mismo y no se puede adivinar qué emails están registrados.
const DUMMY_HASH = bcrypt.hashSync('budodesk-dummy-password', BCRYPT_ROUNDS);

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

// ---------------------------------------------------------------------------
// Consultas de apoyo
// ---------------------------------------------------------------------------

async function listUserDojos(executor, userId) {
  const [rows] = await executor.query(
    `SELECT d.id, d.slug, d.name, d.short_name, d.logo_url,
            d.color_primary, d.color_secondary, d.color_accent,
            GROUP_CONCAT(r.role ORDER BY r.role) AS roles
       FROM dojo_members m
       JOIN dojos d             ON d.id = m.dojo_id
       JOIN dojo_member_roles r ON r.dojo_id = m.dojo_id AND r.user_id = m.user_id
      WHERE m.user_id = :uid AND m.status = 'active' AND d.status IN ('trial','active')
      GROUP BY d.id
      ORDER BY d.name`,
    { uid: userId });
  return rows.map((d) => ({ ...d, roles: expandRoles(d.roles.split(',')) }));
}

/** Dojo en modo soporte (superadmin que no es miembro): permisos de dueño */
async function supportDojo(executor, dojoId) {
  if (!dojoId) return null;
  const d = await one(executor,
    `SELECT id, slug, name, short_name, logo_url, color_primary, color_secondary, color_accent, status
       FROM dojos WHERE id = :id`, { id: dojoId });
  return d ? { ...d, roles: expandRoles(['owner']), support: true } : null;
}

async function getUserSummary(executor, userId) {
  return one(executor,
    `SELECT u.id, u.email, u.username, u.is_superadmin, u.email_verified_at,
            p.first_name, p.last_name, p.photo_url,
            s.language, s.theme, s.last_dojo_id
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.id = :uid`,
    { uid: userId });
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, username: u.username,
    first_name: u.first_name, last_name: u.last_name, photo_url: u.photo_url,
    language: u.language, theme: u.theme ?? 'system',
    is_superadmin: !!u.is_superadmin, email_verified: !!u.email_verified_at,
  };
}

/** Dojo para iniciar: el pedido explícitamente, el único que tiene, o el último usado. */
function pickDojo(dojos, { dojoSlug, lastDojoId }) {
  if (dojoSlug) {
    const d = dojos.find((x) => x.slug === dojoSlug);
    if (!d) throw forbidden('No perteneces a ese dojo', 'NOT_A_MEMBER');
    return d;
  }
  if (dojos.length === 1) return dojos[0];
  return dojos.find((x) => x.id === lastDojoId) ?? null;
}

async function createSession(executor, { userId, dojoId, familyId, ip, userAgent }) {
  const refreshToken = randomToken(32);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000);
  const [res] = await executor.query(
    `INSERT INTO auth_sessions (user_id, dojo_id, refresh_token_hash, family_id, user_agent, ip_address, expires_at)
     VALUES (:userId, :dojoId, :hash, :familyId, :ua, :ip, :expiresAt)`,
    {
      userId, dojoId: dojoId ?? null, hash: sha256(refreshToken),
      familyId: familyId ?? crypto.randomUUID(),
      ua: userAgent?.slice(0, 255) ?? null, ip: ip ?? null, expiresAt,
    });
  const access = signAccessToken({ userId, sessionId: res.insertId, dojoId });
  return {
    access_token: access.token,
    access_token_expires_at: access.expiresAt,
    refresh_token: refreshToken,
    refresh_token_expires_at: expiresAt.toISOString(),
  };
}

function buildAuthResponse(tokens, user, dojos, dojo) {
  return {
    ...tokens,
    user: publicUser(user),
    dojo: dojo ?? null,          // dojo activo (null = el cliente debe pedir que elija)
    dojos,                       // todos los dojos a los que pertenece
  };
}

async function rememberDojo(executor, userId, dojoId) {
  await executor.query(
    `INSERT INTO user_settings (user_id, last_dojo_id) VALUES (:uid, :dojoId)
     ON DUPLICATE KEY UPDATE last_dojo_id = VALUES(last_dojo_id)`,
    { uid: userId, dojoId });
}

async function logLogin({ userId, dojoId, identifier, success, ip, userAgent }) {
  await pool.query(
    `INSERT INTO login_history (user_id, dojo_id, identifier, success, ip_address, user_agent)
     VALUES (:userId, :dojoId, :identifier, :success, :ip, :ua)`,
    {
      userId: userId ?? null, dojoId: dojoId ?? null, identifier: identifier?.slice(0, 150) ?? null,
      success: success ? 1 : 0, ip: ip ?? null, ua: userAgent?.slice(0, 255) ?? null,
    });
}

// ---------------------------------------------------------------------------
// Casos de uso
// ---------------------------------------------------------------------------

async function login({ identifier, password, dojoSlug, ip, userAgent }) {
  const ident = identifier.trim().toLowerCase();
  const user = await one(pool,
    `SELECT id, password_hash, status, deleted_at, failed_login_count, email_verified_at,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
       FROM users WHERE (email = :ident OR username = :ident) AND deleted_at IS NULL`,
    { ident });

  if (user?.is_locked) {
    await logLogin({ userId: user.id, identifier: ident, success: false, ip, userAgent });
    throw new AppError(423, 'ACCOUNT_LOCKED',
      'Demasiados intentos fallidos. Intenta de nuevo en unos minutos.');
  }

  const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !user.password_hash || !ok) {
    if (user) {
      const failed = user.failed_login_count + 1;
      const lock = failed >= env.LOGIN_MAX_FAILED;
      await pool.query(
        `UPDATE users SET failed_login_count = :failed,
                locked_until = IF(:lock, NOW() + INTERVAL :mins MINUTE, locked_until)
          WHERE id = :id`,
        { failed: lock ? 0 : failed, lock: lock ? 1 : 0, mins: env.LOGIN_LOCK_MINUTES, id: user.id });
    }
    await logLogin({ userId: user?.id, identifier: ident, success: false, ip, userAgent });
    throw unauthorized('Usuario o contraseña incorrectos', 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    await logLogin({ userId: user.id, identifier: ident, success: false, ip, userAgent });
    throw forbidden('Tu cuenta está desactivada', 'ACCOUNT_DISABLED');
  }
  if (!user.email_verified_at) {
    throw forbidden('Confirma tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.', 'EMAIL_NOT_VERIFIED');
  }

  const summary = await getUserSummary(pool, user.id);
  const dojos = await listUserDojos(pool, user.id);
  const dojo = pickDojo(dojos, { dojoSlug, lastDojoId: summary.last_dojo_id });

  const tokens = await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = :id`,
      { id: user.id });
    if (dojo) await rememberDojo(conn, user.id, dojo.id);
    return createSession(conn, { userId: user.id, dojoId: dojo?.id, ip, userAgent });
  });

  await logLogin({ userId: user.id, dojoId: dojo?.id, identifier: ident, success: true, ip, userAgent });
  return buildAuthResponse(tokens, summary, dojos, dojo);
}

/**
 * Rotación de refresh token. Cada refresh invalida el anterior y emite uno
 * nuevo de la misma "familia". Si llega un token ya usado, alguien lo copió:
 * se revoca toda la familia (cierra la sesión en ese dispositivo y en el del atacante).
 */
async function refresh({ refreshToken, ip, userAgent }) {
  const hash = sha256(refreshToken);

  const outcome = await withTransaction(async (conn) => {
    const s = await one(conn,
      `SELECT s.id, s.user_id, s.dojo_id, s.family_id, s.revoked_at, (s.expires_at < NOW()) AS expired,
              u.status, u.deleted_at, u.is_superadmin
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = :hash
        FOR UPDATE`,
      { hash });

    if (!s) return { error: unauthorized('Sesión inválida', 'SESSION_INVALID') };

    if (s.revoked_at) {
      await conn.query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE family_id = :f AND revoked_at IS NULL`,
        { f: s.family_id });
      return { error: unauthorized('La sesión fue cerrada por seguridad. Inicia sesión de nuevo.', 'TOKEN_REUSED') };
    }
    if (s.expired) return { error: unauthorized('La sesión expiró', 'SESSION_EXPIRED') };
    if (s.status !== 'active' || s.deleted_at) return { error: unauthorized('Cuenta desactivada', 'ACCOUNT_DISABLED') };

    await conn.query(
      `UPDATE auth_sessions SET revoked_at = NOW(), last_used_at = NOW() WHERE id = :id`, { id: s.id });

    // ¿Sigue siendo miembro activo del dojo de la sesión?
    const dojos = await listUserDojos(conn, s.user_id);
    let dojo = dojos.find((d) => d.id === s.dojo_id) ?? null;
    if (!dojo && s.is_superadmin) dojo = await supportDojo(conn, s.dojo_id);

    const tokens = await createSession(conn, {
      userId: s.user_id, dojoId: dojo?.id, familyId: s.family_id, ip, userAgent,
    });
    const summary = await getUserSummary(conn, s.user_id);
    return { result: buildAuthResponse(tokens, summary, dojos, dojo) };
  });

  // El error se lanza FUERA de la transacción para que la revocación por reuso sí se guarde
  if (outcome.error) throw outcome.error;
  return outcome.result;
}

/** Cambia el dojo activo de la sesión actual y emite un access token nuevo. */
async function switchDojo({ userId, sessionId, dojoId, isSuperadmin = false }) {
  const dojos = await listUserDojos(pool, userId);
  let dojo = dojos.find((d) => d.id === dojoId);
  if (!dojo && isSuperadmin) dojo = await supportDojo(pool, dojoId);
  if (!dojo) throw forbidden('No perteneces a ese dojo', 'NOT_A_MEMBER');

  await pool.query(`UPDATE auth_sessions SET dojo_id = :dojoId WHERE id = :sid AND user_id = :uid`,
    { dojoId, sid: sessionId, uid: userId });
  if (!dojo.support) await rememberDojo(pool, userId, dojoId);

  const access = signAccessToken({ userId, sessionId, dojoId });
  return { access_token: access.token, access_token_expires_at: access.expiresAt, dojo };
}

async function logout({ sessionId }) {
  await pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE id = :sid AND revoked_at IS NULL`,
    { sid: sessionId });
}

async function logoutAll({ userId }) {
  await pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = :uid AND revoked_at IS NULL`,
    { uid: userId });
}

async function me({ userId, dojoId, roles, support }) {
  const summary = await getUserSummary(pool, userId);
  const dojos = await listUserDojos(pool, userId);
  let dojo = dojos.find((d) => d.id === dojoId) ?? null;
  if (!dojo && support) dojo = await supportDojo(pool, dojoId);
  return { user: publicUser(summary), dojo: dojo ? { ...dojo, roles } : null, dojos };
}

module.exports = {
  login, refresh, switchDojo, logout, logoutAll, me, hashPassword, listUserDojos,
};
