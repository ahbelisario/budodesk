/**
 * /api/v2/notifications — bandeja del usuario y registro de dispositivos (push)
 * /api/v2/announcements — avisos del dojo
 */
const express = require('express');
const { z } = require('zod');
const { pool } = require('../../db/pool');
const { authenticate, requireDojo, requireRole, hasRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, badRequest } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { notify } = require('./notify.service');

const id = z.coerce.number().int().positive();

// ===========================================================================
// Bandeja
// ===========================================================================
const notifications = express.Router();
notifications.use(authenticate);

notifications.get('/', validate({
  query: z.object({ unread: z.stringbool().optional(), limit: z.coerce.number().int().min(1).max(100).default(30), before_id: id.optional() }),
}), async (req, res) => {
  const q = req.valid.query;
  const dojoFilter = req.auth.dojoId ? 'AND (dojo_id = :d OR dojo_id IS NULL)' : '';
  const [rows] = await pool.query(
    `SELECT id, dojo_id, type, title, body, data, read_at, created_at FROM notifications
      WHERE user_id = :u ${dojoFilter} ${q.unread ? 'AND read_at IS NULL' : ''} ${q.before_id ? 'AND id < :before' : ''}
      ORDER BY id DESC LIMIT :limit`, { u: req.auth.userId, d: req.auth.dojoId, limit: q.limit, before: q.before_id });
  const [[{ unread }]] = await pool.query(
    `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = :u ${dojoFilter} AND read_at IS NULL`,
    { u: req.auth.userId, d: req.auth.dojoId });
  res.json({ status: 'success', data: rows, meta: { unread } });
});

notifications.post('/read', validate({ body: z.object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional() }) }), async (req, res) => {
  const b = req.valid.body;
  if (!b.all && !b.ids?.length) throw badRequest('Indica ids o all: true');
  await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = :u AND read_at IS NULL ${b.all ? '' : 'AND id IN (:ids)'}`,
    { u: req.auth.userId, ids: b.ids });
  res.json({ status: 'success' });
});

// Registro del token de Expo Push del dispositivo
notifications.post('/push-tokens', validate({
  body: z.object({
    token: z.string().trim().regex(/^(ExponentPushToken|ExpoPushToken)\[.+\]$/, 'Token de Expo inválido').max(255),
    platform: z.enum(['ios', 'android', 'web']),
    device_name: z.string().trim().max(100).optional(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform, device_name, last_seen_at) VALUES (:u, :t, :p, :n, NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), device_name = VALUES(device_name), last_seen_at = NOW()`,
    { u: req.auth.userId, t: b.token, p: b.platform, n: b.device_name ?? null });
  res.json({ status: 'success' });
});

notifications.delete('/push-tokens', validate({ body: z.object({ token: z.string().max(255) }) }), async (req, res) => {
  await pool.query('DELETE FROM push_tokens WHERE user_id = :u AND token = :t', { u: req.auth.userId, t: req.valid.body.token });
  res.json({ status: 'success' });
});

// ===========================================================================
// Avisos
// ===========================================================================
const announcements = express.Router();
announcements.use(authenticate, requireDojo);

const STAFF = ['admin', 'staff', 'instructor'];

/** ¿Qué audiencias ve esta persona? */
function audiencesFor(req) {
  const a = ['all'];
  if (hasRole(req, 'student')) a.push('students');
  if (hasRole(req, 'guardian')) a.push('guardians');
  if (hasRole(req, ...STAFF, 'owner')) a.push('staff');
  return a;
}

