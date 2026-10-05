/**
 * OpenSICM - Simulador de Flota Desechable para Pruebas
 * Simula N unidades de transporte urbano en Lima con trayectorias reales,
 * cálculo de rumbo, variación de velocidad e inyección periódica de telemetría cada 30s.
 */
const http = require('http');

// Configuración de simulación
const TARGET_URL = process.env.GATEWAY_URL || 'http://localhost:3000/api/telemetria';
const INTERVAL_SEC = parseInt(process.env.SIM_INTERVAL || '30', 10);

// Rutas con waypoints reales en Lima Metropolitana
const WAYPOINTS_JAVIER_PRADO = [
  [-12.083812, -76.971038], // Óvalo Monitor (La Molina)
  [-12.087520, -76.993210], // Jockey Plaza
  [-12.090124, -77.010245], // Guardia Civil
  [-12.091215, -77.026478], // Clínica Javier Prado
  [-12.092100, -77.032100], // Rivera Navarrete (San Isidro)
  [-12.092400, -77.035800], // Petit Thouars
  [-12.088300, -77.061200], // Av. Brasil / Pershing
  [-12.082500, -77.072800], // Sucre
  [-12.076800, -77.080500], // Universitaria
  [-12.071200, -77.091100], // Faucett / La Marina
  [-12.076800, -77.080500], // Retorno
  [-12.088300, -77.061200],
  [-12.092100, -77.032100]
];

const WAYPOINTS_VIA_EXPRESA = [
  [-12.128100, -77.026200], // Benavides (Miraflores)
  [-12.112300, -77.027500], // Angamos
  [-12.102100, -77.028500], // Aramburú
  [-12.094500, -77.029800], // Canaval y Moreyra (San Isidro)
  [-12.091200, -77.030500], // Javier Prado
  [-12.081200, -77.031500], // Canadá
  [-12.071500, -77.032800], // México (La Victoria)
  [-12.067100, -77.033500], // Estadio Nacional
  [-12.057300, -77.035500], // Plaza Grau / Centro de Lima
  [-12.067100, -77.033500], // Retorno Sur
  [-12.094500, -77.029800],
  [-12.112300, -77.027500]
];

const WAYPOINTS_AV_BRASIL = [
  [-12.046374, -77.042793], // Plaza Dos de Mayo
  [-12.059200, -77.042100], // Plaza Bolognesi
  [-12.065800, -77.047200], // 28 de Julio
  [-12.074200, -77.053500], // Hospital del Niño
  [-12.088300, -77.061200], // Javier Prado Oeste
  [-12.098500, -77.068200], // Cúpula Magdalena
  [-12.088300, -77.061200], // Retorno
  [-12.059200, -77.042100]
];

