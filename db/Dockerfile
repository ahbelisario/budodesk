# MySQL 8.4 LTS (versión fija: "latest" puede saltar de versión mayor sin avisar)
FROM mysql:8.4

# Solo se ejecutan cuando el volumen de datos está vacío (primer arranque).
# Las credenciales llegan por variables de entorno desde compose (.env), nunca aquí.
COPY schema/01-schema.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY schema/02-seed.sql   /docker-entrypoint-initdb.d/02-seed.sql
