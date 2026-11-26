/** Administración de dojos desde la plataforma (solo superadmin). Consultas entre dojos: pool directo. */
const { pool, withTransaction, one } = require('../../db/pool');
const { AppError, badRequest, conflict, notFound } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const accountService = require('../account/account.service');
const { todayIn } = require('../../utils/dates');
const subscription = require('../../services/subscription');
const fs = require('fs');
const path = require('path');
const env = require('../../config/env');

const RESERVED = new Set(['www', 'api', 'app', 'admin', 'dev', 'mail', 'smtp', 'static', 'assets', 'cdn', 'status',
  'docs', 'help', 'soporte', 'support', 'budodesk', 'platform', 'plataforma', 'staging', 'test', 'login', 'auth']);

async function listDojos(viewerId) {
  const [rows] = await pool.query(
    `SELECT d.id, d.slug, d.name, d.short_name, d.logo_url, d.color_primary, d.plan, d.status, d.trial_ends_at,
            d.limit_students, d.limit_locations, d.limit_finance,
            (SELECT COUNT(*) FROM dojo_locations l WHERE l.dojo_id = d.id AND l.active = 1) AS locations_active,
            d.timezone, d.currency, d.language, d.country_code, d.created_at,
            (SELECT COUNT(*) FROM dojo_members m WHERE m.dojo_id = d.id AND m.status = 'active') AS members_active,
            (SELECT COUNT(DISTINCT r.user_id) FROM dojo_member_roles r
               JOIN dojo_members m ON m.dojo_id = r.dojo_id AND m.user_id = r.user_id
              WHERE r.dojo_id = d.id AND r.role = 'student' AND m.status = 'active') AS students_active,
            (SELECT MAX(u.last_seen_at) FROM dojo_members m JOIN users u ON u.id = m.user_id
              WHERE m.dojo_id = d.id) AS last_activity,
            (SELECT GROUP_CONCAT(CONCAT_WS(' ', p.first_name, p.last_name) ORDER BY r.user_id SEPARATOR ', ')
               FROM dojo_member_roles r JOIN user_profiles p ON p.user_id = r.user_id
              WHERE r.dojo_id = d.id AND r.role = 'owner') AS owners,
            (SELECT GROUP_CONCAT(u.email ORDER BY r.user_id SEPARATOR ', ')
               FROM dojo_member_roles r JOIN users u ON u.id = r.user_id
              WHERE r.dojo_id = d.id AND r.role = 'owner' AND u.email IS NOT NULL) AS owner_emails,
            EXISTS (SELECT 1 FROM dojo_members m WHERE m.dojo_id = d.id AND m.user_id = :viewer AND m.status = 'active') AS is_member
       FROM dojos d
      ORDER BY d.status = 'cancelled', d.name`, { viewer: viewerId });
  // Plan que aplica y sus límites (con las excepciones del dojo), para las tarjetas del panel
  const plans = Object.fromEntries((await subscription.listPlans()).map((p) => [p.code, p]));
  return rows.map((d) => {
    const effective = subscription.effectivePlan(d);
    const plan = plans[effective];
    return {
      ...d, is_member: !!d.is_member, effective_plan: effective, plan_name: plan?.name ?? effective,
      limits: subscription.limitsFor(plan ?? {}, d),
      custom_limits: [d.limit_students, d.limit_locations, d.limit_finance].some((v) => v != null),
    };
  });
}

async function getDojo(id, viewerId) {
  const d = (await listDojos(viewerId)).find((x) => x.id === id);
  if (!d) throw notFound('Dojo no encontrado');
  return d;
}

