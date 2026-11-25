const env = require('./config/env');
const { pool } = require('./db/pool');
const { createApp } = require('./app');

async function main() {
  // Falla rápido si la BD no responde
  await pool.query('SELECT 1');
  // Tablas de la plataforma (respaldos): se crean si faltan, nunca se modifican
  await require('./db/platformTables').ensurePlatformTables();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`BudoDesk API v2 escuchando en :${env.PORT} (${env.NODE_ENV})`);
  });
  if (env.BILLING_SCHEDULER) require('./jobs/scheduler').start();
  // Respaldos programados (si corres varias réplicas, déjalo activo solo en una)
  if (env.BACKUP_SCHEDULER) require('./modules/platform/backups.service').startScheduler();

  const shutdown = (signal) => {
    console.log(`${signal} recibido, cerrando…`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err.message);
  process.exit(1);
});
