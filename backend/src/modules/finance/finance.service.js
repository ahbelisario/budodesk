/**
 * Finanzas del dojo: gastos y otros ingresos que no pasan por la cuenta de un alumno
 * (renta, luz, Taichi, seminarios…). Los ve y edita solo el dueño/administrador.
 */
const { pool } = require('../../db/pool');
const { tenantDb } = require('../../db/tenant');
const { todayIn, addMonths } = require('../../utils/dates');

const DEFAULTS = {
  es: {
    expense: ['Renta', 'Luz', 'Agua', 'Internet y teléfono', 'Material y equipo', 'Mantenimiento y limpieza', 'Afiliaciones y exámenes', 'Otros gastos'],
    income: ['Otras disciplinas', 'Seminarios y eventos', 'Inscripciones', 'Venta de productos', 'Otros ingresos'],
  },
  en: {
    expense: ['Rent', 'Electricity', 'Water', 'Internet and phone', 'Equipment', 'Maintenance and cleaning', 'Affiliations and exams', 'Other expenses'],
    income: ['Other disciplines', 'Seminars and events', 'Registrations', 'Product sales', 'Other income'],
  },
};

/** Crea las categorías por omisión la primera vez que el dojo usa finanzas */
async function ensureCategories(tdb) {
  const [{ n }] = await tdb.query('SELECT COUNT(*) AS n FROM finance_categories WHERE dojo_id = :dojoId');
  if (Number(n) > 0) return;
  const d = await tdb.one('SELECT language FROM dojos WHERE id = :dojoId');
  const set = DEFAULTS[d?.language] || DEFAULTS.es;
  for (const kind of ['expense', 'income']) {
    let i = 0;
    for (const name of set[kind]) {
      await tdb.query(
        'INSERT IGNORE INTO finance_categories (dojo_id, kind, name, sort_order) VALUES (:dojoId, :kind, :name, :i)',
        { kind, name, i: (i += 10) });
    }
  }
}

const monthStart = (ymd) => `${ymd.slice(0, 7)}-01`;
const withDay = (first, day) => `${first.slice(0, 8)}${String(day).padStart(2, '0')}`;

/**
 * Crea los movimientos fijos que ya tocan (hasta hoy, en la zona del dojo).
 * Idempotente: avanza last_period y la llave única (recurring_id, recurring_period) evita duplicados.
 */
async function generateRecurring(dojoId, today) {
  const tdb = tenantDb(dojoId);
  if (!today) {
    const d = await tdb.one('SELECT timezone FROM dojos WHERE id = :dojoId');
    today = todayIn(d?.timezone || 'America/Mexico_City');
  }
  const rows = await tdb.query('SELECT * FROM finance_recurring WHERE dojo_id = :dojoId AND active = 1');
  let created = 0;
  for (const r of rows) {
    let next = r.last_period ? addMonths(r.last_period, 1) : monthStart(r.starts_on);
    const stop = monthStart(today);
    while (next <= stop && (!r.ends_on || next <= monthStart(r.ends_on))) {
      const date = withDay(next, r.day_of_month);
      if (date > today) break;
      await tdb.transaction(async (t) => {
        const x = await t.query(
          `INSERT IGNORE INTO finance_entries (dojo_id, kind, category_id, description, amount, currency, entry_date, recurring_id, recurring_period, created_by)
           VALUES (:dojoId, :kind, :cat, :desc, :amount, :cur, :date, :rid, :period, :by)`,
          { kind: r.kind, cat: r.category_id, desc: r.description, amount: r.amount, cur: r.currency, date, rid: r.id, period: next, by: r.created_by });
        created += x.affectedRows;
        await t.query('UPDATE finance_recurring SET last_period = :period WHERE dojo_id = :dojoId AND id = :id', { period: next, id: r.id });
      });
      next = addMonths(next, 1);
    }
  }
  return created;
}

/** Para el programador: todos los dojos con movimientos fijos activos */
async function generateRecurringAll() {
  const [dojos] = await pool.query(
    `SELECT DISTINCT d.id, d.timezone FROM dojos d JOIN finance_recurring r ON r.dojo_id = d.id AND r.active = 1
      WHERE d.status IN ('trial','active')`);
  let total = 0;
  for (const d of dojos) total += await generateRecurring(d.id, todayIn(d.timezone));
  return total;
}

module.exports = { ensureCategories, generateRecurring, generateRecurringAll, DEFAULTS };