/** Copia filas de configuración de un dojo a otro, reasignando ids (devuelve mapa viejo→nuevo) */
async function copyRows(conn, table, from, to, remap = {}, { idCol = 'id', overrides = {} } = {}) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND EXTRA NOT LIKE '%VIRTUAL GENERATED%' AND EXTRA NOT LIKE '%STORED GENERATED%'
        AND COLUMN_NAME NOT IN ('created_at','updated_at') ORDER BY ORDINAL_POSITION`, { table });
  const insertCols = cols.map((x) => x.c).filter((c) => c !== idCol);
  const [rows] = await conn.query(`SELECT * FROM \`${table}\` WHERE dojo_id = :from ORDER BY ${idCol ? `\`${idCol}\`` : 1}`, { from });
  const map = new Map();
  for (const row of rows) {
    const values = insertCols.map((c) => {
      if (c === 'dojo_id') return to;
      if (c in overrides) return overrides[c];
      if (remap[c]) return remap[c].get(row[c]) ?? null;
      return row[c];
    });
    const [r] = await conn.query(
      `INSERT INTO \`${table}\` (${insertCols.map((c) => `\`${c}\``).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
      values);
    if (idCol) map.set(row[idCol], r.insertId);
  }
  return map;
}

async function createDojo(b, actorId, ip) {
  const slug = b.slug.toLowerCase();
  if (RESERVED.has(slug)) throw badRequest(`«${slug}» está reservado; elige otro subdominio`);
  if (await one(pool, 'SELECT id FROM dojos WHERE slug = :slug', { slug })) {
    throw conflict(`Ya existe un dojo con el subdominio «${slug}»`, 'SLUG_TAKEN');
  }
  if (b.copy_from_dojo_id && !(await one(pool, 'SELECT id FROM dojos WHERE id = :id', { id: b.copy_from_dojo_id }))) {
    throw badRequest('El dojo del que quieres copiar la configuración no existe');
  }
  const email = b.owner_email.trim().toLowerCase();

  const result = await withTransaction(async (conn) => {
    const [d] = await conn.query(
      `INSERT INTO dojos (slug, name, short_name, country_code, currency, timezone, language, plan, status, trial_ends_at)
       VALUES (:slug, :name, :short, :country, :currency, :tz, :lang, :plan, :status, :trial)`,
      {
        slug, name: b.name, short: b.short_name || null, country: b.country_code, currency: b.currency, tz: b.timezone,
        lang: b.language, plan: b.plan, status: b.status, trial: b.status === 'trial' ? b.trial_ends_at : null,
      });
    const dojoId = d.insertId;
    await conn.query('INSERT INTO dojo_payment_settings (dojo_id, accepts_cash, accepts_transfer) VALUES (:d, 1, 1)', { d: dojoId });
    await conn.query("INSERT INTO dojo_locations (dojo_id, name) VALUES (:d, 'Dojo principal')", { d: dojoId });

    const copied = {};
    if (b.copy_from_dojo_id) {
      const from = b.copy_from_dojo_id;
      const disc = await copyRows(conn, 'disciplines', from, dojoId);
      const tracks = await copyRows(conn, 'rank_tracks', from, dojoId, { discipline_id: disc });
      const ranks = await copyRows(conn, 'ranks', from, dojoId, { discipline_id: disc, track_id: tracks });
      await copyRows(conn, 'rank_requirements', from, dojoId, { rank_id: ranks });
      const plans = await copyRows(conn, 'plans', from, dojoId, {}, { overrides: { currency: b.currency } });
      await copyRows(conn, 'plan_disciplines', from, dojoId, { plan_id: plans, discipline_id: disc }, { idCol: null });
      const discounts = await copyRows(conn, 'discounts', from, dojoId);
      Object.assign(copied, { disciplines: disc.size, ranks: ranks.size, plans: plans.size, discounts: discounts.size });
    }

    // Dueño
    let owner = await one(conn, 'SELECT id, password_hash FROM users WHERE email = :email AND deleted_at IS NULL', { email });
    let ownerCreated = false;
    if (!owner) {
      const [u] = await conn.query('INSERT INTO users (email) VALUES (:email)', { email });
      owner = { id: u.insertId, password_hash: null };
      await conn.query('INSERT INTO user_profiles (user_id, first_name, last_name) VALUES (:u, :f, :l)',
        { u: owner.id, f: b.owner_first_name, l: b.owner_last_name || null });
      await conn.query('INSERT INTO user_settings (user_id, language, last_dojo_id) VALUES (:u, :lang, :d)',
        { u: owner.id, lang: b.language, d: dojoId });
      ownerCreated = true;
    }
    await conn.query(
      `INSERT INTO dojo_members (dojo_id, user_id, status, joined_at, source) VALUES (:d, :u, 'active', CURDATE(), 'admin')`,
      { d: dojoId, u: owner.id });
    await conn.query(`INSERT INTO dojo_member_roles (dojo_id, user_id, role, granted_by) VALUES (:d, :u, 'owner', :by)`,
      { d: dojoId, u: owner.id, by: actorId });

    await audit(conn, {
      dojoId, userId: actorId, action: 'create', entity: 'platform_dojo', entityId: dojoId, ip,
      after: { slug, name: b.name, plan: b.plan, status: b.status, owner: email, copied_from: b.copy_from_dojo_id || null, copied },
    });
    return { dojoId, ownerId: owner.id, ownerCreated, needsPassword: !owner.password_hash, copied };
  });

  let emailSent = false;
  if (b.send_owner_email && result.needsPassword) {
    const r = await accountService.sendAccessEmail({ userId: result.ownerId, dojoId: result.dojoId });
    emailSent = !!r?.sent;
  }
  return {
    dojo: await getDojo(result.dojoId, actorId),
    owner: { id: result.ownerId, created: result.ownerCreated, email, email_sent: emailSent, has_password: !result.needsPassword },
    copied: result.copied,
  };
}

