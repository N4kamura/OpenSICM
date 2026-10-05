# ==============================================================
# OpenSICM - Dockerfile Ligero para VPS de Bajo Costo (RAM < 150MB)
# ==============================================================
FROM node:22-alpine

# Definir directorio de trabajo
WORKDIR /app

# Instalar solo dependencias de producción
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente y assets
COPY src/ ./src/
COPY public/ ./public/
COPY simulator.js ./
COPY test/ ./test/

# Crear directorio de datos persistentes y asignar permisos
RUN mkdir -p /app/data && chown -R node:node /app

# Cambiar a usuario no-root por seguridad
USER node

# Exponer puerto HTTP Dashboard (3000) y puerto Ingesta GPS TCP (5001)
EXPOSE 3000 5001

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV HTTP_PORT=3000
ENV GPS_INGEST_PORT=5001

# Comando de inicio del Gateway
CMD ["node", "src/server.js"]
