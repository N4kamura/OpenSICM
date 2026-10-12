/**
 * OpenSICM - Utilidad CLI para Envío de Tramas GPS de Prueba por TCP (Puerto 5001)
 * Emula la transmisión directa de hardware físico homologado (Suntech ASCII, JSON y Teltonika Codec 8)
 * 
 * Uso:
 *   node test/send-tcp-sample.js --protocol suntech
 *   node test/send-tcp-sample.js --protocol json
 *   node test/send-tcp-sample.js --protocol teltonika
 */
const net = require('net');

const args = process.argv.slice(2);
const protocolArgIdx = args.indexOf('--protocol');
const PROTOCOL = (protocolArgIdx !== -1 && args[protocolArgIdx + 1] ? args[protocolArgIdx + 1] : 'suntech').toLowerCase();

const imeiArgIdx = args.indexOf('--imei');
const IMEI = imeiArgIdx !== -1 && args[imeiArgIdx + 1] ? args[imeiArgIdx + 1] : '864201041234561';

const PORT = parseInt(process.env.GPS_INGEST_PORT || '5001', 10);
const HOST = process.env.GPS_INGEST_HOST || 'localhost';

const LAT = -12.083812;
const LON = -76.971038;
const SPEED = 36.5;
const RUMBO = 180.0;

console.log(`======================================================================`);
console.log(`📡 OpenSICM - Emulador de Dispositivo GPS Físico por TCP`);
console.log(`🎯 Destino:   ${HOST}:${PORT}`);
console.log(`📋 Protocolo: ${PROTOCOL.toUpperCase()}`);
console.log(`🔢 IMEI:      ${IMEI}`);
console.log(`======================================================================\n`);

function sendSuntechAscii() {
  const client = net.createConnection({ host: HOST, port: PORT }, () => {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const min = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');

    const dateStr = `${yyyy}${mm}${dd}`;
    const timeStr = `${hh}:${min}:${ss}`;

    // ST300STT;{imei};{mode};{date};{time};{cell};{lat};{lon};{speed};{course};{sats};...;{ignicion}\r\n
    const suntechFrame = `ST300STT;${IMEI};02;${dateStr};${timeStr};1020;${LAT};${LON};${SPEED};${RUMBO};9;0;0;0;1\r\n`;

    console.log(`[TCP Suntech] Enviando trama ASCII homologada:`);
    console.log(`>> ${suntechFrame.trim()}`);

    client.write(suntechFrame, () => {
      console.log(`[TCP Suntech] ✔ Trama transmitida exitosamente al puerto ${PORT}.`);
      setTimeout(() => {
        client.end();
        process.exit(0);
      }, 300);
    });
  });

  client.on('error', (err) => {
    console.error(`[TCP Suntech] ❌ Error de conexión: ${err.message}`);
    process.exit(1);
  });
}

function sendGenericJson() {
  const client = net.createConnection({ host: HOST, port: PORT }, () => {
    const payload = {
      imei: IMEI,
      latitud: LAT,
      longitud: LON,
      velocidad: SPEED,
      rumbo: RUMBO,
      altitud: 154.2,
      ignicion: 1,
      satelites: 8,
      timestamp: Math.floor(Date.now() / 1000)
    };

    const line = JSON.stringify(payload) + '\n';
    console.log(`[TCP JSON] Enviando payload JSON delimitado por salto de línea:`);
    console.log(JSON.stringify(payload, null, 2));

    client.write(line, () => {
      console.log(`[TCP JSON] ✔ Trama transmitida exitosamente al puerto ${PORT}.`);
      setTimeout(() => {
        client.end();
        process.exit(0);
      }, 300);
    });
  });

  client.on('error', (err) => {
    console.error(`[TCP JSON] ❌ Error de conexión: ${err.message}`);
    process.exit(1);
  });
}

