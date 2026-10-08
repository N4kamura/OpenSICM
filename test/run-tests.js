/**
 * OpenSICM - Suite de Pruebas Automatizadas Integrales
 * Verifica la validación, normalización de tramas ATU, servidor Mock y forwarder WebSocket.
 */
const http = require('http');
const assert = require('assert');
const { validateAndNormalize, normalizePlaca, normalizeImei, normalizeTimestamp } = require('../src/validator');
const stateManager = require('../src/state-manager');

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 INICIANDO SUITE DE PRUEBAS DE OPENSICM');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // --- 1. PRUEBAS UNITARIAS DE VALIDACIÓN Y NORMALIZACIÓN ---
  console.log('--- 1. Pruebas de Validación y Normalización ATU ---');

  test('normalizePlaca: limpia guiones y valida 6 caracteres', () => {
    assert.strictEqual(normalizePlaca('A1B-789'), 'A1B789');
    assert.strictEqual(normalizePlaca(' bc 1023 '), 'BC1023');
    assert.strictEqual(normalizePlaca('XYZ12'), null); // muy corto
    assert.strictEqual(normalizePlaca('TOOLONG123'), null); // muy largo
    assert.strictEqual(normalizePlaca(null), null);
  });

  test('normalizeImei: valida y normaliza 15 dígitos', () => {
    assert.strictEqual(normalizeImei('864201041234567'), '864201041234567');
    assert.strictEqual(normalizeImei('864-201-041-234-567'), '864201041234567');
    assert.strictEqual(normalizeImei('12345'), null); // muy corto
  });

  test('normalizeTimestamp: convierte milisegundos a segundos epoch POSIX', () => {
    const ms = 1717200000000;
    assert.strictEqual(normalizeTimestamp(ms), 1717200000);
    assert.strictEqual(normalizeTimestamp(1717200000), 1717200000);
  });

  test('validateAndNormalize: genera trama según especificación ATU sección 6', () => {
    const input = {
      imei: '864201041234567',
      placa: 'A1B-789',
      ruta: 'IO33B',
      latitud: -12.046374,
      longitud: -77.042793,
      altitud: 154.2,
      velocidad: 32.5,
      rumbo: 180.0,
      timestamp: 1717200000,
      evento: 'POSICION_PERIODICA',
      ignicion: 1,
      modeloGps: 'TELTONIKA_FMB920'
    };

    const res = validateAndNormalize(input);
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.atuPayload.placa, 'A1B789');
    assert.strictEqual(res.atuPayload.imei, '864201041234567');
    assert.strictEqual(res.atuPayload.latitud, -12.046374);
    assert.strictEqual(res.atuPayload.longitud, -77.042793);
    assert.strictEqual(res.atuPayload.velocidad, 32.5);
    assert.strictEqual(res.atuPayload.rumbo, 180.0);
    assert.strictEqual(res.atuPayload.timestamp, 1717200000);
    assert.strictEqual(res.atuPayload.ignicion, 1);
  });

  test('validateAndNormalize: rechaza coordenadas inválidas o nulas', () => {
    const res1 = validateAndNormalize({ placa: 'A1B789', imei: '864201041234567', latitud: 0, longitud: 0 });
    assert.strictEqual(res1.isValid, false);

    const res2 = validateAndNormalize({ placa: 'A1B789', imei: '864201041234567', latitud: 95.0, longitud: -77.0 });
    assert.strictEqual(res2.isValid, false);
  });

  // --- 2. PRUEBAS DE STATE MANAGER ---
  console.log('\n--- 2. Pruebas de Administrador de Flota en Memoria ---');

  test('stateManager: actualiza telemetría y evalúa estado operacional', () => {
    // Bus en marcha
    stateManager.updateBusTelemetry({
      placa: 'A1B789',
      velocidad: 25.0,
      ignicion: 1,
      timestamp: Math.floor(Date.now() / 1000)
    });
    let bus = stateManager.getBus('A1B789');
    assert.strictEqual(bus.estadoOperacional, 'MOVIMIENTO');

    // Bus detenido con motor encendido
    stateManager.updateBusTelemetry({
      placa: 'A1B789',
      velocidad: 0.0,
      ignicion: 1,
      timestamp: Math.floor(Date.now() / 1000)
    });
    bus = stateManager.getBus('A1B789');
    assert.strictEqual(bus.estadoOperacional, 'DETENIDO');

    // Bus apagado
    stateManager.updateBusTelemetry({
      placa: 'A1B789',
      velocidad: 0.0,
      ignicion: 0,
      timestamp: Math.floor(Date.now() / 1000)
    });
    bus = stateManager.getBus('A1B789');
    assert.strictEqual(bus.estadoOperacional, 'OFFLINE');
  });

  // --- 2b. PRUEBAS DE FLOTA EN SQLITE Y MOTOR DE KPIS ---
  console.log('\n--- 2b. Pruebas de Flota en SQLite y Motor de KPIs (Sin GTFS) ---');

  const fleetStore = require('../src/fleet-store');
  const kpiEngine = require('../src/kpi-engine');

  test('fleetStore (SQLite): persiste y recupera unidades correctamente', () => {
    const saveRes = fleetStore.saveUnit({
      placa: 'SQL999',
      ruta: 'IO33B',
      padron: '99',
      imei: '864201049999999',
      modeloGps: 'TELTONIKA_FMB920',
      notas: 'Unidad de test SQLite'
    });
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.unit.placa, 'SQL999');

    const found = fleetStore.getByPlaca('SQL999');
    assert.ok(found);
    assert.strictEqual(found.padron, '99');
    assert.strictEqual(found.tieneGps, true);

    // Asignar nueva ruta
    const routeRes = fleetStore.assignRoute('SQL999', 'CR42');
    assert.strictEqual(routeRes.success, true);
    assert.strictEqual(routeRes.unit.ruta, 'CR42');

    // Limpiar unidad de prueba
    fleetStore.deleteUnit('SQL999');
    assert.strictEqual(fleetStore.getByPlaca('SQL999'), null);
  });

  test('kpiEngine: acumula odometría en km (Haversine) y horas de motor', () => {
    const t0 = Math.floor(Date.now() / 1000) - 60;
    // Punto 1: Óvalo Monitor (-12.083812, -76.971038)
    kpiEngine.processTelemetry({
      placa: 'KPIT01',
      ruta: 'IO33B',
      padron: '11',
      latitud: -12.083812,
      longitud: -76.971038,
      velocidad: 30.0,
      ignicion: 1,
      timestamp: t0
    });

    // Punto 2: ~0.42 km al suroeste en Av. Javier Prado (-12.085500, -76.974500) 30s después
    kpiEngine.processTelemetry({
      placa: 'KPIT01',
      ruta: 'IO33B',
      padron: '11',
      latitud: -12.085500,
      longitud: -76.974500,
      velocidad: 45.0,
      ignicion: 1,
      timestamp: t0 + 30
    });

    const kpi = kpiEngine.getOrCreateUnitKpi('KPIT01');
    assert.ok(kpi.kmRecorridos >= 0.3, `Odometría debe haber acumulado distancia (>= 0.3 km), actual: ${kpi.kmRecorridos}`);
    assert.ok(kpi.segundosMotor >= 30, `Segundos motor debe acumular tiempo, actual: ${kpi.segundosMotor}`);
    assert.strictEqual(kpi.tramasEnviadas, 2);
  });

  test('kpiEngine: calcula ITE % al recibir ACK de la ATU', () => {
    kpiEngine.recordAtuAck({ placa: 'KPIT01', timestamp: Math.floor(Date.now() / 1000) });
    const formatted = kpiEngine.formatUnitKpi(kpiEngine.getOrCreateUnitKpi('KPIT01'));
    // 2 enviadas, 1 confirmada -> 50%
    assert.strictEqual(formatted.itePorcentaje, 50.0);
  });

  test('kpiEngine: detecta blackout si se supera el lapso de 90 segundos con motor encendido', () => {
    const tLast = Math.floor(Date.now() / 1000) - 200;
    kpiEngine.processTelemetry({
      placa: 'KPIT02',
      ruta: 'IO33B',
      latitud: -12.046374,
      longitud: -77.042793,
      velocidad: 20.0,
      ignicion: 1,
      timestamp: tLast
    });

    // Reporte 120 segundos después (> 90s)
    kpiEngine.processTelemetry({
      placa: 'KPIT02',
      ruta: 'IO33B',
      latitud: -12.046500,
      longitud: -77.042900,
      velocidad: 22.0,
      ignicion: 1,
      timestamp: tLast + 120
    });

    const kpi = kpiEngine.getOrCreateUnitKpi('KPIT02');
    assert.ok(kpi.blackoutsCount >= 1, 'Debe haber contabilizado al menos 1 blackout');

    const alerts = kpiEngine.getAlerts(10);
    const hasBlackoutAlert = alerts.some(a => a.tipo === 'BLACKOUT_GPS' && a.placa === 'KPIT02');
    assert.ok(hasBlackoutAlert, 'Debe existir una alerta de blackout para KPIT02');
  });

  test('kpiEngine.getSummary: genera métricas consolidadas de la flota', () => {
    const summary = kpiEngine.getSummary();
    assert.ok(typeof summary.totalKm === 'number');
    assert.ok(typeof summary.totalHorasMotor === 'number');
    assert.ok(typeof summary.iteGlobal === 'number');
    assert.ok(typeof summary.disponibilidadFlota === 'number');
    assert.ok(typeof summary.esHoraPunta === 'boolean');
  });

  // --- 2c. PRUEBAS DE GTFS STORE Y EXPORTADOR CSV ---
  console.log('\n--- 2c. Pruebas de GTFS Store (SQLite) y Exportador CSV ---');
  const gtfsStore = require('../src/gtfs-store');

  test('gtfsStore: inicializa datos base de demostración para Lima', () => {
    const agency = gtfsStore.getAgency();
    assert.ok(agency);
    assert.strictEqual(agency.agency_timezone, 'America/Lima');

    const routes = gtfsStore.getRoutes();
    assert.ok(routes.length >= 1, 'Debe contener al menos una ruta en SQLite');

    const stops = gtfsStore.getStops();
    assert.ok(stops.length >= 1, 'Debe contener paraderos en SQLite');

    const shapes = gtfsStore.getShapeList();
    assert.ok(shapes.length >= 1, 'Debe contener trazos en SQLite');
  });

  test('gtfsStore: gestiona empresa (agency.txt) guardar y restablecer', () => {
    const saveRes = gtfsStore.saveAgency({
      agency_id: 'TEST_EMP',
      agency_name: 'Empresa Test S.A.',
      agency_url: 'https://test.atu.gob.pe',
      agency_timezone: 'America/Lima'
    });
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(gtfsStore.getAgency().agency_name, 'Empresa Test S.A.');

    gtfsStore.deleteAgency('TEST_EMP');
    // Restaurar por defecto
    gtfsStore.saveAgency({
      agency_id: 'EMP_LIMA',
      agency_name: 'Empresa de Transportes Lima & Callao S.A.',
      agency_url: 'https://atu.gob.pe',
      agency_timezone: 'America/Lima'
    });
    assert.strictEqual(gtfsStore.getAgency().agency_id, 'EMP_LIMA');
  });

  test('gtfsStore: guarda, recupera y elimina trazo geométrico (shapes.txt)', () => {
    const points = [
      { lat: -12.046374, lon: -77.042793 },
      { lat: -12.050000, lon: -77.045000 },
      { lat: -12.055000, lon: -77.050000 }
    ];
    const saveRes = gtfsStore.saveShape('TEST_SHAPE', points);
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.totalPoints, 3);

    const retrieved = gtfsStore.getShapePoints('TEST_SHAPE');
    assert.strictEqual(retrieved.length, 3);
    assert.strictEqual(retrieved[0].shape_pt_sequence, 1);

    const delRes = gtfsStore.deleteShape('TEST_SHAPE');
    assert.strictEqual(delRes.success, true);
    assert.strictEqual(gtfsStore.getShapePoints('TEST_SHAPE').length, 0);
  });

  test('gtfsStore: renombra trazo geométrico y actualiza clave', () => {
    gtfsStore.saveShape('TEST_RENAME_A', [{ lat: -12.01, lon: -77.01 }]);
    const res = gtfsStore.renameShape('TEST_RENAME_A', 'TEST_RENAME_B');
    assert.strictEqual(res.success, true);
    assert.strictEqual(gtfsStore.getShapePoints('TEST_RENAME_B').length, 1);
    assert.strictEqual(gtfsStore.getShapePoints('TEST_RENAME_A').length, 0);
    gtfsStore.deleteShape('TEST_RENAME_B');
  });

  test('gtfsStore: permite trazar Ida y Vuelta independientes conectando fin e inicio', () => {
    // 1. Ida: desde Punto A (-12.08, -76.97) hasta Punto B (-12.09, -77.02)
    const ptsIda = [
      { lat: -12.083812, lon: -76.971038 },
      { lat: -12.087200, lon: -76.978200 },
      { lat: -12.091215, lon: -77.026478 }
    ];
    gtfsStore.saveShape('TEST_IDA', ptsIda);

    // 2. Vuelta: inicia en el último punto de la Ida (B) y finaliza en el primer punto (A)
    const lastIdaPt = ptsIda[ptsIda.length - 1];
    const firstIdaPt = ptsIda[0];
    const ptsVuelta = [
      { lat: lastIdaPt.lat, lon: lastIdaPt.lon },
      { lat: -12.088000, lon: -76.980000 },
      { lat: firstIdaPt.lat, lon: firstIdaPt.lon }
    ];
    gtfsStore.saveShape('TEST_VUELTA', ptsVuelta);

    const savedIda = gtfsStore.getShapePoints('TEST_IDA');
    const savedVuelta = gtfsStore.getShapePoints('TEST_VUELTA');

    // Verificar que la IDA quedó intacta
    assert.strictEqual(savedIda.length, 3);
    assert.strictEqual(savedIda[0].shape_pt_lat, ptsIda[0].lat);
    assert.strictEqual(savedIda[2].shape_pt_lat, ptsIda[2].lat);

    // Verificar que la VUELTA existe independientemente
    assert.strictEqual(savedVuelta.length, 3);
    assert.strictEqual(savedVuelta[0].shape_pt_lat, lastIdaPt.lat);
    assert.strictEqual(savedVuelta[2].shape_pt_lat, firstIdaPt.lat);

    // Limpieza
    gtfsStore.deleteShape('TEST_IDA');
    gtfsStore.deleteShape('TEST_VUELTA');
  });

  test('gtfsStore: gestiona frecuencias de despacho (frequencies.txt)', () => {
    const saveRes = gtfsStore.saveFrequency({
      trip_id: 'IO33B_IDA_PATTERN',
      start_time: '22:00:00',
      end_time: '23:30:00',
      headway_secs: 600
    });
    assert.strictEqual(saveRes.success, true);

    const freqs = gtfsStore.getFrequencies('IO33B_IDA_PATTERN');
    const nightFreq = freqs.find(f => f.start_time === '22:00:00');
    assert.ok(nightFreq);
    assert.strictEqual(nightFreq.headway_secs, 600);

    // Limpiar
    gtfsStore.deleteFrequency(nightFreq.id);
  });

  test('gtfsStore.exportCsv: genera archivos estándar GTFS en formato CSV', () => {
    gtfsStore.saveShape('TEST_CSV_SHAPE', [
      { lat: -12.083812, lon: -76.971038 },
      { lat: -12.085500, lon: -76.974500 }
    ]);
    const csvShapes = gtfsStore.exportCsv('shapes.txt');
    assert.ok(csvShapes.includes('shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence'));
    assert.ok(csvShapes.includes('TEST_CSV_SHAPE'));
    gtfsStore.deleteShape('TEST_CSV_SHAPE');

    gtfsStore.saveStop({
      stop_id: 'TEST_CSV_STOP',
      stop_name: 'Paradero Test CSV',
      stop_lat: -12.083812,
      stop_lon: -76.971038,
      location_type: 0
    });
    const csvStops = gtfsStore.exportCsv('stops.txt');
    assert.ok(csvStops.includes('stop_id,stop_name,stop_lat,stop_lon,location_type'));
    assert.ok(csvStops.includes('TEST_CSV_STOP'));
    gtfsStore.deleteStop('TEST_CSV_STOP');

    const csvRoutes = gtfsStore.exportCsv('routes.txt');
    assert.ok(csvRoutes.includes('route_id,agency_id,route_short_name,route_long_name,route_type'));
    assert.ok(csvRoutes.includes('IO33B'));

    const csvFreqs = gtfsStore.exportCsv('frequencies.txt');
    assert.ok(csvFreqs.includes('trip_id,start_time,end_time,headway_secs'));

    assert.strictEqual(gtfsStore.exportCsv('desconocido.txt'), null);
  });

  // --- 3. PRUEBA INTEGRAL EXTREMO A EXTREMO (MOCK ATU + GATEWAY + REST) ---
  console.log('\n--- 3. Prueba Integral de Enlace WebSocket y API REST ---');

  await testAsync('End-to-End: Ingesta REST -> Gateway -> Mock ATU WS con confirmación ACK', async () => {
    const mockAtu = require('./mock-atu-server');
    const { server, start, processIncomingTelemetry } = require('../src/server');
    const atuForwarder = require('../src/atu-forwarder');

    let mockStartedByTest = false;
    try {
      await new Promise((resolve, reject) => {
        mockAtu.server.once('error', reject);
        mockAtu.server.listen(5000, () => {
          mockStartedByTest = true;
          resolve();
        });
      });
      console.log('    [Test] Mock ATU escuchando en puerto 5000');
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        console.log('    [Test] Servidor Mock ATU ya está activo en puerto 5000 (reutilizando enlace)');
      } else {
        throw err;
      }
    }

    // Iniciar OpenSICM si no está ya iniciado
    let serverStartedByTest = false;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        start();
        setTimeout(() => {
          serverStartedByTest = true;
          resolve();
        }, 600);
      });
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        console.log('    [Test] Gateway OpenSICM ya está activo en puerto 3000 (reutilizando instancia)');
      } else {
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 600));

    // Inyectar telemetría
    const res = processIncomingTelemetry({
      imei: '864201041234567',
      placa: 'TEST01',
      ruta: 'IO33B',
      latitud: -12.046374,
      longitud: -77.042793,
      velocidad: 35.0,
      rumbo: 90.0,
      ignicion: 1,
      timestamp: Math.floor(Date.now() / 1000),
      modeloGps: 'TELTONIKA_FMB920'
    });

    assert.strictEqual(res.success, true);

    // Esperar intercambio WS y recepción de ACK
    await new Promise((resolve) => setTimeout(resolve, 800));

    const metrics = atuForwarder.getMetrics();
    assert.ok(metrics.sentCount >= 1, 'Debe haber enviado al menos 1 trama');

    // Comprobar estado en stateManager
    const updatedBus = stateManager.getBus('TEST01');
    assert.ok(updatedBus, 'El bus TEST01 debe existir en stateManager');

    // Cerrar servidores de prueba solo si fueron iniciados por el runner
    if (serverStartedByTest) {
      atuForwarder.stop();
      await new Promise((resolve) => server.close(resolve));
    }
    if (mockStartedByTest) {
      await new Promise((resolve) => mockAtu.server.close(resolve));
    }
  });

  console.log('\n===============================================================');
  console.log(`🏁 RESULTADO: ${passed} pasadas, ${failed} fallidas`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
