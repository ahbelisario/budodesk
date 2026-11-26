# Cambios de BudoDesk

Formato: `MAYOR.MENOR.PARCHE`.
- **PARCHE** (1.0.8 → 1.0.9): correcciones y mejoras pequeñas.
- **MENOR** (1.0.9 → 1.1.0): funciones nuevas.
- **MAYOR** (1.x → 2.0.0): cambios grandes o que rompen compatibilidad.

Cada versión se crea con `./release.sh` y queda marcada en git como `vX.Y.Z`.

## [1.0.12] - 2026-11-26

- Registro de dojos con prueba gratis y solo lectura al vencer

## [1.0.11] - 2026-11-26

- Renombra referencias del repo: fsms → budodesk

## [1.0.10] - 2026-11-26

- deploy.sh: aceptar el comando migrations y mostrar la ayuda completa

## [1.0.9] - 2026-11-26

- Migraciones de esquema versionadas

## [1.0.8] - 2026-11-26

Primera versión numerada. Reúne todo lo de BudoDesk v2 hasta hoy:

- **Varios dojos** en un solo despliegue, cada uno con su subdominio, logo y colores.
- **Miembros:** ficha del alumno, tutores y menores, «Mis hijos», perfil completo.
- **Clases:** horario, series, reservas, pase de lista, código de llegada, filtros por edad y disciplina.
- **Membresías y cobranza:** planes, cargos automáticos por dojo, recordatorios de pago, saldo a favor.
- **Grados y exámenes.**
- **Avisos y notificaciones:** bandeja en la app, correo y ajustes del dojo.
- **Pagos en línea** con Mercado Pago y PayPal:
  - Credenciales de prueba y reales por separado.
  - Avisos (webhooks) firmados e IPN.
  - Comisión opcional al alumno.
  - «Marcar reembolsado».
- **Reportes:**
  - Finanzas por mes, por cobrar con antigüedad, alumnos, asistencia y grados.
  - Gastos y otros ingresos con fijos mensuales.
  - Exportar a CSV.
- **App instalable** (Android, iPhone y computadora) con **notificaciones push** en el navegador.
- **Panel de plataforma** (superadmin):
  - Administración de dojos.
  - Respaldos automáticos con rotación y copia opcional a S3.
- **Despliegue** con `deploy.sh` (Docker o Podman) y restauración de respaldos por consola.