announcements.get('/', validate({ query: z.object({ include_expired: z.stringbool().optional() }) }), async (req, res) => {
  const staff = hasRole(req, ...STAFF); // admin, staff e instructores ven todos los avisos
  const rows = await req.tdb.query(
    `SELECT a.id, a.title, a.body, a.audience, a.discipline_id, d.name AS discipline, a.pinned, a.publish_at, a.expires_at,
            CONCAT_WS(' ', p.first_name, p.last_name) AS author
       FROM announcements a
       LEFT JOIN disciplines d ON d.dojo_id = a.dojo_id AND d.id = a.discipline_id
       LEFT JOIN user_profiles p ON p.user_id = a.created_by
      WHERE a.dojo_id = :dojoId
        ${staff ? '' : 'AND a.publish_at <= NOW()'}
        ${req.valid.query.include_expired && staff ? '' : 'AND (a.expires_at IS NULL OR a.expires_at > NOW())'}
        ${staff ? '' : `AND (a.audience IN (:aud) OR (a.audience = 'discipline' AND EXISTS (
              SELECT 1 FROM member_ranks mr WHERE mr.dojo_id = a.dojo_id AND mr.discipline_id = a.discipline_id AND mr.user_id = :me)))`}
      ORDER BY a.pinned DESC, a.publish_at DESC LIMIT 50`,
    { aud: audiencesFor(req), me: req.auth.userId });
  res.json({ status: 'success', data: rows });
});

/** Destinatarios de un aviso */
async function recipients(tdb, audience, disciplineId) {
  const roleFilter = {
    all: '', students: "AND r.role = 'student'", guardians: "AND r.role = 'guardian'",
    staff: "AND r.role IN ('owner','admin','staff','instructor')", discipline: '',
  }[audience];
  const discFilter = audience === 'discipline'
    ? 'AND EXISTS (SELECT 1 FROM member_ranks mr WHERE mr.dojo_id = m.dojo_id AND mr.user_id = m.user_id AND mr.discipline_id = :disc)' : '';
  const rows = await tdb.query(
    `SELECT DISTINCT m.user_id FROM dojo_members m
       JOIN dojo_member_roles r ON r.dojo_id = m.dojo_id AND r.user_id = m.user_id
      WHERE m.dojo_id = :dojoId AND m.status = 'active' ${roleFilter} ${discFilter}`, { disc: disciplineId });
  let ids = rows.map((r) => r.user_id);
  // Avisos para alumnos llegan también a sus tutores (los menores no suelen tener app)
  if (['all', 'students', 'discipline'].includes(audience) && ids.length) {
    const g = await tdb.query(
      `SELECT DISTINCT g.guardian_user_id FROM user_guardians g
         JOIN dojo_members m ON m.dojo_id = :dojoId AND m.user_id = g.guardian_user_id AND m.status = 'active'
        WHERE g.minor_user_id IN (:ids)`, { ids });
    ids = [...new Set([...ids, ...g.map((x) => x.guardian_user_id)])];
  }
  return ids;
}

