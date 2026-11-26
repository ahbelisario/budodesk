/**
 * Progreso de un alumno hacia su siguiente grado, por disciplina.
 */
async function memberProgress(tdb, userId) {
  const rows = await tdb.query(
    `SELECT v.discipline_id, d.name AS discipline, d.color AS discipline_color,
            v.current_rank_id, r.name AS current_rank, r.color, r.stripe_color, r.level, r.kind, r.max_stripes,
            v.stripes, v.since_date, v.next_exam_date, v.months_in_rank, v.classes_in_rank,
            v.next_rank_id, nr.name AS next_rank, nr.color AS next_color, nr.stripe_color AS next_stripe_color,
            nr.requires_exam AS next_requires_exam, nr.exam_fee AS next_exam_fee,
            v.next_min_months, v.next_min_classes, nr.min_age AS next_min_age,
            TIMESTAMPDIFF(YEAR, up.date_of_birth, CURDATE()) AS age, t.name AS track, t.display_style
       FROM v_member_rank_progress v
       LEFT JOIN user_profiles up ON up.user_id = v.user_id
       JOIN disciplines d ON d.dojo_id = v.dojo_id AND d.id = v.discipline_id
       JOIN ranks r       ON r.dojo_id = v.dojo_id AND r.id = v.current_rank_id
       JOIN rank_tracks t ON t.dojo_id = v.dojo_id AND t.id = v.track_id
       LEFT JOIN ranks nr ON nr.dojo_id = v.dojo_id AND nr.id = v.next_rank_id
      WHERE v.dojo_id = :dojoId AND v.user_id = :userId
      ORDER BY d.sort_order, d.name`, { userId });

  const out = [];
  for (const r of rows) {
    let requirements = [];
    if (r.next_rank_id) {
      requirements = await tdb.query(
        `SELECT q.id, q.category, q.name, q.description, q.video_url, q.mandatory,
                COALESCE(p.status, 'pending') AS status, p.evaluated_at, p.notes
           FROM rank_requirements q
           LEFT JOIN member_requirement_progress p
                  ON p.dojo_id = q.dojo_id AND p.requirement_id = q.id AND p.user_id = :userId
          WHERE q.dojo_id = :dojoId AND q.rank_id = :rank
          ORDER BY q.sort_order, q.id`, { userId, rank: r.next_rank_id });
    }
    const mandatory = requirements.filter((q) => q.mandatory);
    const approved = mandatory.filter((q) => q.status === 'approved').length;
    const pct = (have, need) => (need ? Math.min(100, Math.round((have / need) * 100)) : 100);

    const timeOk = !r.next_min_months || r.months_in_rank >= r.next_min_months;
    const classesOk = !r.next_min_classes || r.classes_in_rank >= r.next_min_classes;
    const reqOk = approved === mandatory.length;
    // Sin fecha de nacimiento no se bloquea (muchos alumnos importados no la tienen); se marca como desconocida
    const ageOk = !r.next_min_age || r.age == null || r.age >= r.next_min_age;

    out.push({
      discipline_id: r.discipline_id, discipline: r.discipline, discipline_color: r.discipline_color, track: r.track,
      display_style: r.display_style, // 'rank' → mostrar "5to Kyu"; 'belt' → mostrar la cinta de color
      current: {
        rank_id: r.current_rank_id, name: r.current_rank, color: r.color, stripe_color: r.stripe_color,
        level: r.level, kind: r.kind, stripes: r.stripes, max_stripes: r.max_stripes, since_date: r.since_date,
      },
      next: r.next_rank_id ? {
        rank_id: r.next_rank_id, name: r.next_rank, color: r.next_color, stripe_color: r.next_stripe_color,
        requires_exam: !!r.next_requires_exam, exam_fee: r.next_exam_fee,
      } : null,
      next_exam_date: r.next_exam_date,
      progress: r.next_rank_id ? {
        months: { have: r.months_in_rank, need: r.next_min_months, pct: pct(r.months_in_rank, r.next_min_months), ok: timeOk },
        classes: { have: r.classes_in_rank, need: r.next_min_classes, pct: pct(r.classes_in_rank, r.next_min_classes), ok: classesOk },
        requirements: { approved, total: mandatory.length, pct: pct(approved, mandatory.length), ok: reqOk },
        age: { have: r.age, need: r.next_min_age, ok: ageOk, unknown: !!r.next_min_age && r.age == null },
        eligible: timeOk && classesOk && reqOk && ageOk,
      } : null,
      requirements,
    });
  }
  return out;
}

