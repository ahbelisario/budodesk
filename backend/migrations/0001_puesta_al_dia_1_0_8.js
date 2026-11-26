/**
 * 0001 · Puesta al día con la versión 1.0.8 (línea base).
 *
 * db/schema/01-schema.sql ya trae todo esto: en una instalación nueva no hace nada.
 * En una base que se instaló antes, agrega lo que le falte, sin importar cuáles de los
 * SQL sueltos de esos días (tablas_finanzas.sql, notificaciones_push.sql) se corrieron:
 *  - tablas de la plataforma (respaldos) y las dos opciones de cobro del dojo
 *    (antes las creaba el backend al arrancar: ensurePlatformTables)
 *  - gastos y otros ingresos (finance_*)
 *  - web push (push_tokens.subscription y llaves VAPID en platform_settings)
 * Todo es "crear si falta": nunca modifica ni borra datos.
 */
const PLATFORM = [
  `CREATE TABLE IF NOT EXISTS \`platform_settings\` (
    \`id\`                  TINYINT UNSIGNED NOT NULL DEFAULT 1,
    \`timezone\`            VARCHAR(50) NOT NULL DEFAULT 'America/Mexico_City',
    \`backup_enabled\`      TINYINT(1) NOT NULL DEFAULT 0,
    \`backup_frequency\`    ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
    \`backup_hour\`         TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT 'hora local 0-23',
    \`backup_weekday\`      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = domingo (semanal)',
    \`backup_keep\`         TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT 'respaldos en el servidor (1-10)',
    \`s3_enabled\`          TINYINT(1) NOT NULL DEFAULT 0,
    \`s3_endpoint\`         VARCHAR(255) NULL COMMENT 'vacío = AWS',
    \`s3_region\`           VARCHAR(50)  NULL,
    \`s3_bucket\`           VARCHAR(255) NULL,
    \`s3_prefix\`           VARCHAR(255) NULL,
    \`s3_access_key\`       VARCHAR(255) NULL,
    \`s3_secret_enc\`       TEXT NULL COMMENT 'cifrado con BACKUP_ENCRYPTION_KEY',
    \`s3_force_path_style\` TINYINT(1) NOT NULL DEFAULT 0,
    \`s3_keep\`             SMALLINT UNSIGNED NOT NULL DEFAULT 10 COMMENT 'copias en S3 (1-100)',
    \`updated_by\`          INT UNSIGNED NULL,
    \`updated_at\`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`backups\` (
    \`id\`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`filename\`       VARCHAR(120) NOT NULL,
    \`trigger\`        ENUM('auto','manual') NOT NULL,
    \`status\`         ENUM('running','ok','failed') NOT NULL DEFAULT 'running',
    \`size_bytes\`     BIGINT UNSIGNED NULL,
    \`sha256\`         CHAR(64) NULL,
    \`tables_count\`   SMALLINT UNSIGNED NULL,
    \`rows_count\`     INT UNSIGNED NULL,
    \`files_count\`    INT UNSIGNED NULL,
    \`error\`          VARCHAR(1000) NULL,
    \`started_at\`     DATETIME NOT NULL,
    \`finished_at\`    DATETIME NULL,
    \`local_deleted_at\` DATETIME NULL COMMENT 'borrado del servidor por la rotación',
    \`s3_status\`      ENUM('none','uploading','ok','failed','deleted') NOT NULL DEFAULT 'none',
    \`s3_key\`         VARCHAR(500) NULL,
    \`s3_error\`       VARCHAR(1000) NULL,
    \`s3_uploaded_at\` DATETIME NULL,
    \`created_by\`     INT UNSIGNED NULL,
    PRIMARY KEY (\`id\`),
    KEY \`idx_backups_started\` (\`started_at\`),
    CONSTRAINT \`fk_backups_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
  ) ENGINE=InnoDB`,
  'INSERT IGNORE INTO platform_settings (id) VALUES (1)',
];

