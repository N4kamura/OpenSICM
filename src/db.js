/**
 * OpenSICM - Módulo de Base de Datos SQLite Embebida
 * Utiliza el motor nativo node:sqlite de Node.js (cero dependencias externas).
 * Base de datos almacenada en data/opensicm.db
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '../data');
const DB_FILE = path.join(DB_DIR, 'opensicm.db');

// Asegurar que el directorio de datos existe
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Inicializar conexión sincrónica a SQLite
const db = new DatabaseSync(DB_FILE);

// Habilitar modo WAL para concurrencia óptima y bajo consumo
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS fleet (
    placa TEXT PRIMARY KEY,
    ruta TEXT NOT NULL,
    padron TEXT,
    imei TEXT,
    modeloGps TEXT,
    activo INTEGER DEFAULT 1,
    notas TEXT,
    creadoEn INTEGER,
    actualizadoEn INTEGER
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_imei 
  ON fleet (imei) WHERE imei IS NOT NULL AND imei != '';

  CREATE TABLE IF NOT EXISTS daily_unit_kpis (
    fecha TEXT NOT NULL,
    placa TEXT NOT NULL,
    ruta TEXT,
    padron TEXT,
    km_recorridos REAL DEFAULT 0.0,
    segundos_motor INTEGER DEFAULT 0,
    tramas_enviadas INTEGER DEFAULT 0,
    tramas_ack INTEGER DEFAULT 0,
    blackouts_count INTEGER DEFAULT 0,
    velocidad_max REAL DEFAULT 0.0,
    ultimo_reporte INTEGER,
    actualizado_en INTEGER,
    PRIMARY KEY (fecha, placa)
  );

  CREATE TABLE IF NOT EXISTS kpi_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    placa TEXT NOT NULL,
    severidad TEXT NOT NULL,
    detalles TEXT NOT NULL,
    latitud REAL,
    longitud REAL
  );

  CREATE INDEX IF NOT EXISTS idx_kpi_alerts_fecha 
  ON kpi_alerts (fecha, timestamp DESC);

  /* --- TABLAS DEL ESTÁNDAR GTFS FRECUENCIAL / GEOMÉTRICO --- */
  CREATE TABLE IF NOT EXISTS gtfs_agency (
    agency_id TEXT PRIMARY KEY,
    agency_name TEXT NOT NULL,
    agency_url TEXT,
    agency_timezone TEXT DEFAULT 'America/Lima'
  );

  CREATE TABLE IF NOT EXISTS gtfs_routes (
    route_id TEXT PRIMARY KEY,
    agency_id TEXT,
    route_short_name TEXT NOT NULL,
    route_long_name TEXT,
    route_type INTEGER DEFAULT 3
  );

  CREATE TABLE IF NOT EXISTS gtfs_shapes (
    shape_id TEXT NOT NULL,
    shape_pt_lat REAL NOT NULL,
    shape_pt_lon REAL NOT NULL,
    shape_pt_sequence INTEGER NOT NULL,
    PRIMARY KEY (shape_id, shape_pt_sequence)
  );

  CREATE INDEX IF NOT EXISTS idx_gtfs_shapes_seq 
  ON gtfs_shapes (shape_id, shape_pt_sequence);

  CREATE TABLE IF NOT EXISTS gtfs_stops (
    stop_id TEXT PRIMARY KEY,
    stop_name TEXT NOT NULL,
    stop_lat REAL NOT NULL,
    stop_lon REAL NOT NULL,
    location_type INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS gtfs_trips (
    trip_id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL,
    shape_id TEXT,
    direction_id INTEGER DEFAULT 0,
    trip_headsign TEXT
  );

  CREATE TABLE IF NOT EXISTS gtfs_frequencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    headway_secs INTEGER NOT NULL
  );
`);

module.exports = db;
