/**
 * "Ver como" (soporte): ver la app exactamente como la ve otro usuario del dojo, en solo lectura.
 *
 *   POST /impersonation       { user_id }  → token de 30 min a nombre del usuario (no se renueva)
 *   POST /impersonation/end                → registra el fin (con el token de "ver como")
 *
 * Quién puede:
 *   - superadmin: a cualquier miembro activo del dojo (menos otro superadmin)
 *   - admin del dojo: a alumnos, tutores, instructores y staff; nunca al dueño ni a otros admins
 * Todo queda en la bitácora del dojo (visible para sus admins).
 */
const express = require('express');
const { z } = require('zod');
const { pool, one } = require('../../db/pool');
const { authenticate, requireDojo, expandRoles } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { badRequest, forbidden, notFound } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const { signImpersonationToken } = require('../../utils/tokens');
const authService = require('./auth.service');

const router = express.Router();
router.use(authenticate, requireDojo);

router.post('/', validate({ body: z.object({ user_id: z.coerce.number().int().positive() }) }), async (req, res) => {
  const a = req.auth;
  const targetId = req.valid.body.user_id;
  if (a.impersonatedBy) throw badRequest('Primero sal de la vista actual');
  if (!a.isSuperadmin && !a.roles.includes('admin')) throw forbidden('Solo los administradores pueden usar «ver como»');
  if (targetId === a.userId) throw badRequest('Ya estás viendo tu propia cuenta');

  const target = await one(pool,
    `SELECT u.id, u.status, u.deleted_at, u.is_superadmin, m.status AS member_status,
            CONCAT_WS(' ', p.first_name, p.last_name) AS name
       FROM users u
       JOIN dojo_members m ON m.user_id = u.id AND m.dojo_id = :dojoId
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = :uid`, { uid: targetId, dojoId: a.dojoId });
  if (!target) throw notFound('Esa persona no es miembro de este dojo');
  if (target.status !== 'active' || target.deleted_at || target.member_status !== 'active') {
    throw badRequest('La cuenta de esa persona no está activa en este dojo');
  }
  if (target.is_superadmin) throw forbidden('No se puede ver como un administrador de la plataforma');
  const [roleRows] = await pool.query('SELECT role FROM dojo_member_roles WHERE dojo_id = :dojoId AND user_id = :uid', { dojoId: a.dojoId, uid: targetId });
  const targetRoles = roleRows.map((r) => r.role);
  if (!a.isSuperadmin && targetRoles.some((r) => r === 'owner' || r === 'admin')) {
    throw forbidden('No puedes ver como el dueño u otro administrador del dojo');
  }

  const tok = signImpersonationToken({ actorId: a.userId, sessionId: a.sessionId, targetId, dojoId: a.dojoId });
  await audit(pool, { dojoId: a.dojoId, userId: a.userId, ip: req.ip, action: 'impersonate_start', entity: 'user', entityId: targetId,
    after: { name: target.name, roles: targetRoles, by_superadmin: a.isSuperadmin, expires_at: tok.expiresAt } });

  const me = await authService.me({ userId: targetId, dojoId: a.dojoId, roles: expandRoles(targetRoles), support: false });
  res.status(201).json({
    status: 'success',
    data: {
      access_token: tok.token, access_token_expires_at: tok.expiresAt,
      user: me.user, dojo: me.dojo, dojos: me.dojo ? [me.dojo] : [],
      impersonation: { user_id: targetId, name: target.name, expires_at: tok.expiresAt },
    },
  });
});

// Se llama con el token de "ver como" (es la única escritura permitida en ese modo)
router.post('/end', async (req, res) => {
  const a = req.auth;
  if (!a.impersonatedBy) throw badRequest('No estás usando «ver como»');
  const who = await one(pool, "SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM user_profiles WHERE user_id = :uid", { uid: a.userId });
  await audit(pool, { dojoId: a.dojoId, userId: a.impersonatedBy, ip: req.ip, action: 'impersonate_end', entity: 'user', entityId: a.userId,
    after: { name: who?.name ?? null } });
  res.json({ status: 'success', data: { ended: true } });
});

module.exports = router;
