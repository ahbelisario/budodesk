/**
 * Descifra una copia de respaldo de S3 (.enc) con BACKUP_ENCRYPTION_KEY.
 * Lee de la entrada estándar y escribe el .tar.gz en la salida estándar:
 *
 *   docker compose -f compose-prd.yaml exec -T backend node scripts/backup-decrypt.js < archivo.tar.gz.enc > archivo.tar.gz
 *
 * (./deploy.sh restore lo hace solo.)  Falla si la llave no corresponde o el archivo está dañado.
 */
const { pipeline } = require('stream/promises');
const { decryptStream } = require('../src/modules/platform/crypto');

pipeline(process.stdin, decryptStream(), process.stdout).catch((e) => {
  process.stderr.write(`No se pudo descifrar: ${e.message}\n`);
  process.exit(1);
});