async function updateDojo(id, b, actorId, ip) {
  const before = await one(pool, 'SELECT id, name, short_name, plan, status, trial_ends_at, timezone FROM dojos WHERE id = :id', { id });
  if (!before) throw notFound('Dojo no encontrado');
  const { timezone, ...prev } = before;
  const next = { ...prev, ...b };
  const ymd = (v) => (v ? (typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10)) : null);
  // Extender una prueba vencida (fecha de hoy en adelante) la reabre
  if (next.status === 'expired' && ymd(next.trial_ends_at) && ymd(next.trial_ends_at) >= todayIn(timezone)) next.status = 'trial';
  if (!['trial', 'expired'].includes(next.status)) next.trial_ends_at = null;
  // Avisos de fin de prueba: empiezan de nuevo si cambió la fecha o volvió a prueba
  const resetNotices = ymd(next.trial_ends_at) !== ymd(before.trial_ends_at) || (next.status === 'trial' && before.status !== 'trial');
  await pool.query(
    `UPDATE dojos SET name = :name, short_name = :short_name, plan = :plan, status = :status, trial_ends_at = :trial_ends_at,
            trial_notices = IF(:reset, '', trial_notices)
      WHERE id = :id`, { ...next, trial_ends_at: ymd(next.trial_ends_at), reset: resetNotices ? 1 : 0, id });
  // Excepciones del dojo (null = lo del plan; 0 en alumnos/sedes = sin límite)
  const LIMIT_COLS = ['limit_students', 'limit_locations', 'limit_finance'];
  const limits = LIMIT_COLS.filter((k) => b[k] !== undefined);
  if (limits.length) {
    await pool.query(`UPDATE dojos SET ${limits.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`,
      { id, ...Object.fromEntries(limits.map((k) => [k, k === 'limit_finance' && b[k] != null ? (b[k] ? 1 : 0) : b[k]])) });
  }
  await audit(pool, { dojoId: id, userId: actorId, action: 'update', entity: 'platform_dojo', entityId: id, ip, before: prev, after: b });
  return getDojo(id, actorId);
}

/**
 * Tablas (no vistas) con columna dojo_id, ordenadas para borrar sin chocar con las llaves:
 * primero las que apuntan a otras de la lista, al final aquellas a las que se apunta.
 */
async function tablesByDependency(conn) {
  const [cols] = await conn.query(
    `SELECT c.TABLE_NAME AS t FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME = 'dojo_id' AND tb.TABLE_TYPE = 'BASE TABLE'`);
  const tables = new Set(cols.map((r) => r.t));
  const [fks] = await conn.query(
    `SELECT DISTINCT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME <> REFERENCED_TABLE_NAME`);
  const children = new Map([...tables].map((t) => [t, new Set()])); // padre → hijos que aún falta borrar
  for (const { child, parent } of fks) if (tables.has(child) && tables.has(parent)) children.get(parent).add(child);
  const order = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter((t) => [...children.get(t)].every((c) => !pending.has(c)));
    if (!ready.length) throw new AppError(500, 'DELETE_ORDER', `Dependencia circular entre: ${[...pending].join(', ')}`);
    ready.sort().forEach((t) => { order.push(t); pending.delete(t); });
  }
  return order;
}