function sendTeltonikaCodec8() {
  const client = net.createConnection({ host: HOST, port: PORT }, () => {
    console.log(`[TCP Teltonika] Fase 1: Enviando Handshake de IMEI...`);

    // 1. Handshake IMEI: 2 bytes longitud + caracteres ASCII del IMEI
    const imeiBuf = Buffer.from(IMEI, 'ascii');
    const handshakeBuf = Buffer.alloc(2 + imeiBuf.length);
    handshakeBuf.writeUInt16BE(imeiBuf.length, 0);
    imeiBuf.copy(handshakeBuf, 2);

    client.write(handshakeBuf);
  });

  let handshakeDone = false;

  client.on('data', (data) => {
    if (!handshakeDone) {
      if (data.length === 1 && data[0] === 0x01) {
        handshakeDone = true;
        console.log(`[TCP Teltonika] ✔ Handshake aceptado por el Gateway (Respuesta 0x01).`);
        console.log(`[TCP Teltonika] Fase 2: Transmitiendo paquete de datos AVL Codec 8...`);

        // Armar paquete AVL Codec 8
        const avlRecord = Buffer.alloc(45);
        let offset = 0;

        // Timestamp (8 bytes ms)
        avlRecord.writeBigUInt64BE(BigInt(Date.now()), offset); offset += 8;
        // Priority (1 byte)
        avlRecord.writeUInt8(0x00, offset); offset += 1;
        // Longitude (4 bytes signed int * 10,000,000)
        avlRecord.writeInt32BE(Math.round(LON * 10000000), offset); offset += 4;
        // Latitude (4 bytes signed int * 10,000,000)
        avlRecord.writeInt32BE(Math.round(LAT * 10000000), offset); offset += 4;
        // Altitude (2 bytes)
        avlRecord.writeInt16BE(145, offset); offset += 2;
        // Angle/Rumbo (2 bytes)
        avlRecord.writeUInt16BE(Math.round(RUMBO), offset); offset += 2;
        // Satellites (1 byte)
        avlRecord.writeUInt8(8, offset); offset += 1;
        // Speed (2 bytes km/h)
        avlRecord.writeUInt16BE(Math.round(SPEED), offset); offset += 2;
        // Event ID (1 byte)
        avlRecord.writeUInt8(0, offset); offset += 1;
        // Total IO count (1 byte)
        avlRecord.writeUInt8(1, offset); offset += 1;
        // 1-byte IO count (1 byte)
        avlRecord.writeUInt8(1, offset); offset += 1;
        // IO ID (1 byte = 239 ACC)
        avlRecord.writeUInt8(239, offset); offset += 1;
        // IO Value (1 byte = 1 encendido)
        avlRecord.writeUInt8(1, offset); offset += 1;
        // 2-byte IOs (1 byte = 0)
        avlRecord.writeUInt8(0, offset); offset += 1;
        // 4-byte IOs (1 byte = 0)
        avlRecord.writeUInt8(0, offset); offset += 1;
        // 8-byte IOs (1 byte = 0)
        avlRecord.writeUInt8(0, offset); offset += 1;

        // Data payload: Codec ID (1) + Rec Count (1) + avlRecord + Rec Count (1)
        const avlDataLen = 1 + 1 + avlRecord.length + 1;
        const totalPacket = Buffer.alloc(8 + avlDataLen + 4);

        // Preamble 4 bytes 0x00000000
        totalPacket.writeUInt32BE(0x00000000, 0);
        // Data length 4 bytes
        totalPacket.writeUInt32BE(avlDataLen, 4);
        // Codec ID (0x08)
        totalPacket.writeUInt8(0x08, 8);
        // Number of records (1)
        totalPacket.writeUInt8(1, 9);
        // Copy AVL record
        avlRecord.copy(totalPacket, 10);
        // Number of records repeated (1)
        totalPacket.writeUInt8(1, 10 + avlRecord.length);
        // CRC (4 bytes = 0x00000000)
        totalPacket.writeUInt32BE(0x00000000, 10 + avlRecord.length + 1);

        client.write(totalPacket);
      } else {
        console.error(`[TCP Teltonika] ❌ Handshake rechazado por el servidor.`);
        client.destroy();
        process.exit(1);
      }
    } else {
      if (data.length === 4) {
        const countAck = data.readUInt32BE(0);
        console.log(`[TCP Teltonika] ✔ Confirmación ACK recibida del Gateway (${countAck} registro(s) aceptado(s)).`);
        client.end();
        process.exit(0);
      }
    }
  });

  client.on('error', (err) => {
    console.error(`[TCP Teltonika] ❌ Error de conexión: ${err.message}`);
    process.exit(1);
  });
}

if (PROTOCOL === 'teltonika') {
  sendTeltonikaCodec8();
} else if (PROTOCOL === 'json') {
  sendGenericJson();
} else {
  sendSuntechAscii();
}
