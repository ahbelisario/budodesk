/**
 * 0003 · Monitoreo de la plataforma (1.0.18)
 *
 *  - platform_alerts: alertas (respaldos, pagos, correo, tareas, disco, latido) con su
 *    historial; una alerta abierta se repite como contador, no como filas nuevas.
 *  - platform_settings: a dónde llegan las alertas (correos configurables, push al superadmin),
 *    dirección de latido externo y umbral de disco.
 */
const ALERTS = `CREATE TABLE IF NOT EXISTS \`platform_alerts\` (
  \`id\`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`kind\`        VARCHAR(30)  NOT NULL COMMENT 'backup, s3, backup_stale, webhook, mail, job, disk, heartbeat, test',
  \`alert_key\`   VARCHAR(120) NOT NULL DEFAULT '' COMMENT 'distingue alertas del mismo tipo (dojo, tarea, carpeta…)',
  \`severity\`    ENUM('warning','critical') NOT NULL DEFAULT 'warning',
  \`title\`       VARCHAR(255) NOT NULL,
  \`detail\`      TEXT NULL,
  \`url\`         VARCHAR(255) NULL COMMENT 'dónde revisarlo en la app',
  \`count\`       INT UNSIGNED NOT NULL DEFAULT 1,
  \`first_at\`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`last_at\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`notified_at\` DATETIME NULL,
  \`notify_error\` VARCHAR(500) NULL COMMENT 'si no se pudo avisar (p. ej. el SMTP no funciona)',
  \`resolved_at\` DATETIME NULL,
  \`resolved_by\` INT UNSIGNED NULL COMMENT 'NULL = se resolvió sola',
  PRIMARY KEY (\`id\`),
  KEY \`idx_alert_open\` (\`kind\`, \`alert_key\`, \`resolved_at\`),
  KEY \`idx_alert_recent\` (\`last_at\`),
  CONSTRAINT \`fk_alert_by\` FOREIGN KEY (\`resolved_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB`;

exports.up = async (db, h) => {
  await db.query(ALERTS);
  await h.addColumnIfMissing('platform_settings', 'alerts_emails',
    "VARCHAR(500) NULL COMMENT 'correos para las alertas, separados por coma (vacío = superadmins)' AFTER `trial_days`");
  await h.addColumnIfMissing('platform_settings', 'alerts_push',
    "TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'también push a los superadmins' AFTER `alerts_emails`");
  await h.addColumnIfMissing('platform_settings', 'heartbeat_url',
    "VARCHAR(500) NULL COMMENT 'URL de un servicio externo que avisa si el servidor deja de llamarla' AFTER `alerts_push`");
  await h.addColumnIfMissing('platform_settings', 'disk_alert_pct',
    "TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT 'avisar si el disco queda con menos de este % libre' AFTER `heartbeat_url`");
};
