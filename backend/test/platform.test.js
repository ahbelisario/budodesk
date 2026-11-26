/**
 * Panel de plataforma (superadmin): dojos, modo soporte y respaldos.
 * S3 se prueba solo si hay un servidor compatible: S3_TEST_ENDPOINT=http://127.0.0.1:5055 (p. ej. moto_server).
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { resetDatabase, PASSWORD, DB_NAME } = require('./helpers');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-plat-'));
process.env.BACKUP_DIR = path.join(TMP, 'backups');
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.BACKUP_ENCRYPTION_KEY = 'llave-de-prueba-llave-de-prueba-1234567';
const S3_ENDPOINT = process.env.S3_TEST_ENDPOINT;

let request; let app; let pool; let outbox; let backups;
const T = {};

before(async () => {
  await resetDatabase();
  fs.mkdirSync(path.join(process.env.UPLOAD_DIR, 'logos'), { recursive: true });
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'logos', 'logo.png'), Buffer.from('PNG-de-prueba'));
  request = require('supertest');
  ({ pool } = require('../src/db/pool'));
  ({ outbox } = require('../src/services/mailer'));
  await require('../src/db/migrate').migrate({ backup: false, quiet: true }); // la 0001 no cambia nada sobre el esquema base
  backups = require('../src/modules/platform/backups.service');
  app = require('../src/app').createApp();
  await pool.query('UPDATE users SET is_superadmin = 1 WHERE id = 1');
  const login = async (identifier, extra = {}) =>
    (await request(app).post('/api/v2/auth/login').send({ identifier, password: PASSWORD, ...extra })).body.data.access_token;
  T.super = await login('admin@seikoukan.mx');
  T.other = await login('admin@otro.mx');
});
after(async () => {
  await pool.query('DROP DATABASE IF EXISTS budodesk_restore').catch(() => {});
  await pool.end();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const api = (method, url, token, body) => {
  const r = request(app)[method](`/api/v2${url}`);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};
const ok = (r, status = 200) => {
  if (r.status !== status) assert.fail(`HTTP ${r.status} (esperado ${status}): ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function runAndWait(token = T.super) {
  const b = ok(await api('post', '/platform/backups/run', token), 202);
  assert.equal(b.status, 'running');
  for (let i = 0; i < 100 && backups.isRunning(); i += 1) await new Promise((r) => setTimeout(r, 100));
  return backups.getBackup(b.id);
}

// ===========================================================================
describe('dojos', () => {
  test('solo el superadmin entra al panel', async () => {
    assert.equal((await api('get', '/platform/dojos', T.other)).status, 403);
    assert.equal((await api('get', '/platform/backups', T.other)).status, 403);
    assert.equal((await api('get', '/platform/dojos')).status, 401);
  });

  test('lista con métricas', async () => {
    const list = ok(await api('get', '/platform/dojos', T.super));
    const sk = list.find((d) => d.slug === 'seikoukan');
    assert.equal(sk.is_member, true);
    assert.equal(sk.members_active, 3);
    assert.equal(sk.students_active, 1);
    assert.match(sk.owner_emails, /admin@seikoukan\.mx/);
    assert.equal(list.find((d) => d.slug === 'otro').is_member, false);
  });

  test('alta copiando la configuración y con dueño nuevo', async () => {
    outbox.length = 0;
    const r = ok(await api('post', '/platform/dojos', T.super, {
      name: 'Dojo Nuevo', slug: 'Dojo-Nuevo', owner_email: 'Duena@Nuevo.MX', owner_first_name: 'Dueña',
      copy_from_dojo_id: 1,
    }), 201);
    assert.equal(r.dojo.slug, 'dojo-nuevo');
    assert.equal(r.dojo.status, 'trial');
    assert.ok(r.dojo.trial_ends_at);
    assert.equal(r.owner.created, true);
    assert.equal(r.owner.email_sent, true);
    assert.equal(outbox.at(-1).template, 'account_access');
    assert.equal(outbox.at(-1).to, 'duena@nuevo.mx');

    const [[src]] = await pool.query(`SELECT
      (SELECT COUNT(*) FROM disciplines WHERE dojo_id = 1) d, (SELECT COUNT(*) FROM ranks WHERE dojo_id = 1) r,
      (SELECT COUNT(*) FROM plans WHERE dojo_id = 1) p, (SELECT COUNT(*) FROM discounts WHERE dojo_id = 1) x`);
    assert.deepEqual(r.copied, { disciplines: Number(src.d), ranks: Number(src.r), plans: Number(src.p), discounts: Number(src.x) });

    // Los grados copiados apuntan a disciplinas y tracks del dojo nuevo, no del original
    const [bad] = await pool.query(
      `SELECT r.id FROM ranks r LEFT JOIN rank_tracks t ON t.id = r.track_id AND t.dojo_id = r.dojo_id
        LEFT JOIN disciplines d ON d.id = r.discipline_id AND d.dojo_id = r.dojo_id
       WHERE r.dojo_id = :d AND (t.id IS NULL OR d.id IS NULL)`, { d: r.dojo.id });
    assert.equal(bad.length, 0);
    const [[pay]] = await pool.query('SELECT accepts_cash FROM dojo_payment_settings WHERE dojo_id = :d', { d: r.dojo.id });
    assert.equal(pay.accepts_cash, 1);
    const [[own]] = await pool.query(
      "SELECT role FROM dojo_member_roles WHERE dojo_id = :d AND user_id = :u", { d: r.dojo.id, u: r.owner.id });
    assert.equal(own.role, 'owner');
  });

  test('dueño que ya tiene cuenta: se liga sin mandar correo', async () => {
    outbox.length = 0;
    const r = ok(await api('post', '/platform/dojos', T.super, {
      name: 'Segundo', slug: 'segundo', owner_email: 'sensei@ambos.mx', owner_first_name: 'X', status: 'active',
    }), 201);
    assert.equal(r.owner.created, false);
    assert.equal(r.owner.has_password, true);
    assert.equal(r.owner.email_sent, false);
    assert.equal(outbox.length, 0);
    assert.equal(r.dojo.status, 'active');
    assert.equal(r.dojo.trial_ends_at, null);
  });

  test('subdominio repetido, reservado o inválido', async () => {
    const base = { name: 'X Dojo', owner_email: 'a@b.mx', owner_first_name: 'A' };
    assert.equal((await api('post', '/platform/dojos', T.super, { ...base, slug: 'seikoukan' })).status, 409);
    assert.equal((await api('post', '/platform/dojos', T.super, { ...base, slug: 'admin' })).status, 400);
    assert.equal((await api('post', '/platform/dojos', T.super, { ...base, slug: '-mal-' })).status, 400);
    assert.equal((await api('post', '/platform/dojos', T.super, { ...base, slug: 'okey', timezone: 'Marte/Base' })).status, 400);
  });

  test('modo soporte: el superadmin entra a un dojo donde no es miembro', async () => {
    const s = ok(await api('post', '/auth/switch-dojo', T.super, { dojo_id: 2 }));
    assert.equal(s.dojo.support, true);
    assert.ok(s.dojo.roles.includes('owner'));
    const tok = s.access_token;
    const me = ok(await api('get', '/auth/me', tok));
    assert.equal(me.dojo.id, 2);
    assert.equal(me.dojo.support, true);
    ok(await api('get', '/members', tok));            // ve los miembros del otro dojo
    // Un admin normal no puede hacer lo mismo
    assert.equal((await api('post', '/auth/switch-dojo', T.other, { dojo_id: 1 })).status, 403);
    // No se recuerda como "último dojo"
    const [[st]] = await pool.query('SELECT last_dojo_id FROM user_settings WHERE user_id = 1');
    assert.notEqual(st.last_dojo_id, 2);
  });

  test('superadmin que no es miembro de ningún dojo entra en modo soporte', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pool.query(`INSERT INTO users (email, password_hash, email_verified_at, is_superadmin) VALUES ('plataforma@budodesk.mx', :h, NOW(), 1)`, { h: hash });
    await pool.query(`INSERT INTO user_profiles (user_id, first_name) SELECT id, 'Plataforma' FROM users WHERE email = 'plataforma@budodesk.mx'`);
    const r = ok(await request(app).post('/api/v2/auth/login').send({ identifier: 'plataforma@budodesk.mx', password: PASSWORD }));
    assert.equal(r.dojo.support, true);
    assert.equal(r.dojo.slug, 'seikoukan');
    assert.deepEqual(r.dojos, []);
    ok(await api('get', '/platform/dojos', r.access_token));
    ok(await api('get', '/members', r.access_token));
    // Con subdominio entra a ese dojo
    const r2 = ok(await request(app).post('/api/v2/auth/login').send({ identifier: 'plataforma@budodesk.mx', password: PASSWORD, dojo_slug: 'otro' }));
    assert.equal(r2.dojo.slug, 'otro');
    // Y al refrescar la sesión sigue dentro
    const rr = ok(await request(app).post('/api/v2/auth/refresh').send({ refresh_token: r2.refresh_token }));
    assert.equal(rr.dojo.slug, 'otro');
    assert.equal(rr.dojo.support, true);
  });

  test('suspender un dojo corta el acceso a sus miembros, no al superadmin', async () => {
    const d = ok(await api('patch', '/platform/dojos/2', T.super, { status: 'suspended' }));
    assert.equal(d.status, 'suspended');
    const r = await api('get', '/members', T.other);
    assert.equal(r.status, 403);
    const s = ok(await api('post', '/auth/switch-dojo', T.super, { dojo_id: 2 }));
    ok(await api('get', '/members', s.access_token));
    ok(await api('patch', '/platform/dojos/2', T.super, { status: 'active' }));
    ok(await api('get', '/members', T.other));
  });
});

// ===========================================================================
describe('cobro por dojo: cargos automáticos y recordatorios', () => {
  const { today } = require('./helpers');
  let msId;

  before(async () => {
    const [[plan]] = await pool.query("SELECT id, price FROM plans WHERE dojo_id = 1 AND name = 'Individual Mensual'");
    const [r] = await pool.query(
      `INSERT INTO memberships (dojo_id, plan_id, payer_user_id, status, start_date, current_period_start, current_period_end,
                                next_billing_date, price, currency, auto_renew)
       VALUES (1, :p, 2, 'active', :s, :s, :e, :nb, :price, 'MXN', 1)`,
      { p: plan.id, s: today(-70), e: today(-40), nb: today(-39), price: plan.price });
    msId = r.insertId;
    await pool.query('INSERT INTO membership_members (dojo_id, membership_id, user_id) VALUES (1, :m, 2)', { m: msId });
  });

  test('los ajustes de cobro traen los dos interruptores prendidos', async () => {
    const s = ok(await api('get', '/dojo/payment-settings', T.super));
    assert.equal(s.auto_charges, 1);
    assert.equal(s.payment_reminders, 1);
  });

  test('cargos automáticos apagados: el periodo avanza pero no se crea el cargo', async () => {
    ok(await api('patch', '/dojo/payment-settings', T.super, { auto_charges: false }));
    const { runBillingForDojo } = require('../src/modules/memberships/memberships.service');
    const r = await runBillingForDojo(1);
    assert.ok(r.renewed >= 1);
    const [[c]] = await pool.query('SELECT COUNT(*) n FROM charges WHERE membership_id = :m', { m: msId });
    assert.equal(Number(c.n), 0);
    const [[ms]] = await pool.query('SELECT next_billing_date, status FROM memberships WHERE id = :m', { m: msId });
    assert.ok(ms.next_billing_date > today(), 'el periodo quedó al corriente');
    assert.equal(ms.status, 'active');
  });

  test('cargos automáticos prendidos: se crea el cargo de cada periodo', async () => {
    ok(await api('patch', '/dojo/payment-settings', T.super, { auto_charges: true }));
    await pool.query('UPDATE memberships SET next_billing_date = :nb WHERE id = :m', { nb: today(-9), m: msId });
    await require('../src/modules/memberships/memberships.service').runBillingForDojo(1);
    const [[c]] = await pool.query('SELECT COUNT(*) n FROM charges WHERE membership_id = :m', { m: msId });
    assert.ok(Number(c.n) >= 1);
  });

  test('recordatorios apagados: no se avisa de pagos por vencer', async () => {
    const { paymentReminders } = require('../src/modules/notifications/notify.service');
    const { addDays } = require('../src/utils/dates');
    await pool.query(
      `INSERT INTO charges (dojo_id, user_id, type, description, amount, currency, due_date)
       VALUES (1, 2, 'other', 'Cuota de prueba', 300, 'MXN', :d)`, { d: today(3) });
    ok(await api('patch', '/dojo/payment-settings', T.super, { payment_reminders: false }));
    const off = await paymentReminders(1, today(), { addDays });
    assert.equal(off.disabled, true);
    assert.equal(off.due, 0);
    ok(await api('patch', '/dojo/payment-settings', T.super, { payment_reminders: true }));
    const on = await paymentReminders(1, today(), { addDays });
    assert.ok(on.due >= 1);
  });
});

// ===========================================================================
describe('respaldos', () => {
  let first;

  test('ajustes iniciales', async () => {
    const d = ok(await api('get', '/platform/backups', T.super));
    assert.equal(d.settings.backup_enabled, false);
    assert.equal(d.settings.backup_keep, 5);
    assert.equal(d.settings.encryption_available, true);
    assert.equal(d.settings.s3_has_secret, false);
    assert.equal('s3_secret_enc' in d.settings, false);
    assert.deepEqual(d.backups, []);
  });

  test('respaldar ahora: base + archivos en un .tar.gz', async () => {
    first = await runAndWait();
    assert.equal(first.status, 'ok', first.error);
    assert.ok(first.size_bytes > 1000);
    assert.ok(first.rows_count > 50);
    assert.equal(first.files_count, 1);
    const file = path.join(process.env.BACKUP_DIR, first.filename);
    assert.equal(sha(fs.readFileSync(file)), first.sha256);
    assert.match(first.filename, /^budodesk-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.gz$/);

    const out = path.join(TMP, 'x1');
    fs.mkdirSync(out);
    await require('tar').x({ file, cwd: out });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.app, 'BudoDesk');
    assert.equal(fs.readFileSync(path.join(out, 'uploads', 'logos', 'logo.png'), 'utf8'), 'PNG-de-prueba');
    assert.ok(fs.existsSync(path.join(out, 'budodesk.sql')));
  });

  test('el respaldo se restaura idéntico en otra base (tablas, datos y vistas)', async () => {
    const mysql = require('mysql2/promise');
    const sql = fs.readFileSync(path.join(TMP, 'x1', 'budodesk.sql'), 'utf8');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, socketPath: process.env.TEST_DB_SOCKET, multipleStatements: true,
    });
    await conn.query('DROP DATABASE IF EXISTS budodesk_restore; CREATE DATABASE budodesk_restore; USE budodesk_restore');
    await conn.query(sql);
    const [tables] = await conn.query(
      `SELECT TABLE_NAME AS t, TABLE_TYPE AS k FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${DB_NAME}' ORDER BY 1`);
    const [restored] = await conn.query(
      "SELECT TABLE_NAME AS t, TABLE_TYPE AS k FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'budodesk_restore' ORDER BY 1");
    assert.deepEqual(restored, tables);
    for (const { t, k } of tables.filter((x) => x.k === 'BASE TABLE')) {
      // El respaldo es de antes: comparo contra los datos tal como estaban (no cambió nada desde entonces salvo backups)
      if (t === 'backups' || t === 'audit_log' || t === 'auth_sessions' || t === 'users') continue;
      const [[a]] = await conn.query(`CHECKSUM TABLE \`${DB_NAME}\`.\`${t}\``);
      const [[b]] = await conn.query(`CHECKSUM TABLE budodesk_restore.\`${t}\``);
      assert.equal(String(b.Checksum), String(a.Checksum), `tabla ${t} (${k})`);
    }
    // La columna calculada se recalcula al restaurar y las vistas funcionan
    await conn.query('SELECT * FROM budodesk_restore.v_member_balance LIMIT 1');
    await conn.end();
  });

  test('descarga con enlace temporal', async () => {
    const link = ok(await api('post', `/platform/backups/${first.id}/link`, T.super, { source: 'local' }));
    assert.equal(link.expires_in, 300);
    const r = await request(app).get(link.url).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-disposition'], new RegExp(first.filename));
    assert.equal(sha(r.body), first.sha256);
    assert.equal((await request(app).get('/api/v2/platform/backups/download?token=falso')).status, 401);
    // Un admin normal no puede pedir enlaces
    assert.equal((await api('post', `/platform/backups/${first.id}/link`, T.other, {})).status, 403);
  });

  test('no se pueden correr dos a la vez', async () => {
    const { done } = await backups.startBackup({ trigger: 'manual', userId: 1 });
    assert.equal((await api('post', '/platform/backups/run', T.super)).status, 409);
    await done;
  });

  test('se ciclan: solo quedan los últimos N en el servidor', async () => {
    ok(await api('put', '/platform/backups/settings', T.super, { backup_keep: 2 }));
    await runAndWait();
    const list = ok(await api('get', '/platform/backups', T.super)).backups;
    const avail = list.filter((b) => b.local_available);
    assert.equal(avail.length, 2);
    const files = fs.readdirSync(process.env.BACKUP_DIR).filter((f) => f.endsWith('.tar.gz'));
    assert.equal(files.length, 2);
    assert.ok(list.find((b) => b.id === first.id).local_deleted_at);
    assert.equal((await api('post', `/platform/backups/${first.id}/link`, T.super, {})).status, 400);
    assert.equal((await api('put', '/platform/backups/settings', T.super, { backup_keep: 11 })).status, 400);
  });

  test('programación diaria y semanal en hora local', async () => {
    const s = { timezone: 'America/Mexico_City', backup_frequency: 'daily', backup_hour: 3, backup_weekday: 0, backup_enabled: 1 };
    // 2026-11-25 10:00 UTC = 04:00 en CDMX → toca el de hoy 03:00
    assert.equal(backups.lastSlot(s, new Date('2026-11-25T10:00:00Z')), '2026-11-25 03:00');
    // 08:00 UTC = 02:00 en CDMX → todavía es el de ayer
    assert.equal(backups.lastSlot(s, new Date('2026-11-25T08:00:00Z')), '2026-11-24 03:00');
    // Semanal en domingo: el miércoles 25 nov el último fue el domingo 22
    assert.equal(backups.lastSlot({ ...s, backup_frequency: 'weekly' }, new Date('2026-11-25T10:00:00Z')), '2026-11-22 03:00');

    await pool.query("DELETE FROM backups WHERE `trigger` = 'auto'");
    assert.equal(await backups.isDue(s, new Date('2026-11-25T10:00:00Z')), true);
    assert.equal(await backups.isDue({ ...s, backup_enabled: 0 }), false);
    await pool.query("INSERT INTO backups (filename, `trigger`, status, started_at) VALUES ('x.tar.gz', 'auto', 'failed', '2026-11-25 09:30:00')");
    assert.equal(await backups.isDue(s, new Date('2026-11-25T10:00:00Z')), false, 'ya se intentó en este horario');
    assert.equal(await backups.isDue(s, new Date('2026-11-26T09:05:00Z')), true, 'al día siguiente sí');
    await pool.query("DELETE FROM backups WHERE filename = 'x.tar.gz'");
  });

  test('si falla, queda marcado y avisa por correo a los superadmins', async () => {
    outbox.length = 0;
    const realDir = process.env.BACKUP_DIR;
    const env = require('../src/config/env');
    fs.writeFileSync(path.join(TMP, 'archivo'), 'x');
    env.BACKUP_DIR = path.join(TMP, 'archivo', 'no-se-puede'); // carpeta imposible
    const b = await runAndWait();
    env.BACKUP_DIR = realDir;
    assert.equal(b.status, 'failed');
    assert.ok(b.error);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(outbox.some((m) => m.to === 'admin@seikoukan.mx' && /respaldo/i.test(m.vars.body)));
  });
});

// ===========================================================================
describe('respaldos en S3', { skip: !S3_ENDPOINT && 'sin S3_TEST_ENDPOINT' }, () => {
  const cfg = { s3_endpoint: S3_ENDPOINT, s3_region: 'us-east-1', s3_bucket: 'budodesk-pruebas', s3_prefix: `prd-${Date.now()}/`,
    s3_access_key: 'prueba', s3_secret: 'secreto-de-prueba', s3_force_path_style: true };

  before(async () => {
    const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
    const c = new S3Client({ region: 'us-east-1', endpoint: S3_ENDPOINT, forcePathStyle: true,
      credentials: { accessKeyId: 'prueba', secretAccessKey: 'secreto-de-prueba' } });
    await c.send(new CreateBucketCommand({ Bucket: 'budodesk-pruebas' })).catch(() => {});
    c.destroy();
  });

  test('probar conexión antes de guardar', async () => {
    ok(await api('post', '/platform/backups/s3/test', T.super, cfg));
    const r = await api('post', '/platform/backups/s3/test', T.super, { ...cfg, s3_bucket: 'no-existe-este' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /bucket/i);
  });

  test('activar S3 guarda la llave cifrada y nunca la devuelve', async () => {
    const s = ok(await api('put', '/platform/backups/settings', T.super, { ...cfg, s3_enabled: true, s3_keep: 2 }));
    assert.equal(s.s3_enabled, true);
    assert.equal(s.s3_has_secret, true);
    const [[row]] = await pool.query('SELECT s3_secret_enc FROM platform_settings WHERE id = 1');
    assert.match(row.s3_secret_enc, /^v1:/);
    assert.doesNotMatch(row.s3_secret_enc, /secreto-de-prueba/);
    // Guardar sin mandar la llave conserva la anterior
    ok(await api('put', '/platform/backups/settings', T.super, { s3_keep: 2 }));
    assert.equal(ok(await api('get', '/platform/backups', T.super)).settings.s3_has_secret, true);
  });

  test('cada respaldo sube cifrado, se descarga y se descifra igual al original', async () => {
    const b = await runAndWait();
    assert.equal(b.status, 'ok');
    assert.equal(b.s3_status, 'ok', b.s3_error);
    assert.equal(b.s3_key, `${cfg.s3_prefix}${b.filename}.enc`);

    const link = ok(await api('post', `/platform/backups/${b.id}/link`, T.super, { source: 's3' }));
    const r = await request(app).get(link.url).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.subarray(0, 5).toString(), 'BDBK1');
    const { decryptStream } = require('../src/modules/platform/crypto');
    const { Readable } = require('stream');
    const plain = [];
    await require('stream/promises').pipeline(Readable.from([r.body]), decryptStream(), async function* (src) {
      for await (const c of src) plain.push(c);
    });
    assert.equal(sha(Buffer.concat(plain)), b.sha256);

    // Con otra llave no se puede abrir
    await assert.rejects(require('stream/promises').pipeline(
      Readable.from([r.body]), decryptStream('otra-llave-otra-llave-otra-llave-otra'), async function* (src) { for await (const _ of src); },
    ), /llave/);
  });

  test('en S3 también se ciclan con su propio número', async () => {
    await runAndWait();
    await runAndWait();
    const list = ok(await api('get', '/platform/backups', T.super)).backups;
    assert.equal(list.filter((b) => b.s3_available).length, 2);
    assert.ok(list.some((b) => b.s3_status === 'deleted'));
    const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const c = new S3Client({ region: 'us-east-1', endpoint: S3_ENDPOINT, forcePathStyle: true,
      credentials: { accessKeyId: 'prueba', secretAccessKey: 'secreto-de-prueba' } });
    const objs = await c.send(new ListObjectsV2Command({ Bucket: 'budodesk-pruebas', Prefix: cfg.s3_prefix }));
    assert.equal(objs.KeyCount, 2);
    c.destroy();
  });
});
