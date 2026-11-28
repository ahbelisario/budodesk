/**
 * /api/v2/account — rutas públicas (registro, verificación, contraseña)
 * /api/v2/me      — la cuenta del usuario autenticado
 */
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { pool, one } = require('../../db/pool');
const { authenticate, requireDojo } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { buildSet } = require('../../utils/sql');
const { myMinors } = require('../../utils/acting');
const service = require('./account.service');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { status: 'error', code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Espera unos minutos.' },
});

const email = z.email().max(150).transform((s) => s.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ok = (res, data) => res.json({ status: 'success', ...(data ? { data } : {}) });

// ===========================================================================
// Públicas
// ===========================================================================
const account = express.Router();

// Reglas de contraseña vigentes (para mostrarlas en vivo al crearla)
account.get('/password-policy', async (_req, res) => {
  res.json({ status: 'success', data: await require('../../services/passwordPolicy').getPolicy() });
});

account.post('/register', limiter, validate({
  body: z.object({
    dojo_slug: z.string().trim().min(1).max(60),
    email,
    password: z.string().min(1).max(200),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().max(100).optional(),
    date_of_birth: date.optional(),
    phone: z.string().trim().max(30).optional(),
    language: z.enum(['es', 'en']).optional(),
    privacy_accepted: z.literal(true, { message: 'Debes aceptar el aviso de privacidad' }),
    privacy_version: z.string().max(10).optional(),
  }),
}), async (req, res) => {
  res.status(201).json({ status: 'success', data: await service.register(req.valid.body, { ip: req.ip }) });
});

account.post('/verify-email', limiter, validate({ body: z.object({ token: z.string().min(20).max(200) }) }), async (req, res) => {
  ok(res, await service.verifyEmail(req.valid.body.token));
});

account.post('/resend-verification', limiter, validate({ body: z.object({ email }) }), async (req, res) => {
  await service.resendVerification(req.valid.body.email);
  ok(res);
});

account.post('/password/forgot', limiter, validate({ body: z.object({ email }) }), async (req, res) => {
  await service.forgotPassword(req.valid.body.email);
  ok(res); // siempre éxito: no revela si el correo existe
});

account.post('/password/reset', limiter, validate({
  body: z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) }),
}), async (req, res) => {
  ok(res, await service.resetPassword(req.valid.body.token, req.valid.body.password));
});

// Página de inicio de sesión de un dojo: marca, colores, si acepta registros
account.get('/dojos/:slug', validate({ params: z.object({ slug: z.string().max(60) }) }), async (req, res) => {
  const d = await one(pool,
    `SELECT id, slug, name, short_name, logo_url, color_primary, color_secondary, color_accent, language,
            self_registration, privacy_version, phone, email, website, city, state, facebook_url, instagram_url, tiktok_url,
            status = 'expired' AS read_only
       FROM dojos WHERE slug = :slug AND status IN ('trial','active','expired')`, { slug: req.valid.params.slug });
  if (!d) {
    // Existe pero está suspendido o cancelado: 403 (la app no lo confunde con una dirección libre)
    if (await one(pool, 'SELECT id FROM dojos WHERE slug = :slug', { slug: req.valid.params.slug })) {
      return res.status(403).json({ status: 'error', code: 'DOJO_UNAVAILABLE', message: 'Este dojo no está disponible por ahora' });
    }
    return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Dojo no encontrado' });
  }
  // En solo lectura no se aceptan registros nuevos
  ok(res, { ...d, read_only: !!d.read_only, self_registration: d.read_only ? 'closed' : d.self_registration });
});

account.get('/dojos/:slug/privacy', validate({ params: z.object({ slug: z.string().max(60) }) }), async (req, res) => {
  const d = await one(pool,
    `SELECT name, privacy_policy, privacy_version, terms_conditions FROM dojos WHERE slug = :slug AND status IN ('trial','active','expired')`,
    { slug: req.valid.params.slug });
  if (!d) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Dojo no encontrado' });
  ok(res, d);
});

// ===========================================================================
// /me
// ===========================================================================
const me = express.Router();
me.use(authenticate);

const PROFILE_FIELDS = {
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).nullable(),
  second_last_name: z.string().trim().max(100).nullable(),
  preferred_name: z.string().trim().max(100).nullable(),
  gender: z.enum(['male', 'female', 'other', 'undisclosed']).nullable(),
  date_of_birth: date.nullable(),
  phone: z.string().trim().max(30).nullable(),
  photo_url: z.string().trim().max(500).nullable(),
  address_line1: z.string().trim().max(200).nullable(),
  address_line2: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  state: z.string().trim().max(100).nullable(),
  postal_code: z.string().trim().max(20).nullable(),
  country_code: z.string().trim().length(2).nullable(),
  emergency_contact_name: z.string().trim().max(150).nullable(),
  emergency_contact_phone: z.string().trim().max(30).nullable(),
  emergency_contact_relation: z.string().trim().max(50).nullable(),
  blood_type: z.string().trim().max(5).nullable(),
  medical_notes: z.string().trim().max(5000).nullable(),
};

