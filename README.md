# OpenSICM 🚍🇵🇪
### Gateway Open Source de Telemetría GPS para Transporte Urbano (SICM ATU - Lima y Callao)

**OpenSICM** es una pasarela de telemetría de código abierto, ultraligera y gratuita diseñada específicamente para que las **empresas operadoras de transporte público urbano de Lima y Callao** puedan transmitir la posición reglamentaria de su flota a la plataforma **SICM de la ATU** (Autoridad de Transporte Urbano) de forma 100% independiente, sin pagar licencias mensuales a intermediarios.

---

## ⚡ Características Principales

* 🆓 **100% Software Libre:** Sin costos de suscripción ni bloqueos de proveedores.
* 🪶 **Consumo Mínimo de Recursos:** Diseñado para correr en servidores VPS de muy bajo costo (~€3.79 a $5/mes en Hetzner CX22 o DigitalOcean) con un consumo de RAM inferior a **150 MB**.
* 📡 **Multiprotocolo de Ingesta:**
  * **Teltonika:** Protocolo Codec 8 / Codec 8 Extended (FMB920, FMC130, FMB120) vía TCP con respuesta de confirmación AVL obligatoria.
  * **Suntech:** Protocolos ASCII ST300, ST310U y ST340 vía TCP.
  * **REST / JSON API:** Ingesta universal mediante `POST /api/telemetria` para integración con sistemas existentes o simuladores.
* 🔄 **Reconexión Resiliente:** Cliente WebSocket persistente hacia la ATU con backoff exponencial ($2\text{s} \to 4\text{s} \to 8\text{s} \dots \max 30\text{s}$), latido de corazón (Heartbeat) y detección de conexiones colgadas.
* 💾 **Cola Offline Reglamentaria:** Almacena en memoria y disco local más de **10,000 tramas** si se pierde el enlace con la ATU, transmitiéndolas automáticamente al reconectarse sin saturar el canal.
* 🗺️ **Visualizador en Tiempo Real:** Dashboard web moderno sin dependencias pesadas (Vanilla JS + Leaflet + OpenStreetMap) con rotación direccional de buses según rumbo, estados de operación (Verde/Amarillo/Rojo) y Server-Sent Events (SSE).
* 🧪 **Simulador y Servidor Mock incluidos:** Pruebe el sistema completo de inmediato con unidades simuladas recorriendo los corredores viales de Lima.

---

## 📋 Requisitos Normativos y Hardware Homologado

Conforme a las disposiciones de la ATU y la normativa del MTC:
* **Frecuencia de transmisión:** Cada **30 segundos** con vehículo encendido (ACC = ON).
* **Precisión GPS:** $\le 3\text{ m}$ (WGS 84).
* **Equipos comunes:**
  * **Teltonika:** FMB920, FMC130, FMB120 (Puerto `5001`/`5027`).
  * **Suntech:** ST310U, ST340 (Puerto `5001`/`5011`).
  * **Queclink:** GV300, GV300W.
  * **Concox / Coban:** GT06N, WeTrack2.

---

## 🚀 Inicio Rápido (3 Minutos)

### 1. Clonar el repositorio e instalar dependencias
```bash
git clone https://github.com/tu-empresa/OpenSICM.git
cd OpenSICM
npm install
```

### 2. Ejecutar las pruebas automatizadas
Para verificar que la validación WGS84, el formateador y el enlace WebSocket funcionen al 100%:
```bash
npm test
```

### 3. Iniciar en Entorno de Desarrollo Local
Para probar la plataforma en su computadora sin credenciales de la ATU:

1. **Terminal 1 - Servidor Mock de la ATU:**
   ```bash
   npm run mock-atu
   ```
2. **Terminal 2 - Pasarela OpenSICM:**
   ```bash
   npm start
   ```
3. **Terminal 3 - Simulador de Flota en Lima:**
   ```bash
   npm run simulator
   ```

Abra su navegador en: **`http://localhost:3000`** para ver el mapa de Lima con las 5 unidades en movimiento en tiempo real y el enlace ATU en verde `CONECTADO`.

---

## 🛠️ Configuración de Variables de Entorno (`.env`)

