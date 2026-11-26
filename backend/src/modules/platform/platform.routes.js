/**
 * /api/v2/platform — panel de la plataforma (solo superadmin)
 *
 *   GET    /dojos                 lista con métricas
 *   POST   /dojos                 alta de dojo (+ dueño, + copiar configuración)
 *   PATCH  /dojos/:id             nombre, plan, estado, fin de prueba
 *   DELETE /dojos/:id             elimina el dojo y sus datos (solo cancelados; body { confirm_slug })
 *   GET    /monitoring            ajustes, estado y alertas (?status=open|resolved|all)
 *   PUT    /monitoring/settings   correos de alerta, push, latido, umbral de disco
 *   POST   /monitoring/test       manda una alerta de prueba
 *   POST   /monitoring/alerts/:id/resolve
 *   GET    /signups               solicitudes de registro (?status=pending|approved|rejected|all) + ajustes
 *   PUT    /signups/settings      aceptar registros, días de prueba
 *   POST   /signups/:id/approve   crea el dojo en prueba y avisa al dueño
 *   POST   /signups/:id/reject    rechaza (aviso opcional)
 *   GET    /backups               ajustes + listado
 *   PUT    /backups/settings      ajustes de respaldos y S3
 *   POST   /backups/run           respaldar ahora
 *   POST   /backups/s3/test       probar conexión S3 (con lo que está en el formulario)
 *   POST   /backups/:id/link      enlace de descarga (5 min)
 *   GET    /backups/download      descarga con el enlace (sin sesión: el token autoriza)
 */
const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { forbidden } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const dojos = require('./dojos.service');
const backups = require('./backups.service');
const signups = require('../signup/signup.service');
const monitor = require('./monitor.service');

const router = express.Router();
const id = z.coerce.number().int().positive();
const optStr = (n) => z.string().trim().max(n).nullish();
const PLANS = ['trial', 'basic', 'pro'];
const STATUSES = ['trial', 'active', 'expired', 'suspended', 'cancelled'];

// --- Descarga (antes de exigir sesión: el navegador abre el enlace directo) ---
router.get('/backups/download', async (req, res) => {
  const claims = backups.verifyLink(String(req.query.token || ''));
  const file = await backups.openDownload(claims);
  await audit(require('../../db/pool').pool, {
    userId: null, action: 'download', entity: 'backup', entityId: claims.id, ip: req.ip, after: { source: claims.src },
  });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  if (file.size) res.setHeader('Content-Length', String(file.size));
  res.setHeader('Cache-Control', 'no-store');
  file.stream.on('error', () => res.destroy());
  file.stream.pipe(res);
});

router.use(authenticate, (req, _res, next) => (req.auth.isSuperadmin ? next() : next(forbidden('Solo para el administrador de la plataforma'))));

// ===========================================================================
// Dojos
// ===========================================================================
router.get('/dojos', async (req, res) => {
  res.json({ status: 'success', data: await dojos.listDojos(req.auth.userId) });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(255),
  short_name: optStr(50),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
    'Subdominio: 3 a 40 letras minúsculas, números o guiones (sin guion al inicio o al final)'),
  timezone: z.string().trim().min(3).max(50).default('America/Mexico_City'),
  currency: z.string().trim().toUpperCase().length(3).default('MXN'),
  language: z.enum(['es', 'en']).default('es'),
  country_code: z.string().trim().toUpperCase().length(2).default('MX'),
  plan: z.enum(PLANS).default('trial'),
  status: z.enum(['trial', 'active']).default('trial'),
  trial_ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  owner_email: z.string().trim().toLowerCase().email('Correo del dueño no válido'),
  owner_first_name: z.string().trim().min(1).max(100),
  owner_last_name: optStr(100),
  copy_from_dojo_id: id.nullish(),
  send_owner_email: z.boolean().default(true),
}).refine((b) => { try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); return true; } catch { return false; } },
  { message: 'Zona horaria no válida', path: ['timezone'] });

