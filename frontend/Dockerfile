# ---------- Build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Mismo origen detrás de nginx: el API vive en /api
ENV EXPO_PUBLIC_API_URL=""
# Dojo por defecto cuando el subdominio no lo indica (p. ej. dev.budodesk.com o una IP)
ARG DEFAULT_DOJO_SLUG=""
ENV EXPO_PUBLIC_DOJO_SLUG=$DEFAULT_DOJO_SLUG
RUN npx expo export --platform web --clear

# ---------- Runtime ----------
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location /_expo/ { expires 1y; add_header Cache-Control "public, immutable"; try_files $uri =404; }\n  location /assets/ { expires 30d; try_files $uri =404; }\n  location / { add_header Cache-Control "no-cache"; try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
