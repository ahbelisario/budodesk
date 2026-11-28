/**
 * 0007 · Quién impartió la clase
 *
 * class_sessions.taught_by: quién dio realmente la clase cuando no fue el instructor asignado
 * (suplente). NULL = la dio el instructor asignado (instructor_id). Las clases impartidas no
 * cuentan para el avance de grado del instructor: solo su asistencia como alumno.
 */
exports.up = async (db, h) => {
  await h.addColumnIfMissing('class_sessions', 'taught_by',
    "INT UNSIGNED NULL COMMENT 'quién dio la clase si no fue el asignado (suplente)' AFTER `instructor_id`");
  const [idx] = await db.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'class_sessions' AND index_name = 'idx_sess_taught'");
  if (!idx.length) await db.query('ALTER TABLE `class_sessions` ADD KEY `idx_sess_taught` (`dojo_id`,`taught_by`,`session_date`)');
  const [fk] = await db.query(
    "SELECT 1 FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'class_sessions' AND constraint_name = 'fk_sess_taught'");
  if (!fk.length) {
    await db.query('ALTER TABLE `class_sessions` ADD CONSTRAINT `fk_sess_taught` FOREIGN KEY (`dojo_id`,`taught_by`) REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE RESTRICT');
  }
};
