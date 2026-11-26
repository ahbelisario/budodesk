# BudoDesk API v2

Base: `/api/v2`. Todas las respuestas: `{ status: 'success', data, meta? }` o
`{ status: 'error', code, message, details? }`.

## Convenciones

- **Autenticación:** `Authorization: Bearer <access_token>` (15 min). Renovar con
  `POST /auth/refresh { refresh_token }` → devuelve tokens nuevos; el refresh
  anterior deja de servir. **El cliente debe renovar una sola vez a la vez**
  (si dos peticiones renuevan con el mismo token, se detecta reuso y se cierra la sesión).
- **Dojo activo:** viene en el token. Login con un dojo entra directo; con varios,
  `data.dojo = null` y se elige con `POST /auth/switch-dojo { dojo_id }`.
  Sin dojo, las rutas de negocio responden `409 DOJO_NOT_SELECTED`.
- **Roles por dojo:** `owner` (implica `admin`), `admin`, `staff`, `instructor`, `student`, `guardian`.
  `staff*` en la tabla = admin, staff e instructor.
- **Actuar por otra persona:** las rutas `.../mine` aceptan `?user_id=` para que un
  tutor vea/reserve/pague por su menor (o el staff por cualquiera).
- **Paginación:** `?page=1&page_size=25` (máx. 100) → `meta: { page, page_size, total, total_pages }`.
- **Fechas:** `YYYY-MM-DD` en la zona horaria del dojo; horas `HH:MM`.
- **Errores comunes:** `400 BAD_REQUEST` (con `details[]` por campo), `401 TOKEN_EXPIRED`
  (renovar), `401 SESSION_REVOKED` (volver a login), `403 FORBIDDEN`, `404 NOT_FOUND`,
  `409 DUPLICATE`, `422` reglas de negocio (`NO_MEMBERSHIP`, `WEEKLY_LIMIT`, `CLASS_FULL`, `TOO_EARLY`…).

## Rutas

### /api/v2/auth

| Método | Ruta | Roles |
|---|---|---|
| POST | `/api/v2/auth/login` |  |
| POST | `/api/v2/auth/refresh` |  |
| POST | `/api/v2/auth/switch-dojo` |  |
| POST | `/api/v2/auth/logout` |  |
| POST | `/api/v2/auth/logout-all` |  |
| GET | `/api/v2/auth/me` |  |

### /api/v2/account

| Método | Ruta | Roles |
|---|---|---|
| POST | `/api/v2/account/register` |  |
| POST | `/api/v2/account/verify-email` |  |
| POST | `/api/v2/account/resend-verification` |  |
| POST | `/api/v2/account/password/forgot` |  |
| POST | `/api/v2/account/password/reset` |  |
| GET | `/api/v2/account/dojos/:slug` |  |
| GET | `/api/v2/account/dojos/:slug/privacy` |  |

### /api/v2/me

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/me/profile` |  |
| PATCH | `/api/v2/me/profile` |  |
| PATCH | `/api/v2/me/settings` |  |
| POST | `/api/v2/me/password` |  |
| POST | `/api/v2/me/join-dojo` |  |
| GET | `/api/v2/me/sessions` |  |
| GET | `/api/v2/me/minors` |  |

### /api/v2/dojo

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/dojo` |  |
| PATCH | `/api/v2/dojo` | admin |
| GET | `/api/v2/dojo/payment-settings` | admin |
| PATCH | `/api/v2/dojo/payment-settings` | admin |
| GET | `/api/v2/dojo/payment-methods` |  |
| GET | `/api/v2/dojo/locations` |  |
| POST | `/api/v2/dojo/locations` | admin |
| PATCH | `/api/v2/dojo/locations/:id` | admin |
| GET | `/api/v2/dojo/audit-log` | admin |

### /api/v2/uploads

| Método | Ruta | Roles |
|---|---|---|
| POST | `/api/v2/uploads/logo` | admin |
| POST | `/api/v2/uploads/avatar` |  |

### /api/v2/members

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/members` | admin, staff, instructor |
| GET | `/api/v2/members/:userId` |  |
| POST | `/api/v2/members` | admin, staff |
| PATCH | `/api/v2/members/:userId` | admin, staff |
| PUT | `/api/v2/members/:userId/roles` | admin |
| POST | `/api/v2/members/:userId/send-access` | admin, staff |
| DELETE | `/api/v2/members/:userId` | admin |
| POST | `/api/v2/members/:userId/guardians` | admin, staff |
| DELETE | `/api/v2/members/:userId/guardians/:guardianId` | admin, staff |

### /api/v2/disciplines

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/disciplines` |  |
| GET | `/api/v2/disciplines/:id` |  |
| POST | `/api/v2/disciplines` | admin |
| PATCH | `/api/v2/disciplines/:id` | admin |
| DELETE | `/api/v2/disciplines/:id` | admin |

### /api/v2/ranks

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/ranks/structure` |  |
| POST | `/api/v2/ranks/tracks` | admin |
| PATCH | `/api/v2/ranks/tracks/:id` | admin |
| GET | `/api/v2/ranks` |  |
| GET | `/api/v2/ranks/:id` |  |
| POST | `/api/v2/ranks` | admin |
| PATCH | `/api/v2/ranks/:id` | admin |
| POST | `/api/v2/ranks/reorder` | admin |
| DELETE | `/api/v2/ranks/:id` | admin |
| POST | `/api/v2/ranks/:id/requirements` | admin, instructor |
| PATCH | `/api/v2/ranks/requirements/:reqId` | admin, instructor |
| DELETE | `/api/v2/ranks/requirements/:reqId` | admin, instructor |

### /api/v2/progress

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/progress/members/:userId` |  |
| GET | `/api/v2/progress/mine` |  |
| POST | `/api/v2/progress/promotions` | admin, instructor |
| PUT | `/api/v2/progress/members/:userId/requirements/:requirementId` | admin, instructor |
| PATCH | `/api/v2/progress/members/:userId/disciplines/:disciplineId` | admin, instructor |
| GET | `/api/v2/progress/eligible` | staff* |

