/**
 * Prepara una BD de pruebas limpia (esquema v2 + semilla) y datos de ejemplo
 * con DOS dojos para probar el aislamiento.
 *
 * Variables: TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD,
 *            TEST_DB_SOCKET (opcional), SCHEMA_DIR (default ../db/schema)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = 'budodesk_test';
const SCHEMA_DIR = process.env.SCHEMA_DIR || path.join(__dirname, '..', '..', 'db', 'schema');

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'root';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'x';
process.env.DB_NAME = DB_NAME;
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.CORS_ORIGINS = '';

const PASSWORD = 'Contraseña-de-prueba-1';

async function resetDatabase() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    socketPath: process.env.TEST_DB_SOCKET, multipleStatements: true,
  });
  const rename = (sql) => sql.replace(/`budodesk`/g, `\`${DB_NAME}\``);
  await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await conn.query(rename(fs.readFileSync(path.join(SCHEMA_DIR, '01-schema.sql'), 'utf8')));
  await conn.query(rename(fs.readFileSync(path.join(SCHEMA_DIR, '02-seed.sql'), 'utf8')));

  const hash = await bcrypt.hash(PASSWORD, 4); // rondas bajas: solo pruebas
  await conn.query(`USE \`${DB_NAME}\`;
    INSERT INTO dojos (id, slug, name, status) VALUES (2, 'otro', 'Otro Dojo', 'active');
    INSERT INTO disciplines (id, dojo_id, name) VALUES (50, 2, 'Judo');

    INSERT INTO users (id, email, password_hash, email_verified_at) VALUES
      (1, 'admin@seikoukan.mx', ?, NOW()), (2, 'alumno@seikoukan.mx', ?, NOW()),
      (3, 'sensei@ambos.mx', ?, NOW()),    (4, 'admin@otro.mx', ?, NOW());
    INSERT INTO user_profiles (user_id, first_name) VALUES (1,'Admin'),(2,'Alumno'),(3,'Sensei'),(4,'Otro');

    INSERT INTO dojo_members (dojo_id, user_id, status) VALUES
      (1,1,'active'),(1,2,'active'),(1,3,'active'),(2,3,'active'),(2,4,'active');
    INSERT INTO dojo_member_roles (dojo_id, user_id, role) VALUES
      (1,1,'owner'),(1,2,'student'),(1,3,'instructor'),(2,3,'student'),(2,4,'admin');`,
  [hash, hash, hash, hash]);
  await conn.end();
}

/** Hoy en la zona del dojo de pruebas */
function today(offsetDays = 0) {
  const { todayIn, addDays } = require('../src/utils/dates');
  return addDays(todayIn('America/Mexico_City'), offsetDays);
}

module.exports = { resetDatabase, PASSWORD, DB_NAME, today };
