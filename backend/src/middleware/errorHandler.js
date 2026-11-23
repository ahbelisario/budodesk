const { AppError } = require('../utils/errors');
const { TenantQueryError } = require('../db/tenant');

const MYSQL_ERRORS = {
  ER_DUP_ENTRY: [409, 'DUPLICATE', 'Ya existe un registro con esos datos'],
  ER_NO_REFERENCED_ROW_2: [400, 'INVALID_REFERENCE', 'Una de las referencias no existe en este dojo'],
  ER_ROW_IS_REFERENCED_2: [409, 'IN_USE', 'No se puede eliminar porque está en uso'],
  ER_CHECK_CONSTRAINT_VIOLATED: [400, 'INVALID_VALUE', 'Un valor no cumple las reglas'],
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      status: 'error', code: err.code, message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', code: 'BAD_JSON', message: 'JSON inválido' });
  }

  const mapped = err?.code && MYSQL_ERRORS[err.code];
  if (mapped) {
    const [status, code, message] = mapped;
    return res.status(status).json({ status: 'error', code, message });
  }

  if (err instanceof TenantQueryError) {
    // Error de programación: nunca debe llegar a producción
    console.error('[TENANT]', err.message);
  } else {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }
  res.status(500).json({ status: 'error', code: 'INTERNAL', message: 'Error interno' });
}

function notFoundHandler(req, res) {
  res.status(404).json({ status: 'error', code: 'ROUTE_NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.path}` });
}

module.exports = { errorHandler, notFoundHandler };
