/**
 * kds.js — Kitchen Display System
 * 
 * Muestra en tiempo real las comandas activas de las mesas
 * usando Supabase Realtime. Incluye panel de configuración
 * para columnas y selección de mesas.
 */

import { createClient } from '@supabase/supabase-js';

// ── Supabase ──────────────────────────────────────────────
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase        = createClient(supabaseUrl, supabaseAnonKey);

// ── KDS Config (persisted to localStorage) ────────────────
const CONFIG_KEY = 'kds-config-v1';
const DEFAULT_CONFIG = {
  columns: 3,
  showOnlyOccupied: true,
  visibleTableIds: null  // null = all tables visible
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ── App State ─────────────────────────────────────────────
let state = {
  tables: [],
  connected: false,
  config: loadConfig(),
  settingsOpen: false,
  tableStartTimes: {},   // tableId → timestamp (ms) when first occupied
  allTableDefs: []       // full list of table definitions (for settings)
};

// ── Realtime Channel ──────────────────────────────────────
let channel = null;

// ── DOM Root ──────────────────────────────────────────────
const root = document.getElementById('kds-root');

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function getItemTotal(item) {
  const opts = (item.selectedOptions || []).reduce((s, o) => s + (o.price * o.qty), 0);
  return (item.price + opts) * item.qty;
}

function getTableTotal(table) {
  return (table.items || []).reduce((s, i) => s + getItemTotal(i), 0);
}

function getElapsedMinutes(tableId) {
  const start = state.tableStartTimes[tableId];
  if (!start) return 0;
  return Math.floor((Date.now() - start) / 60000);
}

function getTimeClass(minutes) {
  if (minutes < 10) return 'fresh';
  if (minutes < 20) return 'medium';
  return 'urgent';
}

function formatTime(minutes) {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatClock() {
  const now = new Date();
  return now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate() {
  const now = new Date();
  return now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Track when tables became occupied (reset if cleared)
function updateTableStartTimes(newTables) {
  newTables.forEach(table => {
    const id = table.id;
    const isOccupied = (table.items || []).length > 0;
    if (isOccupied && !state.tableStartTimes[id]) {
      state.tableStartTimes[id] = Date.now();
    } else if (!isOccupied && state.tableStartTimes[id]) {
      delete state.tableStartTimes[id];
    }
  });
}

// ══════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════

function getVisibleTables() {
  const { showOnlyOccupied, visibleTableIds } = state.config;
  let tables = state.tables;

  if (visibleTableIds !== null) {
    tables = tables.filter(t => visibleTableIds.includes(t.id));
  }

  if (showOnlyOccupied) {
    tables = tables.filter(t => (t.items || []).length > 0);
  }

  return tables;
}

function renderCard(table) {
  const elapsed = getElapsedMinutes(table.id);
  const timeClass = getTimeClass(elapsed);
  const total = getTableTotal(table);
  const totalQty = (table.items || []).reduce((s, i) => s + i.qty, 0);

  const itemsHtml = (table.items || []).map(item => {
    const opts = item.selectedOptions && item.selectedOptions.length > 0
      ? `<div class="kds-item-opts">${item.selectedOptions.map(o => `+ ${o.name} ×${o.qty}`).join(' · ')}</div>`
      : '';
    return `
      <div class="kds-item">
        <span class="kds-item-qty">${item.qty}×</span>
        <div style="flex:1; min-width:0;">
          <div class="kds-item-name">${item.name}</div>
          ${opts}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="kds-card ${timeClass}" data-table-id="${table.id}">
      <div class="kds-card-header">
        <span class="kds-card-name">${table.name}</span>
        <span class="kds-card-time">${formatTime(elapsed)}</span>
      </div>
      <div class="kds-card-items">
        ${itemsHtml}
      </div>
      <div class="kds-card-footer">
        <span class="kds-card-count">${totalQty} artículo${totalQty !== 1 ? 's' : ''}</span>
        <span class="kds-card-total">${total.toFixed(2)}€</span>
      </div>
    </div>
  `;
}

function renderGrid() {
  const visible = getVisibleTables();
  const occupiedCount = state.tables.filter(t => (t.items || []).length > 0).length;

  if (visible.length === 0) {
    return `
      <div class="kds-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px; height:56px;">
          <path d="M4 10h16M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M7 10l-2 9M17 10l2 9M9 14h6"/>
        </svg>
        <p>No hay comandas activas</p>
      </div>
    `;
  }

  return visible.map(renderCard).join('');
}

function renderSettingsPanel() {
  const { columns, showOnlyOccupied, visibleTableIds } = state.config;

  const diningTables = state.allTableDefs.filter(t => (t.type || 'table') === 'table');
  const takeawayTables = state.allTableDefs.filter(t => t.type === 'takeaway');

  const isVisible = (id) => visibleTableIds === null || visibleTableIds.includes(id);

  const tableCheckboxes = (list) => list.map(t => {
    const occupied = (t.items || []).length > 0;
    const checked = isVisible(t.id) ? 'checked' : '';
    return `
      <label class="kds-table-checkbox">
        <input type="checkbox" data-table-id="${t.id}" ${checked}>
        <span class="kds-table-checkbox-label">${t.name}</span>
        <span class="kds-table-checkbox-status ${occupied ? 'occupied' : ''}">${occupied ? '● Ocupada' : 'Libre'}</span>
      </label>
    `;
  }).join('');

  const colOptions = [2, 3, 4, 5].map(n => `
    <button class="kds-col-btn ${n === columns ? 'active' : ''}" data-cols="${n}">
      ${n}
      <span>${n}×${n === 2 ? '4' : n === 3 ? '4' : n === 4 ? '3' : '2+'}</span>
    </button>
  `).join('');

  return `
    <div class="kds-settings-overlay" id="kds-settings-overlay">
      <div class="kds-settings-panel">
        <div class="kds-settings-header">
          <h2>⚙️ Configuración del KDS</h2>
          <button class="kds-settings-close" id="kds-settings-close">✕</button>
        </div>
        <div class="kds-settings-body">

          <div class="kds-settings-section">
            <h3>Columnas de la cuadrícula</h3>
            <div class="kds-cols-grid">${colOptions}</div>
          </div>

          <div class="kds-settings-section">
            <h3>Modo de visualización</h3>
            <div class="kds-toggle-row">
              <div>
                <div class="kds-toggle-label">Solo mesas ocupadas</div>
                <div class="kds-toggle-sub">Oculta las mesas sin pedidos activos</div>
              </div>
              <label class="kds-toggle">
                <input type="checkbox" id="kds-toggle-occupied" ${showOnlyOccupied ? 'checked' : ''}>
                <span class="kds-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="kds-settings-section">
            <h3>Mesas de Sala</h3>
            <div class="kds-select-links">
              <span class="kds-select-link" data-select="all-dining">Seleccionar todas</span>
              <span class="kds-select-link" data-select="none-dining">Ninguna</span>
            </div>
            <div class="kds-table-list" id="kds-dining-list">
              ${tableCheckboxes(diningTables)}
            </div>
          </div>

          <div class="kds-settings-section">
            <h3>Para Llevar</h3>
            <div class="kds-select-links">
              <span class="kds-select-link" data-select="all-takeaway">Seleccionar todas</span>
              <span class="kds-select-link" data-select="none-takeaway">Ninguna</span>
            </div>
            <div class="kds-table-list" id="kds-takeaway-list">
              ${tableCheckboxes(takeawayTables)}
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
}

function renderHeader() {
  const occupiedCount = state.tables.filter(t => (t.items || []).length > 0).length;
  const totalItems = state.tables.reduce((s, t) => s + (t.items || []).reduce((ss, i) => ss + i.qty, 0), 0);

  return `
    <header class="kds-header">
      <div class="kds-logo">
        <svg class="kds-logo-icon" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M160 180H320C320 250 280 290 220 290H200C160 290 160 250 160 180Z" fill="url(#kdsGrad)"/>
          <path d="M320 200H345C365 200 365 240 345 240H320" stroke="url(#kdsGrad)" stroke-width="20" stroke-linecap="round"/>
          <path d="M195 140Q205 120 195 100" stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
          <path d="M240 135Q250 115 240 95" stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
          <path d="M285 140Q295 120 285 100" stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
          <defs>
            <linearGradient id="kdsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#10b981"/>
              <stop offset="100%" stop-color="#2563eb"/>
            </linearGradient>
          </defs>
        </svg>
        <span class="kds-logo-text">Esencia KDS</span>
      </div>

      <div>
        <div class="kds-clock" id="kds-clock">${formatClock()}</div>
        <div class="kds-date" id="kds-date">${formatDate()}</div>
      </div>

      <div class="kds-header-actions">
        <div class="kds-stats">
          <span class="kds-stat">Mesas <strong>${occupiedCount}</strong></span>
          <span class="kds-stat">Artículos <strong>${totalItems}</strong></span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="kds-status-dot ${state.connected ? '' : 'disconnected'}" id="kds-status-dot"></div>
          <span class="kds-status-label">${state.connected ? 'En línea' : 'Reconectando...'}</span>
        </div>
        <button class="kds-settings-btn" id="kds-open-settings" title="Configuración">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </header>
  `;
}

function render() {
  const settingsHtml = state.settingsOpen ? renderSettingsPanel() : '';

  root.innerHTML = `
    ${renderHeader()}
    <main class="kds-main">
      <div class="kds-grid" id="kds-grid" style="--kds-cols: ${state.config.columns}">
        ${renderGrid()}
      </div>
    </main>
    ${settingsHtml}
  `;

  bindEvents();
}

// ══════════════════════════════════════════════════════════
// EVENTS
// ══════════════════════════════════════════════════════════

function bindEvents() {
  // Open settings
  const openBtn = document.getElementById('kds-open-settings');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      state.settingsOpen = true;
      render();
    });
  }

  // Close settings (overlay click or close btn)
  const overlay = document.getElementById('kds-settings-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        state.settingsOpen = false;
        render();
      }
    });
    const closeBtn = document.getElementById('kds-settings-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        state.settingsOpen = false;
        render();
      });
    }

    // Column buttons
    overlay.querySelectorAll('.kds-col-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.config.columns = parseInt(btn.dataset.cols, 10);
        saveConfig(state.config);
        render();
      });
    });

    // Toggle occupied-only
    const toggleOccupied = document.getElementById('kds-toggle-occupied');
    if (toggleOccupied) {
      toggleOccupied.addEventListener('change', () => {
        state.config.showOnlyOccupied = toggleOccupied.checked;
        saveConfig(state.config);
        render();
      });
    }

    // Table checkboxes
    overlay.querySelectorAll('input[data-table-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.tableId, 10);
        // If visibleTableIds is null (all), expand to all first
        if (state.config.visibleTableIds === null) {
          state.config.visibleTableIds = state.allTableDefs.map(t => t.id);
        }
        if (cb.checked) {
          if (!state.config.visibleTableIds.includes(id)) {
            state.config.visibleTableIds.push(id);
          }
        } else {
          state.config.visibleTableIds = state.config.visibleTableIds.filter(i => i !== id);
        }
        // If all tables selected, go back to null
        if (state.config.visibleTableIds.length === state.allTableDefs.length) {
          state.config.visibleTableIds = null;
        }
        saveConfig(state.config);
        render();
      });
    });

    // Select all / none links
    overlay.querySelectorAll('[data-select]').forEach(link => {
      link.addEventListener('click', () => {
        const action = link.dataset.select;
        const diningIds = state.allTableDefs.filter(t => (t.type || 'table') === 'table').map(t => t.id);
        const takeawayIds = state.allTableDefs.filter(t => t.type === 'takeaway').map(t => t.id);
        let current = state.config.visibleTableIds === null
          ? state.allTableDefs.map(t => t.id)
          : [...state.config.visibleTableIds];

        if (action === 'all-dining') {
          diningIds.forEach(id => { if (!current.includes(id)) current.push(id); });
        } else if (action === 'none-dining') {
          current = current.filter(id => !diningIds.includes(id));
        } else if (action === 'all-takeaway') {
          takeawayIds.forEach(id => { if (!current.includes(id)) current.push(id); });
        } else if (action === 'none-takeaway') {
          current = current.filter(id => !takeawayIds.includes(id));
        }

        state.config.visibleTableIds = current.length === state.allTableDefs.length ? null : current;
        saveConfig(state.config);
        render();
      });
    });
  }
}

// ══════════════════════════════════════════════════════════
// REALTIME & INIT
// ══════════════════════════════════════════════════════════

// Build the base table definition list (all 12 dining + 8 takeaway)
function buildAllTableDefs() {
  const dining = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    name: `Mesa ${i + 1}`,
    type: 'table',
    items: []
  }));
  const takeaway = Array.from({ length: 8 }, (_, i) => ({
    id: 101 + i,
    name: `Take Away ${i + 1}`,
    type: 'takeaway',
    items: []
  }));
  return [...dining, ...takeaway];
}

function mergeTablesWithDefs(savedTables) {
  const map = new Map(savedTables.map(t => [Number(t.id), t]));
  return state.allTableDefs.map(def => {
    const saved = map.get(def.id);
    return saved ? { ...def, ...saved } : { ...def };
  });
}

async function loadInitialState() {
  try {
    const { data, error } = await supabase
      .from('tpv_state')
      .select('*')
      .eq('id', 'global')
      .single();

    if (error || !data) return;

    if (Array.isArray(data.tables)) {
      const merged = mergeTablesWithDefs(data.tables);
      updateTableStartTimes(merged);
      state.tables = merged;
    }
  } catch (err) {
    console.warn('[KDS] Error cargando estado inicial:', err);
  }
}

function subscribeRealtime() {
  if (channel) channel.unsubscribe();

  channel = supabase
    .channel('kds-realtime')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'tpv_state',
      filter: 'id=eq.global'
    }, (payload) => {
      if (!payload.new) return;
      const { tables } = payload.new;
      if (Array.isArray(tables)) {
        const merged = mergeTablesWithDefs(tables);
        updateTableStartTimes(merged);
        state.tables = merged;
        // Only re-render if settings are not open (avoid resetting config form)
        if (!state.settingsOpen) {
          render();
        } else {
          // Just update the grid without re-opening settings
          const grid = document.getElementById('kds-grid');
          if (grid) {
            grid.style.setProperty('--kds-cols', state.config.columns);
            grid.innerHTML = renderGrid();
          }
        }
      }
    })
    .subscribe((status) => {
      const wasConnected = state.connected;
      state.connected = status === 'SUBSCRIBED';
      if (wasConnected !== state.connected) {
        // Update just the status indicator
        const dot = document.getElementById('kds-status-dot');
        const label = dot?.nextElementSibling;
        if (dot) {
          dot.className = `kds-status-dot ${state.connected ? '' : 'disconnected'}`;
        }
        if (label) {
          label.textContent = state.connected ? 'En línea' : 'Reconectando...';
        }
      }
    });
}

// Refresh elapsed times every 30 seconds (for color class updates)
function startTimeRefresh() {
  setInterval(() => {
    if (!state.settingsOpen) {
      const grid = document.getElementById('kds-grid');
      if (grid) {
        grid.innerHTML = renderGrid();
      }
    }
  }, 30_000);
}

// Live clock update every second
function startClock() {
  setInterval(() => {
    const el = document.getElementById('kds-clock');
    if (el) el.textContent = formatClock();
  }, 1000);
}

// ══════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════

async function init() {
  state.allTableDefs = buildAllTableDefs();

  // Load initial data
  await loadInitialState();

  // First render (removes loading screen)
  render();

  // Subscribe to realtime
  subscribeRealtime();

  // Start timers
  startClock();
  startTimeRefresh();
}

init();