/**
 * Elimina un dojo y TODOS sus datos (derecho de cancelación de la LFPDPPP). No se puede deshacer.
 * Candados: el dojo debe estar 'cancelled', hay que escribir su dirección y no puedes estar dentro.
 *  - borra el dojo (en cascada: miembros, clases, cobranza, grados, finanzas…), su bitácora,
 *    consentimientos, avisos de pago recibidos, solicitud de registro y sus archivos (logo)
 *  - borra las cuentas de las personas que solo pertenecían a ese dojo (y sus fotos);
 *    quien también está en otro dojo conserva su cuenta
 *  - deja en la bitácora de la plataforma solo el registro de que se eliminó (sin datos personales)
 * Los respaldos ya hechos lo conservan hasta que se ciclen.
 */
async function deleteDojo(id, { confirm_slug: confirmSlug }, actor, ip) {
  const d = await one(pool, 'SELECT id, slug, name, status FROM dojos WHERE id = :id', { id });
  if (!d) throw notFound('Dojo no encontrado');
  if (d.status !== 'cancelled') throw conflict('Primero cambia el dojo a «Cancelado»; después se puede eliminar', 'DOJO_NOT_CANCELLED');
  if (confirmSlug !== d.slug) throw badRequest(`Para confirmar escribe exactamente «${d.slug}»`);
  if (actor.dojoId === id) throw conflict('Estás dentro de ese dojo: cambia a otro antes de eliminarlo', 'DOJO_IN_USE');

  const result = await withTransaction(async (conn) => {
    // Personas que solo están en este dojo (nunca el superadmin)
    const [only] = await conn.query(
      `SELECT DISTINCT m.user_id AS id FROM dojo_members m JOIN users u ON u.id = m.user_id
        WHERE m.dojo_id = :d AND u.is_superadmin = 0
          AND NOT EXISTS (SELECT 1 FROM dojo_members o WHERE o.user_id = m.user_id AND o.dojo_id <> :d)`, { d: id });
    const userIds = only.map((r) => r.id);
    const [[{ members }]] = await conn.query('SELECT COUNT(*) AS members FROM dojo_members WHERE dojo_id = :d', { d: id });

    // Todas las tablas con dojo_id, de las que dependen de otras hacia sus dependencias.
    // (Las llaves RESTRICT impiden la cascada en un solo paso; las SET NULL dejarían datos sueltos.)
    // Sesiones e historial de acceso son de la persona: si su cuenta se borra se van con ella; si no,
    // solo pierden la referencia al dojo (SET NULL) y nadie más pierde su sesión.
    const KEEP = new Set(['auth_sessions', 'login_history']);
    for (const t of (await tablesByDependency(conn)).filter((x) => !KEEP.has(x))) {
      await conn.query(`DELETE FROM \`${t}\` WHERE dojo_id = :d`, { d: id });
    }
    await conn.query('DELETE FROM dojos WHERE id = :d', { d: id });
    if (userIds.length) await conn.query('DELETE FROM users WHERE id IN (:ids)', { ids: userIds });

    await audit(conn, {
      dojoId: null, userId: actor.userId, action: 'delete', entity: 'platform_dojo', entityId: id, ip,
      after: { slug: d.slug, name: d.name, members, accounts_deleted: userIds.length },
    });
    return { members, accountsDeleted: userIds.length, userIds };
  });

  // Archivos: logo del dojo y fotos de las cuentas borradas
  const root = path.resolve(env.UPLOAD_DIR);
  const rm = (rel) => fs.promises.rm(path.join(root, rel), { recursive: true, force: true }).catch(() => {});
  await rm(`dojos/${id}`);
  for (const uid of result.userIds) await rm(`avatars/${uid}`);

  return { id, slug: d.slug, name: d.name, members: result.members, accounts_deleted: result.accountsDeleted };
}

module.exports = { listDojos, getDojo, createDojo, updateDojo, deleteDojo, RESERVED };
