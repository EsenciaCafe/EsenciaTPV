/**
 * kds.js — Kitchen Display System
 *
 * Features:
 * - Realtime Supabase sync
 * - Per-table order status: waiting (yellow) → urgent (red) → ready (green)
 * - LISTO button to mark table as done; items stored as delivered
 * - New items on a ready table → reverts to waiting, old delivered items shown strikethrough
 * - Configurable time thresholds, grid columns, font size, sounds, table visibility
 */

import { createClient } from '@supabase/supabase-js';

// ── Supabase ─────────────────────────────────────────────────────────────────
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase        = createClient(supabaseUrl, supabaseAnonKey);

// ── Config (persisted per device in localStorage) ────────────────────────────
const CONFIG_KEY = 'kds-config-v2';
const DEFAULT_CONFIG = {
  columns: 3,
  showOnlyOccupied: true,
  visibleTableIds: null,         // null = all tables
  yellowToRedMinutes: 10,        // minutes until a waiting order turns red
  fontSize: 'md',               // 'sm' | 'md' | 'lg'
  showPrices: false,            // show price per line item
  soundOnNew: false,            // play beep when a new order arrives
  autoResetReady: false,        // auto-clear "ready" status when table is cleared by TPV
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}
function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ── Table KDS State (per-device, persisted) ──────────────────────────────────
// tableKdsState[tableId] = { status: 'waiting'|'ready', readyAt: ts|null,
//                            deliveredItems: [{ticketItemId, qty}] }
const TABLE_KDS_KEY = 'kds-table-state-v1';

