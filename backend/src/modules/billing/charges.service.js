/**
 * Lógica compartida de cargos y pagos. Todas las funciones reciben un
 * tenantDb en transacción (t) para que los saldos queden consistentes.
 */
const { badRequest, conflict } = require('../../utils/errors');

const round2 = (n) => Math.round(n * 100) / 100;

async function createCharge(t, c) {
  const r = await t.query(
    `INSERT INTO charges (dojo_id, user_id, membership_id, type, description, period_start, period_end,
                          amount, discount_amount, currency, due_date, created_by)
     VALUES (:dojoId, :user_id, :membership_id, :type, :description, :period_start, :period_end,
             :amount, :discount_amount, :currency, :due_date, :created_by)`,
    {
      user_id: c.user_id, membership_id: c.membership_id ?? null, type: c.type, description: c.description,
      period_start: c.period_start ?? null, period_end: c.period_end ?? null,
      amount: round2(c.amount), discount_amount: round2(c.discount_amount ?? 0),
      currency: c.currency, due_date: c.due_date, created_by: c.created_by ?? null,
    });
  // Si la persona tiene saldo a favor (pagos sin aplicar), se usa de inmediato
  await applyCredit(t, c.user_id, c.currency);
  return r.insertId;
}

/** Pagos completados de la persona con dinero aún sin aplicar */
async function creditPayments(t, userId, currency, lock = false) {
  return t.query(
    `SELECT py.id, ROUND(py.amount - py.refunded_amount - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
              WHERE pa.dojo_id = py.dojo_id AND pa.payment_id = py.id), 0), 2) AS unapplied
       FROM payments py
      WHERE py.dojo_id = :dojoId AND py.user_id = :userId AND py.currency = :currency AND py.status = 'completed'
     HAVING unapplied > 0.004
      ORDER BY py.id ${lock ? 'FOR UPDATE' : ''}`, { userId, currency });
}

/** Saldo a favor total de una persona */
async function creditBalance(t, userId, currency) {
  const rows = await creditPayments(t, userId, currency);
  return round2(rows.reduce((s, r) => s + Number(r.unapplied), 0));
}

/** Aplica el saldo a favor a los cargos pendientes más antiguos */
async function applyCredit(t, userId, currency) {
  const credits = await creditPayments(t, userId, currency, true);
  if (!credits.length) return 0;
  const open = await t.query(
    `SELECT id, total - amount_paid AS open FROM charges
      WHERE dojo_id = :dojoId AND user_id = :userId AND currency = :currency AND status IN ('pending','partial')
      ORDER BY due_date, id FOR UPDATE`, { userId, currency });
  let applied = 0;
  for (const ch of open) {
    let need = round2(Number(ch.open));
    for (const p of credits) {
      if (need <= 0) break;
      const avail = round2(Number(p.unapplied));
      if (avail <= 0) continue;
      const a = round2(Math.min(avail, need));
      await t.query(
        `INSERT INTO payment_allocations (dojo_id, payment_id, charge_id, amount) VALUES (:dojoId, :p, :c, :a)
         ON DUPLICATE KEY UPDATE amount = amount + VALUES(amount)`, { p: p.id, c: ch.id, a });
      await t.query('UPDATE charges SET amount_paid = amount_paid + :a WHERE dojo_id = :dojoId AND id = :c', { a, c: ch.id });
      p.unapplied = round2(avail - a);
      need = round2(need - a);
      applied = round2(applied + a);
    }
    await refreshChargeStatus(t, ch.id);
  }
  return applied;
}

/** Recalcula status de un cargo a partir de amount_paid */
async function refreshChargeStatus(t, chargeId) {
  await t.query(
    `UPDATE charges SET status = CASE
        WHEN status IN ('void','refunded') THEN status
        WHEN amount_paid >= total THEN 'paid'
        WHEN amount_paid > 0 THEN 'partial'
        ELSE 'pending' END
      WHERE dojo_id = :dojoId AND id = :chargeId`, { chargeId });
}

