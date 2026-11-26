/**
 * 0004 · Planes de BudoDesk editables y excepciones por dojo (1.0.19)
 *
 *  - saas_plans: límites de cada plan (Básico, Pro), editables en Plataforma → Planes.
 *    max_* NULL = sin límite. Arranca con los valores que estaban en el código.
 *  - dojos.limit_*: excepción de un dojo (NULL = lo de su plan).
 */
const PLANS = `CREATE TABLE IF NOT EXISTS \`saas_plans\` (
  \`code\`          VARCHAR(20)  NOT NULL COMMENT 'basic, pro (= dojos.plan)',
  \`name\`          VARCHAR(60)  NOT NULL COMMENT 'nombre que ve el dojo',
  \`max_students\`  INT UNSIGNED NULL COMMENT 'alumnos activos; NULL = sin límite',
  \`max_locations\` INT UNSIGNED NULL COMMENT 'sedes activas; NULL = sin límite',
  \`finance\`       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'gastos e ingresos, por cobrar',
  \`updated_at\`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`updated_by\`    INT UNSIGNED NULL,
  PRIMARY KEY (\`code\`),
  CONSTRAINT \`fk_saas_plan_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB`;

exports.up = async (db, h) => {
  await db.query(PLANS);
  await db.query(`INSERT IGNORE INTO saas_plans (code, name, max_students, max_locations, finance) VALUES
    ('basic', 'Básico', 50, 1, 0),
    ('pro',   'Pro',    NULL, NULL, 1)`);
  await h.addColumnIfMissing('dojos', 'limit_students',
    "INT UNSIGNED NULL COMMENT 'excepción: alumnos activos (NULL = lo del plan)' AFTER `trial_notices`");
  await h.addColumnIfMissing('dojos', 'limit_locations',
    "INT UNSIGNED NULL COMMENT 'excepción: sedes activas (NULL = lo del plan)' AFTER `limit_students`");
  await h.addColumnIfMissing('dojos', 'limit_finance',
    "TINYINT(1) NULL COMMENT 'excepción: finanzas sí/no (NULL = lo del plan)' AFTER `limit_locations`");
};
