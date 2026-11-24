/**
 * Registra un cambio en audit_log. Recibe el executor (pool, conexión de
 * transacción o tenantDb.executor) para quedar dentro de la misma transacción.
 */
async function audit(executor, { dojoId, userId, action, entity, entityId, before, after, ip }) {
  await executor.query(
    `INSERT INTO audit_log (dojo_id, user_id, action, entity, entity_id, before_data, after_data, ip_address)
     VALUES (:dojoId, :userId, :action, :entity, :entityId, :before, :after, :ip)`,
    {
      dojoId: dojoId ?? null,
      userId: userId ?? null,
      action,
      entity,
      entityId: entityId != null ? String(entityId) : null,
      before: before ? JSON.stringify(before) : null,
      after: after ? JSON.stringify(after) : null,
      ip: ip ?? null,
    },
  );
}

/** Atajo desde un request autenticado */
function auditReq(req, executor, data) {
  return audit(executor, { dojoId: req.auth?.dojoId, userId: req.auth?.userId, ip: req.ip, ...data });
}

module.exports = { audit, auditReq };
