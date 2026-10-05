/**
 * OpenSICM - Gateway Open Source GPS - SICM ATU
 * Servidor Principal HTTP / SSE / REST e Ingesta
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { validateAndNormalize } = require('./validator');
const stateManager = require('./state-manager');
const atuForwarder = require('./atu-forwarder');
const tcpIngest = require('./ingest/tcp-ingest');
const fleetStore = require('./fleet-store');

// Mapa de Clientes SSE activos
const sseClients = new Set();

/**
 * Difunde un mensaje SSE a todos los navegadores conectados
 * @param {string} event 
 * @param {Object} data 
 */
function broadcastSse(event, data) {
  if (sseClients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Procesa una trama de telemetría entrante (REST o TCP)
 * @param {Object} rawData 
 * @returns {{ success: boolean, error?: string, bus?: Object }}
 */
function processIncomingTelemetry(rawData) {
  // Si viene con IMEI pero sin placa/ruta (típico de GPS físico Teltonika/Suntech), mapear automáticamente
  if (rawData.imei && (!rawData.placa || !rawData.ruta)) {
    const assigned = fleetStore.getByImei(rawData.imei);
    if (assigned) {
      rawData.placa = rawData.placa || assigned.placa;
      rawData.ruta = rawData.ruta || assigned.ruta;
      rawData.padron = rawData.padron || assigned.padron;
      rawData.modeloGps = rawData.modeloGps || assigned.modeloGps;
    }
  }

  const result = validateAndNormalize(rawData);
  if (!result.isValid) {
    return { success: false, error: result.error };
  }

  const { atuPayload, internalState } = result;

  // 1. Actualizar estado de la unidad en memoria
  const updatedBus = stateManager.updateBusTelemetry(internalState);

  // 2. Enviar a la ATU a través del forwarder WebSocket
  atuForwarder.sendPayload(atuPayload);

  // 3. Notificar en tiempo real al visualizador web vía SSE
  broadcastSse('telemetry', updatedBus);

  return { success: true, bus: updatedBus, atuPayload };
}

// Escuchar telemetría que ingrese por TCP
tcpIngest.on('telemetry', (raw) => {
  processIncomingTelemetry(raw);
});

// Escuchar cambios de estado en el enlace ATU para notificar a la interfaz
atuForwarder.on('status_change', (data) => {
  broadcastSse('atu_status', data);
});

atuForwarder.on('frame_ack', (ack) => {
  broadcastSse('atu_ack', ack);
});

// Servidor HTTP
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS headers para permitir consumo desde integradores externos
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- RUTAS DE API ---

  // 1. Healthcheck
  if (method === 'GET' && pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', uptime: process.uptime(), time: new Date().toISOString() }));
    return;
  }

  // 2. Estado General del Gateway y Flota
  if (method === 'GET' && pathname === '/api/status') {
    const payload = {
      enlaceAtu: atuForwarder.getMetrics(),
      flota: stateManager.getFleetStats(),
      config: {
        frecuenciaTransmision: config.TRANSMIT_INTERVAL_SEC,
        puertoGpsTcp: config.GPS_INGEST_PORT,
        endpointAtu: config.ATU_WS_ENDPOINT
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  // 3. Lista de Unidades
  if (method === 'GET' && pathname === '/api/buses') {
    const buses = stateManager.getAllBuses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buses));
    return;
  }

  // 4. Server-Sent Events (SSE) para actualización en tiempo real del frontend
  if (method === 'GET' && pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');

    // Enviar snapshot inicial al conectarse
    const initData = {
      atu: atuForwarder.getMetrics(),
      stats: stateManager.getFleetStats(),
      buses: stateManager.getAllBuses()
    };
    res.write(`event: init\ndata: ${JSON.stringify(initData)}\n\n`);

    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 5. Ingesta REST Individual: POST /api/telemetria
  if (method === 'POST' && pathname === '/api/telemetria') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Prevenir payload gigante
      if (body.length > 1024 * 64) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        const result = processIncomingTelemetry(json);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'OK', placa: result.bus.placa, atuStatus: result.bus.atuStatus }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', error: result.error }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'JSON malformado' }));
      }
    });
    return;
  }

  // 6. Ingesta REST Batch (Lote de posiciones): POST /api/telemetria/batch
  if (method === 'POST' && pathname === '/api/telemetria/batch') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 512) req.destroy();
    });

    req.on('end', () => {
      try {
        const list = JSON.parse(body);
        if (!Array.isArray(list)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', error: 'El cuerpo debe ser un arreglo de tramas' }));
          return;
        }

        const results = list.map(item => processIncomingTelemetry(item));
        const accepted = results.filter(r => r.success).length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'OK', procesados: list.length, aceptados: accepted }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'JSON malformado' }));
      }
    });
    return;
  }

  // 7. Gestión de Flota e Inventario GPS: GET /api/fleet
  if (method === 'GET' && pathname === '/api/fleet') {
    const units = fleetStore.getAll();
    const stats = fleetStore.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ units, stats }));
    return;
  }

  // 8. Crear o Actualizar Unidad en Flota: POST /api/fleet
  if (method === 'POST' && pathname === '/api/fleet') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        const result = fleetStore.saveUnit(json);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'OK', unit: result.unit }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', error: result.error }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'JSON malformado' }));
      }
    });
    return;
  }

  // 9. Asignar GPS a Unidad: POST /api/fleet/assign
  if (method === 'POST' && pathname === '/api/fleet/assign') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { placa, imei, modeloGps } = JSON.parse(body);
        const result = fleetStore.assignGps(placa, imei, modeloGps);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'OK', unit: result.unit }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', error: result.error }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'JSON malformado' }));
      }
    });
    return;
  }

  // 10. Desasignar GPS de Unidad: POST /api/fleet/unassign
  if (method === 'POST' && pathname === '/api/fleet/unassign') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { placa } = JSON.parse(body);
        const result = fleetStore.unassignGps(placa);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'OK', unit: result.unit }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', error: result.error }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'JSON malformado' }));
      }
    });
    return;
  }

  // 11. Eliminar Unidad: POST /api/fleet/delete
  if (method === 'POST' && pathname === '/api/fleet/delete') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { placa } = JSON.parse(body);
        const result = fleetStore.deleteUnit(placa);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'OK' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', error: result.error }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'JSON malformado' }));
      }
    });
    return;
  }

  // 12. Banco de Pruebas ATU: POST /api/test/telemetria
  if (method === 'POST' && pathname === '/api/test/telemetria') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        const result = processIncomingTelemetry(json);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'OK',
            valido: true,
            atuPayload: result.atuPayload,
            enviadoAtu: atuForwarder.status === 'CONECTADO',
            enlaceAtu: atuForwarder.status,
            metricas: atuForwarder.getMetrics()
          }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', valido: false, error: result.error }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'JSON malformado' }));
      }
    });
    return;
  }

  // --- SERVIDOR DE ARCHIVOS ESTÁTICOS (Vanilla Frontend) ---
  let filePath = pathname === '/' ? '/index.html' : pathname;
  // Seguridad: evitar directory traversal
  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(__dirname, '../public', safePath);

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Recurso no encontrado');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);
  });
});

// Iniciar servicios
function start() {
  server.listen(config.HTTP_PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 OpenSICM Gateway iniciado exitosamente`);
    console.log(`🌐 Dashboard Web y API: http://localhost:${config.HTTP_PORT}`);
    console.log(`📡 Ingesta GPS TCP:      Puerto ${config.GPS_INGEST_PORT}`);
    console.log(`🎯 Enlace ATU WebSocket: ${config.ATU_WS_ENDPOINT}`);
    console.log(`⏱️  Frecuencia ATU:       Cada ${config.TRANSMIT_INTERVAL_SEC} segundos`);
    console.log(`=======================================================`);
  });

  // Iniciar ingesta TCP para GPS físicos
  tcpIngest.start();

  // Iniciar cliente WebSocket hacia ATU
  atuForwarder.connect();
}

// Manejo de apagado graceful
function shutdown(signal) {
  console.log(`\n[OpenSICM] Recibida señal ${signal}. Cerrando ordenadamente...`);
  tcpIngest.stop();
  atuForwarder.stop();
  server.close(() => {
    console.log('[OpenSICM] Servidor cerrado. Proceso terminado con éxito.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  start();
}

module.exports = { server, start, shutdown, processIncomingTelemetry };
