/**
 * Acceso a datos con aislamiento por dojo.
 *
 * Regla: toda consulta de negocio pasa por tenantDb(). Cada SQL debe incluir
 * el placeholder :dojoId y su valor SIEMPRE se inyecta desde el token, nunca
 * desde el body/URL. Si una consulta no contiene :dojoId, se lanza un error
 * en lugar de ejecutarla: un olvido truena en desarrollo en vez de filtrar
 * datos de otro dojo en producción.
 *
 * Segunda capa: las llaves foráneas compuestas (dojo_id, id) del esquema.
 */
const { pool, withTransaction } = require('./pool');

const DOJO_PLACEHOLDER = /:dojoId\b/;

class TenantQueryError extends Error {}

function assertTenantSql(sql) {
  if (!DOJO_PLACEHOLDER.test(sql)) {
    throw new TenantQueryError(`Consulta sin filtro :dojoId → ${sql.trim().slice(0, 120)}`);
  }
}

function makeTenantDb(dojoId, executor) {
  if (!Number.isInteger(dojoId) || dojoId <= 0) {
    throw new TenantQueryError('tenantDb requiere un dojoId válido');
  }

  async function query(sql, params = {}) {
    assertTenantSql(sql);
    if (Object.prototype.hasOwnProperty.call(params, 'dojoId')) {
      throw new TenantQueryError('No pases dojoId en params: se inyecta automáticamente');
    }
    const [rows] = await executor.query(sql, { ...params, dojoId });
    return rows;
  }

  async function one(sql, params) {
    const rows = await query(sql, params);
    return rows[0] ?? null;
  }

  return { dojoId, query, one, executor };
}

/**
 * tenantDb(dojoId).query(...)            → usa el pool
 * tenantDb(dojoId).transaction(async (t) => { await t.query(...) })
 */
function tenantDb(dojoId) {
  const db = makeTenantDb(dojoId, pool);
  db.transaction = (fn) => withTransaction((conn) => fn(makeTenantDb(dojoId, conn)));
  return db;
}

module.exports = { tenantDb, TenantQueryError };
