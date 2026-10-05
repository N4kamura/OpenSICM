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

  // Capa Base 100% Gratuita de OpenStreetMap (Sin API Key, Sin Carto, Cero Costo)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> colaboradores'
  }).addTo(map);

  // Elementos del DOM
  const elAtuStatusText = document.getElementById('atu-status-text');
  const elAtuDot = document.getElementById('atu-dot');
  const elCountSent = document.getElementById('count-sent');
  const elCountAck = document.getElementById('count-ack');
  const elCountQueue = document.getElementById('count-queue');
  const elCountUnits = document.getElementById('count-units');
  const elBusList = document.getElementById('bus-list');
  const elBusSearch = document.getElementById('bus-search');
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
          <svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Sombra de base -->
            <ellipse cx="22" cy="24" rx="15" ry="17" fill="rgba(0,0,0,0.4)"/>
            <!-- Carrocería de Bus Urbano con Cabina Frontal -->
            <rect x="13" y="6" width="18" height="32" rx="4" fill="${color}" stroke="#ffffff" stroke-width="2"/>
            <!-- Flecha Direccional de Rumbo hacia arriba -->
            <polygon points="22,1 17,7 27,7" fill="#ffffff" stroke="${color}" stroke-width="1"/>
            <!-- Parabrisas frontal -->
            <rect x="15" y="8" width="14" height="6" rx="1.5" fill="#0f172a"/>
            <!-- Ventanillas laterales -->
            <rect x="14" y="16" width="3" height="16" rx="1" fill="#1e293b"/>
            <rect x="27" y="16" width="3" height="16" rx="1" fill="#1e293b"/>
            <!-- Techo / línea central -->
            <line x1="22" y1="16" x2="22" y2="34" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
            <!-- Luces delanteras -->
            <circle cx="15.5" cy="7" r="1.5" fill="#fef08a"/>
            <circle cx="28.5" cy="7" r="1.5" fill="#fef08a"/>
          </svg>
        </div>
      </div>
    `;
  }

  /**
   * Genera el contenido del Popup con detalles técnicos y botón para ver trama
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
        <button class="btn-view-trama" onclick="window.inspectTrama('${bus.placa}')">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
          📋 Ver Trama JSON ATU
        </button>
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

      html += `
        <div class="bus-card ${isSelected ? 'active-selected' : ''}" data-placa="${bus.placa}" title="${bus.placa} - Estado: ${st}">
          <span class="bus-status-dot st-${st}"></span>
          <span class="bus-card-placa">${bus.placa}</span>
        </div>
      `;
    });

    elBusList.innerHTML = html;

    // Vincular clicks: al hacer click a la placa, centrar en el mapa y abrir su popup técnico con la trama
    elBusList.querySelectorAll('.bus-card').forEach(card => {
      card.addEventListener('click', () => {
        const placa = card.getAttribute('data-placa');
        selectBus(placa, true);
      });
    });
  }

  /**
   * Log interno para depuración (consola)
   */
  function appendLog(text) {
    console.log(`[OpenSICM Monitor] ${text}`);
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

  // --- INSPECTOR DE TRAMA ATU (MODAL) ---
  const modal = document.getElementById('modal-trama');
  const closeBtn = document.getElementById('modal-close-btn');
  const okBtn = document.getElementById('btn-modal-ok');
  const copyBtn = document.getElementById('btn-copy-trama');
  const copyText = document.getElementById('copy-btn-text');

  function closeModal() {
    if (modal) modal.classList.remove('active');
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (okBtn) okBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = document.getElementById('trama-json-display').textContent;
      navigator.clipboard.writeText(text).then(() => {
        if (copyText) copyText.textContent = '¡Copiado al Portapapeles!';
        setTimeout(() => {
          if (copyText) copyText.textContent = 'Copiar JSON';
        }, 2000);
      });
    });
  }

  window.inspectTrama = function (placa) {
    const bus = state.buses.get(placa);
    if (!bus) return;

    // Generar la trama JSON reglamentaria exacta requerida por la ATU
    const tramaAtu = {
      imei: bus.imei || "864201041234567",
      placa: bus.placa,
      ruta: bus.ruta || "S/R",
      latitud: bus.latitud,
      longitud: bus.longitud,
      altitud: bus.altitud || 150.0,
      velocidad: bus.velocidad,
      rumbo: bus.rumbo,
      timestamp: bus.timestamp,
      evento: bus.evento || "POSICION_PERIODICA",
      ignicion: bus.ignicion !== undefined ? bus.ignicion : 1,
      modeloGps: bus.modeloGps || "TELTONIKA_FMB920"
    };

    const display = document.getElementById('trama-json-display');
    if (display) {
      display.textContent = JSON.stringify(tramaAtu, null, 2);
    }
    if (modal) {
      modal.classList.add('active');
    }
  };

  // Iniciar conexión en tiempo real al cargar página
  initSse();

})();
