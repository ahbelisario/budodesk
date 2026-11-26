/**
 * Migraciones de esquema.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { resetDatabase } = require('./helpers');

let pool; let M; let env;
const tmpDirs = [];
const mkdir = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-mig-'));
  tmpDirs.push(d);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(d, name), content);
  return d;
};
const REAL_0001 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_puesta_al_dia_1_0_8.js'), 'utf8');

before(async () => {
  await resetDatabase();
  ({ pool } = require('../src/db/pool'));
  M = require('../src/db/migrate');
  env = require('../src/config/env');
});
after(async () => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  await pool.end();
});

const col = async (t, c) => (await pool.query(
  'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]))[0].length > 0;
const tbl = async (t) => (await pool.query(
  'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]))[0].length > 0;

describe('migraciones', () => {
  test('sobre el esquema base: la 0001 no cambia nada y queda registrada una sola vez', async () => {
    // resetDatabase ya aplicó las migraciones, como un servidor nuevo
    const r2 = await M.migrate({ backup: false, quiet: true });
    assert.deepEqual(r2.applied, []);
    const s = await M.status();
    assert.deepEqual(s.pending, []);
    assert.equal(s.applied[0].app_version, require('../package.json').version);
  });

  test('una prd instalada antes (sin finanzas ni push) queda al día sin perder datos', async () => {
    // Simula la base de antes: sin las tablas y columnas que llegaron con SQL sueltos
    await pool.query('DROP TABLE finance_entries, finance_recurring, finance_categories');
    await pool.query('ALTER TABLE push_tokens DROP COLUMN subscription');
    await pool.query('ALTER TABLE platform_settings DROP COLUMN vapid_private_key, DROP COLUMN vapid_public_key');
    await pool.query('ALTER TABLE dojo_payment_settings DROP COLUMN payment_reminders');
    await pool.query("DELETE FROM schema_migrations WHERE version = '0001_puesta_al_dia_1_0_8'");
    const [[before1]] = await pool.query('SELECT COUNT(*) n FROM users');

    const r = await M.migrate({ backup: false, quiet: true });
    assert.deepEqual(r.applied, ['0001_puesta_al_dia_1_0_8']);
    for (const t of ['finance_entries', 'finance_recurring', 'finance_categories']) assert.ok(await tbl(t), t);
    assert.ok(await col('push_tokens', 'subscription'));
    assert.ok(await col('platform_settings', 'vapid_public_key'));
    assert.ok(await col('dojo_payment_settings', 'payment_reminders'));
    const [[{ v }]] = await pool.query("SELECT payment_reminders v FROM dojo_payment_settings LIMIT 1").catch(() => [[{ v: 1 }]]);
    assert.equal(Number(v), 1);
    assert.equal((await pool.query('SELECT COUNT(*) n FROM users'))[0][0].n, before1.n);
  });

  test('migraciones nuevas .sql y .js se aplican en orden', async () => {
    const dir = mkdir({
      '0001_puesta_al_dia_1_0_8.js': REAL_0001,
      '0002_nota_en_dojos.sql': 'ALTER TABLE dojos ADD COLUMN prueba_nota VARCHAR(50) NULL;\nUPDATE dojos SET prueba_nota = \'hola\';',
      '0003_indice_si_falta.js': `exports.up = async (db, h) => {
        if (!(await h.indexExists('dojos', 'idx_prueba_nota'))) await db.query('CREATE INDEX idx_prueba_nota ON dojos (prueba_nota)');
        await h.addColumnIfMissing('dojos', 'prueba_nota', 'VARCHAR(50) NULL'); // ya existe: no hace nada
      };`,
    });
    const r = await M.migrate({ dir, backup: false, quiet: true });
    assert.deepEqual(r.applied, ['0002_nota_en_dojos', '0003_indice_si_falta']);
    const [[d]] = await pool.query('SELECT prueba_nota FROM dojos WHERE id = 1');
    assert.equal(d.prueba_nota, 'hola');
  });

  test('si una falla: se detiene, no la registra, y las siguientes no corren', async () => {
    const dir = mkdir({
      '0001_puesta_al_dia_1_0_8.js': REAL_0001,
      '0004_falla.sql': 'ALTER TABLE tabla_que_no_existe ADD COLUMN x INT;',
      '0005_despues.sql': 'ALTER TABLE dojos ADD COLUMN no_debe_existir INT NULL;',
    });
    await assert.rejects(M.migrate({ dir, backup: false, quiet: true }), /0004_falla\.sql falló/);
    const s = await M.status({ dir });
    assert.deepEqual(s.pending, ['0004_falla', '0005_despues']);
    assert.equal(await col('dojos', 'no_debe_existir'), false);
  });

  test('editar una ya aplicada se detecta; nombres y números inválidos se rechazan', async () => {
    const dir = mkdir({ '0001_puesta_al_dia_1_0_8.js': `${REAL_0001}\n// editada` });
    assert.deepEqual((await M.status({ dir })).changed, ['0001_puesta_al_dia_1_0_8']);
    assert.throws(() => M.listMigrations(mkdir({ '2_mal.sql': '' })), /Nombre de migración inválido/);
    assert.throws(() => M.listMigrations(mkdir({ '0007_a.sql': '', '0007_b.sql': '' })), /Dos migraciones con el número 0007/);
  });

  test('respaldo previo: comprimido, con la base, y se guardan los últimos 5', async () => {
    const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-bk-'));
    tmpDirs.push(bdir);
    const prev = env.BACKUP_DIR;
    env.BACKUP_DIR = bdir;
    try {
      for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(bdir, `antes-de-migrar-20200101-00000${i}-0001.sql.gz`), 'x');
      const dir = mkdir({ '0001_puesta_al_dia_1_0_8.js': REAL_0001, '0008_algo.sql': 'SELECT 1;' });
      const r = await M.migrate({ dir, quiet: true });
      assert.deepEqual(r.applied, ['0008_algo']);
      assert.ok(r.backup && fs.existsSync(r.backup));
      const sql = zlib.gunzipSync(fs.readFileSync(r.backup)).toString();
      assert.match(sql, /CREATE TABLE `dojos`/);
      assert.match(sql, /INSERT INTO `dojos`/);
      const left = fs.readdirSync(bdir).filter((f) => f.startsWith('antes-de-migrar-'));
      assert.equal(left.length, 5);
      assert.ok(left.includes(path.basename(r.backup)));
    } finally {
      env.BACKUP_DIR = prev;
    }
  });

  test('dos arranques al mismo tiempo: solo uno la aplica', async () => {
    const dir = mkdir({
      '0001_puesta_al_dia_1_0_8.js': REAL_0001,
      '0009_lenta.js': "exports.up = async (db) => { await db.query('SELECT SLEEP(0.5)'); await db.query('ALTER TABLE dojos ADD COLUMN prueba_lenta INT NULL'); };",
    });
    const [a, b] = await Promise.all([M.migrate({ dir, backup: false, quiet: true }), M.migrate({ dir, backup: false, quiet: true })]);
    assert.deepEqual([...a.applied, ...b.applied], ['0009_lenta']);
  });
});
