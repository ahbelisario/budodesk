/** S3 compatible (AWS, Backblaze B2, Cloudflare R2, Wasabi, MinIO…) */
const fs = require('fs');
const {
  S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand,
} = require('@aws-sdk/client-s3');

/** cfg: { endpoint, region, bucket, prefix, access_key, secret, force_path_style } */
function client(cfg) {
  return new S3Client({
    region: cfg.region || 'us-east-1',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: !!cfg.force_path_style,
    credentials: { accessKeyId: cfg.access_key, secretAccessKey: cfg.secret },
    // Algunos proveedores compatibles no aceptan las sumas de verificación nuevas de AWS
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });
}

const objectKey = (cfg, name) => {
  const prefix = (cfg.prefix || '').replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${name}` : name;
};

/** Un cliente por operación y se cierra al terminar (no deja conexiones abiertas) */
async function withClient(cfg, fn) {
  const c = client(cfg);
  try { return await fn(c); } finally { c.destroy(); }
}

async function upload(cfg, key, filePath) {
  const { size } = fs.statSync(filePath);
  await withClient(cfg, (c) => c.send(new PutObjectCommand({
    Bucket: cfg.bucket, Key: key, Body: fs.createReadStream(filePath), ContentLength: size,
    ContentType: 'application/octet-stream',
  })));
}

async function remove(cfg, key) {
  await withClient(cfg, (c) => c.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })));
}

/** El cliente se cierra cuando termina (o falla) la lectura del archivo */
async function download(cfg, key) {
  const c = client(cfg);
  try {
    const r = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    const close = () => c.destroy();
    r.Body.once('end', close);
    r.Body.once('error', close);
    r.Body.once('close', close);
    return { body: r.Body, size: r.ContentLength };
  } catch (e) {
    c.destroy();
    throw e;
  }
}

/** Prueba real: el bucket existe y se puede escribir y borrar */
async function test(cfg) {
  await withClient(cfg, async (c) => {
    await c.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    const key = objectKey(cfg, `.budodesk-prueba-${Date.now()}`);
    await c.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: 'ok', ContentLength: 2 }));
    await c.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  });
}

/** Mensaje legible de un error del SDK */
function describe(e) {
  const code = e?.name || e?.Code || '';
  const status = e?.$metadata?.httpStatusCode;
  const map = {
    NoSuchBucket: 'El bucket no existe',
    InvalidAccessKeyId: 'La llave de acceso no es válida',
    SignatureDoesNotMatch: 'La llave secreta no es correcta',
    AccessDenied: 'Acceso denegado: revisa los permisos de la llave sobre el bucket',
    NotFound: 'El bucket no existe o no es accesible',
    Forbidden: 'Acceso denegado: revisa los permisos de la llave sobre el bucket',
  };
  if (map[code]) return map[code];
  if (e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED') return `No se pudo conectar al servidor S3 (${e.code})`;
  return `${code || 'Error'}${status ? ` (HTTP ${status})` : ''}: ${e?.message || e}`.slice(0, 900);
}

module.exports = { upload, remove, download, test, objectKey, describe };
