# Cambios de BudoDesk

Formato: `MAYOR.MENOR.PARCHE`.
- **PARCHE** (1.0.8 → 1.0.9): correcciones y mejoras pequeñas.
- **MENOR** (1.0.9 → 1.1.0): funciones nuevas.
- **MAYOR** (1.x → 2.0.0): cambios grandes o que rompen compatibilidad.

Cada versión se crea con `./release.sh` y queda marcada en git como `vX.Y.Z`.

## [1.0.27] - 2026-11-28

- Inicio del alumno en celular: quitar el logo duplicado

## [1.0.26] - 2026-11-28

- Política de contraseñas, requisitos en vivo, reactivar cargos y logo en celular
- «Ver como» para soporte: ver la app como otro usuario, en solo lectura

## [1.0.25] - 2026-11-27

- Membresías: reanudar una pausa antes de tiempo y quitar pausas futuras

## [1.0.24] - 2026-11-27

- Plantillas de grados editables en la plataforma y 9 plantillas nuevas

## [1.0.23] - 2026-11-26

- Historial de grados editable: grado inicial y los siguientes

## [1.0.22] - 2026-11-26

- Plantilla de grados: Aikido Tendoryu (Seikoukan)

## [1.0.21] - 2026-11-26

- Plantillas de grados precargadas y edad mínima en la elegibilidad

## [1.0.20] - 2026-11-26

- Grados: corregir el historial (fechas, certificados, grados anteriores)

## [1.0.19] - 2026-11-26

- Planes editables en Plataforma, excepciones por dojo y uso en las tarjetas

## [1.0.18] - 2026-11-26

- Límites por plan: Básico (50 alumnos, 1 sede, sin finanzas) y Pro

## [1.0.17] - 2026-11-26

- Monitoreo de la plataforma con alertas a correos configurables
- Clases: vista de lista para el personal

## [1.0.16] - 2026-11-26

- Plataforma: eliminar un dojo y el superadmin ve todos los dojos al cambiar

## [1.0.15] - 2026-11-26

- Bitácora del dojo: lo que hace la plataforma solo lo ve el superadmin
- Registro de dojos: el botón dice qué falta en lugar de quedar deshabilitado

## [1.0.14] - 2026-11-26

- Subdominio sin dojo: redirige al registro en budodesk.com
- deploy.sh: recuperar el permiso de ejecución

## [1.0.13] - 2026-11-26

- budodesk.com sin dojo: el dojo por omisión solo aplica en local

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
