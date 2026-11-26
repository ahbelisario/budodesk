/**
 * /api/v2/signup — registro público de dojos nuevos (sin sesión)
 *
 *   GET  /config          ¿se aceptan registros? + días de prueba + correo de contacto (SUPPORT_EMAIL)
 *   GET  /slug?slug=x     ¿está libre esa dirección?
 *   POST /                envía la solicitud (queda pendiente de aprobación)
 */
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const env = require('../../config/env');
const svc = require('./signup.service');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: env.NODE_ENV === 'test' ? 1000 : 5, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { status: 'error', code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta más tarde.' },
});
const slugLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
  'La dirección lleva de 3 a 40 letras minúsculas, números o guiones (sin guion al inicio ni al final)');
const optStr = (n) => z.string().trim().max(n).optional();

router.get('/config', async (_req, res) => {
  const s = await svc.platformSettings();
  res.json({ status: 'success', data: { enabled: s.signup_enabled, trial_days: s.trial_days, contact: env.SUPPORT_EMAIL || null } });
});

router.get('/slug', slugLimiter, validate({ query: z.object({ slug }) }), async (req, res) => {
  res.json({ status: 'success', data: await svc.slugStatus(req.valid.query.slug) });
});

const body = z.object({
  dojo_name: z.string().trim().min(2, 'Escribe el nombre del dojo').max(255),
  slug,
  first_name: z.string().trim().min(1, 'Escribe tu nombre').max(100),
  last_name: optStr(100),
  email: z.email('Correo no válido').max(150).transform((s) => s.toLowerCase()),
  phone: optStr(50),
  city: optStr(100),
  country_code: z.string().trim().toUpperCase().length(2).default('MX'),
  timezone: z.string().trim().min(3).max(50).default('America/Mexico_City'),
  currency: z.string().trim().toUpperCase().length(3).default('MXN'),
  language: z.enum(['es', 'en']).default('es'),
  disciplines: optStr(255),
  students_estimate: z.coerce.number().int().min(0).max(10000).optional(),
  message: optStr(2000),
  terms_accepted: z.literal(true, { message: 'Debes aceptar los términos y el aviso de privacidad' }),
  website: z.string().max(200).optional(), // trampa para bots: el formulario lo deja vacío
}).refine((b) => { try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); return true; } catch { return false; } },
  { message: 'Zona horaria no válida', path: ['timezone'] });

router.post('/', limiter, validate({ body }), async (req, res) => {
  const { website, terms_accepted: _t, ...b } = req.valid.body;
  if (website) return res.status(201).json({ status: 'success', data: { status: 'pending' } }); // bot: no se guarda
  const data = await svc.submit(b, { ip: req.ip, userAgent: req.headers['user-agent'] });
  res.status(201).json({ status: 'success', data });
});

module.exports = router;