async function myProfile(userId) {
  return one(pool,
    `SELECT u.id, u.email, u.username, u.email_verified_at, u.created_at,
            p.first_name, p.last_name, p.second_last_name, p.preferred_name, p.gender, p.date_of_birth,
            p.phone, p.photo_url, p.address_line1, p.address_line2, p.city, p.state, p.postal_code, p.country_code,
            p.emergency_contact_name, p.emergency_contact_phone, p.emergency_contact_relation,
            p.blood_type, p.medical_notes,
            s.language, s.theme, s.notify_email, s.notify_push, s.notify_class_reminders,
            s.notify_payment_reminders, s.notify_announcements
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.id = :u`, { u: userId });
}

me.get('/profile', async (req, res) => ok(res, await myProfile(req.auth.userId)));

me.patch('/profile', validate({
  body: z.object(Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, k])));
  await pool.query(`UPDATE user_profiles SET ${set.sql} WHERE user_id = :u`, { ...set.params, u: req.auth.userId });
  ok(res, await myProfile(req.auth.userId));
});

me.patch('/settings', validate({
  body: z.object({
    language: z.enum(['es', 'en']).optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    notify_email: z.boolean().optional(),
    notify_push: z.boolean().optional(),
    notify_class_reminders: z.boolean().optional(),
    notify_payment_reminders: z.boolean().optional(),
    notify_announcements: z.boolean().optional(),
  }).refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const cols = ['language', 'theme', 'notify_email', 'notify_push', 'notify_class_reminders', 'notify_payment_reminders', 'notify_announcements'];
  const set = buildSet(req.valid.body, Object.fromEntries(cols.map((c) => [c, c])));
  await pool.query('INSERT IGNORE INTO user_settings (user_id) VALUES (:u)', { u: req.auth.userId });
  await pool.query(`UPDATE user_settings SET ${set.sql} WHERE user_id = :u`, { ...set.params, u: req.auth.userId });
  ok(res, await myProfile(req.auth.userId));
});

me.post('/password', validate({
  body: z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(1).max(200) }),
}), async (req, res) => {
  await service.changePassword({
    userId: req.auth.userId, sessionId: req.auth.sessionId,
    current: req.valid.body.current_password, next: req.valid.body.new_password,
  });
  ok(res);
});

me.post('/join-dojo', validate({ body: z.object({ dojo_slug: z.string().trim().min(1).max(60) }) }), async (req, res) => {
  res.status(201).json({ status: 'success', data: await service.requestJoin({ userId: req.auth.userId, dojoSlug: req.valid.body.dojo_slug, ip: req.ip }) });
});

me.get('/sessions', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, user_agent, ip_address, created_at, last_used_at, (id = :sid) AS current
       FROM auth_sessions WHERE user_id = :u AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC`, { u: req.auth.userId, sid: req.auth.sessionId });
  ok(res, rows);
});

// Menores a cargo (para que el tutor cambie de perfil en la app)
me.get('/minors', requireDojo, async (req, res) => ok(res, await myMinors(req)));

// El tutor consulta y edita los datos personales de sus menores (ellos no tienen cuenta propia)
async function assertGuardian(guardianId, minorId) {
  const g = await one(pool, 'SELECT 1 AS ok FROM user_guardians WHERE guardian_user_id = :g AND minor_user_id = :m', { g: guardianId, m: minorId });
  if (!g) {
    const { forbidden } = require('../../utils/errors');
    throw forbidden('Solo el tutor puede ver o editar los datos de esta persona');
  }
}

me.get('/minors/:userId/profile', validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }), async (req, res) => {
  await assertGuardian(req.auth.userId, req.valid.params.userId);
  ok(res, await myProfile(req.valid.params.userId));
});

me.patch('/minors/:userId/profile', validate({
  params: z.object({ userId: z.coerce.number().int().positive() }),
  body: z.object(Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const minorId = req.valid.params.userId;
  await assertGuardian(req.auth.userId, minorId);
  const set = buildSet(req.valid.body, Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, k])));
  await pool.query(`UPDATE user_profiles SET ${set.sql} WHERE user_id = :u`, { ...set.params, u: minorId });
  const { audit } = require('../../utils/audit');
  await audit(pool, { userId: req.auth.userId, action: 'guardian_update', entity: 'member', entityId: minorId, after: req.valid.body, ip: req.ip });
  ok(res, await myProfile(minorId));
});

module.exports = { account, me };
