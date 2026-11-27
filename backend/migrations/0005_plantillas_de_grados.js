/**
 * 0005 · Plantillas de grados editables en Plataforma → Plantillas
 *
 *  - rank_templates: plantillas de toda la plataforma (sin dojo_id). Las precargadas
 *    (builtin = 1) se agregan al arrancar desde src/modules/ranks/templates.js si faltan;
 *    una vez en la tabla, lo que edite el superadmin no se pisa.
 *  - tracks: JSON con los programas y sus grados (misma forma que templates.js).
 */
exports.up = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS \`rank_templates\` (
    \`tkey\`        VARCHAR(60)  NOT NULL COMMENT 'identificador estable (p. ej. kendo-fik)',
    \`name\`        VARCHAR(150) NOT NULL COMMENT 'nombre de la disciplina que se crea',
    \`style\`       VARCHAR(150) NULL,
    \`org\`         VARCHAR(200) NULL COMMENT 'organismo o federación',
    \`source\`      VARCHAR(500) NULL COMMENT 'de dónde salen los tiempos y edades',
    \`notes\`       JSON         NOT NULL COMMENT 'lista de textos; ⚠️ = no verificado',
    \`tracks\`      JSON         NOT NULL COMMENT 'programas con sus grados',
    \`builtin\`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = precargada (no se borra, se puede restaurar)',
    \`active\`      TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = los dojos no la ven',
    \`sort_order\`  INT          NOT NULL DEFAULT 0,
    \`created_at\`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    \`updated_by\`  INT UNSIGNED NULL,
    PRIMARY KEY (\`tkey\`),
    CONSTRAINT \`fk_rank_tpl_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
};
