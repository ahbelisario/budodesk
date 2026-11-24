/**
 * Crea (o actualiza) un usuario y lo hace dueño/admin de un dojo.
 *
 *   npm run create-admin -- --email tu@correo.mx --name Arturo --dojo seikoukan [--superadmin]
 *
 * La contraseña se pide por consola (no queda en el historial del shell) o se
 * toma de la variable ADMIN_PASSWORD si se ejecuta de forma no interactiva.
 */
const readline = require('readline');
const { pool, withTransaction, one } = require('../src/db/pool');
const { hashPassword } = require('../src/modules/auth/auth.service');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const firstName = arg('name') || 'Admin';
  const dojoSlug = arg('dojo');
  const superadmin = process.argv.includes('--superadmin');
  if (!email) throw new Error('Falta --email');

  const password = process.env.ADMIN_PASSWORD || await askHidden('Contraseña (mín. 10 caracteres): ');
  if (!password || password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');
  const hash = await hashPassword(password);

  await withTransaction(async (conn) => {
    let user = await one(conn, 'SELECT id FROM users WHERE email = :email', { email });
    if (user) {
      await conn.query(
        `UPDATE users SET password_hash = :hash, status = 'active', is_superadmin = GREATEST(is_superadmin, :sa),
                password_changed_at = NOW(), email_verified_at = COALESCE(email_verified_at, NOW())
          WHERE id = :id`, { hash, sa: superadmin ? 1 : 0, id: user.id });
    } else {
      const [r] = await conn.query(
        `INSERT INTO users (email, password_hash, is_superadmin, email_verified_at, password_changed_at)
         VALUES (:email, :hash, :sa, NOW(), NOW())`, { email, hash, sa: superadmin ? 1 : 0 });
      user = { id: r.insertId };
      await conn.query(`INSERT INTO user_profiles (user_id, first_name) VALUES (:id, :name)`, { id: user.id, name: firstName });
      await conn.query(`INSERT INTO user_settings (user_id) VALUES (:id)`, { id: user.id });
    }

    if (dojoSlug) {
      const dojo = await one(conn, 'SELECT id FROM dojos WHERE slug = :slug', { slug: dojoSlug });
      if (!dojo) throw new Error(`No existe el dojo "${dojoSlug}"`);
      await conn.query(
        `INSERT INTO dojo_members (dojo_id, user_id, status, joined_at, source)
         VALUES (:d, :u, 'active', CURDATE(), 'admin')
         ON DUPLICATE KEY UPDATE status = 'active'`, { d: dojo.id, u: user.id });
      await conn.query(
        `INSERT IGNORE INTO dojo_member_roles (dojo_id, user_id, role) VALUES (:d, :u, 'owner'), (:d, :u, 'admin')`,
        { d: dojo.id, u: user.id });
    }
    console.log(`Listo: ${email} (id ${user.id})${dojoSlug ? ` es owner/admin de ${dojoSlug}` : ''}${superadmin ? ' · superadmin' : ''}`);
  });
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
