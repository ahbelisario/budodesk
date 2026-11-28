/**
 * Política de contraseñas de la plataforma (platform_settings.pw_*).
 * Las mismas reglas se muestran en vivo en el frontend (GET /account/password-policy).
 */
const { pool, one } = require('../db/pool');
const { AppError } = require('../utils/errors');

const DEFAULT = { min_length: 10, require_upper: false, require_lower: false, require_number: false, require_symbol: false };
const MAX_LENGTH = 200;
let cache = null; let cachedAt = 0;

async function getPolicy() {
  if (cache && Date.now() - cachedAt < 60_000) return cache;
  const s = await one(pool,
    'SELECT pw_min_length, pw_require_upper, pw_require_lower, pw_require_number, pw_require_symbol FROM platform_settings WHERE id = 1');
  cache = s ? {
    min_length: Number(s.pw_min_length) || DEFAULT.min_length,
    require_upper: !!s.pw_require_upper, require_lower: !!s.pw_require_lower,
    require_number: !!s.pw_require_number, require_symbol: !!s.pw_require_symbol,
  } : { ...DEFAULT };
  cachedAt = Date.now();
  return cache;
}

async function setPolicy(p, userId) {
  await pool.query(
    `UPDATE platform_settings SET pw_min_length = :min, pw_require_upper = :up, pw_require_lower = :low,
            pw_require_number = :num, pw_require_symbol = :sym, updated_by = :by WHERE id = 1`,
    { min: p.min_length, up: p.require_upper ? 1 : 0, low: p.require_lower ? 1 : 0, num: p.require_number ? 1 : 0, sym: p.require_symbol ? 1 : 0, by: userId });
  cache = null;
  return getPolicy();
}

/** Reglas que la contraseña no cumple (claves estables para el frontend) */
function failures(pw, p) {
  const out = [];
  if (pw.length < p.min_length) out.push('min_length');
  if (p.require_upper && !/\p{Lu}/u.test(pw)) out.push('upper');
  if (p.require_lower && !/\p{Ll}/u.test(pw)) out.push('lower');
  if (p.require_number && !/\p{Nd}/u.test(pw)) out.push('number');
  if (p.require_symbol && !/[^\p{L}\p{Nd}\s]/u.test(pw)) out.push('symbol');
  return out;
}

const TEXT = {
  min_length: (p) => `al menos ${p.min_length} caracteres`, upper: () => 'una mayúscula', lower: () => 'una minúscula',
  number: () => 'un número', symbol: () => 'un símbolo (p. ej. ! # $ %)',
};

async function assertPassword(pw) {
  if (typeof pw !== 'string') throw new AppError(400, 'PASSWORD_WEAK', 'Escribe una contraseña');
  if (pw.length > MAX_LENGTH) throw new AppError(400, 'PASSWORD_WEAK', 'La contraseña es demasiado larga');
  const p = await getPolicy();
  const f = failures(pw, p);
  if (f.length) {
    throw new AppError(400, 'PASSWORD_WEAK', `La contraseña debe tener ${f.map((k) => TEXT[k](p)).join(', ')}.`, f.map((k) => ({ rule: k })));
  }
}

module.exports = { getPolicy, setPolicy, assertPassword, failures, DEFAULT };
