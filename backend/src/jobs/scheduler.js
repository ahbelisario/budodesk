/**
 * Tareas periódicas dentro del proceso (sin cron externo):
 *   cada hora   → facturación, generación de sesiones, recordatorios de pago, fin de pruebas, gastos/ingresos fijos del mes
 *   cada minuto → envío de notificaciones (push/email)
 * Si una tarea falla se abre una alerta de monitoreo (Plataforma → Monitoreo) y las demás siguen.
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
const monitor = () => require('../modules/platform/monitor.service');

/** Corre una tarea; si falla, alerta (y sigue con las demás). Si funciona, cierra su alerta. */
async function job(name, label, fn) {
  try {
    const r = await fn();
    await monitor().resolve('job', name);
    return r;
  } catch (e) {
    console.error(`[jobs] ${name}:`, e.message);
    await monitor().raise({
      kind: 'job', key: name, severity: 'critical',
      title: `Falló una tarea automática: ${label}`,
      detail: `${e.message}. Se reintenta cada hora; revisa los registros del backend (./deploy.sh logs backend).`,
    });
    return null;
  }
}

async function hourly() {
  if (running) return;
  running = true;
  try {
    const billing = (await job('billing', 'cobro de membresías', runBillingAll)) || [];
    const sessions = await job('sessions', 'generación de clases', extendAllDojos);
    await job('reminders', 'recordatorios de pago', async () => {
      const [dojos] = await pool.query(`SELECT id, timezone FROM dojos WHERE status IN ('trial','active')`);
      for (const d of dojos) await paymentReminders(d.id, todayIn(d.timezone), { addDays });
    });
    await job('checkouts', 'pagos en línea abandonados', () => require('../modules/online/online.service').expireStale());
    const trials = await job('trials', 'fin de pruebas gratis', () => require('../modules/signup/signup.service').trialSweep());
    if (trials && (trials.notified || trials.expired)) console.log(`[jobs] pruebas: ${JSON.stringify(trials)}`);
    const recurring = await job('recurring', 'gastos e ingresos fijos', () => require('../modules/finance/finance.service').generateRecurringAll());
    if (recurring) console.log(`[jobs] movimientos fijos creados: ${recurring}`);
    const changed = billing.filter((b) => b.renewed || b.past_due || b.expired || b.activated);
    if (changed.length || sessions) console.log(`[jobs] facturación ${JSON.stringify(changed)} · sesiones nuevas ${sessions}`);
  } finally {
    running = false;
  }
}

function start() {
  setTimeout(hourly, 10_000).unref();
  setInterval(hourly, 60 * 60 * 1000).unref();
  setInterval(() => job('deliveries', 'envío de notificaciones', processDeliveries), 60 * 1000).unref();
}

module.exports = { start, hourly, job };
