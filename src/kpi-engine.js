/**
 * OpenSICM - Motor de Métricas y KPIs de Flota (Sin GTFS)
 * Calcula y persiste métricas operacionales y regulatorias con telemetría pura cada 30 segundos:
 * - Odometría GPS acumulada (km por Haversine)
 * - Horas motor acumuladas (ignición ACC ON)
 * - Índice de Transmisión Efectiva a ATU (ITE %)
 * - Detección de Blackouts / Silencios GPS (> 90s)
 * - Disponibilidad de flota (%IDF) y Flota Mínima Habilitada (FMH) en hora punta
 * - Salud técnica del enlace y latencia
 */
const EventEmitter = require('events');
const db = require('./db');
const fleetStore = require('./fleet-store');

/**
 * Calcula la distancia Haversine en kilómetros entre dos coordenadas
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distancia en kilómetros
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0.0;
  const R = 6371.0; // Radio medio de la Tierra en km
  const toRad = Math.PI / 180.0;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Obtiene la fecha actual en zona horaria de Lima (UTC-5) en formato YYYY-MM-DD
 * @returns {string}
 */
function getTodayDateLima() {
  const now = new Date();
  // UTC-5 para Lima/Perú
  const limaTime = new Date(now.getTime() - 5 * 3600 * 1000);
  return limaTime.toISOString().slice(0, 10);
}

class KpiEngine extends EventEmitter {
  constructor() {
    super();
    /** @type {string} Fecha actual del consolidado */
    this.currentDate = getTodayDateLima();

    /** @type {Map<string, Object>} Estado de KPIs por placa en memoria */
    this.unitKpis = new Map();

    /** @type {Map<string, Object>} Último punto registrado para cálculo de deltas */
    this.lastPoints = new Map();

    /** @type {Array<Object>} Buffer de alertas recientes en memoria (máx. 50) */
    this.recentAlerts = [];

    /** Métricas acumuladas del gateway */
    this.gatewayStats = {
      latenciasMs: [],
      tramasInvalidas: 0
    };

    this.initTodayKpis();

    // Guardado periódico a SQLite cada 15 segundos
    this.saveInterval = setInterval(() => {
      this.flushToDatabase();
    }, 15000);

    // Revisar periodicidad de blackouts cada 30 segundos
    this.checkBlackoutsInterval = setInterval(() => {
      this.checkActiveBlackouts();
    }, 30000);
  }

  /**
   * Carga los KPIs del día actual desde SQLite o inicializa registros limpios
   */
  initTodayKpis() {
    try {
      this.currentDate = getTodayDateLima();
      const stmt = db.prepare('SELECT * FROM daily_unit_kpis WHERE fecha = ?');
      const rows = stmt.all(this.currentDate);

      for (const row of rows) {
        this.unitKpis.set(row.placa, {
          fecha: row.fecha,
          placa: row.placa,
          ruta: row.ruta || 'S/R',
          padron: row.padron || '',
          kmRecorridos: row.km_recorridos || 0.0,
          segundosMotor: row.segundos_motor || 0,
          tramasEnviadas: row.tramas_enviadas || 0,
          tramasAck: row.tramas_ack || 0,
          blackoutsCount: row.blackouts_count || 0,
          velocidadMax: row.velocidad_max || 0.0,
          ultimoReporte: row.ultimo_reporte || null,
          blackoutActivo: false
        });
      }

      // Cargar alertas recientes del día
      const alertStmt = db.prepare('SELECT * FROM kpi_alerts WHERE fecha = ? ORDER BY timestamp DESC LIMIT 30');
      this.recentAlerts = alertStmt.all(this.currentDate);
    } catch (err) {
      console.error('[KpiEngine] Error inicializando KPIs desde SQLite:', err.message);
    }
  }

  /**
   * Obtiene o inicializa el objeto KPI en memoria para una placa
   * @param {string} placa 
   * @param {string} [ruta]
   * @param {string} [padron]
   */
  getOrCreateUnitKpi(placa, ruta, padron) {
    const today = getTodayDateLima();
    if (today !== this.currentDate) {
      // Cambio de día a medianoche
      this.flushToDatabase();
      this.currentDate = today;
      this.unitKpis.clear();
      this.lastPoints.clear();
      this.recentAlerts = [];
    }

    let kpi = this.unitKpis.get(placa);
    if (!kpi) {
      kpi = {
        fecha: this.currentDate,
        placa,
        ruta: ruta || 'S/R',
        padron: padron || '',
        kmRecorridos: 0.0,
        segundosMotor: 0,
        tramasEnviadas: 0,
        tramasAck: 0,
        blackoutsCount: 0,
        velocidadMax: 0.0,
        ultimoReporte: null,
        blackoutActivo: false
      };
      this.unitKpis.set(placa, kpi);
    } else {
      if (ruta && ruta !== 'S/R') kpi.ruta = ruta;
      if (padron) kpi.padron = padron;
    }
    return kpi;
  }