const FINANCE = [
  `CREATE TABLE IF NOT EXISTS \`finance_categories\` (
  \`id\`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`dojo_id\`     INT UNSIGNED NOT NULL,
  \`kind\`        ENUM('expense','income') NOT NULL,
  \`name\`        VARCHAR(80) NOT NULL,
  \`active\`      TINYINT(1) NOT NULL DEFAULT 1,
  \`sort_order\`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  \`created_at\`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_fc_dojo_id\` (\`dojo_id\`,\`id\`),
  UNIQUE KEY \`uq_fc_name\` (\`dojo_id\`,\`kind\`,\`name\`),
  CONSTRAINT \`fk_fc_dojo\` FOREIGN KEY (\`dojo_id\`) REFERENCES \`dojos\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`finance_recurring\` (
  \`id\`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`dojo_id\`       INT UNSIGNED NOT NULL,
  \`kind\`          ENUM('expense','income') NOT NULL,
  \`category_id\`   INT UNSIGNED NOT NULL,
  \`description\`   VARCHAR(255) NULL,
  \`amount\`        DECIMAL(10,2) NOT NULL,
  \`currency\`      CHAR(3) NOT NULL,
  \`day_of_month\`  TINYINT UNSIGNED NOT NULL DEFAULT 1,
  \`starts_on\`     DATE NOT NULL COMMENT 'primer mes (día 1)',
  \`ends_on\`       DATE NULL COMMENT 'último mes (día 1); NULL = sin fin',
  \`active\`        TINYINT(1) NOT NULL DEFAULT 1,
  \`last_period\`   DATE NULL COMMENT 'último mes ya generado (día 1)',
  \`created_by\`    INT UNSIGNED NULL,
  \`created_at\`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_fr_dojo_id\` (\`dojo_id\`,\`id\`),
  CONSTRAINT \`fk_fr_cat\` FOREIGN KEY (\`dojo_id\`,\`category_id\`) REFERENCES \`finance_categories\` (\`dojo_id\`,\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`fk_fr_by\`  FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`chk_fr_amount\` CHECK (\`amount\` > 0),
  CONSTRAINT \`chk_fr_day\` CHECK (\`day_of_month\` BETWEEN 1 AND 28)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`finance_entries\` (
  \`id\`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`dojo_id\`          INT UNSIGNED NOT NULL,
  \`kind\`             ENUM('expense','income') NOT NULL,
  \`category_id\`      INT UNSIGNED NOT NULL,
  \`description\`      VARCHAR(255) NULL,
  \`amount\`           DECIMAL(10,2) NOT NULL,
  \`currency\`         CHAR(3) NOT NULL,
  \`entry_date\`       DATE NOT NULL,
  \`method\`           ENUM('cash','transfer','card','other') NULL,
  \`reference\`        VARCHAR(100) NULL,
  \`notes\`            VARCHAR(500) NULL,
  \`recurring_id\`     INT UNSIGNED NULL,
  \`recurring_period\` DATE NULL,
  \`created_by\`       INT UNSIGNED NULL,
  \`created_at\`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_fe_dojo_id\` (\`dojo_id\`,\`id\`),
  UNIQUE KEY \`uq_fe_recurring\` (\`recurring_id\`,\`recurring_period\`),
  KEY \`idx_fe_date\` (\`dojo_id\`,\`entry_date\`),
  KEY \`idx_fe_cat\` (\`dojo_id\`,\`category_id\`),
  CONSTRAINT \`fk_fe_cat\` FOREIGN KEY (\`dojo_id\`,\`category_id\`) REFERENCES \`finance_categories\` (\`dojo_id\`,\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`fk_fe_rec\` FOREIGN KEY (\`recurring_id\`) REFERENCES \`finance_recurring\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`fk_fe_by\`  FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`chk_fe_amount\` CHECK (\`amount\` > 0)
) ENGINE=InnoDB`,
];

exports.up = async (db, h) => {
  for (const sql of [...PLATFORM, ...FINANCE]) await db.query(sql);

  await h.addColumnIfMissing('dojo_payment_settings', 'auto_charges',
    "TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'generar automáticamente el cargo de cada periodo de las membresías'");
  await h.addColumnIfMissing('dojo_payment_settings', 'payment_reminders',
    "TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'avisos de pago por vencer / vencido'");

  await h.addColumnIfMissing('push_tokens', 'subscription',
    "JSON NULL COMMENT 'web push: { endpoint, keys: { p256dh, auth } }' AFTER `platform`");
  await h.addColumnIfMissing('platform_settings', 'vapid_public_key',
    "VARCHAR(120) NULL COMMENT 'web push: se generan solas la primera vez' AFTER `s3_keep`");
  await h.addColumnIfMissing('platform_settings', 'vapid_private_key', 'VARCHAR(120) NULL AFTER `vapid_public_key`');
};
