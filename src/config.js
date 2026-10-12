/**
 * OpenSICM - Módulo Central de Configuración
 */
const path = require('path');
const dotenv = require('dotenv');

// Cargar variables de entorno desde .env si existe
dotenv.config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Servidor Web y API
  HTTP_PORT: parseInt(process.env.HTTP_PORT || process.env.PORT || '3000', 10),
  
  // Ingesta GPS TCP
  GPS_INGEST_PORT: parseInt(process.env.GPS_INGEST_PORT || '5001', 10),
  GPS_TCP_ENABLED: process.env.GPS_TCP_ENABLED !== 'false',
  
  // Enlace ATU WebSocket
  ATU_WS_ENABLED: process.env.ATU_WS_ENABLED !== 'false' && !process.argv.includes('--no-atu'),
  ATU_WS_ENDPOINT: process.env.ATU_WS_ENDPOINT || 'ws://localhost:5000/ws',
  ATU_COMPANY_TOKEN: process.env.ATU_COMPANY_TOKEN || 'TOKEN_DEMO',
  AUTO_MOCK_ATU: process.env.AUTO_MOCK_ATU === 'true' || process.argv.includes('--mock'),
  
  // Intervalos
  TRANSMIT_INTERVAL_SEC: parseInt(process.env.TRANSMIT_INTERVAL_SEC || '30', 10),
  
  // Cola Offline (buffer de respaldo)
  OFFLINE_QUEUE_MAX_SIZE: parseInt(process.env.OFFLINE_QUEUE_MAX_SIZE || '10000', 10),
  OFFLINE_QUEUE_FILE: process.env.OFFLINE_QUEUE_FILE 
    ? path.resolve(process.env.OFFLINE_QUEUE_FILE) 
    : path.resolve(__dirname, '../data/offline_queue.json'),
    
  // Parámetros de reconexión WebSocket (Backoff exponencial)
  WS_RECONNECT_INITIAL_MS: 2000,
  WS_RECONNECT_MAX_MS: 30000,
  WS_HEARTBEAT_INTERVAL_MS: 25000,
  WS_HEARTBEAT_TIMEOUT_MS: 10000
};
