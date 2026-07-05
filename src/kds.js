/**
 * kds.js — Kitchen Display System v3
 *
 * Features:
 * - Realtime Supabase sync
 * - Color states: green (empty or ready) → yellow (new order) → red (exceeded threshold)
 * - LISTO button: saves delivered items; new items revert to yellow + strikethrough old ones
 * - Collapsed card height for empty/ready tables (configurable max items shown)
 * - Custom numeric keypad (no system keyboard) for all number inputs
 * - Full configurable settings panel
 */

import { createClient } from '@supabase/supabase-js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './' }).catch((error) => {
    console.warn('No se pudo registrar el service worker del KDS:', error);
  });
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase        = createClient(supabaseUrl, supabaseAnonKey);

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG_KEY = 'kds-config-v3';
const DEFAULT_CONFIG = {
  columns:             3,
  showOnlyOccupied:    false,      // false = show all tables (empty = green)
  showOnlyActive:      true,       // true = hide ready/empty cards, show only waiting/urgent
  visibleTableIds:     null,       // null = all
  yellowToRedMinutes:  10,
  collapsedItemCount:  4,          // max items shown when card is collapsed
  fontSize:            'md',
  showPrices:          false,
  soundOnNew:          false,
  autoResetReady:      false,
  theme:               'system',   // 'system' | 'light' | 'dark'
};

function applyTheme(themeOverride) {
  const theme = themeOverride || state.config.theme || 'system';
  let isLight = false;
  if (theme === 'light') {
    isLight = true;
  } else if (theme === 'system') {
    isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  if (isLight) {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
}

// Watch system theme preference changes
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (state.config.theme === 'system') {
    applyTheme();
  }
});

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}
function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Table KDS state ───────────────────────────────────────────────────────────
const TABLE_KDS_KEY = 'kds-table-state-v1';
function loadTableKdsState() {
  try { const r = localStorage.getItem(TABLE_KDS_KEY); if (r) return JSON.parse(r); } catch {}
  return {};
}
function saveTableKdsState() {
  localStorage.setItem(TABLE_KDS_KEY, JSON.stringify(state.tableKdsState));
}

// ── App State ─────────────────────────────────────────────────────────────────
let state = {
  tables:         [],
  connected:      false,
  config:         loadConfig(),
  settingsOpen:   false,
  tableStartTimes: {},
  tableKdsState:  loadTableKdsState(),
  allTableDefs:   [],
};

let channel = null;
const root = document.getElementById('kds-root');

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOM NUMPAD
// ══════════════════════════════════════════════════════════════════════════════

let numpad = {
  open: false,
  value: '',
  targetInput: null,
  label: '',
  min: 1,
  max: 99,
  onConfirm: null,
};

function openNumpad(inputEl, label, onConfirm) {
  numpad.open = true;
  numpad.targetInput = inputEl;
  numpad.value = String(parseInt(inputEl.value, 10) || '');
  numpad.label = label || '';
  numpad.min = parseInt(inputEl.min || '1', 10);
  numpad.max = parseInt(inputEl.max || '99', 10);
  numpad.onConfirm = onConfirm;
  renderNumpad();
}

function closeNumpad() {
  numpad.open = false;
  const el = document.getElementById('kds-numpad-overlay');
  if (el) { el.style.animation = 'numpadFadeOut 0.15s ease forwards'; setTimeout(() => el.remove(), 150); }
}

function renderNumpad() {
  const existing = document.getElementById('kds-numpad-overlay');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'kds-numpad-overlay';
  el.className = 'kds-numpad-overlay';
  el.innerHTML = `
    <div class="kds-numpad" id="kds-numpad-panel">
      <div class="kds-numpad-display">
        <span class="kds-numpad-label">${numpad.label}</span>
        <span class="kds-numpad-value" id="kds-numpad-disp">${numpad.value || '<span style="opacity:.3">—</span>'}</span>
      </div>
      <div class="kds-numpad-grid">
        ${[7,8,9,4,5,6,1,2,3].map(n =>
          `<button class="kds-numpad-btn" data-digit="${n}">${n}</button>`
        ).join('')}
        <button class="kds-numpad-btn kds-numpad-clear" data-action="clear">C</button>
        <button class="kds-numpad-btn" data-digit="0">0</button>
        <button class="kds-numpad-btn kds-numpad-del"  data-action="del">⌫</button>
      </div>
      <button class="kds-numpad-confirm" data-action="confirm">Confirmar</button>
    </div>
  `;
  document.body.appendChild(el);

  // Close on overlay click (outside panel)
  el.addEventListener('click', (e) => {
    if (!e.target.closest('#kds-numpad-panel')) closeNumpad();
  });

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-digit], [data-action]');
    if (!btn) return;

    const digit  = btn.dataset.digit;
    const action = btn.dataset.action;

    if (digit !== undefined) {
      if (numpad.value === '0') numpad.value = digit;
      else numpad.value = (numpad.value + digit).slice(0, 3); // max 3 digits
      // Clamp at max
      if (parseInt(numpad.value, 10) > numpad.max) numpad.value = String(numpad.max);
    } else if (action === 'del') {
      numpad.value = numpad.value.slice(0, -1);
    } else if (action === 'clear') {
      numpad.value = '';
    } else if (action === 'confirm') {
      let finalVal = parseInt(numpad.value, 10);
      if (isNaN(finalVal)) finalVal = numpad.min;
      finalVal = Math.max(numpad.min, Math.min(numpad.max, finalVal));
      if (numpad.targetInput) {
        numpad.targetInput.value = String(finalVal);
        numpad.targetInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (numpad.onConfirm) numpad.onConfirm(finalVal);
      closeNumpad();
      return;
    }

    // Update display
    const disp = document.getElementById('kds-numpad-disp');
    if (disp) disp.innerHTML = numpad.value || '<span style="opacity:.3">—</span>';
  });
}

