# 🚀 Guía de Despliegue en Producción - OpenSICM

Esta guía detalla la arquitectura estándar y los pasos exactos para desplegar **OpenSICM** en un servidor VPS Linux (Ubuntu 22.04 / 24.04 LTS) de bajo costo mediante **Docker Compose** como método principal de producción, garantizando alta disponibilidad 24/7, cifrado SSL/HTTPS, reinicio automático y recepción de telemetría de GPS físicos.

---

## 1. Selección del VPS (Costo vs. Confiabilidad)

OpenSICM fue diseñado con una arquitectura sumamente ligera (Node.js sin frameworks pesados, Vanilla JS y SQLite embebido en modo WAL). Su consumo en producción oscila entre **60 MB y 85 MB de RAM**, y el daemon de Docker Engine en Linux consume apenas entre **30 MB y 50 MB de RAM**.

### Comparativa de Proveedores Recomendados

| Proveedor | Plan Recomendado | Especificaciones | Precio Aprox. | Ubicación Sugerida | Veredicto |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hetzner Cloud** ⭐ *(Recomendado)* | **CX22** | 2 vCPU, 4 GB RAM, 40 GB NVMe, 20 TB tráfico | **~€3.79/mes** (~$4.10 USD) | Ashburn (EE.UU.) o Alemania | **Mejor relación precio/potencia del mercado**. 4 GB de RAM por menos de €4. |
| **DigitalOcean** | **Basic Droplet** | 1 vCPU, 1 GB o 2 GB RAM, 25 GB SSD, 1 TB tráfico | **$6.00 - $12.00/mes** | Nueva York (NYC3) | Facturación simple en USD, excelente latencia hacia Lima (~75ms). |
| **Vultr / Linode** | **Standard** | 1 vCPU, 1 GB o 2 GB RAM, 25 GB SSD | **$5.00 - $10.00/mes** | Miami / Atlanta (EE.UU.) | Muy estable y con datacenters cercanos a Sudamérica. |

> [!TIP]
> **Recomendación definitiva:** 
> * **Hetzner Cloud CX22**: Ofrece 4 GB de RAM y 2 vCPUs por solo ~€3.79/mes. Con 4 GB de RAM, Docker y OpenSICM funcionan con más del 85% de memoria libre garantizada.

---

## 2. Docker en VPS de Bajo Costo: ¿Consume mucha RAM?

Una duda común y comprensible al usar Docker en VPS baratos es si Docker ralentiza o satura la memoria del servidor. 

### ¿Por qué muchas personas tienen malas experiencias con Docker en VPS?
1. **Logs infinitos no rotados:** Docker por defecto guarda los logs de la consola en archivos JSON sin límite de tamaño. Tras semanas de operación de GPS enviando datos cada 30 segundos, el archivo de logs puede llegar a 15-20 GB, llenando el disco por completo y congelando Linux.
2. **Falta de límites de memoria (OOM Crashes):** Si un contenedor tiene una fuga de memoria y no tiene límite (`limits.memory`), consume todo el RAM del VPS hasta que el kernel de Linux (`OOM Killer`) congela el sistema o apaga procesos críticos.
3. **Ausencia de memoria SWAP en el VPS:** Los VPS recién creados vienen con 0 MB de SWAP. Si el uso de RAM sube al 100% por un instante (por ejemplo, al compilar dependencias), el VPS se cuelga.
4. **Imágenes monstruosas:** Imágenes de 1.5 GB basadas en Ubuntu completo o Node completo que agotan el almacenamiento.

### ¿Cómo soluciona OpenSICM estos problemas en Docker?
En OpenSICM hemos blindado la configuración de producción en [`Dockerfile`](../Dockerfile) y [`docker-compose.yml`](../docker-compose.yml):
* **Imagen Alpine Linux:** Utilizamos `node:22-alpine`. La imagen pesa menos de 140 MB y no tiene bloatware.
* **Consumo de memoria minúsculo:** OpenSICM corre consumiendo únicamente entre **60 y 85 MB de RAM**. El daemon de Docker suma solo **~35 MB**. En total, el sistema opera con ~110-120 MB de RAM.
* **Límite estricto de memoria (`memory: 250M`):** El contenedor tiene un techo de 250 MB configurado en Docker Compose. Es imposible que consuma el servidor.
* **Rotación automática de logs:** Configurado con `max-size: 10m` y `max-file: 3`. Los logs nunca ocuparán más de 30 MB en disco, pase lo que pase.
* **Persistencia directa en el host (`./data:/app/data`):** La base de datos SQLite y la cola de contingencia ATU se guardan directamente en el disco del VPS, por lo que nunca se pierden al actualizar o reiniciar el contenedor.

