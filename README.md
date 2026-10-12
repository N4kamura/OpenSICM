# OpenSICM 🚍🇵🇪
### Gateway Open Source de Telemetría GPS para Transporte Urbano (SICM ATU - Lima y Callao)

**OpenSICM** es una pasarela de telemetría de código abierto, ultraligera y gratuita diseñada específicamente para que las **empresas operadoras de transporte público urbano de Lima y Callao** puedan:
1. Transmitir la posición reglamentaria de su flota a la plataforma **SICM de la ATU** (Autoridad de Transporte Urbano) de forma 100% directa e independiente, sin pagar licencias mensuales a intermediarios.
2. Monitorear su flota en tiempo real con un dashboard web ligero (Vanilla JS + Leaflet + OpenStreetMap oficial).
3. Gestionar y medir el rendimiento operativo con un **Motor de KPIs** (odometría, horas de motor, índice de transmisión efectiva y detección de blackouts).
4. Diseñar, validar y exportar rutas y frecuencias en el estándar internacional **GTFS** (General Transit Feed Specification) mediante un editor interactivo en mapa.

---

## ⚡ Características del Sistema

* 🆓 **100% Software Libre:** Licencia MIT, sin costos de suscripción, sin límites de unidades ni bloqueos de proveedores.
* 🪶 **Consumo Ultrabajo de Recursos:** Ejecutable en servidores VPS de muy bajo costo (~€3.79 a $5/mes en Hetzner CX22 o DigitalOcean) con un consumo típico de memoria RAM inferior a **150 MB**.
* 📡 **Ingesta Multiprotocolo de Equipos GPS:**
  * **Teltonika:** Protocolo binario Codec 8 / Codec 8 Extended (FMB920, FMC130, FMB120, etc.) vía TCP con confirmación automática AVL reglamentaria.
  * **Suntech:** Protocolos ASCII ST300, ST310U y ST340 vía TCP.
  * **REST / JSON API:** Endpoints `POST /api/telemetria` y `POST /api/telemetria/batch` para inyección desde cualquier sistema externo, backend existente o simulador.
* 🔄 **Enlace Resiliente con la ATU:**
  * Conexión WebSocket persistente con reconexión automática mediante backoff exponencial ($2\text{s} \to 4\text{s} \to 8\text{s} \dots \max 30\text{s}$).
  * Latido de corazón (Heartbeat / Ping-Pong) para detectar conexiones inactivas o colgadas.
  * **Cola Offline Reglamentaria:** Almacén FIFO en memoria y respaldado en disco de $\ge 10,000$ tramas para cortes de internet o mantenimiento del servidor de la ATU, transmitiéndolas secuencialmente al reconectar sin saturar la red.
* 🗄️ **Base de Datos Embebida SQLite (Nativa Node.js 22):**
  * Utiliza el motor nativo `node:sqlite` (`DatabaseSync`) en modo WAL.
  * **Cero dependencias nativas de terceros:** No requiere compilar C++ (`node-gyp`), ni instalar PostgreSQL ni MongoDB.
* 📊 **Motor de Métricas & KPIs de Flota (Sin necesidad de GTFS):**
  * Odometría acumulada diaria por unidad (cálculo de distancia geodésica mediante fórmula de Haversine).
  * Horas y minutos de motor encendido (ACC = ON).
  * Índice de Transmisión Efectiva (ITE %): porcentaje de tramas confirmadas con ACK por la ATU.
  * Detección y registro de **Blackouts** (pérdida de reporte $>90$ segundos con vehículo encendido).
  * Velocidad máxima alcanzada por bus.
* 🗺️ **Diseñador y Visor GTFS en Mapa Leaflet:**
  * Creación y edición interactiva de trazos de Ida y Vuelta conectando recorridos.
  * Asistente inteligente de trazado de retorno.
  * Edición de vértices, eliminación, inserción y snapping de paraderos al recorrido.
  * Asignación de paraderos con ID incremental único y filtro de orden.
  * Programación de frecuencias de despacho (`frequencies.txt`).
  * Exportador directo de los 6 archivos estándar GTFS en formato CSV/TXT listos para entrega: `agency.txt`, `routes.txt`, `shapes.txt`, `stops.txt`, `trips.txt` y `frequencies.txt`.
* 🧪 **Simulador y Mock Server Integrados:**
  * Permite realizar pruebas integrales locales de inmediato con 5 buses simulados operando en los corredores viales de Lima (Javier Prado y Vía Expresa Paseo de la República).

---

## 💻 Requisitos del Sistema y Qué Instalar

