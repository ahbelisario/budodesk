/**
 * Helpers de SQL reutilizables.
 */

/**
 * Construye "col = :key, ..." solo con los campos presentes en `body` y
 * permitidos en `columns` ({ campoBody: 'columna_sql' }).
 * Los booleanos se convierten a 0/1.
 */
function buildSet(body, columns) {
  const sets = [];
  const params = {};
  for (const [key, col] of Object.entries(columns)) {
    if (body[key] === undefined) continue;
    sets.push(`\`${col}\` = :set_${key}`);
    const v = body[key];
    params[`set_${key}`] = typeof v === 'boolean' ? Number(v) : v;
  }
  return { sql: sets.join(', '), params, empty: sets.length === 0 };
}

/** Paginación estándar: ?page=1&page_size=25 (máx. 100) */
function pageParams(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(query.page_size) || 25));
  return { limit: size, offset: (page - 1) * size, page, page_size: size };
}

function pageMeta({ page, page_size }, total) {
  return { page, page_size, total, total_pages: Math.max(1, Math.ceil(total / page_size)) };
}

/** Escapa % y _ para LIKE */
const likeEscape = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

module.exports = { buildSet, pageParams, pageMeta, likeEscape };
