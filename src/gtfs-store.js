/**
 * OpenSICM - Gestor de Datos y Especificación GTFS (SQLite)
 * Almacena y genera los archivos del estándar GTFS frecuencial/geométrico:
 * agency.txt, routes.txt, shapes.txt, stops.txt, trips.txt, frequencies.txt
 */
const db = require('./db');

class GtfsStore {
  constructor() {
    this.initDefaultData();
  }

  /**
   * Inicializa datos base si la BD está vacía
   */
  initDefaultData() {
    try {
      const agencyCount = db.prepare('SELECT COUNT(*) AS total FROM gtfs_agency').get().total;
      if (agencyCount === 0) {
        console.log('[GtfsStore] Inicializando datos GTFS de demostración para Lima...');

        // 1. Empresa / Agencia
        db.prepare(`
          INSERT INTO gtfs_agency (agency_id, agency_name, agency_url, agency_timezone)
          VALUES (?, ?, ?, ?)
        `).run('EMP_LIMA', 'Empresa de Transportes Lima & Callao S.A.', 'https://atu.gob.pe', 'America/Lima');

        // 2. Rutas
        const insertRoute = db.prepare(`
          INSERT INTO gtfs_routes (route_id, agency_id, route_short_name, route_long_name, route_type)
          VALUES (?, ?, ?, ?, ?)
        `);
        insertRoute.run('IO33B', 'EMP_LIMA', 'IO33B', 'Ventanilla - Javier Prado - V.E.S.', 3);
        insertRoute.run('CR42', 'EMP_LIMA', 'CR42', 'Callao - La Marina - Av. Brasil', 3);

        // 3. Paraderos y Terminales iniciales
        const insertStop = db.prepare(`
          INSERT INTO gtfs_stops (stop_id, stop_name, stop_lat, stop_lon, location_type)
          VALUES (?, ?, ?, ?, ?)
        `);
        insertStop.run('TERM_PACHACUTEC', 'Terminal Norte Pachacútec', -11.874520, -77.125400, 1);
        insertStop.run('PAR_DOS_DE_MAYO', 'Paradero Plaza 2 de Mayo', -12.046374, -77.042793, 0);
        insertStop.run('PAR_TREBOL_JP', 'Paradero Trébol Javier Prado', -12.083812, -76.971038, 0);
        insertStop.run('PAR_VIA_EXPRESA', 'Paradero Vía Expresa / Canaval Moreyra', -12.091215, -77.026478, 0);
        insertStop.run('TERM_VES', 'Terminal Sur Villa El Salvador', -12.185400, -76.994100, 1);

        // 4. Trazo geométrico de demostración (shapes.txt - Tramo Javier Prado)
        const insertShape = db.prepare(`
          INSERT INTO gtfs_shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence)
          VALUES (?, ?, ?, ?)
        `);
        const samplePoints = [
          [-12.083812, -76.971038], // Óvalo Monitor
          [-12.085500, -76.974500],
          [-12.087200, -76.978200],
          [-12.088900, -76.982500],
          [-12.090500, -76.988000],
          [-12.091215, -77.026478]  // Cruce Vía Expresa
        ];
        samplePoints.forEach((pt, idx) => {
          insertShape.run('IO33B_IDA', pt[0], pt[1], idx + 1);
        });

        // 5. Estructura de Viajes (trips.txt)
        const insertTrip = db.prepare(`
          INSERT INTO gtfs_trips (trip_id, route_id, shape_id, direction_id, trip_headsign)
          VALUES (?, ?, ?, ?, ?)
        `);
        insertTrip.run('IO33B_IDA_PATTERN', 'IO33B', 'IO33B_IDA', 0, 'Hacia Villa El Salvador');
        insertTrip.run('IO33B_VTA_PATTERN', 'IO33B', 'IO33B_VUELTA', 1, 'Hacia Ventanilla');

        // 6. Frecuencias de Despacho (frequencies.txt)
        const insertFreq = db.prepare(`
          INSERT INTO gtfs_frequencies (trip_id, start_time, end_time, headway_secs)
          VALUES (?, ?, ?, ?)
        `);
        insertFreq.run('IO33B_IDA_PATTERN', '05:30:00', '09:00:00', 240); // Cada 4 minutos en punta
        insertFreq.run('IO33B_IDA_PATTERN', '09:00:00', '17:30:00', 420); // Cada 7 minutos en valle
        insertFreq.run('IO33B_IDA_PATTERN', '17:30:00', '21:30:00', 240); // Cada 4 minutos en punta noche
      }
    } catch (err) {
      console.error('[GtfsStore] Error inicializando datos GTFS:', err.message);
    }
  }

