const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const JWT_OPTS = { algorithm: 'HS256', issuer: 'budodesk', audience: 'budodesk-api' };

/** Access token de vida corta. Solo lleva identificadores; los roles se leen de la BD. */
function signAccessToken({ userId, sessionId, dojoId }) {
  const expiresInSec = env.ACCESS_TOKEN_TTL_MIN * 60;
  const token = jwt.sign({ sid: sessionId, dojo: dojoId ?? null }, env.JWT_ACCESS_SECRET, {
    ...JWT_OPTS, subject: String(userId), expiresIn: expiresInSec,
  });
  return { token, expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString() };
}

/**
 * "Ver como" (soporte): token de solo lectura a nombre de otro usuario. Va ligado a la sesión
 * de quien lo pidió (sid + imp): si esa sesión se cierra, el token deja de servir. No se renueva.
 */
const IMPERSONATION_MINUTES = 30;
function signImpersonationToken({ actorId, sessionId, targetId, dojoId }) {
  const expiresInSec = IMPERSONATION_MINUTES * 60;
  const token = jwt.sign({ sid: sessionId, dojo: dojoId, imp: actorId }, env.JWT_ACCESS_SECRET, {
    ...JWT_OPTS, subject: String(targetId), expiresIn: expiresInSec,
  });
  return { token, expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString() };
}

function verifyAccessToken(token) {
  const p = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience,
  });
  return {
    userId: Number(p.sub), sessionId: Number(p.sid), dojoId: p.dojo ? Number(p.dojo) : null,
    impersonatedBy: p.imp ? Number(p.imp) : null,
  };
}

/** Token opaco aleatorio (refresh, invitaciones, reset). En BD solo se guarda el hash. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = { signAccessToken, signImpersonationToken, verifyAccessToken, randomToken, sha256, IMPERSONATION_MINUTES };
