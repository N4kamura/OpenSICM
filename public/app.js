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
      const res = await fetch('/api/fleet');
      const data = await res.json();
      fleetData = data.units || [];

      if (fStatTotal) fStatTotal.textContent = data.stats?.total || fleetData.length;
      if (fStatConGps) fStatConGps.textContent = data.stats?.conGps || 0;
      if (fStatSinGps) fStatSinGps.textContent = data.stats?.sinGps || 0;

      renderFleetTable();
    } catch (err) {
      console.error('Error cargando flota:', err);
    }
  }

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
          <td><span class="bus-ruta-badge">${u.ruta || 'S/R'}</span></td>
          <td>${u.padron || '-'}</td>
          <td>${gpsBadge}</td>
          <td>${u.modeloGps || '<span style="color: var(--text-dim);">No asignado</span>'}</td>
          <td style="font-family: monospace; color: ${u.imei ? '#38bdf8' : 'var(--text-dim)'};">${u.imei || 'Sin módem'}</td>
          <td>
            <div style="display: flex; gap: 0.35rem;">
              <button class="tbl-action-btn" onclick="window.editUnit('${u.placa}')" title="Asignar o editar GPS">
                🔧 Asignar GPS
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

    document.getElementById('unit-modal-title').textContent = unit ? `🔧 Asignar GPS a Unidad [${unit.placa}]` : '➕ Registrar Unidad / Asignar GPS';
    document.getElementById('unit-form-placa').value = unit ? unit.placa : '';
    document.getElementById('unit-form-placa').readOnly = !!unit;
    document.getElementById('unit-form-ruta').value = unit ? unit.ruta : 'IO33B';
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

  // Cargar inventario inicial de flota
  loadFleet();

  // Iniciar conexión en tiempo real al cargar página
  initSse();

})();
