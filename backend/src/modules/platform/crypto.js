/**
 * Cifrado de respaldos (AES-256-GCM) con la llave BACKUP_ENCRYPTION_KEY.
 *
 * Archivo cifrado:  "BDBK1" (5 bytes) + IV (12) + datos cifrados + etiqueta GCM (16)
 * Texto cifrado:    "v1:" + base64(IV + etiqueta + datos)   (p. ej. la llave secreta de S3)
 */
const crypto = require('crypto');
const fs = require('fs');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const env = require('../../config/env');

const MAGIC = Buffer.from('BDBK1');
const IV_LEN = 12;
const TAG_LEN = 16;

const hasKey = () => !!env.BACKUP_ENCRYPTION_KEY;
function key(raw = env.BACKUP_ENCRYPTION_KEY) {
  if (!raw) throw new Error('Falta BACKUP_ENCRYPTION_KEY en la configuración');
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptText(text) {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')}`;
}

function decryptText(value) {
  if (!value?.startsWith('v1:')) throw new Error('Formato cifrado desconocido');
  const buf = Buffer.from(value.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, IV_LEN));
  d.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([d.update(buf.subarray(IV_LEN + TAG_LEN)), d.final()]).toString('utf8');
}

/** Stream que cifra: escribe el encabezado, los datos y al final la etiqueta */
function encryptStream(rawKey) {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv('aes-256-gcm', key(rawKey), iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!started) { this.push(Buffer.concat([MAGIC, iv])); started = true; }
      cb(null, c.update(chunk));
    },
    flush(cb) {
      if (!started) this.push(Buffer.concat([MAGIC, iv]));
      this.push(c.final());
      this.push(c.getAuthTag());
      cb();
    },
  });
}

/** Stream que descifra; falla al final si el archivo fue alterado o la llave no es la correcta */
function decryptStream(rawKey) {
  let head = Buffer.alloc(0);
  let decipher = null;
  let tail = Buffer.alloc(0); // retiene los últimos 16 bytes (etiqueta)
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        if (!decipher) {
          head = Buffer.concat([head, chunk]);
          if (head.length < MAGIC.length + IV_LEN) return cb();
          if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('No es un respaldo cifrado de BudoDesk');
          decipher = crypto.createDecipheriv('aes-256-gcm', key(rawKey), head.subarray(MAGIC.length, MAGIC.length + IV_LEN));
          chunk = head.subarray(MAGIC.length + IV_LEN);
        }
        const data = Buffer.concat([tail, chunk]);
        const cut = Math.max(0, data.length - TAG_LEN);
        tail = data.subarray(cut);
        cb(null, cut ? decipher.update(data.subarray(0, cut)) : undefined);
      } catch (e) { cb(e); }
    },
    flush(cb) {
      try {
        if (!decipher || tail.length !== TAG_LEN) throw new Error('Archivo cifrado incompleto');
        decipher.setAuthTag(tail);
        this.push(decipher.final());
        cb();
      } catch (e) {
        cb(new Error(e.message.includes('authenticate') ? 'La llave no corresponde o el archivo está dañado' : e.message));
      }
    },
  });
}

async function encryptFile(src, dest) {
  await pipeline(fs.createReadStream(src), encryptStream(), fs.createWriteStream(dest, { mode: 0o600 }));
}

module.exports = { hasKey, encryptText, decryptText, encryptStream, decryptStream, encryptFile };