function loadTableKdsState() {
  try {
    const raw = localStorage.getItem(TABLE_KDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}
function saveTableKdsState() {
  localStorage.setItem(TABLE_KDS_KEY, JSON.stringify(state.tableKdsState));
}

// ── App State ─────────────────────────────────────────────────────────────────
let state = {
  tables: [],
  connected: false,
  config: loadConfig(),
  settingsOpen: false,
  tableStartTimes: {},    // tableId → ms when first occupied
  tableKdsState: loadTableKdsState(),  // per-table KDS status
  allTableDefs: [],
};

let channel = null;
const root = document.getElementById('kds-root');

// ── Audio ─────────────────────────────────────────────────────────────────────
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function getItemTotal(item) {
  const opts = (item.selectedOptions || []).reduce((s, o) => s + (o.price || 0) * (o.qty || 1), 0);
  return ((item.price || 0) + opts) * (item.qty || 1);
}
function getTableTotal(table) {
  return (table.items || []).reduce((s, i) => s + getItemTotal(i), 0);
}
function getElapsedMinutes(tableId) {
  const start = state.tableStartTimes[tableId];
  if (!start) return 0;
  return Math.floor((Date.now() - start) / 60000);
}
function formatElapsed(minutes) {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function formatClock() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatDate() {
  return new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Table start time tracking ─────────────────────────────────────────────────
function updateTableStartTimes(newTables) {
  newTables.forEach(table => {
    const id = table.id;
    const isOccupied = (table.items || []).length > 0;
    if (isOccupied && !state.tableStartTimes[id]) {
      state.tableStartTimes[id] = Date.now();
    } else if (!isOccupied) {
      delete state.tableStartTimes[id];
    }
  });
}

// ── KDS Status helpers ────────────────────────────────────────────────────────
function getTableKds(tableId) {
  return state.tableKdsState[tableId] || { status: 'waiting', readyAt: null, deliveredItems: [] };
}

/** Get the CSS class for a card based on its KDS status and elapsed time */
function getCardClass(tableId) {
  const kds = getTableKds(tableId);
  if (kds.status === 'ready') return 'ready';
  const elapsed = getElapsedMinutes(tableId);
  const threshold = state.config.yellowToRedMinutes;
  return elapsed >= threshold ? 'urgent' : 'waiting';
}

/** When "LISTO" is clicked on a table */
function markTableReady(tableId) {
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;
  state.tableKdsState[tableId] = {
    status: 'ready',
    readyAt: Date.now(),
    deliveredItems: (table.items || []).map(i => ({
      ticketItemId: i.ticketItemId,
      id: i.id,
      qty: i.qty
    }))
  };
  saveTableKdsState();
  render();
}

/** Reopen a ready table (undo LISTO) */
function reopenTable(tableId) {
  const kds = getTableKds(tableId);
  state.tableKdsState[tableId] = { ...kds, status: 'waiting', readyAt: null };
  saveTableKdsState();
  render();
}

/**
 * When realtime arrives for a table that was 'ready':
 * - Check if any new items appeared or any qty increased beyond delivered
 * - If yes → revert to 'waiting', keep deliveredItems for strikethrough display
 * - Play sound if configured
 */
function checkForNewItemsOnReadyTable(tableId, newItems) {
  const kds = getTableKds(tableId);
  if (kds.status !== 'ready') return false;

  const delivered = kds.deliveredItems || [];
  let hasNew = false;

  for (const item of newItems) {
    const del = delivered.find(d => d.ticketItemId === item.ticketItemId);
    if (!del) {
      hasNew = true; break;
    }
    if (item.qty > del.qty) {
      hasNew = true; break;
    }
  }

  if (hasNew) {
    // Revert to waiting but keep deliveredItems
    state.tableKdsState[tableId] = { ...kds, status: 'waiting', readyAt: null };
    saveTableKdsState();
    if (state.config.soundOnNew) playBeep();
    return true;
  }
  return false;
}

/**
 * Check if this is a brand-new occupied table (no KDS state yet or was cleared)
 */
function checkForNewTable(tableId, newItems) {
  if (!state.tableKdsState[tableId] && newItems.length > 0) {
    if (state.config.soundOnNew) playBeep();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════════════════════

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

/** Render one item line, accounting for delivered qty (strikethrough) */
function renderItem(item, deliveredItems) {
  const del = deliveredItems.find(d => d.ticketItemId === item.ticketItemId);
  const deliveredQty = del?.qty || 0;
  const currentQty = item.qty;
  const priceHtml = state.config.showPrices
    ? `<span class="kds-item-price">${getItemTotal(item).toFixed(2)}€</span>`
    : '';

  const opts = item.selectedOptions && item.selectedOptions.length > 0
    ? `<div class="kds-item-opts">${item.selectedOptions.map(o => `+ ${o.name}${o.qty > 1 ? ` ×${o.qty}` : ''}`).join(' · ')}</div>`
    : '';

  // All delivered → strikethrough
  if (deliveredQty >= currentQty) {
    return `
      <div class="kds-item delivered">
        <span class="kds-item-qty">${currentQty}×</span>
        <div style="flex:1; min-width:0;">
          <div class="kds-item-name">${item.name}</div>
          ${opts}
        </div>
        ${priceHtml}
      </div>
    `;
  }

  // Partially delivered → show delivered qty strikethrough + pending qty normal
  if (deliveredQty > 0) {
    const pendingQty = currentQty - deliveredQty;
    return `
      <div class="kds-item delivered">
        <span class="kds-item-qty">${deliveredQty}×</span>
        <div style="flex:1; min-width:0;">
          <div class="kds-item-name">${item.name}</div>
          ${opts}
        </div>
        ${state.config.showPrices ? `<span class="kds-item-price">${(getItemTotal({...item, qty: deliveredQty})).toFixed(2)}€</span>` : ''}
      </div>
      <div class="kds-item new-item">
        <span class="kds-item-qty">${pendingQty}×</span>
        <div style="flex:1; min-width:0;">
          <div class="kds-item-name">${item.name}</div>
          ${opts}
        </div>
        ${state.config.showPrices ? `<span class="kds-item-price">${(getItemTotal({...item, qty: pendingQty})).toFixed(2)}€</span>` : ''}
      </div>
    `;
  }

  // Not delivered at all
  return `
    <div class="kds-item">
      <span class="kds-item-qty">${currentQty}×</span>
      <div style="flex:1; min-width:0;">
        <div class="kds-item-name">${item.name}</div>
        ${opts}
      </div>
      ${priceHtml}
    </div>
  `;
}

function renderCard(table) {
  const kds = getTableKds(table.id);
  const cardClass = getCardClass(table.id);
  const elapsed = getElapsedMinutes(table.id);
  const total = getTableTotal(table);
  const totalQty = (table.items || []).reduce((s, i) => s + i.qty, 0);
  const deliveredItems = kds.deliveredItems || [];

  const itemsHtml = (table.items || [])
    .map(item => renderItem(item, deliveredItems))
    .join('');

  // Status badge
  let timeBadge;
  if (cardClass === 'ready') {
    timeBadge = `<span class="kds-card-time ready">✓ Listo</span>`;
  } else {
    timeBadge = `<span class="kds-card-time ${cardClass}">${formatElapsed(elapsed)}</span>`;
  }

  // LISTO / REABRIR button
  const actionBtn = kds.status === 'ready'
    ? `<button class="kds-ready-btn reopen" data-table-id="${table.id}">↩ Reabrir</button>`
    : `<button class="kds-ready-btn" data-table-id="${table.id}">✓ Listo</button>`;

  const fontSizeClass = `font-${state.config.fontSize}`;

  return `
    <div class="kds-card ${cardClass} ${fontSizeClass}" data-table-id="${table.id}">
      <div class="kds-card-header">
        <span class="kds-card-name">${table.name}</span>
        ${timeBadge}
      </div>
      <div class="kds-card-items">
        ${itemsHtml}
      </div>
      <div class="kds-card-footer">
        <span class="kds-card-count">${totalQty} artículo${totalQty !== 1 ? 's' : ''}</span>
        <span class="kds-card-total">${total.toFixed(2)}€</span>
        ${actionBtn}
      </div>
    </div>
  `;
}

function renderGrid() {
  const visible = getVisibleTables();

  if (visible.length === 0) {
    return `
      <div class="kds-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;">
          <path d="M4 10h16M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M7 10l-2 9M17 10l2 9M9 14h6"/>
        </svg>
        <p>No hay comandas activas</p>
      </div>
    `;
  }

  return visible.map(renderCard).join('');
}

// ── Settings panel ────────────────────────────────────────────────────────────
function renderToggleRow(id, label, sub, checked) {
  return `
    <div class="kds-toggle-row">
      <div>
        <div class="kds-toggle-label">${label}</div>
        ${sub ? `<div class="kds-toggle-sub">${sub}</div>` : ''}
      </div>
      <label class="kds-toggle">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
        <span class="kds-toggle-slider"></span>
      </label>
    </div>
  `;
}

function renderSettingsPanel() {
  const { columns, showOnlyOccupied, visibleTableIds, yellowToRedMinutes,
          fontSize, showPrices, soundOnNew, autoResetReady } = state.config;

  const diningTables = state.allTableDefs.filter(t => (t.type || 'table') === 'table');
  const takeawayTables = state.allTableDefs.filter(t => t.type === 'takeaway');
  const isVisible = (id) => visibleTableIds === null || visibleTableIds.includes(id);

  const tableCheckboxes = (list) => list.map(t => {
    const occupied = (t.items || []).length > 0;
    return `
      <label class="kds-table-checkbox">
        <input type="checkbox" data-table-id="${t.id}" ${isVisible(t.id) ? 'checked' : ''}>
        <span class="kds-table-checkbox-label">${t.name}</span>
        <span class="kds-table-checkbox-status ${occupied ? 'occupied' : ''}">${occupied ? '● Ocupada' : 'Libre'}</span>
      </label>
    `;
  }).join('');

  const colOptions = [2, 3, 4, 5].map(n => `
    <button class="kds-col-btn ${n === columns ? 'active' : ''}" data-cols="${n}">
      ${n}<span>${['','','2×4','3×4','4×3','5×2+'][n] || ''}</span>
    </button>
  `).join('');

  const fontButtons = ['sm', 'md', 'lg'].map(s => `
    <button class="kds-font-btn ${fontSize === s ? 'active' : ''}" data-font="${s}">
      ${{sm:'Pequeño', md:'Normal', lg:'Grande'}[s]}
    </button>
  `).join('');

  return `
    <div class="kds-settings-overlay" id="kds-settings-overlay">
      <div class="kds-settings-panel">
        <div class="kds-settings-header">
          <h2>⚙️ Configuración KDS</h2>
          <button class="kds-settings-close" id="kds-settings-close">✕</button>
        </div>
        <div class="kds-settings-body">

          <div class="kds-settings-section">
            <h3>Columnas de la cuadrícula</h3>
            <div class="kds-cols-grid">${colOptions}</div>
          </div>

          <div class="kds-settings-section">
            <h3>Tamaño del texto</h3>
            <div class="kds-font-grid">${fontButtons}</div>
          </div>

          <div class="kds-settings-section">
            <h3>Tiempos de alerta</h3>
            <div class="kds-threshold-row">
              <label class="kds-toggle-label" for="kds-threshold">Amarillo → Rojo (minutos)</label>
              <div class="kds-threshold-controls">
                <button class="kds-threshold-btn" data-delta="-1">−</button>
                <input class="kds-threshold-input" id="kds-threshold" type="number"
                  min="1" max="60" value="${yellowToRedMinutes}">
                <button class="kds-threshold-btn" data-delta="1">+</button>
              </div>
            </div>
            <div class="kds-threshold-hint">
              Después de <strong>${yellowToRedMinutes} min</strong> sin marcar como listo,
              la comanda se pondrá en rojo y parpadeará.
            </div>
          </div>

          <div class="kds-settings-section">
            <h3>Opciones</h3>
            ${renderToggleRow('kds-toggle-occupied', 'Solo mesas ocupadas', 'Oculta las mesas sin pedidos', showOnlyOccupied)}
            ${renderToggleRow('kds-toggle-prices', 'Mostrar precios por artículo', '', showPrices)}
            ${renderToggleRow('kds-toggle-sound', 'Sonido al recibir comanda', 'Emite un pitido al llegar pedido nuevo', soundOnNew)}
            ${renderToggleRow('kds-toggle-autoreset', 'Limpiar estado "Listo" automáticamente', 'Cuando el TPV cierra la comanda', autoResetReady)}
          </div>

          <div class="kds-settings-section">
            <h3>Mesas de Sala</h3>
            <div class="kds-select-links">
              <span class="kds-select-link" data-select="all-dining">Todas</span>
              <span class="kds-select-link" data-select="none-dining">Ninguna</span>
            </div>
            <div class="kds-table-list">${tableCheckboxes(diningTables)}</div>
          </div>

          <div class="kds-settings-section">
            <h3>Para Llevar</h3>
            <div class="kds-select-links">
              <span class="kds-select-link" data-select="all-takeaway">Todas</span>
              <span class="kds-select-link" data-select="none-takeaway">Ninguna</span>
            </div>
            <div class="kds-table-list">${tableCheckboxes(takeawayTables)}</div>
          </div>

        </div>
      </div>
    </div>
  `;
}

function renderHeader() {
  const occupiedCount = state.tables.filter(t => (t.items || []).length > 0).length;
  const readyCount = Object.values(state.tableKdsState).filter(s => s.status === 'ready').length;
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

      <div style="text-align:center;">
        <div class="kds-clock" id="kds-clock">${formatClock()}</div>
        <div class="kds-date">${formatDate()}</div>
      </div>

      <div class="kds-header-actions">
        <div class="kds-stats">
          <span class="kds-stat">Mesas <strong>${occupiedCount}</strong></span>
          <span class="kds-stat ready-stat">Listos <strong>${readyCount}</strong></span>
          <span class="kds-stat">Artículos <strong>${totalItems}</strong></span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="kds-status-dot ${state.connected ? '' : 'disconnected'}" id="kds-status-dot"></div>
          <span class="kds-status-label">${state.connected ? 'En línea' : 'Reconectando...'}</span>
        </div>
        <button class="kds-settings-btn" id="kds-open-settings" title="Configuración">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;">
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
      <div class="kds-grid" id="kds-grid" style="--kds-cols:${state.config.columns}">
        ${renderGrid()}
      </div>
    </main>
    ${settingsHtml}
  `;
  bindEvents();
}

// ── Partial grid refresh (no settings panel rerender) ─────────────────────────
function refreshGrid() {
  const grid = document.getElementById('kds-grid');
  if (grid) {
    grid.style.setProperty('--kds-cols', state.config.columns);
    grid.innerHTML = renderGrid();
    bindCardEvents();
  }
  // Also refresh header stats
  const header = document.querySelector('.kds-header');
  if (header) header.outerHTML = renderHeader();
}

// ══════════════════════════════════════════════════════════════════════════════
// EVENTS
// ══════════════════════════════════════════════════════════════════════════════

function bindCardEvents() {
  document.querySelectorAll('.kds-ready-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tableId = parseInt(btn.dataset.tableId, 10);
      if (btn.classList.contains('reopen')) {
        reopenTable(tableId);
      } else {
        markTableReady(tableId);
      }
    });
  });
}

function bindSettingsEvents() {
  const overlay = document.getElementById('kds-settings-overlay');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { state.settingsOpen = false; render(); }
  });

  document.getElementById('kds-settings-close')?.addEventListener('click', () => {
    state.settingsOpen = false; render();
  });

  // Columns
  overlay.querySelectorAll('.kds-col-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.config.columns = parseInt(btn.dataset.cols, 10);
      saveConfig(state.config); render();
    });
  });

  // Font size
  overlay.querySelectorAll('.kds-font-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.config.fontSize = btn.dataset.font;
      saveConfig(state.config); render();
    });
  });

  // Threshold +/- buttons
  overlay.querySelectorAll('.kds-threshold-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = parseInt(btn.dataset.delta, 10);
      const input = document.getElementById('kds-threshold');
      let val = parseInt(input?.value || '10', 10) + delta;
      val = Math.max(1, Math.min(60, val));
      state.config.yellowToRedMinutes = val;
      saveConfig(state.config); render();
    });
  });

  // Threshold direct input
  document.getElementById('kds-threshold')?.addEventListener('change', (e) => {
    let val = parseInt(e.target.value, 10);
    val = Math.max(1, Math.min(60, val));
    state.config.yellowToRedMinutes = val;
    saveConfig(state.config); render();
  });

  // Toggles
  const toggleMap = {
    'kds-toggle-occupied':  'showOnlyOccupied',
    'kds-toggle-prices':    'showPrices',
    'kds-toggle-sound':     'soundOnNew',
    'kds-toggle-autoreset': 'autoResetReady',
  };
  Object.entries(toggleMap).forEach(([id, key]) => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      state.config[key] = e.target.checked;
      saveConfig(state.config); render();
    });
  });

  // Table checkboxes
  overlay.querySelectorAll('input[data-table-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.tableId, 10);
      if (state.config.visibleTableIds === null) {
        state.config.visibleTableIds = state.allTableDefs.map(t => t.id);
      }
      if (cb.checked) {
        if (!state.config.visibleTableIds.includes(id)) state.config.visibleTableIds.push(id);
      } else {
        state.config.visibleTableIds = state.config.visibleTableIds.filter(i => i !== id);
      }
      if (state.config.visibleTableIds.length === state.allTableDefs.length) {
        state.config.visibleTableIds = null;
      }
      saveConfig(state.config); render();
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

      if (action === 'all-dining')      diningIds.forEach(id => { if (!current.includes(id)) current.push(id); });
      else if (action === 'none-dining')   current = current.filter(id => !diningIds.includes(id));
      else if (action === 'all-takeaway')  takeawayIds.forEach(id => { if (!current.includes(id)) current.push(id); });
      else if (action === 'none-takeaway') current = current.filter(id => !takeawayIds.includes(id));

      state.config.visibleTableIds = current.length === state.allTableDefs.length ? null : current;
      saveConfig(state.config); render();
    });
  });
}

function bindEvents() {
  document.getElementById('kds-open-settings')?.addEventListener('click', () => {
    state.settingsOpen = true; render();
  });
  bindCardEvents();
  bindSettingsEvents();
}

// ══════════════════════════════════════════════════════════════════════════════
// REALTIME & DATA
// ══════════════════════════════════════════════════════════════════════════════

function buildAllTableDefs() {
  const dining = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1, name: `Mesa ${i + 1}`, type: 'table', items: []
  }));
  const takeaway = Array.from({ length: 8 }, (_, i) => ({
    id: 101 + i, name: `Take Away ${i + 1}`, type: 'takeaway', items: []
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
      .from('tpv_state').select('*').eq('id', 'global').single();
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

function onRealtimeUpdate(newTables) {
  const merged = mergeTablesWithDefs(newTables);

  // Check new/updated tables for status changes
  let needSound = false;
  merged.forEach(table => {
    const prevTable = state.tables.find(t => t.id === table.id);
    const wasEmpty = !prevTable || (prevTable.items || []).length === 0;
    const isOccupied = (table.items || []).length > 0;

    if (isOccupied) {
      const kds = getTableKds(table.id);
      // Brand new order
      if (wasEmpty && state.config.soundOnNew) needSound = true;
      // New items on a ready table
      const reverted = checkForNewItemsOnReadyTable(table.id, table.items || []);
      if (reverted) needSound = true;
      // Auto-reset if table cleared and config says so
    } else if (!isOccupied && state.config.autoResetReady) {
      delete state.tableKdsState[table.id];
      saveTableKdsState();
    }
  });

  if (needSound) playBeep();

  updateTableStartTimes(merged);
  state.tables = merged;

  if (!state.settingsOpen) {
    render();
  } else {
    refreshGrid();
  }
}

function subscribeRealtime() {
  if (channel) channel.unsubscribe();
  channel = supabase
    .channel('kds-realtime')
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'tpv_state', filter: 'id=eq.global'
    }, (payload) => {
      if (!payload.new) return;
      const { tables } = payload.new;
      if (Array.isArray(tables)) onRealtimeUpdate(tables);
    })
    .subscribe((status) => {
      const wasConnected = state.connected;
      state.connected = status === 'SUBSCRIBED';
      if (wasConnected !== state.connected) {
        const dot = document.getElementById('kds-status-dot');
        const label = dot?.nextElementSibling;
        if (dot) dot.className = `kds-status-dot ${state.connected ? '' : 'disconnected'}`;
        if (label) label.textContent = state.connected ? 'En línea' : 'Reconectando...';
      }
    });
}

// Refresh card colors every 15s (time class can change)
function startTimeRefresh() {
  setInterval(() => {
    if (!state.settingsOpen) {
      const grid = document.getElementById('kds-grid');
      if (grid) { grid.innerHTML = renderGrid(); bindCardEvents(); }
    }
  }, 15_000);
}

function startClock() {
  setInterval(() => {
    const el = document.getElementById('kds-clock');
    if (el) el.textContent = formatClock();
  }, 1000);
}

// ══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════════════════════════

async function init() {
  state.allTableDefs = buildAllTableDefs();
  await loadInitialState();
  render();
  subscribeRealtime();
  startClock();
  startTimeRefresh();
}

init();
