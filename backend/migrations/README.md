# Migraciones de esquema

`db/schema/01-schema.sql` es la **línea base (versión 1.0.8)** y ya no se modifica.
Cada cambio a la base de datos es un archivo nuevo aquí, numerado en orden:

```
0001_puesta_al_dia_1_0_8.js
0002_agrega_telefono_tutor.sql
0003_…
```

## Cómo se aplican

- **Al arrancar, el backend aplica solo las pendientes,** en orden y con un candado para que nunca corran dos a la vez. Así que `./deploy.sh up` basta.
- **Antes de aplicarlas,** si la base tiene datos, guarda un respaldo de la base en la carpeta de respaldos: `antes-de-migrar-*.sql.gz`, los últimos 5.
- **La tabla `schema_migrations`** registra cuáles corrieron, con qué versión de BudoDesk y la huella (sha256) del archivo.
- **Si una falla,** no se registra y el backend no arranca, para no correr con el esquema a medias. Al corregirla y volver a desplegar se reintenta.

En una instalación nueva, MySQL carga la línea base y luego el backend aplica todas las migraciones.

## Crear una

```bash
cd backend
npm run migration -- agrega_telefono_tutor          # → migrations/0002_agrega_telefono_tutor.sql
npm run migration -- agrega_telefono_tutor --js     # → .js, si necesitas revisar antes de cambiar
```

- **`.sql`:** una o varias sentencias.
- **`.js`:** exporta `async up(db, h)`. `h` trae ayudas para revisar antes de cambiar:
  - `h.tableExists(tabla)`
  - `h.columnExists(tabla, columna)`
  - `h.indexExists(tabla, índice)`
  - `h.addColumnIfMissing(tabla, columna, 'VARCHAR(50) NULL AFTER otra')`
  - `h.query(sql, params)`

## Reglas

1. **Una idea por migración.** MySQL no puede deshacer un `ALTER TABLE`: si una migración con cinco cambios falla en el tercero, los dos primeros ya quedaron.
2. **Nunca edites una migración que ya se subió.** Crea otra. Si cambia una ya aplicada, el backend lo avisa, pero no la vuelve a correr.
3. **Toda tabla de negocio lleva `dojo_id`,** con llaves compuestas `(dojo_id, id)`, como en la línea base.
4. **Pruébala en local primero:** reinicia el backend (`npm run dev`) y revisa con `npm run migrate:status`.
5. **Para cambios de datos grandes,** hazlos por lotes para no bloquear la base mucho tiempo.

## Consultar y regresar

```bash
./deploy.sh migrations                         # aplicadas, pendientes y respaldos previos
./deploy.sh restore antes-de-migrar-….sql.gz   # regresar la base a antes de una migración
```

Para volver a una versión anterior del todo:
1. Despliega ese código: `git checkout v1.0.8 && ./deploy.sh up`.
2. Restaura el respaldo de antes de la migración.

Al terminar, vuelve a `main` con `git checkout main`.
