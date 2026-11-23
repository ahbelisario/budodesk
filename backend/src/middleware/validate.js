const { badRequest } = require('../utils/errors');

/**
 * validate({ body, params, query }) con esquemas zod.
 * El resultado limpio queda en req.valid.body / req.valid.params / req.valid.query.
 * Campos no declarados en el esquema se descartan (no llegan al SQL).
 */
function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
        return next(badRequest('Datos inválidos', details));
      }
      req.valid[part] = result.data;
    }
    next();
  };
}

module.exports = { validate };
