# 🚀 Guía de Despliegue en Producción - OpenSICM

Esta guía describe la arquitectura estándar y los pasos exactos para desplegar **OpenSICM** en un servidor VPS Linux (Ubuntu 22.04 / 24.04 LTS) de bajo costo, garantizando alta disponibilidad 24/7, cifrado SSL/HTTPS, reinicio automático y recepción de telemetría de GPS físicos.

---

## 1. Selección del VPS (Costo vs. Confiabilidad)

OpenSICM fue diseñado con una arquitectura extremadamente ligera (Vanilla JS, Node.js sin frameworks pesados y SQLite embebido). Su consumo de memoria RAM en producción oscila entre **50 MB y 85 MB**, lo que permite operarlo en los planes más económicos del mercado.

### Comparativa de Proveedores Recomendados

| Proveedor | Plan Recomendado | Especificaciones | Precio Aprox. | Ubicación Sugerida | Veredicto |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hetzner Cloud** ⭐ *(Recomendado)* | **CX22** | 2 vCPU, 4 GB RAM, 40 GB NVMe, 20 TB tráfico | **~€3.79/mes** (~$4.10 USD) | Ashburn (EE.UU.) o Alemania | **Mejor relación precio/potencia del mercado**. 4 GB de RAM por menos de €4. |
| **DigitalOcean** | **Basic Droplet** | 1 vCPU, 1 GB RAM, 25 GB SSD, 1 TB tráfico | **$6.00/mes** | Nueva York (NYC3) | Facturación simple en USD, excelente latencia hacia Lima (~75ms). |
| **Vultr / Linode** | **Standard** | 1 vCPU, 1 GB RAM, 25 GB SSD | **$5.00 - $6.00/mes** | Miami / Atlanta (EE.UU.) | Muy estable y con datacenters cercanos a Sudamérica. |

> [!TIP]
> **Recomendación definitiva:** 
> * Si deseas **máxima potencia por el menor precio**: Elige **Hetzner Cloud CX22** en la región de **Ashburn (EE.UU.)** para tener 4 GB de RAM y una latencia baja hacia Perú.
> * Si prefieres **simplicidad y pago en dólares**: Elige **DigitalOcean ($6/mes)** en la región **NYC3**.

---

## 2. Arquitectura Estándar para Node.js en Producción

El estándar de la industria para ejecutar servicios Node.js en servidores Linux dedicados se compone de 4 capas:

```
[ GPS Físicos en Buses ] ──(TCP: 5001)──► [ Firewall UFW ] ──► [ OpenSICM Ingest ]
                                                                      │
[ Operadores Web / Flota ] ──(HTTPS: 443)─► [ Nginx + SSL ] ──► [ OpenSICM Web (3000) ]
                                                                      │ (Gestionado por PM2)
                                                                      ▼
                                                       [ WebSocket Oficial ATU ]
                                                        (wss://sicm.atu.gob.pe/ws)
```

1. **PM2 (Process Manager):** Mantiene la aplicación activa en segundo plano, la reinicia automáticamente ante fallos o reinicio del VPS y gestiona los archivos de registro (logs).
2. **Nginx (Reverse Proxy):** Recibe las conexiones web externas en el puerto 443 (HTTPS) y las reenvía internamente al puerto 3000 de Node.js, aislando la aplicación.
3. **Let's Encrypt (Certbot):** Provee certificados SSL gratuitos con renovación automática cada 90 días.
4. **UFW (Firewall de Linux):** Bloquea todos los puertos del servidor salvo SSH (22), Web (80/443) y el puerto de ingesta GPS (5001).

---

## 3. Preparación del Servidor VPS (Paso a Paso)

Conéctate a tu servidor recién creado vía SSH desde tu terminal:
```bash
ssh root@IP_DE_TU_VPS
```

### Paso 1: Actualizar el Sistema Operativo
```bash
apt update && apt upgrade -y
apt install -y curl git ufw nginx certbot python3-certbot-nginx
```

