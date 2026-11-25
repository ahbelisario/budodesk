/**
 * Ajustes de esquema que se aplican al arrancar, para que una base ya en uso no
 * falle al actualizar (todo está también en db/schema/01-schema.sql):
 *  - tablas de la plataforma (respaldos): CREATE TABLE IF NOT EXISTS
 *  - columnas nuevas: se agregan solo si faltan
 * Nunca modifica ni borra datos.
 */
const { pool } = require('./pool');

const DDL = [
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

/** [tabla, columna, definición] */
const COLUMNS = [
  ['dojo_payment_settings', 'auto_charges', "TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'generar automáticamente el cargo de cada periodo de las membresías'"],
  ['dojo_payment_settings', 'payment_reminders', "TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'avisos de pago por vencer / vencido'"],
];

async function ensurePlatformTables(executor = pool) {
  for (const sql of DDL) await executor.query(sql);
  for (const [table, column, def] of COLUMNS) {
    const [rows] = await executor.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]);
    if (!rows.length) await executor.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
  }
}

module.exports = { ensurePlatformTables, DDL };