/**
 * Registra un cambio de grado (promoción, tip, corrección) y actualiza el grado actual.
 * t = tenantDb en transacción.
 */
async function applyRankChange(t, { userId, disciplineId, rankId, stripes = 0, eventType = 'promotion',
  awardedDate, score, notes, certificateNumber, examCandidateId, awardedBy, nextExamDate }) {
  await t.query(
    `INSERT INTO rank_history (dojo_id, user_id, discipline_id, rank_id, stripes, event_type, awarded_date,
                               exam_candidate_id, score, certificate_number, awarded_by, notes)
     VALUES (:dojoId, :userId, :disc, :rank, :stripes, :ev, :date, :ec, :score, :cert, :by, :notes)`,
    { userId, disc: disciplineId, rank: rankId, stripes, ev: eventType, date: awardedDate, ec: examCandidateId ?? null,
      score: score ?? null, cert: certificateNumber ?? null, by: awardedBy ?? null, notes: notes ?? null });

  // Un tip no reinicia el tiempo en el grado; un grado nuevo sí
  await t.query(
    `INSERT INTO member_ranks (dojo_id, user_id, discipline_id, rank_id, stripes, since_date, next_exam_date, started_discipline_at)
     VALUES (:dojoId, :userId, :disc, :rank, :stripes, :date, :nextExam, :date)
     ON DUPLICATE KEY UPDATE
       since_date = IF(rank_id = VALUES(rank_id), since_date, VALUES(since_date)),
       rank_id = VALUES(rank_id),
       stripes = VALUES(stripes),
       next_exam_date = VALUES(next_exam_date)`,
    { userId, disc: disciplineId, rank: rankId, stripes, date: awardedDate, nextExam: nextExamDate ?? null });
}

/**
 * Recalcula las fechas del grado actual a partir del historial (tras editar, agregar o
 * borrar registros): «desde» = el primer registro del grado actual después del último
 * registro de otro grado (los tips no cuentan); «practica desde» = el registro más antiguo
 * si es anterior. Si el historial no tiene el grado actual, las fechas no se tocan.
 */
async function recomputeRankDates(t, userId, disciplineId) {
  const cur = await t.one(
    'SELECT rank_id, since_date, started_discipline_at FROM member_ranks WHERE dojo_id = :dojoId AND user_id = :u AND discipline_id = :d FOR UPDATE',
    { u: userId, d: disciplineId });
  if (!cur) return null;
  const [row] = await t.query(
    `SELECT
       (SELECT MIN(h.awarded_date) FROM rank_history h
         WHERE h.dojo_id = :dojoId AND h.user_id = :u AND h.discipline_id = :d AND h.rank_id = :r AND h.event_type <> 'stripe'
           AND h.awarded_date >= COALESCE((SELECT MAX(o.awarded_date) FROM rank_history o
                                            WHERE o.dojo_id = :dojoId AND o.user_id = :u AND o.discipline_id = :d AND o.rank_id <> :r), '1000-01-01')
       ) AS since,
       (SELECT MIN(h.awarded_date) FROM rank_history h WHERE h.dojo_id = :dojoId AND h.user_id = :u AND h.discipline_id = :d) AS earliest`,
    { u: userId, d: disciplineId, r: cur.rank_id });
  await t.query(
    `UPDATE member_ranks
        SET since_date = COALESCE(:since, since_date),
            started_discipline_at = CASE WHEN :earliest IS NOT NULL AND (started_discipline_at IS NULL OR started_discipline_at > :earliest)
                                         THEN :earliest ELSE started_discipline_at END
      WHERE dojo_id = :dojoId AND user_id = :u AND discipline_id = :d`,
    { u: userId, d: disciplineId, since: row.since, earliest: row.earliest });
  return row;
}

module.exports = { memberProgress, applyRankChange, recomputeRankDates };
