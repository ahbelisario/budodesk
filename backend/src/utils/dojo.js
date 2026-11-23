/** Datos del dojo activo, cacheados por request. */
async function getDojo(req) {
  if (!req._dojo) {
    req._dojo = await req.tdb.one(
      `SELECT id, slug, name, currency, timezone, language, booking_cancel_hours, booking_window_days,
              require_membership_to_book, self_registration
         FROM dojos WHERE id = :dojoId`);
  }
  return req._dojo;
}

module.exports = { getDojo };