/**
 * Aplica un pago a cargos. Si no se indican, se aplica a los pendientes más
 * antiguos del pagador (y de los menores/familiares cuyos cargos están a su nombre).
 * Devuelve el monto sobrante (saldo a favor no aplicado).
 */
async function allocatePayment(t, { paymentId, userId, amount, currency, allocations }) {
  let remaining = round2(amount);
  let targets;
  if (allocations?.length) {
    targets = [];
    for (const a of allocations) {
      const ch = await t.one(
        `SELECT id, user_id, total - amount_paid AS open, currency, status FROM charges
          WHERE dojo_id = :dojoId AND id = :id FOR UPDATE`, { id: a.charge_id });
      if (!ch) throw badRequest(`Cargo ${a.charge_id} no encontrado`);
      if (!['pending', 'partial'].includes(ch.status)) throw conflict(`El cargo ${a.charge_id} no está pendiente`, 'CHARGE_NOT_OPEN');
      if (ch.currency !== currency) throw badRequest('La moneda del pago no coincide con la del cargo');
      if (a.amount > ch.open + 0.001) throw badRequest(`El monto excede el saldo del cargo ${a.charge_id}`);
      targets.push({ id: ch.id, apply: round2(a.amount) });
    }
    const sum = round2(targets.reduce((s, x) => s + x.apply, 0));
    if (sum > remaining + 0.001) throw badRequest('Las aplicaciones suman más que el pago');
  } else {
    const open = await t.query(
      `SELECT id, total - amount_paid AS open FROM charges
        WHERE dojo_id = :dojoId AND user_id = :userId AND currency = :currency AND status IN ('pending','partial')
        ORDER BY due_date, id FOR UPDATE`, { userId, currency });
    targets = [];
    for (const ch of open) {
      if (remaining <= 0) break;
      const apply = round2(Math.min(remaining, ch.open));
      targets.push({ id: ch.id, apply });
      remaining = round2(remaining - apply);
    }
    remaining = round2(amount);
  }

  for (const x of targets) {
    if (x.apply <= 0) continue;
    await t.query(
      'INSERT INTO payment_allocations (dojo_id, payment_id, charge_id, amount) VALUES (:dojoId, :p, :c, :a)',
      { p: paymentId, c: x.id, a: x.apply });
    await t.query('UPDATE charges SET amount_paid = amount_paid + :a WHERE dojo_id = :dojoId AND id = :c', { a: x.apply, c: x.id });
    await refreshChargeStatus(t, x.id);
    remaining = round2(remaining - x.apply);
  }
  return { applied: targets.filter((x) => x.apply > 0), unapplied: remaining };
}

/** Revierte las aplicaciones de un pago (al cancelarlo o reembolsarlo) */
async function reversePayment(t, paymentId) {
  const allocs = await t.query(
    'SELECT charge_id, amount FROM payment_allocations WHERE dojo_id = :dojoId AND payment_id = :p FOR UPDATE', { p: paymentId });
  for (const a of allocs) {
    await t.query('UPDATE charges SET amount_paid = GREATEST(0, amount_paid - :a) WHERE dojo_id = :dojoId AND id = :c', { a: a.amount, c: a.charge_id });
    await refreshChargeStatus(t, a.charge_id);
  }
  await t.query('DELETE FROM payment_allocations WHERE dojo_id = :dojoId AND payment_id = :p', { p: paymentId });
  return allocs;
}

/** Al pagarse un cargo de membresía vencida, la membresía vuelve a 'active' si ya no debe nada vencido */
async function reactivatePaidMemberships(t, userId, today) {
  await t.query(
    `UPDATE memberships ms SET ms.status = 'active'
      WHERE ms.dojo_id = :dojoId AND ms.payer_user_id = :userId AND ms.status = 'past_due'
        AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.dojo_id = ms.dojo_id AND c.membership_id = ms.id
                         AND c.status IN ('pending','partial') AND c.due_date < :today)`, { userId, today });
}

module.exports = { createCharge, allocatePayment, reversePayment, refreshChargeStatus, reactivatePaidMemberships, applyCredit, creditBalance, round2 };
