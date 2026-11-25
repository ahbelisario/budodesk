/**
 * Tareas periódicas dentro del proceso (sin cron externo):
 *   cada hora   → facturación, generación de sesiones, recordatorios de pago
 *   cada minuto → envío de notificaciones (push/email)
 * Todas son idempotentes: correrlas de más no duplica nada.
 * Si algún día corres varias réplicas del backend, deja BILLING_SCHEDULER=true
 * solo en una.
 */
const { pool } = require('../db/pool');
const { runBillingAll } = require('../modules/memberships/memberships.service');
const { extendAllDojos } = require('../modules/classes/classes.service');
const { processDeliveries, paymentReminders } = require('../modules/notifications/notify.service');
const { todayIn, addDays } = require('../utils/dates');

let running = false;

async function hourly() {
  if (running) return;
  running = true;
  try {
    const billing = await runBillingAll();
    const sessions = await extendAllDojos();
    const [dojos] = await pool.query(`SELECT id, timezone FROM dojos WHERE status IN ('trial','active')`);
    for (const d of dojos) await paymentReminders(d.id, todayIn(d.timezone), { addDays });
    await require('../modules/online/online.service').expireStale();
    const changed = billing.filter((b) => b.renewed || b.past_due || b.expired || b.activated);
    if (changed.length || sessions) console.log(`[jobs] facturación ${JSON.stringify(changed)} · sesiones nuevas ${sessions}`);
  } catch (e) {
    console.error('[jobs] error:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  setTimeout(hourly, 10_000).unref();
  setInterval(hourly, 60 * 60 * 1000).unref();
  setInterval(() => processDeliveries().catch((e) => console.error('[jobs] envíos:', e.message)), 60 * 1000).unref();
}

module.exports = { start, hourly };
