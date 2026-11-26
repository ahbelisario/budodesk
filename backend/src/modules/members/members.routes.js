/**
 * /api/v2/members — personas del dojo (alumnos, instructores, tutores, staff)
 *
 * Permisos:
 *   admin/staff → todo
 *   instructor  → listar y ver perfiles (incluye datos médicos y de emergencia: los necesita en clase)
 *   alumno/tutor→ solo su propio registro y el de sus menores (vía /api/v2/me)
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo, requireRole, hasRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, conflict, forbidden, badRequest } = require('../../utils/errors');
const { auditReq } = require('../../utils/audit');
const { buildSet, pageParams, pageMeta, likeEscape } = require('../../utils/sql');
const { isGuardianOf } = require('../../utils/acting');
const { getDojo } = require('../../utils/dojo');
const { todayIn } = require('../../utils/dates');
const accountService = require('../account/account.service');

const { assertStudents } = require('../../services/subscription');
const router = express.Router();
router.use(authenticate, requireDojo);

const ROLES = ['owner', 'admin', 'instructor', 'staff', 'student', 'guardian'];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD');
const uidParam = z.object({ userId: z.coerce.number().int().positive() });
const opt = (s) => s.nullish();

const profileShape = {
  first_name: z.string().trim().min(1).max(100),
  last_name: opt(z.string().trim().max(100)),
  second_last_name: opt(z.string().trim().max(100)),
  preferred_name: opt(z.string().trim().max(100)),
  gender: opt(z.enum(['male', 'female', 'other', 'undisclosed'])),
  date_of_birth: opt(date),
  phone: opt(z.string().trim().max(30)),
  photo_url: opt(z.string().trim().max(500)),
  address_line1: opt(z.string().trim().max(200)),
  address_line2: opt(z.string().trim().max(200)),
  city: opt(z.string().trim().max(100)),
  state: opt(z.string().trim().max(100)),
  postal_code: opt(z.string().trim().max(20)),
  country_code: opt(z.string().trim().length(2)),
  emergency_contact_name: opt(z.string().trim().max(150)),
  emergency_contact_phone: opt(z.string().trim().max(30)),
  emergency_contact_relation: opt(z.string().trim().max(50)),
  blood_type: opt(z.string().trim().max(5)),
  medical_notes: opt(z.string().trim().max(5000)),
};
const PROFILE_COLS = Object.fromEntries(Object.keys(profileShape).map((k) => [k, k]));

const memberShape = {
  member_number: opt(z.string().trim().max(30)),
  status: z.enum(['pending', 'active', 'inactive', 'suspended']).optional(),
  joined_at: opt(date),
  notes: opt(z.string().trim().max(5000)),
};
const MEMBER_COLS = { member_number: 'member_number', status: 'status', joined_at: 'joined_at', notes: 'notes' };

const createSchema = z.object({
  email: opt(z.email().max(150).transform((s) => s.toLowerCase())),
  ...profileShape,
  ...memberShape,
  roles: z.array(z.enum(['admin', 'instructor', 'staff', 'student', 'guardian'])).min(1).default(['student']),
  guardian_user_id: z.coerce.number().int().positive().optional(),
  guardian_relationship: z.enum(['mother', 'father', 'legal_guardian', 'grandparent', 'other']).optional(),
  initial_ranks: z.array(z.object({
    discipline_id: z.coerce.number().int().positive(),
    rank_id: z.coerce.number().int().positive(),
    since_date: date.optional(),
  })).default([]),
  send_access_email: z.boolean().default(false),
});

const updateSchema = z.object({
  email: opt(z.email().max(150).transform((s) => s.toLowerCase())),
  ...Object.fromEntries(Object.entries(profileShape).map(([k, v]) => [k, v.optional()])),
  ...memberShape,
}).refine((o) => Object.keys(o).length > 0, 'Nada que actualizar');

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['pending', 'active', 'inactive', 'suspended', 'all']).default('active'),
  discipline_id: z.coerce.number().int().positive().optional(),
  sort: z.enum(['name', 'joined', 'recent']).default('name'),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------

const RANKS_JSON = `
  (SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'discipline_id', mr.discipline_id, 'discipline', d.name, 'rank_id', r.id, 'rank', r.name,
      'color', r.color, 'stripe_color', r.stripe_color, 'stripes', mr.stripes, 'level', r.level,
      'since_date', mr.since_date, 'next_exam_date', mr.next_exam_date, 'display_style', rt.display_style))
     FROM member_ranks mr
     JOIN ranks r ON r.dojo_id = mr.dojo_id AND r.id = mr.rank_id
     JOIN disciplines d ON d.dojo_id = mr.dojo_id AND d.id = mr.discipline_id
     JOIN rank_tracks rt ON rt.dojo_id = r.dojo_id AND rt.id = r.track_id
    WHERE mr.dojo_id = m.dojo_id AND mr.user_id = m.user_id)`;

const ROLES_SQL = `(SELECT GROUP_CONCAT(x.role ORDER BY x.role) FROM dojo_member_roles x
                     WHERE x.dojo_id = m.dojo_id AND x.user_id = m.user_id)`;

const ACTIVE_MS_SQL = `
  (SELECT JSON_OBJECT('id', ms.id, 'plan', pl.name, 'status', ms.status,
                      'current_period_end', ms.current_period_end, 'end_date', ms.end_date)
     FROM membership_members mm
     JOIN memberships ms ON ms.dojo_id = mm.dojo_id AND ms.id = mm.membership_id
     JOIN plans pl ON pl.dojo_id = ms.dojo_id AND pl.id = ms.plan_id
    WHERE mm.dojo_id = m.dojo_id AND mm.user_id = m.user_id
      AND ms.status IN ('active','past_due','paused','pending')
    ORDER BY FIELD(ms.status,'active','past_due','paused','pending'), ms.current_period_end DESC
    LIMIT 1)`;

const BALANCE_SQL = `
  (SELECT COALESCE(SUM(c.total - c.amount_paid), 0) FROM charges c
    WHERE c.dojo_id = m.dojo_id AND c.user_id = m.user_id AND c.status IN ('pending','partial'))`;

const LAST_ATTENDANCE_SQL = `
  (SELECT MAX(cs.session_date) FROM class_bookings cb
     JOIN class_sessions cs ON cs.dojo_id = cb.dojo_id AND cs.id = cb.session_id
    WHERE cb.dojo_id = m.dojo_id AND cb.user_id = m.user_id AND cb.status = 'attended')`;

function shapeRow(row, { financial }) {
  const out = {
    ...row,
    roles: row.roles ? row.roles.split(',') : [],
    ranks: row.ranks || [],
    is_minor: row.age != null ? row.age < 18 : false,
    can_login: !!row.can_login,
  };
  if (!financial) delete out.balance_due;
  return out;
}

/** Detalle completo de un miembro */
async function loadMember(req, userId) {
  const financial = hasRole(req, 'admin', 'staff') || userId === req.auth.userId;
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);
  const row = await req.tdb.one(
    `SELECT m.user_id AS id, u.email, u.username, (u.password_hash IS NOT NULL) AS can_login,
            u.last_login_at, u.status AS account_status,
            p.first_name, p.last_name, p.second_last_name, p.preferred_name, p.gender, p.date_of_birth,
            TIMESTAMPDIFF(YEAR, p.date_of_birth, :today) AS age,
            p.phone, p.photo_url, p.address_line1, p.address_line2, p.city, p.state, p.postal_code, p.country_code,
            p.emergency_contact_name, p.emergency_contact_phone, p.emergency_contact_relation,
            p.blood_type, p.medical_notes,
            m.member_number, m.status, m.joined_at, m.left_at, m.left_reason, m.source, m.notes,
            ${ROLES_SQL} AS roles, ${RANKS_JSON} AS ranks, ${ACTIVE_MS_SQL} AS active_membership,
            ${BALANCE_SQL} AS balance_due, ${LAST_ATTENDANCE_SQL} AS last_attendance
       FROM dojo_members m
       JOIN users u ON u.id = m.user_id
       JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.dojo_id = :dojoId AND m.user_id = :userId`,
    { userId, today });
  if (!row) return null;

  const guardians = await req.tdb.query(
    `SELECT g.guardian_user_id AS user_id, g.relationship, g.is_primary, g.can_book, g.can_pay,
            p.first_name, p.last_name, u.email, p.phone
       FROM user_guardians g
       JOIN dojo_members m ON m.user_id = g.guardian_user_id AND m.dojo_id = :dojoId
       JOIN users u ON u.id = g.guardian_user_id
       JOIN user_profiles p ON p.user_id = g.guardian_user_id
      WHERE g.minor_user_id = :userId`, { userId });
  const minors = await req.tdb.query(
    `SELECT g.minor_user_id AS user_id, g.relationship, p.first_name, p.last_name
       FROM user_guardians g
       JOIN dojo_members m ON m.user_id = g.minor_user_id AND m.dojo_id = :dojoId
       JOIN user_profiles p ON p.user_id = g.minor_user_id
      WHERE g.guardian_user_id = :userId`, { userId });

  const out = shapeRow(row, { financial });
  if (!hasRole(req, 'admin', 'staff')) delete out.notes; // notas internas del dojo
  return { ...out, guardians, minors };
}

