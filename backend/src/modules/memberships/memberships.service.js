/**
 * Reglas de membresías y el proceso diario de facturación.
 */
const { tenantDb } = require('../../db/tenant');
const { pool } = require('../../db/pool');
const { todayIn, addDays, periodEnd } = require('../../utils/dates');
const { createCharge, round2 } = require('../billing/charges.service');

function discountAmount(price, type, value) {
  if (!type || type === 'none' || !value) return 0;
  if (type === 'percent') return round2(Math.min(price, (price * value) / 100));
  return round2(Math.min(price, value));
}

/** Periodo inicial según el tipo de plan */
function initialPeriod(plan, start) {
  if (plan.billing_type === 'recurring') {
    const end = periodEnd(start, plan.interval_unit, plan.interval_count || 1);
    return { current_period_start: start, current_period_end: end, end_date: null, next_billing_date: addDays(end, 1) };
  }
  const end = plan.validity_days ? addDays(start, plan.validity_days - 1) : null;
  return { current_period_start: start, current_period_end: end, end_date: end, next_billing_date: null };
}

const MONTHS = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
function periodLabel(planName, start, end, lang = 'es') {
  const [y, m] = start.split('-').map(Number);
  const months = MONTHS[lang] || MONTHS.es;
  if (end && end.slice(0, 7) !== start.slice(0, 7) && Number(end.slice(8)) < 28) {
    return `${planName} · ${start} – ${end}`;
  }
  return `${planName} · ${months[m - 1]} ${y}`;
}

