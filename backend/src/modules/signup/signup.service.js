/**
 * Registro de dojos nuevos (SaaS)
 *
 *  1. Formulario público → dojo_signups 'pending' (no crea nada más). Correo a quien
 *     se registra ("recibimos tu solicitud") y a los superadmins ("hay una solicitud").
 *  2. El superadmin la aprueba → se crea el dojo en prueba (createDojo) con su dueño,
 *     y al dueño le llega el correo para crear su contraseña o entrar.
 *     O la rechaza, con aviso opcional.
 *  3. Fin de prueba: avisos a los 7 y 1 días, y al terminar el dojo pasa a 'expired'
 *     (solo lectura; ver middleware/auth). Lo reactiva el superadmin (activo o más prueba).
 */
const env = require('../../config/env');
const { pool, one } = require('../../db/pool');
const { AppError, badRequest, conflict, notFound } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const { sendMail } = require('../../services/mailer');
const { todayIn, addDays } = require('../../utils/dates');
const dojos = require('../platform/dojos.service');
const account = require('../account/account.service');

const BRAND = { dojo: 'BudoDesk', color: '#B91C1C' };

/** '2026-12-26' → '26 de diciembre de 2026' / 'December 26, 2026' */
const fmtDate = (ymd, lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-MX',
  { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));

/** URL del dojo: su subdominio si la app vive en un dominio real; en local, ?dojo= */
function dojoUrl(slug, path = '/') {
  const base = new URL(env.APP_BASE_URL);
  const host = base.hostname;
  const local = host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.');
  if (local) {
    const u = new URL(path, base);
    u.searchParams.set('dojo', slug);
    return u.toString();
  }
  const labels = host.split('.');
  // seikoukan.budodesk.com → nuevo.budodesk.com · budodesk.com → nuevo.budodesk.com
  const parent = labels.length >= 3 ? labels.slice(1).join('.') : host;
  return new URL(path, `${base.protocol}//${slug}.${parent}${base.port ? `:${base.port}` : ''}`).toString();
}

/** Dirección pública del formulario de registro (para el correo de los superadmins) */
const platformUrl = (path) => new URL(path, env.APP_BASE_URL).toString();

async function platformSettings(executor = pool) {
  const s = await one(executor, 'SELECT signup_enabled, trial_days FROM platform_settings WHERE id = 1');
  return { signup_enabled: !!(s?.signup_enabled ?? 1), trial_days: s?.trial_days ?? 30 };
}

async function updateSettings(patch, actorId, ip) {
  const sets = [];
  if (patch.signup_enabled !== undefined) sets.push('signup_enabled = :signup_enabled');
  if (patch.trial_days !== undefined) sets.push('trial_days = :trial_days');
  if (sets.length) {
    await pool.query(`UPDATE platform_settings SET ${sets.join(', ')}, updated_by = :by WHERE id = 1`,
      { signup_enabled: patch.signup_enabled ? 1 : 0, trial_days: patch.trial_days, by: actorId });
    await audit(pool, { userId: actorId, action: 'update', entity: 'signup_settings', entityId: 1, ip, after: patch });
  }
  return platformSettings();
}

/** ¿Se puede usar este subdominio? (ni reservado, ni de un dojo, ni pedido en otra solicitud pendiente) */
async function slugStatus(slug, { exceptSignupId = null } = {}) {
  if (dojos.RESERVED.has(slug)) return { available: false, reason: 'reserved' };
  if (await one(pool, 'SELECT id FROM dojos WHERE slug = :slug', { slug })) return { available: false, reason: 'taken' };
  const pending = await one(pool,
    `SELECT id FROM dojo_signups WHERE slug = :slug AND status = 'pending' AND (:except IS NULL OR id <> :except)`,
    { slug, except: exceptSignupId });
  if (pending) return { available: false, reason: 'pending' };
  return { available: true };
}

async function superadminEmails() {
  const [rows] = await pool.query(
    `SELECT u.email, COALESCE(s.language, 'es') AS lang FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.is_superadmin = 1 AND u.status = 'active' AND u.deleted_at IS NULL AND u.email IS NOT NULL`);
  return rows;
}

// ---------------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------------

