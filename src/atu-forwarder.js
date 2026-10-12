/**
 * OpenSICM - Forwarder WebSocket hacia SICM ATU
 * Gestiona el enlace de telemetría persistente con la ATU,
 * reconexión con backoff exponencial, cola FIFO offline y heartbeat.
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const config = require('./config');
const stateManager = require('./state-manager');

class AtuForwarder extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.status = 'DESCONECTADO'; // 'DESCONECTADO' | 'CONECTANDO' | 'CONECTADO' | 'RECONECTANDO' | 'ERROR'
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatWatchdog = null;
    this.isFlushing = false;

    // Métricas de sesión
    this.metrics = {
      sentCount: 0,
      ackCount: 0,
      errorCount: 0,
      lastSentAt: null,
      lastAckAt: null,
      lastError: null,
      connectedAt: null
    };

    // Cola FIFO offline
    this.offlineQueue = [];
    this.loadOfflineQueue();
  }

  /**
   * Carga la cola offline persistida en disco si existe
   */
  loadOfflineQueue() {
    try {
      if (fs.existsSync(config.OFFLINE_QUEUE_FILE)) {
        const raw = fs.readFileSync(config.OFFLINE_QUEUE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.offlineQueue = parsed.slice(-config.OFFLINE_QUEUE_MAX_SIZE);
          console.log(`[ATU Forwarder] Cola offline restaurada: ${this.offlineQueue.length} tramas pendientes.`);
        }
      }
    } catch (err) {
      console.warn(`[ATU Forwarder] No se pudo leer la cola offline:`, err.message);
      this.offlineQueue = [];
    }
  }

  /**
   * Guarda la cola offline actual en disco
   */
  saveOfflineQueue() {
    try {
      const dir = path.dirname(config.OFFLINE_QUEUE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(config.OFFLINE_QUEUE_FILE, JSON.stringify(this.offlineQueue), 'utf8');
    } catch (err) {
      console.warn(`[ATU Forwarder] Error guardando cola offline:`, err.message);
    }
  }

  /**
   * Actualiza y emite el estado del enlace ATU
   */
  setStatus(newStatus, detail = null) {
    if (this.status !== newStatus) {
      const prev = this.status;
      this.status = newStatus;
      console.log(`[ATU Forwarder] Estado cambió: ${prev} -> ${newStatus}${detail ? ` (${detail})` : ''}`);
      this.emit('status_change', {
        status: this.status,
        metrics: this.getMetrics(),
        detail
      });
    }
  }

  /**
   * Inicia la conexión WebSocket con el servidor ATU
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setStatus(this.reconnectAttempt === 0 ? 'CONECTANDO' : 'RECONECTANDO');

    // Construir URL con el token de empresa
    const url = new URL(config.ATU_WS_ENDPOINT);
    url.searchParams.set('token', config.ATU_COMPANY_TOKEN);

    console.log(`[ATU Forwarder] Conectando a ${config.ATU_WS_ENDPOINT} (Intento #${this.reconnectAttempt + 1})...`);

    try {
      this.ws = new WebSocket(url.toString(), {
        handshakeTimeout: 10000,
        headers: {
          'User-Agent': 'OpenSICM-Gateway/1.0.0 (Transito-Urbano-Lima-Callao)'
        }
      });

      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (data) => this.onMessage(data));
      this.ws.on('pong', () => this.onPong());
      this.ws.on('close', (code, reason) => this.onClose(code, reason));
      this.ws.on('error', (err) => this.onError(err));
    } catch (err) {
      this.onError(err);
    }
  }

  /**
   * Conexión establecida con éxito
   */
  onOpen() {
    this.reconnectAttempt = 0;
    this.metrics.connectedAt = new Date().toISOString();
    this.setStatus('CONECTADO');
    console.log(`[ATU Forwarder] Enlace WebSocket con ATU establecido satisfactoriamente.`);

    // Iniciar latido de corazón (Heartbeat)
    this.startHeartbeat();

    // Enviar tramas que estaban en cola offline
    this.flushQueue();
  }

  /**
   * Inicia el ping periódico
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Enviar ping
        try {
          this.ws.ping();
          // Watchdog: si no responde pong en X segundos, forzar reconexión
          this.heartbeatWatchdog = setTimeout(() => {
            console.warn(`[ATU Forwarder] Heartbeat timeout: No hubo respuesta PONG de ATU. Reiniciando enlace.`);
            if (this.ws) this.ws.terminate();
          }, config.WS_HEARTBEAT_TIMEOUT_MS);
        } catch (e) {
          console.warn(`[ATU Forwarder] Error emitiendo ping:`, e.message);
        }
      }
    }, config.WS_HEARTBEAT_INTERVAL_MS);
  }

  onPong() {
    if (this.heartbeatWatchdog) {
      clearTimeout(this.heartbeatWatchdog);
      this.heartbeatWatchdog = null;
    }
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatWatchdog) clearTimeout(this.heartbeatWatchdog);
    this.heartbeatTimer = null;
    this.heartbeatWatchdog = null;
  }

  /**
   * Recepción de mensaje / ACK de la ATU
   */
  onMessage(rawData) {
    try {
      const text = rawData.toString();
      let msg = null;
      try {
        msg = JSON.parse(text);
      } catch {
        msg = { raw: text };
      }

      this.metrics.ackCount++;
      this.metrics.lastAckAt = new Date().toISOString();

      // Si el servidor ATU responde indicando qué placa o qué tramas fueron confirmadas
      if (msg.placa) {
        stateManager.updateAtuStatus(msg.placa, 'CONFIRMADO', { response: msg });
      }

      this.emit('frame_ack', msg);
    } catch (err) {
      console.warn(`[ATU Forwarder] Error procesando respuesta ATU:`, err.message);
    }
  }

  /**
   * Cierre de la conexión WebSocket
   */
  onClose(code, reason) {
    this.stopHeartbeat();
    const reasonText = reason ? reason.toString() : 'Conexión cerrada';
    console.warn(`[ATU Forwarder] Conexión cerrada (Código: ${code}, Razón: ${reasonText})`);
    this.scheduleReconnect();
  }

  /**
   * Error en la conexión
   */
  onError(err) {
    this.metrics.errorCount++;
    this.metrics.lastError = err.message;
    console.error(`[ATU Forwarder] Error de enlace ATU: ${err.message}`);
    this.setStatus('ERROR', err.message);
  }

  /**
   * Programa la reconexión con Backoff Exponencial
   */
  scheduleReconnect() {
    this.stopHeartbeat();
    this.setStatus('RECONECTANDO');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Backoff exponencial: 2s, 4s, 8s, 16s... hasta un tope de 30s
    const delay = Math.min(
      config.WS_RECONNECT_INITIAL_MS * Math.pow(2, this.reconnectAttempt),
      config.WS_RECONNECT_MAX_MS
    );
    this.reconnectAttempt++;

    console.log(`[ATU Forwarder] Reintentando conexión en ${delay / 1000}s (Intento #${this.reconnectAttempt})...`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Envía una trama a la ATU. Si no hay conexión, la encola en FIFO.
   * @param {Object} atuPayload Trama validada según sección 6
   */
  sendPayload(atuPayload) {
    const { placa } = atuPayload;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const jsonStr = JSON.stringify(atuPayload);
        this.ws.send(jsonStr);

        this.metrics.sentCount++;
        this.metrics.lastSentAt = new Date().toISOString();

        stateManager.updateAtuStatus(placa, 'ENVIADO');
        this.emit('frame_sent', atuPayload);
        return true;
      } catch (err) {
        console.error(`[ATU Forwarder] Error al emitir por socket: ${err.message}`);
        this.enqueue(atuPayload);
        stateManager.updateAtuStatus(placa, 'ERROR', { error: err.message });
        return false;
      }
    } else {
      // Sin conexión activa: almacenar en la cola FIFO offline
      this.enqueue(atuPayload);
      stateManager.updateAtuStatus(placa, 'PENDIENTE', { motivo: 'Sin enlace ATU' });
      return false;
    }
  }

  /**
   * Encola una trama en la memoria y persiste en disco
   */
  enqueue(payload) {
    if (this.offlineQueue.length >= config.OFFLINE_QUEUE_MAX_SIZE) {
      // Sacar la más antigua para mantener capacidad dentro del límite
      this.offlineQueue.shift();
    }
    this.offlineQueue.push(payload);
    this.saveOfflineQueue();
  }

  /**
   * Despacha progresivamente las tramas acumuladas en la cola offline
   */
  async flushQueue() {
    if (this.isFlushing || this.offlineQueue.length === 0) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.isFlushing = true;
    console.log(`[ATU Forwarder] Vaciando cola offline (${this.offlineQueue.length} tramas pendientes)...`);

    while (this.offlineQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const item = this.offlineQueue.shift();
      try {
        this.ws.send(JSON.stringify(item));
        this.metrics.sentCount++;
        this.metrics.lastSentAt = new Date().toISOString();
        stateManager.updateAtuStatus(item.placa, 'ENVIADO', { desdeCola: true });
        
        // Pequeño retardo de 50ms para no saturar el canal de red
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (err) {
        console.warn(`[ATU Forwarder] Error vaciando cola, reencolando:`, err.message);
        this.offlineQueue.unshift(item);
        break;
      }
    }

    this.saveOfflineQueue();
    this.isFlushing = false;
    console.log(`[ATU Forwarder] Vaciado completado. Restan en cola: ${this.offlineQueue.length}`);
    this.emit('queue_updated', { queueSize: this.offlineQueue.length });
  }

  /**
   * Vacía y limpia la cola offline por completo
   */
  clearQueue() {
    const prevCount = this.offlineQueue.length;
    this.offlineQueue = [];
    this.saveOfflineQueue();
    console.log(`[ATU Forwarder] Cola offline vaciada por el usuario (${prevCount} tramas eliminadas).`);
    this.emit('queue_cleared', { clearedCount: prevCount, queueSize: 0 });
    this.emit('queue_updated', { queueSize: 0 });
    return { clearedCount: prevCount, queueSize: 0 };
  }

  /**
   * Obtiene una muestra de las tramas en cola
   */
  getQueue(limit = 50) {
    return this.offlineQueue.slice(0, limit);
  }

  /**
   * Devuelve snapshot de métricas actuales
   */
  getMetrics() {
    return {
      status: this.status,
      queueSize: this.offlineQueue.length,
      ...this.metrics
    };
  }

  /**
   * Detiene el forwarder y cierra conexiones de forma limpia
   */
  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.saveOfflineQueue();
    this.setStatus('DESCONECTADO');
  }
}

module.exports = new AtuForwarder();
