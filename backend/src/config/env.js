// Configuración validada al arrancar. Si falta algo, el proceso no inicia.
require('dotenv').config({ quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1).default('budodesk'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // Genera uno con: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Orígenes permitidos separados por coma. En producción detrás de nginx
  // (mismo origen) puede quedar vacío; en desarrollo: http://localhost:8081
  CORS_ORIGINS: z.string().default(''),
  // Saltos de proxy confiables (nginx = 1). Necesario para leer la IP real.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  APP_BASE_URL: z.string().default('http://localhost:8081'),

  // Correo. Sin SMTP_HOST los correos solo se imprimen en consola (desarrollo).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.stringbool().default(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('BudoDesk <no-reply@budodesk.com>'),

  // Carpeta de archivos subidos (logos, fotos, comprobantes). En Docker: volumen.
  UPLOAD_DIR: z.string().default('uploads'),
  // Respaldos de la plataforma (panel del superadmin). En Docker: volumen.
  BACKUP_DIR: z.string().default('backups'),
  // Cifra las copias en S3 y las llaves guardadas. Sin ella, S3 queda desactivado.
  // ¡Guárdala también fuera del servidor! Sin ella no se pueden abrir las copias de S3.
  BACKUP_ENCRYPTION_KEY: z.string().min(32, 'BACKUP_ENCRYPTION_KEY debe tener al menos 32 caracteres').optional()
    .or(z.literal('').transform(() => undefined)),
  // Respaldos programados (Plataforma → Respaldos). Independiente de la facturación.
  BACKUP_SCHEDULER: z.stringbool().default(true),
  // Ejecuta la facturación diaria dentro del proceso (desactívalo si usas cron externo)
  BILLING_SCHEDULER: z.stringbool().default(true),

  LOGIN_MAX_FAILED: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  // eslint-disable-next-line no-console
  console.error(`Configuración inválida:\n${lines.join('\n')}`);
  process.exit(1);
}

const env = parsed.data;
if (env.NODE_ENV === 'production' && env.DB_USER === 'root') {
  // eslint-disable-next-line no-console
  console.error('No uses el usuario root de MySQL en producción (DB_USER).');
  process.exit(1);
}

env.corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

module.exports = env;
