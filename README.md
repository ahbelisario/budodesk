# BudoDesk

Plataforma para escuelas de artes marciales: miembros, grados y exámenes,
clases y asistencia, membresías, cobranza y avisos. Un solo despliegue atiende
a varios dojos (cada dojo entra por su subdominio: `seikoukan.budodesk.com`).

```
backend/    API REST v2 (Node 20 + Express 5 + MySQL 8.4) — ver backend/API.md
frontend/   App (Expo / React Native: web, iOS y Android, TypeScript)
db/         Esquema y datos iniciales (se cargan al crear la base vacía)
nginx/      Puerta de entrada: /api → backend, / → app web
images/     Recursos de marca (logos)
```

## Desarrollo local

Requisitos: Docker Desktop y Node 20.

```bash
# 1. Base de datos + API
docker compose -f compose-dev.yaml up -d --build
docker compose -f compose-dev.yaml exec backend npm run create-admin -- --email tu@correo.mx --name Tu --dojo seikoukan
# (opcional) datos de ejemplo: alumnos, tutor con hijos, clases, pagos, examen
docker compose -f compose-dev.yaml exec backend node scripts/demo-data.js --dojo seikoukan --admin tu@correo.mx

# 2. App
cd frontend
cp .env.example .env                      # EXPO_PUBLIC_API_URL=http://localhost:3000
npm install
npm run web                               # o: npm run ios / npm run android
```

Sin `SMTP_HOST` los correos (verificación, recuperar contraseña) se imprimen
en la consola del backend con su enlace: `docker compose -f compose-dev.yaml logs -f backend`.

## Pruebas

```bash
cd backend
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3306 TEST_DB_USER=root TEST_DB_PASSWORD=root-local npm test
cd ../frontend && npm run typecheck
```

## Despliegue

En el servidor: `./deploy.sh` (pregunta los datos, crea el `.env` y despliega con
Docker o Podman). Detalles en [DEPLOY.md](DEPLOY.md).
