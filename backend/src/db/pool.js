const mysql = require('mysql2/promise');
const env = require('../config/env');

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_POOL_SIZE,
  namedPlaceholders: true,   // consultas con :nombre en vez de ?
  decimalNumbers: true,      // DECIMAL → number
  dateStrings: ['DATE'],     // DATE como 'YYYY-MM-DD' (sin corrimientos de zona horaria)
  timezone: 'Z',
  charset: 'utf8mb4',
});

// Todas las sesiones en UTC: NOW() y los DATETIME coinciden con timezone 'Z'
// sin importar la zona horaria del servidor MySQL. La zona del dojo se aplica
// al mostrar/calcular fechas locales (dojos.timezone).
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

/**
 * Ejecuta fn(conn) dentro de una transacción. Si fn lanza, hace rollback.
 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Primera fila o null */
async function one(executor, sql, params) {
  const [rows] = await executor.query(sql, params);
  return rows[0] ?? null;
}

module.exports = { pool, withTransaction, one };
