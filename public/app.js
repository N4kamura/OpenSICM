/**
 * OpenSICM - Lógica de Visualización y Monitoreo en Tiempo Real
 * Vanilla JavaScript (ES6+) con Leaflet.js y Server-Sent Events (SSE)
 */

(function () {
  'use strict';

  // Coordenadas por defecto (Centro de Lima y Callao)
  const LIMA_COORDS = [-12.046374, -77.042793];
  const DEFAULT_ZOOM = 12;

  // Estado Local
  const state = {
    buses: new Map(),
    markers: new Map(),
    currentFilter: 'TODOS',
    searchQuery: '',
    selectedPlaca: null,
    atuStatus: 'DESCONECTADO'
  };

  // Inicialización de Mapa Leaflet
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView(LIMA_COORDS, DEFAULT_ZOOM);

  // Capa Base OpenStreetMap CartoDB Dark / Voyager
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  // Atribución discreta
  L.control.attribution({ position: 'bottomleft' })
    .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &bull; OpenSICM')
    .addTo(map);

  // Elementos del DOM
  const elAtuStatusText = document.getElementById('atu-status-text');
  const elAtuDot = document.getElementById('atu-dot');
  const elCountSent = document.getElementById('count-sent');
  const elCountAck = document.getElementById('count-ack');
  const elCountQueue = document.getElementById('count-queue');
  const elCountUnits = document.getElementById('count-units');
  const elBusList = document.getElementById('bus-list');
  const elBusSearch = document.getElementById('bus-search');
  const elActivityLog = document.getElementById('activity-log');
  const elFilterAll = document.getElementById('filter-all-count');
  const elFilterMov = document.getElementById('filter-mov-count');
  const elFilterDet = document.getElementById('filter-det-count');
  const elFilterOff = document.getElementById('filter-off-count');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnRecenter = document.getElementById('btn-recenter');
  const sidebar = document.getElementById('sidebar');

  /**
   * Genera el SVG del marcador del bus rotado según el rumbo
   */
  function createBusIconHtml(bus) {
    const status = bus.estadoOperacional || 'OFFLINE';
    let color = '#ef4444'; // Rojo por defecto
    if (status === 'MOVIMIENTO') color = '#10b981'; // Verde
    else if (status === 'DETENIDO') color = '#f59e0b'; // Amarillo

    const rumbo = bus.rumbo || 0;

    return `
      <div class="custom-bus-marker">
        <div class="bus-marker-plate">${bus.placa}</div>
        <div class="bus-marker-icon" style="transform: rotate(${rumbo}deg);">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Sombra de base -->
            <ellipse cx="20" cy="22" rx="14" ry="16" fill="rgba(0,0,0,0.3)"/>
            <!-- Carrocería de Bus con Flecha Direccional -->
            <path d="M12 10C12 5.5 15.5 2 20 2C24.5 2 28 5.5 28 10V32C28 35.3 25.3 38 22 38H18C14.7 38 12 35.3 12 32V10Z" fill="${color}" stroke="#ffffff" stroke-width="1.8"/>
            <!-- Parabrisas frontal orientado hacia arriba (0 deg) -->
            <path d="M14 8C14 6.5 16.5 5 20 5C23.5 5 26 6.5 26 8V13H14V8Z" fill="#1e293b"/>
            <!-- Ventanillas laterales -->
            <rect x="14" y="16" width="3" height="14" rx="1" fill="#334155"/>
            <rect x="23" y="16" width="3" height="14" rx="1" fill="#334155"/>
            <!-- Faros delanteros -->
            <circle cx="15" cy="4" r="1.5" fill="#fef08a"/>
            <circle cx="25" cy="4" r="1.5" fill="#fef08a"/>
          </svg>
        </div>
      </div>
    `;
  }

  /**
   * Genera el contenido del Popup con detalles técnicos
   */
  function createPopupContent(bus) {
    const hora = bus.timestamp ? new Date(bus.timestamp * 1000).toLocaleTimeString() : '--:--:--';
    const statusAtu = bus.atuStatus || 'PENDIENTE';
    const ignicionText = bus.ignicion === 1 ? 'ENCENDIDO (ACC ON)' : 'APAGADO';

    return `
      <div class="popup-container">
        <div class="popup-header">
          <div>
            <span class="popup-plate">${bus.placa}</span>
            <span class="bus-ruta-badge" style="margin-left: 6px;">${bus.ruta || 'S/R'}</span>
          </div>
          <span class="atu-badge atu-${statusAtu}">${statusAtu}</span>
        </div>
        <div class="popup-grid">
          <div class="popup-item">
            <span class="popup-lbl">Velocidad</span>
            <span class="popup-val">${bus.velocidad} km/h</span>
          </div>
          <div class="popup-item">
            <span class="popup-lbl">Rumbo</span>
            <span class="popup-val">${bus.rumbo}°</span>
          </div>
          <div class="popup-item">
            <span class="popup-lbl">Padrón</span>
            <span class="popup-val">${bus.padron || 'S/P'}</span>
          </div>
          <div class="popup-item">
            <span class="popup-lbl">Motor</span>
            <span class="popup-val" style="font-size: 0.7rem;">${ignicionText}</span>
          </div>
          <div class="popup-item">
            <span class="popup-lbl">GPS</span>
            <span class="popup-val" style="font-size: 0.68rem;">${bus.modeloGps || 'DESCONOCIDO'}</span>
          </div>
          <div class="popup-item">
            <span class="popup-lbl">Hora Reporte</span>
            <span class="popup-val">${hora}</span>
          </div>
        </div>
        <div class="popup-footer">
          <span style="color: var(--text-dim); font-size: 0.65rem;">IMEI: ${bus.imei || '-'}</span>
          <span style="color: var(--text-dim); font-size: 0.65rem;">Lat: ${bus.latitud?.toFixed(4)}, Lon: ${bus.longitud?.toFixed(4)}</span>
        </div>
      </div>
    `;
  }

  /**
   * Actualiza o crea el marcador en el mapa Leaflet
   */
  function updateMapMarker(bus) {
    if (!bus.latitud || !bus.longitud) return;

    const latLng = [bus.latitud, bus.longitud];
    let marker = state.markers.get(bus.placa);

    const icon = L.divIcon({
      className: 'bus-div-icon',
      html: createBusIconHtml(bus),
      iconSize: [44, 48],
      iconAnchor: [22, 24],
      popupAnchor: [0, -22]
    });

    if (!marker) {
      marker = L.marker(latLng, { icon: icon }).addTo(map);
      marker.bindPopup(createPopupContent(bus));
      marker.on('click', () => {
        selectBus(bus.placa, false);
      });
      state.markers.set(bus.placa, marker);
    } else {
      marker.setLatLng(latLng);
      marker.setIcon(icon);
      marker.setPopupContent(createPopupContent(bus));
    }
  }

  /**
   * Selecciona y enfoca una unidad en el mapa
   */
  function selectBus(placa, panTo = true) {
    state.selectedPlaca = placa;
    const bus = state.buses.get(placa);
    if (!bus) return;

    if (panTo && bus.latitud && bus.longitud) {
      map.flyTo([bus.latitud, bus.longitud], 15, { duration: 0.8 });
      const marker = state.markers.get(placa);
      if (marker) marker.openPopup();
    }

    renderBusList();
  }

  /**
   * Renderiza la lista lateral de unidades filtradas
   */
  function renderBusList() {
    const list = Array.from(state.buses.values());

    // Conteo para los botones de filtro
    let movCount = 0;
    let detCount = 0;
    let offCount = 0;

    list.forEach(b => {
      const st = b.estadoOperacional || 'OFFLINE';
      if (st === 'MOVIMIENTO') movCount++;
      else if (st === 'DETENIDO') detCount++;
      else offCount++;
    });

    elFilterAll.textContent = list.length;
    elFilterMov.textContent = movCount;
    elFilterDet.textContent = detCount;
    elFilterOff.textContent = offCount;
    elCountUnits.textContent = list.length;

    // Filtrar según estado y texto de búsqueda
    const q = state.searchQuery.toLowerCase().trim();
    const filtered = list.filter(b => {
      const matchesFilter = state.currentFilter === 'TODOS' || b.estadoOperacional === state.currentFilter;
      const matchesSearch = !q ||
        (b.placa && b.placa.toLowerCase().includes(q)) ||
        (b.ruta && b.ruta.toLowerCase().includes(q)) ||
        (b.padron && b.padron.toString().toLowerCase().includes(q));

      return matchesFilter && matchesSearch;
    });

    if (filtered.length === 0) {
      elBusList.innerHTML = `
        <div class="empty-state">
          <p>No se encontraron unidades</p>
          <small>Pruebe con otro filtro o término de búsqueda.</small>
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach(bus => {
      const isSelected = bus.placa === state.selectedPlaca;
      const st = bus.estadoOperacional || 'OFFLINE';
      const color = st === 'MOVIMIENTO' ? 'var(--color-green)' : (st === 'DETENIDO' ? 'var(--color-yellow)' : 'var(--color-red)');
      const hora = bus.timestamp ? new Date(bus.timestamp * 1000).toLocaleTimeString() : '--:--:--';
      const atuSt = bus.atuStatus || 'PENDIENTE';

      html += `
        <div class="bus-card ${isSelected ? 'active-selected' : ''}" data-placa="${bus.placa}">
          <div class="bus-card-strip" style="background-color: ${color};"></div>
          <div class="bus-card-header">
            <div>
              <span class="bus-placa-badge">${bus.placa}</span>
              <span class="bus-ruta-badge" style="margin-left: 6px;">${bus.ruta || 'S/R'}</span>
            </div>
            <span class="atu-badge atu-${atuSt}">${atuSt}</span>
          </div>
          <div class="bus-card-details">
            <div>Vel: <strong>${bus.velocidad} km/h</strong></div>
            <div>Rumbo: <strong>${bus.rumbo}°</strong></div>
            <div>Padrón: <strong>${bus.padron || '-'}</strong></div>
            <div>Hora: <strong>${hora}</strong></div>
          </div>
        </div>
      `;
    });

    elBusList.innerHTML = html;

    // Vincular clicks
    elBusList.querySelectorAll('.bus-card').forEach(card => {
      card.addEventListener('click', () => {
        const placa = card.getAttribute('data-placa');
        selectBus(placa, true);
      });
    });
  }

  /**
   * Agrega una línea al registro de actividad en vivo
   */
  function appendLog(text) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${text}`;

    elActivityLog.appendChild(entry);
    if (elActivityLog.children.length > 50) {
      elActivityLog.removeChild(elActivityLog.firstChild);
    }
    elActivityLog.scrollTop = elActivityLog.scrollHeight;
  }

  /**
   * Actualiza los elementos del estado ATU en la barra superior
   */
  function updateAtuUi(statusData) {
    const status = statusData.status || statusData;
    state.atuStatus = status;

    elAtuStatusText.textContent = status;
    elAtuStatusText.className = `status-value text-${status.toLowerCase()}`;

    elAtuDot.className = `status-dot status-${status.toLowerCase()}`;

    if (statusData.metrics) {
      elCountSent.textContent = statusData.metrics.sentCount || 0;
      elCountAck.textContent = statusData.metrics.ackCount || 0;
      elCountQueue.textContent = statusData.metrics.queueSize || 0;
    }
  }

  /**
   * Conexión Server-Sent Events (SSE) con el Gateway
   */
  function initSse() {
    appendLog('Conectando al canal de telemetría en tiempo real...');
    const evtSource = new EventSource('/api/stream');

    evtSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.atu) updateAtuUi(data.atu);
        if (data.buses && Array.isArray(data.buses)) {
          data.buses.forEach(b => {
            state.buses.set(b.placa, b);
            updateMapMarker(b);
          });
          renderBusList();
          appendLog(`Cargadas ${data.buses.length} unidades activas.`);
        }
      } catch (err) {
        console.error('Error parseando init data:', err);
      }
    });

    evtSource.addEventListener('telemetry', (e) => {
      try {
        const bus = JSON.parse(e.data);
        state.buses.set(bus.placa, bus);
        updateMapMarker(bus);
        renderBusList();
        appendLog(`📡 Telemetría: ${bus.placa} (${bus.ruta}) ${bus.velocidad} km/h`);
      } catch (err) {
        console.error('Error en evento telemetry:', err);
      }
    });

    evtSource.addEventListener('atu_status', (e) => {
      try {
        const data = JSON.parse(e.data);
        updateAtuUi(data);
        appendLog(`🔄 Enlace ATU: ${data.status}`);
      } catch (err) {
        console.error('Error en evento atu_status:', err);
      }
    });

    evtSource.addEventListener('atu_ack', (e) => {
      try {
        const ack = JSON.parse(e.data);
        if (ack.placa) {
          const bus = state.buses.get(ack.placa);
          if (bus) {
            bus.atuStatus = 'CONFIRMADO';
            updateMapMarker(bus);
            renderBusList();
          }
          appendLog(`✅ ACK ATU: ${ack.placa}`);
        }
        // Incrementar contador visual
        const curAck = parseInt(elCountAck.textContent || '0', 10);
        elCountAck.textContent = curAck + 1;
      } catch (err) {
        console.error('Error en evento atu_ack:', err);
      }
    });

    evtSource.onerror = () => {
      updateAtuUi('DESCONECTADO');
      appendLog('Conexión con Gateway interrumpida. Reintentando...');
    };
  }

  // --- EVENT LISTENERS ---

  // Filtros de estado (Todos, En Marcha, Parados, Offline)
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.currentFilter = pill.getAttribute('data-filter');
      renderBusList();
    });
  });

  // Búsqueda en vivo
  elBusSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderBusList();
  });

  // Alternar barra lateral
  btnToggleSidebar.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    setTimeout(() => {
      map.invalidateSize();
    }, 320);
  });

  // Recentrar mapa en Lima
  btnRecenter.addEventListener('click', () => {
    map.flyTo(LIMA_COORDS, DEFAULT_ZOOM, { duration: 1.0 });
  });

  // Iniciar conexión en tiempo real al cargar página
  initSse();

})();