// Definición de las 5 unidades de la flota
const FLEET = [
  {
    placa: 'A1B789',
    ruta: 'IO33B',
    padron: '12',
    imei: '864201041234561',
    modeloGps: 'TELTONIKA_FMB920',
    waypoints: WAYPOINTS_JAVIER_PRADO,
    stepIndex: 0,
    speedBase: 36.0,
    behavior: 'NORMAL'
  },
  {
    placa: 'BC1023',
    ruta: 'CR42',
    padron: '45',
    imei: '864201041234562',
    modeloGps: 'SUNTECH_ST310',
    waypoints: WAYPOINTS_VIA_EXPRESA,
    stepIndex: 3,
    speedBase: 42.0,
    behavior: 'NORMAL'
  },
  {
    placa: 'D4E567',
    ruta: '101',
    padron: '08',
    imei: '864201041234563',
    modeloGps: 'QUECLINK_GV300',
    waypoints: WAYPOINTS_AV_BRASIL,
    stepIndex: 1,
    speedBase: 28.0,
    behavior: 'NORMAL'
  },
  {
    placa: 'F7G890',
    ruta: 'OM18',
    padron: '27',
    imei: '864201041234564',
    modeloGps: 'TELTONIKA_FMC130',
    waypoints: WAYPOINTS_JAVIER_PRADO,
    stepIndex: 6,
    speedBase: 38.0,
    behavior: 'DETENIDO_TEMPORAL' // Se detiene por tráfico/paradero periódicamente
  },
  {
    placa: 'H2J345',
    ruta: 'IO33B',
    padron: '33',
    imei: '864201041234565',
    modeloGps: 'SUNTECH_ST340',
    waypoints: WAYPOINTS_VIA_EXPRESA,
    stepIndex: 7,
    speedBase: 30.0,
    behavior: 'INCIDENTE' // Simula parada con motor apagado o parada prolongada
  }
];

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
  const nextIdx = (bus.stepIndex + 1) % waypoints.length;

  const [lat1, lon1] = waypoints[currIdx];
  const [lat2, lon2] = waypoints[nextIdx];

  const bearing = calculateBearing(lat1, lon1, lat2, lon2);

  // Manejo de comportamientos para pruebas
  let velocidad = bus.speedBase + (Math.random() * 8 - 4);
  let ignicion = 1;

  if (bus.behavior === 'DETENIDO_TEMPORAL' && cycleCount % 4 === 0) {
    // Cada 4 ciclos, se detiene en paradero con motor prendido
    velocidad = 0.0;
  } else if (bus.behavior === 'INCIDENTE' && cycleCount % 6 === 0) {
    // Parada prolongada con motor apagado
    velocidad = 0.0;
    ignicion = 0;
  }

  // Interpolar un poco para que el movimiento sea continuo y fluido
  const fraction = 0.35 + Math.random() * 0.25;
  const lat = lat1 + (lat2 - lat1) * fraction;
  const lon = lon1 + (lon2 - lon1) * fraction;

  // Avanzar índice para el siguiente ciclo
  if (velocidad > 0) {
    bus.stepIndex = nextIdx;
  }

  return {
    imei: bus.imei,
    placa: bus.placa,
    ruta: bus.ruta,
    padron: bus.padron,
    latitud: Math.round(lat * 1000000) / 1000000,
    longitud: Math.round(lon * 1000000) / 1000000,
    altitud: 145.0 + Math.round(Math.random() * 10),
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
function sendTelemetry(payload) {
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
      resolve({ error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

let cycle = 0;
async function runCycle() {
  cycle++;
  console.log(`\n================== Ciclo de Simulación #${cycle} (${new Date().toLocaleTimeString()}) ==================`);

  for (const bus of FLEET) {
    const telemetry = advanceBus(bus, cycle);
    const res = await sendTelemetry(telemetry);

    if (res.error) {
      console.log(`❌ [${bus.placa}] Error conectando a Gateway: ${res.error}`);
    } else {
      const estado = telemetry.velocidad > 5 ? 'EN MARCHA' : (telemetry.ignicion === 1 ? 'DETENIDO CON MOTOR ENCENDIDO' : 'MOTOR APAGADO');
      
      // Mostrar la trama JSON reglamentaria exacta enviada a la ATU
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
      console.log(`>> Estado: ${estado} (${telemetry.velocidad} km/h) | Rumbo: ${telemetry.rumbo}° | Gateway HTTP: ${res.statusCode} OK`);
      console.log(`----------------------------------------------------------------------`);
    }
  }

  console.log(`\n⏳ Próximo reporte de telemetría en ${INTERVAL_SEC} segundos...`);
}

// Iniciar simulación periódica
console.log(`🚌 Iniciando Simulador de Flota OpenSICM`);
console.log(`📍 Unidades simuladas: ${FLEET.length}`);
console.log(`🎯 URL de Ingesta:     ${TARGET_URL}`);
console.log(`⏱️  Frecuencia:         Cada ${INTERVAL_SEC} segundos`);
console.log(`----------------------------------------------------------------------`);

runCycle();
const timer = setInterval(runCycle, INTERVAL_SEC * 1000);

// Manejo de detención limpia
process.on('SIGINT', () => {
  clearInterval(timer);
  console.log('\n[Simulador] Detenido por el usuario.');
  process.exit(0);
});
