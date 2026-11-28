/**
 * Cuentas: registro, verificación de correo, acceso/recuperación de contraseña.
 * Los tokens se guardan hasheados (sha256) en user_tokens y son de un solo uso.
 */
const env = require('../../config/env');
const { assertPassword } = require('../../services/passwordPolicy');
const { pool, withTransaction, one } = require('../../db/pool');
const { randomToken, sha256 } = require('../../utils/tokens');
const { sendMail } = require('../../services/mailer');
const { AppError, badRequest, conflict, forbidden } = require('../../utils/errors');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;
const TTL = { email_verification: 24 * 60, password_reset: 60, access: 7 * 24 * 60 }; // minutos

async function issueToken(executor, userId, purpose, minutes) {
  const token = randomToken(32);
  // Invalida tokens anteriores del mismo propósito
  await executor.query(
    'UPDATE user_tokens SET used_at = NOW() WHERE user_id = :u AND purpose = :p AND used_at IS NULL', { u: userId, p: purpose });
  await executor.query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at)
     VALUES (:u, :p, :h, NOW() + INTERVAL :m MINUTE)`, { u: userId, p: purpose, h: sha256(token), m: minutes });
  return token;
}

/** Consume un token válido y devuelve el user_id (o lanza 400) */
async function consumeToken(executor, token, purpose) {
  const row = await one(executor,
    `SELECT id, user_id FROM user_tokens
      WHERE token_hash = :h AND purpose = :p AND used_at IS NULL AND expires_at > NOW()
      FOR UPDATE`, { h: sha256(token), p: purpose });
  if (!row) throw new AppError(400, 'TOKEN_INVALID', 'El enlace no es válido o ya expiró');
  await executor.query('UPDATE user_tokens SET used_at = NOW() WHERE id = :id', { id: row.id });
  return row.user_id;
}

async function mailContext(userId, dojoId) {
  return one(pool,
    `SELECT u.email, p.first_name, COALESCE(s.language, d.language, 'es') AS lang,
            COALESCE(d.short_name, d.name, 'BudoDesk') AS dojo, d.color_primary AS color, d.slug
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_settings s ON s.user_id = u.id
       LEFT JOIN dojos d ON d.id = COALESCE(:dojoId, s.last_dojo_id)
      WHERE u.id = :u`, { u: userId, dojoId: dojoId ?? null });
}

const link = (path, token, slug) =>
  `${env.APP_BASE_URL}${path}?token=${encodeURIComponent(token)}${slug ? `&dojo=${encodeURIComponent(slug)}` : ''}`;

// Las reglas (largo, mayúscula, número, símbolo…) se configuran en Plataforma → Seguridad
const validatePassword = (pw) => assertPassword(pw);

// ---------------------------------------------------------------------------

/** Admin da acceso a un miembro: correo para crear su contraseña (7 días). */
async function sendAccessEmail({ userId, dojoId }) {
  const token = await issueToken(pool, userId, 'password_reset', TTL.access);
  const c = await mailContext(userId, dojoId);
  return sendMail('account_access', {
    to: c.email, lang: c.lang,
    vars: { name: c.first_name, dojo: c.dojo, color: c.color, url: link('/set-password', token, c.slug) },
  });
}

async function sendVerification(userId, dojoId) {
  const token = await issueToken(pool, userId, 'email_verification', TTL.email_verification);
  const c = await mailContext(userId, dojoId);
  return sendMail('verify_email', {
    to: c.email, lang: c.lang,
    vars: { name: c.first_name, dojo: c.dojo, color: c.color, url: link('/verify-email', token, c.slug) },
  });
}

/**
 * Registro público en un dojo.
 * dojo.self_registration: closed → rechaza · approval → miembro 'pending' · open → 'active'
 */
async function register(b, { ip }) {
  const dojo = await one(pool,
    `SELECT id, self_registration, privacy_version, language FROM dojos WHERE slug = :slug AND status IN ('trial','active')`,
    { slug: b.dojo_slug });
  if (!dojo) throw badRequest('Dojo no encontrado');
  if (dojo.self_registration === 'closed') throw forbidden('Este dojo no acepta registros en línea', 'REGISTRATION_CLOSED');
  await validatePassword(b.password);

  const exists = await one(pool, 'SELECT id FROM users WHERE email = :e', { e: b.email });
  if (exists) throw conflict('Ya existe una cuenta con ese correo. Inicia sesión para unirte a este dojo.', 'EMAIL_TAKEN');

  const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
  const userId = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO users (email, password_hash, password_changed_at) VALUES (:e, :h, NOW())', { e: b.email, h: hash });
    const uid = r.insertId;
    await conn.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, date_of_birth, phone)
       VALUES (:uid, :fn, :ln, :dob, :phone)`,
      { uid, fn: b.first_name, ln: b.last_name ?? null, dob: b.date_of_birth ?? null, phone: b.phone ?? null });
    await conn.query('INSERT INTO user_settings (user_id, language, last_dojo_id) VALUES (:uid, :lang, :d)',
      { uid, lang: b.language ?? dojo.language, d: dojo.id });
    await joinDojo(conn, uid, dojo);
    await recordConsent(conn, { userId: uid, dojoId: dojo.id, version: b.privacy_version ?? dojo.privacy_version ?? '1.0', ip });
    return uid;
  });

  await sendVerification(userId, dojo.id);
  const [[m]] = await pool.query('SELECT status FROM dojo_members WHERE dojo_id = :d AND user_id = :u', { d: dojo.id, u: userId });
  return { user_id: userId, membership_status: m?.status ?? 'pending' };
}

