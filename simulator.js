/**
 * OpenSICM - Simulador de Flota Desechable para Pruebas
 * Simula N unidades de transporte urbano en Lima con trayectorias reales,
 * cálculo de rumbo, variación de velocidad e inyección periódica de telemetría cada 30s.
 * 
 * Capacidades:
 * - Sincronización dinámica: Consulta /api/fleet y /api/gtfs/shapes (o SQLite local)
 *   para simular las unidades y el trazo real de la ruta OM09 (Ida y Vuelta Callao - Lima).
 * - Distribución uniforme de flota a lo largo del circuito trazado por el usuario.
 * - Soporte de transporte HTTP REST (por defecto) o TCP directo (--tcp).
 * - Soporte de ejecución continua o de ciclo único (--once).
 */
const http = require('http');
const net = require('net');

// Argumentos CLI
const args = process.argv.slice(2);
const USE_TCP = args.includes('--tcp') || process.env.SIM_PROTOCOL === 'tcp';
const RUN_ONCE = args.includes('--once');
const INTERVAL_ARG_IDX = args.indexOf('--interval');
const INTERVAL_CLI = INTERVAL_ARG_IDX !== -1 && args[INTERVAL_ARG_IDX + 1] ? parseInt(args[INTERVAL_ARG_IDX + 1], 10) : null;

// Configuración de simulación
const TARGET_URL = process.env.GATEWAY_URL || 'http://localhost:3000/api/telemetria';
const TCP_PORT = parseInt(process.env.GPS_INGEST_PORT || '5001', 10);
const TCP_HOST = process.env.GPS_INGEST_HOST || 'localhost';
const INTERVAL_SEC = INTERVAL_CLI || parseInt(process.env.SIM_INTERVAL || '30', 10);

// Rutas de respaldo por defecto
const WAYPOINTS_JAVIER_PRADO = [
  [-12.083812, -76.971038],
  [-12.087520, -76.993210],
  [-12.090124, -77.010245],
  [-12.091215, -77.026478],
  [-12.092100, -77.032100],
  [-12.092400, -77.035800],
  [-12.088300, -77.061200],
  [-12.082500, -77.072800],
  [-12.076800, -77.080500],
  [-12.071200, -77.091100],
  [-12.076800, -77.080500],
  [-12.088300, -77.061200],
  [-12.092100, -77.032100]
];

// Obtener trazo real de OM09 directamente desde SQLite si está disponible
function getOm09CircuitFromDb() {
  try {
    const db = require('./src/db');
    const ida = db.prepare('SELECT shape_pt_lat, shape_pt_lon FROM gtfs_shapes WHERE shape_id = ? ORDER BY shape_pt_sequence ASC').all('OM09_IDA');
    const vta = db.prepare('SELECT shape_pt_lat, shape_pt_lon FROM gtfs_shapes WHERE shape_id = ? ORDER BY shape_pt_sequence ASC').all('OM09_VTA');
    
    const circuit = [];
    if (Array.isArray(ida) && ida.length > 0) {
      ida.forEach(p => circuit.push([p.shape_pt_lat, p.shape_pt_lon]));
    }
    if (Array.isArray(vta) && vta.length > 0) {
      vta.forEach(p => circuit.push([p.shape_pt_lat, p.shape_pt_lon]));
    }
    return circuit.length > 0 ? circuit : null;
  } catch {
    return null;
  }
}

const CIRCUIT_OM09 = getOm09CircuitFromDb() || WAYPOINTS_JAVIER_PRADO;

