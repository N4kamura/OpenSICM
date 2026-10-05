/**
 * OpenSICM - Módulo de Almacén y Gestión de Flota y GPS
 * Persiste el inventario de unidades de transporte y su asignación de equipos GPS en data/fleet.json
 */
const fs = require('fs');
const path = require('path');
const { normalizePlaca, normalizeImei } = require('./validator');

const FLEET_FILE = path.resolve(__dirname, '../data/fleet.json');

// Unidades iniciales por defecto para pruebas
const DEFAULT_FLEET = [
  {
    placa: 'A1B789',
    ruta: 'IO33B',
    padron: '12',
    imei: '864201041234561',
    modeloGps: 'TELTONIKA_FMB920',
    activo: true,
    notas: 'Unidad operativa - Javier Prado'
  },
  {
    placa: 'BC1023',
    ruta: 'CR42',
    padron: '45',
    imei: '864201041234562',
    modeloGps: 'SUNTECH_ST310',
    activo: true,
    notas: 'Unidad operativa - Vía Expresa'
  },
  {
    placa: 'D4E567',
    ruta: '101',
    padron: '08',
    imei: '864201041234563',
    modeloGps: 'QUECLINK_GV300',
    activo: true,
    notas: 'Unidad operativa - Av. Brasil'
  },
  {
    placa: 'F7G890',
    ruta: 'OM18',
    padron: '27',
    imei: '864201041234564',
    modeloGps: 'TELTONIKA_FMC130',
    activo: true,
    notas: 'Unidad en mantenimiento preventivo'
  },
  {
    placa: 'H2J345',
    ruta: 'IO33B',
    padron: '33',
    imei: '864201041234565',
    modeloGps: 'SUNTECH_ST340',
    activo: true,
    notas: 'Unidad de retén'
  },
  {
    placa: 'X9Y123',
    ruta: 'CR42',
    padron: '19',
    imei: '',
    modeloGps: '',
    activo: true,
    notas: 'Bus nuevo en trámite de equipamiento'
  },
  {
    placa: 'M4K567',
    ruta: '101',
    padron: '52',
    imei: '',
    modeloGps: '',
    activo: true,
    notas: 'Requiere instalación de nuevo equipo GPS'
  }
];

class FleetStore {
  constructor() {
    this.fleet = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(FLEET_FILE)) {
        const raw = fs.readFileSync(FLEET_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.fleet = parsed;
          return;
        }
      }
    } catch (err) {
      console.warn('[FleetStore] Error leyendo fleet.json, inicializando por defecto:', err.message);
    }

    // Inicializar con la flota por defecto
    this.fleet = [...DEFAULT_FLEET];
    this.saveToDisk();
  }

  saveToDisk() {
    try {
      const dir = path.dirname(FLEET_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(FLEET_FILE, JSON.stringify(this.fleet, null, 2), 'utf8');
    } catch (err) {
      console.error('[FleetStore] Error guardando fleet.json:', err.message);
    }
  }

  getAll() {
    return this.fleet.map(u => ({
      ...u,
      tieneGps: !!(u.imei && u.imei.trim().length >= 10)
    }));
  }

  getByPlaca(placa) {
    const clean = normalizePlaca(placa);
    if (!clean) return null;
    const u = this.fleet.find(item => item.placa === clean);
    if (!u) return null;
    return {
      ...u,
      tieneGps: !!(u.imei && u.imei.trim().length >= 10)
    };
  }

  getByImei(imei) {
    const clean = normalizeImei(imei);
    if (!clean) return null;
    const u = this.fleet.find(item => item.imei === clean);
    if (!u) return null;
    return {
      ...u,
      tieneGps: true
    };
  }

  saveUnit(data) {
    const placa = normalizePlaca(data.placa);
    if (!placa) {
      return { success: false, error: 'Placa inválida (debe contener 6 caracteres alfanuméricos)' };
    }

    const ruta = (data.ruta || 'S/R').toString().trim().toUpperCase();
    const padron = (data.padron || '').toString().trim();
    const imei = data.imei ? normalizeImei(data.imei) : '';
    const modeloGps = (data.modeloGps || '').toString().trim().toUpperCase();
    const notas = (data.notas || '').toString().trim();
    const activo = data.activo !== false;

    // Verificar si el IMEI ya está asignado a otra placa distinta
    if (imei) {
      const existingImei = this.fleet.find(item => item.imei === imei && item.placa !== placa);
      if (existingImei) {
        return { success: false, error: `El IMEI ${imei} ya está asignado a la placa ${existingImei.placa}` };
      }
    }

    const idx = this.fleet.findIndex(item => item.placa === placa);
    const unit = {
      placa,
      ruta,
      padron,
      imei: imei || '',
      modeloGps: imei ? (modeloGps || 'GENERIC_GPS') : '',
      activo,
      notas,
      actualizadoEn: Math.floor(Date.now() / 1000)
    };

    if (idx >= 0) {
      this.fleet[idx] = { ...this.fleet[idx], ...unit };
    } else {
      unit.creadoEn = Math.floor(Date.now() / 1000);
      this.fleet.push(unit);
    }

    this.saveToDisk();
    return { success: true, unit };
  }

  assignGps(placa, imei, modeloGps) {
    const cleanPlaca = normalizePlaca(placa);
    const cleanImei = normalizeImei(imei);

    if (!cleanPlaca) return { success: false, error: 'Placa inválida' };
    if (!cleanImei) return { success: false, error: 'IMEI inválido (debe tener 15 dígitos)' };

    // Verificar si el IMEI ya está asignado a otro bus
    const conflict = this.fleet.find(item => item.imei === cleanImei && item.placa !== cleanPlaca);
    if (conflict) {
      return { success: false, error: `El IMEI ${cleanImei} ya se encuentra asignado a la unidad ${conflict.placa}` };
    }

    const unit = this.fleet.find(item => item.placa === cleanPlaca);
    if (!unit) {
      return { success: false, error: `Unidad con placa ${cleanPlaca} no encontrada` };
    }

    unit.imei = cleanImei;
    unit.modeloGps = (modeloGps || 'TELTONIKA_FMB920').toString().trim().toUpperCase();
    unit.actualizadoEn = Math.floor(Date.now() / 1000);

    this.saveToDisk();
    return { success: true, unit };
  }

  unassignGps(placa) {
    const cleanPlaca = normalizePlaca(placa);
    if (!cleanPlaca) return { success: false, error: 'Placa inválida' };

    const unit = this.fleet.find(item => item.placa === cleanPlaca);
    if (!unit) return { success: false, error: 'Unidad no encontrada' };

    unit.imei = '';
    unit.modeloGps = '';
    unit.actualizadoEn = Math.floor(Date.now() / 1000);

    this.saveToDisk();
    return { success: true, unit };
  }

  deleteUnit(placa) {
    const cleanPlaca = normalizePlaca(placa);
    if (!cleanPlaca) return { success: false, error: 'Placa inválida' };

    const initialLen = this.fleet.length;
    this.fleet = this.fleet.filter(item => item.placa !== cleanPlaca);

    if (this.fleet.length === initialLen) {
      return { success: false, error: 'Unidad no encontrada' };
    }

    this.saveToDisk();
    return { success: true };
  }

  getStats() {
    let conGps = 0;
    let sinGps = 0;

    this.fleet.forEach(u => {
      if (u.imei && u.imei.trim().length >= 10) conGps++;
      else sinGps++;
    });

    return {
      total: this.fleet.length,
      conGps,
      sinGps
    };
  }
}

module.exports = new FleetStore();