router.post('/dojos', validate({ body: createSchema }), async (req, res) => {
  const b = { ...req.valid.body };
  if (b.status === 'trial' && !b.trial_ends_at) {
    b.trial_ends_at = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  }
  res.status(201).json({ status: 'success', data: await dojos.createDojo(b, req.auth.userId, req.ip) });
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  short_name: optStr(50),
  plan: z.enum(PLANS).optional(),
  status: z.enum(STATUSES).optional(),
  trial_ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

router.patch('/dojos/:id', validate({ params: z.object({ id }), body: updateSchema }), async (req, res) => {
  res.json({ status: 'success', data: await dojos.updateDojo(req.valid.params.id, req.valid.body, req.auth.userId, req.ip) });
});

router.delete('/dojos/:id', validate({ params: z.object({ id }), body: z.object({ confirm_slug: z.string().trim().max(60) }) }),
  async (req, res) => {
    res.json({ status: 'success', data: await dojos.deleteDojo(req.valid.params.id, req.valid.body, req.auth, req.ip) });
  });

// ===========================================================================
// Monitoreo
// ===========================================================================
router.get('/monitoring', validate({ query: z.object({ status: z.enum(['open', 'resolved', 'all']).default('all') }) }), async (req, res) => {
  const [settings, status, alerts] = await Promise.all([
    monitor.getSettings(), monitor.status(), monitor.listAlerts({ status: req.valid.query.status })]);
  res.json({ status: 'success', data: { settings, status, alerts } });
});

router.put('/monitoring/settings', validate({
  body: z.object({
    alerts_emails: z.string().max(1000).optional(),
    alerts_push: z.boolean().optional(),
    heartbeat_url: z.string().trim().max(500).nullable().optional(),
    disk_alert_pct: z.coerce.number().int().min(1).max(50).optional(),
  }),
}), async (req, res) => {
  res.json({ status: 'success', data: await monitor.updateSettings(req.valid.body, req.auth.userId) });
});

router.post('/monitoring/test', async (req, res) => {
  res.json({ status: 'success', data: await monitor.sendTest(req.auth.userId) });
});

router.post('/monitoring/alerts/:id/resolve', validate({ params: z.object({ id }) }), async (req, res) => {
  await monitor.resolveById(req.valid.params.id, req.auth.userId);
  res.json({ status: 'success', data: { id: req.valid.params.id } });
});

// ===========================================================================
// Solicitudes de registro
// ===========================================================================
router.get('/signups', validate({ query: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') }) }),
  async (req, res) => {
    const [settings, list] = await Promise.all([signups.platformSettings(), signups.listSignups(req.valid.query)]);
    const [[{ pending }]] = await require('../../db/pool').pool.query(
      "SELECT COUNT(*) AS pending FROM dojo_signups WHERE status = 'pending'");
    res.json({ status: 'success', data: { settings, pending, signups: list } });
  });

router.put('/signups/settings', validate({
  body: z.object({ signup_enabled: z.boolean().optional(), trial_days: z.coerce.number().int().min(1).max(365).optional() }),
}), async (req, res) => {
  res.json({ status: 'success', data: await signups.updateSettings(req.valid.body, req.auth.userId, req.ip) });
});

router.post('/signups/:id/approve', validate({
  params: z.object({ id }),
  body: z.object({
    name: z.string().trim().min(2).max(255).optional(),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
      'Subdominio: 3 a 40 letras minúsculas, números o guiones (sin guion al inicio o al final)').optional(),
    trial_days: z.coerce.number().int().min(1).max(365).optional(),
    copy_from_dojo_id: id.nullish(),
    note: optStr(500),
  }),
}), async (req, res) => {
  res.status(201).json({ status: 'success', data: await signups.approve(req.valid.params.id, req.valid.body, req.auth.userId, req.ip) });
});

router.post('/signups/:id/reject', validate({
  params: z.object({ id }),
  body: z.object({ reason: optStr(500), notify: z.boolean().default(true) }),
}), async (req, res) => {
  res.json({ status: 'success', data: await signups.reject(req.valid.params.id, req.valid.body, req.auth.userId, req.ip) });
});

// ===========================================================================
// Respaldos
// ===========================================================================
router.get('/backups', async (_req, res) => {
  const s = await backups.getSettings();
  res.json({
    status: 'success',
    data: { settings: backups.publicSettings(s), backups: await backups.listBackups(), running: backups.isRunning() },
  });
});

const settingsSchema = z.object({
  timezone: z.string().trim().min(3).max(50).optional(),
  backup_enabled: z.boolean().optional(),
  backup_frequency: z.enum(['daily', 'weekly']).optional(),
  backup_hour: z.coerce.number().int().min(0).max(23).optional(),
  backup_weekday: z.coerce.number().int().min(0).max(6).optional(),
  backup_keep: z.coerce.number().int().min(1, 'Mínimo 1').max(10, 'Máximo 10').optional(),
  s3_enabled: z.boolean().optional(),
  s3_endpoint: z.union([z.literal(''), z.string().trim().url('URL no válida (https://…)')]).nullish(),
  s3_region: optStr(50),
  s3_bucket: optStr(255),
  s3_prefix: optStr(255),
  s3_access_key: optStr(255),
  s3_secret: z.string().max(500).nullish(),
  s3_force_path_style: z.boolean().optional(),
  s3_keep: z.coerce.number().int().min(1, 'Mínimo 1').max(100, 'Máximo 100').optional(),
});

router.put('/backups/settings', validate({ body: settingsSchema }), async (req, res) => {
  const { s3_secret: secret, ...rest } = req.valid.body;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (secret) patch.s3_secret = secret;
  const s = await backups.updateSettings(patch, req.auth.userId);
  await audit(require('../../db/pool').pool, {
    userId: req.auth.userId, action: 'update', entity: 'backup_settings', entityId: 1, ip: req.ip,
    after: { ...patch, s3_secret: secret ? '(cambiada)' : undefined },
  });
  res.json({ status: 'success', data: backups.publicSettings(s) });
});

router.post('/backups/run', async (req, res) => {
  const { backup, done } = await backups.startBackup({ trigger: 'manual', userId: req.auth.userId });
  done.catch(() => {});
  res.status(202).json({ status: 'success', data: backup });
});

router.post('/backups/s3/test', validate({ body: settingsSchema }), async (req, res) => {
  res.json({ status: 'success', data: await backups.testS3(req.valid.body) });
});

router.post('/backups/:id/link', validate({ params: z.object({ id }), body: z.object({ source: z.enum(['local', 's3']).default('local') }) }),
  async (req, res) => {
    const link = await backups.issueLink(req.valid.params.id, req.valid.body.source);
    await audit(require('../../db/pool').pool, {
      userId: req.auth.userId, action: 'download_link', entity: 'backup', entityId: req.valid.params.id, ip: req.ip,
      after: { source: req.valid.body.source },
    });
    res.json({ status: 'success', data: link });
  });

module.exports = router;