---

## 3. Arquitectura de Red en Producción

```
[ GPS Físicos en Buses ] ──(TCP: 5001)──► [ Firewall UFW ] ──► [ Docker: opensicm-gateway:5001 ]
                                                                             │
[ Operadores Web / Flota ] ──(HTTPS: 443)─► [ Nginx + SSL ] ──► [ Docker: opensicm-gateway:3000 ]
                                                                             │
                                                                             ▼
                                                              [ WebSocket Oficial ATU ]
                                                               (wss://sicm.atu.gob.pe/ws)
```

---

## 4. Despliegue con Docker Compose (Método Oficial de Producción)

Conéctate a tu VPS recién creado vía SSH:
```bash
ssh root@IP_DE_TU_VPS
```

### Paso 1: Actualizar el Sistema y Configurar Memoria SWAP
Configurar 2 GB de SWAP previene cuelgues del VPS ante picos momentáneos de carga:
```bash
# Actualizar repositorios
apt update && apt upgrade -y

# Crear archivo SWAP de 2 GB (seguro para VPS de 1GB o 2GB RAM)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Instalar utilitarios básicos, Nginx y Certbot para HTTPS
apt install -y curl git ufw nginx certbot python3-certbot-nginx
```

---

### Paso 2: Instalar Docker y Docker Compose Oficial
Instala el motor oficial de Docker optimizado para Linux:
```bash
curl -fsSL https://get.docker.com | sh
```
Verifica la instalación:
```bash
docker --version
docker compose version
```

---

### Paso 3: Configurar el Firewall (UFW)
Abre únicamente los puertos estrictamente necesarios:
```bash
# Acceso administrativo
ufw allow 22/tcp

# Dashboard Web y API REST (Nginx se encargará de HTTPS)
ufw allow 80/tcp
ufw allow 443/tcp

# Ingesta de equipos GPS físicos (Suntech, Teltonika, Queclink, Concox)
ufw allow 5001/tcp

# Habilitar firewall
ufw --force enable
ufw status verbose
```

---

### Paso 4: Clonar el Repositorio de OpenSICM
Recomendamos alojar el proyecto en `/var/www/opensicm`:

```bash
# Crear directorio
mkdir -p /var/www/opensicm
cd /var/www/opensicm

# Clonar tu repositorio desde GitHub
git clone https://github.com/N4kamura/OpenSICM.git .

# Crear el directorio de datos persistente en el host
mkdir -p data
```

---

### Paso 5: Configurar las Variables de Entorno de Producción (`.env`)
Copia la plantilla y edítala con las credenciales oficiales provistas por la ATU:

```bash
cp .env.example .env
nano .env
```

Configura los valores exactos para la operación oficial:
```ini
# Entorno
NODE_ENV=production

# Puertos locales del Gateway
HTTP_PORT=3000
GPS_INGEST_PORT=5001
GPS_TCP_ENABLED=true

# Conexión Oficial SICM ATU
# Endpoint WebSocket provisto formalmente por la ATU para tu empresa:
ATU_WS_ENDPOINT=wss://sicm.atu.gob.pe:5000/ws
# Token único asignado por la ATU a tu empresa concesionaria:
ATU_COMPANY_TOKEN=TU_TOKEN_OFICIAL_ATU_2026

# Frecuencia de transmisión reglamentaria
TRANSMIT_INTERVAL_SEC=30

# Capacidad máxima del búfer offline (Normativa ATU: >= 10,000 tramas)
OFFLINE_QUEUE_MAX_SIZE=10000
OFFLINE_QUEUE_FILE=/app/data/offline_queue.json
```
*Guarda los cambios con `Ctrl + O`, `Enter` y sal con `Ctrl + X`.*

---

### Paso 6: Levantar el Gateway en Producción con Docker Compose
Construye la imagen optimizada e inicia el servicio en segundo plano:

```bash
docker compose up -d --build
```

Verifica que el contenedor esté corriendo y revisa su uso real de memoria:
```bash
# Ver estado del contenedor (debe decir 'Up')
docker compose ps

# Ver consumo real de memoria y CPU en tiempo real
docker stats opensicm-gateway
```
*(Comprobarás que consume únicamente entre 60 MB y 85 MB de RAM).*

---

### Paso 7: Configurar Nginx y Certificado SSL Gratuito (HTTPS)

Nginx recibirá las conexiones seguras en el puerto 443 (HTTPS) con certificado SSL y las reenviará internamente al puerto 3000 de OpenSICM.

