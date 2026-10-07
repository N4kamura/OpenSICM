/**
 * OpenSICM - Módulo de Almacén y Gestión de Flota y GPS (SQLite)
 * Persiste el inventario de unidades de transporte y su asignación de equipos GPS en SQLite (data/opensicm.db)
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { normalizePlaca, normalizeImei } = require('./validator');

const LEGACY_FLEET_FILE = path.resolve(__dirname, '../data/fleet.json');

// Unidades iniciales por defecto para pruebas si la BD está vacía
const DEFAULT_FLEET = [
  {
    placa: 'A1B789',
    ruta: 'IO33B',
    padron: '12',
    imei: '864201041234561',
    modeloGps: 'TELTONIKA_FMB920',
    activo: 1,
    notas: 'Unidad operativa - Javier Prado'
  },
  {
    placa: 'BC1023',
    ruta: 'CR42',
    padron: '45',
    imei: '864201041234562',
    modeloGps: 'SUNTECH_ST310',
    activo: 1,
    notas: 'Unidad operativa - Vía Expresa'
  },
  {
    placa: 'D4E567',
    ruta: '101',
    padron: '08',
    imei: '864201041234563',
    modeloGps: 'QUECLINK_GV300',
    activo: 1,
    notas: 'Unidad operativa - Av. Brasil'
  },
  {
    placa: 'F7G890',
    ruta: 'OM18',
    padron: '27',
    imei: '864201041234564',
    modeloGps: 'TELTONIKA_FMC130',
    activo: 1,
    notas: 'Unidad en mantenimiento preventivo'
  },
  {
    placa: 'H2J345',
    ruta: 'IO33B',
    padron: '33',
    imei: '864201041234565',
    modeloGps: 'SUNTECH_ST340',
    activo: 1,
    notas: 'Unidad de retén'
  },
  {
    placa: 'X9Y123',
    ruta: 'CR42',
    padron: '19',
    imei: '',
    modeloGps: '',
    activo: 1,
    notas: 'Bus nuevo en trámite de equipamiento'
  },
  {
    placa: 'M4K567',
    ruta: '101',
    padron: '52',
    imei: '',
    modeloGps: '',
    activo: 1,
    notas: 'Requiere instalación de nuevo equipo GPS'
  }
];

class FleetStore {
  constructor() {
    this.initDatabase();
  }

  /**
   * Inicializa la tabla fleet en SQLite y migra desde fleet.json si existe
   */
  initDatabase() {
    try {
      const countStmt = db.prepare('SELECT COUNT(*) AS total FROM fleet');
      const row = countStmt.get();

      if (row.total === 0) {
        console.log('[FleetStore] Inicializando flota en base de datos SQLite...');
        let initialUnits = DEFAULT_FLEET;

        // Si existía un archivo fleet.json previo, migrarlo a SQLite
        if (fs.existsSync(LEGACY_FLEET_FILE)) {
          try {
            const raw = fs.readFileSync(LEGACY_FLEET_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              initialUnits = parsed;
              console.log(`[FleetStore] Migrando ${parsed.length} unidades desde legacy fleet.json a SQLite`);
            }
          } catch (err) {
            console.warn('[FleetStore] Error leyendo legacy fleet.json:', err.message);
          }
        }

        const insert = db.prepare(`
          INSERT INTO fleet (placa, ruta, padron, imei, modeloGps, activo, notas, creadoEn, actualizadoEn)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const now = Math.floor(Date.now() / 1000);
        for (const u of initialUnits) {
          insert.run(
            u.placa,
            u.ruta || 'S/R',
            u.padron || '',
            u.imei || '',
            u.modeloGps || '',
            u.activo !== false ? 1 : 0,
            u.notas || '',
            u.creadoEn || now,
            u.actualizadoEn || now
          );
        }
      }
    } catch (err) {
      console.error('[FleetStore] Error inicializando tabla de flota en SQLite:', err.message);
    }
  }

  /**
   * Normaliza una fila leída desde SQLite
   */
  formatRow(row) {
    if (!row) return null;
    return {
      ...row,
      activo: row.activo === 1,
      tieneGps: !!(row.imei && row.imei.trim().length >= 10)
    };
  }

  getAll() {
    try {
      const stmt = db.prepare('SELECT * FROM fleet ORDER BY ruta, padron, placa');
      const rows = stmt.all();
      return rows.map(r => this.formatRow(r));
    } catch (err) {
      console.error('[FleetStore] Error obteniendo unidades:', err.message);
      return [];
    }
  }

  getByPlaca(placa) {
    const clean = normalizePlaca(placa);
    if (!clean) return null;
    try {
      const stmt = db.prepare('SELECT * FROM fleet WHERE placa = ?');
      const row = stmt.get(clean);
      return this.formatRow(row);
    } catch (err) {
      console.error('[FleetStore] Error buscando por placa:', err.message);
      return null;
    }
  }

  getByImei(imei) {
    const clean = normalizeImei(imei);
    if (!clean) return null;
    try {
      const stmt = db.prepare('SELECT * FROM fleet WHERE imei = ?');
      const row = stmt.get(clean);
      return this.formatRow(row);
    } catch (err) {
      console.error('[FleetStore] Error buscando por IMEI:', err.message);
      return null;
    }
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
    const activo = data.activo !== false ? 1 : 0;
    const now = Math.floor(Date.now() / 1000);

    try {
      // Verificar conflicto de IMEI con otra placa
      if (imei) {
        const conflictStmt = db.prepare('SELECT placa FROM fleet WHERE imei = ? AND placa != ?');
        const conflict = conflictStmt.get(imei, placa);
        if (conflict) {
          return { success: false, error: `El IMEI ${imei} ya está asignado a la placa ${conflict.placa}` };
        }
      }

      const existing = this.getByPlaca(placa);
      if (existing) {
        const update = db.prepare(`
          UPDATE fleet 
          SET ruta = ?, padron = ?, imei = ?, modeloGps = ?, activo = ?, notas = ?, actualizadoEn = ?
          WHERE placa = ?
        `);
        update.run(
          ruta,
          padron,
          imei || '',
          imei ? (modeloGps || 'GENERIC_GPS') : '',
          activo,
          notas,
          now,
          placa
        );
      } else {
        const insert = db.prepare(`
          INSERT INTO fleet (placa, ruta, padron, imei, modeloGps, activo, notas, creadoEn, actualizadoEn)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insert.run(
          placa,
          ruta,
          padron,
          imei || '',
          imei ? (modeloGps || 'GENERIC_GPS') : '',
          activo,
          notas,
          now,
          now
        );
      }

      const updated = this.getByPlaca(placa);
      return { success: true, unit: updated };
    } catch (err) {
      console.error('[FleetStore] Error guardando unidad en SQLite:', err.message);
      return { success: false, error: err.message };
    }
  }

  assignGps(placa, imei, modeloGps) {
    const cleanPlaca = normalizePlaca(placa);
    const cleanImei = normalizeImei(imei);

    if (!cleanPlaca) return { success: false, error: 'Placa inválida' };
    if (!cleanImei) return { success: false, error: 'IMEI inválido (debe tener 15 dígitos)' };

    try {
      // Verificar si el IMEI ya está asignado a otra placa
      const conflictStmt = db.prepare('SELECT placa FROM fleet WHERE imei = ? AND placa != ?');
      const conflict = conflictStmt.get(cleanImei, cleanPlaca);
      if (conflict) {
        return { success: false, error: `El IMEI ${cleanImei} ya se encuentra asignado a la unidad ${conflict.placa}` };
      }

      const existing = this.getByPlaca(cleanPlaca);
      if (!existing) {
        return { success: false, error: `Unidad con placa ${cleanPlaca} no encontrada` };
      }

      const now = Math.floor(Date.now() / 1000);
      const update = db.prepare(`
        UPDATE fleet 
        SET imei = ?, modeloGps = ?, actualizadoEn = ?
        WHERE placa = ?
      `);
      update.run(cleanImei, (modeloGps || 'TELTONIKA_FMB920').toString().trim().toUpperCase(), now, cleanPlaca);

      const updated = this.getByPlaca(cleanPlaca);
      return { success: true, unit: updated };
    } catch (err) {
      console.error('[FleetStore] Error asignando GPS:', err.message);
      return { success: false, error: err.message };
    }
  }

  unassignGps(placa) {
    const cleanPlaca = normalizePlaca(placa);
    if (!cleanPlaca) return { success: false, error: 'Placa inválida' };

    try {
      const existing = this.getByPlaca(cleanPlaca);
      if (!existing) return { success: false, error: 'Unidad no encontrada' };

      const now = Math.floor(Date.now() / 1000);
      const update = db.prepare(`
        UPDATE fleet 
        SET imei = '', modeloGps = '', actualizadoEn = ?
        WHERE placa = ?
      `);
      update.run(now, cleanPlaca);

      const updated = this.getByPlaca(cleanPlaca);
      return { success: true, unit: updated };
    } catch (err) {
      console.error('[FleetStore] Error desasignando GPS:', err.message);
      return { success: false, error: err.message };
    }
  }

  deleteUnit(placa) {
    const cleanPlaca = normalizePlaca(placa);
    if (!cleanPlaca) return { success: false, error: 'Placa inválida' };

    try {
      const del = db.prepare('DELETE FROM fleet WHERE placa = ?');
      const res = del.run(cleanPlaca);
      if (res.changes === 0) {
        return { success: false, error: 'Unidad no encontrada' };
      }
      return { success: true };
    } catch (err) {
      console.error('[FleetStore] Error eliminando unidad:', err.message);
      return { success: false, error: err.message };
    }
  }

  getStats() {
    try {
      const totalStmt = db.prepare('SELECT COUNT(*) AS total FROM fleet');
      const conGpsStmt = db.prepare("SELECT COUNT(*) AS conGps FROM fleet WHERE imei IS NOT NULL AND length(trim(imei)) >= 10");

      const total = totalStmt.get().total;
      const conGps = conGpsStmt.get().conGps;
      const sinGps = total - conGps;

      return { total, conGps, sinGps };
    } catch (err) {
      console.error('[FleetStore] Error obteniendo estadísticas:', err.message);
      return { total: 0, conGps: 0, sinGps: 0 };
    }
  }
}

module.exports = new FleetStore();
