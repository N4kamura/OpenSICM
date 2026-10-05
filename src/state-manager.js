/**
 * OpenSICM - Administrador de Estado de la Flota en Memoria
 * Mantiene la última posición, velocidad, estado del GPS y transmisión ATU de cada unidad.
 */
const EventEmitter = require('events');

class StateManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Object>} */
    this.buses = new Map();
  }

  /**
   * Determina el estado operacional visual del vehículo
   * @param {Object} bus 
   * @returns {'MOVIMIENTO' | 'DETENIDO' | 'OFFLINE'}
   */
  computeVehicleStatus(bus) {
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = now - (bus.timestamp || bus.recibidoEn || now);

    // Si lleva más de 90 segundos sin reportar o motor apagado (ignición = 0)
    if (timeDiff > 90 || bus.ignicion === 0) {
      return 'OFFLINE';
    }
    // En movimiento: velocidad > 5 km/h
    if (bus.velocidad > 5.0) {
      return 'MOVIMIENTO';
    }
    // Detenido con motor encendido
    return 'DETENIDO';
  }

  /**
   * Actualiza el estado de una unidad con nueva telemetría
   * @param {Object} data 
   * @returns {Object} Estado actualizado del bus
   */
  updateBusTelemetry(data) {
    const { placa } = data;
    if (!placa) return null;

    const existing = this.buses.get(placa) || {
      placa,
      atuStatus: 'PENDIENTE',
      atuLastSent: null,
      atuLastAck: null,
      historicoCoordenadas: []
    };

    // Mantener un mini-trail de hasta 10 posiciones recientes para trazado en el mapa
    const historico = existing.historicoCoordenadas || [];
    historico.push([data.latitud, data.longitud]);
    if (historico.length > 20) {
      historico.shift();
    }

    const updated = {
      ...existing,
      ...data,
      historicoCoordenadas: historico,
      estadoOperacional: this.computeVehicleStatus(data),
      actualizadoEn: Math.floor(Date.now() / 1000)
    };

    this.buses.set(placa, updated);
    this.emit('bus_updated', updated);
    return updated;
  }

  /**
   * Actualiza el estado del envío a la ATU para una o más unidades
   * @param {string} placa 
   * @param {'PENDIENTE' | 'ENVIADO' | 'CONFIRMADO' | 'ERROR'} status 
   * @param {Object} [details]
   */
  updateAtuStatus(placa, status, details = {}) {
    const bus = this.buses.get(placa);
    if (!bus) return;

    bus.atuStatus = status;
    if (status === 'ENVIADO') {
      bus.atuLastSent = Math.floor(Date.now() / 1000);
    } else if (status === 'CONFIRMADO') {
      bus.atuLastAck = Math.floor(Date.now() / 1000);
    }
    if (details.error) {
      bus.atuLastError = details.error;
    }

    this.buses.set(placa, bus);
    this.emit('bus_atu_status', { placa, status, details, bus });
  }

  /**
   * Retorna una unidad por placa
   * @param {string} placa 
   */
  getBus(placa) {
    const bus = this.buses.get(placa);
    if (!bus) return null;
    return {
      ...bus,
      estadoOperacional: this.computeVehicleStatus(bus)
    };
  }

  /**
   * Retorna la lista completa de unidades activas
   */
  getAllBuses() {
    const list = [];
    for (const bus of this.buses.values()) {
      list.push({
        ...bus,
        estadoOperacional: this.computeVehicleStatus(bus)
      });
    }
    return list;
  }

  /**
   * Retorna métricas generales de la flota
   */
  getFleetStats() {
    let enMovimiento = 0;
    let detenidos = 0;
    let offline = 0;

    for (const bus of this.buses.values()) {
      const st = this.computeVehicleStatus(bus);
      if (st === 'MOVIMIENTO') enMovimiento++;
      else if (st === 'DETENIDO') detenidos++;
      else offline++;
    }

    return {
      total: this.buses.size,
      enMovimiento,
      detenidos,
      offline
    };
  }
}

module.exports = new StateManager();