Copie el archivo de ejemplo y configure los parámetros de su empresa:
```bash
cp .env.example .env
```

| Variable | Descripción | Valor por Defecto |
| :--- | :--- | :--- |
| `HTTP_PORT` | Puerto del dashboard de monitoreo y API | `3000` |
| `GPS_INGEST_PORT` | Puerto TCP para recepción directa de equipos GPS | `5001` |
| `ATU_WS_ENDPOINT` | Dirección del WebSocket oficial de la ATU | `ws://localhost:5000/ws` |
| `ATU_COMPANY_TOKEN`| Token oficial asignado a su empresa por la ATU | `TOKEN_EMPRESA` |
| `TRANSMIT_INTERVAL_SEC` | Intervalo reglamentario de reporte | `30` |
| `OFFLINE_QUEUE_MAX_SIZE` | Capacidad máxima de respaldo en desconexión | `10000` |

---

## 🌐 Endpoints de la API REST

### `POST /api/telemetria`
Recibe una posición individual para normalizarla y retransmitirla a la ATU.

**Ejemplo de Payload:**
```json
{
  "imei": "864201041234567",
  "placa": "A1B789",
  "ruta": "IO33B",
  "padron": "12",
  "latitud": -12.046374,
  "longitud": -77.042793,
  "altitud": 154.2,
  "velocidad": 32.5,
  "rumbo": 180.0,
  "timestamp": 1717200000,
  "evento": "POSICION_PERIODICA",
  "ignicion": 1,
  "modeloGps": "TELTONIKA_FMB920"
}
```

### `POST /api/telemetria/batch`
Recibe un arreglo `[ {...}, {...} ]` para inyectar múltiples posiciones a la vez.

### `GET /api/stream`
Flujo Server-Sent Events (SSE) para suscripción en vivo de la posición de toda la flota y estado del enlace ATU.

### `GET /api/status`
Retorna métricas de la pasarela: estado del WebSocket ATU, tramas enviadas, confirmadas (ACK), tramas en cola y conteo de vehículos activos.

---

## 🐳 Despliegue en Servidor de Producción (VPS)

### Opción A: Despliegue con Docker Compose (Recomendado)

En su servidor VPS Ubuntu (Hetzner, DigitalOcean, Linode):

```bash
# 1. Configurar variables de producción
nano .env

# 2. Levantar contenedor en segundo plano con límite de 250MB RAM
docker compose up -d --build

# 3. Monitorear logs
docker compose logs -f
```

### Opción B: Despliegue Nativo con Systemd en Ubuntu 22.04 / 24.04

1. Instalar Node.js 22 LTS:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Configurar Firewall (UFW):
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5001/tcp
sudo ufw enable
```

3. Crear servicio systemd `/etc/systemd/system/opensicm.service`:
```ini
[Unit]
Description=OpenSICM Gateway GPS ATU
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/opensicm
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/opensicm/.env
MemoryMax=256M

[Install]
WantedBy=multi-user.target
```

4. Iniciar y habilitar:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opensicm
```

---

## 🗺️ Visualizador Web

El panel de monitoreo accesible desde `http://tu-servidor:3000` incluye:
* **Marcadores Direccionales:** Vehículos renderizados con iconos rotativos según el rumbo real ($0^\circ\text{ a }360^\circ$).
* **Semáforo Operacional:**
  * 🟢 **Verde (En marcha):** Velocidad $> 5\text{ km/h}$.
  * 🟡 **Amarillo (Detenido):** Velocidad $\le 5\text{ km/h}$ con motor encendido (ACC ON).
  * 🔴 **Rojo (Offline):** Motor apagado o más de 90 segundos sin reporte.
* **Filtros rápidos:** Por estado operacional o búsqueda instantánea por placa, ruta o padrón.
* **Ficha técnica por bus:** Placa, código de ruta, padrón, modelo de GPS, velocidad, coordenadas y estado de confirmación ante la ATU (`CONFIRMADO`, `ENVIADO`, `PENDIENTE`).

---

## 📜 Licencia

Distribuido bajo la licencia libre **MIT**. El software se ofrece sin restricciones para que cualquier consorcio o empresa de transporte del Perú pueda implementarlo libremente.
