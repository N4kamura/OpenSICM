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
