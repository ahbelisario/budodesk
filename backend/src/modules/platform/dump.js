/**
 * Volcado de la base a SQL, sin depender de mysqldump.
 *
 * - Una sola conexión con una "foto" consistente (REPEATABLE READ + snapshot):
 *   lo que se escribe durante el respaldo no lo desordena.
 * - Tablas: DROP + CREATE (SHOW CREATE TABLE) + INSERT en lotes.
 *   Las columnas calculadas (VIRTUAL/STORED GENERATED) no se insertan: MySQL las recalcula.
 *   Ojo: las de DEFAULT CURRENT_TIMESTAMP aparecen como DEFAULT_GENERATED y SÍ se respaldan.
 * - Vistas al final, sin DEFINER (se restauran con el usuario que restaure).
 * - Fechas en UTC (time_zone '+00:00') tanto al leer como al restaurar.
 */
const mysql = require('mysql2');
const env = require('../../config/env');

const BATCH = 200;

function connect() {
  return mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
    socketPath: process.env.TEST_DB_SOCKET || undefined,
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z', charset: 'utf8mb4',
    // JSON tal cual viene (texto), no como objeto
    typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
  });
}

const q = (conn, sql, params) => new Promise((resolve, reject) => {
  conn.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

/** Escribe respetando la contrapresión del stream de salida */
function writer(out) {
  return (text) => (out.write(text) ? Promise.resolve() : new Promise((r) => out.once('drain', r)));
}

/**
 * Vuelca la base a `out` (stream de escritura). No lo cierra.
 * Devuelve { tables, views, rows }.
 */
async function dumpDatabase(out) {
  const conn = connect();
  const write = writer(out);
  let rowsTotal = 0;
  try {
    await q(conn, "SET time_zone = '+00:00'");
    await q(conn, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await q(conn, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

    const all = await q(conn, 'SHOW FULL TABLES');
    const nameKey = Object.keys(all[0] || {}).find((k) => k.startsWith('Tables_in_'));
    const tables = all.filter((t) => t.Table_type === 'BASE TABLE').map((t) => t[nameKey]).sort();
    const views = all.filter((t) => t.Table_type === 'VIEW').map((t) => t[nameKey]).sort();

    await write([
      '-- BudoDesk · respaldo de la base de datos',
      `-- Creado: ${new Date().toISOString()} · base: ${env.DB_NAME}`,
      '-- Restaurar: ./deploy.sh restore ARCHIVO (ver DEPLOY.md)',
      '',
      'SET NAMES utf8mb4;',
      "SET time_zone = '+00:00';",
      'SET FOREIGN_KEY_CHECKS = 0;',
      'SET UNIQUE_CHECKS = 0;',
      "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
      '',
    ].join('\n'));

    for (const v of views) await write(`DROP VIEW IF EXISTS \`${v}\`;\n`);

    for (const table of tables) {
      const [create] = await q(conn, `SHOW CREATE TABLE \`${table}\``);
      await write(`\n-- Tabla ${table}\nDROP TABLE IF EXISTS \`${table}\`;\n${create['Create Table']};\n`);

      const cols = (await q(conn,
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%VIRTUAL GENERATED%' AND EXTRA NOT LIKE '%STORED GENERATED%'
          ORDER BY ORDINAL_POSITION`, [table])).map((c) => c.COLUMN_NAME);
      const colList = cols.map((c) => `\`${c}\``).join(', ');

      const rows = [];
      const flush = async () => {
        if (!rows.length) return;
        await write(`INSERT INTO \`${table}\` (${colList}) VALUES\n${rows.join(',\n')};\n`);
        rows.length = 0;
      };

      // Lectura en stream: no carga la tabla completa en memoria
      await new Promise((resolve, reject) => {
        const stream = conn.query(`SELECT ${colList} FROM \`${table}\``).stream();
        stream.on('data', (row) => {
          rows.push(`(${cols.map((c) => conn.escape(row[c])).join(', ')})`);
          rowsTotal += 1;
          if (rows.length >= BATCH) {
            stream.pause();
            flush().then(() => stream.resume(), reject);
          }
        });
        stream.on('end', () => flush().then(resolve, reject));
        stream.on('error', reject);
      });
    }

    for (const v of views) {
      const [create] = await q(conn, `SHOW CREATE VIEW \`${v}\``);
      const sql = create['Create View'].replace(/\s+DEFINER=`[^`]*`@`[^`]*`/, '').replace(/\s+SQL SECURITY DEFINER/, '');
      await write(`\n-- Vista ${v}\n${sql};\n`);
    }

    await write('\nSET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n');
    await q(conn, 'COMMIT');
    return { tables: tables.length, views: views.length, rows: rowsTotal };
  } finally {
    conn.end();
  }
}

module.exports = { dumpDatabase };