  // --- AGENCY ---
  getAgency(agencyId = null) {
    try {
      if (agencyId) {
        return db.prepare('SELECT * FROM gtfs_agency WHERE agency_id = ?').get() || null;
      }
      const row = db.prepare('SELECT * FROM gtfs_agency LIMIT 1').get();
      return row || null;
    } catch (e) {
      return null;
    }
  }

  deleteAgency(agencyId = null) {
    try {
      if (agencyId) {
        db.prepare('DELETE FROM gtfs_agency WHERE agency_id = ?').run(agencyId);
      } else {
        db.prepare('DELETE FROM gtfs_agency').run();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  saveAgency(data) {
    const id = (data.agency_id || 'EMP_LIMA').trim();
    const name = (data.agency_name || 'Empresa de Transporte').trim();
    const url = (data.agency_url || 'https://atu.gob.pe').trim();
    const tz = (data.agency_timezone || 'America/Lima').trim();

    try {
      // Garantizar empresa única en el sistema
      db.prepare('DELETE FROM gtfs_agency WHERE agency_id != ?').run(id);

      db.prepare(`
        INSERT INTO gtfs_agency (agency_id, agency_name, agency_url, agency_timezone)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agency_id) DO UPDATE SET
          agency_name = excluded.agency_name,
          agency_url = excluded.agency_url,
          agency_timezone = excluded.agency_timezone
      `).run(id, name, url, tz);
      return { success: true, agency: this.getAgency(id) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- ROUTES ---
  getRoutes() {
    try {
      return db.prepare('SELECT * FROM gtfs_routes ORDER BY route_short_name').all();
    } catch (e) {
      return [];
    }
  }

  saveRoute(data) {
    const routeId = (data.route_id || data.route_short_name || '').trim().toUpperCase();
    if (!routeId) return { success: false, error: 'Código de ruta es requerido' };

    const agency = this.getAgency();
    const agencyId = (data.agency_id || (agency ? agency.agency_id : 'EMP_LIMA')).trim();
    const shortName = (data.route_short_name || routeId).trim().toUpperCase();
    const longName = (data.route_long_name || '').trim();
    const routeType = parseInt(data.route_type || '3', 10);

    try {
      db.prepare(`
        INSERT INTO gtfs_routes (route_id, agency_id, route_short_name, route_long_name, route_type)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(route_id) DO UPDATE SET
          agency_id = excluded.agency_id,
          route_short_name = excluded.route_short_name,
          route_long_name = excluded.route_long_name,
          route_type = excluded.route_type
      `).run(routeId, agencyId, shortName, longName, routeType);
      return { success: true, route: { route_id: routeId, agency_id: agencyId, route_short_name: shortName, route_long_name: longName, route_type: routeType } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  deleteRoute(routeId) {
    try {
      db.prepare('DELETE FROM gtfs_routes WHERE route_id = ?').run(routeId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- STOPS ---
  getStops() {
    try {
      return db.prepare('SELECT * FROM gtfs_stops ORDER BY location_type DESC, stop_name ASC').all();
    } catch (e) {
      return [];
    }
  }

  saveStop(data) {
    const stopId = (data.stop_id || '').trim().toUpperCase();
    const oldStopId = data.old_stop_id ? data.old_stop_id.trim().toUpperCase() : null;
    const name = (data.stop_name || '').trim();
    const lat = parseFloat(data.stop_lat);
    const lon = parseFloat(data.stop_lon);
    const locType = parseInt(data.location_type || '0', 10);

    if (!stopId || !name) return { success: false, error: 'Identificador y nombre de paradero son requeridos' };
    if (isNaN(lat) || isNaN(lon)) return { success: false, error: 'Coordenadas latitud y longitud inválidas' };

    try {
      if (oldStopId && oldStopId !== stopId) {
        db.prepare('DELETE FROM gtfs_stops WHERE stop_id = ?').run(oldStopId);
      }
      db.prepare(`
        INSERT INTO gtfs_stops (stop_id, stop_name, stop_lat, stop_lon, location_type)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(stop_id) DO UPDATE SET
          stop_name = excluded.stop_name,
          stop_lat = excluded.stop_lat,
          stop_lon = excluded.stop_lon,
          location_type = excluded.location_type
      `).run(stopId, name, lat, lon, locType);
      return { success: true, stop: { stop_id: stopId, stop_name: name, stop_lat: lat, stop_lon: lon, location_type: locType } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  deleteStop(stopId) {
    try {
      db.prepare('DELETE FROM gtfs_stops WHERE stop_id = ?').run(stopId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- SHAPES (GEOMETRÍA DE RUTA) ---
  getShapeList() {
    try {
      const stmt = db.prepare(`
        SELECT shape_id, COUNT(*) AS total_puntos,
               MIN(shape_pt_sequence) AS min_seq,
               MAX(shape_pt_sequence) AS max_seq
        FROM gtfs_shapes
        GROUP BY shape_id
        ORDER BY shape_id
      `);
      return stmt.all();
    } catch (e) {
      return [];
    }
  }

  getShapePoints(shapeId) {
    try {
      const stmt = db.prepare(`
        SELECT shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence
        FROM gtfs_shapes
        WHERE shape_id = ?
        ORDER BY shape_pt_sequence ASC
      `);
      return stmt.all(shapeId);
    } catch (e) {
      return [];
    }
  }

  /**
   * Guarda o reemplaza un trazo geométrico completo
   * @param {string} shapeId 
   * @param {Array<{lat: number, lon: number}>} points 
   */
  saveShape(shapeId, points, oldShapeId = null) {
    const cleanId = (shapeId || '').trim().toUpperCase();
    const cleanOldId = oldShapeId ? (oldShapeId || '').trim().toUpperCase() : null;
    if (!cleanId) return { success: false, error: 'Identificador de Shape requerido (ej. IO33B_IDA)' };
    if (!Array.isArray(points) || points.length === 0) {
      return { success: false, error: 'Debe incluir al menos un punto de coordenadas' };
    }

    try {
      // Si se renombró el trazo (cleanOldId !== cleanId), eliminar el anterior y migrar viajes asociados
      if (cleanOldId && cleanOldId !== cleanId) {
        db.prepare('DELETE FROM gtfs_shapes WHERE shape_id = ?').run(cleanOldId);
        db.prepare('UPDATE gtfs_trips SET shape_id = ? WHERE shape_id = ?').run(cleanId, cleanOldId);
      }

      // Reemplazo atómico: borrar puntos anteriores e insertar nueva secuencia
      db.prepare('DELETE FROM gtfs_shapes WHERE shape_id = ?').run(cleanId);

      const insert = db.prepare(`
        INSERT INTO gtfs_shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence)
        VALUES (?, ?, ?, ?)
      `);

      points.forEach((pt, index) => {
        const lat = parseFloat(pt.lat !== undefined ? pt.lat : pt.shape_pt_lat);
        const lon = parseFloat(pt.lon !== undefined ? pt.lon : pt.shape_pt_lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          insert.run(cleanId, lat, lon, index + 1);
        }
      });

      return { success: true, shapeId: cleanId, totalPoints: points.length, renamedFrom: cleanOldId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  renameShape(oldShapeId, newShapeId) {
    const oldId = (oldShapeId || '').trim().toUpperCase();
    const newId = (newShapeId || '').trim().toUpperCase();
    if (!oldId || !newId) return { success: false, error: 'Identificadores requeridos' };
    if (oldId === newId) return { success: true, shapeId: newId };
    try {
      db.prepare('UPDATE gtfs_shapes SET shape_id = ? WHERE shape_id = ?').run(newId, oldId);
      db.prepare('UPDATE gtfs_trips SET shape_id = ? WHERE shape_id = ?').run(newId, oldId);
      return { success: true, shapeId: newId, oldShapeId: oldId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  deleteShape(shapeId) {
    try {
      db.prepare('DELETE FROM gtfs_shapes WHERE shape_id = ?').run(shapeId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- TRIPS ---
  getTrips(routeId = null) {
    try {
      if (routeId) {
        return db.prepare('SELECT * FROM gtfs_trips WHERE route_id = ? ORDER BY direction_id, trip_id').all(routeId);
      }
      return db.prepare('SELECT * FROM gtfs_trips ORDER BY route_id, direction_id').all();
    } catch (e) {
      return [];
    }
  }

  saveTrip(data) {
    const tripId = (data.trip_id || '').trim().toUpperCase();
    const routeId = (data.route_id || '').trim().toUpperCase();
    const shapeId = (data.shape_id || '').trim().toUpperCase();
    const dirId = parseInt(data.direction_id || '0', 10);
    const headsign = (data.trip_headsign || '').trim();

    if (!tripId || !routeId) return { success: false, error: 'Trip ID y Route ID son requeridos' };

    try {
      db.prepare(`
        INSERT INTO gtfs_trips (trip_id, route_id, shape_id, direction_id, trip_headsign)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(trip_id) DO UPDATE SET
          route_id = excluded.route_id,
          shape_id = excluded.shape_id,
          direction_id = excluded.direction_id,
          trip_headsign = excluded.trip_headsign
      `).run(tripId, routeId, shapeId, dirId, headsign);
      return { success: true, trip: { trip_id: tripId, route_id: routeId, shape_id: shapeId, direction_id: dirId, trip_headsign: headsign } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  deleteTrip(tripId) {
    try {
      db.prepare('DELETE FROM gtfs_trips WHERE trip_id = ?').run(tripId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- FREQUENCIES ---
  getFrequencies(tripId = null) {
    try {
      if (tripId) {
        return db.prepare('SELECT * FROM gtfs_frequencies WHERE trip_id = ? ORDER BY start_time ASC').all(tripId);
      }
      return db.prepare('SELECT * FROM gtfs_frequencies ORDER BY trip_id, start_time ASC').all();
    } catch (e) {
      return [];
    }
  }

  saveFrequency(data) {
    const tripId = (data.trip_id || '').trim().toUpperCase();
    const startTime = (data.start_time || '06:00:00').trim();
    const endTime = (data.end_time || '22:00:00').trim();
    const headwaySecs = parseInt(data.headway_secs || '300', 10);

    if (!tripId) return { success: false, error: 'Trip ID es requerido' };

    try {
      if (data.id) {
        db.prepare(`
          UPDATE gtfs_frequencies 
          SET trip_id = ?, start_time = ?, end_time = ?, headway_secs = ?
          WHERE id = ?
        `).run(tripId, startTime, endTime, headwaySecs, data.id);
      } else {
        db.prepare(`
          INSERT INTO gtfs_frequencies (trip_id, start_time, end_time, headway_secs)
          VALUES (?, ?, ?, ?)
        `).run(tripId, startTime, endTime, headwaySecs);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  deleteFrequency(id) {
    try {
      db.prepare('DELETE FROM gtfs_frequencies WHERE id = ?').run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- EXPORTADORES CSV EN FORMATO ESTÁNDAR GTFS ---
  exportCsv(filename) {
    const clean = filename.toLowerCase();

    if (clean === 'agency.txt') {
      const a = this.getAgency();
      if (!a) return 'agency_id,agency_name,agency_url,agency_timezone\n';
      return `agency_id,agency_name,agency_url,agency_timezone\n"${a.agency_id}","${a.agency_name}","${a.agency_url}","${a.agency_timezone}"\n`;
    }

    if (clean === 'routes.txt') {
      const routes = this.getRoutes();
      let csv = 'route_id,agency_id,route_short_name,route_long_name,route_type\n';
      routes.forEach(r => {
        csv += `"${r.route_id}","${r.agency_id || ''}","${r.route_short_name}","${r.route_long_name || ''}",${r.route_type}\n`;
      });
      return csv;
    }

    if (clean === 'shapes.txt') {
      const shapes = db.prepare('SELECT * FROM gtfs_shapes ORDER BY shape_id, shape_pt_sequence ASC').all();
      let csv = 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n';
      shapes.forEach(s => {
        csv += `"${s.shape_id}",${s.shape_pt_lat},${s.shape_pt_lon},${s.shape_pt_sequence}\n`;
      });
      return csv;
    }

    if (clean === 'stops.txt') {
      const stops = this.getStops();
      let csv = 'stop_id,stop_name,stop_lat,stop_lon,location_type\n';
      stops.forEach(s => {
        csv += `"${s.stop_id}","${s.stop_name}",${s.stop_lat},${s.stop_lon},${s.location_type}\n`;
      });
      return csv;
    }

    if (clean === 'trips.txt') {
      const trips = this.getTrips();
      let csv = 'route_id,trip_id,shape_id,direction_id,trip_headsign\n';
      trips.forEach(t => {
        csv += `"${t.route_id}","${t.trip_id}","${t.shape_id || ''}",${t.direction_id},"${t.trip_headsign || ''}"\n`;
      });
      return csv;
    }

    if (clean === 'frequencies.txt') {
      const freqs = this.getFrequencies();
      let csv = 'trip_id,start_time,end_time,headway_secs\n';
      freqs.forEach(f => {
        csv += `"${f.trip_id}","${f.start_time}","${f.end_time}",${f.headway_secs}\n`;
      });
      return csv;
    }

    return null;
  }
}

module.exports = new GtfsStore();
