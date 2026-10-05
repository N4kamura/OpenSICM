# Especificación Técnica: Gateway Open Source GPS - SICM ATU

## 1. Resumen Ejecutivo y Alcance
El objetivo es construir un sistema ligero, 100% de código abierto y de mínimo consumo de recursos, ejecutable en un VPS de bajo costo (ej. Hetzner CX22 de ~€4/mes o DigitalOcean Droplet de ~$6/mes). 
El sistema cumplirá dos funciones primordiales:
1. Actuar como pasarela/relay de telemetría: recibir posiciones periódicas cada 30 segundos, adaptarlas a la especificación técnica exigida por la ATU y transmitirlas vía WebSocket persistente.
2. Servir un visualizador web en tiempo real simple (Vanilla JS + Leaflet + OpenStreetMap) para supervisión de la flota y estado del enlace.
3. Proveer un simulador local desechable para pruebas de desarrollo extremo a extremo.

---

## 2. Recomendación de Infraestructura (VPS de Bajo Costo)

* **Proveedor sugerido:** 
  * **Hetzner Cloud (CX22):** 2 vCPU x86, 4 GB RAM, 40 GB NVMe, 20 TB tráfico (~€3.79 - €4.50/mes). Opción más eficiente en costo/rendimiento.
  * **DigitalOcean / Vultr / Linode:** Plan básico de 1 vCPU, 1 GB o 2 GB RAM (~$5 - $10/mes).
* **Sistema Operativo:** Ubuntu Server 22.04 LTS o 24.04 LTS x64.
* **Requisitos de Red:**
  * 1 IP pública estática IPv4.
  * Puertos abiertos en Firewall (UFW):
    * `22/TCP` (SSH de administración).
    * `80/TCP` y `443/TCP` (Interfaz web de monitoreo y API).
    * `5000-5050/TCP-UDP` (Puertos de ingesta de dispositivos GPS físicos).

---

## 3. Dispositivos GPS Homologados Comunes y Protocolos
El sistema contemplará la ingesta de los equipos más difundidos en el transporte público urbano de Lima y Callao con homologación MTC:

| Fabricante | Modelos Frecuentes | Protocolo / Puerto Típico | Notas de Hardware |
| :--- | :--- | :--- | :--- |
| **Suntech** | ST310U, ST340, ST3300 | TCP/UDP (Puerto `5011` / `5023`) | Muy popular en flotas urbanas; soporte de comandos SMS/GPRS. |
| **Teltonika** | FMB920, FMC130, FMB120 | TCP (Puerto `5027` - Protocolo Codec 8/8 Extended) | Alto estándar de fiabilidad; memoria offline extendida. |
| **Queclink** | GV300, GV300W, GV55 | TCP/UDP (Puerto `5004` - Protocolo @Track) | Amplia base instalada en empresas de transporte. |
| **Coban / Concox** | TK103, GT06N, WeTrack2 | TCP (Puerto `5001` / `5023`) | Equipos genéricos económicos comúnmente migrados. |

*Requisito normativo de hardware (para unidades reales):*
* Precisión horizontal nominal $\le 3\text{ m}$.
* Memoria interna de respaldo para $\ge 10,000$ tramas en almacenamiento no volátil.
* Batería interna recargable de respaldo con autonomía mínima de 5 horas.

---

## 4. Convenciones de Datos de Flota
Para identificar las unidades en el backend y mapa, se estandariza el siguiente formato de registro:

* **Placa:** 6 caracteres alfanuméricos en mayúsculas sin guiones (ej. `A1B789`, `BC1023`).
* **Código de Ruta ATU:** Código asignado de servicio (ej. `IO33B`, `CR42`, `101`, `OM18`).
* **Padrón Interno:** Número económico de la unidad dentro de la empresa (ej. `04`, `52`).
* **IMEI:** 15 dígitos numéricos del modem celular del equipo GPS.
* **Modelo GPS:** Cadena identificadora (`SUNTECH_ST310`, `TELTONIKA_FMB920`, `QUECLINK_GV300`, `SIMULADOR`).
* **Frecuencia de reporte:** Cada **30 segundos** con vehículo encendido (Ignición ACC = ON).

---

## 5. Arquitectura del Software

Se implementará una arquitectura desacoplada y ligera para mantener el uso de memoria RAM por debajo de los 250 MB:

```
[ GPS Físico o Simulador ]
         │ (Cada 30s)
         ▼
[ Ingesta Core (Node.js o Go) ] ── (Guarda último estado en memoria/SQLite)
         │
         ├───► [ Enlace ATU WebSocket Client ] ──► (ws://...atu.gob.pe:5000/ws?token=...)
         │                                      ▲
         │                                      └── (Log de respuesta / ACK)
         │
         └───► [ Servidor HTTP / SSE ] ──► [ Frontend Vanilla JS + Leaflet ]
```