### 1. Entorno de Ejecución
* **Node.js:** Versión **22.5.0 LTS o superior** (Recomendado: Node.js 22.x LTS).
  > **Nota técnica:** Se requiere Node.js >= 22.5.0 porque OpenSICM aprovecha la API nativa `node:sqlite` para garantizar máxima portabilidad sin dependencias pesadas ni compiladores nativos.
* **npm:** Versión 10+ (incluida automáticamente con Node.js).
* **Git:** Para clonar el repositorio de código.

### 2. Dependencias del Proyecto
El proyecto está optimizado para tener la mínima cantidad de dependencias externas:
* `dotenv`: Para lectura de configuración y variables de entorno.
* `ws`: Cliente y servidor WebSocket ultraligero y de alto rendimiento.

---

## 📥 Instalación

### En Windows (PowerShell / CMD) o Linux / macOS:

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/tu-empresa/OpenSICM.git
   cd OpenSICM
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Verificar que la versión de Node.js sea la correcta:**
   ```bash
   node -v
   # Debe responder v22.5.0 o superior (ejemplo: v22.19.0)
   ```

4. **Ejecutar la suite de pruebas unitarias y de integración:**
   ```bash
   npm test
   ```
   *Ejecutará 20 pruebas automáticas que verifican la validación WGS84, el formateo ATU, SQLite, el motor de KPIs, la tienda GTFS y el enlace WebSocket de extremo a extremo.*

---

## ⚙️ Configuración (`.env`)

Crea tu archivo de variables de entorno a partir de la plantilla incluida:

```bash
# En Windows PowerShell:
Copy-Item .env.example .env

# En Linux / macOS / Bash:
cp .env.example .env
```

### Parámetros Disponibles:

| Variable | Descripción | Valor por Defecto |
| :--- | :--- | :--- |
| `NODE_ENV` | Entorno de ejecución (`development` o `production`) | `development` |
| `HTTP_PORT` | Puerto del dashboard web y API REST | `3000` |
| `GPS_INGEST_PORT` | Puerto de escucha TCP para dispositivos GPS físicos | `5001` |
| `GPS_TCP_ENABLED` | Habilita o deshabilita la recepción TCP directa | `true` |
| `ATU_WS_ENDPOINT` | URL del WebSocket de recepción de la ATU | `ws://localhost:5000/ws` |
| `ATU_COMPANY_TOKEN` | Token de seguridad provisto por la ATU para su empresa | `TOKEN_EMPRESA_DEMO_2026` |
| `TRANSMIT_INTERVAL_SEC` | Intervalo reglamentario de reporte (segundos) | `30` |
| `OFFLINE_QUEUE_MAX_SIZE` | Capacidad máxima del buffer offline de respaldo | `10000` |
| `OFFLINE_QUEUE_FILE` | Ruta del archivo de persistencia de la cola offline | `./data/offline_queue.json` |

---

---

## 🚀 Cómo Iniciar el Software

