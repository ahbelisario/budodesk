class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest   = (msg = 'Solicitud inválida', details) => new AppError(400, 'BAD_REQUEST', msg, details);
const unauthorized = (msg = 'No autenticado', code = 'UNAUTHORIZED') => new AppError(401, code, msg);
const forbidden    = (msg = 'No tienes permiso para realizar esta acción', code = 'FORBIDDEN') => new AppError(403, code, msg);
const notFound     = (msg = 'No encontrado') => new AppError(404, 'NOT_FOUND', msg);
const conflict     = (msg = 'Conflicto', code = 'CONFLICT') => new AppError(409, code, msg);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
