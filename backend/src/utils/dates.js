/**
 * Fechas "de calendario" (YYYY-MM-DD) en la zona horaria del dojo.
 * Toda la lógica de negocio (vencimientos, periodos, clases) trabaja con
 * fechas locales del dojo, no con UTC.
 */

/** Hoy en la zona del dojo → 'YYYY-MM-DD' */
function todayIn(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
}

/** Hora local del dojo → 'HH:MM:SS' */
function nowTimeIn(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(now);
}

/**
 * Convierte fecha + hora locales del dojo a un Date (instante UTC).
 * Necesario para "faltan N horas para la clase".
 */
function zonedToUtc(dateStr, timeStr, timezone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss = 0] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  // offset de la zona en ese instante
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(guess - (asLocal - guess));
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const fmt = (dt) => dt.toISOString().slice(0, 10);

function addDays(s, n) {
  const dt = parseDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

/** Suma meses respetando fin de mes (31 ene + 1 mes = 28/29 feb) */
function addMonths(s, n) {
  const dt = parseDate(s);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return fmt(dt);
}

/** Fin de un periodo que empieza en `start`: el día anterior al siguiente inicio */
function periodEnd(start, unit, count = 1) {
  const next = unit === 'week' ? addDays(start, 7 * count)
    : unit === 'year' ? addMonths(start, 12 * count)
      : addMonths(start, count);
  return addDays(next, -1);
}

/** 0 = lunes … 6 = domingo */
function weekdayIndex(s) {
  return (parseDate(s).getUTCDay() + 6) % 7;
}
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Lunes de la semana de `s` */
const weekStart = (s) => addDays(s, -weekdayIndex(s));

function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

function ageOn(dob, onDate) {
  if (!dob) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  return y - by - ((m < bm || (m === bm && d < bd)) ? 1 : 0);
}

module.exports = {
  todayIn, nowTimeIn, zonedToUtc, addDays, addMonths, periodEnd,
  weekdayIndex, weekStart, WEEKDAYS, daysBetween, ageOn,
};
