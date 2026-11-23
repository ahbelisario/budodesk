FROM node:20-alpine
WORKDIR /usr/src/app

# Certificado del proxy corporativo (Zscaler) para poder instalar paquetes desde esa red.
COPY zscaler-ca.pem /usr/local/share/ca-certificates/zscaler-ca.crt
RUN echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/main" > /etc/apk/repositories && \
    echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/community" >> /etc/apk/repositories && \
    apk add --no-cache ca-certificates && update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN npm config set cafile /etc/ssl/certs/ca-certificates.crt

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

# Carpeta de archivos subidos (montada como volumen) y usuario sin privilegios
RUN mkdir -p uploads && chown -R node:node uploads
USER node

ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/usr/src/app/uploads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v2/health || exit 1
CMD ["node", "src/server.js"]