// Flota de respaldo si no hay conexión API
const DEFAULT_FLEET = [
  {
    placa: 'A1B789',
    ruta: 'OM09',
    padron: '12',
    imei: '864201041234561',
    modeloGps: 'TELTONIKA_FMB920',
    waypoints: CIRCUIT_OM09,
    stepIndex: 0,
    speedBase: 36.0,
    behavior: 'NORMAL'
  },
  {
    placa: 'BC1023',
    ruta: 'OM09',
    padron: '45',
    imei: '864201041234562',
    modeloGps: 'SUNTECH_ST310',
    waypoints: CIRCUIT_OM09,
    stepIndex: 25,
    speedBase: 38.0,
    behavior: 'NORMAL'
  },
  {
    placa: 'D4E567',
    ruta: 'OM09',
    padron: '08',
    imei: '864201041234563',
    modeloGps: 'QUECLINK_GV300',
    waypoints: CIRCUIT_OM09,
    stepIndex: 50,
    speedBase: 32.0,
    behavior: 'NORMAL'
  },
  {
    placa: 'F7G890',
    ruta: 'OM09',
    padron: '27',
    imei: '864201041234564',
    modeloGps: 'TELTONIKA_FMC130',
    waypoints: CIRCUIT_OM09,
    stepIndex: 75,
    speedBase: 35.0,
    behavior: 'DETENIDO_TEMPORAL'
  },
  {
    placa: 'H2J345',
    ruta: 'OM09',
    padron: '33',
    imei: '864201041234565',
    modeloGps: 'SUNTECH_ST340',
    waypoints: CIRCUIT_OM09,
    stepIndex: 100,
    speedBase: 34.0,
    behavior: 'INCIDENTE'
  },
  {
    placa: 'A1B345',
    ruta: 'OM09',
    padron: '30',
    imei: '123456789012345',
    modeloGps: 'CONCOX_GT06',
    waypoints: CIRCUIT_OM09,
    stepIndex: 125,
    speedBase: 36.0,
    behavior: 'NORMAL'
  }
];

let activeFleet = [...DEFAULT_FLEET];

/**
 * Consulta un endpoint HTTP JSON simple
 */
