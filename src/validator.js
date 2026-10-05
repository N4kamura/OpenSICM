/**
 * OpenSICM - Módulo de Validación y Normalización de Tramas ATU
 * Especificación SICM ATU (Resolución Ministerial MTC / Especificación Técnica ATU)
 */

/**
 * Normaliza y valida una placa de transporte urbano (6 caracteres alfanuméricos)
 * @param {string} rawPlaca 
 * @returns {string|null} Placa limpia o null si inválida
 */
function normalizePlaca(rawPlaca) {
  if (!rawPlaca || typeof rawPlaca !== 'string') return null;
  const clean = rawPlaca.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 6 ? clean : null;
}

/**
 * Normaliza un IMEI a 15 dígitos numéricos
 * @param {string|number} rawImei 
 * @returns {string|null}
 */
function normalizeImei(rawImei) {
  if (!rawImei) return null;
  const clean = String(rawImei).replace(/\D/g, '');
  return clean.length === 15 ? clean : (clean.length >= 10 ? clean.padStart(15, '0') : null);
}

/**
 * Convierte cualquier formato de fecha o timestamp a segundos epoch POSIX
 * @param {number|string|Date} rawTs 
 * @returns {number}
 */
function normalizeTimestamp(rawTs) {
  if (!rawTs) return Math.floor(Date.now() / 1000);
  
  if (typeof rawTs === 'number') {
    // Si viene en milisegundos (ej. 1717200000000)
    if (rawTs > 100000000000) {
      return Math.floor(rawTs / 1000);
    }
    return Math.floor(rawTs);
  }
  
  const parsed = new Date(rawTs).getTime();
  if (!isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  
  return Math.floor(Date.now() / 1000);
}

/**
 * Valida y normaliza la telemetría entrante al formato exacto requerido por ATU
 * @param {Object} raw - Datos crudos recibidos
 * @returns {{ isValid: boolean, error?: string, atuPayload?: Object, internalState?: Object }}
 */
function validateAndNormalize(raw) {
  if (!raw || typeof raw !== 'object') {
    return { isValid: false, error: 'Payload vacío o formato no es JSON objeto' };
  }

  // 1. Placa
  const placa = normalizePlaca(raw.placa);
  if (!placa) {
    return { isValid: false, error: `Placa inválida: "${raw.placa}". Debe ser de 6 caracteres alfanuméricos.` };
  }

  // 2. IMEI
  const imei = normalizeImei(raw.imei);
  if (!imei) {
    return { isValid: false, error: `IMEI inválido: "${raw.imei}". Debe contener 15 dígitos.` };
  }

  // 3. Ruta ATU
  const ruta = (raw.ruta || raw.codigoRuta || 'S/R').toString().trim().toUpperCase();
  if (!ruta) {
    return { isValid: false, error: 'Código de ruta ATU es requerido' };
  }

  // 4. Latitud y Longitud (WGS 84 EPSG:4326)
  const lat = parseFloat(raw.latitud ?? raw.lat);
  const lon = parseFloat(raw.longitud ?? raw.lon ?? raw.lng);

  if (isNaN(lat) || lat < -90.0 || lat > 90.0) {
    return { isValid: false, error: `Latitud WGS84 fuera de rango (-90 a 90): ${raw.latitud}` };
  }
  if (isNaN(lon) || lon < -180.0 || lon > 180.0) {
    return { isValid: false, error: `Longitud WGS84 fuera de rango (-180 a 180): ${raw.longitud}` };
  }

  // Coordenadas en 0,0 suelen indicar GPS sin fix
  if (lat === 0 && lon === 0) {
    return { isValid: false, error: 'Coordenadas (0,0) sin señal satelital GPS válida' };
  }

  // 5. Altitud
  const alt = parseFloat(raw.altitud ?? raw.alt ?? 0);
  const altitud = isNaN(alt) ? 0.0 : Math.round(alt * 10) / 10;

  // 6. Velocidad (km/h)
  let vel = parseFloat(raw.velocidad ?? raw.speed ?? 0);
  if (isNaN(vel) || vel < 0) vel = 0.0;
  // Si viniera en nudos (knots) o m/s se asume km/h salvo que se especifique
  const velocidad = Math.round(vel * 10) / 10;

  // 7. Rumbo (0.0 a 360.0 grados)
  let rumboVal = parseFloat(raw.rumbo ?? raw.course ?? raw.heading ?? 0);
  if (isNaN(rumboVal)) rumboVal = 0.0;
  rumboVal = rumboVal % 360;
  if (rumboVal < 0) rumboVal += 360;
  const rumbo = Math.round(rumboVal * 10) / 10;

  // 8. Timestamp (segundos epoch POSIX)
  const timestamp = normalizeTimestamp(raw.timestamp ?? raw.time ?? raw.datetime);

  // 9. Evento
  const evento = (raw.evento || 'POSICION_PERIODICA').toString().trim().toUpperCase();

  // 10. Ignición (0 o 1)
  const ignicionRaw = raw.ignicion ?? raw.acc ?? raw.ignition ?? 1;
  const ignicion = (ignicionRaw === 1 || ignicionRaw === true || ignicionRaw === '1' || ignicionRaw === 'true') ? 1 : 0;

  // 11. Modelo GPS
  const modeloGps = (raw.modeloGps || raw.gpsModel || raw.modelo || 'GENERIC_GPS').toString().trim().toUpperCase();

  // 12. Padrón interno (metadato operacional para la empresa)
  const padron = raw.padron ? String(raw.padron).trim() : '';

  // Payload final exacto para el WebSocket de la ATU
  const atuPayload = {
    imei,
    placa,
    ruta,
    latitud: Math.round(lat * 1000000) / 1000000,
    longitud: Math.round(lon * 1000000) / 1000000,
    altitud,
    velocidad,
    rumbo,
    timestamp,
    evento,
    ignicion,
    modeloGps
  };

  // Metadatos adicionales para supervisión interna del portal
  const internalState = {
    ...atuPayload,
    padron,
    satelites: parseInt(raw.satelites || raw.sats || 8, 10),
    odometro: parseFloat(raw.odometro || 0),
    recibidoEn: Math.floor(Date.now() / 1000)
  };

  return {
    isValid: true,
    atuPayload,
    internalState
  };
}

module.exports = {
  normalizePlaca,
  normalizeImei,
  normalizeTimestamp,
  validateAndNormalize
};