async function assertCanView(req, userId) {
  if (userId === req.auth.userId || hasRole(req, 'admin', 'staff', 'instructor')) return;
  if (await isGuardianOf(req, userId, 'view')) return;
  throw forbidden();
}

// ---------------------------------------------------------------------------
// GET /members — listado con búsqueda, filtros y paginación
// ---------------------------------------------------------------------------
router.get('/', requireRole('admin', 'staff', 'instructor'), validate({ query: listQuery }), async (req, res) => {
  const qy = req.valid.query;
  const pg = pageParams(qy);
  const dojo = await getDojo(req);
  const where = ['m.dojo_id = :dojoId'];
  const params = { today: todayIn(dojo.timezone) };

  if (qy.status !== 'all') { where.push('m.status = :status'); params.status = qy.status; }
  if (qy.q) {
    where.push(`(CONCAT_WS(' ', p.first_name, p.last_name, p.second_last_name) LIKE :q
                 OR u.email LIKE :q OR m.member_number LIKE :q OR p.phone LIKE :q)`);
    params.q = likeEscape(qy.q);
  }
  if (qy.role) {
    where.push(`EXISTS (SELECT 1 FROM dojo_member_roles r WHERE r.dojo_id = m.dojo_id AND r.user_id = m.user_id AND r.role = :role)`);
    params.role = qy.role;
  }
  if (qy.discipline_id) {
    where.push(`EXISTS (SELECT 1 FROM member_ranks mr WHERE mr.dojo_id = m.dojo_id AND mr.user_id = m.user_id AND mr.discipline_id = :disc)`);
    params.disc = qy.discipline_id;
  }
  const order = { name: 'p.first_name, p.last_name', joined: 'm.joined_at DESC', recent: 'm.created_at DESC' }[qy.sort];
  const from = `FROM dojo_members m JOIN users u ON u.id = m.user_id JOIN user_profiles p ON p.user_id = m.user_id
                WHERE ${where.join(' AND ')}`;

  const [{ total }] = await req.tdb.query(`SELECT COUNT(*) AS total ${from}`, params);
  const rows = await req.tdb.query(
    `SELECT m.user_id AS id, u.email, (u.password_hash IS NOT NULL) AS can_login,
            p.first_name, p.last_name, p.preferred_name, p.photo_url, p.phone, p.date_of_birth,
            TIMESTAMPDIFF(YEAR, p.date_of_birth, :today) AS age,
            m.member_number, m.status, m.joined_at,
            ${ROLES_SQL} AS roles, ${RANKS_JSON} AS ranks, ${ACTIVE_MS_SQL} AS active_membership,
            ${BALANCE_SQL} AS balance_due, ${LAST_ATTENDANCE_SQL} AS last_attendance
       ${from}
      ORDER BY ${order}
      LIMIT :limit OFFSET :offset`,
    { ...params, limit: pg.limit, offset: pg.offset });

  const financial = hasRole(req, 'admin', 'staff');
  res.json({ status: 'success', data: rows.map((r) => shapeRow(r, { financial })), meta: pageMeta(pg, total) });
});