---

### Paso 2: Configurar el Firewall (UFW)
Abre únicamente los puertos estrictamente necesarios:
```bash
# Acceso administrativo
ufw allow 22/tcp

# Dashboard Web y API REST
ufw allow 80/tcp
ufw allow 443/tcp

# Ingesta de equipos GPS físicos (Suntech, Teltonika, Queclink, Concox)
ufw allow 5001/tcp

# Habilitar firewall
ufw --force enable
ufw status verbose
```

---

### Paso 3: Instalar Node.js 22 LTS y PM2
Instala la versión oficial LTS de Node.js:
```bash
# Instalar repositorio oficial de NodeSource (Node.js 22 LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Verificar versiones
node -v # Debería ser v22.x
npm -v

# Instalar PM2 globalmente
npm install -g pm2
```

---

### Paso 4: Desplegar el Código de OpenSICM

Recomendamos alojar la aplicación en `/var/www/opensicm`:

```bash
# Crear directorio y clonar el repositorio
mkdir -p /var/www/opensicm
cd /var/www/opensicm

# Clonar tu repositorio (o copiar los archivos vía SCP / rsync)
git clone https://github.com/TU_USUARIO/OpenSICM.git .

# Instalar únicamente las dependencias de producción (ws, dotenv)
npm install --omit=dev
```

---

### Paso 5: Configurar las Variables de Entorno de Producción (`.env`)

Copia la plantilla y edita con tus credenciales reales:
```bash
cp .env.example .env
nano .env
```

Configura los valores exactos para la operación con la ATU:
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
OFFLINE_QUEUE_FILE=./data/offline_queue.json
```
*Guarda los cambios con `Ctrl + O`, `Enter` y sal con `Ctrl + X`.*

---

### Paso 6: Iniciar el Servicio con PM2

OpenSICM ya incluye un archivo [`ecosystem.config.js`](file:///d:/Projects/OpenSICM/ecosystem.config.js) configurado para producción.

```bash
# Iniciar el Gateway con PM2
pm2 start ecosystem.config.js --env production

# Configurar PM2 para que inicie automáticamente si el VPS se reinicia
pm2 save
pm2 startup
# (Ejecuta la línea de comando que PM2 te imprima en pantalla)
```

Comprueba que el servicio esté corriendo:
```bash
pm2 status
```
Deberás ver `opensicm-gateway` en estado `online` con un uso de memoria de ~60 MB.

---

### Paso 7: Configurar Nginx y Certificado SSL (HTTPS)

Crea un archivo de configuración para Nginx:
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

        # Evitar buffering para que el mapa se actualice en tiempo real sin latencia
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # IP real del cliente
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

---

## 4. Configuración de los GPS Físicos en los Buses

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

## 5. Comandos de Operación y Monitoreo Diario

```bash
# Ver estado de los servicios
pm2 status

# Ver logs de telemetría en tiempo real (posiciones y confirmaciones ATU)
pm2 logs opensicm-gateway

# Ver últimas 100 líneas de error
pm2 logs opensicm-gateway --err --lines 100

# Monitor de consumo de CPU y RAM en consola
pm2 monit

# Reiniciar el Gateway limpiamente (sin pérdida de datos)
pm2 restart opensicm-gateway

# Detener el Gateway
pm2 stop opensicm-gateway
```

---

## 6. Respaldos y Base de Datos

OpenSICM almacena la base de datos de flota, trazos GTFS y métricas en SQLite:
* Ubicación: `/var/www/opensicm/data/opensicm.db`
* Búfer de cola offline: `/var/www/opensicm/data/offline_queue.json`

### Script de Respaldo Automático Diario (Cron):
Crea un respaldo diario ejecutando `crontab -e` y agregando:
```bash
0 2 * * * cp /var/www/opensicm/data/opensicm.db /var/backups/opensicm_$(date +\%F).db
```
Esto creará una copia de seguridad cada madrugada a las 02:00 AM.