### Componentes Clave:
1. **Módulo Ingesta:**
   * Receptor TCP ligero para tramas directas o endpoint interno REST (`POST /api/telemetria`) que recibe la normalización.
2. **Módulo State Manager:**
   * Almacén en memoria (Map en RAM) con la última posición de cada placa, estado del GPS, satélites, velocidad y timestamp.
3. **Módulo Forwarder WebSocket ATU:**
   * Cliente WebSocket con reconexión exponencial y cola FIFO en memoria/disco local en caso de desconexión.
   * Manejo del token de empresa vía variable de entorno.
4. **Módulo Frontend (Vanilla):**
   * Servidor de archivos estáticos (HTML/CSS/JS) sin frameworks ni dependencias de compilación (sin Webpack, Vite ni React).

---

## 6. Especificación de la Trama ATU (Payload SICM)

Cada 30 segundos, el worker debe formatear el último registro del bus al siguiente esquema JSON y enviarlo al WebSocket oficial:

```json
{
  "imei": "864201041234567",
  "placa": "A1B789",
  "ruta": "IO33B",
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

* **Validaciones estrictas antes de emitir:**
  * Latitud y longitud válidas en proyección WGS 84 (EPSG:4326).
  * `timestamp` en formato POSIX (segundos desde Epoch).
  * Rumbo entre $0.0^\circ$ y $360.0^\circ$.
  * Velocidad expresada en $\text{km/h}$.

---

## 7. Requerimientos del Frontend (Vanilla + Leaflet)

* **Tecnologías:** HTML5 semántico, CSS3 moderno (Flexbox/CSS Grid), Vanilla JavaScript (ES6+).
* **Biblioteca de mapas:** **Leaflet.js** (vía CDN o archivo local) con mapas base de **OpenStreetMap**.
* **Funcionalidades de la interfaz:**
  1. **Mapa interactivo:** Centrado por defecto en Lima y Callao (`[-12.046374, -77.042793]`, Zoom 12).
  2. **Marcadores de Buses:**
     * Icono rotatorio o indicador de dirección según el rumbo (`rumbo`).
     * Color según estado: Verde (en movimiento > 5 km/h), Amarillo (detenido con ignición ON), Rojo (sin reporte > 90s).
  3. **Popup / Tooltip por bus:**
     * Placa y código de ruta.
     * Padrón interno.
     * Modelo y marca de GPS instalado.
     * Velocidad actual y última hora de reporte (hh:mm:ss).
     * Estado de la transmisión hacia la ATU (Enviado / Confirmado / Pendiente).
  4. **Panel Lateral / Inferior de Estado:**
     * Estado de la conexión WebSocket con la ATU: `CONECTADO` (Verde), `RECONECTANDO` (Amarillo), `ERROR` (Rojo).
     * Contador de tramas enviadas / recibidas / fallidas en la sesión.
  5. **Actualización:** Vía Server-Sent Events (SSE) o WebSocket interno cada vez que se procese una posición.

---

## 8. Módulo de Pruebas: Simulador de Flota (Desechable)

El agente debe crear un script independiente (`simulator.js` o `simulator.py`) con las siguientes características:
* Simular **N buses** (ej. 5 unidades) operando en una ruta predefinida de Lima (ej. Corredor Javier Prado o Vía Expresa Paseo de la República).
* Generar coordenadas progresivas a lo largo de un listado de waypoints simulando movimiento real ($20\text{ a }50\text{ km/h}$).
* Inyectar la telemetría cada **30 segundos** al backend local.
* Permitir simular incidencias:
  * Bus que se detiene (velocidad 0).
  * Bus que pierde señal temporalmente.
* Estructurado en un único archivo independiente para fácil eliminación una vez culminadas las pruebas.

---

## 9. Directivas de Ejecución para el Agente

1. **Simplicidad ante todo:** No utilizar bases de datos pesadas (no instalar MongoDB ni PostgreSQL completo si basta con SQLite o memoria volátil para este propósito).
2. **Cero dependencias innecesarias en el cliente:** Solo un archivo `index.html`, un archivo `styles.css` y un archivo `app.js`.
3. **Resiliencia en el WebSocket de la ATU:**
   * Reintento de conexión automática tras desconexión con backoff exponencial ($2\text{s}, 4\text{s}, 8\text{s}, \dots \max 30\text{s}$).
   * Heartbeat / Ping-Pong para detectar conexiones colgadas.
4. **Variables de entorno (`.env`):**
   * `ATU_WS_ENDPOINT` (ej. `ws://devrecepcion.atu.gob.pe:5000/ws`)
   * `ATU_COMPANY_TOKEN` (Token asignado a la empresa)
   * `HTTP_PORT` (Puerto del dashboard web, por defecto `3000` o `80`)
   * `GPS_INGEST_PORT` (Puerto de escucha)
   * `TRANSMIT_INTERVAL_SEC` (30)