/** Cargo de un periodo de la membresía (idempotente por la llave única membership+tipo+periodo) */
async function chargePeriod(t, ms, { start, end, dueDate, lang, createdBy }) {
  try {
    return await createCharge(t, {
      user_id: ms.payer_user_id, membership_id: ms.id, type: 'membership',
      description: periodLabel(ms.plan_name, start, end, lang),
      period_start: start, period_end: end,
      amount: ms.price, discount_amount: discountAmount(ms.price, ms.discount_type, ms.discount_value),
      currency: ms.currency, due_date: dueDate ?? start, created_by: createdBy ?? null,
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return null; // ya existía
    throw e;
  }
}

/**
 * Facturación diaria de un dojo. Idempotente: se puede correr N veces al día.
 *  1. pending → active cuando llega la fecha de inicio
 *  2. pausas: active ↔ paused según las fechas de congelamiento
 *  3. renovaciones: genera el cargo del siguiente periodo y avanza el periodo
 *  4. cancelaciones programadas al fin de periodo
 *  5. paquetes / pruebas vencidos o sin clases → expired
 *  6. adeudos vencidos → past_due (+ recargo si el dojo lo configuró)
 */
async function runBillingForDojo(dojoId, { now = new Date() } = {}) {
  const tdb = tenantDb(dojoId);
  const dojo = await tdb.one(
    `SELECT d.timezone, d.language, s.late_fee_amount, s.late_fee_grace_days
       FROM dojos d LEFT JOIN dojo_payment_settings s ON s.dojo_id = d.id WHERE d.id = :dojoId`);
  const today = todayIn(dojo.timezone, now);
  const stats = { activated: 0, paused: 0, resumed: 0, renewed: 0, cancelled: 0, expired: 0, past_due: 0, late_fees: 0 };

  await tdb.transaction(async (t) => {
    stats.activated = (await t.query(
      `UPDATE memberships SET status = 'active' WHERE dojo_id = :dojoId AND status = 'pending' AND start_date <= :today`, { today })).affectedRows;

    const PAUSED_TODAY = `EXISTS (SELECT 1 FROM membership_pauses p WHERE p.dojo_id = memberships.dojo_id
                            AND p.membership_id = memberships.id AND :today BETWEEN p.start_date AND p.end_date)`;
    stats.paused = (await t.query(
      `UPDATE memberships SET status = 'paused' WHERE dojo_id = :dojoId AND status IN ('active','past_due') AND ${PAUSED_TODAY}`, { today })).affectedRows;
    stats.resumed = (await t.query(
      `UPDATE memberships SET status = 'active' WHERE dojo_id = :dojoId AND status = 'paused' AND NOT ${PAUSED_TODAY}`, { today })).affectedRows;

    // Renovaciones (puede ponerse al corriente de varios periodos si el job no corrió)
    const due = await t.query(
      `SELECT ms.id, ms.payer_user_id, ms.price, ms.currency, ms.discount_type, ms.discount_value,
              ms.next_billing_date, ms.end_date, pl.name AS plan_name, pl.interval_unit, pl.interval_count
         FROM memberships ms JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
        WHERE ms.dojo_id = :dojoId AND ms.status IN ('active','past_due') AND pl.billing_type = 'recurring'
          AND ms.auto_renew = 1 AND ms.cancel_at_period_end = 0
          AND ms.next_billing_date IS NOT NULL AND ms.next_billing_date <= :today
          AND (ms.end_date IS NULL OR ms.next_billing_date <= ms.end_date)
        FOR UPDATE`, { today });
    for (const ms of due) {
      let start = ms.next_billing_date;
      let periodStart;
      let end;
      let guard = 0;
      while (start <= today && (!ms.end_date || start <= ms.end_date) && guard++ < 24) {
        periodStart = start;
        end = periodEnd(start, ms.interval_unit, ms.interval_count || 1);
        await chargePeriod(t, ms, { start, end, dueDate: start, lang: dojo.language });
        start = addDays(end, 1);
        stats.renewed++;
      }
      if (periodStart) {
        await t.query(
          `UPDATE memberships SET current_period_start = :ps, current_period_end = :pe, next_billing_date = :nb
            WHERE dojo_id = :dojoId AND id = :id`,
          { ps: periodStart, pe: end, nb: start, id: ms.id });
      }
    }

    stats.cancelled = (await t.query(
      `UPDATE memberships SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
        WHERE dojo_id = :dojoId AND status IN ('active','past_due','paused') AND cancel_at_period_end = 1
          AND current_period_end < :today`, { today })).affectedRows;

    stats.expired = (await t.query(
      `UPDATE memberships ms JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
          SET ms.status = 'expired'
        WHERE ms.dojo_id = :dojoId AND ms.status IN ('active','past_due','paused')
          AND ( (ms.end_date IS NOT NULL AND ms.end_date < :today)
             OR (pl.billing_type = 'recurring' AND ms.auto_renew = 0 AND ms.current_period_end < :today)
             OR (pl.billing_type = 'class_pack' AND ms.sessions_remaining = 0) )`, { today })).affectedRows;

    const grace = dojo.late_fee_grace_days ?? 0;
    const limit = addDays(today, -grace);
    stats.past_due = (await t.query(
      `UPDATE memberships ms SET ms.status = 'past_due'
        WHERE ms.dojo_id = :dojoId AND ms.status = 'active'
          AND EXISTS (SELECT 1 FROM charges c WHERE c.dojo_id = ms.dojo_id AND c.membership_id = ms.id
                       AND c.status IN ('pending','partial') AND c.due_date < :limit)`, { limit })).affectedRows;

    if (dojo.late_fee_amount > 0) {
      const overdue = await t.query(
        `SELECT c.id, c.user_id, c.membership_id, c.period_start, c.currency, c.description
           FROM charges c
          WHERE c.dojo_id = :dojoId AND c.type = 'membership' AND c.status IN ('pending','partial') AND c.due_date < :limit
            AND NOT EXISTS (SELECT 1 FROM charges l WHERE l.dojo_id = c.dojo_id AND l.membership_id = c.membership_id
                             AND l.type = 'late_fee' AND l.period_start = c.period_start)`, { limit });
      for (const c of overdue) {
        try {
          await createCharge(t, {
            user_id: c.user_id, membership_id: c.membership_id, type: 'late_fee', description: `Recargo · ${c.description}`,
            period_start: c.period_start, amount: dojo.late_fee_amount, currency: c.currency, due_date: today,
          });
          stats.late_fees++;
        } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
      }
    }
  });
  return { dojo_id: dojoId, today, ...stats };
}

async function runBillingAll(opts) {
  const [dojos] = await pool.query(`SELECT id FROM dojos WHERE status IN ('trial','active')`);
  const results = [];
  for (const d of dojos) {
    try { results.push(await runBillingForDojo(d.id, opts)); } catch (e) {
      console.error(`[billing] dojo ${d.id}:`, e.message);
      results.push({ dojo_id: d.id, error: e.message });
    }
  }
  return results;
}

module.exports = { discountAmount, initialPeriod, chargePeriod, periodLabel, runBillingForDojo, runBillingAll };