Crea la configuración de Nginx:
```bash
nano /etc/nginx/sites-available/opensicm
```

Pega la siguiente configuración (reemplaza `gps.tuempresa.com.pe` por tu subdominio o tu IP si aún no tienes dominio):
```nginx
server {
    listen 80;
    server_name gps.tuempresa.com.pe;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Cabeceras para WebSocket y Server-Sent Events (SSE)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # Desactivar buffering para mapa y SSE en tiempo real
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Headers de IP del cliente
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Habilita el sitio y reinicia Nginx:
```bash
ln -s /etc/nginx/sites-available/opensicm /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
```

#### Instalar Certificado SSL Gratuito (HTTPS) con Let's Encrypt:
```bash
certbot --nginx -d gps.tuempresa.com.pe
```
*(Selecciona redirigir automáticamente todo el tráfico HTTP a HTTPS).*

¡Listo! Tu dashboard web ya es accesible de forma segura vía `https://gps.tuempresa.com.pe`.

---

## 5. Configuración de los GPS Físicos en los Buses

Para que los equipos GPS instalados en la flota transmitan hacia tu nuevo Gateway, configúralos con los siguientes parámetros mediante cable serial o comandos SMS:

* **Dirección IP / Host de Servidor:** `IP_PUBLICA_DE_TU_VPS` (o tu dominio).
* **Puerto:** `5001`
* **Protocolo:** `TCP`
* **APN:** Según la tarjeta SIM instalada:
  * Claro: `claro.pe`
  * Movistar: `movistar.pe`
  * Entel: `entel.pe`
  * Bitel: `bitel.pe`
* **Frecuencia de reporte:** Cada **30 segundos** con motor encendido ($\text{ACC} = \text{ON}$) y cada **300 segundos** con motor apagado.

### Mapeo Automático en OpenSICM:
Cuando el equipo GPS físico se conecte por primera vez al puerto `5001`, transmitirá su número **IMEI** (15 dígitos).
En la pestaña **Flota y Asignación GPS** de la web, asocia dicho IMEI a la placa y ruta correspondiente (ej. `A1B789` - `OM09`). A partir de ese momento, OpenSICM normalizará y transmitirá todas sus posiciones hacia la ATU automáticamente.

> 📘 **Manual Completo de Equipos GPS:**
> Consulta la guía paso a paso con comandos SMS para Suntech y Teltonika en [**`docs/GPS_CONFIG_MANUAL.md`**](file:///d:/Projects/OpenSICM/docs/GPS_CONFIG_MANUAL.md).

---

## 6. Comandos de Operación Diaria (Docker)

Todos los comandos se ejecutan dentro del directorio `/var/www/opensicm`:

```bash
# Ver estado del servicio
docker compose ps

# Ver logs de telemetría y confirmaciones ATU en tiempo real
docker compose logs -f opensicm-gateway

# Ver las últimas 100 líneas del log
docker compose logs --tail=100 opensicm-gateway

# Ver consumo de RAM y CPU en tiempo real
docker stats opensicm-gateway

# Reiniciar el Gateway (sin pérdida de datos)
docker compose restart opensicm-gateway

# Detener el Gateway
docker compose down

# Actualizar el Gateway tras hacer 'git pull'
git pull origin main
docker compose up -d --build
```

---

## 7. Respaldos Automáticos de la Base de Datos

OpenSICM almacena la base de datos de flota, trazos GTFS y métricas en SQLite directamente en la carpeta `./data` del host VPS:
* Archivo SQLite: `/var/www/opensicm/data/opensicm.db`
* Búfer de cola offline: `/var/www/opensicm/data/offline_queue.json`

### Script de Respaldo Automático Diario (Cron):
Crea un respaldo diario ejecutando `crontab -e` y agregando al final:
```bash
0 2 * * * cp /var/www/opensicm/data/opensicm.db /var/backups/opensicm_$(date +\%F).db
```
Esto guardará una copia de seguridad íntegra de la base de datos cada madrugada a las 02:00 AM sin detener el contenedor.

---

## 8. Método Alternativo: Despliegue Nativo con Node.js y PM2

Si en el futuro o en algún entorno prefieres ejecutar la aplicación de forma nativa sin Docker, el procedimiento es:

1. Instalar Node.js 22 LTS: `curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs`
2. Instalar PM2: `npm install -g pm2`
3. Instalar dependencias: `npm install --omit=dev`
4. Iniciar con PM2: `pm2 start ecosystem.config.js --env production`
5. Guardar inicio automático: `pm2 save && pm2 startup`
