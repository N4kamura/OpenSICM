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
    atuStatus: 'DESCONECTADO',
    kpisSummary: null,
    unitKpis: new Map(),
    kpiAlerts: [],
    kpiSearch: ''
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
            <polygon points="12,15 22,3 32,15 32,39 12,39" fill="rgba(0,0,0,0.4)"/>
            <!-- Símbolo: Rectángulo con la parte frontal del conductor triangular -->
            <path d="M 13 15 L 22 3 L 31 15 L 31 38 L 13 38 Z" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
            <!-- Cabina del conductor / Parabrisas en el frente triangular -->
            <polygon points="16,15 22,6 28,15" fill="#0f172a"/>
            <!-- Ventanillas laterales del cuerpo rectangular -->
            <rect x="15" y="19" width="3" height="15" rx="1" fill="#1e293b"/>
            <rect x="26" y="19" width="3" height="15" rx="1" fill="#1e293b"/>
            <!-- Faros delanteros -->
            <circle cx="16" cy="15" r="1.5" fill="#fef08a"/>
            <circle cx="28" cy="15" r="1.5" fill="#fef08a"/>
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
    const kpi = state.unitKpis.get(bus.placa);
    const kmHoy = kpi ? `${kpi.kmRecorridos} km` : '0.0 km';
    const iteBus = kpi ? `${kpi.itePorcentaje}%` : '100%';

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
            <span class="popup-lbl">Odometría Hoy</span>
            <span class="popup-val" style="color: #38bdf8;">${kmHoy}</span>
          </div>
          <div class="popup-item">
            <span class="popup-lbl">ITE Transmisión</span>
            <span class="popup-val" style="color: #34d399;">${iteBus}</span>
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
        if (data.kpis) {
          state.kpisSummary = data.kpis;
          renderKpiCards(data.kpis);
        }
        if (data.unitKpis && Array.isArray(data.unitKpis)) {
          data.unitKpis.forEach(u => state.unitKpis.set(u.placa, u));
          renderKpiTable();
        }
        if (data.alerts && Array.isArray(data.alerts)) {
          state.kpiAlerts = data.alerts;
          renderKpiAlerts(data.alerts);
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

    // Eventos de KPIs y Alertas
    evtSource.addEventListener('kpi_update', (e) => {
      try {
        const update = JSON.parse(e.data);
        if (update && update.placa && update.kpi) {
          state.unitKpis.set(update.placa, update.kpi);
          const bus = state.buses.get(update.placa);
          if (bus) updateMapMarker(bus);
          renderKpiTable();
        }
      } catch (err) {
        console.error('Error en evento kpi_update:', err);
      }
    });

    evtSource.addEventListener('kpi_alert', (e) => {
      try {
        const alertObj = JSON.parse(e.data);
        state.kpiAlerts.unshift(alertObj);
        if (state.kpiAlerts.length > 50) state.kpiAlerts.pop();
        renderKpiAlerts(state.kpiAlerts);
        appendLog(`🚨 ALERTA: ${alertObj.placa} - ${alertObj.detalles}`);
      } catch (err) {
        console.error('Error en evento kpi_alert:', err);
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

  // --- NAVEGACIÓN ENTRE PESTAÑAS ---
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
        if (targetId === 'view-map') {
          setTimeout(() => map.invalidateSize(), 200);
        } else if (targetId === 'view-kpis') {
          loadKpis();
        } else if (targetId === 'view-fleet') {
          loadFleet();
        } else if (targetId === 'view-testing') {
          populateTestUnits();
          updateTestPreview();
        } else if (targetId === 'view-gtfs') {
          initGtfsDesigner();
          setTimeout(() => {
            if (gtfsMap) gtfsMap.invalidateSize();
          }, 200);
        }
      }
    });
  });

  // --- MÉTRICAS Y KPIS OPERACIONALES (SIN GTFS) ---
  const elKpiValIte = document.getElementById('kpi-val-ite');
  const elKpiSubIte = document.getElementById('kpi-sub-ite');
  const elKpiBadgeIte = document.getElementById('kpi-badge-ite');
  const elKpiValKm = document.getElementById('kpi-val-km');
  const elKpiValMotor = document.getElementById('kpi-val-motor');
  const elKpiValDisp = document.getElementById('kpi-val-disp');
  const elKpiSubDisp = document.getElementById('kpi-sub-disp');
  const elKpiValFmh = document.getElementById('kpi-val-fmh');
  const elKpiSubFmh = document.getElementById('kpi-sub-fmh');
  const elKpiValBlackouts = document.getElementById('kpi-val-blackouts');
  const elKpiPeakBadge = document.getElementById('kpi-peak-badge');
  const elKpiTableBody = document.getElementById('kpi-table-body');
  const elKpiSearchInput = document.getElementById('kpi-search-input');
  const elKpiAlertsFeed = document.getElementById('kpi-alerts-feed');
  const elKpiAlertsCount = document.getElementById('kpi-alerts-count');
  const btnRefreshKpis = document.getElementById('btn-refresh-kpis');

  function renderKpiCards(summary) {
    if (!summary) return;
    if (elKpiValIte) {
      elKpiValIte.textContent = `${summary.iteGlobal}%`;
      if (summary.iteGlobal >= 95.0) {
        elKpiValIte.className = 'kpi-main-val text-success';
        if (elKpiBadgeIte) {
          elKpiBadgeIte.className = 'kpi-badge badge-ok';
          elKpiBadgeIte.textContent = 'Cumple (≥ 95%)';
        }
      } else {
        elKpiValIte.className = 'kpi-main-val text-error';
        if (elKpiBadgeIte) {
          elKpiBadgeIte.className = 'kpi-badge badge-warn';
          elKpiBadgeIte.textContent = 'Observado (< 95%)';
        }
      }
    }
    if (elKpiSubIte) {
      elKpiSubIte.textContent = `${summary.totalTramasAck} / ${summary.totalTramasEnviadas} ACKs`;
    }
    if (elKpiValKm) elKpiValKm.textContent = `${summary.totalKm} km`;
    if (elKpiValMotor) elKpiValMotor.textContent = `${summary.totalHorasMotor} h`;
    if (elKpiValDisp) elKpiValDisp.textContent = `${summary.disponibilidadFlota}%`;
    if (elKpiSubDisp) elKpiSubDisp.textContent = `${summary.flotaActivaHoy} activas de ${summary.flotaTotal} en padrón`;

    if (elKpiValFmh) elKpiValFmh.textContent = `${summary.fmhPorcentaje}%`;
    if (elKpiSubFmh) elKpiSubFmh.textContent = `Meta hora punta: ${summary.fmhMeta} unidades`;

    if (elKpiValBlackouts) {
      elKpiValBlackouts.textContent = summary.totalBlackouts;
      elKpiValBlackouts.className = summary.totalBlackouts > 0 ? 'kpi-main-val text-error' : 'kpi-main-val text-success';
    }

    if (elKpiPeakBadge) {
      if (summary.esHoraPunta) {
        elKpiPeakBadge.className = 'badge-peak peak-on';
        elKpiPeakBadge.textContent = '🟡 HORA PUNTA ACTIVA';
      } else {
        elKpiPeakBadge.className = 'badge-peak peak-off';
        elKpiPeakBadge.textContent = '⚪ HORA VALLE';
      }
    }
  }

  function renderKpiTable() {
    if (!elKpiTableBody) return;
    const query = (state.kpiSearch || '').toLowerCase().trim();
    const units = Array.from(state.unitKpis.values());

    const filtered = units.filter(u => {
      if (!query) return true;
      return (u.placa && u.placa.toLowerCase().includes(query)) ||
             (u.ruta && u.ruta.toLowerCase().includes(query)) ||
             (u.padron && u.padron.toString().toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
      elKpiTableBody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-dim); padding: 2rem;">
            No se encontraron unidades registradas en el consolidado.
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    filtered.forEach(u => {
      const iteColor = u.itePorcentaje >= 95 ? '#34d399' : (u.tramasEnviadas === 0 ? 'var(--text-dim)' : '#f87171');
      const iteBadge = `<span style="font-weight: 700; color: ${iteColor};">${u.itePorcentaje}%</span>`;
      const blackoutBadge = u.blackoutsCount > 0
        ? `<span style="color: #f87171; font-weight: 700;">${u.blackoutsCount}</span>`
        : `<span style="color: var(--text-dim);">0</span>`;

      html += `
        <tr>
          <td><strong style="font-family: monospace; font-size: 0.95rem; color: #fff;">${u.placa}</strong></td>
          <td><span class="bus-ruta-badge">${u.ruta || 'S/R'}</span></td>
          <td>${u.padron || '-'}</td>
          <td style="color: #38bdf8; font-weight: 700;">${u.kmRecorridos} km</td>
          <td>${u.horasMotor} h</td>
          <td style="font-size: 0.75rem; color: var(--text-muted);">${u.tramasEnviadas} / ${u.tramasAck}</td>
          <td>${iteBadge}</td>
          <td>${blackoutBadge}</td>
          <td style="font-size: 0.75rem;">${u.velocidadMax ? `${u.velocidadMax} km/h` : '-'}</td>
        </tr>
      `;
    });

    elKpiTableBody.innerHTML = html;
  }

  function renderKpiAlerts(alerts) {
    if (!elKpiAlertsFeed) return;
    if (!alerts || alerts.length === 0) {
      elKpiAlertsFeed.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 2rem; font-size: 0.85rem;">
          No se registran alertas operacionales hoy.
        </div>
      `;
      if (elKpiAlertsCount) elKpiAlertsCount.textContent = '0 eventos';
      return;
    }

    if (elKpiAlertsCount) elKpiAlertsCount.textContent = `${alerts.length} eventos`;

    let html = '';
    alerts.forEach(a => {
      const hora = a.timestamp ? new Date(a.timestamp * 1000).toLocaleTimeString() : '--:--';
      const isAlta = a.severidad === 'ALTA';
      html += `
        <div class="alert-feed-item ${isAlta ? '' : 'alert-warn'}">
          <div class="alert-item-header">
            <span class="alert-item-title">
              <span>${isAlta ? '🔴' : '🟡'}</span>
              <span>${a.tipo || 'ALERTA'} [${a.placa}]</span>
            </span>
            <span class="alert-item-time">${hora}</span>
          </div>
          <div class="alert-item-desc">${a.detalles}</div>
        </div>
      `;
    });

    elKpiAlertsFeed.innerHTML = html;
  }

  async function loadKpis() {
    try {
      const [sumRes, unitsRes, alertsRes] = await Promise.all([
        fetch('/api/kpis/summary'),
        fetch('/api/kpis/units'),
        fetch('/api/kpis/alerts')
      ]);

      if (sumRes.ok) {
        const summary = await sumRes.json();
        state.kpisSummary = summary;
        renderKpiCards(summary);
      }
      if (unitsRes.ok) {
        const units = await unitsRes.json();
        units.forEach(u => state.unitKpis.set(u.placa, u));
        renderKpiTable();
      }
      if (alertsRes.ok) {
        const alerts = await alertsRes.json();
        state.kpiAlerts = alerts;
        renderKpiAlerts(alerts);
      }
    } catch (err) {
      console.error('Error cargando KPIs:', err);
    }
  }

  if (elKpiSearchInput) {
    elKpiSearchInput.addEventListener('input', (e) => {
      state.kpiSearch = e.target.value;
      renderKpiTable();
    });
  }

  if (btnRefreshKpis) {
    btnRefreshKpis.addEventListener('click', () => {
      loadKpis();
    });
  }

  // --- GESTIÓN DE FLOTA Y ASIGNACIÓN DE GPS ---
  let fleetData = [];
  let currentFleetFilter = 'TODAS';
  let fleetSearchQuery = '';

  const fStatTotal = document.getElementById('f-stat-total');
  const fStatConGps = document.getElementById('f-stat-con-gps');
  const fStatSinGps = document.getElementById('f-stat-sin-gps');
  const fleetTableBody = document.getElementById('fleet-table-body');
  const fleetFilterSearch = document.getElementById('fleet-filter-search');
  const modalUnit = document.getElementById('modal-unit-form');
  const btnOpenAddUnit = document.getElementById('btn-open-add-unit');
  const modalUnitClose = document.getElementById('modal-unit-close');
  const btnCancelUnit = document.getElementById('btn-cancel-unit');
  const btnSubmitUnit = document.getElementById('btn-submit-unit');
  const unitFormError = document.getElementById('unit-form-error');

  async function loadFleet() {
    try {
      const [fleetRes, routesRes] = await Promise.all([
        fetch('/api/fleet'),
        fetch('/api/gtfs/routes').catch(() => null)
      ]);
      const data = await fleetRes.json();
      if (routesRes && routesRes.ok) {
        allRoutes = await routesRes.json();
      }
      fleetData = data.units || [];

      if (fStatTotal) fStatTotal.textContent = data.stats?.total || fleetData.length;
      if (fStatConGps) fStatConGps.textContent = data.stats?.conGps || 0;
      if (fStatSinGps) fStatSinGps.textContent = data.stats?.sinGps || 0;

      renderFleetTable();
    } catch (err) {
      console.error('Error cargando flota:', err);
    }
  }

  function renderRouteOptions(currentRuta) {
    const routes = allRoutes && allRoutes.length > 0 ? allRoutes : [{ route_short_name: 'IO33B' }, { route_short_name: 'CR42' }];
    let opts = '';
    let found = false;
    routes.forEach(r => {
      const code = r.route_short_name || r.route_id;
      const isSel = code === currentRuta;
      if (isSel) found = true;
      opts += `<option value="${code}" ${isSel ? 'selected' : ''}>${code}</option>`;
    });
    if (!found && currentRuta && currentRuta !== 'S/R') {
      opts = `<option value="${currentRuta}" selected>${currentRuta}</option>` + opts;
    }
    return opts;
  }

  window.quickAssignRoute = async function (placa, newRuta) {
    if (!placa || !newRuta) return;
    try {
      const res = await fetch('/api/fleet/assign-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placa, ruta: newRuta })
      });
      const data = await res.json();
      if (data.status === 'OK') {
        const u = fleetData.find(item => item.placa === placa);
        if (u) u.ruta = newRuta;
        const bus = state.buses.get(placa);
        if (bus) {
          bus.ruta = newRuta;
          updateMapMarker(bus);
        }
      } else {
        alert(`Error al asignar ruta: ${data.error || 'No se pudo actualizar'}`);
        loadFleet();
      }
    } catch (err) {
      alert('Error de conexión al asignar ruta.');
      loadFleet();
    }
  };

  function renderFleetTable() {
    if (!fleetTableBody) return;

    const q = fleetSearchQuery.toLowerCase().trim();
    const filtered = fleetData.filter(u => {
      const matchFilter = currentFleetFilter === 'TODAS' ||
        (currentFleetFilter === 'CON_GPS' && u.tieneGps) ||
        (currentFleetFilter === 'SIN_GPS' && !u.tieneGps);

      const matchSearch = !q ||
        (u.placa && u.placa.toLowerCase().includes(q)) ||
        (u.padron && u.padron.toString().toLowerCase().includes(q)) ||
        (u.imei && u.imei.toLowerCase().includes(q));

      return matchFilter && matchSearch;
    });

    if (filtered.length === 0) {
      fleetTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2rem;">
            No se encontraron unidades con los filtros seleccionados.
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    filtered.forEach(u => {
      const gpsBadge = u.tieneGps
        ? `<span class="badge-gps-ok">🟢 CON GPS</span>`
        : `<span class="badge-gps-none">⚠️ SIN GPS ASIGNADO</span>`;

      html += `
        <tr>
          <td><strong style="font-family: monospace; font-size: 0.95rem; color: #fff;">${u.placa}</strong></td>
          <td>
            <select class="fleet-route-select" onchange="window.quickAssignRoute('${u.placa}', this.value)" title="Cambiar ruta asignada con un clic">
              ${renderRouteOptions(u.ruta)}
            </select>
          </td>
          <td>${u.padron || '-'}</td>
          <td>${gpsBadge}</td>
          <td>${u.modeloGps || '<span style="color: var(--text-dim);">No asignado</span>'}</td>
          <td style="font-family: monospace; color: ${u.imei ? '#38bdf8' : 'var(--text-dim)'};">${u.imei || 'Sin módem'}</td>
          <td>
            <div style="display: flex; gap: 0.35rem;">
              <button class="tbl-action-btn" onclick="window.editUnit('${u.placa}')" title="Editar ruta, padrón y GPS">
                ✏️ Editar / GPS
              </button>
              <button class="tbl-action-btn" onclick="window.testUnitTrama('${u.placa}')" title="Probar transmisión ATU">
                🧪 Probar
              </button>
              <button class="tbl-action-btn btn-delete" onclick="window.deleteUnit('${u.placa}')" title="Eliminar unidad">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    fleetTableBody.innerHTML = html;
  }

  // Filtros de tabla de flota
  document.querySelectorAll('[data-fleet-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-fleet-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFleetFilter = btn.getAttribute('data-fleet-filter');
      renderFleetTable();
    });
  });

  if (fleetFilterSearch) {
    fleetFilterSearch.addEventListener('input', (e) => {
      fleetSearchQuery = e.target.value;
      renderFleetTable();
    });
  }

  // Modal para agregar o editar unidad
  function openUnitModal(unit = null) {
    if (!modalUnit) return;
    unitFormError.style.display = 'none';

    document.getElementById('unit-modal-title').textContent = unit ? `✏️ Asignar Ruta y GPS [${unit.placa}]` : '➕ Registrar Unidad / Asignar Ruta';
    document.getElementById('unit-form-placa').value = unit ? unit.placa : '';
    document.getElementById('unit-form-placa').readOnly = !!unit;

    // Poblar selector de rutas GTFS en el modal
    const rutaSelect = document.getElementById('unit-form-ruta-select');
    const rutaInput = document.getElementById('unit-form-ruta');
    const currentRuta = unit ? unit.ruta : (allRoutes[0]?.route_short_name || 'IO33B');

    if (rutaSelect) {
      const routes = allRoutes && allRoutes.length > 0 ? allRoutes : [{ route_short_name: 'IO33B' }, { route_short_name: 'CR42' }];
      let selectHtml = '<option value="">-- Seleccionar de Rutas GTFS --</option>';
      routes.forEach(r => {
        const code = r.route_short_name || r.route_id;
        const sel = code === currentRuta ? 'selected' : '';
        selectHtml += `<option value="${code}" ${sel}>${code} - ${r.route_long_name || ''}</option>`;
      });
      rutaSelect.innerHTML = selectHtml;
      rutaSelect.onchange = () => {
        if (rutaSelect.value && rutaInput) {
          rutaInput.value = rutaSelect.value;
        }
      };
    }

    if (rutaInput) rutaInput.value = currentRuta;
    document.getElementById('unit-form-padron').value = unit ? (unit.padron || '') : '';
    document.getElementById('unit-form-imei').value = unit ? (unit.imei || '') : '';
    document.getElementById('unit-form-modelo').value = unit ? (unit.modeloGps || 'TELTONIKA_FMB920') : 'TELTONIKA_FMB920';
    document.getElementById('unit-form-notas').value = unit ? (unit.notas || '') : '';

    modalUnit.classList.add('active');
  }

  function closeUnitModal() {
    if (modalUnit) modalUnit.classList.remove('active');
  }

  if (btnOpenAddUnit) btnOpenAddUnit.addEventListener('click', () => openUnitModal());
  if (modalUnitClose) modalUnitClose.addEventListener('click', closeUnitModal);
  if (btnCancelUnit) btnCancelUnit.addEventListener('click', closeUnitModal);
  if (modalUnit) {
    modalUnit.addEventListener('click', (e) => {
      if (e.target === modalUnit) closeUnitModal();
    });
  }

  if (btnSubmitUnit) {
    btnSubmitUnit.addEventListener('click', async () => {
      const placa = document.getElementById('unit-form-placa').value.trim().toUpperCase();
      const ruta = document.getElementById('unit-form-ruta').value.trim().toUpperCase();
      const padron = document.getElementById('unit-form-padron').value.trim();
      const imei = document.getElementById('unit-form-imei').value.trim();
      const modeloGps = document.getElementById('unit-form-modelo').value;
      const notas = document.getElementById('unit-form-notas').value.trim();

      if (!placa || placa.length !== 6) {
        unitFormError.textContent = 'La placa debe contener exactamente 6 caracteres alfanuméricos.';
        unitFormError.style.display = 'block';
        return;
      }
      if (!ruta) {
        unitFormError.textContent = 'El código de ruta ATU es obligatorio.';
        unitFormError.style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/fleet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ placa, ruta, padron, imei, modeloGps, notas })
        });
        const json = await res.json();
        if (json.status === 'OK') {
          closeUnitModal();
          loadFleet();
        } else {
          unitFormError.textContent = json.error || 'Error al guardar la unidad';
          unitFormError.style.display = 'block';
        }
      } catch (err) {
        unitFormError.textContent = 'Error de conexión con el servidor.';
        unitFormError.style.display = 'block';
      }
    });
  }

  window.editUnit = function (placa) {
    const u = fleetData.find(item => item.placa === placa);
    if (u) openUnitModal(u);
  };

  window.deleteUnit = async function (placa) {
    if (!confirm(`¿Está seguro de eliminar la unidad con placa ${placa}?`)) return;

    try {
      const res = await fetch('/api/fleet/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placa })
      });
      const data = await res.json();
      if (data.status === 'OK') {
        loadFleet();
      } else {
        alert(data.error || 'No se pudo eliminar');
      }
    } catch (err) {
      alert('Error de conexión.');
    }
  };

  window.testUnitTrama = function (placa) {
    const u = fleetData.find(item => item.placa === placa);
    if (!u) return;

    // Cambiar a pestaña de pruebas
    const tabBtn = document.querySelector('[data-target="view-testing"]');
    if (tabBtn) tabBtn.click();

    // Rellenar formulario de pruebas
    setTimeout(() => {
      document.getElementById('test-placa').value = u.placa;
      document.getElementById('test-ruta').value = u.ruta || 'IO33B';
      document.getElementById('test-imei').value = u.imei || '864201041234567';
      if (u.modeloGps) {
        document.getElementById('test-modelo').value = u.modeloGps;
      }
      updateTestPreview();
    }, 100);
  };

  // --- BANCO DE PRUEBAS ATU ---
  const testUnitSelect = document.getElementById('test-unit-select');
  const testPlaca = document.getElementById('test-placa');
  const testRuta = document.getElementById('test-ruta');
  const testImei = document.getElementById('test-imei');
  const testModelo = document.getElementById('test-modelo');
  const testLat = document.getElementById('test-lat');
  const testLon = document.getElementById('test-lon');
  const testSpeed = document.getElementById('test-speed');
  const testRumbo = document.getElementById('test-rumbo');
  const testAcc = document.getElementById('test-acc');
  const testEvento = document.getElementById('test-evento');
  const testPreviewJson = document.getElementById('test-preview-json');
  const testResultBox = document.getElementById('test-result-box');
  const btnRunTestTrama = document.getElementById('btn-run-test-trama');

  function populateTestUnits() {
    if (!testUnitSelect) return;
    const currentVal = testUnitSelect.value;
    let opts = '<option value="">-- Personalizado / Manual --</option>';

    fleetData.forEach(u => {
      opts += `<option value="${u.placa}">[${u.placa}] Ruta: ${u.ruta || 'S/R'} ${u.imei ? `(GPS: ${u.modeloGps || 'OK'})` : '(Sin GPS)'}</option>`;
    });

    testUnitSelect.innerHTML = opts;
    if (currentVal) testUnitSelect.value = currentVal;
  }

  if (testUnitSelect) {
    testUnitSelect.addEventListener('change', () => {
      const placa = testUnitSelect.value;
      if (!placa) return;
      const u = fleetData.find(item => item.placa === placa);
      if (u) {
        testPlaca.value = u.placa;
        testRuta.value = u.ruta || 'IO33B';
        testImei.value = u.imei || '864201041234561';
        if (u.modeloGps) testModelo.value = u.modeloGps;
        updateTestPreview();
      }
    });
  }

  function getTestPayload() {
    return {
      imei: testImei ? testImei.value.trim() : '864201041234561',
      placa: testPlaca ? testPlaca.value.trim().toUpperCase() : 'A1B789',
      ruta: testRuta ? testRuta.value.trim().toUpperCase() : 'IO33B',
      latitud: parseFloat(testLat?.value || '-12.083812'),
      longitud: parseFloat(testLon?.value || '-76.971038'),
      altitud: 154.2,
      velocidad: parseFloat(testSpeed?.value || '38.5'),
      rumbo: parseFloat(testRumbo?.value || '180.0'),
      timestamp: Math.floor(Date.now() / 1000),
      evento: testEvento?.value || 'POSICION_PERIODICA',
      ignicion: parseInt(testAcc?.value || '1', 10),
      modeloGps: testModelo?.value || 'TELTONIKA_FMB920'
    };
  }

  function updateTestPreview() {
    if (!testPreviewJson) return;
    const payload = getTestPayload();
    testPreviewJson.textContent = JSON.stringify(payload, null, 2);
  }

  // Escuchar cambios en campos de prueba
  [testPlaca, testRuta, testImei, testModelo, testLat, testLon, testSpeed, testRumbo, testAcc, testEvento].forEach(el => {
    if (el) el.addEventListener('input', updateTestPreview);
  });

  // Botones de ubicación rápida
  document.querySelectorAll('.quick-loc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      testLat.value = btn.getAttribute('data-lat');
      testLon.value = btn.getAttribute('data-lon');
      updateTestPreview();
    });
  });

  // Ejecutar prueba de transmisión
  if (btnRunTestTrama) {
    btnRunTestTrama.addEventListener('click', async () => {
      const payload = getTestPayload();
      testResultBox.innerHTML = '<span style="color: var(--text-dim);">⏳ Validando y transmitiendo al enlace WebSocket ATU...</span>';

      try {
        const res = await fetch('/api/test/telemetria', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.status === 'OK') {
          const wsStatus = data.enlaceAtu === 'CONECTADO' ? '🟢 CONECTADO' : '🟡 RECONECTANDO / COLA OFFLINE';
          testResultBox.innerHTML = `
            <div class="result-tag-success">✅ TRAMA ACEPTADA POR LA NORMA ATU</div>
            <div><strong>Placa:</strong> ${payload.placa} | <strong>Ruta:</strong> ${payload.ruta}</div>
            <div><strong>Timestamp POSIX:</strong> ${payload.timestamp} (${new Date(payload.timestamp * 1000).toLocaleTimeString()})</div>
            <div><strong>Coordenadas WGS84:</strong> Lat ${payload.latitud}, Lon ${payload.longitud}</div>
            <div><strong>Velocidad / Rumbo:</strong> ${payload.velocidad} km/h / ${payload.rumbo}°</div>
            <div style="margin-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.4rem;">
              <strong>Enlace WebSocket ATU:</strong> ${wsStatus} (${data.enviadoAtu ? 'Transmitida inmediatamente' : 'Encolada en buffer de respaldo'})
            </div>
            <div style="color: #34d399; font-size: 0.75rem; margin-top: 0.3rem;">
              ✔ La trama ha sido inyectada y el visualizador en vivo ya la refleja en el mapa.
            </div>
          `;
        } else {
          testResultBox.innerHTML = `
            <div class="result-tag-error">❌ TRAMA RECHAZADA</div>
            <div style="color: #f87171;"><strong>Motivo:</strong> ${data.error || 'Error de validación'}</div>
            <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 0.4rem;">
              Revise que la placa contenga 6 caracteres alfanuméricos, que las coordenadas WGS84 sean válidas y que el IMEI posea 15 dígitos.
            </div>
          `;
        }
      } catch (err) {
        testResultBox.innerHTML = `
          <div class="result-tag-error">❌ ERROR DE COMUNICACIÓN</div>
          <div>${err.message}</div>
        `;
      }
    });
  }

  // =========================================================================
  // --- MÓDULO DISEÑADOR GTFS EN MAPA LEAFLET & EXPORTADOR SQLITE ---
  // =========================================================================

  function calcHaversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  let gtfsMap = null;
  let gtfsInitialized = false;
  let gtfsCurrentMode = 'shapes'; // 'shapes' | 'stops'
  let isDrawingShape = false;
  let currentShapePoints = [];
  let shapePolyline = null;
  let referenceShapePolyline = null;
  let currentShapeDir = 0; // 0 = IDA, 1 = VUELTA
  let setShapeDirection = null;
  let updateReferenceShape = null;
  let shapeMarkersGroup = null;
  let stopsLayerGroup = null;
  let tempStopMarker = null;
  let allStops = [];
  let allRoutes = [];
  let allShapes = [];
  let allTrips = [];

  function initGtfsDesigner() {
    if (gtfsInitialized) return;
    gtfsInitialized = true;

    const mapContainer = document.getElementById('gtfs-map');
    if (!mapContainer) return;

    // Inicializar mapa de trazado Leaflet centrado en Lima
    gtfsMap = L.map('gtfs-map', {
      zoomControl: true,
      attributionControl: false
    }).setView(LIMA_COORDS, DEFAULT_ZOOM);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(gtfsMap);

    shapePolyline = L.polyline([], {
      color: '#0284c7',
      weight: 5,
      opacity: 0.9,
      lineJoin: 'round'
    }).addTo(gtfsMap);

    referenceShapePolyline = L.polyline([], {
      color: '#0284c7',
      weight: 3,
      opacity: 0.45,
      dashArray: '6, 8'
    }).addTo(gtfsMap);

    shapeMarkersGroup = L.layerGroup().addTo(gtfsMap);
    stopsLayerGroup = L.layerGroup().addTo(gtfsMap);

    // Evento de clic en mapa GTFS
    gtfsMap.on('click', (e) => {
      if (gtfsCurrentMode === 'shapes') {
        if (!isDrawingShape) return;
        const pt = {
          lat: parseFloat(e.latlng.lat.toFixed(6)),
          lon: parseFloat(e.latlng.lng.toFixed(6))
        };
        currentShapePoints.push(pt);
        renderShapePolylineAndStats();
      } else if (gtfsCurrentMode === 'stops') {
        const lat = e.latlng.lat.toFixed(6);
        const lon = e.latlng.lng.toFixed(6);
        const elLat = document.getElementById('gtfs-stop-lat');
        const elLon = document.getElementById('gtfs-stop-lon');
        if (elLat) elLat.value = lat;
        if (elLon) elLon.value = lon;

        const stopIdInput = document.getElementById('gtfs-stop-id');
        if (stopIdInput && !stopIdInput.value) {
          stopIdInput.value = 'PAR_' + Math.floor(1000 + Math.random() * 9000);
        }

        if (tempStopMarker) {
          tempStopMarker.setLatLng(e.latlng);
        } else {
          tempStopMarker = L.circleMarker(e.latlng, {
            radius: 8,
            color: '#ec4899',
            fillColor: '#f43f5e',
            fillOpacity: 0.9,
            dashArray: '3, 3'
          }).addTo(gtfsMap);
        }
      }
    });

    // Subpestañas GTFS
    document.querySelectorAll('.gtfs-subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.gtfs-subtab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.gtfs-subtab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-gtfs-tab');
        const targetContent = document.getElementById(targetId);
        if (targetContent) {
          targetContent.classList.add('active');
          if (targetId === 'tab-gtfs-map') {
            setTimeout(() => { if (gtfsMap) gtfsMap.invalidateSize(); }, 150);
          } else if (targetId === 'tab-gtfs-routes') {
            loadRoutesAndTrips();
          } else if (targetId === 'tab-gtfs-freqs') {
            loadFrequencies();
          }
        }
      });
    });

    // Selector de modo de trazado (Shapes vs Stops)
    const btnModeShapes = document.getElementById('btn-mode-shapes');
    const btnModeStops = document.getElementById('btn-mode-stops');
    const panelShapes = document.getElementById('gtfs-shapes-panel');
    const panelStops = document.getElementById('gtfs-stops-panel');

    if (btnModeShapes && btnModeStops) {
      btnModeShapes.addEventListener('click', () => {
        gtfsCurrentMode = 'shapes';
        btnModeShapes.classList.add('active');
        btnModeStops.classList.remove('active');
        if (panelShapes) panelShapes.style.display = 'block';
        if (panelStops) panelStops.style.display = 'none';
        if (tempStopMarker) {
          gtfsMap.removeLayer(tempStopMarker);
          tempStopMarker = null;
        }
      });

      btnModeStops.addEventListener('click', () => {
        gtfsCurrentMode = 'stops';
        btnModeStops.classList.add('active');
        btnModeShapes.classList.remove('active');
        if (panelStops) panelStops.style.display = 'block';
        if (panelShapes) panelShapes.style.display = 'none';
        if (isDrawingShape) exitShapeEditorMode();
      });
    }

    // Funciones de control de Modo Visualizador vs Edición
    function enterShapeEditorMode(isNew = false) {
      isDrawingShape = true;
      const badge = document.getElementById('gtfs-shape-mode-badge');
      const viewerActions = document.getElementById('shape-actions-viewer');
      const editorControls = document.getElementById('shape-editor-controls');
      const instructions = document.getElementById('gtfs-shape-instructions');
      const inputNew = document.getElementById('gtfs-shape-new-input');

      if (badge) {
        badge.className = 'kpi-badge badge-warn';
        badge.textContent = '✏️ MODO EDICIÓN ACTIVO';
      }
      if (viewerActions) viewerActions.style.display = 'none';
      if (editorControls) editorControls.style.display = 'flex';
      if (instructions) {
        instructions.innerHTML = '✏️ <strong>Modo Edición:</strong> Haga clics en el mapa para trazar o extender puntos. Use <em>"Guardar"</em> al finalizar o <em>"Salir / Cancelar"</em> para descartar.';
      }

      if (isNew) {
        if (inputNew) {
          inputNew.style.display = 'block';
          const defaultRoute = (allRoutes && allRoutes[0]?.route_short_name) || 'IO33B';
          const dirSuffix = currentShapeDir === 0 ? '_IDA' : '_VUELTA';
          inputNew.value = `${defaultRoute}${dirSuffix}`;
          inputNew.focus();
        }
        currentShapePoints = [];
        renderShapePolylineAndStats();
      } else {
        if (inputNew) inputNew.style.display = 'none';
      }
    }

    async function exitShapeEditorMode() {
      isDrawingShape = false;
      const badge = document.getElementById('gtfs-shape-mode-badge');
      const viewerActions = document.getElementById('shape-actions-viewer');
      const editorControls = document.getElementById('shape-editor-controls');
      const instructions = document.getElementById('gtfs-shape-instructions');
      const inputNew = document.getElementById('gtfs-shape-new-input');
      const shapeSelect = document.getElementById('gtfs-shape-select');

      if (badge) {
        badge.className = 'kpi-badge badge-ok';
        badge.textContent = '👁️ VISUALIZADOR';
      }
      if (viewerActions) viewerActions.style.display = 'flex';
      if (editorControls) editorControls.style.display = 'none';
      if (inputNew) inputNew.style.display = 'none';
      if (instructions) {
        instructions.innerHTML = '💡 <strong>Modo Visualizador:</strong> El mapa está en modo lectura para inspeccionar trazos sin modificarlos por accidente. Use <em>"➕ Nuevo Trazo"</em> o <em>"✏️ Modificar"</em> para habilitar la edición.';
      }

      if (shapeSelect && shapeSelect.value) {
        await loadSelectedShape(shapeSelect.value);
      }
    }

    // Botones de Acción del Trazo
    const btnActionAddShape = document.getElementById('btn-action-add-shape');
    const btnActionEditShape = document.getElementById('btn-action-edit-shape');
    const btnActionDeleteShape = document.getElementById('btn-action-delete-shape');
    const btnCancelEditShape = document.getElementById('btn-cancel-edit-shape');

    if (btnActionAddShape) {
      btnActionAddShape.addEventListener('click', () => {
        enterShapeEditorMode(true);
      });
    }

    if (btnActionEditShape) {
      btnActionEditShape.addEventListener('click', () => {
        const sel = document.getElementById('gtfs-shape-select');
        if (!sel || !sel.value) {
          alert('Seleccione un trazo primero o haga clic en "➕ Nuevo Trazo".');
          return;
        }
        enterShapeEditorMode(false);
      });
    }

    if (btnActionDeleteShape) {
      btnActionDeleteShape.addEventListener('click', async () => {
        const sel = document.getElementById('gtfs-shape-select');
        const shapeId = sel ? sel.value : '';
        if (!shapeId) {
          alert('No hay ningún trazo seleccionado para eliminar.');
          return;
        }
        if (!confirm(`¿Está seguro de eliminar el trazo "${shapeId}" de SQLite?\nSe borrarán todos sus puntos geométricos.`)) {
          return;
        }
        try {
          const res = await fetch('/api/gtfs/shapes/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shape_id: shapeId })
          });
          const data = await res.json();
          if (data.success) {
            alert(`✅ Trazo "${shapeId}" eliminado exitosamente.`);
            currentShapePoints = [];
            renderShapePolylineAndStats();
            await loadShapeList();
          } else {
            alert(`❌ Error al eliminar trazo: ${data.error}`);
          }
        } catch (err) {
          alert(`❌ Error de conexión: ${err.message}`);
        }
      });
    }

    if (btnCancelEditShape) {
      btnCancelEditShape.addEventListener('click', async () => {
        await exitShapeEditorMode();
      });
    }

    // Deshacer punto
    const btnUndo = document.getElementById('btn-undo-point');
    if (btnUndo) {
      btnUndo.addEventListener('click', () => {
        if (currentShapePoints.length > 0) {
          currentShapePoints.pop();
          renderShapePolylineAndStats();
        }
      });
    }

    // Limpiar trazo
    const btnClear = document.getElementById('btn-clear-shape');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('¿Desea limpiar los puntos del trazo actual?')) {
          currentShapePoints = [];
          renderShapePolylineAndStats();
        }
      });
    }

    // --- Sentido del Trazo (IDA vs VUELTA) y Herramientas Inteligentes ---
    currentShapeDir = 0; // 0 = IDA, 1 = VUELTA
    const btnShapeDir0 = document.getElementById('btn-shape-dir-0');
    const btnShapeDir1 = document.getElementById('btn-shape-dir-1');
    const btnCopyInvert = document.getElementById('btn-copy-invert-shape');
    const chkShowRef = document.getElementById('chk-show-reference-shape');

    updateReferenceShape = async function() {
      if (!referenceShapePolyline) return;
      if (!chkShowRef || !chkShowRef.checked) {
        referenceShapePolyline.setLatLngs([]);
        return;
      }

      const sel = document.getElementById('gtfs-shape-select');
      const inputNew = document.getElementById('gtfs-shape-new-input');
      let curId = inputNew && inputNew.style.display !== 'none'
        ? inputNew.value.trim().toUpperCase()
        : (sel ? sel.value : '');

      let targetRefId = '';
      if (currentShapeDir === 1) {
        targetRefId = curId.replace(/_VUELTA$/, '_IDA').replace(/_VTA$/, '_IDA');
        if (!targetRefId || targetRefId === curId) targetRefId = 'IO33B_IDA';
        referenceShapePolyline.setStyle({ color: '#0284c7' });
      } else {
        targetRefId = curId.replace(/_IDA$/, '_VUELTA');
        if (!targetRefId || targetRefId === curId) targetRefId = 'IO33B_VUELTA';
        referenceShapePolyline.setStyle({ color: '#8b5cf6' });
      }

      try {
        const res = await fetch(`/api/gtfs/shapes?shape_id=${encodeURIComponent(targetRefId)}`);
        const pts = await res.json();
        if (Array.isArray(pts) && pts.length > 0) {
          referenceShapePolyline.setLatLngs(pts.map(p => [p.shape_pt_lat, p.shape_pt_lon]));
        } else {
          referenceShapePolyline.setLatLngs([]);
        }
      } catch (e) {
        referenceShapePolyline.setLatLngs([]);
      }
    };

    setShapeDirection = function(dir) {
      currentShapeDir = dir;
      if (btnShapeDir0) btnShapeDir0.classList.toggle('active', dir === 0);
      if (btnShapeDir1) btnShapeDir1.classList.toggle('active', dir === 1);

      if (shapePolyline) {
        shapePolyline.setStyle({ color: dir === 0 ? '#0284c7' : '#8b5cf6' });
      }

      if (btnCopyInvert) {
        btnCopyInvert.style.display = dir === 1 ? 'flex' : 'none';
      }

      const inputNew = document.getElementById('gtfs-shape-new-input');
      if (inputNew && inputNew.style.display !== 'none') {
        let val = inputNew.value.trim().toUpperCase();
        if (!val) {
          const firstRoute = allRoutes[0]?.route_short_name || 'IO33B';
          inputNew.value = dir === 0 ? `${firstRoute}_IDA` : `${firstRoute}_VUELTA`;
        } else if (val.endsWith('_IDA') && dir === 1) {
          inputNew.value = val.replace(/_IDA$/, '_VUELTA');
        } else if (val.endsWith('_VUELTA') && dir === 0) {
          inputNew.value = val.replace(/_VUELTA$/, '_IDA');
        }
      }

      updateReferenceShape();
    };

    if (btnShapeDir0) btnShapeDir0.addEventListener('click', () => setShapeDirection(0));
    if (btnShapeDir1) btnShapeDir1.addEventListener('click', () => setShapeDirection(1));
    if (chkShowRef) chkShowRef.addEventListener('change', () => updateReferenceShape());

    if (btnCopyInvert) {
      btnCopyInvert.addEventListener('click', async () => {
        const sel = document.getElementById('gtfs-shape-select');
        const inputNew = document.getElementById('gtfs-shape-new-input');
        let curId = inputNew && inputNew.style.display !== 'none'
          ? inputNew.value.trim().toUpperCase()
          : (sel ? sel.value : '');

        let baseId = curId.replace(/_VUELTA$/, '').replace(/_VTA$/, '').replace(/_IDA$/, '');
        let targetIda = baseId ? `${baseId}_IDA` : 'IO33B_IDA';

        try {
          const res = await fetch(`/api/gtfs/shapes?shape_id=${encodeURIComponent(targetIda)}`);
          const pts = await res.json();
          if (!pts || pts.length === 0) {
            alert(`No se encontraron puntos para el trazo de IDA "${targetIda}". Trazar y guardar la IDA primero para usarla como base.`);
            return;
          }

          currentShapePoints = [...pts].reverse().map(p => ({
            lat: p.shape_pt_lat,
            lon: p.shape_pt_lon
          }));

          renderShapePolylineAndStats();
          if (shapePolyline && gtfsMap) {
            const bounds = shapePolyline.getBounds();
            if (bounds.isValid()) gtfsMap.fitBounds(bounds, { padding: [30, 30] });
          }

          if (inputNew && inputNew.style.display !== 'none') {
            inputNew.value = `${baseId || 'IO33B'}_VUELTA`;
          }

          alert(`✅ ¡Trazo de VUELTA generado exitosamente!\n\nSe copiaron e invirtieron ${currentShapePoints.length} puntos de "${targetIda}".\nAhora puede hacer clics en el mapa para extenderlo o modificar tramos que difieran.`);
        } catch (err) {
          alert(`Error al generar trazo invertido: ${err.message}`);
        }
      });
    }

    // Guardar Trazo en SQLite
    const btnSaveShape = document.getElementById('btn-save-shape-sql');
    if (btnSaveShape) {
      btnSaveShape.addEventListener('click', async () => {
        const sel = document.getElementById('gtfs-shape-select');
        const inputNew = document.getElementById('gtfs-shape-new-input');
        let shapeId = inputNew && inputNew.style.display !== 'none'
          ? inputNew.value.trim().toUpperCase()
          : (sel ? sel.value : '');

        if (!shapeId) {
          alert('Por favor ingrese o seleccione un ID de trazo (ej. IO33B_IDA)');
          return;
        }

        if (currentShapePoints.length === 0) {
          alert('El trazo debe contener al menos 1 punto geográfico para guardarse.');
          return;
        }

        try {
          const res = await fetch('/api/gtfs/shapes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shape_id: shapeId, points: currentShapePoints })
          });
          const data = await res.json();
          if (data.success) {
            alert(`✅ Trazo "${shapeId}" guardado exitosamente con ${data.totalPoints} puntos.`);
            await loadShapeList(shapeId);
            await exitShapeEditorMode();
          } else {
            alert(`❌ Error al guardar trazo: ${data.error}`);
          }
        } catch (e) {
          alert(`❌ Error de conexión: ${e.message}`);
        }
      });
    }

    // Cambio en selector de trazo
    const shapeSelect = document.getElementById('gtfs-shape-select');
    if (shapeSelect) {
      shapeSelect.addEventListener('change', async () => {
        await exitShapeEditorMode();
        if (shapeSelect.value) {
          await loadSelectedShape(shapeSelect.value);
        }
      });
    }

    // Guardar Paradero en SQLite
    const btnSaveStop = document.getElementById('btn-save-stop-sql');
    if (btnSaveStop) {
      btnSaveStop.addEventListener('click', async () => {
        const stopId = document.getElementById('gtfs-stop-id')?.value.trim().toUpperCase();
        const stopName = document.getElementById('gtfs-stop-name')?.value.trim();
        const stopType = parseInt(document.getElementById('gtfs-stop-type')?.value || '0', 10);
        const stopLat = parseFloat(document.getElementById('gtfs-stop-lat')?.value);
        const stopLon = parseFloat(document.getElementById('gtfs-stop-lon')?.value);

        if (!stopId || !stopName || isNaN(stopLat) || isNaN(stopLon)) {
          alert('Haga clic en el mapa para fijar coordenadas y complete el ID y nombre del paradero.');
          return;
        }

        try {
          const res = await fetch('/api/gtfs/stops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stop_id: stopId,
              stop_name: stopName,
              stop_lat: stopLat,
              stop_lon: stopLon,
              location_type: stopType
            })
          });
          const data = await res.json();
          if (data.success) {
            if (tempStopMarker) {
              gtfsMap.removeLayer(tempStopMarker);
              tempStopMarker = null;
            }
            if (document.getElementById('gtfs-stop-id')) document.getElementById('gtfs-stop-id').value = '';
            if (document.getElementById('gtfs-stop-name')) document.getElementById('gtfs-stop-name').value = '';
            if (document.getElementById('gtfs-stop-lat')) document.getElementById('gtfs-stop-lat').value = '';
            if (document.getElementById('gtfs-stop-lon')) document.getElementById('gtfs-stop-lon').value = '';
            await loadStops();
          } else {
            alert(`❌ Error al guardar paradero: ${data.error}`);
          }
        } catch (e) {
          alert(`❌ Error de comunicación: ${e.message}`);
        }
      });
    }

    // Formularios de Empresa, Rutas, Viajes, Frecuencias y Exportador
    setupAgencyForm();
    setupRouteForm();
    setupTripForm();
    setupFrequencyForm();
    setupExportHandlers();

    // Cargar datos iniciales
    loadShapeList('IO33B_IDA');
    loadStops();
  }

  function toggleDrawingMode() {
    isDrawingShape = !isDrawingShape;
    const btnToggleDraw = document.getElementById('btn-toggle-drawing');
    const icon = document.getElementById('btn-drawing-icon');
    const text = document.getElementById('btn-drawing-text');

    if (isDrawingShape) {
      if (icon) icon.textContent = '🛑';
      if (text) text.textContent = 'Detener Dibujo (Haga Clics en Mapa)';
      if (btnToggleDraw) {
        btnToggleDraw.style.background = '#dc2626';
        btnToggleDraw.style.borderColor = '#b91c1c';
      }
    } else {
      if (icon) icon.textContent = '✏️';
      if (text) text.textContent = 'Activar Dibujo en Mapa';
      if (btnToggleDraw) {
        btnToggleDraw.style.background = '';
        btnToggleDraw.style.borderColor = '';
      }
    }
  }

  function renderShapePolylineAndStats() {
    if (!shapePolyline) return;
    const latLngs = currentShapePoints.map(p => [p.lat, p.lon]);
    shapePolyline.setLatLngs(latLngs);

    if (shapeMarkersGroup) {
      shapeMarkersGroup.clearLayers();
      currentShapePoints.forEach((pt, index) => {
        const isStart = index === 0;
        const isEnd = index === currentShapePoints.length - 1 && currentShapePoints.length > 1;

        const radius = isStart || isEnd ? 6 : 3;
        const color = isStart ? '#10b981' : (isEnd ? '#ef4444' : '#38bdf8');

        L.circleMarker([pt.lat, pt.lon], {
          radius: radius,
          color: color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 1
        }).bindTooltip(`Punto #${index + 1}<br>Lat: ${pt.lat}<br>Lon: ${pt.lon}`, { direction: 'top' })
          .addTo(shapeMarkersGroup);
      });
    }

    // Calcular distancia Haversine
    let distKm = 0;
    for (let i = 0; i < currentShapePoints.length - 1; i++) {
      distKm += calcHaversineKm(
        currentShapePoints[i].lat, currentShapePoints[i].lon,
        currentShapePoints[i + 1].lat, currentShapePoints[i + 1].lon
      );
    }

    const ptsCount = document.getElementById('gtfs-pts-count');
    const distEl = document.getElementById('gtfs-dist-km');
    if (ptsCount) ptsCount.textContent = currentShapePoints.length;
    if (distEl) distEl.textContent = `${distKm.toFixed(2)} km`;
  }

  async function loadShapeList(selectIdToSet = null) {
    try {
      const res = await fetch('/api/gtfs/shapes');
      const list = await res.json();
      allShapes = list;

      const sel = document.getElementById('gtfs-shape-select');
      const tripShapeSel = document.getElementById('trip-shape-select');

      if (sel) {
        sel.innerHTML = '';
        list.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.shape_id;
          opt.textContent = `${s.shape_id} (${s.total_puntos} pts)`;
          sel.appendChild(opt);
        });

        if (list.length === 0) {
          sel.innerHTML = '<option value="">(Sin trazos guardados)</option>';
        }

        if (selectIdToSet && list.some(s => s.shape_id === selectIdToSet)) {
          sel.value = selectIdToSet;
        } else if (list.length > 0) {
          sel.value = list[0].shape_id;
        }
      }

      if (tripShapeSel) {
        tripShapeSel.innerHTML = '<option value="">-- Sin trazo asignado --</option>';
        list.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.shape_id;
          opt.textContent = s.shape_id;
          tripShapeSel.appendChild(opt);
        });
      }

      if (sel && sel.value) {
        await loadSelectedShape(sel.value);
      } else {
        currentShapePoints = [];
        renderShapePolylineAndStats();
      }
    } catch (e) {
      console.error('[GTFS] Error cargando lista de trazos:', e);
    }
  }

  async function loadSelectedShape(shapeId) {
    try {
      if (typeof setShapeDirection === 'function') {
        if (shapeId.includes('VUELTA') || shapeId.includes('_VTA')) {
          setShapeDirection(1);
        } else {
          setShapeDirection(0);
        }
      }
      const res = await fetch(`/api/gtfs/shapes?shape_id=${encodeURIComponent(shapeId)}`);
      const points = await res.json();
      currentShapePoints = points.map(p => ({
        lat: p.shape_pt_lat,
        lon: p.shape_pt_lon
      }));
      renderShapePolylineAndStats();
      if (currentShapePoints.length > 0 && gtfsMap && shapePolyline) {
        const bounds = shapePolyline.getBounds();
        if (bounds.isValid()) {
          gtfsMap.fitBounds(bounds, { padding: [30, 30] });
        }
      }
      if (typeof updateReferenceShape === 'function') {
        updateReferenceShape();
      }
    } catch (e) {
      console.error('[GTFS] Error cargando trazo:', e);
    }
  }

  async function loadStops() {
    try {
      const res = await fetch('/api/gtfs/stops');
      const stops = await res.json();
      allStops = stops;

      const countEl = document.getElementById('gtfs-stops-count');
      if (countEl) countEl.textContent = stops.length;

      // Renderizar en mapa
      if (stopsLayerGroup) {
        stopsLayerGroup.clearLayers();
        stops.forEach(s => {
          const isTerminal = s.location_type === 1;
          const markerColor = isTerminal ? '#f59e0b' : '#0ea5e9';
          const markerFill = isTerminal ? '#d97706' : '#0284c7';
          const radius = isTerminal ? 8 : 6;
          const label = isTerminal ? '🏁 TERMINAL' : '🚏 PARADERO';

          const marker = L.circleMarker([s.stop_lat, s.stop_lon], {
            radius: radius,
            color: markerColor,
            fillColor: markerFill,
            fillOpacity: 0.9,
            weight: 2
          }).addTo(stopsLayerGroup);

          marker.bindPopup(`
            <div style="font-family: var(--font-sans); font-size: 0.8rem;">
              <div style="font-weight: 700; color: #fff; margin-bottom: 2px;">${label}</div>
              <div style="font-size: 0.85rem; color: #38bdf8; font-weight: 600;">${s.stop_name}</div>
              <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 4px;">ID: <code>${s.stop_id}</code></div>
              <div style="font-size: 0.7rem; color: var(--text-dim);">Lat: ${s.stop_lat}, Lon: ${s.stop_lon}</div>
            </div>
          `);
        });
      }

      // Renderizar mini lista
      const listEl = document.getElementById('gtfs-stops-list');
      if (listEl) {
        if (stops.length === 0) {
          listEl.innerHTML = '<div style="color: var(--text-dim); padding: 0.5rem; font-size: 0.75rem;">No hay paraderos registrados aún.</div>';
          return;
        }

        listEl.innerHTML = stops.map(s => {
          const isTerminal = s.location_type === 1;
          const badgeClass = isTerminal ? 'badge-warn' : 'badge-ok';
          const badgeText = isTerminal ? 'Terminal' : 'Paradero';
          return `
            <div class="gtfs-stop-item" data-stop-id="${s.stop_id}">
              <div style="cursor: pointer; flex: 1; overflow: hidden;" onclick="window.focusGtfsStop(${s.stop_lat}, ${s.stop_lon})">
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                  <span class="kpi-badge ${badgeClass}" style="font-size: 0.65rem; padding: 1px 4px;">${badgeText}</span>
                  <strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #f8fafc;">${s.stop_name}</strong>
                </div>
                <div style="font-size: 0.68rem; color: var(--text-dim); margin-top: 2px;">
                  <code>${s.stop_id}</code> | ${s.stop_lat.toFixed(4)}, ${s.stop_lon.toFixed(4)}
                </div>
              </div>
              <button class="tbl-action-btn btn-delete" onclick="window.deleteGtfsStop('${s.stop_id}')" title="Eliminar Paradero">
                🗑️
              </button>
            </div>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('[GTFS] Error cargando paraderos:', e);
    }
  }

  window.focusGtfsStop = function(lat, lon) {
    if (gtfsMap) {
      gtfsMap.setView([lat, lon], 16);
    }
  };

  window.deleteGtfsStop = async function(stopId) {
    if (!confirm(`¿Desea eliminar el paradero "${stopId}" de SQLite?`)) return;
    try {
      const res = await fetch('/api/gtfs/stops/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stop_id: stopId })
      });
      const data = await res.json();
      if (data.success) {
        await loadStops();
      } else {
        alert(`❌ Error al eliminar: ${data.error}`);
      }
    } catch (e) {
      alert(`❌ Error de conexión: ${e.message}`);
    }
  };

  // --- AGENCY ---
  let currentAgency = null;

  async function renderAgency() {
    const viewerCard = document.getElementById('agency-viewer-card');
    const form = document.getElementById('form-gtfs-agency');
    if (!viewerCard || !form) return;

    try {
      const res = await fetch('/api/gtfs/agency');
      const a = await res.json();
      currentAgency = a;

      if (a && a.agency_name) {
        const nameEl = document.getElementById('agency-view-name');
        const idEl = document.getElementById('agency-view-id');
        const tzEl = document.getElementById('agency-view-tz');
        const urlEl = document.getElementById('agency-view-url');

        if (nameEl) nameEl.textContent = a.agency_name;
        if (idEl) idEl.textContent = a.agency_id || '-';
        if (tzEl) tzEl.textContent = a.agency_timezone || 'America/Lima';
        if (urlEl) {
          urlEl.textContent = a.agency_url || 'Sin sitio web';
          urlEl.href = a.agency_url || '#';
        }

        viewerCard.style.display = 'flex';
        form.style.display = 'none';
      } else {
        viewerCard.style.display = 'none';
        form.style.display = 'flex';
      }
    } catch (e) {
      console.error('[GTFS] Error cargando empresa:', e);
    }
  }

  function setupAgencyForm() {
    const form = document.getElementById('form-gtfs-agency');
    const btnEdit = document.getElementById('btn-edit-agency');
    const btnCancel = document.getElementById('btn-cancel-agency');
    const btnReset = document.getElementById('btn-reset-agency');
    const viewerCard = document.getElementById('agency-viewer-card');

    if (btnEdit) {
      btnEdit.addEventListener('click', () => {
        if (currentAgency) {
          if (document.getElementById('agency-id')) document.getElementById('agency-id').value = currentAgency.agency_id || 'EMP_LIMA';
          if (document.getElementById('agency-name')) document.getElementById('agency-name').value = currentAgency.agency_name || '';
          if (document.getElementById('agency-url')) document.getElementById('agency-url').value = currentAgency.agency_url || '';
          if (document.getElementById('agency-tz')) document.getElementById('agency-tz').value = currentAgency.agency_timezone || 'America/Lima';
        }
        if (viewerCard) viewerCard.style.display = 'none';
        if (form) form.style.display = 'flex';
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (viewerCard && currentAgency && currentAgency.agency_name) {
          viewerCard.style.display = 'flex';
          if (form) form.style.display = 'none';
        }
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', async () => {
        if (!confirm('¿Desea borrar o restablecer los datos de la empresa operadora de SQLite?')) return;
        try {
          const res = await fetch('/api/gtfs/agency/delete', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            currentAgency = null;
            if (document.getElementById('agency-name')) document.getElementById('agency-name').value = '';
            if (document.getElementById('agency-url')) document.getElementById('agency-url').value = '';
            await renderAgency();
          } else {
            alert(`Error: ${data.error}`);
          }
        } catch (err) {
          alert(`Error de conexión: ${err.message}`);
        }
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          agency_id: document.getElementById('agency-id')?.value.trim() || 'EMP_LIMA',
          agency_name: document.getElementById('agency-name')?.value.trim(),
          agency_url: document.getElementById('agency-url')?.value.trim(),
          agency_timezone: document.getElementById('agency-tz')?.value.trim() || 'America/Lima'
        };
        try {
          const res = await fetch('/api/gtfs/agency', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            alert('✅ Datos de empresa guardados en SQLite.');
            await renderAgency();
          } else {
            alert(`❌ Error: ${data.error}`);
          }
        } catch (err) {
          alert(`❌ Error de conexión: ${err.message}`);
        }
      });
    }

    renderAgency();
  }

  // --- ROUTES & TRIPS ---
  let editingRouteId = null;

  async function loadRoutesAndTrips() {
    await loadRoutes();
    await loadTrips();
  }

  async function loadRoutes() {
    try {
      const res = await fetch('/api/gtfs/routes');
      const routes = await res.json();
      allRoutes = routes;

      const formRoute = document.getElementById('form-gtfs-route');
      if (formRoute) formRoute.style.display = 'none';
      editingRouteId = null;

      if (!fleetData || fleetData.length === 0) {
        try {
          const fRes = await fetch('/api/fleet');
          const fData = await fRes.json();
          if (fData && fData.units) fleetData = fData.units;
        } catch (_) {}
      }

      // Actualizar select en Trips
      const tripRouteSel = document.getElementById('trip-route-select');
      if (tripRouteSel) {
        tripRouteSel.innerHTML = routes.map(r => `<option value="${r.route_id}">${r.route_short_name} - ${r.route_long_name || ''}</option>`).join('');
      }

      // Actualizar lista en pantalla
      const listEl = document.getElementById('gtfs-routes-list');
      if (listEl) {
        if (routes.length === 0) {
          listEl.innerHTML = '<div style="color: var(--text-dim); padding: 0.5rem; font-size: 0.75rem;">No hay rutas registradas. Haga clic en "+ Nueva Ruta" para agregar.</div>';
          return;
        }

        listEl.innerHTML = routes.map(r => {
          const assignedBuses = (fleetData || []).filter(u => u.ruta === r.route_short_name || u.ruta === r.route_id).length;
          return `
            <div class="gtfs-pill-item" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.5rem 0.75rem;">
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <strong style="color: #38bdf8; font-size: 0.95rem;">${r.route_short_name}</strong>
                  <span class="badge-gps-ok" style="font-size: 0.7rem; padding: 1px 6px;">🚍 ${assignedBuses} en flota</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                  ${r.route_long_name || 'Sin itinerario definido'}
                </div>
              </div>
              <div style="display: flex; gap: 0.35rem; align-items: center;">
                <button class="tbl-action-btn" onclick="window.editGtfsRoute('${r.route_id}')" title="Modificar ruta" style="font-size: 0.72rem; padding: 3px 7px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.4);">
                  ✏️ Modificar
                </button>
                <button class="tbl-action-btn" onclick="window.autoGenerateTrips('${r.route_id}')" title="Crear viajes estándar de Ida y Vuelta para esta ruta" style="font-size: 0.72rem; padding: 3px 7px; color: #a78bfa; border-color: rgba(167, 139, 250, 0.4);">
                  ⚡ Trips Ida/Vta
                </button>
                <button class="tbl-action-btn btn-delete" onclick="window.deleteGtfsRoute('${r.route_id}')" title="Eliminar Ruta">
                  🗑️
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('[GTFS] Error cargando rutas:', e);
    }
  }

  window.editGtfsRoute = function(routeId) {
    const r = (allRoutes || []).find(item => item.route_id === routeId);
    if (!r) return;
    editingRouteId = routeId;
    const form = document.getElementById('form-gtfs-route');
    const title = document.getElementById('route-form-title');
    const shortInput = document.getElementById('route-short-name');
    const longInput = document.getElementById('route-long-name');
    const typeSelect = document.getElementById('route-type');

    if (title) title.textContent = `✏️ Modificar Ruta [${r.route_short_name}]`;
    if (shortInput) {
      shortInput.value = r.route_short_name;
      shortInput.readOnly = true;
    }
    if (longInput) longInput.value = r.route_long_name || '';
    if (typeSelect) typeSelect.value = r.route_type !== undefined ? r.route_type : 3;

    if (form) {
      form.style.display = 'flex';
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (longInput) longInput.focus();
  };

  function setupRouteForm() {
    const form = document.getElementById('form-gtfs-route');
    const btnShowAdd = document.getElementById('btn-show-add-route');
    const btnCancel = document.getElementById('btn-cancel-route');

    if (btnShowAdd) {
      btnShowAdd.addEventListener('click', () => {
        editingRouteId = null;
        const title = document.getElementById('route-form-title');
        const shortInput = document.getElementById('route-short-name');
        const longInput = document.getElementById('route-long-name');
        if (title) title.textContent = '➕ Registrar Nueva Ruta';
        if (shortInput) {
          shortInput.value = '';
          shortInput.readOnly = false;
        }
        if (longInput) longInput.value = '';
        if (form) {
          form.style.display = 'flex';
          if (shortInput) shortInput.focus();
        }
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (form) form.style.display = 'none';
        editingRouteId = null;
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const shortName = document.getElementById('route-short-name')?.value.trim().toUpperCase();
        const longName = document.getElementById('route-long-name')?.value.trim();
        const routeType = parseInt(document.getElementById('route-type')?.value || '3', 10);
        const agencyId = document.getElementById('agency-id')?.value.trim() || 'EMP_LIMA';

        if (!shortName) return;

        try {
          const res = await fetch('/api/gtfs/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              route_id: shortName,
              agency_id: agencyId,
              route_short_name: shortName,
              route_long_name: longName,
              route_type: routeType
            })
          });
          const data = await res.json();
          if (data.success) {
            form.style.display = 'none';
            await loadRoutes();
          } else {
            alert(`❌ Error al guardar ruta: ${data.error}`);
          }
        } catch (err) {
          alert(`❌ Error de conexión: ${err.message}`);
        }
      });
    }
  }

  window.deleteGtfsRoute = async function(routeId) {
    if (!confirm(`¿Desea eliminar la ruta "${routeId}"?`)) return;
    try {
      const res = await fetch('/api/gtfs/routes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_id: routeId })
      });
      const data = await res.json();
      if (data.success) await loadRoutes();
      else alert(`❌ Error: ${data.error}`);
    } catch (e) {
      alert(`❌ Error de conexión: ${e.message}`);
    }
  };

  window.autoGenerateTrips = async function(routeId) {
    if (!routeId) return;
    const r = (allRoutes || []).find(item => item.route_id === routeId);
    const shortName = r ? r.route_short_name : routeId;

    const tripIda = {
      trip_id: `${shortName}_IDA_01`,
      route_id: routeId,
      direction_id: 0,
      shape_id: `${shortName}_IDA`,
      trip_headsign: `Sentido Ida (${shortName})`
    };

    const tripVuelta = {
      trip_id: `${shortName}_VTA_01`,
      route_id: routeId,
      direction_id: 1,
      shape_id: `${shortName}_VUELTA`,
      trip_headsign: `Sentido Vuelta (${shortName})`
    };

    try {
      await fetch('/api/gtfs/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tripIda)
      });
      await fetch('/api/gtfs/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tripVuelta)
      });
      await loadTrips();
      alert(`✅ Se crearon 2 patrones de viajes en SQLite para ${shortName}:\n• ${tripIda.trip_id} (Sentido 0 - Ida, Trazo: ${tripIda.shape_id})\n• ${tripVuelta.trip_id} (Sentido 1 - Vuelta, Trazo: ${tripVuelta.shape_id})`);
    } catch (err) {
      alert(`Error al generar viajes: ${err.message}`);
    }
  };

  // --- TRIPS ---
  let editingTripId = null;

  async function loadTrips() {
    try {
      const res = await fetch('/api/gtfs/trips');
      const trips = await res.json();
      allTrips = trips;

      const formTrip = document.getElementById('form-gtfs-trip');
      if (formTrip) formTrip.style.display = 'none';
      editingTripId = null;

      // Actualizar select de Trips en Frecuencias
      const freqTripSel = document.getElementById('freq-trip-select');
      if (freqTripSel) {
        freqTripSel.innerHTML = trips.map(t => {
          const dir = t.direction_id === 0 ? 'IDA' : 'VUELTA';
          return `<option value="${t.trip_id}">[${t.route_id}] ${t.trip_id} (${dir})</option>`;
        }).join('');
      }

      // Actualizar lista en pantalla
      const listEl = document.getElementById('gtfs-trips-list');
      if (listEl) {
        if (trips.length === 0) {
          listEl.innerHTML = '<div style="color: var(--text-dim); padding: 0.5rem; font-size: 0.75rem;">No hay viajes registrados. Haga clic en "+ Nuevo Viaje" para agregar.</div>';
          return;
        }

        listEl.innerHTML = trips.map(t => {
          const dirLabel = t.direction_id === 0 ? 'Sentido: IDA (0)' : 'Sentido: VUELTA (1)';
          return `
            <div class="gtfs-pill-item" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.5rem 0.75rem;">
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <strong style="color: #38bdf8;">${t.trip_id}</strong>
                  <span class="bus-ruta-badge">${t.route_id}</span>
                  <span style="font-size: 0.72rem; color: var(--text-muted);">${dirLabel}</span>
                  <span style="font-size: 0.72rem; color: #34d399;">Trazo: ${t.shape_id || 'S/T'}</span>
                  ${t.trip_headsign ? `<span style="font-size: 0.72rem; color: var(--text-dim);">[${t.trip_headsign}]</span>` : ''}
                </div>
              </div>
              <div style="display: flex; gap: 0.35rem; align-items: center;">
                <button class="tbl-action-btn" onclick="window.editGtfsTrip('${t.trip_id}')" title="Modificar viaje" style="font-size: 0.72rem; padding: 3px 7px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.4);">
                  ✏️ Modificar
                </button>
                <button class="tbl-action-btn btn-delete" onclick="window.deleteGtfsTrip('${t.trip_id}')" title="Eliminar Viaje">
                  🗑️
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('[GTFS] Error cargando viajes:', e);
    }
  }

  window.editGtfsTrip = function(tripId) {
    const t = (allTrips || []).find(item => item.trip_id === tripId);
    if (!t) return;
    editingTripId = tripId;
    const form = document.getElementById('form-gtfs-trip');
    const title = document.getElementById('trip-form-title');
    const tripInput = document.getElementById('trip-id');
    const routeSel = document.getElementById('trip-route-select');
    const dirSel = document.getElementById('trip-direction');
    const shapeSel = document.getElementById('trip-shape-select');
    const headsignInput = document.getElementById('trip-headsign');

    if (title) title.textContent = `✏️ Modificar Viaje [${tripId}]`;
    if (tripInput) {
      tripInput.value = t.trip_id;
      tripInput.readOnly = true;
    }
    if (routeSel) routeSel.value = t.route_id;
    if (dirSel) dirSel.value = t.direction_id;
    if (shapeSel) shapeSel.value = t.shape_id || '';
    if (headsignInput) headsignInput.value = t.trip_headsign || '';

    if (form) {
      form.style.display = 'block';
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  function setupTripForm() {
    const form = document.getElementById('form-gtfs-trip');
    const btnShowAdd = document.getElementById('btn-show-add-trip');
    const btnCancel = document.getElementById('btn-cancel-trip');

    if (btnShowAdd) {
      btnShowAdd.addEventListener('click', () => {
        editingTripId = null;
        const title = document.getElementById('trip-form-title');
        const tripInput = document.getElementById('trip-id');
        const headsignInput = document.getElementById('trip-headsign');
        if (title) title.textContent = '➕ Registrar Plantilla de Viaje';
        if (tripInput) {
          tripInput.value = '';
          tripInput.readOnly = false;
        }
        if (headsignInput) headsignInput.value = '';
        if (form) {
          form.style.display = 'block';
          if (tripInput) tripInput.focus();
        }
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (form) form.style.display = 'none';
        editingTripId = null;
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tripId = document.getElementById('trip-id')?.value.trim().toUpperCase();
        const routeId = document.getElementById('trip-route-select')?.value;
        const dirId = parseInt(document.getElementById('trip-direction')?.value || '0', 10);
        const shapeId = document.getElementById('trip-shape-select')?.value;
        const headsign = document.getElementById('trip-headsign')?.value.trim();

        if (!tripId || !routeId) return;

        try {
          const res = await fetch('/api/gtfs/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trip_id: tripId,
              route_id: routeId,
              direction_id: dirId,
              shape_id: shapeId,
              trip_headsign: headsign
            })
          });
          const data = await res.json();
          if (data.success) {
            form.style.display = 'none';
            await loadTrips();
          } else {
            alert(`❌ Error al guardar viaje: ${data.error}`);
          }
        } catch (err) {
          alert(`❌ Error de conexión: ${err.message}`);
        }
      });
    }
  }

  window.deleteGtfsTrip = async function(tripId) {
    if (!confirm(`¿Desea eliminar el viaje "${tripId}"?`)) return;
    try {
      const res = await fetch('/api/gtfs/trips/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId })
      });
      const data = await res.json();
      if (data.success) await loadTrips();
      else alert(`❌ Error: ${data.error}`);
    } catch (e) {
      alert(`❌ Error de conexión: ${e.message}`);
    }
  };

  // --- FREQUENCIES ---
  let allFrequencies = [];

  async function loadFrequencies() {
    if (allTrips.length === 0) await loadTrips();

    const formFreq = document.getElementById('form-gtfs-freq');
    if (formFreq) formFreq.style.display = 'none';
    const idInput = document.getElementById('freq-id');
    if (idInput) idInput.value = '';

    try {
      const res = await fetch('/api/gtfs/frequencies');
      const freqs = await res.json();
      allFrequencies = freqs;

      const tbody = document.getElementById('gtfs-freq-table-body');
      if (!tbody) return;

      if (freqs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No hay intervalos programados aún. Haga clic en "+ Añadir Intervalo" para programar.</td></tr>';
        return;
      }

      tbody.innerHTML = freqs.map(f => {
        const mins = Math.round(f.headway_secs / 60);
        return `
          <tr>
            <td><strong style="color: #38bdf8;">${f.trip_id}</strong></td>
            <td>${f.start_time}</td>
            <td>${f.end_time}</td>
            <td>${f.headway_secs} s</td>
            <td><span class="badge-gps-ok">Cada ${mins} min</span></td>
            <td>
              <div style="display: flex; gap: 0.35rem;">
                <button class="tbl-action-btn" onclick="window.editGtfsFrequency(${f.id})" title="Modificar Intervalo" style="color: #38bdf8; border-color: rgba(56, 189, 248, 0.4);">
                  ✏️ Modificar
                </button>
                <button class="tbl-action-btn btn-delete" onclick="window.deleteGtfsFrequency(${f.id})" title="Eliminar Intervalo">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error('[GTFS] Error cargando frecuencias:', e);
    }
  }

  window.editGtfsFrequency = function(id) {
    const f = (allFrequencies || []).find(item => item.id === id);
    if (!f) return;
    const form = document.getElementById('form-gtfs-freq');
    const title = document.getElementById('freq-form-title');
    const idInput = document.getElementById('freq-id');
    const tripSel = document.getElementById('freq-trip-select');
    const startInput = document.getElementById('freq-start');
    const endInput = document.getElementById('freq-end');
    const minsInput = document.getElementById('freq-mins');

    if (idInput) idInput.value = f.id;
    if (title) title.textContent = `✏️ Modificar Intervalo [${f.trip_id}: ${f.start_time} - ${f.end_time}]`;
    if (tripSel) tripSel.value = f.trip_id;
    if (startInput) startInput.value = f.start_time.substring(0, 5);
    if (endInput) endInput.value = f.end_time.substring(0, 5);
    if (minsInput) minsInput.value = Math.round(f.headway_secs / 60);

    if (form) {
      form.style.display = 'block';
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  function setupFrequencyForm() {
    const form = document.getElementById('form-gtfs-freq');
    const btnShowAdd = document.getElementById('btn-show-add-freq');
    const btnCancel = document.getElementById('btn-cancel-freq');

    if (btnShowAdd) {
      btnShowAdd.addEventListener('click', () => {
        const idInput = document.getElementById('freq-id');
        const title = document.getElementById('freq-form-title');
        if (idInput) idInput.value = '';
        if (title) title.textContent = '➕ Añadir Nuevo Intervalo de Frecuencia';
        if (form) form.style.display = 'block';
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (form) form.style.display = 'none';
        const idInput = document.getElementById('freq-id');
        if (idInput) idInput.value = '';
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('freq-id')?.value;
        const tripId = document.getElementById('freq-trip-select')?.value;
        const startTime = document.getElementById('freq-start')?.value;
        const endTime = document.getElementById('freq-end')?.value;
        const mins = parseInt(document.getElementById('freq-mins')?.value || '5', 10);

        if (!tripId || !startTime || !endTime) {
          alert('Complete todos los campos del intervalo.');
          return;
        }

        const headwaySecs = mins * 60;
        const formattedStart = startTime.length === 5 ? `${startTime}:00` : startTime;
        const formattedEnd = endTime.length === 5 ? `${endTime}:00` : endTime;

        const payload = {
          trip_id: tripId,
          start_time: formattedStart,
          end_time: formattedEnd,
          headway_secs: headwaySecs
        };
        if (id) payload.id = parseInt(id, 10);

        try {
          const res = await fetch('/api/gtfs/frequencies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            form.style.display = 'none';
            await loadFrequencies();
          } else {
            alert(`❌ Error al guardar frecuencia: ${data.error}`);
          }
        } catch (err) {
          alert(`❌ Error de conexión: ${err.message}`);
        }
      });
    }
  }

  window.deleteGtfsFrequency = async function(id) {
    if (!confirm('¿Desea eliminar este intervalo de frecuencia?')) return;
    try {
      const res = await fetch('/api/gtfs/frequencies/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) await loadFrequencies();
      else alert(`❌ Error: ${data.error}`);
    } catch (e) {
      alert(`❌ Error de conexión: ${e.message}`);
    }
  };

  // --- EXPORTADORES & PREVISUALIZADOR CSV ---
  function setupExportHandlers() {
    document.querySelectorAll('.gtfs-export-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const filename = btn.getAttribute('data-export-file');
        if (!filename) return;

        const previewBox = document.getElementById('gtfs-preview-csv');
        if (previewBox) {
          previewBox.textContent = `⏳ Generando previsualización de ${filename} desde SQLite...`;
        }

        try {
          const res = await fetch(`/api/gtfs/export/${filename}`);
          const text = await res.text();
          if (previewBox) {
            previewBox.textContent = text;
          }
        } catch (err) {
          if (previewBox) {
            previewBox.textContent = `Error previsualizando ${filename}: ${err.message}`;
          }
        }
      });
    });
  }

  // Cargar inventario inicial de flota
  loadFleet();

  // Iniciar conexión en tiempo real al cargar página
  initSse();

})();