  /**
   * Procesa una nueva trama de telemetría entrante
   * @param {Object} data 
   */
  processTelemetry(data) {
    const { placa, latitud, longitud, velocidad, ignicion, timestamp, ruta, padron } = data;
    if (!placa) return;

    const kpi = this.getOrCreateUnitKpi(placa, ruta, padron);
    const nowPosix = timestamp || Math.floor(Date.now() / 1000);
    const last = this.lastPoints.get(placa);

    // 1. Odometría GPS (Kilometraje por Haversine)
    if (last && typeof latitud === 'number' && typeof longitud === 'number' &&
        typeof last.latitud === 'number' && typeof last.longitud === 'number') {
      const deltaSec = Math.max(1, nowPosix - last.timestamp);
      const distKm = haversineDistanceKm(last.latitud, last.longitud, latitud, longitud);

      // Filtro de ruido GPS: si la velocidad implícita supera los 160 km/h o el salto es absurdo (> 10 km en 30s)
      const velocidadImplicita = (distKm / (deltaSec / 3600));
      if (distKm < 10.0 && velocidadImplicita <= 160.0) {
        kpi.kmRecorridos = Math.round((kpi.kmRecorridos + distKm) * 100) / 100;
      }
    }

    // 2. Horas Motor (Ignición ACC activa)
    if (ignicion === 1) {
      if (last && last.ignicion === 1) {
        const deltaSec = Math.min(120, Math.max(1, nowPosix - last.timestamp));
        kpi.segundosMotor += deltaSec;
      } else {
        kpi.segundosMotor += 30; // Primer punto o encendido
      }
    }

    // 3. Velocidad Máxima Registrada
    if (typeof velocidad === 'number' && velocidad > kpi.velocidadMax && velocidad < 150) {
      kpi.velocidadMax = Math.round(velocidad * 10) / 10;
    }

    // 4. Verificación de Fin de Blackout
    if (last && last.ignicion === 1 && ignicion === 1) {
      const lapsoSec = nowPosix - last.timestamp;
      if (lapsoSec > 90) {
        kpi.blackoutsCount++;
        this.recordAlert({
          tipo: 'BLACKOUT_GPS',
          placa,
          severidad: 'ALTA',
          detalles: `Silencio de señal GPS prolongado (${lapsoSec}s) con ignición activa`,
          latitud,
          longitud,
          timestamp: nowPosix
        });
      }
    }
    kpi.blackoutActivo = false;

    // 5. Contador de tramas enviadas hacia ATU
    kpi.tramasEnviadas++;
    kpi.ultimoReporte = nowPosix;

    // Guardar referencia del último punto
    this.lastPoints.set(placa, {
      latitud,
      longitud,
      velocidad: velocidad || 0,
      ignicion: ignicion !== undefined ? ignicion : 1,
      timestamp: nowPosix
    });

    this.emit('kpi_update', { placa, kpi: this.formatUnitKpi(kpi) });
  }

  /**
   * Registra la confirmación ACK de la ATU para una unidad
   * @param {Object} ack 
   */
  recordAtuAck(ack) {
    if (!ack || !ack.placa) return;
    const kpi = this.getOrCreateUnitKpi(ack.placa);
    kpi.tramasAck++;

    // Calcular latencia si viene timestamp de recepción
    if (ack.timestamp) {
      const now = Math.floor(Date.now() / 1000);
      const latenciaMs = Math.max(0, (now - ack.timestamp) * 1000);
      this.gatewayStats.latenciasMs.push(latenciaMs);
      if (this.gatewayStats.latenciasMs.length > 100) {
        this.gatewayStats.latenciasMs.shift();
      }
    }

    this.emit('kpi_update', { placa: ack.placa, kpi: this.formatUnitKpi(kpi) });
  }

