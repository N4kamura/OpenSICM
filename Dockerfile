# ==============================================================
# OpenSICM - Dockerfile Ultraligero para Producción (Alpine Linux)
# Tamaño de imagen < 150 MB | Consumo de RAM < 85 MB
# ==============================================================
FROM node:22-alpine

WORKDIR /app

# Instalar únicamente dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar archivos esenciales de la aplicación
COPY src/ ./src/
COPY public/ ./public/
COPY LICENSE ./

# Crear directorio de datos persistentes y asegurar permisos para usuario no-root
RUN mkdir -p /app/data && chown -R node:node /app

# Ejecutar como usuario no-root para máxima seguridad
USER node

# Exponer Dashboard HTTP (3000) e Ingesta GPS TCP (5001)
EXPOSE 3000 5001

ENV NODE_ENV=production

# Comando de inicio oficial
CMD ["node", "src/server.js"]
