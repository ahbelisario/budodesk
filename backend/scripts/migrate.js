#!/usr/bin/env node
/**
 * Migraciones de esquema desde la consola.
 *   node scripts/migrate.js            estado: aplicadas, pendientes, cambiadas
 *   node scripts/migrate.js up         aplica las pendientes (el backend también lo hace al arrancar)
 */
const { migrate, status } = require('../src/db/migrate');

(async () => {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'up') {
    const r = await migrate();
    console.log(r.applied.length ? `Aplicadas: ${r.applied.join(', ')}` : 'No había migraciones pendientes.');
  } else if (cmd === 'status') {
    const s = await status();
    console.log(`Aplicadas (${s.applied.length}):`);
    for (const a of s.applied) console.log(`  ✔ ${a.version}  ${a.applied_at}  (BudoDesk ${a.app_version ?? '?'})`);
    console.log(s.pending.length ? `Pendientes (${s.pending.length}):\n${s.pending.map((p) => `  • ${p}`).join('\n')}` : 'Pendientes: ninguna');
    if (s.changed.length) console.log(`⚠ Cambiaron después de aplicarse: ${s.changed.join(', ')}`);
    if (s.missing.length) console.log(`⚠ Aplicadas pero ya no están en el código: ${s.missing.join(', ')}`);
  } else {
    console.error('Uso: node scripts/migrate.js [status|up]');
    process.exit(2);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