  /**
   * Revisa unidades con motor encendido que hayan dejado de transmitir más de 90 segundos
   */
  checkActiveBlackouts() {
    const nowPosix = Math.floor(Date.now() / 1000);
    for (const [placa, last] of this.lastPoints.entries()) {
      if (last.ignicion === 1) {
        const timeDiff = nowPosix - last.timestamp;
        const kpi = this.unitKpis.get(placa);
        if (kpi && timeDiff > 90 && !kpi.blackoutActivo) {
          kpi.blackoutActivo = true;
          kpi.blackoutsCount++;
          this.recordAlert({
            tipo: 'BLACKOUT_GPS',
            placa,
            severidad: 'ALTA',
            detalles: `Unidad dejó de transmitir hace ${timeDiff} segundos (posible corte de antena o switch)`,
            latitud: last.latitud,
            longitud: last.longitud,
            timestamp: nowPosix
          });
          this.emit('kpi_update', { placa, kpi: this.formatUnitKpi(kpi) });
        }
      }
    }
  }

  /**
   * Registra una alerta en SQLite y en memoria
   * @param {Object} alert 
   */
  recordAlert(alert) {
    const alertObj = {
      fecha: this.currentDate,
      timestamp: alert.timestamp || Math.floor(Date.now() / 1000),
      tipo: alert.tipo || 'ALERTA',
      placa: alert.placa || '',
      severidad: alert.severidad || 'MEDIA',
      detalles: alert.detalles || '',
      latitud: alert.latitud || null,
      longitud: alert.longitud || null
    };

    try {
      const insert = db.prepare(`
        INSERT INTO kpi_alerts (fecha, timestamp, tipo, placa, severidad, detalles, latitud, longitud)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        alertObj.fecha,
        alertObj.timestamp,
        alertObj.tipo,
        alertObj.placa,
        alertObj.severidad,
        alertObj.detalles,
        alertObj.latitud,
        alertObj.longitud
      );
    } catch (err) {
      console.error('[KpiEngine] Error insertando alerta en SQLite:', err.message);
    }

    this.recentAlerts.unshift(alertObj);
    if (this.recentAlerts.length > 50) {
      this.recentAlerts.pop();
    }

    this.emit('kpi_alert', alertObj);
  }

  /**
   * Persiste el estado de KPIs en memoria a SQLite
   */
  flushToDatabase() {
    if (this.unitKpis.size === 0) return;
    try {
      const upsert = db.prepare(`
        INSERT INTO daily_unit_kpis (
          fecha, placa, ruta, padron, km_recorridos, segundos_motor, 
          tramas_enviadas, tramas_ack, blackouts_count, velocidad_max, 
          ultimo_reporte, actualizado_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fecha, placa) DO UPDATE SET
          ruta = excluded.ruta,
          padron = excluded.padron,
          km_recorridos = excluded.km_recorridos,
          segundos_motor = excluded.segundos_motor,
          tramas_enviadas = excluded.tramas_enviadas,
          tramas_ack = excluded.tramas_ack,
          blackouts_count = excluded.blackouts_count,
          velocidad_max = excluded.velocidad_max,
          ultimo_reporte = excluded.ultimo_reporte,
          actualizado_en = excluded.actualizado_en
      `);

      const now = Math.floor(Date.now() / 1000);
      for (const kpi of this.unitKpis.values()) {
        upsert.run(
          kpi.fecha,
          kpi.placa,
          kpi.ruta,
          kpi.padron,
          kpi.kmRecorridos,
          kpi.segundosMotor,
          kpi.tramasEnviadas,
          kpi.tramasAck,
          kpi.blackoutsCount,
          kpi.velocidadMax,
          kpi.ultimoReporte,
          now
        );
      }
    } catch (err) {
      console.error('[KpiEngine] Error guardando KPIs en SQLite:', err.message);
    }
  }

  /**
   * Formatea el estado de una unidad para salida API
   * @param {Object} kpi 
   */
  formatUnitKpi(kpi) {
    const horasMotor = Math.round((kpi.segundosMotor / 3600) * 10) / 10;
    const ite = kpi.tramasEnviadas > 0
      ? Math.round((kpi.tramasAck / kpi.tramasEnviadas) * 1000) / 10
      : 100.0;

    return {
      placa: kpi.placa,
      ruta: kpi.ruta,
      padron: kpi.padron,
      kmRecorridos: kpi.kmRecorridos,
      segundosMotor: kpi.segundosMotor,
      horasMotor,
      tramasEnviadas: kpi.tramasEnviadas,
      tramasAck: kpi.tramasAck,
      itePorcentaje: ite,
      blackoutsCount: kpi.blackoutsCount,
      velocidadMax: kpi.velocidadMax,
      ultimoReporte: kpi.ultimoReporte,
      blackoutActivo: kpi.blackoutActivo
    };
  }

  /**
   * Determina si la hora actual en Lima es hora punta reglamentaria
   * (06:30 - 09:00 y 18:00 - 21:00)
   * @returns {boolean}
   */
  isPeakHourLima() {
    const now = new Date();
    // UTC-5 para Lima
    const limaTime = new Date(now.getTime() - 5 * 3600 * 1000);
    const hour = limaTime.getUTCHours();
    const min = limaTime.getUTCMinutes();
    const timeDec = hour + min / 60.0;

    // 06:30 a 09:00 o 18:00 a 21:00
    return (timeDec >= 6.5 && timeDec <= 9.0) || (timeDec >= 18.0 && timeDec <= 21.0);
  }

  /**
   * Retorna el resumen ejecutivo global de la flota
   */
  getSummary() {
    const allFleet = fleetStore.getAll();
    const totalPadrón = allFleet.length;
    const totalConGps = allFleet.filter(u => u.tieneGps).length;

    let totalKm = 0.0;
    let totalSegundosMotor = 0;
    let totalEnviadas = 0;
    let totalAck = 0;
    let totalBlackouts = 0;
    let activasHoy = 0;

    for (const kpi of this.unitKpis.values()) {
      totalKm += kpi.kmRecorridos;
      totalSegundosMotor += kpi.segundosMotor;
      totalEnviadas += kpi.tramasEnviadas;
      totalAck += kpi.tramasAck;
      totalBlackouts += kpi.blackoutsCount;
      if (kpi.tramasEnviadas > 0) activasHoy++;
    }

    const iteGlobal = totalEnviadas > 0
      ? Math.round((totalAck / totalEnviadas) * 1000) / 10
      : 100.0;

    const disponibilidadFlota = totalPadrón > 0
      ? Math.round((activasHoy / totalPadrón) * 1000) / 10
      : 0.0;

    // Cumplimiento Flota Mínima Habilitada (FMH)
    const esHoraPunta = this.isPeakHourLima();
    // Meta: mínimo el 80% de los buses con GPS o valor contractual (ej. totalConGps)
    const fmhMeta = Math.max(1, Math.round(totalConGps * 0.8));
    const fmhPorcentaje = fmhMeta > 0
      ? Math.min(100.0, Math.round((activasHoy / fmhMeta) * 1000) / 10)
      : 100.0;

    // Latencia promedio
    let latenciaPromedioMs = 0;
    if (this.gatewayStats.latenciasMs.length > 0) {
      const sum = this.gatewayStats.latenciasMs.reduce((a, b) => a + b, 0);
      latenciaPromedioMs = Math.round(sum / this.gatewayStats.latenciasMs.length);
    }

    return {
      fecha: this.currentDate,
      iteGlobal,
      totalKm: Math.round(totalKm * 10) / 10,
      totalHorasMotor: Math.round((totalSegundosMotor / 3600) * 10) / 10,
      flotaTotal: totalPadrón,
      flotaConGps: totalConGps,
      flotaActivaHoy: activasHoy,
      disponibilidadFlota,
      esHoraPunta,
      fmhMeta,
      fmhPorcentaje,
      totalBlackouts,
      totalTramasEnviadas: totalEnviadas,
      totalTramasAck: totalAck,
      latenciaPromedioMs,
      totalAlertasHoy: this.recentAlerts.length
    };
  }

  /**
   * Retorna lista de KPIs por unidad
   */
  getAllUnitKpis() {
    const list = [];
    // Incluir unidades de flota registradas aunque aún no transmitan
    const allFleet = fleetStore.getAll();
    const mapPlacas = new Set();

    for (const kpi of this.unitKpis.values()) {
      list.push(this.formatUnitKpi(kpi));
      mapPlacas.add(kpi.placa);
    }

    for (const u of allFleet) {
      if (!mapPlacas.has(u.placa)) {
        list.push({
          placa: u.placa,
          ruta: u.ruta,
          padron: u.padron,
          kmRecorridos: 0.0,
          segundosMotor: 0,
          horasMotor: 0.0,
          tramasEnviadas: 0,
          tramasAck: 0,
          itePorcentaje: 100.0,
          blackoutsCount: 0,
          velocidadMax: 0.0,
          ultimoReporte: null,
          blackoutActivo: false
        });
      }
    }

    return list.sort((a, b) => b.kmRecorridos - a.kmRecorridos);
  }

  /**
   * Retorna las alertas recientes
   */
  getAlerts(limit = 30) {
    return this.recentAlerts.slice(0, limit);
  }
}

module.exports = new KpiEngine();