function fetchJson(urlStr) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      http.get(u, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve(null);
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => {
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Carga dinámicamente la flota y trazos GTFS desde el Gateway si está activo
 */
async function loadDynamicFleet() {
  try {
    const targetUrlObj = new URL(TARGET_URL);
    const baseUrl = `${targetUrlObj.protocol}//${targetUrlObj.hostname}:${targetUrlObj.port || 3000}`;

    // 1. Obtener trazos GTFS vía API o SQLite
    const shapesList = await fetchJson(`${baseUrl}/api/gtfs/shapes`);
    const shapeWaypointsMap = {};

    if (Array.isArray(shapesList) && shapesList.length > 0) {
      for (const sh of shapesList) {
        const shapeId = sh.shape_id || sh;
        if (shapeId) {
          const points = await fetchJson(`${baseUrl}/api/gtfs/shapes?shape_id=${encodeURIComponent(shapeId)}`);
          if (Array.isArray(points) && points.length >= 2) {
            shapeWaypointsMap[shapeId] = points.map(p => [p.shape_pt_lat, p.shape_pt_lon]);
          }
        }
      }
    }

    // 2. Construir circuitos de ida y vuelta para las rutas
    const routeCircuitMap = {};
    const shapeKeys = Object.keys(shapeWaypointsMap);

    if (shapeKeys.length > 0) {
      // Buscar formas para OM09 o cualquier ruta
      const om09Ida = shapeWaypointsMap['OM09_IDA'] || shapeWaypointsMap['OM09_ida'];
      const om09Vta = shapeWaypointsMap['OM09_VTA'] || shapeWaypointsMap['OM09_vta'] || shapeWaypointsMap['OM09_VUELTA'];

      if (om09Ida && om09Vta) {
        routeCircuitMap['OM09'] = [...om09Ida, ...om09Vta];
      } else if (om09Ida) {
        routeCircuitMap['OM09'] = om09Ida;
      }
    }

    // Si la API no devolvió trazos, usar los leídos directamente de SQLite
    if (!routeCircuitMap['OM09'] && CIRCUIT_OM09 && CIRCUIT_OM09.length > 0) {
      routeCircuitMap['OM09'] = CIRCUIT_OM09;
    }

    // 3. Obtener inventario de flota
    const fleetResp = await fetchJson(`${baseUrl}/api/fleet`);
    let validUnits = [];

    if (fleetResp && Array.isArray(fleetResp.units) && fleetResp.units.length > 0) {
      validUnits = fleetResp.units.filter(u => u.activo && u.imei && u.imei.length === 15);
    } else {
      // Si el gateway no responde aún, consultar fleetStore directamente
      try {
        const fleetStore = require('./src/fleet-store');
        validUnits = fleetStore.getAll().filter(u => u.activo && u.imei && u.imei.length === 15);
      } catch {
        // Fallback a DEFAULT_FLEET
      }
    }

    if (validUnits.length > 0) {
      const defaultCircuit = routeCircuitMap['OM09'] || CIRCUIT_OM09;

      activeFleet = validUnits.map((u, idx) => {
        // Asociar al circuito de la ruta o fallback
        let waypoints = routeCircuitMap[u.ruta] || defaultCircuit;

        let behavior = 'NORMAL';
        if (idx % 5 === 3) behavior = 'DETENIDO_TEMPORAL';
        if (idx % 7 === 5) behavior = 'INCIDENTE';

        // Distribuir unidades de forma equidistante a lo largo de la ruta
        const stepIndex = Math.floor((idx / validUnits.length) * waypoints.length);

        return {
          placa: u.placa,
          ruta: u.ruta || 'OM09',
          padron: u.padron || String(idx + 1).padStart(2, '0'),
          imei: u.imei,
          modeloGps: u.modeloGps || 'TELTONIKA_FMB920',
          waypoints,
          stepIndex,
          speedBase: 32.0 + (idx % 3) * 3.0,
          behavior
        };
      });

      const totalPts = defaultCircuit ? defaultCircuit.length : 0;
      console.log(`[Simulador] 🔄 Flota sincronizada con la ruta OM09: ${activeFleet.length} unidades activas circulando por ${totalPts} waypoints (Sáenz Peña ⇄ Plaza Unión).`);
      return true;
    }
  } catch (e) {
    // Fallback limpio
  }

  console.log(`[Simulador] ℹ️  Usando flota de demostración (${activeFleet.length} unidades sobre ruta OM09).`);
  return false;
}

/**
 * Calcula el rumbo (acimut en grados 0-360) entre dos coordenadas
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * toDeg;
  return (brng + 360) % 360;
}

/**
 * Genera la posición interpolada de un bus y avanza su recorrido
 */
function advanceBus(bus, cycleCount) {
  const { waypoints } = bus;
  const currIdx = bus.stepIndex % waypoints.length;
  // Avanzar 1 o 2 waypoints según velocidad (en la ruta de 151 puntos, cada punto dista ~150 metros)
  const nextIdx = (bus.stepIndex + 1) % waypoints.length;

  const [lat1, lon1] = waypoints[currIdx];
  const [lat2, lon2] = waypoints[nextIdx];

  const bearing = calculateBearing(lat1, lon1, lat2, lon2);

  // Variación realista de velocidad urbana
  let velocidad = bus.speedBase + (Math.random() * 6 - 3);
  let ignicion = 1;

  if (bus.behavior === 'DETENIDO_TEMPORAL' && cycleCount % 5 === 0) {
    // Parada momentánea en paradero con motor prendido
    velocidad = 0.0;
  } else if (bus.behavior === 'INCIDENTE' && cycleCount % 8 === 0) {
    // Detención con motor apagado
    velocidad = 0.0;
    ignicion = 0;
  }

  // Interpolar a lo largo del segmento
  const fraction = 0.40 + Math.random() * 0.20;
  const lat = lat1 + (lat2 - lat1) * fraction;
  const lon = lon1 + (lon2 - lon1) * fraction;

  if (velocidad > 0) {
    // Si la velocidad supera 36 km/h, avanzar 2 waypoints para avanzar más dinámicamente
    bus.stepIndex = (bus.stepIndex + (velocidad > 36 ? 2 : 1)) % waypoints.length;
  }

  return {
    imei: bus.imei,
    placa: bus.placa,
    ruta: bus.ruta,
    padron: bus.padron,
    latitud: Math.round(lat * 1000000) / 1000000,
    longitud: Math.round(lon * 1000000) / 1000000,
    altitud: 145.0 + Math.round(Math.random() * 8),
    velocidad: Math.round(velocidad * 10) / 10,
    rumbo: Math.round(bearing * 10) / 10,
    timestamp: Math.floor(Date.now() / 1000),
    evento: 'POSICION_PERIODICA',
    ignicion,
    modeloGps: bus.modeloGps
  };
}

/**
 * Envía la telemetría al Gateway vía POST REST
 */
function sendTelemetryHttp(payload) {
  return new Promise((resolve) => {
    const url = new URL(TARGET_URL);
    const postData = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      resolve({ error: err.message || err.code || 'Error de conexión HTTP' });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Envía la telemetría al Gateway vía TCP (puerto 5001)
 */
function sendTelemetryTcp(payload) {
  return new Promise((resolve) => {
    const client = net.createConnection({ host: TCP_HOST, port: TCP_PORT }, () => {
      const line = JSON.stringify(payload) + '\n';
      client.write(line, () => {
        setTimeout(() => {
          client.end();
          resolve({ statusCode: 200, via: 'TCP' });
        }, 80);
      });
    });

    client.on('error', (err) => {
      resolve({ error: err.message || err.code || 'Error de conexión TCP' });
    });

    client.setTimeout(2000, () => {
      client.destroy();
      resolve({ error: 'Timeout TCP' });
    });
  });
}

let cycle = 0;
async function runCycle() {
  cycle++;
  console.log(`\n================== Ciclo de Simulación #${cycle} (${new Date().toLocaleTimeString()}) ==================`);

  for (const bus of activeFleet) {
    const telemetry = advanceBus(bus, cycle);
    const res = USE_TCP ? await sendTelemetryTcp(telemetry) : await sendTelemetryHttp(telemetry);

    if (res.error) {
      console.log(`❌ [${bus.placa}] Error conectando a Gateway (${USE_TCP ? 'TCP' : 'HTTP'}): ${res.error}`);
    } else {
      const estado = telemetry.velocidad > 5 ? 'EN MARCHA' : (telemetry.ignicion === 1 ? 'DETENIDO CON MOTOR ENCENDIDO' : 'MOTOR APAGADO');
      
      const tramaAtu = {
        imei: telemetry.imei,
        placa: telemetry.placa,
        ruta: telemetry.ruta,
        latitud: telemetry.latitud,
        longitud: telemetry.longitud,
        altitud: telemetry.altitud,
        velocidad: telemetry.velocidad,
        rumbo: telemetry.rumbo,
        timestamp: telemetry.timestamp,
        evento: telemetry.evento,
        ignicion: telemetry.ignicion,
        modeloGps: telemetry.modeloGps
      };

      console.log(`----------------------------------------------------------------------`);
      console.log(`🚍 TRAMA ATU ENVIADA | Placa: [${telemetry.placa}] | Ruta: [${telemetry.ruta}] | Padrón: [${bus.padron}]`);
      console.log(JSON.stringify(tramaAtu, null, 2));
      console.log(`>> Estado: ${estado} (${telemetry.velocidad} km/h) | Rumbo: ${telemetry.rumbo}° | Vía: ${USE_TCP ? 'TCP 5001' : `HTTP ${res.statusCode} OK`}`);
      console.log(`----------------------------------------------------------------------`);
    }
  }

  if (RUN_ONCE) {
    console.log(`\n[Simulador] Finalizado ciclo único (--once).`);
    process.exit(0);
  } else {
    console.log(`\n⏳ Próximo reporte de telemetría en ${INTERVAL_SEC} segundos...`);
  }
}

// Inicialización
async function main() {
  console.log(`🚌 Iniciando Simulador de Flota OpenSICM`);
  console.log(`🎯 Modo de Transporte: ${USE_TCP ? `TCP Directo (${TCP_HOST}:${TCP_PORT})` : `HTTP REST (${TARGET_URL})`}`);
  console.log(`⏱️  Frecuencia:         ${RUN_ONCE ? 'Ciclo único (--once)' : `Cada ${INTERVAL_SEC} segundos`}`);
  
  await loadDynamicFleet();
  console.log(`📍 Unidades en simulación: ${activeFleet.length}`);
  console.log(`----------------------------------------------------------------------`);

  runCycle();
  if (!RUN_ONCE) {
    const timer = setInterval(runCycle, INTERVAL_SEC * 1000);
    process.on('SIGINT', () => {
      clearInterval(timer);
      console.log('\n[Simulador] Detenido por el usuario.');
      process.exit(0);
    });
  }
}

main();