announcements.post('/', requireRole(...STAFF), validate({
  body: z.object({
    title: z.string().trim().min(1).max(150),
    body: z.string().trim().min(1).max(5000),
    audience: z.enum(['all', 'students', 'guardians', 'staff', 'discipline']).default('all'),
    discipline_id: id.nullish(),
    pinned: z.boolean().default(false),
    send_push: z.boolean().default(true),
    send_email: z.boolean().default(false),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullish(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  if (b.audience === 'discipline' && !b.discipline_id) throw badRequest('Indica la disciplina');
  const r = await req.tdb.query(
    `INSERT INTO announcements (dojo_id, title, body, audience, discipline_id, pinned, send_push, send_email, expires_at, created_by)
     VALUES (:dojoId, :title, :body, :aud, :disc, :pin, :push, :email, :exp, :by)`,
    { title: b.title, body: b.body, aud: b.audience, disc: b.discipline_id ?? null, pin: b.pinned ? 1 : 0,
      push: b.send_push ? 1 : 0, email: b.send_email ? 1 : 0, exp: b.expires_at ?? null, by: req.auth.userId });
  const ids = await recipients(req.tdb, b.audience, b.discipline_id);
  const channels = [b.send_push && 'push', b.send_email && 'email'].filter(Boolean);
  const sent = await notify(req.auth.dojoId, ids, {
    type: 'announcement', title: b.title, body: b.body.slice(0, 300), pref: 'notify_announcements', channels,
    data: { screen: 'announcements', announcement_id: r.insertId },
  });
  await auditReq(req, req.tdb.executor, { action: 'create', entity: 'announcement', entityId: r.insertId, after: { ...b, recipients: sent } });
  res.status(201).json({ status: 'success', data: { id: r.insertId, recipients: sent } });
});

// Editar (no se vuelve a notificar; solo cambia lo que se ve en la app)
announcements.patch('/:id', requireRole(...STAFF), validate({
  params: z.object({ id }),
  body: z.object({
    title: z.string().trim().min(1).max(150).optional(),
    body: z.string().trim().min(1).max(5000).optional(),
    pinned: z.boolean().optional(),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullish(),
  }).refine((o) => Object.keys(o).length > 0, 'Nada que actualizar'),
}), async (req, res) => {
  const b = req.valid.body;
  const sets = []; const params = { id: req.valid.params.id };
  for (const k of ['title', 'body', 'pinned', 'expires_at']) {
    if (b[k] === undefined) continue;
    sets.push(`${k} = :${k}`);
    params[k] = typeof b[k] === 'boolean' ? Number(b[k]) : b[k];
  }
  const r = await req.tdb.query(`UPDATE announcements SET ${sets.join(', ')} WHERE dojo_id = :dojoId AND id = :id`, params);
  if (r.affectedRows === 0) throw notFound('Aviso no encontrado');
  await auditReq(req, req.tdb.executor, { action: 'update', entity: 'announcement', entityId: req.valid.params.id, after: b });
  res.json({ status: 'success' });
});

announcements.delete('/:id', requireRole('admin', 'staff'), validate({ params: z.object({ id }) }), async (req, res) => {
  const r = await req.tdb.query('DELETE FROM announcements WHERE dojo_id = :dojoId AND id = :id', { id: req.valid.params.id });
  if (r.affectedRows === 0) throw notFound('Aviso no encontrado');
  res.json({ status: 'success' });
});

/** Avisos automáticos por eventos de otros módulos */
function registerEventHandlers(app) {
  app.on('class_cancelled', ({ dojoId, sessionId, userIds }) => {
    pool.query('SELECT title, session_date, start_time FROM class_sessions WHERE dojo_id = :d AND id = :s', { d: dojoId, s: sessionId })
      .then(([[s]]) => s && notify(dojoId, userIds, {
        type: 'class_cancelled', title: 'Clase cancelada', pref: 'notify_class_reminders', channels: ['push'],
        body: `${s.title} del ${s.session_date} a las ${String(s.start_time).slice(0, 5)} fue cancelada.`,
        data: { screen: 'schedule', session_id: sessionId },
      }))
      .catch((e) => console.error('[notify] class_cancelled', e.message));
  });
  app.on('rank_changed', ({ dojoId, userId, rank, eventType }) => {
    pool.query('SELECT guardian_user_id FROM user_guardians WHERE minor_user_id = :u', { u: userId })
      .then(([g]) => notify(dojoId, [userId, ...g.map((x) => x.guardian_user_id)], {
        type: 'rank_promoted', channels: ['push'],
        title: eventType === 'stripe' ? '¡Nuevo tip!' : '¡Felicidades por tu nuevo grado!',
        body: eventType === 'stripe' ? `Recibiste un tip en ${rank}.` : `Ahora eres ${rank}. ¡Sigue entrenando!`,
        data: { screen: 'progress' },
      }))
      .catch((e) => console.error('[notify] rank_changed', e.message));
  });
  app.on('waitlist_promoted', ({ dojoId, sessionId, userId }) => {
    pool.query('SELECT title, session_date, start_time FROM class_sessions WHERE dojo_id = :d AND id = :s', { d: dojoId, s: sessionId })
      .then(([[s]]) => s && notify(dojoId, [userId], {
        type: 'waitlist_promoted', title: '¡Tienes lugar!', pref: 'notify_class_reminders', channels: ['push'],
        body: `Se liberó un lugar en ${s.title} (${s.session_date} ${String(s.start_time).slice(0, 5)}). Ya estás inscrito.`,
        data: { screen: 'schedule', session_id: sessionId },
      }))
      .catch((e) => console.error('[notify] waitlist_promoted', e.message));
  });
}

module.exports = { notifications, announcements, registerEventHandlers };
