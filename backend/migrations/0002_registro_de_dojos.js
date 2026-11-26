/**
 * 0002 · Registro de dojos con prueba gratis (1.0.12)
 *
 *  - dojo_signups: solicitudes del formulario público; el dojo se crea hasta que el
 *    superadmin la aprueba.
 *  - dojos.status gana 'expired': la prueba terminó y el dojo queda en solo lectura.
 *  - dojos.trial_notices: avisos de fin de prueba ya enviados (d7, d1, expired).
 *  - platform_settings: aceptar registros sí/no y días de prueba.
 */
const SIGNUPS = `CREATE TABLE IF NOT EXISTS \`dojo_signups\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`status\`            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  \`dojo_name\`         VARCHAR(255) NOT NULL,
  \`slug\`              VARCHAR(60)  NOT NULL COMMENT 'subdominio pedido',
  \`first_name\`        VARCHAR(100) NOT NULL,
  \`last_name\`         VARCHAR(100) NULL,
  \`email\`             VARCHAR(150) NOT NULL,
  \`phone\`             VARCHAR(50)  NULL,
  \`city\`              VARCHAR(100) NULL,
  \`country_code\`      CHAR(2)      NOT NULL DEFAULT 'MX',
  \`timezone\`          VARCHAR(50)  NOT NULL DEFAULT 'America/Mexico_City',
  \`currency\`          CHAR(3)      NOT NULL DEFAULT 'MXN',
  \`language\`          VARCHAR(5)   NOT NULL DEFAULT 'es',
  \`disciplines\`       VARCHAR(255) NULL COMMENT 'texto libre: qué artes enseña',
  \`students_estimate\` SMALLINT UNSIGNED NULL,
  \`message\`           TEXT NULL,
  \`ip_address\`        VARCHAR(45)  NULL,
  \`user_agent\`        VARCHAR(255) NULL,
  \`dojo_id\`           INT UNSIGNED NULL COMMENT 'dojo creado al aprobar',
  \`reviewed_by\`       INT UNSIGNED NULL,
  \`reviewed_at\`       DATETIME NULL,
  \`review_note\`       VARCHAR(500) NULL,
  \`created_at\`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_signup_status\` (\`status\`,\`created_at\`),
  KEY \`idx_signup_email\` (\`email\`),
  KEY \`idx_signup_slug\` (\`slug\`),
  CONSTRAINT \`fk_signup_dojo\` FOREIGN KEY (\`dojo_id\`) REFERENCES \`dojos\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`fk_signup_by\` FOREIGN KEY (\`reviewed_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB`;

exports.up = async (db, h) => {
  await db.query(SIGNUPS);

  const [[col]] = await db.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dojos' AND COLUMN_NAME = 'status'`);
  if (!String(col.t).includes("'expired'")) {
    await db.query(`ALTER TABLE \`dojos\` MODIFY \`status\`
      ENUM('trial','active','expired','suspended','cancelled') NOT NULL DEFAULT 'trial'
      COMMENT 'expired = terminó la prueba: solo lectura'`);
  }
  await h.addColumnIfMissing('dojos', 'trial_notices',
    "VARCHAR(30) NOT NULL DEFAULT '' COMMENT 'avisos de fin de prueba enviados: d7,d1,expired' AFTER `trial_ends_at`");

  await h.addColumnIfMissing('platform_settings', 'signup_enabled',
    "TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'formulario público de registro de dojos' AFTER `vapid_private_key`");
  await h.addColumnIfMissing('platform_settings', 'trial_days',
    "SMALLINT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'días de prueba al aprobar un dojo' AFTER `signup_enabled`");
};
