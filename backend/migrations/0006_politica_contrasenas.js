/**
 * 0006 · Política de contraseñas (Plataforma → Seguridad)
 *
 * Aplica a toda la plataforma (una persona puede estar en varios dojos con la misma contraseña).
 * Solo se revisa al crear o cambiar una contraseña; las actuales siguen sirviendo.
 */
exports.up = async (db, h) => {
  await h.addColumnIfMissing('platform_settings', 'pw_min_length',
    "TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT 'largo mínimo de contraseña' AFTER `disk_alert_pct`");
  await h.addColumnIfMissing('platform_settings', 'pw_require_upper',
    "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'exigir una mayúscula' AFTER `pw_min_length`");
  await h.addColumnIfMissing('platform_settings', 'pw_require_lower',
    "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'exigir una minúscula' AFTER `pw_require_upper`");
  await h.addColumnIfMissing('platform_settings', 'pw_require_number',
    "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'exigir un número' AFTER `pw_require_lower`");
  await h.addColumnIfMissing('platform_settings', 'pw_require_symbol',
    "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'exigir un símbolo' AFTER `pw_require_number`");
};
