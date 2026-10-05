/**
 * OpenSICM - Servidor Mock de Pruebas SICM ATU
 * Simula el receptor WebSocket oficial de la ATU para pruebas locales extremo a extremo.
 */
const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.env.MOCK_ATU_PORT || '5000', 10);
const EXPECTED_TOKEN = process.env.ATU_COMPANY_TOKEN || 'TOKEN_EMPRESA_DEMO_2026';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OpenSICM - Mock Receptor ATU Activo');
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  console.log(`[Mock ATU] Intento de conexión WS desde ${request.socket.remoteAddress}. Token recibido: "${token}"`);

  // Validación básica del token
  if (!token) {
    console.warn(`[Mock ATU] Conexión rechazada: Falta token de empresa`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

let totalReceived = 0;

wss.on('connection', (ws, request) => {
  console.log(`[Mock ATU] Cliente conectado exitosamente.`);

  ws.on('message', (data) => {
    totalReceived++;
    try {
      const msg = JSON.parse(data.toString());
      
      // Validación de campos reglamentarios según Especificación Técnica ATU
      const missingFields = [];
      const required = ['imei', 'placa', 'ruta', 'latitud', 'longitud', 'velocidad', 'rumbo', 'timestamp', 'evento', 'ignicion', 'modeloGps'];
      
      for (const field of required) {
        if (msg[field] === undefined || msg[field] === null) {
          missingFields.push(field);
        }
      }

      if (missingFields.length > 0) {
        console.error(`[Mock ATU] ❌ TRAMA INVÁLIDA de Placa: ${msg.placa || 'DESCONOCIDA'}. Faltan campos: ${missingFields.join(', ')}`);
        ws.send(JSON.stringify({
          status: 'NACK',
          placa: msg.placa,
          error: `Campos faltantes: ${missingFields.join(', ')}`,
          timestamp: Date.now()
        }));
        return;
      }

      // Validar tipos
      if (typeof msg.latitud !== 'number' || typeof msg.longitud !== 'number') {
        console.error(`[Mock ATU] ❌ Coordenadas deben ser numéricas WGS84: lat=${msg.latitud}, lon=${msg.longitud}`);
        return;
      }

      console.log(`[Mock ATU] ✅ TRAMA #${totalReceived} ACEPTADA | Placa: ${msg.placa.padEnd(7)} | Ruta: ${msg.ruta.padEnd(6)} | Vel: ${String(msg.velocidad).padStart(4)} km/h | Lat: ${msg.latitud} | Lon: ${msg.longitud}`);

      // Enviar confirmación ACK a la pasarela
      ws.send(JSON.stringify({
        status: 'ACK',
        placa: msg.placa,
        timestamp: msg.timestamp,
        receivedAt: Math.floor(Date.now() / 1000)
      }));

    } catch (err) {
      console.error(`[Mock ATU] ❌ Error procesando JSON recibido:`, err.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[Mock ATU] Cliente desconectado (Código: ${code})`);
  });

  ws.on('error', (err) => {
    console.error(`[Mock ATU] Error en socket:`, err.message);
  });
});

function startMock(cb) {
  server.listen(PORT, () => {
    console.log(`[Mock ATU] Servidor Receptor ATU simulado en ws://localhost:${PORT}/ws`);
    if (cb) cb();
  });
  return server;
}

if (require.main === module) {
  startMock();
}

module.exports = { server, startMock, wss };
