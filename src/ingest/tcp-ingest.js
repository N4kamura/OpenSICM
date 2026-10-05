/**
 * OpenSICM - Receptor GPS TCP Multiprotocolo Ligero
 * Soporta Teltonika (Codec 8/8E), Suntech (ST300/ST310/ST340 ASCII) y tramas genéricas JSON.
 */
const net = require('net');
const EventEmitter = require('events');
const config = require('../config');
const { validateAndNormalize } = require('../validator');

class TcpGpsIngest extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.activeSockets = new Set();
  }

  start() {
    if (!config.GPS_TCP_ENABLED) {
      console.log('[GPS TCP] Ingesta TCP desactivada por configuración.');
      return;
    }

    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.on('error', (err) => {
      console.error('[GPS TCP] Error en servidor TCP:', err.message);
    });

    this.server.listen(config.GPS_INGEST_PORT, () => {
      console.log(`[GPS TCP] Servidor de ingesta GPS escuchando en puerto TCP ${config.GPS_INGEST_PORT}`);
    });
  }

  handleConnection(socket) {
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    let socketImei = null;
    let buffer = Buffer.alloc(0);

    this.activeSockets.add(socket);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        // 1. Intento de parseo como Teltonika
        if (this.isTeltonikaPacket(buffer, socketImei)) {
          const result = this.parseTeltonika(buffer, socketImei, socket);
          if (result) {
            buffer = result.remainingBuffer;
            if (result.imei) socketImei = result.imei;
            if (result.records && result.records.length > 0) {
              result.records.forEach((rec) => this.processTelemetry(rec));
            }
          }
          return;
        }

        // 2. Intento de parseo como Suntech ASCII (terminado en \r o \n)
        const strData = buffer.toString('ascii');
        if (strData.includes('\r') || strData.includes('\n')) {
          const lines = strData.split(/[\r\n]+/);
          // La última línea puede estar incompleta
          const incomplete = lines.pop();
          buffer = Buffer.from(incomplete, 'ascii');

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            if (trimmed.startsWith('ST3') || trimmed.startsWith('ST4')) {
              const rec = this.parseSuntech(trimmed);
              if (rec) this.processTelemetry(rec);
            } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
              // Generic JSON line
              try {
                const jsonRec = JSON.parse(trimmed);
                this.processTelemetry(jsonRec);
              } catch (e) {
                // Ignore malformed JSON
              }
            }
          }
          return;
        }

        // 3. Intento de parseo como JSON directo
        const fullText = buffer.toString('utf8').trim();
        if (fullText.startsWith('{') && fullText.endsWith('}')) {
          try {
            const jsonRec = JSON.parse(fullText);
            this.processTelemetry(jsonRec);
            buffer = Buffer.alloc(0);
          } catch {
            // Buffer incompleto, esperar más bytes
          }
        }
      } catch (err) {
        console.warn(`[GPS TCP] Error procesando buffer de ${remoteAddress}:`, err.message);
        // Si el buffer crece demasiado sin resolución, vaciar para prevenir DoS
        if (buffer.length > 8192) buffer = Buffer.alloc(0);
      }
    });

    socket.on('close', () => {
      this.activeSockets.delete(socket);
    });

    socket.on('error', (err) => {
      // Manejar desconexiones abruptas sin romper el servidor
      this.activeSockets.delete(socket);
    });
  }

  isTeltonikaPacket(buf, socketImei) {
    if (!socketImei && buf.length >= 2) {
      const imeiLen = buf.readUInt16BE(0);
      return imeiLen > 0 && imeiLen <= 17;
    }
    if (socketImei && buf.length >= 4) {
      return buf.readUInt32BE(0) === 0x00000000;
    }
    return false;
  }

  /**
   * Parser básico de protocolo Teltonika Codec 8
   */
  parseTeltonika(buf, currentImei, socket) {
    // Fase 1: Handshake de IMEI
    if (!currentImei) {
      if (buf.length < 2) return null;
      const imeiLen = buf.readUInt16BE(0);
      if (buf.length < 2 + imeiLen) return null; // esperar más bytes

      const imei = buf.slice(2, 2 + imeiLen).toString('ascii');
      // Responder 0x01 (Aceptar conexión)
      socket.write(Buffer.from([0x01]));
      return {
        imei,
        records: [],
        remainingBuffer: buf.slice(2 + imeiLen)
      };
    }

    // Fase 2: Paquete de datos AVL (Codec 8)
    if (buf.length < 12) return null; // Preamble (4) + Data Length (4) + Codec ID (1) + Rec Count (1) ...
    const preamble = buf.readUInt32BE(0);
    if (preamble !== 0) {
      // Desincronización, buscar siguiente 0x00000000
      const nextZero = buf.indexOf(Buffer.from([0, 0, 0, 0]), 1);
      return { imei: currentImei, records: [], remainingBuffer: nextZero !== -1 ? buf.slice(nextZero) : Buffer.alloc(0) };
    }

    const dataLength = buf.readUInt32BE(4);
    const totalPacketSize = 8 + dataLength + 4; // 8 header + data + 4 CRC
    if (buf.length < totalPacketSize) return null; // Esperar paquete completo

    const codecId = buf.readUInt8(8);
    const recordCount = buf.readUInt8(9);
    const records = [];

    // Parsear registros AVL simples si es Codec 8 (0x08)
    if (codecId === 0x08) {
      let offset = 10;
      for (let i = 0; i < recordCount; i++) {
        if (offset + 24 > totalPacketSize - 4) break;
        // Timestamp (8 bytes ms)
        const tsMs = Number(buf.readBigUInt64BE(offset));
        offset += 8;
        // Priority (1 byte)
        offset += 1;
        // Longitude (4 bytes signed int / 10000000)
        const lon = buf.readInt32BE(offset) / 10000000.0;
        offset += 4;
        // Latitude (4 bytes signed int / 10000000)
        const lat = buf.readInt32BE(offset) / 10000000.0;
        offset += 4;
        // Altitude (2 bytes signed int)
        const alt = buf.readInt16BE(offset);
        offset += 2;
        // Angle/Rumbo (2 bytes unsigned int)
        const rumbo = buf.readUInt16BE(offset);
        offset += 2;
        // Satellites (1 byte)
        const sats = buf.readUInt8(offset);
        offset += 1;
        // Speed (2 bytes unsigned int km/h)
        const speed = buf.readUInt16BE(offset);
        offset += 2;

        // Saltar IO elements para llegar al siguiente registro
        if (offset < totalPacketSize - 4) {
          const eventId = buf.readUInt8(offset);
          offset += 1;
          const totalIo = buf.readUInt8(offset);
          offset += 1;
          
          let ignicion = 1; // default encendido si hay movimiento
          // 1-byte IOs
          const cnt1 = buf.readUInt8(offset); offset += 1;
          for (let j = 0; j < cnt1; j++) {
            const ioId = buf.readUInt8(offset); offset += 1;
            const ioVal = buf.readUInt8(offset); offset += 1;
            if (ioId === 239 || ioId === 1) ignicion = ioVal; // 239 suele ser ignición ACC
          }
          // 2-byte IOs
          const cnt2 = buf.readUInt8(offset); offset += 1;
          offset += cnt2 * 3;
          // 4-byte IOs
          const cnt4 = buf.readUInt8(offset); offset += 1;
          offset += cnt4 * 5;
          // 8-byte IOs
          const cnt8 = buf.readUInt8(offset); offset += 1;
          offset += cnt8 * 9;

          records.push({
            imei: currentImei,
            latitud: lat,
            longitud: lon,
            altitud: alt,
            velocidad: speed,
            rumbo,
            timestamp: Math.floor(tsMs / 1000),
            ignicion,
            satelites: sats,
            modeloGps: 'TELTONIKA_FMB920'
          });
        }
      }
    }

    // Responder ACK con el número de registros aceptados (4 bytes big-endian)
    const ack = Buffer.alloc(4);
    ack.writeUInt32BE(recordCount, 0);
    socket.write(ack);

    return {
      imei: currentImei,
      records,
      remainingBuffer: buf.slice(totalPacketSize)
    };
  }

  /**
   * Parser para protocolo ASCII Suntech (ST300/ST310/ST340)
   * Formato típico: ST300STT;205200123;02;20261005;14:30:15;...;-12.046374;-77.042793;32.5;180.0;8;1;...
   */
  parseSuntech(line) {
    const parts = line.split(';');
    if (parts.length < 11) return null;

    const hdr = parts[0];
    const imei = parts[1];
    const dateStr = parts[3]; // YYYYMMDD
    const timeStr = parts[4]; // HH:MM:SS
    const lat = parseFloat(parts[6]);
    const lon = parseFloat(parts[7]);
    const speed = parseFloat(parts[8]);
    const course = parseFloat(parts[9]);
    const sats = parseInt(parts[10] || '8', 10);
    const ignicion = parts[14] ? (parts[14] === '1' ? 1 : 0) : 1;

    let timestamp = Math.floor(Date.now() / 1000);
    if (dateStr && timeStr && dateStr.length === 8) {
      const y = dateStr.slice(0, 4);
      const m = dateStr.slice(4, 6);
      const d = dateStr.slice(6, 8);
      const dt = new Date(`${y}-${m}-${d}T${timeStr}Z`);
      if (!isNaN(dt.getTime())) {
        timestamp = Math.floor(dt.getTime() / 1000);
      }
    }

    return {
      imei,
      latitud: lat,
      longitud: lon,
      velocidad: speed,
      rumbo: course,
      timestamp,
      satelites: sats,
      ignicion,
      modeloGps: hdr.includes('340') ? 'SUNTECH_ST340' : 'SUNTECH_ST310'
    };
  }

  processTelemetry(raw) {
    this.emit('telemetry', raw);
  }

  stop() {
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = new TcpGpsIngest();