### /api/v2/exams

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/exams` | staff*, staff |
| GET | `/api/v2/exams/mine` |  |
| GET | `/api/v2/exams/:id` | staff*, staff |
| POST | `/api/v2/exams` | staff* |
| PATCH | `/api/v2/exams/:id` | staff* |
| POST | `/api/v2/exams/:id/candidates` | staff* |
| PUT | `/api/v2/exams/:id/candidates/:candidateId` | staff* |
| DELETE | `/api/v2/exams/:id/candidates/:candidateId` | staff* |

### /api/v2/plans

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/plans` |  |
| GET | `/api/v2/plans/:id` |  |
| POST | `/api/v2/plans` | admin |
| PATCH | `/api/v2/plans/:id` | admin |
| DELETE | `/api/v2/plans/:id` | admin |

### /api/v2/discounts

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/discounts` |  |
| POST | `/api/v2/discounts` | admin |
| PATCH | `/api/v2/discounts/:id` | admin |

### /api/v2/memberships

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/memberships` | staff* |
| GET | `/api/v2/memberships/mine` |  |
| GET | `/api/v2/memberships/:id` |  |
| POST | `/api/v2/memberships` | staff* |
| PATCH | `/api/v2/memberships/:id` | staff* |
| PUT | `/api/v2/memberships/:id/members` | staff* |
| POST | `/api/v2/memberships/:id/pauses` | staff* |
| POST | `/api/v2/memberships/:id/cancel` | staff* |
| POST | `/api/v2/memberships/:id/resume` | staff* |
| POST | `/api/v2/memberships/billing/run` | admin |

### /api/v2/charges

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/charges` | staff* |
| GET | `/api/v2/charges/mine` |  |
| GET | `/api/v2/charges/:id` |  |
| POST | `/api/v2/charges` | staff* |
| POST | `/api/v2/charges/:id/void` | admin |

### /api/v2/payments

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/payments` | staff* |
| GET | `/api/v2/payments/mine` |  |
| GET | `/api/v2/payments/:id` |  |
| POST | `/api/v2/payments` | staff* |
| POST | `/api/v2/payments/:id/cancel` | admin |
| POST | `/api/v2/payments/:id/allocate` | staff* |

### /api/v2/classes

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/classes/series` |  |
| POST | `/api/v2/classes/series` | admin, staff |
| PATCH | `/api/v2/classes/series/:id` | admin, staff |
| DELETE | `/api/v2/classes/series/:id` | admin, staff |
| GET | `/api/v2/classes/sessions` |  |
| GET | `/api/v2/classes/sessions/:id` |  |
| POST | `/api/v2/classes/sessions` | admin, staff |
| PATCH | `/api/v2/classes/sessions/:id` | staff* |
| POST | `/api/v2/classes/sessions/:id/cancel` | admin, staff |
| POST | `/api/v2/classes/sessions/:id/restore` | admin, staff |
| POST | `/api/v2/classes/sessions/:id/book` |  |
| DELETE | `/api/v2/classes/sessions/:id/book` |  |
| GET | `/api/v2/classes/bookings/mine` |  |
| PUT | `/api/v2/classes/sessions/:id/attendance` | staff* |
| POST | `/api/v2/classes/sessions/:id/checkin-code` | staff* |
| POST | `/api/v2/classes/sessions/:id/checkin` |  |
| GET | `/api/v2/classes/attendance/stats` |  |

### /api/v2/dashboard

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/dashboard/summary` |  |
| GET | `/api/v2/dashboard/revenue` | admin, staff |
| GET | `/api/v2/dashboard/attendance` |  |
| GET | `/api/v2/dashboard/todo` |  |

### /api/v2/notifications

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/notifications` |  |
| POST | `/api/v2/notifications/read` |  |
| POST | `/api/v2/notifications/push-tokens` |  |
| DELETE | `/api/v2/notifications/push-tokens` |  |

### /api/v2/announcements

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/announcements` |  |
| POST | `/api/v2/announcements` | staff* |
| DELETE | `/api/v2/announcements/:id` | admin, staff |

### /api/v2/signup (público, sin sesión)

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/signup/config` |  |
| GET | `/api/v2/signup/slug?slug=` |  |
| POST | `/api/v2/signup` |  |

### /api/v2/platform/signups (superadmin)

| Método | Ruta | Roles |
|---|---|---|
| GET | `/api/v2/platform/signups?status=pending\|approved\|rejected\|all` | superadmin |
| PUT | `/api/v2/platform/signups/settings` | superadmin |
| POST | `/api/v2/platform/signups/:id/approve` | superadmin |
| POST | `/api/v2/platform/signups/:id/reject` | superadmin |

**Dojo con la prueba vencida** (`dojos.status = 'expired'`): se puede entrar y consultar,
pero cualquier POST/PUT/PATCH/DELETE responde `403 DOJO_READ_ONLY`, salvo `/auth`,
`/me`, `/notifications`, `/account` y `/platform`. El superadmin no tiene esa restricción.
