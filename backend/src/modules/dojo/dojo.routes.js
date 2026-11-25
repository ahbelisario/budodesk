/**
 * /api/v2/dojo      — ajustes del dojo activo, sedes, cobro
 * /api/v2/uploads   — logo del dojo y fotos de perfil
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const env = require('../../config/env');
const { pool } = require('../../db/pool');
const { authenticate, requireDojo, requireRole, hasRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest, AppError } = require('../../utils/errors');
const cipher = require('../platform/crypto');
const online = require('../online/online.service');
const { auditReq } = require('../../utils/audit');
const { buildSet } = require('../../utils/sql');
const { actingUser } = require('../../utils/acting');

const id = z.coerce.number().int().positive();
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color #RRGGBB');
const optStr = (n) => z.string().trim().max(n).nullish();

// ===========================================================================
// Ajustes
// ===========================================================================
const dojo = express.Router();
dojo.use(authenticate, requireDojo);

const PUBLIC_COLS = `id, slug, name, short_name, logo_url, phone, email, website, address_line1, address_line2, city, state,
  postal_code, country_code, facebook_url, instagram_url, tiktok_url, currency, timezone, language,
  color_primary, color_secondary, color_accent, booking_cancel_hours, booking_window_days, require_membership_to_book`;
const ADMIN_COLS = `${PUBLIC_COLS}, legal_name, tax_id, self_registration, privacy_policy, privacy_version, terms_conditions,
  plan, status, trial_ends_at, created_at`;

const settingsFields = {
  name: z.string().trim().min(1).max(255),
  short_name: optStr(50), legal_name: optStr(255), tax_id: optStr(50),
  phone: optStr(50), email: z.email().max(150).nullish(), website: optStr(255),
  address_line1: optStr(255), address_line2: optStr(255), city: optStr(100), state: optStr(100), postal_code: optStr(20),
  country_code: z.string().trim().length(2).toUpperCase().optional(),
  facebook_url: optStr(255), instagram_url: optStr(255), tiktok_url: optStr(255),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  timezone: z.string().trim().max(50).refine((tz) => { try { Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Zona horaria inválida').optional(),
  language: z.enum(['es', 'en']).optional(),
  color_primary: hex.optional(), color_secondary: hex.optional(), color_accent: hex.optional(),
  booking_cancel_hours: z.coerce.number().int().min(0).max(168).optional(),
  booking_window_days: z.coerce.number().int().min(1).max(180).optional(),
  require_membership_to_book: z.boolean().optional(),
  self_registration: z.enum(['closed', 'approval', 'open']).optional(),
  privacy_policy: z.string().max(100000).nullish(),
  privacy_version: optStr(10),
  terms_conditions: z.string().max(100000).nullish(),
};

dojo.get('/', async (req, res) => {
  const cols = hasRole(req, 'admin') ? ADMIN_COLS : PUBLIC_COLS;
  res.json({ status: 'success', data: await req.tdb.one(`SELECT ${cols} FROM dojos WHERE id = :dojoId`) });
});

dojo.patch('/', requireRole('admin'), validate({
  body: z.object(Object.fromEntries(Object.entries(settingsFields).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, Object.fromEntries(Object.keys(settingsFields).map((k) => [k, k])));
  const before = await req.tdb.one(`SELECT ${ADMIN_COLS} FROM dojos WHERE id = :dojoId`);
  await req.tdb.query(`UPDATE dojos SET ${set.sql} WHERE id = :dojoId`, set.params);
  const after = await req.tdb.one(`SELECT ${ADMIN_COLS} FROM dojos WHERE id = :dojoId`);
  const changed = Object.keys(req.valid.body).filter((k) => !['privacy_policy', 'terms_conditions'].includes(k));
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'dojo', entityId: req.auth.dojoId,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])) });
  res.json({ status: 'success', data: after });
});

// Cobro (los secretos de PayPal se configuran en su propio módulo)
const PAY_COLS = `paypal_enabled, paypal_mode, paypal_client_id, (paypal_secret_enc IS NOT NULL) AS paypal_secret_set, paypal_webhook_id,
            paypal_fee_percent, paypal_fee_fixed,
            mp_enabled, mp_mode, mp_public_key, (mp_access_token_enc IS NOT NULL) AS mp_access_token_set,
            (mp_webhook_secret_enc IS NOT NULL) AS mp_webhook_secret_set, mp_fee_percent, mp_fee_fixed,
            accepts_cash, accepts_transfer, transfer_instructions, late_fee_amount, late_fee_grace_days,
            auto_charges, payment_reminders`;

async function paymentSettings(req) {
  await req.tdb.query('INSERT IGNORE INTO dojo_payment_settings (dojo_id) VALUES (:dojoId)');
  const row = await req.tdb.one(`SELECT ${PAY_COLS} FROM dojo_payment_settings WHERE dojo_id = :dojoId`);
  return {
    ...row,
    encryption_available: cipher.hasKey(),
    webhook_urls: { paypal: online.webhookUrl('paypal', req.auth.dojoId), mercadopago: online.webhookUrl('mercadopago', req.auth.dojoId) },
  };
}

dojo.get('/payment-settings', requireRole('admin'), async (req, res) => {
  res.json({ status: 'success', data: await paymentSettings(req) });
});

dojo.patch('/payment-settings', requireRole('admin'), validate({
  body: z.object({
    accepts_cash: z.boolean().optional(), accepts_transfer: z.boolean().optional(),
    transfer_instructions: z.string().trim().max(2000).nullish(),
    late_fee_amount: z.coerce.number().min(0).max(1000000).nullish(),
    late_fee_grace_days: z.coerce.number().int().min(0).max(60).nullish(),
    auto_charges: z.boolean().optional(), payment_reminders: z.boolean().optional(),
    paypal_enabled: z.boolean().optional(), paypal_mode: z.enum(['sandbox', 'live']).optional(),
    paypal_client_id: z.string().trim().max(255).nullish(), paypal_secret: z.string().trim().max(500).nullish(),
    paypal_webhook_id: z.string().trim().max(100).nullish(),
    paypal_fee_percent: z.coerce.number().min(0).max(20).nullish(), paypal_fee_fixed: z.coerce.number().min(0).max(1000).nullish(),
    mp_enabled: z.boolean().optional(), mp_mode: z.enum(['test', 'live']).optional(),
    mp_public_key: z.string().trim().max(255).nullish(), mp_access_token: z.string().trim().max(500).nullish(),
    mp_webhook_secret: z.string().trim().max(500).nullish(),
    mp_fee_percent: z.coerce.number().min(0).max(20).nullish(), mp_fee_fixed: z.coerce.number().min(0).max(1000).nullish(),
  }).refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, { accepts_cash: 'accepts_cash', accepts_transfer: 'accepts_transfer',
    transfer_instructions: 'transfer_instructions', late_fee_amount: 'late_fee_amount', late_fee_grace_days: 'late_fee_grace_days',
    auto_charges: 'auto_charges', payment_reminders: 'payment_reminders',
    paypal_enabled: 'paypal_enabled', paypal_mode: 'paypal_mode', paypal_client_id: 'paypal_client_id', paypal_webhook_id: 'paypal_webhook_id',
    paypal_fee_percent: 'paypal_fee_percent', paypal_fee_fixed: 'paypal_fee_fixed',
    mp_enabled: 'mp_enabled', mp_mode: 'mp_mode', mp_public_key: 'mp_public_key', mp_fee_percent: 'mp_fee_percent', mp_fee_fixed: 'mp_fee_fixed' });
  const b = req.valid.body;
  // Llaves secretas: solo se escriben (cifradas), nunca se devuelven. Vacío = conservar la actual.
  const secrets = { paypal_secret: 'paypal_secret_enc', mp_access_token: 'mp_access_token_enc', mp_webhook_secret: 'mp_webhook_secret_enc' };
  const wantsSecret = Object.keys(secrets).some((k) => b[k]);
  if ((wantsSecret || b.paypal_enabled || b.mp_enabled) && !cipher.hasKey()) {
    throw new AppError(409, 'NO_ENCRYPTION_KEY', 'Falta BACKUP_ENCRYPTION_KEY en el servidor: corre ./deploy.sh config y ./deploy.sh up');
  }
  for (const [k, col] of Object.entries(secrets)) {
    if (!b[k]) continue;
    set.sql = [set.sql, `\`${col}\` = :set_${k}`].filter(Boolean).join(', ');
    set.params[`set_${k}`] = cipher.encryptText(b[k]);
  }
  if (!set.sql) throw badRequest('Nada que actualizar');
  await req.tdb.query('INSERT IGNORE INTO dojo_payment_settings (dojo_id) VALUES (:dojoId)');
  await req.tdb.query(`UPDATE dojo_payment_settings SET ${set.sql} WHERE dojo_id = :dojoId`, set.params);
  // No se puede dejar activo un método sin credenciales
  const after = await paymentSettings(req);
  if (after.paypal_enabled && !(after.paypal_client_id && after.paypal_secret_set)) {
    await req.tdb.query('UPDATE dojo_payment_settings SET paypal_enabled = 0 WHERE dojo_id = :dojoId');
    throw badRequest('Para activar PayPal llena el Client ID y el Secret');
  }
  if (after.mp_enabled && !after.mp_access_token_set) {
    await req.tdb.query('UPDATE dojo_payment_settings SET mp_enabled = 0 WHERE dojo_id = :dojoId');
    throw badRequest('Para activar Mercado Pago llena el Access Token');
  }
  const logged = { ...b };
  for (const k of Object.keys(secrets)) if (logged[k]) logged[k] = '(cambiada)';
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'payment_settings', entityId: req.auth.dojoId, after: logged });
  res.json({ status: 'success', data: await paymentSettings(req) });
});

// Probar credenciales de PayPal o Mercado Pago (las guardadas o las del formulario)
dojo.post('/payment-settings/test/:provider', requireRole('admin'), validate({
  params: z.object({ provider: z.enum(['paypal', 'mercadopago']) }),
  body: z.object({
    paypal_mode: z.enum(['sandbox', 'live']).optional(), paypal_client_id: z.string().trim().max(255).nullish(),
    paypal_secret: z.string().trim().max(500).nullish(), mp_mode: z.enum(['test', 'live']).optional(),
    mp_access_token: z.string().trim().max(500).nullish(),
  }).passthrough(),
}), async (req, res) => {
  res.json({ status: 'success', data: await online.testProvider(req.auth.dojoId, req.valid.params.provider, req.valid.body) });
});

// Instrucciones de pago visibles para alumnos
dojo.get('/payment-methods', async (req, res) => {
  const row = await req.tdb.one(
    `SELECT paypal_enabled, accepts_cash, accepts_transfer, transfer_instructions FROM dojo_payment_settings WHERE dojo_id = :dojoId`);
  res.json({ status: 'success', data: row ?? { paypal_enabled: 0, accepts_cash: 1, accepts_transfer: 1, transfer_instructions: null } });
});

// Sedes
dojo.get('/locations', async (req, res) => {
  res.json({ status: 'success', data: await req.tdb.query('SELECT id, name, address, active FROM dojo_locations WHERE dojo_id = :dojoId ORDER BY active DESC, name') });
});
dojo.post('/locations', requireRole('admin'), validate({ body: z.object({ name: z.string().trim().min(1).max(120), address: optStr(255) }) }), async (req, res) => {
  const r = await req.tdb.query('INSERT INTO dojo_locations (dojo_id, name, address) VALUES (:dojoId, :name, :address)',
    { name: req.valid.body.name, address: req.valid.body.address ?? null });
  res.status(201).json({ status: 'success', data: { id: r.insertId, ...req.valid.body, active: 1 } });
});
dojo.patch('/locations/:id', requireRole('admin'), validate({
  params: z.object({ id }),
  body: z.object({ name: z.string().trim().min(1).max(120).optional(), address: optStr(255), active: z.boolean().optional() })
    .refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const set = buildSet(req.valid.body, { name: 'name', address: 'address', active: 'active' });
  const r = await req.tdb.query(`UPDATE dojo_locations SET ${set.sql} WHERE dojo_id = :dojoId AND id = :id`, { ...set.params, id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Sede no encontrada');
  res.json({ status: 'success' });
});

// Bitácora de auditoría
dojo.get('/audit-log', requireRole('admin'), validate({
  query: z.object({ entity: z.string().max(50).optional(), entity_id: z.string().max(50).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
}), async (req, res) => {
  const q = req.valid.query;
  const rows = await req.tdb.query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.before_data, a.after_data, a.created_at,
            CONCAT_WS(' ', p.first_name, p.last_name) AS user_name
       FROM audit_log a LEFT JOIN user_profiles p ON p.user_id = a.user_id
      WHERE a.dojo_id = :dojoId ${q.entity ? 'AND a.entity = :entity' : ''} ${q.entity_id ? 'AND a.entity_id = :eid' : ''}
      ORDER BY a.id DESC LIMIT :limit`, { entity: q.entity, eid: q.entity_id, limit: q.limit });
  res.json({ status: 'success', data: rows });
});

// ===========================================================================
// Subidas (imágenes)
// ===========================================================================
const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(IMAGE_TYPES[file.mimetype] ? null : badRequest('Solo se permiten imágenes PNG, JPG o WEBP'), !!IMAGE_TYPES[file.mimetype]),
});

// Verifica la firma real del archivo (no confiar en el mimetype del cliente)
function sniff(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

function saveImage(file, subdir) {
  if (!file) throw badRequest('Falta el archivo (campo "file")');
  const ext = sniff(file.buffer);
  if (!ext) throw badRequest('El archivo no es una imagen válida');
  const dir = path.join(env.UPLOAD_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return `/uploads/${subdir}/${name}`;
}

const uploads = express.Router();
uploads.use(authenticate, requireDojo);

uploads.post('/logo', requireRole('admin'), upload.single('file'), async (req, res) => {
  const url = saveImage(req.file, `dojos/${req.auth.dojoId}`);
  await req.tdb.query('UPDATE dojos SET logo_url = :url WHERE id = :dojoId', { url });
  await auditReq(req, req.tdb.executor, { action: 'upload_logo', entity: 'dojo', entityId: req.auth.dojoId, after: { url } });
  res.status(201).json({ status: 'success', data: { url } });
});

// Foto de perfil: la propia, la de un menor a cargo, o (staff) la de cualquier miembro
uploads.post('/avatar', upload.single('file'), async (req, res) => {
  const uid = await actingUser(req, req.query.user_id, { staffRoles: ['admin', 'staff'] });
  const url = saveImage(req.file, `avatars/${uid}`);
  await pool.query('UPDATE user_profiles SET photo_url = :url WHERE user_id = :uid', { url, uid });
  res.status(201).json({ status: 'success', data: { url } });
});

module.exports = { dojo, uploads };
