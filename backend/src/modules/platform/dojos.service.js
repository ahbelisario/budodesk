/** Administración de dojos desde la plataforma (solo superadmin). Consultas entre dojos: pool directo. */
const { pool, withTransaction, one } = require('../../db/pool');
const { badRequest, conflict, notFound } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const accountService = require('../account/account.service');
const { todayIn } = require('../../utils/dates');

const RESERVED = new Set(['www', 'api', 'app', 'admin', 'dev', 'mail', 'smtp', 'static', 'assets', 'cdn', 'status',
  'docs', 'help', 'soporte', 'support', 'budodesk', 'platform', 'plataforma', 'staging', 'test', 'login', 'auth']);

async function listDojos(viewerId) {
  const [rows] = await pool.query(
    `SELECT d.id, d.slug, d.name, d.short_name, d.logo_url, d.color_primary, d.plan, d.status, d.trial_ends_at,
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
  return rows.map((d) => ({ ...d, is_member: !!d.is_member }));
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
  await audit(pool, { dojoId: id, userId: actorId, action: 'update', entity: 'platform_dojo', entityId: id, ip, before: prev, after: b });
  return getDojo(id, actorId);
}

module.exports = { listDojos, getDojo, createDojo, updateDojo, RESERVED };
