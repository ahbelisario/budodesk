#!/usr/bin/env node
/**
 * Crea la siguiente migración vacía.
 *   npm run migration -- agrega_telefono_tutor          → migrations/0002_agrega_telefono_tutor.sql
 *   npm run migration -- agrega_telefono_tutor --js     → .js (para revisar antes de cambiar)
 */
const fs = require('fs');
const path = require('path');
const { listMigrations, DIR } = require('../src/db/migrate');

const args = process.argv.slice(2);
const js = args.includes('--js');
const name = (args.find((a) => !a.startsWith('--')) || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
if (!name) { console.error('Uso: npm run migration -- nombre_descriptivo [--js]'); process.exit(2); }
const last = listMigrations().map((m) => Number(m.version.slice(0, 4))).reduce((a, b) => Math.max(a, b), 0);
const file = path.join(DIR, `${String(last + 1).padStart(4, '0')}_${name}.${js ? 'js' : 'sql'}`);
const body = js
  ? `/**\n * ${path.basename(file)}\n * Qué cambia y por qué.\n */\nexports.up = async (db, h) => {\n  // await h.addColumnIfMissing('tabla', 'columna', "VARCHAR(100) NULL AFTER \`otra\`");\n  // await db.query('UPDATE …');\n};\n`
  : `-- ${path.basename(file)}\n-- Qué cambia y por qué.\n-- Una sola idea por migración. No edites esta migración después de subirla: crea otra.\n\n`;
fs.writeFileSync(file, body, { flag: 'wx' });
console.log(`Creada: migrations/${path.basename(file)}`);