async function joinDojo(conn, userId, dojo) {
  let status = dojo.self_registration === 'open' ? 'active' : 'pending';
  // Si el dojo llegó al límite de alumnos de su plan, la solicitud queda pendiente
  // (el admin la ve, pero para activarla necesita lugar o cambiar de plan)
  if (status === 'active' && !(await require('../../services/subscription').canAddStudents(dojo.id, 1, conn))) status = 'pending';
  await conn.query(
    `INSERT INTO dojo_members (dojo_id, user_id, status, joined_at, source)
     VALUES (:d, :u, :s, CURDATE(), 'self_registration')`, { d: dojo.id, u: userId, s: status });
  await conn.query(`INSERT INTO dojo_member_roles (dojo_id, user_id, role) VALUES (:d, :u, 'student')`, { d: dojo.id, u: userId });
  return status;
}

/** Un usuario existente solicita unirse a otro dojo */
async function requestJoin({ userId, dojoSlug, ip }) {
  const dojo = await one(pool,
    `SELECT id, self_registration, privacy_version FROM dojos WHERE slug = :slug AND status IN ('trial','active')`, { slug: dojoSlug });
  if (!dojo) throw badRequest('Dojo no encontrado');
  if (dojo.self_registration === 'closed') throw forbidden('Este dojo no acepta registros en línea', 'REGISTRATION_CLOSED');
  return withTransaction(async (conn) => {
    const m = await one(conn, 'SELECT status FROM dojo_members WHERE dojo_id = :d AND user_id = :u', { d: dojo.id, u: userId });
    if (m) throw conflict('Ya perteneces o ya solicitaste unirte a este dojo', 'ALREADY_MEMBER');
    const status = await joinDojo(conn, userId, dojo);
    await recordConsent(conn, { userId, dojoId: dojo.id, version: dojo.privacy_version ?? '1.0', ip });
    return { dojo_id: dojo.id, membership_status: status };
  });
}

async function recordConsent(conn, { userId, dojoId, version, ip, document = 'privacy_notice', onBehalfOf }) {
  await conn.query(
    `INSERT INTO user_consents (user_id, dojo_id, document, version, on_behalf_of, ip_address)
     VALUES (:u, :d, :doc, :v, :ob, :ip)`,
    { u: userId, d: dojoId ?? null, doc: document, v: version, ob: onBehalfOf ?? null, ip: ip ?? null });
}

async function verifyEmail(token) {
  return withTransaction(async (conn) => {
    const uid = await consumeToken(conn, token, 'email_verification');
    await conn.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = :u', { u: uid });
    return { user_id: uid };
  });
}

async function resendVerification(email) {
  const u = await one(pool, 'SELECT id, email_verified_at FROM users WHERE email = :e AND deleted_at IS NULL', { e: email });
  if (u && !u.email_verified_at) await sendVerification(u.id, null);
  // Siempre "ok": no revela si el correo existe
}

async function forgotPassword(email) {
  const u = await one(pool,
    `SELECT id FROM users WHERE email = :e AND deleted_at IS NULL AND status = 'active'`, { e: email });
  if (!u) return;
  const token = await issueToken(pool, u.id, 'password_reset', TTL.password_reset);
  const c = await mailContext(u.id, null);
  await sendMail('password_reset', {
    to: c.email, lang: c.lang,
    vars: { name: c.first_name, dojo: c.dojo, color: c.color, url: link('/reset-password', token, c.slug) },
  });
}

/** Restablece (o crea por primera vez) la contraseña con un token. Cierra todas las sesiones. */
async function resetPassword(token, newPassword) {
  await validatePassword(newPassword);
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const uid = await withTransaction(async (conn) => {
    const id = await consumeToken(conn, token, 'password_reset');
    // El token llegó a su correo: eso también lo verifica
    await conn.query(
      `UPDATE users SET password_hash = :h, password_changed_at = NOW(), failed_login_count = 0, locked_until = NULL,
              email_verified_at = COALESCE(email_verified_at, NOW())
        WHERE id = :u`, { h: hash, u: id });
    await conn.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = :u AND revoked_at IS NULL', { u: id });
    return id;
  });
  const c = await mailContext(uid, null);
  await sendMail('password_changed', {
    to: c.email, lang: c.lang, vars: { name: c.first_name, dojo: c.dojo, color: c.color, url: `${env.APP_BASE_URL}/` },
  });
  return { user_id: uid };
}

/** Cambio de contraseña con sesión iniciada. Cierra las demás sesiones. */
async function changePassword({ userId, sessionId, current, next }) {
  await validatePassword(next);
  const u = await one(pool, 'SELECT password_hash FROM users WHERE id = :u', { u: userId });
  if (!u?.password_hash || !(await bcrypt.compare(current, u.password_hash))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'La contraseña actual no es correcta');
  }
  const hash = await bcrypt.hash(next, BCRYPT_ROUNDS);
  await withTransaction(async (conn) => {
    await conn.query('UPDATE users SET password_hash = :h, password_changed_at = NOW() WHERE id = :u', { h: hash, u: userId });
    await conn.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = :u AND id <> :sid AND revoked_at IS NULL',
      { u: userId, sid: sessionId });
  });
  const c = await mailContext(userId, null);
  await sendMail('password_changed', { to: c.email, lang: c.lang, vars: { name: c.first_name, dojo: c.dojo, color: c.color } });
}

module.exports = {
  issueToken, sendAccessEmail, register, requestJoin, verifyEmail, resendVerification,
  forgotPassword, resetPassword, changePassword, recordConsent,
};