// ---------------------------------------------------------------------------
// GET /members/:userId
// ---------------------------------------------------------------------------
router.get('/:userId', validate({ params: uidParam }), async (req, res) => {
  const { userId } = req.valid.params;
  await assertCanView(req, userId);
  const m = await loadMember(req, userId);
  if (!m) throw notFound('Miembro no encontrado');
  res.json({ status: 'success', data: m });
});

// ---------------------------------------------------------------------------
// POST /members — alta. Si el email ya existe en BudoDesk, se vincula esa
// persona al dojo (sin tocar su perfil). Sin email = menor/sin acceso.
// ---------------------------------------------------------------------------
router.post('/', requireRole('admin', 'staff'), validate({ body: createSchema }), async (req, res) => {
  const b = req.valid.body;
  if (b.roles.some((r) => ['admin', 'staff'].includes(r)) && !hasRole(req, 'admin')) {
    throw forbidden('Solo un admin puede crear otros admins o staff');
  }
  const dojo = await getDojo(req);
  const today = todayIn(dojo.timezone);

  const userId = await req.tdb.transaction(async (t) => {
    const conn = t.executor;
    let uid;
    let linked = false;

    if (b.email) {
      const [[existing]] = await conn.query('SELECT id FROM users WHERE email = :email AND deleted_at IS NULL', { email: b.email });
      if (existing) {
        const already = await t.one('SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :u', { u: existing.id });
        if (already) throw conflict('Esa persona ya es miembro de este dojo', 'ALREADY_MEMBER');
        uid = existing.id;
        linked = true;
      }
    }

    if (!uid) {
      const [r] = await conn.query('INSERT INTO users (email) VALUES (:email)', { email: b.email ?? null });
      uid = r.insertId;
      const cols = Object.keys(PROFILE_COLS).filter((k) => b[k] !== undefined);
      await conn.query(
        `INSERT INTO user_profiles (user_id, ${cols.map((c) => `\`${c}\``).join(', ')})
         VALUES (:uid, ${cols.map((c) => `:${c}`).join(', ')})`,
        { uid, ...Object.fromEntries(cols.map((c) => [c, b[c] ?? null])) });
      await conn.query('INSERT INTO user_settings (user_id, language, last_dojo_id) VALUES (:uid, :lang, :dojo)',
        { uid, lang: dojo.language, dojo: dojo.id });
    }

    // Límite de alumnos activos del plan de BudoDesk
    if (b.roles.includes('student') && (b.status ?? 'active') === 'active') await assertStudents(req.auth.dojoId, 1, conn);

    await t.query(
      `INSERT INTO dojo_members (dojo_id, user_id, member_number, status, joined_at, notes, source)
       VALUES (:dojoId, :uid, :num, :status, :joined, :notes, 'admin')`,
      { uid, num: b.member_number ?? null, status: b.status ?? 'active', joined: b.joined_at ?? today, notes: b.notes ?? null });

    for (const role of new Set(b.roles)) {
      await t.query('INSERT INTO dojo_member_roles (dojo_id, user_id, role, granted_by) VALUES (:dojoId, :uid, :role, :by)',
        { uid, role, by: req.auth.userId });
    }

    if (b.guardian_user_id) {
      await linkGuardian(t, req, { minorId: uid, guardianId: b.guardian_user_id, relationship: b.guardian_relationship });
    }

    for (const ir of b.initial_ranks) {
      const rank = await t.one('SELECT id FROM ranks WHERE dojo_id = :dojoId AND id = :r AND discipline_id = :d',
        { r: ir.rank_id, d: ir.discipline_id });
      if (!rank) throw badRequest('Grado no válido para esa disciplina');
      const since = ir.since_date ?? today;
      await t.query(
        `INSERT INTO member_ranks (dojo_id, user_id, discipline_id, rank_id, since_date, started_discipline_at)
         VALUES (:dojoId, :uid, :d, :r, :since, :since)`, { uid, d: ir.discipline_id, r: ir.rank_id, since });
      await t.query(
        `INSERT INTO rank_history (dojo_id, user_id, discipline_id, rank_id, event_type, awarded_date, awarded_by)
         VALUES (:dojoId, :uid, :d, :r, 'initial', :since, :by)`,
        { uid, d: ir.discipline_id, r: ir.rank_id, since, by: req.auth.userId });
    }

    await auditReq(req, conn, { action: linked ? 'link' : 'create', entity: 'member', entityId: uid, after: { email: b.email, roles: b.roles } });
    return uid;
  });

  if (b.send_access_email && b.email) {
    await accountService.sendAccessEmail({ userId, dojoId: req.auth.dojoId });
  }
  res.status(201).json({ status: 'success', data: await loadMember(req, userId) });
});

// ---------------------------------------------------------------------------
// PATCH /members/:userId — datos de perfil y de membresía al dojo
// ---------------------------------------------------------------------------
router.patch('/:userId', requireRole('admin', 'staff'), validate({ params: uidParam, body: updateSchema }), async (req, res) => {
  const { userId } = req.valid.params;
  const b = req.valid.body;

  await req.tdb.transaction(async (t) => {
    const before = await t.one('SELECT user_id, status FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :userId FOR UPDATE', { userId });
    if (!before) throw notFound('Miembro no encontrado');
    // Reactivar a un alumno cuenta contra el límite del plan
    if (b.status === 'active' && before.status !== 'active') {
      const isStudent = await t.one("SELECT 1 AS ok FROM dojo_member_roles WHERE dojo_id = :dojoId AND user_id = :userId AND role = 'student'", { userId });
      if (isStudent) await assertStudents(req.auth.dojoId, 1, t.executor);
    }

    // ¿La persona pertenece también a otros dojos? Entonces su email y perfil
    // los administra ella misma: el admin de un dojo no puede cambiarlos.
    const [[{ others }]] = await t.executor.query(
      'SELECT COUNT(*) AS others FROM dojo_members WHERE user_id = :userId AND dojo_id <> :dojoId',
      { userId, dojoId: req.auth.dojoId });
    const profile = buildSet(b, PROFILE_COLS);
    if (others > 0 && (!profile.empty || b.email !== undefined)) {
      throw forbidden('Esta persona también pertenece a otro dojo; solo ella puede editar su perfil', 'SHARED_PROFILE');
    }

    if (b.email !== undefined) {
      await t.executor.query('UPDATE users SET email = :email WHERE id = :userId', { email: b.email, userId });
    }
    if (!profile.empty) {
      await t.executor.query(`UPDATE user_profiles SET ${profile.sql} WHERE user_id = :userId`, { ...profile.params, userId });
    }
    const member = buildSet(b, MEMBER_COLS);
    if (!member.empty) {
      const extra = b.status === 'inactive' ? ', left_at = COALESCE(left_at, CURDATE())'
        : b.status === 'active' ? ', left_at = NULL, left_reason = NULL' : '';
      await t.query(`UPDATE dojo_members SET ${member.sql}${extra} WHERE dojo_id = :dojoId AND user_id = :userId`,
        { ...member.params, userId });
    }
    await auditReq(req, t.executor, { action: 'update', entity: 'member', entityId: userId, after: b });
  });
  res.json({ status: 'success', data: await loadMember(req, userId) });
});

// ---------------------------------------------------------------------------
// PUT /members/:userId/roles — reemplaza el conjunto de roles
// ---------------------------------------------------------------------------
router.put('/:userId/roles', requireRole('admin'), validate({
  params: uidParam,
  body: z.object({ roles: z.array(z.enum(ROLES)).min(1) }),
}), async (req, res) => {
  const { userId } = req.valid.params;
  const roles = [...new Set(req.valid.body.roles)];
  const iAmOwner = req.auth.roles.includes('owner');

  await req.tdb.transaction(async (t) => {
    const current = (await t.query(
      'SELECT role FROM dojo_member_roles WHERE dojo_id = :dojoId AND user_id = :userId FOR UPDATE', { userId }))
      .map((r) => r.role);
    if (current.length === 0) throw notFound('Miembro no encontrado');

    const touchesOwner = current.includes('owner') !== roles.includes('owner');
    if (touchesOwner && !iAmOwner) throw forbidden('Solo un owner puede otorgar o quitar el rol owner');

    if (current.includes('owner') && !roles.includes('owner')) {
      const [{ n }] = await t.query(
        `SELECT COUNT(*) AS n FROM dojo_member_roles WHERE dojo_id = :dojoId AND role = 'owner' AND user_id <> :userId`, { userId });
      if (n === 0) throw conflict('El dojo debe tener al menos un owner', 'LAST_OWNER');
    }

    if (roles.includes('student') && !current.includes('student')) {
      const m = await t.one('SELECT status FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :userId', { userId });
      if (m?.status === 'active') await assertStudents(req.auth.dojoId, 1, t.executor);
    }

    await t.query('DELETE FROM dojo_member_roles WHERE dojo_id = :dojoId AND user_id = :userId', { userId });
    for (const role of roles) {
      await t.query('INSERT INTO dojo_member_roles (dojo_id, user_id, role, granted_by) VALUES (:dojoId, :userId, :role, :by)',
        { userId, role, by: req.auth.userId });
    }
    await auditReq(req, t.executor, { action: 'set_roles', entity: 'member', entityId: userId, before: current, after: roles });
  });
  res.json({ status: 'success', data: { roles } });
});

// POST /members/:userId/send-access — correo para crear contraseña
router.post('/:userId/send-access', requireRole('admin', 'staff'), validate({ params: uidParam }), async (req, res) => {
  const { userId } = req.valid.params;
  const m = await req.tdb.one(
    'SELECT u.email FROM dojo_members m JOIN users u ON u.id = m.user_id WHERE m.dojo_id = :dojoId AND m.user_id = :userId', { userId });
  if (!m) throw notFound('Miembro no encontrado');
  if (!m.email) throw badRequest('Esta persona no tiene correo registrado');
  await accountService.sendAccessEmail({ userId, dojoId: req.auth.dojoId });
  res.json({ status: 'success' });
});

// DELETE /members/:userId — da de baja (no borra historia)
router.delete('/:userId', requireRole('admin'), validate({
  params: uidParam, query: z.object({ reason: z.string().trim().max(255).optional() }),
}), async (req, res) => {
  const { userId } = req.valid.params;
  if (userId === req.auth.userId) throw badRequest('No puedes darte de baja a ti mismo');
  await req.tdb.transaction(async (t) => {
    const isOwner = await t.one(`SELECT 1 AS ok FROM dojo_member_roles WHERE dojo_id = :dojoId AND user_id = :userId AND role = 'owner'`, { userId });
    if (isOwner) throw conflict('Quita primero el rol owner', 'IS_OWNER');
    const r = await t.query(
      `UPDATE dojo_members SET status = 'inactive', left_at = CURDATE(), left_reason = :reason
        WHERE dojo_id = :dojoId AND user_id = :userId`, { userId, reason: req.valid.query.reason ?? null });
    if (r.affectedRows === 0) throw notFound('Miembro no encontrado');
    await auditReq(req, t.executor, { action: 'deactivate', entity: 'member', entityId: userId });
  });
  res.json({ status: 'success' });
});

// ---------------------------------------------------------------------------
// Tutores
// ---------------------------------------------------------------------------
async function linkGuardian(t, req, { minorId, guardianId, relationship, canBook = true, canPay = true }) {
  if (minorId === guardianId) throw badRequest('Una persona no puede ser su propio tutor');
  const g = await t.one('SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :g', { g: guardianId });
  if (!g) throw badRequest('El tutor debe estar registrado como miembro del dojo');
  await t.executor.query(
    `INSERT INTO user_guardians (guardian_user_id, minor_user_id, relationship, can_book, can_pay)
     VALUES (:g, :m, :rel, :book, :pay)
     ON DUPLICATE KEY UPDATE relationship = VALUES(relationship), can_book = VALUES(can_book), can_pay = VALUES(can_pay)`,
    { g: guardianId, m: minorId, rel: relationship ?? 'legal_guardian', book: canBook ? 1 : 0, pay: canPay ? 1 : 0 });
  await t.query(`INSERT IGNORE INTO dojo_member_roles (dojo_id, user_id, role, granted_by) VALUES (:dojoId, :g, 'guardian', :by)`,
    { g: guardianId, by: req.auth.userId });
}

router.post('/:userId/guardians', requireRole('admin', 'staff'), validate({
  params: uidParam,
  body: z.object({
    guardian_user_id: z.coerce.number().int().positive(),
    relationship: z.enum(['mother', 'father', 'legal_guardian', 'grandparent', 'other']).optional(),
    can_book: z.boolean().default(true),
    can_pay: z.boolean().default(true),
  }),
}), async (req, res) => {
  const { userId } = req.valid.params;
  const b = req.valid.body;
  await req.tdb.transaction(async (t) => {
    const m = await t.one('SELECT 1 AS ok FROM dojo_members WHERE dojo_id = :dojoId AND user_id = :userId', { userId });
    if (!m) throw notFound('Miembro no encontrado');
    await linkGuardian(t, req, { minorId: userId, guardianId: b.guardian_user_id, relationship: b.relationship, canBook: b.can_book, canPay: b.can_pay });
    await auditReq(req, t.executor, { action: 'link_guardian', entity: 'member', entityId: userId, after: b });
  });
  res.status(201).json({ status: 'success', data: (await loadMember(req, userId)).guardians });
});

router.delete('/:userId/guardians/:guardianId', requireRole('admin', 'staff'), validate({
  params: uidParam.extend({ guardianId: z.coerce.number().int().positive() }),
}), async (req, res) => {
  const { userId, guardianId } = req.valid.params;
  await req.tdb.transaction(async (t) => {
    // Solo se desvincula si ambos son miembros de este dojo
    const both = await t.one(
      `SELECT COUNT(*) AS n FROM dojo_members WHERE dojo_id = :dojoId AND user_id IN (:userId, :guardianId)`, { userId, guardianId });
    if (both.n < 2) throw notFound('Relación no encontrada');
    const [r] = await t.executor.query('DELETE FROM user_guardians WHERE guardian_user_id = :g AND minor_user_id = :m', { g: guardianId, m: userId });
    if (r.affectedRows === 0) throw notFound('Relación no encontrada');
    await auditReq(req, t.executor, { action: 'unlink_guardian', entity: 'member', entityId: userId, after: { guardianId } });
  });
  res.json({ status: 'success' });
});

module.exports = router;
module.exports.loadMember = loadMember;
