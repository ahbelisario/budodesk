const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const service = require('./auth.service');

const router = express.Router();

// 10 intentos de login por IP + identificador cada 15 min (además del bloqueo por cuenta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${rateLimit.ipKeyGenerator(req.ip)}|${String(req.body?.identifier ?? '').toLowerCase()}`,
  message: { status: 'error', code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera unos minutos.' },
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { status: 'error', code: 'RATE_LIMITED', message: 'Demasiadas solicitudes.' },
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(150),   // email o usuario
  password: z.string().min(1).max(200),
  dojo_slug: z.string().trim().max(60).optional(), // p.ej. desde el subdominio
});

const refreshSchema = z.object({ refresh_token: z.string().min(20).max(200) });
const switchSchema = z.object({ dojo_id: z.coerce.number().int().positive() });

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

router.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { identifier, password, dojo_slug: dojoSlug } = req.valid.body;
  const data = await service.login({ identifier, password, dojoSlug, ...ctx(req) });
  res.json({ status: 'success', data });
});

router.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), async (req, res) => {
  const data = await service.refresh({ refreshToken: req.valid.body.refresh_token, ...ctx(req) });
  res.json({ status: 'success', data });
});

router.post('/switch-dojo', authenticate, validate({ body: switchSchema }), async (req, res) => {
  const data = await service.switchDojo({
    userId: req.auth.userId, sessionId: req.auth.sessionId, dojoId: req.valid.body.dojo_id,
    isSuperadmin: req.auth.isSuperadmin,
  });
  res.json({ status: 'success', data });
});

router.post('/logout', authenticate, async (req, res) => {
  await service.logout({ sessionId: req.auth.sessionId });
  res.json({ status: 'success' });
});

router.post('/logout-all', authenticate, async (req, res) => {
  await service.logoutAll({ userId: req.auth.userId });
  res.json({ status: 'success' });
});

router.get('/me', authenticate, async (req, res) => {
  const data = await service.me(req.auth);
  res.json({ status: 'success', data });
});

module.exports = router;