### 🏢 Modo 1: Producción Oficial (VPS / Servidor de Empresa)
> 📘 **Documentación Oficial de Producción:**
> * **Despliegue en VPS (Ubuntu + PM2 + Nginx SSL):** [**`docs/DEPLOYMENT.md`**](file:///d:/Projects/OpenSICM/docs/DEPLOYMENT.md)
> * **Conexión de GPS Físicos (Teltonika / Suntech / APN):** [**`docs/GPS_CONFIG_MANUAL.md`**](file:///d:/Projects/OpenSICM/docs/GPS_CONFIG_MANUAL.md)

En el servidor de producción, el Gateway se ejecuta simplemente con:
```bash
# Opción estándar:
npm start

# Opción recomendada para operación continua 24/7 con PM2:
npm run start:pm2
```
En este modo:
* Conecta directamente al WebSocket oficial de la ATU (`ATU_WS_ENDPOINT`).
* Escucha tramas directas de los GPS físicos de los buses en el puerto TCP `5001`.
* Persiste la base de datos de flota y métricas en `data/opensicm.db`.
* Mantiene la cola de respaldo en disco `data/offline_queue.json` en caso de corte de red.

---

### 🗺️ Modo 2: Modo Local / Diseñador GTFS (Sin Conexión a la ATU)

Si estás trabajando en la oficina modelando recorridos, trazando paraderos en el mapa o no tienes acceso a la red de la ATU:

```bash
npm run start:gtfs
```
*(O `npm run dev:gtfs` para modo desarrollo con autorecarga).*

Desactiva los intentos de conexión hacia la ATU, permitiéndote diseñar rutas GTFS, registrar unidades de flota y exportar archivos sin alertas de reconexión.

---

### 🧪 Modo 3: Herramientas de Pruebas y Desarrollo Local

Para pruebas internas de desarrollo, calibración en taller o demostraciones sin conexión externa:

1. **Servidor Todo-en-Uno (Gateway + Mock ATU):**
   ```bash
   npm run start:mock
   ```
2. **Simulador de Flota (Genera movimiento continuo en ruta OM09):**
   ```bash
   npm run simulator
   ```
3. **Prueba de Ingesta TCP con Tramas Homologadas (Suntech / Teltonika):**
   ```bash
   npm run test:tcp
   ```
4. **Ejecutar Suite de Pruebas Automatizadas:**
   ```bash
   npm test
   ```
   *Verifica los 23 tests de validación sintáctica, Haversine, SQLite y enlaces WebSocket.*

---

## 🖥️ Módulos de la Interfaz Web (`http://localhost:3000`)

La interfaz web está construida con **Vanilla JavaScript y Leaflet**, sin marcos pesados, ofreciendo respuesta instantánea y cinco vistas principales:

### 1. 🗺️ Mapa en Vivo
* **Visualización en Tiempo Real:** Mapa centrado en Lima y Callao con mapas base oficiales de OpenStreetMap.
* **Marcadores Direccionales:** Cada unidad cuenta con flecha orientada según su rumbo real ($0^\circ \text{ a } 360^\circ$).
* **Semáforo Operativo:**
  * 🟢 **Verde (En marcha):** Velocidad $> 5\text{ km/h}$.
  * 🟡 **Amarillo (Detenido):** Velocidad $\le 5\text{ km/h}$ con motor encendido (ACC ON).
  * 🔴 **Rojo (Offline):** Motor apagado o más de 90 segundos sin recibir transmisión.
* **Buscador y Filtros:** Búsqueda rápida por placa o código de ruta, y filtros instantáneos por estado.
* **Ficha Técnica por Unidad:** Muestra placa, ruta, padrón, modelo de GPS, velocidad, coordenadas y estado de confirmación ante la ATU (`CONFIRMADO`, `ENVIADO`, `PENDIENTE`).

### 2. 📊 Métricas & KPIs
* **Panel de Control Operativo:** Resumen consolidado de kilómetros totales recorridos hoy, horas acumuladas de motor, tramas enviadas y confirmadas con ACK por la ATU.
* **Índice de Transmisión Efectiva (ITE %):** Porcentaje de tramas recibidas y confirmadas satisfactoriamente por la ATU.
* **Registro de Alertas y Blackouts:** Lista en tiempo real de unidades que superaron los 90 segundos de inactividad con ignición encendida.
* **Tabla Detallada por Unidad:** Kilometraje, tiempo de operación, velocidad punta y último timestamp de reporte.

### 3. 🚍 Flota y Asignación GPS
* **Inventario de Unidades:** Alta, edición y baja de vehículos en base de datos SQLite embebida.
* **Mapeo IMEI $\to$ Placa:** Vinculación de equipos GPS físicos (Teltonika, Suntech, Queclink) con la placa y código de ruta de la empresa. Las tramas entrantes por TCP se asocian automáticamente a la placa registrada.

### 4. 🧭 Diseñador GTFS
* **Trazado de Rutas (Shapes):** Dibujo directo sobre el mapa de recorridos de Ida y Vuelta.
* **Asistente Inteligente de Retorno:** Generación guiada del trazo de vuelta conectando automáticamente el punto de llegada con el punto de partida.
* **Edición de Vértices & Snapping:** Arrastre interactivo de puntos del trazo, inserción de vértices intermedios y ajuste automático (snapping) de paraderos sobre el trazo.
* **Colocación y Orden de Paraderos:** Registro de paraderos con ID numérico único, nombre, coordenadas y ordenamiento secuencial.
* **Frecuencias de Servicio:** Horarios de inicio, fin e intervalo en segundos (`headway_secs`).
* **Exportador Oficial GTFS:** Descarga en un clic de los archivos CSV estándar: `agency.txt`, `routes.txt`, `shapes.txt`, `stops.txt`, `trips.txt` y `frequencies.txt`.

### 5. 🧪 Banco de Pruebas ATU
* Permite enviar manualmente tramas de prueba en formato JSON o simular casos de error para verificar la respuesta del validador y del enlace WebSocket antes de salir a producción.

---

## 📡 Integración y Protocolos de Comunicación

### 1. Ingesta Directa TCP (Puerto `5001`)
* Configure sus equipos físicos apuntando la IP pública de su servidor y el puerto `5001`.
* **Teltonika:** OpenSICM recibe el paquete AVL, procesa el IMEI, almacena la telemetría y responde con el paquete de confirmación de 4 bytes con el número de registros aceptados.
* **Suntech:** Procesa reportes ASCII estándar extrayendo fecha, coordenadas, velocidad y estado de ignición.

### 2. Ingesta REST API
Cualquier sistema externo puede enviar posiciones vía HTTP:

#### `POST /api/telemetria`
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

#### `POST /api/telemetria/batch`
Recibe un arreglo `[ { ... }, { ... } ]` para inyección masiva de posiciones.

#### Otros Endpoints Disponibles:
* `GET /api/status`: Retorna métricas de conexión WebSocket, cola offline y conteo de flota.
* `GET /api/stream`: Flujo SSE (Server-Sent Events) para suscripción en vivo.
* `GET /api/buses`: Lista completa del estado actual de todos los buses.
* `GET /api/kpis/summary`: Resumen global de KPIs operativos del día.
* `GET /api/kpis/units`: KPIs desglosados por unidad.
* `GET /api/fleet`: Lista de flota y mapeo de equipos GPS.
* `GET /api/gtfs/export/:filename`: Descarga de archivo específico GTFS (`shapes.txt`, `stops.txt`, etc.).

---

## 🐳 Despliegue en Servidor de Producción (VPS)

### Opción A: Despliegue con Docker Compose (Recomendado)

En servidores Ubuntu / Debian (Hetzner, DigitalOcean, AWS, etc.):

```bash
# 1. Copiar y configurar variables de entorno
cp .env.example .env
nano .env

# 2. Levantar el contenedor en segundo plano con límite de 250 MB de RAM
docker compose up -d --build

# 3. Ver logs en tiempo real
docker compose logs -f
```

### Opción B: Servicio Nativo Linux con Systemd

1. **Instalar Node.js 22 LTS:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Configurar Firewall (UFW):**
   ```bash
   sudo ufw allow 22/tcp     # SSH
   sudo ufw allow 80/tcp     # Web (si usas Nginx inverso)
   sudo ufw allow 3000/tcp   # Web / API directo
   sudo ufw allow 5001/tcp   # Ingesta GPS TCP
   sudo ufw enable
   ```

3. **Crear archivo de servicio `/etc/systemd/system/opensicm.service`:**
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

4. **Habilitar e iniciar servicio:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now opensicm
   ```

---

## 📁 Estructura del Proyecto

```text
OpenSICM/
├── data/                    # Almacenamiento local (SQLite opensicm.db y cola offline)
├── public/                  # Frontend web Vanilla JS + Leaflet + CSS
│   ├── app.js               # Lógica del cliente, suscripción SSE, mapas y GTFS
│   ├── index.html           # Estructura del dashboard y pestañas de vistas
│   └── styles.css           # Estilos de interfaz moderna (tema oscuro/dashboard)
├── src/
│   ├── ingest/              # Decodificadores de protocolos GPS físicos (TCP)
│   │   ├── suntech-decoder.js
│   │   ├── tcp-ingest.js
│   │   └── teltonika-decoder.js
│   ├── atu-forwarder.js     # Cliente WebSocket hacia ATU con cola offline
│   ├── config.js            # Módulo de configuración central (.env)
│   ├── db.js                # Base de datos SQLite embebida nativa (node:sqlite)
│   ├── fleet-store.js       # Gestión de flota e inventario GPS en SQLite
│   ├── gtfs-store.js        # Almacenamiento, relaciones y exportador CSV GTFS
│   ├── kpi-engine.js        # Motor de cálculo de KPIs, odometría y blackouts
│   ├── server.js            # Servidor HTTP, API REST, SSE y orquestador
│   ├── stateManager.js      # Caché en memoria de estado instantáneo de la flota
│   └── validator.js         # Validación y normalización estricta de trama ATU
├── test/
│   ├── mock-atu-server.js   # Servidor WebSocket Mock de pruebas ATU
│   └── run-tests.js         # Suite automatizada de pruebas
├── simulator.js             # Simulador de flota en tiempo real para Lima
├── docker-compose.yml       # Orquestación de contenedores Docker
├── Dockerfile               # Imagen Docker multietapa ultraligera (Alpine)
├── package.json             # Scripts de arranque y dependencias mínimas
└── README.md                # Documentación oficial del proyecto
```

---

## 📜 Licencia

Este proyecto está bajo la **Licencia MIT**. Es de uso totalmente libre y gratuito para empresas de transporte, consorcios, desarrolladores y la comunidad en general.