async function submit(b, { ip, userAgent }) {
  const settings = await platformSettings();
  if (!settings.signup_enabled) {
    throw new AppError(403, 'SIGNUP_CLOSED', 'Por ahora no estamos recibiendo registros de dojos nuevos');
  }
  const slugInfo = await slugStatus(b.slug);
  if (!slugInfo.available) {
    throw conflict(slugInfo.reason === 'reserved'
      ? `«${b.slug}» está reservado; elige otra dirección`
      : `La dirección «${b.slug}» ya está en uso; elige otra`, 'SLUG_TAKEN');
  }
  if (await one(pool, "SELECT id FROM dojo_signups WHERE email = :e AND status = 'pending'", { e: b.email })) {
    throw conflict('Ya tenemos una solicitud pendiente con ese correo. Te escribiremos en cuanto la revisemos.', 'SIGNUP_PENDING');
  }

  const [r] = await pool.query(
    `INSERT INTO dojo_signups (dojo_name, slug, first_name, last_name, email, phone, city, country_code, timezone,
                               currency, language, disciplines, students_estimate, message, ip_address, user_agent)
     VALUES (:dojo_name, :slug, :first_name, :last_name, :email, :phone, :city, :country_code, :timezone,
             :currency, :language, :disciplines, :students_estimate, :message, :ip, :ua)`,
    {
      ...b, last_name: b.last_name || null, phone: b.phone || null, city: b.city || null,
      disciplines: b.disciplines || null, students_estimate: b.students_estimate ?? null, message: b.message || null,
      ip: ip || null, ua: userAgent?.slice(0, 255) || null,
    });
  const signupId = r.insertId;

  await sendMail('signup_received', {
    to: b.email, lang: b.language,
    vars: { ...BRAND, name: b.first_name, dojo_name: b.dojo_name },
  });
  for (const a of await superadminEmails()) {
    await sendMail('signup_new', {
      to: a.email, lang: a.lang,
      vars: {
        ...BRAND, dojo_name: b.dojo_name, slug: b.slug, name: `${b.first_name} ${b.last_name || ''}`.trim(),
        email: b.email, url: platformUrl('/platform?tab=signups'),
      },
    });
  }
  return { id: signupId, status: 'pending' };
}

// ---------------------------------------------------------------------------
// Superadmin
// ---------------------------------------------------------------------------

async function listSignups({ status }) {
  const [rows] = await pool.query(
    `SELECT s.*, d.slug AS dojo_slug, d.name AS dojo_current_name,
            CONCAT_WS(' ', p.first_name, p.last_name) AS reviewed_by_name,
            EXISTS (SELECT 1 FROM users u WHERE u.email = s.email AND u.deleted_at IS NULL) AS email_has_account
       FROM dojo_signups s
       LEFT JOIN dojos d ON d.id = s.dojo_id
       LEFT JOIN user_profiles p ON p.user_id = s.reviewed_by
      WHERE (:status = 'all' OR s.status = :status)
      ORDER BY s.status = 'pending' DESC, s.created_at DESC
      LIMIT 200`, { status });
  const out = [];
  for (const s of rows) {
    const { ip_address: _ip, user_agent: _ua, ...rest } = s;
    out.push({
      ...rest,
      email_has_account: !!s.email_has_account,
      slug_status: s.status === 'pending' ? await slugStatus(s.slug, { exceptSignupId: s.id }) : null,
    });
  }
  return out;
}

async function getSignup(id) {
  const s = await one(pool, 'SELECT * FROM dojo_signups WHERE id = :id', { id });
  if (!s) throw notFound('Solicitud no encontrada');
  return s;
}

/**
 * Aprueba: crea el dojo en prueba con su dueño. El superadmin puede corregir nombre y
 * dirección, elegir los días de prueba y copiar la configuración de otro dojo.
 */
async function approve(id, b, actorId, ip) {
  const s = await getSignup(id);
  if (s.status !== 'pending') throw conflict('Esta solicitud ya se revisó', 'SIGNUP_REVIEWED');
  const settings = await platformSettings();
  const days = b.trial_days ?? settings.trial_days;
  const slug = (b.slug || s.slug).toLowerCase();
  const trialEnds = addDays(todayIn(s.timezone), days);

  const created = await dojos.createDojo({
    name: b.name || s.dojo_name, short_name: null, slug,
    timezone: s.timezone, currency: s.currency, language: s.language, country_code: s.country_code,
    plan: 'trial', status: 'trial', trial_ends_at: trialEnds,
    owner_email: s.email, owner_first_name: s.first_name, owner_last_name: s.last_name,
    copy_from_dojo_id: b.copy_from_dojo_id || null, send_owner_email: false,
  }, actorId, ip);
  const dojoId = created.dojo.id;

  // Datos de contacto que dio en el formulario
  await pool.query(
    `UPDATE dojos SET email = COALESCE(email, :email), phone = COALESCE(phone, :phone), city = COALESCE(city, :city)
      WHERE id = :id`, { id: dojoId, email: s.email, phone: s.phone, city: s.city });
  if (created.owner.created && s.phone) {
    await pool.query('UPDATE user_profiles SET phone = COALESCE(phone, :phone) WHERE user_id = :u',
      { u: created.owner.id, phone: s.phone });
  }
  await pool.query(
    `UPDATE dojo_signups SET status = 'approved', dojo_id = :d, slug = :slug, reviewed_by = :by, reviewed_at = NOW(),
            review_note = :note WHERE id = :id`,
    { id, d: dojoId, slug, by: actorId, note: b.note || null });
  await audit(pool, { dojoId, userId: actorId, action: 'approve', entity: 'dojo_signup', entityId: id, ip, after: { slug, days } });

  // Correo al dueño: crear contraseña (cuenta nueva o sin contraseña) o simplemente entrar
  let url;
  let template;
  if (created.owner.has_password) {
    template = 'signup_approved';
    url = dojoUrl(slug, '/login');
  } else {
    template = 'signup_approved_new';
    const token = await account.issueToken(pool, created.owner.id, 'password_reset', 7 * 24 * 60);
    const u = new URL(dojoUrl(slug, '/set-password'));
    u.searchParams.set('token', token);
    u.searchParams.set('dojo', slug);
    url = u.toString();
  }
  const mail = await sendMail(template, {
    to: s.email, lang: s.language,
    vars: { ...BRAND, name: s.first_name, dojo_name: b.name || s.dojo_name, days, ends: fmtDate(trialEnds, s.language), url, address: dojoUrl(slug) },
  });

  return { ...created, signup_id: id, email_sent: !!mail.sent, url: dojoUrl(slug) };
}

