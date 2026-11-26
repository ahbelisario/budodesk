const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // imágenes usables desde la app
  app.use(cors({
    // Sin lista = solo mismo origen (producción detrás de nginx)
    origin: env.corsOrigins.length ? env.corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '1mb' }));

  // Archivos subidos (logos, fotos). Nombres aleatorios; nunca se ejecutan.
  app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR), {
    maxAge: '30d', immutable: true, index: false, dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }));

  app.get('/api/v2/health', (_req, res) => res.json({ status: 'success', data: { ok: true } }));

  const { account, me } = require('./modules/account/account.routes');
  const { plans, discounts } = require('./modules/plans/plans.routes');
  const { charges, payments } = require('./modules/billing/billing.routes');
  const { dojo, uploads } = require('./modules/dojo/dojo.routes');
  const { notifications, announcements, registerEventHandlers } = require('./modules/notifications/notifications.routes');

  app.use('/api/v2/auth', require('./modules/auth/auth.routes'));
  app.use('/api/v2/account', account);
  app.use('/api/v2/me', me);
  app.use('/api/v2/dojo', dojo);
  app.use('/api/v2/uploads', uploads);
  app.use('/api/v2/members', require('./modules/members/members.routes'));
  app.use('/api/v2/disciplines', require('./modules/disciplines/disciplines.routes'));
  app.use('/api/v2/ranks', require('./modules/ranks/ranks.routes'));
  app.use('/api/v2/progress', require('./modules/ranks/progress.routes'));
  app.use('/api/v2/exams', require('./modules/ranks/exams.routes'));
  app.use('/api/v2/plans', plans);
  app.use('/api/v2/discounts', discounts);
  app.use('/api/v2/memberships', require('./modules/memberships/memberships.routes'));
  app.use('/api/v2/charges', charges);
  app.use('/api/v2/payments', payments);
  app.use('/api/v2/classes', require('./modules/classes/classes.routes'));
  app.use('/api/v2/dashboard', require('./modules/dashboard/dashboard.routes'));
  app.use('/api/v2/notifications', notifications);
  app.use('/api/v2/announcements', announcements);
  app.use('/api/v2/platform', require('./modules/platform/platform.routes'));
  app.use('/api/v2/online-payments', require('./modules/online/online.routes'));
  app.use('/api/v2/finance', require('./modules/finance/finance.routes'));
  app.use('/api/v2/reports', require('./modules/reports/reports.routes'));

  registerEventHandlers(app);

  app.use('/api/v2', notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