// Attach numpad to any input[type=number] that is readonly
function attachNumpadListeners() {
  document.querySelectorAll('input[type="number"].kds-numpad-trigger').forEach(input => {
    input.addEventListener('click', (e) => {
      e.preventDefault();
      const label = input.dataset.label ||
        input.closest('.kds-threshold-row')?.querySelector('.kds-toggle-label')?.textContent ||
        'Valor';
      openNumpad(input, label);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIO
// ══════════════════════════════════════════════════════════════════════════════

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function getItemTotal(item) {
  const opts = (item.selectedOptions || []).reduce((s, o) => s + (o.price || 0) * (o.qty || 1), 0);
  return ((item.price || 0) + opts) * (item.qty || 1);
}
function getTableTotal(t) { return (t.items || []).reduce((s, i) => s + getItemTotal(i), 0); }
function getElapsedMinutes(tableId) {
  const s = state.tableStartTimes[tableId];
  return s ? Math.floor((Date.now() - s) / 60000) : 0;
}
function formatElapsed(minutes) {
  if (minutes < 1)  return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function formatClock() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatDate() {
  return new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Table start times ──────────────────────────────────────────────────────────
function updateTableStartTimes(tables) {
  tables.forEach(t => {
    const occupied = (t.items || []).length > 0;
    if (occupied && !state.tableStartTimes[t.id]) state.tableStartTimes[t.id] = Date.now();
    else if (!occupied) delete state.tableStartTimes[t.id];
  });
}

// ── KDS status ────────────────────────────────────────────────────────────────
function getTableKds(tableId) {
  return state.tableKdsState[tableId] || { status: 'waiting', readyAt: null, deliveredItems: [] };
}

function getDeliveredQty(item, deliveredItems = []) {
  const delivered = deliveredItems.find(d => d.ticketItemId === item.ticketItemId);
  return delivered?.qty || 0;
}

function getPendingItems(table, deliveredItems = []) {
  return (table?.items || []).filter(item => getDeliveredQty(item, deliveredItems) < item.qty);
}

function getReleasedDeferredItems(kds = {}) {
  return Array.isArray(kds.releasedDeferredItems) ? kds.releasedDeferredItems : [];
}

function isItemDeferredForKds(item, kds = {}) {
  return item.deferUntilLater === true && !getReleasedDeferredItems(kds).includes(item.ticketItemId);
}

function normalizeServiceText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getKdsItemServiceGroup(item = {}) {
  const text = normalizeServiceText(item.name || '');
  const drinkPattern = /\b(bebida|bebidas|cafe|cafes|te|tes|matcha|latte|leche|cappuccino|capuccino|espresso|americano|cortado|zumo|smoothie|batido|refresco|agua|cerveza|vino|infusion|chai|cola|fanta|sprite|tonica)\b/;
  const foodPattern = /\b(comida|comidas|alimento|alimentos|pancake|pancakes|minipancake|minipancakes|tostada|tostadas|bocadillo|sandwich|bagel|croissant|galleta|dulce|salado|ensalada|postre|tarta|brownie|arepa|pan|bolleria)\b/;

  if (drinkPattern.test(text)) return 0;
  if (foodPattern.test(text)) return 1;
  return 2;
}

function sortKdsItemsForService(items = []) {
  return [...items]
    .map((item, index) => ({ item, index, group: getKdsItemServiceGroup(item) }))
    .sort((a, b) => (a.group - b.group) || (a.index - b.index))
    .map(entry => entry.item);
}

/**
 * Card color class:
 *  'empty'   → green  (table has no items)
 *  'ready'   → green  (marked LISTO)
 *  'waiting' → yellow (has items, within threshold)
 *  'urgent'  → red    (has items, exceeded threshold)
 */
function getCardClass(tableId) {
  const table = state.tables.find(t => t.id === tableId);
  const hasItems = (table?.items || []).length > 0;
  if (!hasItems) return 'empty';
  const kds = getTableKds(tableId);
  if (kds.status === 'ready' && getPendingItems(table, kds.deliveredItems || []).length === 0) return 'ready';
  const elapsed = getElapsedMinutes(tableId);
  return elapsed >= state.config.yellowToRedMinutes ? 'urgent' : 'waiting';
}

/** Should this card be collapsed (max N items shown)? */
function isCollapsed(tableId) {
  const cls = getCardClass(tableId);
  return cls === 'empty' || cls === 'ready';
}

function markTableReady(tableId) {
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;
  const currentKds = getTableKds(tableId);
  const currentDelivered = currentKds.deliveredItems || [];
  const pendingItems = getPendingItems(table, currentDelivered);
  const activePendingItems = pendingItems.filter(item => !isItemDeferredForKds(item, currentKds));
  const deferredPendingItems = pendingItems.filter(item => isItemDeferredForKds(item, currentKds));

  if (activePendingItems.length === 0 && deferredPendingItems.length > 0) {
    state.tableKdsState[tableId] = {
      ...currentKds,
      status: 'waiting',
      readyAt: null,
      releasedDeferredItems: [
        ...new Set([
          ...getReleasedDeferredItems(currentKds),
          ...deferredPendingItems.map(item => item.ticketItemId)
        ])
      ]
    };
    saveTableKdsState();
    render();
    return;
  }

  const itemsToMark = activePendingItems;
  const markedItems = new Map(currentDelivered.map(item => [item.ticketItemId, item]));
  itemsToMark.forEach(item => {
    markedItems.set(item.ticketItemId, { ticketItemId: item.ticketItemId, id: item.id, qty: item.qty });
  });
  const deliveredItems = Array.from(markedItems.values());
  const remainingPending = getPendingItems(table, deliveredItems);

  state.tableKdsState[tableId] = {
    status: remainingPending.length > 0 ? 'waiting' : 'ready',
    readyAt: remainingPending.length > 0 ? null : Date.now(),
    deliveredItems,
    releasedDeferredItems: getReleasedDeferredItems(currentKds).filter(ticketItemId =>
      (table.items || []).some(item => item.ticketItemId === ticketItemId)
    )
  };
  saveTableKdsState();
  render();
}

function reopenTable(tableId) {
  const kds = getTableKds(tableId);
  state.tableKdsState[tableId] = { ...kds, status: 'waiting', readyAt: null };
  saveTableKdsState();
  render();
}

function checkForNewItemsOnReadyTable(tableId, newItems) {
  const kds = getTableKds(tableId);
  if (kds.status !== 'ready') return false;
  const delivered = kds.deliveredItems || [];
  for (const item of newItems) {
    const del = delivered.find(d => d.ticketItemId === item.ticketItemId);
    if (!del || item.qty > del.qty) {
      state.tableKdsState[tableId] = { ...kds, status: 'waiting', readyAt: null };
      saveTableKdsState();
      return true;
    }
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER — Items
// ══════════════════════════════════════════════════════════════════════════════

function renderItem(item, deliveredItems, kds = {}) {
  const del          = deliveredItems.find(d => d.ticketItemId === item.ticketItemId);
  const deliveredQty = del?.qty || 0;
  const currentQty   = item.qty;
  const showPrice    = state.config.showPrices;
  const isDeferred   = isItemDeferredForKds(item, kds);
  const deferredBadge = isDeferred ? '<span class="kds-later-badge">Después</span>' : '';

  const opts = (item.selectedOptions || []).length > 0
    ? `<div class="kds-item-opts">${item.selectedOptions.map(o => `<span class="kds-item-opt">+ ${o.name}${o.qty > 1 ? ` ×${o.qty}` : ''}</span>`).join('')}</div>`
    : '';


  const note = item.note ? `<div class="kds-item-note">Nota: ${escapeHtml(item.note)}</div>` : '';

  const priceSpan = (qty) => showPrice
    ? `<span class="kds-item-price">${getItemTotal({ ...item, qty }).toFixed(2)}€</span>`
    : '';

  // All delivered → strikethrough
  if (deliveredQty >= currentQty) {
    return `
      <div class="kds-item delivered ${isDeferred ? 'later' : ''}">
        <span class="kds-item-qty">${currentQty}×</span>
        <div class="kds-item-body"><div class="kds-item-name">${escapeHtml(item.name)}${deferredBadge}</div>${opts}${note}</div>
        ${priceSpan(currentQty)}
      </div>`;
  }

  // Partially delivered → show delivered strikethrough + pending normal
  if (deliveredQty > 0) {
    const pendingQty = currentQty - deliveredQty;
    return `
      <div class="kds-item delivered">
        <span class="kds-item-qty">${deliveredQty}×</span>
        <div class="kds-item-body"><div class="kds-item-name">${escapeHtml(item.name)}${deferredBadge}</div>${opts}${note}</div>
        ${priceSpan(deliveredQty)}
      </div>
      <div class="kds-item new-item ${isDeferred ? 'later' : ''}">
        <span class="kds-item-qty">${pendingQty}×</span>
        <div class="kds-item-body"><div class="kds-item-name">${escapeHtml(item.name)}${deferredBadge}</div>${opts}${note}</div>
        ${priceSpan(pendingQty)}
      </div>`;
  }

  // Normal
  return `
    <div class="kds-item ${isDeferred ? 'later' : ''}">
      <span class="kds-item-qty">${currentQty}×</span>
      <div class="kds-item-body"><div class="kds-item-name">${escapeHtml(item.name)}${deferredBadge}</div>${opts}${note}</div>
      ${priceSpan(currentQty)}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER — Card
// ══════════════════════════════════════════════════════════════════════════════

function renderCard(table, orderNum) {
  // orderNum: 1-based position in the sorted visible list (undefined = not shown)
  const kds          = getTableKds(table.id);
  const cardClass    = getCardClass(table.id);
  const elapsed      = getElapsedMinutes(table.id);
  const total        = getTableTotal(table);
  const deliveredItems = kds.deliveredItems || [];
  const hasItems     = (table.items || []).length > 0;
  const pendingItems = sortKdsItemsForService(getPendingItems(table, deliveredItems));
  const activePendingItems = pendingItems.filter(item => !isItemDeferredForKds(item, kds));
  const deferredPendingItems = pendingItems.filter(item => isItemDeferredForKds(item, kds));
  const collapsed    = isCollapsed(table.id);
  const maxItems     = collapsed ? state.config.collapsedItemCount : Infinity;
  const fontClass    = `font-${state.config.fontSize}`;
  const allItems     = table.items || [];
  const shownItems   = allItems.slice(0, maxItems);
  const hiddenCount  = allItems.length - shownItems.length;
  const totalQty     = allItems.reduce((s, i) => s + i.qty, 0);

  // Time badge
  let timeBadge;
  if (cardClass === 'ready')   timeBadge = `<span class="kds-card-time ready-badge">✓ Listo</span>`;
  else if (cardClass === 'empty') timeBadge = `<span class="kds-card-time empty-badge">Libre</span>`;
  else timeBadge = `<span class="kds-card-time ${cardClass}-badge">${formatElapsed(elapsed)}</span>`;

  // LISTO / REABRIR button (only when occupied)
  let actionBtn = '';
  if (hasItems) {
    actionBtn = kds.status === 'ready'
      ? `<button class="kds-ready-btn reopen" data-table-id="${table.id}">↩ Reabrir</button>`
      : `<button class="kds-ready-btn ${activePendingItems.length === 0 && deferredPendingItems.length > 0 ? 'release-later' : ''}" data-table-id="${table.id}">
          ${activePendingItems.length === 0 && deferredPendingItems.length > 0 ? 'Sacar después' : '✓ Listo'}
        </button>`;
  }

  // Items
  const itemsHtml = hasItems
    ? shownItems.map(item => renderItem(item, deliveredItems, kds)).join('')
    : `<div class="kds-card-empty-label">Sin pedidos</div>`;

  const hiddenHint = hiddenCount > 0
    ? `<div class="kds-card-collapsed-hint">+${hiddenCount} artículo${hiddenCount > 1 ? 's' : ''} más</div>`
    : '';

  return `
    <div class="kds-card ${cardClass} ${fontClass}" data-table-id="${table.id}">
      <div class="kds-card-header">
        ${orderNum != null ? `<span class="kds-card-order-num">#${orderNum}</span>` : ''}
        <span class="kds-card-name">${table.name}</span>
        ${timeBadge}
      </div>
      <div class="kds-card-items">
        ${itemsHtml}
        ${hiddenHint}
      </div>
      ${hasItems ? `
        <div class="kds-card-footer">
          <span class="kds-card-count">${totalQty} artículo${totalQty !== 1 ? 's' : ''}</span>
          <span class="kds-card-total">${total.toFixed(2)}€</span>
          ${actionBtn}
        </div>
      ` : ''}
    </div>
  `;
}

function renderGrid() {
  const visible = getVisibleTables();
  if (visible.length === 0) {
    // Determine why it's empty for a better message
    const hasAnyOccupied = state.tables.some(t => (t.items || []).length > 0);
    const allReady = hasAnyOccupied && state.tables
      .filter(t => (t.items || []).length > 0)
      .every(t => getTableKds(t.id).status === 'ready');

    if (allReady && state.config.showOnlyActive) {
      return `
        <div class="kds-empty kds-empty-clear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:64px;height:64px;color:#10b981;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p style="color:#10b981;font-size:1.3rem;font-weight:700;">¡Todo listo!</p>
          <p style="opacity:.6;font-size:.9rem;">No hay comandas pendientes de preparar</p>
        </div>`;
    }

    return `
      <div class="kds-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;">
          <path d="M4 10h16M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M7 10l-2 9M17 10l2 9M9 14h6"/>
        </svg>
        <p>Sin comandas activas</p>
      </div>`;
  }
  return visible.map((table, idx) => renderCard(table, idx + 1)).join('');
}


function getVisibleTables() {
  const { showOnlyOccupied, showOnlyActive, visibleTableIds } = state.config;
  let tables = state.tables;
  if (visibleTableIds !== null) tables = tables.filter(t => visibleTableIds.includes(t.id));
  if (showOnlyOccupied) tables = tables.filter(t => (t.items || []).length > 0);

  // "Solo comandas activas": show only tables with items AND not yet marked ready
  if (showOnlyActive) {
    tables = tables.filter(t => {
      const hasItems = (t.items || []).length > 0;
      if (!hasItems) return false;                          // hide empty
      const kds = getTableKds(t.id);
      return kds.status !== 'ready';                        // hide ready (fully served)
    });
  }

  // Sort by order start time: oldest first (most urgent at the top-left)
  tables = [...tables].sort((a, b) => {
    const ta = state.tableStartTimes[a.id] || Infinity;
    const tb = state.tableStartTimes[b.id] || Infinity;
    return ta - tb;
  });

  return tables;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER — Settings
// ══════════════════════════════════════════════════════════════════════════════

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
    </div>`;
}

function renderNumInput(id, label, value, min, max) {
  return `
    <div class="kds-numfield-row">
      <div class="kds-toggle-label">${label}</div>
      <div class="kds-numfield-wrap">
        <button class="kds-threshold-btn" data-target="${id}" data-delta="-1">−</button>
        <input class="kds-threshold-input kds-numpad-trigger"
               id="${id}" type="number"
               min="${min}" max="${max}" value="${value}"
               data-label="${label}" readonly>
        <button class="kds-threshold-btn" data-target="${id}" data-delta="1">+</button>
      </div>
    </div>`;
}

function renderSettingsPanel() {
  const { columns, showOnlyOccupied, showOnlyActive, visibleTableIds, yellowToRedMinutes,
          collapsedItemCount, fontSize, showPrices, soundOnNew, autoResetReady, theme } = state.config;

  const diningTables   = state.allTableDefs.filter(t => (t.type || 'table') === 'table');
  const takeawayTables = state.allTableDefs.filter(t => t.type === 'takeaway');
  const isVisible      = (id) => visibleTableIds === null || visibleTableIds.includes(id);

  const tableCheckboxes = (list) => list.map(t => {
    const occupied = (t.items || []).length > 0;
    return `
      <label class="kds-table-checkbox">
        <input type="checkbox" data-table-id="${t.id}" ${isVisible(t.id) ? 'checked' : ''}>
        <span class="kds-table-checkbox-label">${t.name}</span>
        <span class="kds-table-checkbox-status ${occupied ? 'occupied' : ''}">
          ${occupied ? '● Ocupada' : 'Libre'}
        </span>
      </label>`;
  }).join('');

  const colOptions = [2, 3, 4, 5].map(n => `
    <button class="kds-col-btn ${n === columns ? 'active' : ''}" data-cols="${n}">${n}</button>
  `).join('');

  const fontButtons = ['sm', 'md', 'lg'].map(s => `
    <button class="kds-font-btn ${fontSize === s ? 'active' : ''}" data-font="${s}">
      ${{ sm: 'Pequeño', md: 'Normal', lg: 'Grande' }[s]}
    </button>`).join('');

  const themeButtons = ['light', 'dark', 'system'].map(t => `
    <button class="kds-theme-btn ${theme === t ? 'active' : ''}" data-theme="${t}">
      ${{ light: 'Claro', dark: 'Oscuro', system: 'Sistema' }[t]}
    </button>`).join('');

  return `
    <div class="kds-settings-overlay" id="kds-settings-overlay">
      <div class="kds-settings-panel">
        <div class="kds-settings-header">
          <h2>⚙️ Configuración KDS</h2>
          <button class="kds-settings-close" id="kds-settings-close">✕</button>
        </div>
        <div class="kds-settings-body">

          <div class="kds-settings-section">
            <h3>Cuadrícula — columnas</h3>
            <div class="kds-cols-grid">${colOptions}</div>
          </div>

          <div class="kds-settings-section">
            <h3>Tamaño del texto</h3>
            <div class="kds-font-grid">${fontButtons}</div>
          </div>

          <div class="kds-settings-section">
            <h3>Tema visual</h3>
            <div class="kds-theme-grid">${themeButtons}</div>
          </div>

          <div class="kds-settings-section">
            <h3>Temporizadores</h3>
            ${renderNumInput('kds-threshold', 'Amarillo → Rojo (min)', yellowToRedMinutes, 1, 60)}
            ${renderNumInput('kds-collapsed-count', 'Artículos en tarjetas reducidas', collapsedItemCount, 1, 20)}
            <div class="kds-threshold-hint">
              Las tarjetas <strong>vacías</strong> y <strong>listas</strong> muestran un máximo
              de <strong>${collapsedItemCount} artículos</strong>. Las <strong>en preparación</strong>
              muestran todos.
            </div>
          </div>

          <div class="kds-settings-section">
            <h3>Visualización y comportamiento</h3>
            ${renderToggleRow('kds-toggle-active', 'Solo comandas activas', 'Oculta mesas vacías y ya marcadas como Listo — ideal para pantalla limpia', showOnlyActive)}
            ${renderToggleRow('kds-toggle-occupied', 'Solo mesas ocupadas', 'Oculta las mesas completamente vacías', showOnlyOccupied)}
            ${renderToggleRow('kds-toggle-prices', 'Mostrar precios por artículo', '', showPrices)}
            ${renderToggleRow('kds-toggle-sound', 'Sonido al recibir comanda', 'Pitido al llegar un pedido nuevo', soundOnNew)}
            ${renderToggleRow('kds-toggle-autoreset', 'Limpiar "Listo" al cerrar comanda', 'Cuando el TPV cierra la mesa', autoResetReady)}
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
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER — Header
// ══════════════════════════════════════════════════════════════════════════════

function renderHeader() {
  const occupiedCount = state.tables.filter(t => (t.items || []).length > 0).length;
  const readyCount    = Object.values(state.tableKdsState).filter(s => s.status === 'ready').length;
  const totalItems    = state.tables.reduce((s, t) => s + (t.items || []).reduce((ss, i) => ss + i.qty, 0), 0);

  return `
    <header class="kds-header">
      <div class="kds-logo">
        <svg class="kds-logo-icon" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M160 180H320C320 250 280 290 220 290H200C160 290 160 250 160 180Z" fill="url(#kG)"/>
          <path d="M320 200H345C365 200 365 240 345 240H320" stroke="url(#kG)" stroke-width="20" stroke-linecap="round"/>
          <path d="M195 140Q205 120 195 100M240 135Q250 115 240 95M285 140Q295 120 285 100"
                stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
          <defs>
            <linearGradient id="kG" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#2563eb"/>
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
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="kds-status-dot ${state.connected ? '' : 'disconnected'}" id="kds-status-dot"></div>
          <span class="kds-status-label">${state.connected ? 'En línea' : 'Reconectando...'}</span>
        </div>
        <button class="kds-settings-btn" id="kds-open-settings" title="Configuración">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33
                     1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33
                     l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1
                     0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65
                     1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0
                     0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51
                     1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </header>`;
}

// ── Base Layout Rendering (drawn once to prevent full-screen flickering) ──────
function renderBaseLayout() {
  root.innerHTML = `
    <div id="kds-header-container"></div>
    <main class="kds-main">
      <div class="kds-grid" id="kds-grid" style="--kds-cols:${state.config.columns}"></div>
    </main>
    <div id="kds-settings-container"></div>
  `;
}

// ── Full render (smart DOM diffing update) ────────────────────────────────────
function render() {
  if (!document.getElementById('kds-header-container')) {
    renderBaseLayout();
  }

  // Update grid columns CSS variable
  const grid = document.getElementById('kds-grid');
  if (grid) {
    grid.style.setProperty('--kds-cols', state.config.columns);
  }

  // Target header update if changed
  const headerContainer = document.getElementById('kds-header-container');
  if (headerContainer) {
    const newHeaderHTML = renderHeader();
    if (headerContainer.innerHTML !== newHeaderHTML) {
      headerContainer.innerHTML = newHeaderHTML;
    }
  }

  // Target grid update if changed
  if (grid) {
    const newGridHTML = renderGrid();
    if (grid.innerHTML !== newGridHTML) {
      grid.innerHTML = newGridHTML;
    }
  }

  // Target settings update
  const settingsContainer = document.getElementById('kds-settings-container');
  if (settingsContainer) {
    const newSettingsHTML = state.settingsOpen ? renderSettingsPanel() : '';
    if (settingsContainer.innerHTML !== newSettingsHTML) {
      settingsContainer.innerHTML = newSettingsHTML;
    }
  }
}

// ── Partial grid refresh (keeps settings panel open, updates only if changed) ──
function refreshGrid() {
  const grid = document.getElementById('kds-grid');
  if (grid) {
    const newGridHTML = renderGrid();
    if (grid.innerHTML !== newGridHTML) {
      grid.innerHTML = newGridHTML;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EVENTS
// ══════════════════════════════════════════════════════════════════════════════

function setupGlobalEventListeners() {
  document.body.addEventListener('click', (e) => {
    // 1. Open settings
    const openSettings = e.target.closest('#kds-open-settings');
    if (openSettings) {
      state.settingsOpen = true;
      render();
      return;
    }

    // 2. Close settings or overlay click
    const closeSettings = e.target.closest('#kds-settings-close');
    const overlay = document.getElementById('kds-settings-overlay');
    if (closeSettings || e.target === overlay) {
      state.settingsOpen = false;
      render();
      return;
    }

    // 3. Grid Columns buttons
    const colBtn = e.target.closest('.kds-col-btn');
    if (colBtn) {
      state.config.columns = parseInt(colBtn.dataset.cols, 10);
      saveConfig(state.config);
      render();
      return;
    }

    // 4. Font size buttons
    const fontBtn = e.target.closest('.kds-font-btn');
    if (fontBtn) {
      state.config.fontSize = fontBtn.dataset.font;
      saveConfig(state.config);
      render();
      return;
    }

    // 5. Theme buttons
    const themeBtn = e.target.closest('.kds-theme-btn');
    if (themeBtn) {
      state.config.theme = themeBtn.dataset.theme;
      saveConfig(state.config);
      applyTheme();
      render();
      return;
    }

    // 6. Stepper buttons
    const stepBtn = e.target.closest('.kds-threshold-btn[data-target]');
    if (stepBtn) {
      const targetId = stepBtn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        let val = parseInt(input.value, 10) + parseInt(stepBtn.dataset.delta, 10);
        val = Math.max(parseInt(input.min, 10), Math.min(parseInt(input.max, 10), val));
        input.value = String(val);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    // 7. Ready / Reopen card buttons
    const readyBtn = e.target.closest('.kds-ready-btn');
    if (readyBtn) {
      e.stopPropagation();
      const tableId = parseInt(readyBtn.dataset.tableId, 10);
      readyBtn.classList.contains('reopen') ? reopenTable(tableId) : markTableReady(tableId);
      return;
    }

    // 8. Dining/takeaway bulk links
    const selectLink = e.target.closest('[data-select]');
    if (selectLink) {
      const action = selectLink.dataset.select;
      const diningIds = state.allTableDefs.filter(t => (t.type || 'table') === 'table').map(t => t.id);
      const takIds = state.allTableDefs.filter(t => t.type === 'takeaway').map(t => t.id);
      let current = state.config.visibleTableIds === null
        ? state.allTableDefs.map(t => t.id) : [...state.config.visibleTableIds];

      if (action === 'all-dining') {
        diningIds.forEach(id => { if (!current.includes(id)) current.push(id); });
      } else if (action === 'none-dining') {
        current = current.filter(id => !diningIds.includes(id));
      } else if (action === 'all-takeaway') {
        takIds.forEach(id => { if (!current.includes(id)) current.push(id); });
      } else if (action === 'none-takeaway') {
        current = current.filter(id => !takIds.includes(id));
      }

      state.config.visibleTableIds = current.length === state.allTableDefs.length ? null : current;
      saveConfig(state.config);
      render();
      return;
    }

    // 9. Numpad trigger inputs click
    const numInput = e.target.closest('input[type="number"].kds-numpad-trigger');
    if (numInput) {
      e.preventDefault();
      const label = numInput.dataset.label ||
        numInput.closest('.kds-threshold-row')?.querySelector('.kds-toggle-label')?.textContent ||
        'Valor';
      openNumpad(numInput, label);
      return;
    }
  });

  // Change event listeners (e.g. for settings input and checkboxes)
  document.body.addEventListener('change', (e) => {
    // 1. Threshold input
    if (e.target.id === 'kds-threshold') {
      let val = parseInt(e.target.value, 10);
      val = Math.max(1, Math.min(60, val));
      state.config.yellowToRedMinutes = val;
      saveConfig(state.config);
      render();
      return;
    }

    // 2. Collapsed count input
    if (e.target.id === 'kds-collapsed-count') {
      let val = parseInt(e.target.value, 10);
      val = Math.max(1, Math.min(20, val));
      state.config.collapsedItemCount = val;
      saveConfig(state.config);
      render();
      return;
    }

    // 3. Toggles
    const toggleMap = {
      'kds-toggle-active':     'showOnlyActive',
      'kds-toggle-occupied':   'showOnlyOccupied',
      'kds-toggle-prices':     'showPrices',
      'kds-toggle-sound':      'soundOnNew',
      'kds-toggle-autoreset':  'autoResetReady',
    };
    if (toggleMap[e.target.id]) {
      const key = toggleMap[e.target.id];
      state.config[key] = e.target.checked;
      saveConfig(state.config);
      render();
      return;
    }

    // 4. Individual table checkboxes
    if (e.target.hasAttribute('data-table-id')) {
      const id = parseInt(e.target.dataset.tableId, 10);
      if (state.config.visibleTableIds === null) {
        state.config.visibleTableIds = state.allTableDefs.map(t => t.id);
      }
      if (e.target.checked) {
        if (!state.config.visibleTableIds.includes(id)) state.config.visibleTableIds.push(id);
      } else {
        state.config.visibleTableIds = state.config.visibleTableIds.filter(i => i !== id);
      }
      if (state.config.visibleTableIds.length === state.allTableDefs.length) {
        state.config.visibleTableIds = null;
      }
      saveConfig(state.config);
      render();
      return;
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// REALTIME & DATA
// ══════════════════════════════════════════════════════════════════════════════

function buildAllTableDefs() {
  const dining   = Array.from({ length: 12 }, (_, i) => ({ id: i+1,     name: `Mesa ${i+1}`,      type: 'table',    items: [] }));
  const takeaway = Array.from({ length: 8  }, (_, i) => ({ id: 101+i,   name: `Take Away ${i+1}`, type: 'takeaway', items: [] }));
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
  } catch (err) { console.warn('[KDS] Error cargando estado:', err); }
}

function onRealtimeUpdate(newTables) {
  const merged = mergeTablesWithDefs(newTables);
  let needSound = false;

  merged.forEach(table => {
    const prev     = state.tables.find(t => t.id === table.id);
    const wasEmpty = !prev || (prev.items || []).length === 0;
    const hasItems = (table.items || []).length > 0;

    if (hasItems) {
      if (wasEmpty && state.config.soundOnNew) needSound = true;
      const reverted = checkForNewItemsOnReadyTable(table.id, table.items);
      if (reverted && state.config.soundOnNew) needSound = true;
    } else if (!hasItems && state.config.autoResetReady) {
      delete state.tableKdsState[table.id];
      saveTableKdsState();
    }
  });

  if (needSound) playBeep();
  updateTableStartTimes(merged);
  state.tables = merged;

  if (!state.settingsOpen) render();
  else refreshGrid();
}

function subscribeRealtime() {
  if (channel) channel.unsubscribe();
  channel = supabase
    .channel('kds-realtime')
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'tpv_state', filter: 'id=eq.global'
    }, (payload) => {
      if (payload.new && Array.isArray(payload.new.tables)) onRealtimeUpdate(payload.new.tables);
    })
    .subscribe((status) => {
      const wasConnected = state.connected;
      state.connected = status === 'SUBSCRIBED';
      if (wasConnected !== state.connected) {
        const dot   = document.getElementById('kds-status-dot');
        const label = dot?.nextElementSibling;
        if (dot)   dot.className = `kds-status-dot ${state.connected ? '' : 'disconnected'}`;
        if (label) label.textContent = state.connected ? 'En línea' : 'Reconectando...';
      }
    });
}

function startClock() {
  setInterval(() => {
    const el = document.getElementById('kds-clock');
    if (el) el.textContent = formatClock();
  }, 1000);
}

function startTimeRefresh() {
  setInterval(() => {
    if (!state.settingsOpen) {
      refreshGrid();
    }
  }, 15_000);
}

// ══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════════════════════════

async function init() {
  state.allTableDefs = buildAllTableDefs();
  applyTheme();
  setupGlobalEventListeners();
  await loadInitialState();
  render();
  subscribeRealtime();
  startClock();
  startTimeRefresh();
}

init();