async function reject(id, b, actorId, ip) {
  const s = await getSignup(id);
  if (s.status !== 'pending') throw conflict('Esta solicitud ya se revisó', 'SIGNUP_REVIEWED');
  await pool.query(
    `UPDATE dojo_signups SET status = 'rejected', reviewed_by = :by, reviewed_at = NOW(), review_note = :note WHERE id = :id`,
    { id, by: actorId, note: b.reason || null });
  await audit(pool, { userId: actorId, action: 'reject', entity: 'dojo_signup', entityId: id, ip, after: { reason: b.reason || null } });
  let emailSent = false;
  if (b.notify) {
    const r = await sendMail(b.reason ? 'signup_rejected_reason' : 'signup_rejected', {
      to: s.email, lang: s.language, vars: { ...BRAND, name: s.first_name, dojo_name: s.dojo_name, reason: b.reason || '' },
    });
    emailSent = !!r.sent;
  }
  return { id, status: 'rejected', email_sent: emailSent };
}

// ---------------------------------------------------------------------------
// Fin de la prueba (cada hora, desde el scheduler)
// ---------------------------------------------------------------------------

/** Días que le quedan a la prueba (0 = hoy es el último día; negativo = terminó) */
function trialDaysLeft(trialEndsAt, timezone, now = new Date()) {
  if (!trialEndsAt) return null;
  const end = typeof trialEndsAt === 'string' ? trialEndsAt.slice(0, 10) : trialEndsAt.toISOString().slice(0, 10);
  const today = todayIn(timezone, now);
  return Math.round((Date.parse(end) - Date.parse(today)) / 864e5);
}

async function ownersOf(dojoId) {
  const [rows] = await pool.query(
    `SELECT u.email, p.first_name, COALESCE(s.language, d.language, 'es') AS lang
       FROM dojo_member_roles r
       JOIN dojo_members m ON m.dojo_id = r.dojo_id AND m.user_id = r.user_id AND m.status = 'active'
       JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL AND u.email IS NOT NULL
       JOIN dojos d ON d.id = r.dojo_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE r.dojo_id = :d AND r.role = 'owner'`, { d: dojoId });
  return rows;
}

async function trialSweep(now = new Date()) {
  const [rows] = await pool.query(
    `SELECT id, slug, name, short_name, color_primary, timezone, DATE_FORMAT(trial_ends_at, '%Y-%m-%d') AS ends, trial_notices
       FROM dojos WHERE status = 'trial' AND trial_ends_at IS NOT NULL`);
  const result = { notified: 0, expired: 0 };
  if (!rows.length) return result;
  const contact = env.SUPPORT_EMAIL || (await superadminEmails())[0]?.email || '';
  for (const d of rows) {
    const left = trialDaysLeft(d.ends, d.timezone, now);
    const sent = new Set(String(d.trial_notices || '').split(',').filter(Boolean));
    let notice = null;
    if (left < 0) notice = 'expired';
    else if (left === 0 && !sent.has('d1')) notice = 'd1'; // último día
    else if (left > 0 && left <= 6 && !sent.has('d7') && !sent.has('d1')) notice = 'd7'; // queda una semana

    if (notice === 'expired') {
      const [u] = await pool.query(
        "UPDATE dojos SET status = 'expired', trial_notices = :n WHERE id = :id AND status = 'trial'",
        { id: d.id, n: [...sent, 'expired'].join(',') });
      if (!u.affectedRows) continue;
      await audit(pool, { dojoId: d.id, userId: null, action: 'expire', entity: 'platform_dojo', entityId: d.id, after: { trial_ends_at: d.ends } });
      result.expired += 1;
    } else if (notice) {
      await pool.query('UPDATE dojos SET trial_notices = :n WHERE id = :id', { id: d.id, n: [...sent, notice].join(',') });
    } else {
      continue;
    }
    for (const o of await ownersOf(d.id)) {
      const template = { expired: 'trial_expired', d1: 'trial_last_day', d7: 'trial_ending' }[notice];
      await sendMail(template, {
        to: o.email, lang: o.lang,
        vars: {
          dojo: d.short_name || d.name, color: d.color_primary, name: o.first_name,
          days: Math.max(left + 1, 1), ends: fmtDate(d.ends, o.lang), contact, url: dojoUrl(d.slug, '/home'),
        },
      });
      result.notified += 1;
    }
  }
  return result;
}

module.exports = {
  dojoUrl, platformSettings, updateSettings, slugStatus, submit, listSignups, approve, reject,
  trialDaysLeft, trialSweep,
};
