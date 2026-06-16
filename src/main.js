import { store } from './store.js';

// SVG Icons
const ICONS = {
  mesas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 10h16" />
    <path d="M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3" />
    <path d="M7 10l-2 9" />
    <path d="M17 10l2 9" />
    <path d="M9 14h6" />
  </svg>`,
  inicio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5Z" />
    <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>`,
  transacciones: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 1v22M17 23l-4-4M17 23l4-4M7 23V1M7 1L3 5M7 1l4 5"/>
  </svg>`,
  ajustes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>`,
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>`,
  stack: `<svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="m12 12 8-4-8-4-8 4zm0 5 8-4-8-4-8 4zm0 5 8-4-8-4-8 4" />
  </svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px;">
    <path d="m15 18-6-6 6-6" />
  </svg>`,
  coffee: `<svg class="header-logo" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M160 180H320C320 250 280 290 220 290H200C160 290 160 250 160 180Z" fill="url(#cupGrad)" />
    <path d="M320 200H345C365 200 365 240 345 240H320" stroke="url(#cupGrad)" stroke-width="20" stroke-linecap="round"/>
    <rect x="170" y="300" width="100" height="12" rx="6" fill="#64748b"/>
    <path d="M195 140Q205 120 195 100" stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
    <path d="M240 135Q250 115 240 95" stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
    <path d="M285 140Q295 120 285 100" stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
    <defs>
      <linearGradient id="cupGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#10b981"/>
        <stop offset="100%" stop-color="#059669"/>
      </linearGradient>
    </defs>
  </svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; margin-right: 4px;">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>`
};

// UI Local states
let keypadAmount = '0'; // Accumulated cents as string
let productSearchText = '';
let isDrawerOpen = false;
let dbStatus = 'loading'; // 'loading' | 'connected' | 'fallback' | 'error'

// ─────────────────────────────────────────
// Toast notification system
// ─────────────────────────────────────────
function showToast(message, type = 'error') {
  const existing = document.getElementById('db-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'db-toast';
  toast.className = `db-toast db-toast--${type}`;
  toast.innerHTML = `
    <span class="db-toast-icon">${type === 'error' ? '⚠' : '✓'}</span>
    <span class="db-toast-text">${message}</span>
  `;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('db-toast--visible'));

  // Auto-dismiss after 4s
  setTimeout(() => {
    toast.classList.remove('db-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// 1. Header component renderer
function renderHeader(state) {
  const table = store.getSelectedTable();
  const title = state.activeTab === 'mesas' ? 'Mesas' : table ? table.name : 'Selecciona una mesa';

  const dbDot = dbStatus === 'connected'
    ? '<div class="status-dot" title="Supabase conectado"></div>'
    : dbStatus === 'fallback'
    ? '<div class="status-dot status-dot--warn" title="Modo sin conexión — datos locales"></div>'
    : dbStatus === 'error'
    ? '<div class="status-dot status-dot--error" title="Error de base de datos"></div>'
    : '<div class="status-dot status-dot--loading" title="Conectando..."></div>';

  return `
    <header class="app-header">
      <div class="header-brand">
        ${ICONS.coffee}
        <h1 class="header-title">${title}</h1>
      </div>
      <div class="header-meta">
        <div class="status-badge">
          ${dbDot}
          <span>${dbStatus === 'connected' ? 'Supabase' : dbStatus === 'fallback' ? 'Sin BD' : 'Comandero'}</span>
        </div>
      </div>
    </header>
  `;
}

// 2. Bottom Navbar renderer (MESAS, COMANDA, TRANSACCIONES, AJUSTES)
function renderNavbar(state) {
  const activeItems = store.getActiveItems();
  const ticketCount = activeItems.reduce((sum, item) => sum + item.qty, 0);

  return `
    <nav class="bottom-nav" aria-label="Navegacion principal">
      <div class="bottom-nav__content">
        <button class="bottom-nav__item ${state.activeTab === 'mesas' ? 'is-active' : ''}" data-tab="mesas">
          ${ICONS.mesas}
          <span class="bottom-nav__label">MESAS</span>
        </button>
        <button class="bottom-nav__item ${state.activeTab === 'inicio' ? 'is-active' : ''}" data-tab="inicio">
          ${ICONS.inicio}
          <span class="bottom-nav__label">COMANDA</span>
          ${ticketCount > 0 ? `<span class="badge-count">${ticketCount}</span>` : ''}
        </button>
        <button class="bottom-nav__item ${state.activeTab === 'transacciones' ? 'is-active' : ''}" data-tab="transacciones">
          ${ICONS.transacciones}
          <span class="bottom-nav__label">TRANSACCIONES</span>
        </button>
        <button class="bottom-nav__item ${state.activeTab === 'ajustes' ? 'is-active' : ''}" data-tab="ajustes">
          ${ICONS.ajustes}
          <span class="bottom-nav__label">AJUSTES</span>
        </button>
      </div>
    </nav>
  `;
}

// 3. TPV POS Screen tabs (Teclado, Atajos, Todos los prod)
function renderPosTabs(state) {
  return `
    <div class="pos-top-tabs">
      <div class="pos-tabs-list">
        <button class="pos-tab-link ${state.activePosTab === 'teclado' ? 'active' : ''}" data-pos-tab="teclado">Teclado</button>
        <button class="pos-tab-link ${state.activePosTab === 'atajos' ? 'active' : ''}" data-pos-tab="atajos">Atajos</button>
        <button class="pos-tab-link ${state.activePosTab === 'productos' ? 'active' : ''}" data-pos-tab="productos">Todos los prod</button>
      </div>
      <button class="pos-edit-btn ${state.isEditingGrid ? 'active' : ''}" title="Editar atajos">
        ${ICONS.pencil}
      </button>
    </div>
  `;
}

// 4. Teclado (Numeric Keypad) View
function renderKeypadView() {
  const cents = parseInt(keypadAmount, 10);
  const formattedAmount = (cents / 100).toFixed(2);
  
  return `
    <div class="keypad-container">
      <div class="keypad-display">${formattedAmount} €</div>
      <div class="keypad-grid">
        <button class="keypad-btn num-key" data-val="1">1</button>
        <button class="keypad-btn num-key" data-val="2">2</button>
        <button class="keypad-btn num-key" data-val="3">3</button>
        <button class="keypad-btn num-key" data-val="4">4</button>
        <button class="keypad-btn num-key" data-val="5">5</button>
        <button class="keypad-btn num-key" data-val="6">6</button>
        <button class="keypad-btn num-key" data-val="7">7</button>
        <button class="keypad-btn num-key" data-val="8">8</button>
        <button class="keypad-btn num-key" data-val="9">9</button>
        <button class="keypad-btn clear-key" style="color: var(--danger);">C</button>
        <button class="keypad-btn num-key" data-val="0">0</button>
        <button class="keypad-btn num-key" data-val="00">00</button>
        <button class="keypad-btn action btn-full" id="keypad-add-btn" style="grid-column: span 3; font-size:1.1rem; height: 52px; margin-top:8px;">
          Añadir venta rápida
        </button>
      </div>
    </div>
  `;
}

// 5. Atajos (3x3 Grid Navigation) View
function renderAtajosView(state) {
  const currentKey = state.gridPath[state.gridPath.length - 1];
  const items = state.gridItems[currentKey] || [];
  
  const isNested = state.gridPath.length > 1;
  const gridHTML = [];

  // If nested, slot 1 is ALWAYS the back button (Volver)
  if (isNested) {
    gridHTML.push(`
      <div class="grid-card action-card" id="grid-back-btn">
        ${ICONS.back}
        <span class="card-label">Volver</span>
      </div>
    `);
  }

  // Map elements to the grid
  for (let i = 0; i < 9; i++) {
    // Skip slot 1 for back button if nested
    if (isNested && i === 0) continue;

    const slotIndex = isNested ? i - 1 : i;
    const item = items[slotIndex];

    if (!item) {
      // Empty slot placeholder
      if (state.isEditingGrid) {
        gridHTML.push(`
          <div class="grid-card placeholder-card editable-placeholder" data-add-slot="${slotIndex}" data-grid-key="${currentKey}">
            <span style="font-size: 1.6rem; font-weight: bold; color: var(--text-muted);">+</span>
          </div>
        `);
      } else {
        gridHTML.push(`<div class="grid-card placeholder-card"></div>`);
      }
    } else {
      const deleteBadge = state.isEditingGrid ? `<span class="shortcut-delete-badge" data-delete-slot="${slotIndex}" data-grid-key="${currentKey}">&times;</span>` : '';
      const editClass = state.isEditingGrid ? 'is-editable' : '';

      if (item.type === 'category' || item.type === 'subcategory') {
        const cardClass = item.type === 'category' ? 'category-card' : 'subcategory-card';
        gridHTML.push(`
          <div class="grid-card ${cardClass} ${editClass}" data-target="${item.target}">
            ${deleteBadge}
            ${ICONS.stack}
            <span class="card-label">${item.name}</span>
          </div>
        `);
      } else if (item.type === 'article') {
        const cardStyle = item.image ? `style="background-image: url('${item.image}');"` : '';
        const imageClass = item.image ? 'has-image' : '';
        gridHTML.push(`
          <div class="grid-card article-card ${imageClass} ${editClass}" ${cardStyle} data-item-id="${item.itemId}">
            ${deleteBadge}
            <div class="article-card-overlay">
              <span class="article-card-name">${item.name}</span>
              <span class="article-card-price">${item.price.toFixed(2)}€</span>
            </div>
          </div>
        `);
      }
    }
  }

  const hasPayBar = store.getActiveItems().length > 0;
  return `
    <div class="grid-3x3 ${hasPayBar ? 'has-paybar' : ''}">
      ${gridHTML.join('')}
    </div>
  `;
}

// 6. Todos los prod (Products Search List) View
function renderProductsView(state) {
  const filtered = state.menuItems.filter(item => 
    item.name.toLowerCase().includes(productSearchText.toLowerCase())
  ).sort((a,b) => a.name.localeCompare(b.name));

  const rowsHTML = filtered.map(item => `
    <button class="product-row-btn" data-item-id="${item.id}">
      <span class="product-row-name">${item.name}</span>
      <span class="product-row-price">${item.price.toFixed(2)}€</span>
    </button>
  `).join('');

  return `
    <div class="products-list-container">
      <input type="text" class="search-input" id="prod-search-input" placeholder="Buscar producto..." value="${productSearchText}">
      <div class="products-scroll-area">
        ${rowsHTML.length > 0 ? rowsHTML : '<p style="text-align:center; padding: 20px; color: var(--text-muted);">No se encontraron productos</p>'}
      </div>
    </div>
  `;
}

function renderTablesView(state) {
  const diningTables = state.tables.filter(t => (t.type || 'table') === 'table');
  const takeawayTables = state.tables.filter(t => t.type === 'takeaway');
  const occupiedCount = state.tables.filter(t => t.items.length > 0).length;
  const pendingCount = state.tables.filter(t => t.status === 'pending-bill').length;
  const totalOpen = state.tables.reduce((sum, table) => sum + store.getTableTotal(table), 0);

  const renderTableCards = (tables) => tables.map(table => {
    const total = store.getTableTotal(table);
    const itemCount = table.items.reduce((sum, item) => sum + item.qty, 0);
    const isSelected = state.selectedTableId === table.id;
    const status = table.status === 'pending-bill'
      ? 'Cuenta pendiente'
      : itemCount > 0
        ? 'Ocupada'
        : 'Libre';
    const statusClass = table.status === 'pending-bill'
      ? 'pending'
      : itemCount > 0
        ? 'occupied'
        : 'available';
    const typeClass = table.type === 'takeaway' ? 'takeaway' : '';
    const isEmpty = itemCount === 0 && table.status !== 'pending-bill';

    if (isEmpty) {
      return `
        <button class="table-card ${statusClass} ${typeClass} ${isSelected ? 'selected' : ''} table-card--empty" data-table-id="${table.id}">
          <span class="table-card-name-large">${table.name}</span>
        </button>
      `;
    }

    return `
      <button class="table-card ${statusClass} ${typeClass} ${isSelected ? 'selected' : ''}" data-table-id="${table.id}">
        <div class="table-card-topline">
          <span class="table-card-name">${table.name}</span>
          <span class="table-card-status">${status}</span>
        </div>
        <div class="table-card-meta">
          <span>${itemCount === 1 ? '1 articulo' : `${itemCount} articulos`}</span>
          <strong>${total.toFixed(2)}€</strong>
        </div>
      </button>
    `;
  }).join('');

  return `
    <div class="tables-view">
      <div class="tables-summary">
        <div>
          <span class="tables-summary-label">Mesas ocupadas</span>
          <strong>${occupiedCount}/${state.tables.length}</strong>
        </div>
        <div>
          <span class="tables-summary-label">Cuentas pendientes</span>
          <strong>${pendingCount}</strong>
        </div>
        <div>
          <span class="tables-summary-label">Importe abierto</span>
          <strong>${totalOpen.toFixed(2)}€</strong>
        </div>
      </div>
      <section class="tables-section">
        <h2 class="tables-section-title">Sala</h2>
        <div class="tables-grid">
          ${renderTableCards(diningTables)}
        </div>
      </section>
      <section class="tables-section">
        <h2 class="tables-section-title">Take Away</h2>
        <div class="tables-grid takeaway-grid">
          ${renderTableCards(takeawayTables)}
        </div>
      </section>
    </div>
  `;
}

// 7. Transacciones View
function renderTransaccionesView(state) {
  const rows = state.transactions.map(tx => `
    <div class="tx-card">
      <div class="tx-meta">
        <span class="tx-table-name">${tx.table}</span>
        <span class="tx-date-method">${tx.date} • ${tx.paymentMethod}</span>
      </div>
      <div class="tx-financial">
        <span class="tx-amount">${tx.total.toFixed(2)}€</span>
        <div class="tx-qty">${tx.itemsCount} art.</div>
      </div>
    </div>
  `).join('');

  return `
    <div class="tx-list-container">
      <h2 class="tx-header">Historial de Ventas</h2>
      <div class="tx-history-list">
        ${rows.length > 0 ? rows : '<p style="text-align:center; padding: 40px; color: var(--text-muted);">Aún no hay transacciones cobradas hoy</p>'}
      </div>
    </div>
  `;
}

// 8. Ajustes View
function renderAjustesView(state) {
  const path = state.settingsPath;

  // Icons
  const chevron = `<svg class="settings-tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>`;
  const backArrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:18px; height:18px;"><path d="m15 18-6-6 6-6"/></svg>`;

  if (path.length === 0) {
    // 1. Root Settings Menu
    const tablesOptions = state.tables.map(t => {
      const isSelected = state.selectedTableId === t.id;
      return `<option value="${t.id}" ${isSelected ? 'selected' : ''}>${t.name} (${t.status === 'occupied' ? 'Ocupada' : t.status === 'pending-bill' ? 'Cuenta' : 'Libre'})</option>`;
    }).join('');

    const totalRevenue = state.transactions.reduce((sum, tx) => sum + tx.total, 0);

    return `
      <div class="view-container">
        <h2 class="settings-nav-title">Ajustes</h2>
        <div class="settings-tree-list">
          <button class="settings-tree-item" id="settings-to-articulos">
            <span>Artículos</span>
            ${chevron}
          </button>
          
          <div style="margin-top: 24px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <div style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">Configuración de Dispositivo</div>
            
            <div class="settings-row" style="padding: 12px 0; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="settings-row-title" style="font-weight:600;">Comandera en Servicio</div>
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Asignar ticket activo a una mesa</div>
              </div>
              <select id="settings-table-select" style="background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); font-weight:600; padding: 6px 12px; border-radius: var(--border-radius-sm); outline:none;">
                <option value="direct" ${state.selectedTableId === null ? 'selected' : ''}>Venta Directa (Bar)</option>
                ${tablesOptions}
              </select>
            </div>

            <div class="settings-row" style="padding: 12px 0; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="settings-row-title" style="font-weight:600;">Tema Visual</div>
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Alternar apariencia claro/oscuro</div>
              </div>
              <button class="theme-toggle" id="settings-theme-btn">
                ${state.theme === 'dark' ? ICONS.sun : ICONS.moon}
                <span>${state.theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}</span>
              </button>
            </div>

            <div class="settings-row" style="padding: 12px 0; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="settings-row-title" style="font-weight:600;">Resumen de Turno</div>
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Ventas totales acumuladas</div>
              </div>
              <span style="font-weight:700; font-size:1.1rem; color:var(--secondary);">${totalRevenue.toFixed(2)}€</span>
            </div>

            <div class="settings-row" style="padding: 12px 0; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; opacity:0.5;">
              <div>
                <div class="settings-row-title" style="font-weight:600;">Impresoras</div>
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Ninguna impresora vinculada</div>
              </div>
              ${chevron}
            </div>

            <div class="settings-row" style="padding: 16px 0; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="settings-row-title" style="color:var(--danger); font-weight:600;">Restablecer Terminal</div>
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Vaciar tickets y borrar transacciones</div>
              </div>
              <button class="btn btn-secondary" id="settings-reset-btn" style="height:36px; padding:0 12px; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger); font-size: 0.85rem;">
                Restablecer
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 2. Artículos Submenu (Matching mockup)
  if (path.length === 1 && path[0] === 'articulos') {
    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
        </div>
        <h2 class="settings-nav-title">Artículos</h2>
        <div class="settings-tree-list">
          <button class="settings-tree-item" id="settings-to-todos-articulos">
            <span>Todos los artículos</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" style="pointer-events: none; opacity: 0.5;">
            <span>Todos los servicios</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-categorias">
            <span>Categorías</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-modificadores">
            <span>Modificadores</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" style="pointer-events: none; opacity: 0.5;">
            <span>Descuentos</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" style="pointer-events: none; opacity: 0.5;">
            <span>Opciones</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" style="pointer-events: none; opacity: 0.5;">
            <span>Unidades</span>
            ${chevron}
          </button>
        </div>
      </div>
    `;
  }

  // 3. Todos los artículos Product Manager list
  if (path.length === 2 && path[0] === 'articulos' && path[1] === 'todos') {
    const rows = state.menuItems.map(item => {
      const categoryName = state.categories.find(c => c.id === item.category)?.name || item.category;
      return `
        <button class="product-manager-row" data-edit-item-id="${item.id}">
          <div>
            <div class="product-manager-name">${item.name}</div>
            <div class="product-manager-meta">${categoryName}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="product-manager-price">${item.price.toFixed(2)}€</span>
            ${chevron}
          </div>
        </button>
      `;
    }).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Artículos
          </button>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h2 class="settings-nav-title" style="margin-bottom:0;">Todos los artículos</h2>
          <button class="btn btn-primary" id="settings-create-article-btn" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary);">
            + Crear Artículo
          </button>
        </div>
        <div class="settings-tree-list" style="padding-bottom: 24px;">
          ${rows.length > 0 ? rows : '<p style="text-align:center; padding:20px; color:var(--text-muted);">No hay artículos creados.</p>'}
        </div>
      </div>
    `;
  }

  // 3b. Create Article Screen
  if (path.length === 3 && path[0] === 'articulos' && path[1] === 'todos' && path[2] === 'new') {
    const categoriesOptions = state.categories.map(parent => {
      if (parent.type === 'category') {
        const parentOption = `<option value="${parent.id}">${parent.name}</option>`;
        const childOptions = state.categories.filter(c => c.type === 'subcategory' && c.parentId === parent.id).map(child =>
          `<option value="${child.id}">&nbsp;&nbsp;&nbsp;&nbsp;${child.name}</option>`
        ).join('');
        return [parentOption, childOptions].filter(Boolean).join('\n');
      }
      return '';
    }).filter(Boolean).join('\n');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:8px;">Nuevo artículo</h2>
        <div class="settings-editor-container">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre del artículo</label>
            <input type="text" class="editor-form-input" id="create-article-name" placeholder="Ej. Americano, Tarta de Zanahoria..." value="">
          </div>

          <div class="editor-form-group">
            <label class="editor-form-label">Precio (€)</label>
            <input type="number" step="0.01" min="0" class="editor-form-input" id="create-article-price" placeholder="0.00" value="">
          </div>

          <div class="editor-form-group">
            <label class="editor-form-label">Categoría</label>
            <select class="editor-form-select" id="create-article-category">
              <option value="">-- Selecciona una categoría --</option>
              ${categoriesOptions}
            </select>
          </div>

          <div class="editor-form-group">
            <label class="editor-form-label">Modificadores aplicados</label>
            <div class="assigned-items-grid" id="create-article-modifiers-checklist">
              ${state.modifiers.map(mod => `
                <div class="assign-checkbox-card" data-create-modifier-id="${mod.id}">
                  <input type="checkbox" id="create-chk-mod-${mod.id}" style="pointer-events: none;">
                  <span>${mod.name}</span>
                </div>
              `).join('') || '<p style="font-size:0.85rem; color:var(--text-muted); padding:4px 0;">No hay modificadores definidos</p>'}
            </div>
          </div>

          <div class="editor-form-actions">
            <button class="btn btn-secondary" id="create-article-cancel-btn">Cancelar</button>
            <button class="btn btn-primary" id="create-article-save-btn" style="background-color: var(--secondary);">Guardar</button>
          </div>
        </div>
      </div>
    `;
  }

  // 4. Edit Article Screen
  if (path.length === 3 && path[0] === 'articulos' && path[1] === 'todos') {
    const itemId = path[2];
    const item = state.menuItems.find(i => i.id === itemId);
    if (!item) {
      return `<div class="view-container"><p style="padding:20px; text-align:center;">Artículo no encontrado.</p></div>`;
    }

    const categoriesOptions = state.categories.filter(c => c.type === 'category').map(parent => {
      const parentOption = `<option value="${parent.id}" ${parent.id === item.category ? 'selected' : ''}>${parent.name}</option>`;
      const childOptions = state.categories.filter(c => c.type === 'subcategory' && c.parentId === parent.id).map(child => 
        `<option value="${child.id}" ${child.id === item.category ? 'selected' : ''}>&nbsp;&nbsp;&nbsp;&nbsp;${child.name}</option>`
      ).join('');
      return [parentOption, childOptions].filter(Boolean).join('\n');
    }).join('\n');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:8px;">Editar artículo</h2>
        <div class="settings-editor-container">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre del artículo</label>
            <input type="text" class="editor-form-input" id="edit-item-name" value="${item.name}">
          </div>

          <div class="editor-form-group">
            <label class="editor-form-label">Precio (€)</label>
            <input type="number" step="0.01" class="editor-form-input" id="edit-item-price" value="${item.price.toFixed(2)}">
          </div>

          <div class="editor-form-group">
            <label class="editor-form-label">Categoría</label>
            <select class="editor-form-select" id="edit-item-category">
              ${categoriesOptions}
            </select>
          </div>

          <div class="editor-form-group">
            <label class="editor-form-label">Modificadores aplicados</label>
            <div class="assigned-items-grid" id="article-modifiers-checklist">
              ${state.modifiers.map(mod => {
                const isAssigned = (item.modifiers || []).includes(mod.id);
                return `
                  <div class="assign-checkbox-card ${isAssigned ? 'assigned' : ''}" data-article-modifier-id="${mod.id}">
                    <input type="checkbox" id="chk-mod-${mod.id}" style="pointer-events: none;" ${isAssigned ? 'checked' : ''}>
                    <span>${mod.name}</span>
                  </div>
                `;
              }).join('') || '<p style="font-size:0.85rem; color:var(--text-muted); padding:4px 0;">No hay modificadores definidos</p>'}
            </div>
          </div>

          <div class="editor-form-actions">
            <button class="btn btn-secondary" id="edit-item-cancel-btn">Cancelar</button>
            <button class="btn btn-primary" id="edit-item-save-btn" data-save-item-id="${item.id}" style="background-color: var(--secondary);">Guardar</button>
          </div>
        </div>
      </div>
    `;
  }

  // 5. Root Categorías List (Main Categories Only)
  if (path.length === 2 && path[0] === 'articulos' && path[1] === 'categorias') {
    const rows = state.categories.filter(cat => cat.type === 'category').map(cat => {
      const subCount = state.categories.filter(c => c.parentId === cat.id).length;
      const subLabel = subCount === 1 ? '1 subcategoría' : `${subCount} subcategorías`;
      return `
        <button class="product-manager-row" data-category-id="${cat.id}">
          <div>
            <div class="product-manager-name">${cat.name}</div>
            <div class="product-manager-meta" style="display:flex; align-items:center; gap:6px; margin-top:2px;">
              <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:var(--primary);"></span>
              <span>Categoría • ${subLabel}</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${chevron}
          </div>
        </button>
      `;
    }).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Artículos
          </button>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h2 class="settings-nav-title" style="margin-bottom:0;">Categorías</h2>
          <button class="btn btn-primary" id="settings-create-category-btn" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary);">
            + Crear Categoría
          </button>
        </div>
        <div class="settings-tree-list" style="padding-bottom: 24px;">
          ${rows.length > 0 ? rows : '<p style="text-align:center; padding:20px; color:var(--text-muted);">No hay categorías principales creadas.</p>'}
        </div>
      </div>
    `;
  }

  // 6. Create Main Category Screen
  if (path.length === 3 && path[0] === 'articulos' && path[1] === 'categorias' && path[2] === 'new') {
    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:8px;">Crear categoría</h2>
        <div class="settings-editor-container">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre de la categoría principal</label>
            <input type="text" class="editor-form-input" id="create-cat-name" placeholder="Ej. Bebidas, Alimentos, Café..." value="">
          </div>

          <div class="editor-form-actions">
            <button class="btn btn-secondary" id="create-cat-cancel-btn">Cancelar</button>
            <button class="btn btn-primary" id="create-cat-save-btn" style="background-color: var(--secondary);">Guardar</button>
          </div>
        </div>
      </div>
    `;
  }

  // 7. Category Detail: Subcategories List
  if (path.length === 3 && path[0] === 'articulos' && path[1] === 'categorias') {
    const categoryId = path[2];
    const cat = state.categories.find(c => c.id === categoryId);
    if (!cat) {
      return `<div class="view-container"><p style="padding:20px; text-align:center;">Categoría no encontrada.</p></div>`;
    }

    const subcategories = state.categories.filter(c => c.type === 'subcategory' && c.parentId === categoryId);
    const rows = subcategories.map(sub => `
      <button class="product-manager-row" data-subcategory-id="${sub.id}">
        <div>
          <div class="product-manager-name">${sub.name}</div>
          <div class="product-manager-meta" style="display:flex; align-items:center; gap:6px; margin-top:2px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:var(--success);"></span>
            <span>Subcategoría</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${chevron}
        </div>
      </button>
    `).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Categorías
          </button>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
          <div>
            <h2 class="settings-nav-title" style="margin-bottom:2px;">${cat.name}</h2>
            <button class="btn" id="settings-edit-parent-category-btn" data-parent-cat-id="${cat.id}" style="padding:0; background:none; border:none; color:var(--secondary); font-size:0.85rem; font-weight:600; text-decoration:underline; cursor:pointer;">
              Editar esta categoría
            </button>
          </div>
          <button class="btn btn-primary" id="settings-create-subcategory-btn" data-parent-cat-id="${cat.id}" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary);">
            + Crear Subcategoría
          </button>
        </div>
        <div style="font-size:0.8rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; border-bottom:1px solid var(--border-color); padding-bottom:4px;">Subcategorías</div>
        <div class="settings-tree-list" style="padding-bottom: 24px;">
          ${rows.length > 0 ? rows : '<p style="text-align:center; padding:20px; color:var(--text-muted);">No hay subcategorías en esta categoría.</p>'}
        </div>
      </div>
    `;
  }

  // 8. Create Subcategory Screen
  if (path.length === 4 && path[0] === 'articulos' && path[1] === 'categorias' && path[3] === 'new') {
    const parentId = path[2];
    const parentCat = state.categories.find(c => c.id === parentId);
    const parentName = parentCat ? parentCat.name : '';

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:4px;">Crear subcategoría</h2>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 20px;">
          Dentro de la categoría: <strong style="color: var(--text-main);">${parentName}</strong>
        </div>
        <div class="settings-editor-container">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre de la subcategoría</label>
            <input type="text" class="editor-form-input" id="create-subcat-name" placeholder="Ej. Filtro, Espresso, Tartas..." value="">
          </div>

          <div class="editor-form-actions">
            <button class="btn btn-secondary" id="create-subcat-cancel-btn">Cancelar</button>
            <button class="btn btn-primary" id="create-subcat-save-btn" data-parent-id="${parentId}" style="background-color: var(--secondary);">Guardar</button>
          </div>
        </div>
      </div>
    `;
  }

  // 9. Edit Parent Category Screen
  if (path.length === 4 && path[0] === 'articulos' && path[1] === 'categorias' && path[3] === 'edit') {
    const catId = path[2];
    const cat = state.categories.find(c => c.id === catId);
    if (!cat) {
      return `<div class="view-container"><p style="padding:20px; text-align:center;">Categoría no encontrada.</p></div>`;
    }

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:8px;">Editar categoría</h2>
        <div class="settings-editor-container">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre de la categoría principal</label>
            <input type="text" class="editor-form-input" id="edit-parent-cat-name" value="${cat.name}">
          </div>

          <div style="display:flex; justify-content:space-between; margin-top:24px;">
            <button class="btn btn-secondary" id="edit-parent-cat-delete-btn" data-delete-cat-id="${cat.id}" style="background-color: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger); display:flex; align-items:center; justify-content:center;">
              ${ICONS.trash} Eliminar
            </button>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-secondary" id="edit-parent-cat-cancel-btn">Cancelar</button>
              <button class="btn btn-primary" id="edit-parent-cat-save-btn" data-save-cat-id="${cat.id}" style="background-color: var(--secondary);">Guardar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 10. Edit Subcategory Screen
  if (path.length === 4 && path[0] === 'articulos' && path[1] === 'categorias' && path[3] !== 'new' && path[3] !== 'edit') {
    const subcatId = path[3];
    const parentId = path[2];
    const cat = state.categories.find(c => c.id === subcatId);
    if (!cat) {
      return `<div class="view-container"><p style="padding:20px; text-align:center;">Subcategoría no encontrada.</p></div>`;
    }

    const parentCat = state.categories.find(c => c.id === parentId);
    const parentName = parentCat ? parentCat.name : '';

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:4px;">Editar subcategoría</h2>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 20px;">
          Dentro de la categoría: <strong style="color: var(--text-main);">${parentName}</strong>
        </div>
        <div class="settings-editor-container">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre de la subcategoría</label>
            <input type="text" class="editor-form-input" id="edit-subcat-name" value="${cat.name}">
          </div>

          <div style="display:flex; justify-content:space-between; margin-top:24px;">
            <button class="btn btn-secondary" id="edit-subcat-delete-btn" data-delete-subcat-id="${cat.id}" style="background-color: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger); display:flex; align-items:center; justify-content:center;">
              ${ICONS.trash} Eliminar
            </button>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-secondary" id="edit-subcat-cancel-btn">Cancelar</button>
              <button class="btn btn-primary" id="edit-subcat-save-btn" data-save-subcat-id="${cat.id}" style="background-color: var(--secondary);">Guardar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 11. Modificadores Manager List
  if (path.length === 2 && path[0] === 'articulos' && path[1] === 'modificadores') {
    const rows = state.modifiers.map(mod => {
      const optionsCount = mod.options ? mod.options.length : 0;
      const assignedCount = mod.assignedItems ? mod.assignedItems.length : 0;
      const optionsLabel = optionsCount === 1 ? '1 opción' : `${optionsCount} opciones`;
      const assignedLabel = assignedCount === 1 ? '1 artículo' : `${assignedCount} artículos`;
      return `
        <button class="product-manager-row" data-modifier-id="${mod.id}">
          <div>
            <div class="product-manager-name">${mod.name}</div>
            <div class="product-manager-meta">${optionsLabel} • Aplicado a ${assignedLabel}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${chevron}
          </div>
        </button>
      `;
    }).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Artículos
          </button>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h2 class="settings-nav-title" style="margin-bottom:0;">Modificadores</h2>
          <button class="btn btn-primary" id="settings-create-modifier-btn" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary);">
            + Crear
          </button>
        </div>
        <div class="settings-tree-list" style="padding-bottom: 24px;">
          ${rows.length > 0 ? rows : '<p style="text-align:center; padding:20px; color:var(--text-muted);">No hay modificadores creados.</p>'}
        </div>
      </div>
    `;
  }

  // 12. Create Modifier Screen
  if (path.length === 3 && path[0] === 'articulos' && path[1] === 'modificadores' && path[2] === 'new') {
    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:8px;">Crear modificador</h2>
        <div class="settings-editor-container">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre del grupo de modificadores</label>
            <input type="text" class="editor-form-input" id="create-mod-name" placeholder="Ej. Tamaño, Salsa, Extras..." value="">
          </div>

          <div class="editor-form-actions">
            <button class="btn btn-secondary" id="create-mod-cancel-btn">Cancelar</button>
            <button class="btn btn-primary" id="create-mod-save-btn" style="background-color: var(--secondary);">Guardar</button>
          </div>
        </div>
      </div>
    `;
  }

  // 13. Edit Modifier Screen (options editor & assignment checklist)
  if (path.length === 3 && path[0] === 'articulos' && path[1] === 'modificadores') {
    const modId = path[2];
    const mod = state.modifiers.find(m => m.id === modId);
    if (!mod) {
      return `<div class="view-container"><p style="padding:20px; text-align:center;">Modificador no encontrado.</p></div>`;
    }

    const optionsList = (mod.options || []).map((opt, idx) => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-panel); border:1px solid var(--border-color); padding:10px 14px; border-radius:var(--border-radius-sm); margin-bottom:8px;">
        <div>
          <strong style="color:var(--text-main);">${opt.name}</strong>
          <span style="color:var(--text-muted); font-size:0.85rem; margin-left:8px;">(+${opt.price.toFixed(2)}€)</span>
        </div>
        <button class="btn-delete-option" data-option-index="${idx}" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:1.2rem; font-weight:bold; width:24px; height:24px; display:flex; align-items:center; justify-content:center;">
          &times;
        </button>
      </div>
    `).join('');

    const assignedChecklist = state.menuItems.map(item => {
      const isAssigned = (mod.assignedItems || []).includes(item.id);
      return `
        <div class="assign-checkbox-card ${isAssigned ? 'assigned' : ''}" data-assign-item-id="${item.id}">
          <input type="checkbox" id="chk-assign-item-${item.id}" style="pointer-events: none;" ${isAssigned ? 'checked' : ''}>
          <span>${item.name}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Cancelar
          </button>
        </div>
        <h2 class="settings-nav-title" style="font-size:1.4rem; padding-bottom:8px;">Editar modificador</h2>
        <div class="settings-editor-container" style="padding-bottom:40px;">
          <div class="editor-form-group">
            <label class="editor-form-label">Nombre del grupo</label>
            <input type="text" class="editor-form-input" id="edit-mod-name" value="${mod.name}">
          </div>

          <!-- Options Section -->
          <div class="editor-form-group" style="margin-top:16px;">
            <label class="editor-form-label">Opciones y Precios</label>
            <div id="edit-mod-options-container" style="max-height:220px; overflow-y:auto; margin-bottom:8px;">
              ${optionsList.length > 0 ? optionsList : '<p style="font-size:0.85rem; color:var(--text-muted); padding:4px 0;">No hay opciones creadas.</p>'}
            </div>
            
            <!-- Quick Add Option Form -->
            <div style="display:grid; grid-template-columns: 2fr 1fr auto; gap:8px; margin-top:8px;">
              <input type="text" class="editor-form-input" id="new-opt-name" placeholder="Nombre opción" style="height:38px; padding:8px; font-size:0.9rem;">
              <input type="number" step="0.01" class="editor-form-input" id="new-opt-price" placeholder="0.00" style="height:38px; padding:8px; font-size:0.9rem;">
              <button class="btn btn-primary" id="btn-add-mod-option" style="height:38px; background-color:var(--secondary); border-color:var(--secondary); font-size:0.85rem; padding:0 12px;">
                Añadir
              </button>
            </div>
          </div>

          <!-- Assignment Section -->
          <div class="editor-form-group" style="margin-top:24px;">
            <label class="editor-form-label">Artículos Asignados</label>
            <div class="assigned-items-grid" id="edit-mod-assignment-grid">
              ${assignedChecklist}
            </div>
          </div>

          <!-- Action buttons -->
          <div style="display:flex; justify-content:space-between; margin-top:32px;">
            <button class="btn btn-secondary" id="edit-mod-delete-btn" data-delete-mod-id="${mod.id}" style="background-color: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger); display:flex; align-items:center; justify-content:center;">
              ${ICONS.trash} Eliminar
            </button>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-secondary" id="edit-mod-cancel-btn">Cancelar</button>
              <button class="btn btn-primary" id="edit-mod-save-btn" data-save-mod-id="${mod.id}" style="background-color: var(--secondary);">Guardar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return `<div class="view-container"><p style="padding:20px; text-align:center;">Ruta no encontrada.</p></div>`;
}

// 9. Quick Pay Bar at the bottom of the grid
function renderQuickPayBar() {
  const activeItems = store.getActiveItems();
  if (activeItems.length === 0) return '';
  
  const count = activeItems.reduce((s, i) => s + i.qty, 0);
  const total = store.getActiveTicketTotal();
  const label = count === 1 ? '1 artículo' : `${count} artículos`;

  return `
    <div class="quick-pay-bar-container">
      <button class="btn-quick-pay" id="quick-pay-trigger">
        Pagar ${label} • ${total.toFixed(2)}€
      </button>
    </div>
  `;
}

// 10. Active Ticket Panel (used in Tablet Split View)
function renderInlineTicketPanel() {
  const table = store.getSelectedTable();
  const tableName = table ? table.name : 'Nueva Comanda';
  const items = store.getActiveItems();

  const itemsList = items.map(item => `
    <div class="ticket-item" style="margin-bottom: 8px;" data-item-id="${item.id}" data-ticket-item-id="${item.ticketItemId}">
      <div class="ticket-item-details">
        <span class="ticket-item-name">${item.name}</span>
        <span class="ticket-item-modifiers">${item.price.toFixed(2)}€ x ud.</span>
        ${item.selectedOptions && item.selectedOptions.length > 0 ? `
          <div class="ticket-item-options">
            ${item.selectedOptions.map(opt => `
              <div class="ticket-item-option-row">
                <span>+ ${opt.name} (x${opt.qty})</span>
                <span>+${(opt.price * opt.qty).toFixed(2)}€</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="ticket-item-qty-actions">
        <button class="qty-btn qty-minus-btn" data-ticket-item-id="${item.ticketItemId}">-</button>
        <span class="ticket-item-qty">${item.qty}</span>
        <button class="qty-btn qty-plus-btn" data-ticket-item-id="${item.ticketItemId}">+</button>
      </div>
      <span class="ticket-item-total">${store.getItemTotal(item).toFixed(2)}€</span>
    </div>
  `).join('');

  const total = store.getActiveTicketTotal();
  const tax = total * 0.10;
  const subtotal = total - tax;

  const content = items.length > 0 ? `
    <div class="ticket-list">
      ${itemsList}
    </div>
    <div class="ticket-summary" style="margin-top:auto;">
      <div class="summary-row">
        <span></span>
        <span>${subtotal.toFixed(2)}€</span>
      </div>
      <div class="summary-row">
        <span></span>
        <span>${tax.toFixed(2)}€</span>
      </div>
      <div class="summary-row total">
        <span>Total</span>
        <span class="total-val">${total.toFixed(2)}€</span>
      </div>
    </div>
    <div class="ticket-actions-grid">
      <button class="pay-btn-opt primary" id="split-pay-btn">Cobrar</button>
      <button class="pay-btn-opt" id="split-save-order-btn">Guardar Comanda</button>
    </div>
  ` : `
    <div class="empty-ticket-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:40px; height:40px;">
        <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      </svg>
      <p style="margin-top: 8px;">Ticket vacío</p>
    </div>
  `;

  return `
    <div class="ticket-header">
      <span class="ticket-header-title">Ticket de Servicio</span>
      <span class="ticket-header-table" style="color:var(--primary); font-weight:700;">${tableName}</span>
    </div>
    ${content}
  `;
}

// 11. Modal Drawer overlay (Mobile only)
function renderDrawerOverlay() {
  if (!isDrawerOpen) return '';

  const table = store.getSelectedTable();
  const tableName = table ? table.name : 'Nueva Comanda';
  const items = store.getActiveItems();

  const itemsList = items.map(item => `
    <div class="ticket-item" style="margin-bottom: 8px;" data-item-id="${item.id}" data-ticket-item-id="${item.ticketItemId}">
      <div class="ticket-item-details">
        <span class="ticket-item-name">${item.name}</span>
        <span class="ticket-item-modifiers">${item.price.toFixed(2)}€ x ud.</span>
        ${item.selectedOptions && item.selectedOptions.length > 0 ? `
          <div class="ticket-item-options">
            ${item.selectedOptions.map(opt => `
              <div class="ticket-item-option-row">
                <span>+ ${opt.name} (x${opt.qty})</span>
                <span>+${(opt.price * opt.qty).toFixed(2)}€</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="ticket-item-qty-actions">
        <button class="qty-btn qty-minus-btn" data-ticket-item-id="${item.ticketItemId}">-</button>
        <span class="ticket-item-qty">${item.qty}</span>
        <button class="qty-btn qty-plus-btn" data-ticket-item-id="${item.ticketItemId}">+</button>
      </div>
      <span class="ticket-item-total">${store.getItemTotal(item).toFixed(2)}€</span>
    </div>
  `).join('');

  const total = store.getActiveTicketTotal();
  const tax = total * 0.10;
  const subtotal = total - tax;

  return `
    <div class="drawer-overlay" id="drawer-backdrop">
      <div class="drawer-content">
        <div class="drawer-close-indicator" id="drawer-pull-bar"></div>
        <div class="drawer-header">
          <span class="drawer-title">Pedido Actual</span>
          <span class="drawer-table-sel">${tableName}</span>
        </div>
        
        <div class="ticket-list">
          ${itemsList}
        </div>

        <div class="ticket-summary">
          <div class="summary-row">
            <span></span>
            <span>${subtotal.toFixed(2)}€</span>
          </div>
          <div class="summary-row">
            <span></span>
            <span>${tax.toFixed(2)}€</span>
          </div>
          <div class="summary-row total">
            <span>Total</span>
            <span class="total-val">${total.toFixed(2)}€</span>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px; margin-top: 10px;">
          <div class="ticket-actions-grid">
            <button class="pay-btn-opt primary" id="drawer-pay-btn">Cobrar</button>
            <button class="pay-btn-opt" id="drawer-save-order-btn">Guardar Comanda</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Master Shell Render Engine
function render(state) {
  const appRoot = document.getElementById('app-root');
  if (!appRoot) return;

  const isDesktop = window.innerWidth >= 768;

  // Sync Theme CSS
  if (state.theme === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }

  // Workspace Area
  let workspaceHTML = '';
  if (state.activeTab === 'mesas') {
    workspaceHTML = renderTablesView(state);
  } else if (state.activeTab === 'inicio') {
    // POS View
    let posWorkspace = '';
    if (state.activePosTab === 'teclado') {
      posWorkspace = renderKeypadView();
    } else if (state.activePosTab === 'atajos') {
      posWorkspace = renderAtajosView(state);
    } else if (state.activePosTab === 'productos') {
      posWorkspace = renderProductsView(state);
    }

    if (isDesktop) {
      // Tablet side-by-side Split layout
      workspaceHTML = `
        <div class="pos-tablet-split">
          <div class="pos-split-grid">
            ${renderPosTabs(state)}
            <div style="flex-grow:1; overflow-y:auto; position:relative;">
              ${posWorkspace}
            </div>
          </div>
          <div class="pos-split-ticket">
            ${renderInlineTicketPanel()}
          </div>
        </div>
      `;
    } else {
      // Mobile layout
      workspaceHTML = `
        <div class="pos-grid-container" style="display:flex; flex-direction:column; height:100%; position:relative;">
          ${renderPosTabs(state)}
          <div style="flex-grow:1; overflow-y:auto; position:relative;">
            ${posWorkspace}
          </div>
          ${state.activePosTab === 'atajos' ? renderQuickPayBar() : ''}
        </div>
      `;
    }
  } else if (state.activeTab === 'transacciones') {
    workspaceHTML = renderTransaccionesView(state);
  } else if (state.activeTab === 'ajustes') {
    workspaceHTML = renderAjustesView(state);
  }

  // Draw full app structure
  appRoot.innerHTML = `
    <div class="app-shell">
      <div class="main-layout-container">
        ${renderHeader(state)}
        <main class="app-workspace">
          ${workspaceHTML}
        </main>
      </div>
      ${renderNavbar(state)}
      ${renderDrawerOverlay()}
    </div>
  `;

  setupEventListeners(appRoot);
}

// Add Shortcut Dialog Modal
function showAddShortcutModal(gridKey, slotIndex) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'add-shortcut-modal';
  
  // Get options
  const itemsOptions = store.state.menuItems.map(item => 
    `<option value="${item.id}">${item.name} (${item.price.toFixed(2)}€)</option>`
  ).join('');

  // Categories
  const categoriesOptions = store.state.categories.filter(c => c.type === 'category').map(c => 
    `<option value="${c.id}">${c.name}</option>`
  ).join('');

  // Subcategories
  const subcategoriesOptions = store.state.categories.filter(c => c.type === 'subcategory').map(c => {
    const parentName = store.state.categories.find(p => p.id === c.parentId)?.name || '';
    return `<option value="${c.id}">${parentName ? parentName + ' > ' : ''}${c.name}</option>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Añadir atajo a la cuadrícula</h3>
      </div>
      <div class="modal-body">
        <div class="editor-form-group" style="margin-bottom: 16px;">
          <label class="editor-form-label">Tipo de atajo</label>
          <select class="editor-form-select" id="shortcut-type-select" style="background-color: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); padding: 10px; border-radius: var(--border-radius-md); outline:none; width: 100%;">
            <option value="article">Artículo del catálogo</option>
            <option value="category">Categoría principal</option>
            <option value="subcategory">Subcategoría</option>
          </select>
        </div>

        <div class="editor-form-group" id="group-select-article" style="margin-bottom: 16px;">
          <label class="editor-form-label">Seleccionar Artículo</label>
          <select class="editor-form-select" id="shortcut-article-select" style="background-color: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); padding: 10px; border-radius: var(--border-radius-md); outline:none; width: 100%;">
            ${itemsOptions}
          </select>
        </div>

        <div class="editor-form-group" id="group-select-category" style="margin-bottom: 16px; display:none;">
          <label class="editor-form-label">Seleccionar Categoría</label>
          <select class="editor-form-select" id="shortcut-category-select" style="background-color: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); padding: 10px; border-radius: var(--border-radius-md); outline:none; width: 100%;">
            ${categoriesOptions}
          </select>
        </div>

        <div class="editor-form-group" id="group-select-subcategory" style="margin-bottom: 16px; display:none;">
          <label class="editor-form-label">Seleccionar Subcategoría</label>
          <select class="editor-form-select" id="shortcut-subcategory-select" style="background-color: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); padding: 10px; border-radius: var(--border-radius-md); outline:none; width: 100%;">
            ${subcategoriesOptions}
          </select>
        </div>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
        <button class="btn btn-secondary" id="modal-cancel-btn" style="height:36px; padding:0 16px; background-color: var(--bg-item); color: var(--text-main); border: 1px solid var(--border-color);">Cancelar</button>
        <button class="btn btn-primary" id="modal-save-btn" style="background-color: var(--secondary); height:36px; padding:0 16px; border-color: var(--secondary);">Añadir</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Modal events
  const typeSelect = modal.querySelector('#shortcut-type-select');
  const groupArticle = modal.querySelector('#group-select-article');
  const groupCategory = modal.querySelector('#group-select-category');
  const groupSubcategory = modal.querySelector('#group-select-subcategory');

  typeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    groupArticle.style.display = val === 'article' ? 'block' : 'none';
    groupCategory.style.display = val === 'category' ? 'block' : 'none';
    groupSubcategory.style.display = val === 'subcategory' ? 'block' : 'none';
  });

  modal.querySelector('#modal-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  modal.querySelector('#modal-save-btn').addEventListener('click', () => {
    const type = typeSelect.value;
    let targetId = '';
    let name = '';
    let price = 0;
    let image = undefined;

    if (type === 'article') {
      const artId = modal.querySelector('#shortcut-article-select').value;
      const item = store.state.menuItems.find(i => i.id === artId);
      if (item) {
        targetId = artId;
        name = item.name;
        price = item.price;
        image = item.image;
      }
    } else if (type === 'category') {
      const catId = modal.querySelector('#shortcut-category-select').value;
      const cat = store.state.categories.find(c => c.id === catId);
      if (cat) {
        targetId = catId;
        name = cat.name;
      }
    } else if (type === 'subcategory') {
      const subcatId = modal.querySelector('#shortcut-subcategory-select').value;
      const subcat = store.state.categories.find(c => c.id === subcatId);
      if (subcat) {
        targetId = subcatId;
        name = subcat.name;
      }
    }

    if (targetId) {
      const shortcutData = {
        type,
        name
      };
      if (type === 'article') {
        shortcutData.itemId = targetId;
        shortcutData.price = price;
        if (image) shortcutData.image = image;
      } else {
        shortcutData.target = targetId;
        shortcutData.color = type === 'category' ? 'blue' : 'green';
      }

      store.addGridShortcut(gridKey, slotIndex, shortcutData);
      modal.remove();
    }
  });
}
// Modifier Selection Modal for customizing products in active ticket
function getModifiersForItem(itemId) {
  const item = store.state.menuItems.find(i => i.id === itemId);
  if (!item) return [];

  const modifierIds = new Set(item.modifiers || []);
  return store.state.modifiers.filter(mod => {
    const assignedItems = mod.assignedItems || [];
    return modifierIds.has(mod.id) || assignedItems.includes(itemId);
  });
}

function itemHasModifiers(itemId) {
  return getModifiersForItem(itemId).length > 0;
}

function showModifierSelectionModal(itemId, ticketItemId = null) {
  const item = store.state.menuItems.find(i => i.id === itemId);
  if (!item) return;

  // Find existing selected options if editing
  let initialSelectedOptions = [];
  if (ticketItemId) {
    const activeItems = store.getActiveItems();
    const existingItem = activeItems.find(i => i.ticketItemId === ticketItemId);
    if (existingItem) {
      initialSelectedOptions = existingItem.selectedOptions || [];
    }
  }

  // Find modifiers assigned to this item in either direction:
  // item.modifiers or modifier.assignedItems.
  const itemModifiers = getModifiersForItem(itemId);
  if (itemModifiers.length === 0) {
    if (!ticketItemId) store.addItemToActiveTicket(itemId);
    return;
  }

  // Local state of quantities: { optId: qty }
  const optionQuantities = {};
  // Initialize optionQuantities with current values
  initialSelectedOptions.forEach(opt => {
    optionQuantities[opt.id] = opt.qty;
  });

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'modifier-selection-modal';

  // Render modifiers content
  let modifiersHTML = '';
  itemModifiers.forEach(mod => {
    let optionsHTML = '';
    (mod.options || []).forEach(opt => {
      const currentQty = optionQuantities[opt.id] || 0;
      optionsHTML += `
        <div class="modifier-option-row" data-opt-id="${opt.id}" data-opt-name="${opt.name}" data-opt-price="${opt.price}">
          <div class="modifier-option-info">
            <span class="modifier-option-name">${opt.name}</span>
            <span class="modifier-option-price">${opt.price > 0 ? '+' + opt.price.toFixed(2) + '€' : 'Gratis'}</span>
          </div>
          <div class="modifier-qty-controls">
            <button class="modifier-qty-btn opt-minus">-</button>
            <span class="modifier-qty-val">${currentQty}</span>
            <button class="modifier-qty-btn opt-plus">+</button>
          </div>
        </div>
      `;
    });

    modifiersHTML += `
      <div class="modifier-group">
        <div class="modifier-group-title">${mod.name}</div>
        <div class="modifier-options-list">
          ${optionsHTML || '<p style="font-size:0.85rem; color:var(--text-muted);">No hay opciones definidas</p>'}
        </div>
      </div>
    `;
  });

  // Calculate base total
  const updateModalTotal = () => {
    let optionsTotal = 0;
    itemModifiers.forEach(mod => {
      (mod.options || []).forEach(opt => {
        const qty = optionQuantities[opt.id] || 0;
        optionsTotal += opt.price * qty;
      });
    });
    const total = item.price + optionsTotal;
    const saveBtn = modal.querySelector('#modifier-save-btn');
    if (saveBtn) {
      saveBtn.innerText = ticketItemId 
        ? 'Guardar Cambios' 
        : `Añadir • ${total.toFixed(2)}€`;
    }
  };

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 500px;">
      <div class="modal-header">
        <h3 style="margin-bottom: 0; border-bottom: none; padding-bottom: 0; font-weight: 700;">
          ${ticketItemId ? 'Editar' : 'Personalizar'} ${item.name}
        </h3>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; margin-bottom: 12px;">
          Precio base: ${item.price.toFixed(2)}€
        </div>
      </div>
      <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
        ${modifiersHTML}
      </div>
      <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:12px; margin-top:20px; border-top: 1px solid var(--border-color); padding-top: 16px;">
        <button class="btn btn-secondary" id="modifier-cancel-btn" style="height:44px; padding:0 20px; background-color: var(--bg-item); color: var(--text-main); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); font-weight:600; cursor:pointer;">Cancelar</button>
        <button class="btn btn-primary" id="modifier-save-btn" style="background-color: var(--secondary); border-color: var(--secondary); height:44px; padding:0 24px; border-radius: var(--border-radius-md); font-weight:600; cursor:pointer; color: white;">Añadir</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  updateModalTotal();

  // Attach button events
  modal.querySelectorAll('.modifier-option-row').forEach(row => {
    const optId = row.dataset.optId;
    const minusBtn = row.querySelector('.opt-minus');
    const plusBtn = row.querySelector('.opt-plus');
    const valSpan = row.querySelector('.modifier-qty-val');

    minusBtn.addEventListener('click', () => {
      let qty = optionQuantities[optId] || 0;
      if (qty > 0) {
        qty--;
        optionQuantities[optId] = qty;
        valSpan.innerText = qty;
        updateModalTotal();
      }
    });

    plusBtn.addEventListener('click', () => {
      let qty = optionQuantities[optId] || 0;
      qty++;
      optionQuantities[optId] = qty;
      valSpan.innerText = qty;
      updateModalTotal();
    });
  });

  modal.querySelector('#modifier-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  modal.querySelector('#modifier-save-btn').addEventListener('click', () => {
    // Collect all options with qty > 0
    const selectedOptions = [];
    itemModifiers.forEach(mod => {
      (mod.options || []).forEach(opt => {
        const qty = optionQuantities[opt.id] || 0;
        if (qty > 0) {
          selectedOptions.push({
            id: opt.id,
            name: opt.name,
            price: opt.price,
            qty: qty
          });
        }
      });
    });

    if (ticketItemId) {
      store.updateTicketItemModifiers(ticketItemId, selectedOptions);
    } else {
      store.addItemToActiveTicket(itemId, selectedOptions);
    }

    modal.remove();
  });
}

// Modal para elegir en qué mesa guardar la comanda
function showTableSelectionModal() {
  const activeItems = store.getActiveItems();
  if (activeItems.length === 0) {
    showToast('No hay artículos en la comanda para guardar.', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'table-selection-modal';

  const tables = store.state.tables;
  const diningTables = tables.filter(t => (t.type || 'table') === 'table');
  const takeawayTables = tables.filter(t => t.type === 'takeaway');

  const renderTableButtons = (tableList) => {
    return tableList.map(table => {
      const total = store.getTableTotal(table);
      const itemCount = table.items.reduce((sum, item) => sum + item.qty, 0);
      const isOccupied = itemCount > 0;
      const statusClass = isOccupied ? 'occupied' : 'available';

      return `
        <button class="modal-table-btn ${statusClass}" data-table-id="${table.id}">
          <span style="font-size: 0.95rem; font-weight: 700;">${table.name}</span>
          ${isOccupied 
            ? `<span class="table-badge" style="font-size: 0.7rem; font-weight: 700; color: var(--warning);">${total.toFixed(2)}€</span>` 
            : `<span class="table-badge" style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted);">Libre</span>`
          }
        </button>
      `;
    }).join('');
  };

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 520px; width:95%; max-height: 90vh; display:flex; flex-direction:column; padding: 20px;">
      <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px; flex-shrink:0;">
        <h3 style="margin:0; font-size:1.2rem; font-weight:700;">Guardar en Mesa</h3>
      </div>
      <div class="modal-body" style="overflow-y:auto; flex:1; padding-right:2px; display:flex; flex-direction:column; gap:16px;">
        <div>
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Sala</div>
          <div class="modal-table-grid">
            ${renderTableButtons(diningTables)}
          </div>
        </div>
        
        <div>
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Para Llevar</div>
          <div class="modal-table-grid">
            ${renderTableButtons(takeawayTables)}
          </div>
        </div>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px; border-top: 1px solid var(--border-color); padding-top: 12px; flex-shrink:0;">
        <button class="btn btn-secondary" id="table-select-cancel-btn" style="height:40px; padding:0 16px; font-weight:600; border-radius:var(--border-radius-md); background:var(--bg-item); border:1px solid var(--border-color); color:var(--text-main); cursor:pointer; font-size:0.85rem;">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Bind cancel button
  modal.querySelector('#table-select-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  // Bind table selection buttons
  modal.querySelectorAll('.modal-table-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableId = parseInt(btn.dataset.tableId, 10);
      const table = store.state.tables.find(t => t.id === tableId);
      const isOccupied = table && table.items.length > 0;

      if (isOccupied) {
        if (confirm(`La ${table.name} ya tiene una comanda activa. ¿Deseas añadir estos artículos a la cuenta existente?`)) {
          store.saveActiveOrderToTable(tableId);
          modal.remove();
          showToast(`Comanda añadida a la ${table.name}.`, 'success');
        }
      } else {
        store.saveActiveOrderToTable(tableId);
        modal.remove();
        showToast(`Comanda guardada en la ${table.name}.`, 'success');
      }
    });
  });
}

// Modal de pago unificado y táctil
function showPaymentModal(totalAmount) {
  if (totalAmount <= 0) return;

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'payment-modal';

  let selectedMethod = 'Tarjeta'; // 'Tarjeta' | 'Efectivo' | 'Dividir'
  let splitType = 'iguales'; // 'iguales' | 'articulos' | 'libre'
  let cashReceived = totalAmount;

  // ── 1. Estado Partes Iguales
  let numParts = 2;
  let parts = []; // { id, amount, status: 'pending'|'paid-card'|'paid-cash' }

  const initParts = () => {
    parts = [];
    const baseAmount = parseFloat((totalAmount / numParts).toFixed(2));
    let sum = 0;
    for (let i = 0; i < numParts - 1; i++) {
      parts.push({ id: i + 1, amount: baseAmount, status: 'pending' });
      sum += baseAmount;
    }
    const lastAmount = parseFloat((totalAmount - sum).toFixed(2));
    parts.push({ id: numParts, amount: lastAmount, status: 'pending' });
  };
  initParts();

  // ── 2. Estado División Libre
  const freePayments = []; // { id, amount, method: 'Tarjeta' | 'Efectivo' }
  let freeInputValue = null;

  const getFreeTotalPaid = () => {
    return freePayments.reduce((sum, p) => sum + p.amount, 0);
  };
  const getFreeRemaining = () => {
    return Math.max(0, parseFloat((totalAmount - getFreeTotalPaid()).toFixed(2)));
  };

  // ── 3. Estado Por Artículos
  const activeItems = store.getActiveItems();
  const articleStocks = activeItems.map(item => {
    let displayName = item.name;
    if (item.selectedOptions && item.selectedOptions.length > 0) {
      const optsStr = item.selectedOptions.map(o => `${o.qty}x ${o.name}`).join(', ');
      displayName += ` (${optsStr})`;
    }
    
    // Obtener precio total unitario del artículo con sus modificadores
    const singleItemTotal = store.getItemTotal({ ...item, qty: 1 });
    
    return {
      ticketItemId: item.ticketItemId,
      id: item.id,
      name: displayName,
      price: singleItemTotal,
      totalQty: item.qty,
      qtyRemaining: item.qty
    };
  });

  const articleSelections = {};
  articleStocks.forEach(stock => {
    articleSelections[stock.ticketItemId] = 0;
  });
  
  const articlePayments = []; // { id, amount, method: 'Tarjeta'|'Efectivo', itemsText }

  const getSelectedArticlesTotal = () => {
    let sum = 0;
    articleStocks.forEach(stock => {
      const qty = articleSelections[stock.ticketItemId] || 0;
      sum += stock.price * qty;
    });
    return parseFloat(sum.toFixed(2));
  };

  // ── Helper de cambio en Efectivo directo
  const getChangeAmount = () => {
    return Math.max(0, cashReceived - totalAmount);
  };

  // ── Renderizador reactivo de contenido
  const renderPaymentContent = () => {
    const change = getChangeAmount();
    const isEfectivo = selectedMethod === 'Efectivo';
    const isDividir = selectedMethod === 'Dividir';

    let methodSpecificHTML = '';
    if (isEfectivo) {
      methodSpecificHTML = `
        <div class="payment-cash-section" style="margin-top: 16px; animation: fadeIn 0.2s ease;">
          <div class="editor-form-group">
            <label class="editor-form-label">Efectivo entregado por el cliente</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="number" class="search-input" id="cash-received-input" step="0.01" value="${cashReceived.toFixed(2)}" style="font-size:1.3rem; text-align:right; font-weight:700; flex:1; height: 48px; padding-right:12px; background:var(--bg-panel); color:var(--text-main); border:1px solid var(--border-color); border-radius:var(--border-radius-md);">
              <span style="font-size:1.3rem; font-weight:700;">€</span>
            </div>
          </div>
          
          <div class="cash-quick-buttons" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-top:12px;">
            <button class="cash-quick-btn" data-val="${totalAmount}">Exacto</button>
            <button class="cash-quick-btn" data-val="5">5€</button>
            <button class="cash-quick-btn" data-val="10">10€</button>
            <button class="cash-quick-btn" data-val="20">20€</button>
            <button class="cash-quick-btn" data-val="50">50€</button>
            <button class="cash-quick-btn" data-val="${Math.ceil(totalAmount / 5) * 5}">Próx 5</button>
            <button class="cash-quick-btn" data-val="${Math.ceil(totalAmount / 10) * 10}">Próx 10</button>
            <button class="cash-quick-btn" data-val="${Math.ceil(totalAmount / 20) * 20}">Próx 20</button>
          </div>

          <div class="payment-change-highlight" style="background: rgba(16, 185, 129, 0.1); border: 1px dashed var(--secondary); padding: 12px; border-radius: var(--border-radius-md); display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
            <span style="font-weight:600; font-size:0.9rem; color:var(--text-muted);">Cambio a devolver:</span>
            <strong style="font-size:1.4rem; color:var(--secondary); font-weight:800;">${change.toFixed(2)}€</strong>
          </div>
        </div>
      `;
    } else if (selectedMethod === 'Tarjeta') {
      methodSpecificHTML = `
        <div class="payment-card-section" style="margin-top: 24px; text-align:center; padding: 16px 0; animation: fadeIn 0.2s ease;">
          <div class="loading-spinner" style="margin: 0 auto; width: 44px; height: 44px;"></div>
          <p style="margin-top:16px; font-weight:600; color:var(--text-muted); font-size:0.9rem;">Esperando respuesta del datáfono...</p>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-top:4px;">(Puedes pulsar "Confirmar Pago" para simular cobro exitoso)</span>
        </div>
      `;
    } else if (isDividir) {
      let splitHTML = '';
      if (splitType === 'iguales') {
        splitHTML = `
          <div class="split-equal-section" style="animation: fadeIn 0.15s ease;">
            <div class="editor-form-group" style="margin-bottom: 12px; display:flex; flex-direction:column; gap:4px;">
              <label class="editor-form-label">Número de comensales</label>
              <select id="split-parts-count" class="editor-form-select" style="background-color: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); padding: 10px; border-radius: var(--border-radius-md); outline:none;">
                ${[2,3,4,5,6,7,8].map(n => `<option value="${n}" ${n === numParts ? 'selected' : ''}>Dividir en ${n} partes</option>`).join('')}
              </select>
            </div>

            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; margin-top:14px;">Partes de la cuenta</div>
            <div class="split-parts-list">
              ${parts.map(p => {
                const isPaid = p.status !== 'pending';
                const rowClass = isPaid ? 'split-part-row pagado' : 'split-part-row';
                const statusText = p.status === 'paid-card' ? 'Pagado (Tarjeta)' : p.status === 'paid-cash' ? 'Pagado (Efectivo)' : 'Pendiente';
                const statusClass = p.status === 'paid-card' ? 'paid-card' : p.status === 'paid-cash' ? 'paid-cash' : 'pending';
                
                let actionsHTML = '';
                if (!isPaid) {
                  actionsHTML = `
                    <div class="split-part-actions">
                      <button class="split-part-pay-btn card-btn" data-part-id="${p.id}" data-pay-method="Tarjeta">Tarjeta</button>
                      <button class="split-part-pay-btn cash-btn" data-part-id="${p.id}" data-pay-method="Efectivo">Efectivo</button>
                    </div>
                  `;
                } else {
                  actionsHTML = `
                    <span style="color: #10b981; font-weight: bold; font-size: 1.1rem;">✓</span>
                  `;
                }

                return `
                  <div class="${rowClass}">
                    <div class="split-part-info">
                      <span class="split-part-title">Parte ${p.id}: ${p.amount.toFixed(2)}€</span>
                      <span class="split-part-status ${statusClass}">${statusText}</span>
                    </div>
                    ${actionsHTML}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      } else if (splitType === 'libre') {
        splitHTML = `
          <div class="split-free-section" style="animation: fadeIn 0.15s ease;">
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom: 14px;">
              <div style="background:var(--bg-panel); border:1px solid var(--border-color); padding:8px; border-radius:var(--border-radius-md); text-align:center;">
                <div style="font-size:0.68rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Total</div>
                <div style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin-top:2px;">${totalAmount.toFixed(2)}€</div>
              </div>
              <div style="background:var(--bg-panel); border:1px solid var(--border-color); padding:8px; border-radius:var(--border-radius-md); text-align:center;">
                <div style="font-size:0.68rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Cobrado</div>
                <div style="font-size:1.1rem; font-weight:700; color:#10b981; margin-top:2px;">${getFreeTotalPaid().toFixed(2)}€</div>
              </div>
              <div style="background:var(--bg-panel); border:1px solid var(--border-color); padding:8px; border-radius:var(--border-radius-md); text-align:center;">
                <div style="font-size:0.68rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Restante</div>
                <div style="font-size:1.1rem; font-weight:700; color:#f59e0b; margin-top:2px;">${getFreeRemaining().toFixed(2)}€</div>
              </div>
            </div>

            <div class="editor-form-group" style="display:flex; flex-direction:column; gap:4px;">
              <label class="editor-form-label">Importe a cobrar</label>
              <div style="display:flex; gap:8px; align-items:center;">
                <input type="number" class="search-input" id="free-charge-amount" step="0.01" value="${(freeInputValue !== null ? freeInputValue : getFreeRemaining()).toFixed(2)}" style="font-size:1.2rem; text-align:right; font-weight:700; flex:1; height: 44px; padding-right:12px; background:var(--bg-panel); color:var(--text-main); border:1px solid var(--border-color); border-radius:var(--border-radius-md);">
                <span style="font-size:1.2rem; font-weight:700;">€</span>
              </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; margin-bottom:14px;">
              <button class="split-part-pay-btn card-btn" id="free-charge-card-btn" style="height:40px; font-size:0.85rem; font-weight:700;">Cobrar Tarjeta</button>
              <button class="split-part-pay-btn cash-btn" id="free-charge-cash-btn" style="height:40px; font-size:0.85rem; font-weight:700;">Cobrar Efectivo</button>
            </div>

            ${freePayments.length > 0 ? `
              <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Cobros realizados</div>
              <div class="split-parts-list" style="max-height:110px;">
                ${freePayments.map((p, idx) => `
                  <div class="split-part-row pagado" style="padding: 8px 12px;">
                    <span class="split-part-title" style="font-size:0.85rem; font-weight:600;">Pago #${idx + 1}: ${p.amount.toFixed(2)}€</span>
                    <span style="font-size:0.75rem; font-weight:700; color:${p.method === 'Tarjeta' ? 'var(--secondary)' : '#10b981'}">${p.method}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      } else if (splitType === 'articulos') {
        const isSelectedAny = getSelectedArticlesTotal() > 0;
        splitHTML = `
          <div class="split-articles-container" style="animation: fadeIn 0.15s ease;">
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Selecciona lo que paga este cliente</div>
            <div class="split-articles-scroll">
              ${articleStocks.map(stock => {
                const qtySelected = articleSelections[stock.ticketItemId] || 0;
                const isAllPaid = stock.qtyRemaining === 0;
                const rowClass = isAllPaid ? 'split-article-row all-paid' : 'split-article-row';
                
                let selectorHTML = '';
                if (!isAllPaid) {
                  selectorHTML = `
                    <div class="split-article-selector">
                      <button class="split-article-qty-btn art-minus" data-id="${stock.ticketItemId}" ${qtySelected === 0 ? 'disabled' : ''}>-</button>
                      <span class="split-article-select-val">
                        <span class="selected-qty">${qtySelected}</span><span class="total-qty">/${stock.qtyRemaining}</span>
                      </span>
                      <button class="split-article-qty-btn art-plus" data-id="${stock.ticketItemId}" ${qtySelected === stock.qtyRemaining ? 'disabled' : ''}>+</button>
                    </div>
                  `;
                } else {
                  selectorHTML = `
                    <span style="font-size:0.72rem; color:#10b981; font-weight:700; text-transform:uppercase;">Pagado</span>
                  `;
                }

                return `
                  <div class="${rowClass}">
                    <div class="split-article-info">
                      <span class="split-article-name" style="word-break: break-all;">${stock.name}</span>
                      <span class="split-article-price-qty">${stock.price.toFixed(2)}€ c/u • Total: ${stock.totalQty}</span>
                    </div>
                    ${selectorHTML}
                  </div>
                `;
              }).join('')}
            </div>

            <div class="split-articles-actions">
              <div>
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Seleccionado</div>
                <strong style="font-size:1.15rem; color:var(--secondary);">${getSelectedArticlesTotal().toFixed(2)}€</strong>
              </div>
              <div class="split-articles-actions-right">
                <button class="split-part-pay-btn card-btn" id="art-pay-card-btn" style="height:36px; padding:0 12px;" ${!isSelectedAny ? 'disabled style="opacity:0.3; pointer-events:none;"' : ''}>Tarjeta</button>
                <button class="split-part-pay-btn cash-btn" id="art-pay-cash-btn" style="height:36px; padding:0 12px;" ${!isSelectedAny ? 'disabled style="opacity:0.3; pointer-events:none;"' : ''}>Efectivo</button>
              </div>
            </div>

            ${articlePayments.length > 0 ? `
              <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Historial de pagos parciales</div>
              <div class="split-parts-list" style="max-height:90px;">
                ${articlePayments.map((p, idx) => `
                  <div class="split-part-row pagado" style="padding: 6px 12px; flex-direction:column; align-items:flex-start; gap:2px;">
                    <div style="display:flex; justify-content:space-between; width:100%; font-size:0.8rem; font-weight:700;">
                      <span>Pago #${idx + 1}: ${p.amount.toFixed(2)}€</span>
                      <span style="color:${p.method === 'Tarjeta' ? 'var(--secondary)' : '#10b981'}">${p.method}</span>
                    </div>
                    <div style="font-size:0.68rem; color:var(--text-muted); line-height:1.2; word-break: break-all;">
                      ${p.itemsText}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }

      methodSpecificHTML = `
        <div class="payment-split-section" style="margin-top: 14px;">
          <div class="split-tabs-list">
            <button class="split-tab-btn ${splitType === 'iguales' ? 'active' : ''}" data-split="iguales">Partes Iguales</button>
            <button class="split-tab-btn ${splitType === 'articulos' ? 'active' : ''}" data-split="articulos">Por Artículos</button>
            <button class="split-tab-btn ${splitType === 'libre' ? 'active' : ''}" data-split="libre">Cant. Libre</button>
          </div>
          ${splitHTML}
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 500px; width:95%; max-height: 95vh; display:flex; flex-direction:column; padding: 20px;">
        <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 12px; flex-shrink:0;">
          <h3 style="margin:0; font-size:1.2rem; font-weight:700;">Procesar Cobro</h3>
        </div>
        <div class="modal-body" style="overflow-y:auto; flex:1; padding-right:2px;">
          <div class="payment-amount-box" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 12px; text-align: center; margin-bottom: 14px;">
            <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Total a Cobrar</div>
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--secondary);">${totalAmount.toFixed(2)}€</div>
          </div>

          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Método de Pago</div>
          <div class="payment-methods-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
            <button class="payment-method-card ${selectedMethod === 'Tarjeta' ? 'active' : ''}" data-method="Tarjeta" style="background:var(--bg-item); border: 1px solid var(--border-color); border-radius:var(--border-radius-md); padding:12px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; color:var(--text-main); font-family:var(--font-family); font-weight:600; font-size:0.8rem; transition:all 0.2s ease;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px; color:${selectedMethod === 'Tarjeta' ? 'var(--secondary)' : 'var(--text-muted)'};"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
              <span>Tarjeta</span>
            </button>
            <button class="payment-method-card ${selectedMethod === 'Efectivo' ? 'active' : ''}" data-method="Efectivo" style="background:var(--bg-item); border: 1px solid var(--border-color); border-radius:var(--border-radius-md); padding:12px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; color:var(--text-main); font-family:var(--font-family); font-weight:600; font-size:0.8rem; transition:all 0.2s ease;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px; color:${selectedMethod === 'Efectivo' ? '#10b981' : 'var(--text-muted)'};"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></svg>
              <span>Efectivo</span>
            </button>
            <button class="payment-method-card ${selectedMethod === 'Dividir' ? 'active' : ''}" data-method="Dividir" style="background:var(--bg-item); border: 1px solid var(--border-color); border-radius:var(--border-radius-md); padding:12px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; color:var(--text-main); font-family:var(--font-family); font-weight:600; font-size:0.8rem; transition:all 0.2s ease;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px; color:${selectedMethod === 'Dividir' ? '#f59e0b' : 'var(--text-muted)'};"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><circle cx="4" cy="12" r="2" /><circle cx="12" cy="10" r="2" /><circle cx="20" cy="14" r="2" /></svg>
              <span>Dividir</span>
            </button>
          </div>

          ${methodSpecificHTML}
        </div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px; border-top: 1px solid var(--border-color); padding-top: 12px; flex-shrink:0;">
          <button class="btn btn-secondary" id="payment-cancel-btn" style="height:40px; padding:0 16px; font-weight:600; border-radius:var(--border-radius-md); background:var(--bg-item); border:1px solid var(--border-color); color:var(--text-main); cursor:pointer; font-size:0.85rem;">Cancelar</button>
          ${!isDividir ? `<button class="btn btn-primary" id="payment-confirm-btn" style="height:40px; padding:0 20px; font-weight:600; border-radius:var(--border-radius-md); background:var(--secondary); border:none; color:white; cursor:pointer; font-size:0.85rem;">Confirmar Pago</button>` : ''}
        </div>
      </div>
    `;

    // ── Enlazar Eventos Generales
    // Cambio de Método de Pago Principal
    modal.querySelectorAll('.payment-method-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedMethod = card.dataset.method;
        if (selectedMethod === 'Efectivo') {
          cashReceived = totalAmount;
        }
        renderPaymentContent();
      });
    });

    // Botón de Cancelar
    modal.querySelector('#payment-cancel-btn').addEventListener('click', () => {
      modal.remove();
    });

    // Botón Confirmar Pago Directo (no dividido)
    const confirmBtn = modal.querySelector('#payment-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (selectedMethod === 'Efectivo') {
          const change = getChangeAmount();
          store.payActiveTicket('Efectivo');
          isDrawerOpen = false;
          modal.remove();
          showToast(`Pago en efectivo registrado. Cambio: ${change.toFixed(2)}€.`, 'success');
        } else if (selectedMethod === 'Tarjeta') {
          store.payActiveTicket('Tarjeta');
          isDrawerOpen = false;
          modal.remove();
          showToast('Pago con tarjeta procesado correctamente.', 'success');
        }
      });
    }

    // ── Enlazar Eventos de Métodos Directos
    // Input de Efectivo entregado
    if (isEfectivo) {
      const cashInput = modal.querySelector('#cash-received-input');
      cashInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        cashReceived = isNaN(val) ? 0 : val;
        const changeVal = modal.querySelector('.payment-change-highlight strong');
        if (changeVal) {
          changeVal.innerText = `${getChangeAmount().toFixed(2)}€`;
        }
      });

      modal.querySelectorAll('.cash-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = parseFloat(btn.dataset.val);
          cashReceived = val;
          renderPaymentContent();
        });
      });
    }

    // ── Enlazar Eventos de División
    if (isDividir) {
      // Cambio de Pestaña de División
      modal.querySelectorAll('.split-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          splitType = btn.dataset.split;
          renderPaymentContent();
        });
      });

      // ── Eventos de Partes Iguales
      if (splitType === 'iguales') {
        const partsSelect = modal.querySelector('#split-parts-count');
        partsSelect.addEventListener('change', (e) => {
          numParts = parseInt(e.target.value, 10);
          initParts();
          renderPaymentContent();
        });

        modal.querySelectorAll('.split-part-pay-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const partId = parseInt(btn.dataset.partId, 10);
            const method = btn.dataset.payMethod;
            const partIndex = parts.findIndex(p => p.id === partId);
            if (partIndex > -1) {
              parts[partIndex].status = method === 'Tarjeta' ? 'paid-card' : 'paid-cash';
              
              // Verificar si ya se cobraron todas
              const complete = checkPartsComplete();
              if (!complete) {
                renderPaymentContent();
              }
            }
          });
        });
      }

      // ── Eventos de División Libre
      if (splitType === 'libre') {
        const freeInput = modal.querySelector('#free-charge-amount');
        freeInput.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          freeInputValue = isNaN(val) ? 0 : val;
        });

        const cardBtn = modal.querySelector('#free-charge-card-btn');
        if (cardBtn) {
          cardBtn.addEventListener('click', () => {
            const amount = freeInputValue !== null ? freeInputValue : getFreeRemaining();
            addFreePayment(amount, 'Tarjeta');
          });
        }

        const cashBtn = modal.querySelector('#free-charge-cash-btn');
        if (cashBtn) {
          cashBtn.addEventListener('click', () => {
            const amount = freeInputValue !== null ? freeInputValue : getFreeRemaining();
            addFreePayment(amount, 'Efectivo');
          });
        }
      }

      // ── Eventos de División por Artículos
      if (splitType === 'articulos') {
        modal.querySelectorAll('.split-article-qty-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const stockId = btn.dataset.id;
            const isPlus = btn.classList.contains('art-plus');
            const stock = articleStocks.find(s => s.ticketItemId === stockId);
            if (stock) {
              let selected = articleSelections[stockId] || 0;
              if (isPlus && selected < stock.qtyRemaining) {
                selected++;
              } else if (!isPlus && selected > 0) {
                selected--;
              }
              articleSelections[stockId] = selected;
              renderPaymentContent();
            }
          });
        });

        // Cobrar artículos seleccionados en Tarjeta o Efectivo
        const artCardBtn = modal.querySelector('#art-pay-card-btn');
        if (artCardBtn) {
          artCardBtn.addEventListener('click', () => {
            paySelectedArticles('Tarjeta');
          });
        }

        const artCashBtn = modal.querySelector('#art-pay-cash-btn');
        if (artCashBtn) {
          artCashBtn.addEventListener('click', () => {
            paySelectedArticles('Efectivo');
          });
        }
      }
    }
  };

  // Ayudante de cierre de partes iguales
  const checkPartsComplete = () => {
    if (parts.every(p => p.status !== 'pending')) {
      const paymentMethodsUsed = [...new Set(parts.map(p => p.status === 'paid-card' ? 'Tarjeta' : 'Efectivo'))];
      const methodText = paymentMethodsUsed.length > 1 ? 'Mixto (Partes)' : (paymentMethodsUsed[0] === 'paid-card' ? 'Tarjeta' : 'Efectivo');
      
      store.payActiveTicket(methodText);
      isDrawerOpen = false;
      modal.remove();
      showToast('Cobro por partes completado con éxito.', 'success');
      return true;
    }
    return false;
  };

  // Ayudante de cobro libre secuencial
  const addFreePayment = (amount, method) => {
    const remaining = getFreeRemaining();
    if (amount <= 0 || amount > remaining + 0.009) {
      showToast('Importe inválido o superior al restante.', 'error');
      return;
    }
    
    freePayments.push({
      id: Date.now(),
      amount: amount,
      method: method
    });
    
    freeInputValue = null;
    
    const newRemaining = getFreeRemaining();
    if (newRemaining <= 0.009) {
      const methodsUsed = [...new Set(freePayments.map(p => p.method))];
      const methodText = methodsUsed.length > 1 ? 'Mixto (Libre)' : methodsUsed[0];
      
      store.payActiveTicket(methodText);
      isDrawerOpen = false;
      modal.remove();
      showToast('Cobro libre completado con éxito.', 'success');
    } else {
      renderPaymentContent();
    }
  };

  // Ayudante de cobro por selección de artículos
  const paySelectedArticles = (method) => {
    const selectedTotal = getSelectedArticlesTotal();
    if (selectedTotal <= 0) return;

    const paidItems = [];
    articleStocks.forEach(stock => {
      const qty = articleSelections[stock.ticketItemId] || 0;
      if (qty > 0) {
        stock.qtyRemaining -= qty;
        paidItems.push(`${qty}x ${stock.name}`);
        articleSelections[stock.ticketItemId] = 0;
      }
    });

    articlePayments.push({
      id: Date.now(),
      amount: selectedTotal,
      method: method,
      itemsText: paidItems.join(', ')
    });

    const remainingCount = articleStocks.reduce((sum, s) => sum + s.qtyRemaining, 0);
    if (remainingCount === 0) {
      const methodsUsed = [...new Set(articlePayments.map(p => p.method))];
      const methodText = methodsUsed.length > 1 ? 'Mixto (Artículos)' : methodsUsed[0];
      
      store.payActiveTicket(methodText);
      isDrawerOpen = false;
      modal.remove();
      showToast('Cobro por artículos completado con éxito.', 'success');
    } else {
      renderPaymentContent();
    }
  };

  renderPaymentContent();
  document.body.appendChild(modal);
}

// Event bindings
function setupEventListeners(container) {
  // Bottom Nav tabs
  container.querySelectorAll('.bottom-nav [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) {
        isDrawerOpen = false; // Reset drawer on tab switch
        store.setActiveTab(tab);
      }
    });
  });

  container.querySelectorAll('[data-table-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableId = parseInt(btn.dataset.tableId, 10);
      if (!Number.isNaN(tableId)) {
        isDrawerOpen = false;
        store.selectTable(tableId);
      }
    });
  });

  // TPV Subtabs switching
  container.querySelectorAll('[data-pos-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const posTab = btn.dataset.posTab;
      if (posTab) store.setActivePosTab(posTab);
    });
  });

  // Edit shortcuts action (pencil button)
  const editBtn = container.querySelector('.pos-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      store.toggleEditingGrid();
    });
  }

  // Numeric Keypad digits
  container.querySelectorAll('.num-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      if (keypadAmount === '0') {
        if (val !== '0' && val !== '00') {
          keypadAmount = val;
        }
      } else {
        if (keypadAmount.length < 6) { // Limit max amount
          keypadAmount += val;
        }
      }
      // Re-draw just the display for visual latency
      const display = container.querySelector('.keypad-display');
      if (display) {
        display.innerText = (parseInt(keypadAmount, 10) / 100).toFixed(2) + ' €';
      }
    });
  });

  // Keypad Clear
  const clearKey = container.querySelector('.clear-key');
  if (clearKey) {
    clearKey.addEventListener('click', () => {
      keypadAmount = '0';
      const display = container.querySelector('.keypad-display');
      if (display) {
        display.innerText = '0.00 €';
      }
    });
  }

  // Keypad Quick Sale submission
  const keypadAddBtn = container.querySelector('#keypad-add-btn');
  if (keypadAddBtn) {
    keypadAddBtn.addEventListener('click', () => {
      const cents = parseInt(keypadAmount, 10);
      if (cents > 0) {
        store.addItemToActiveTicket('espresso'); // fallback base
        // Custom override: let's inject custom item
        const activeItems = store.getActiveItems();
        const customPrice = cents / 100;
        
        // Add to active ticket
        if (store.state.selectedTableId !== null) {
          const tIdx = store.state.tables.findIndex(t => t.id === store.state.selectedTableId);
          if (tIdx > -1) {
            const table = store.state.tables[tIdx];
            const newItems = [...table.items];
            newItems.push({
              id: 'quick-sale-' + Date.now(),
              name: `Cargo Rápido (${customPrice.toFixed(2)}€)`,
              price: customPrice,
              qty: 1
            });
            store.state.tables[tIdx] = {
              ...table,
              items: newItems,
              status: table.status === 'available' ? 'occupied' : table.status
            };
          }
        } else {
          const newItems = [...store.state.directSaleTicket.items];
          newItems.push({
            id: 'quick-sale-' + Date.now(),
            name: `Cargo Rápido (${customPrice.toFixed(2)}€)`,
            price: customPrice,
            qty: 1
          });
          store.state.directSaleTicket.items = newItems;
        }

        keypadAmount = '0';
        store.notify(); // Re-trigger reactive sync
        alert('Cargo rápido añadido al ticket!');
      }
    });
  }

  // Grid Category navigation
  container.querySelectorAll('.grid-card.category-card, .grid-card.subcategory-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (store.state.isEditingGrid) return;
      const target = card.dataset.target;
      if (target) {
        const newPath = [...store.state.gridPath, target];
        store.setGridPath(newPath);
      }
    });
  });

  // Grid Back button
  const gridBackBtn = container.querySelector('#grid-back-btn');
  if (gridBackBtn) {
    gridBackBtn.addEventListener('click', () => {
      if (store.state.isEditingGrid) return;
      store.goBackGrid();
    });
  }

  // Grid Article addition
  container.querySelectorAll('.grid-card.article-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (store.state.isEditingGrid) return;
      const itemId = card.dataset.itemId;
      if (itemId) {
        if (itemHasModifiers(itemId)) {
          showModifierSelectionModal(itemId);
        } else {
          store.addItemToActiveTicket(itemId);
        }
      }
    });
  });

  // Grid Customization overlays (Delete Shortcut & Add Shortcut)
  container.querySelectorAll('.shortcut-delete-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent card click
      const slotIndex = parseInt(badge.dataset.deleteSlot, 10);
      const gridKey = badge.dataset.gridKey;
      if (confirm('¿Seguro que deseas quitar este atajo de la cuadrícula?')) {
        store.removeGridShortcut(gridKey, slotIndex);
      }
    });
  });

  container.querySelectorAll('.editable-placeholder').forEach(placeholder => {
    placeholder.addEventListener('click', (e) => {
      e.stopPropagation();
      const slotIndex = parseInt(placeholder.dataset.addSlot, 10);
      const gridKey = placeholder.dataset.gridKey;
      showAddShortcutModal(gridKey, slotIndex);
    });
  });

  // Product Row List Addition
  container.querySelectorAll('.product-row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.dataset.itemId;
      if (itemId) {
        if (itemHasModifiers(itemId)) {
          showModifierSelectionModal(itemId);
        } else {
          store.addItemToActiveTicket(itemId);
          alert(`Añadido: ${btn.querySelector('.product-row-name').innerText}`);
        }
      }
    });
  });

  // Search input typing
  const searchInput = container.querySelector('#prod-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      productSearchText = e.target.value;
      // Re-render sub-view without refreshing full layout to keep focus
      const scrollArea = container.querySelector('.products-scroll-area');
      if (scrollArea) {
        const filtered = store.state.menuItems.filter(item => 
          item.name.toLowerCase().includes(productSearchText.toLowerCase())
        ).sort((a,b) => a.name.localeCompare(b.name));
        
        scrollArea.innerHTML = filtered.map(item => `
          <button class="product-row-btn" data-item-id="${item.id}">
            <span class="product-row-name">${item.name}</span>
            <span class="product-row-price">${item.price.toFixed(2)}€</span>
          </button>
        `).join('') || '<p style="text-align:center; padding: 20px; color: var(--text-muted);">No se encontraron productos</p>';
        
        // Re-attach add listeners to new rows
        scrollArea.querySelectorAll('.product-row-btn').forEach(row => {
          row.addEventListener('click', () => {
            const itemId = row.dataset.itemId;
            if (itemId) {
              if (itemHasModifiers(itemId)) {
                showModifierSelectionModal(itemId);
              } else {
                store.addItemToActiveTicket(itemId);
                alert(`Añadido: ${row.querySelector('.product-row-name').innerText}`);
              }
            }
          });
        });
      }
    });
  }

  // Floating pay trigger (Opens Drawer)
  const quickPayTrigger = container.querySelector('#quick-pay-trigger');
  if (quickPayTrigger) {
    quickPayTrigger.addEventListener('click', () => {
      isDrawerOpen = true;
      store.notify();
    });
  }

  // Close Drawer backdrop click
  const drawerBackdrop = container.querySelector('#drawer-backdrop');
  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', (e) => {
      if (e.target.id === 'drawer-backdrop') {
        isDrawerOpen = false;
        store.notify();
      }
    });
  }

  // Drawer pull indicator close
  const drawerPull = container.querySelector('#drawer-pull-bar');
  if (drawerPull) {
    drawerPull.addEventListener('click', () => {
      isDrawerOpen = false;
      store.notify();
    });
  }

  // Drawer/Ticket item quantities
  container.querySelectorAll('.qty-minus-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticketItemId = btn.dataset.ticketItemId;
      if (ticketItemId) store.updateItemQty(ticketItemId, -1);
    });
  });

  container.querySelectorAll('.qty-plus-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticketItemId = btn.dataset.ticketItemId;
      if (ticketItemId) store.updateItemQty(ticketItemId, 1);
    });
  });

  // Ticket item click (edit modifiers)
  container.querySelectorAll('.ticket-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.ticket-item-qty-actions')) return;
      const itemId = row.dataset.itemId;
      const ticketItemId = row.dataset.ticketItemId;
      if (itemHasModifiers(itemId) && ticketItemId) {
        showModifierSelectionModal(itemId, ticketItemId);
      }
    });
  });

  // Drawer clear ticket
  const drawerClear = container.querySelector('#drawer-clear-btn');
  if (drawerClear) {
    drawerClear.addEventListener('click', () => {
      if (confirm('¿Vaciar pedido actual?')) {
        store.clearActiveTicket();
        isDrawerOpen = false;
      }
    });
  }

  // Drawer Print bill
  const drawerPrint = container.querySelector('#drawer-print-btn');
  if (drawerPrint) {
    drawerPrint.addEventListener('click', () => {
      alert('Imprimiendo pre-factura del ticket...');
      store.printBill();
      isDrawerOpen = false;
    });
  }

  // Drawer Payment direct modal
  const drawerPayBtn = container.querySelector('#drawer-pay-btn');
  if (drawerPayBtn) {
    drawerPayBtn.addEventListener('click', () => {
      showPaymentModal(store.getActiveTicketTotal());
    });
  }

  const drawerSaveOrder = container.querySelector('#drawer-save-order-btn');
  if (drawerSaveOrder) {
    drawerSaveOrder.addEventListener('click', () => {
      if (store.state.selectedTableId !== null) {
        store.saveActiveOrder();
        isDrawerOpen = false;
      } else {
        isDrawerOpen = false;
        showTableSelectionModal();
      }
    });
  }

  // Tablet Split ticket actions
  const splitClear = container.querySelector('#split-clear-btn');
  if (splitClear) {
    splitClear.addEventListener('click', () => {
      if (confirm('¿Vaciar pedido actual?')) {
        store.clearActiveTicket();
      }
    });
  }

  const splitPrint = container.querySelector('#split-print-btn');
  if (splitPrint) {
    splitPrint.addEventListener('click', () => {
      alert('Imprimiendo pre-factura...');
      store.printBill();
    });
  }

  // Tablet Payment direct modal
  const splitPayBtn = container.querySelector('#split-pay-btn');
  if (splitPayBtn) {
    splitPayBtn.addEventListener('click', () => {
      showPaymentModal(store.getActiveTicketTotal());
    });
  }

  const splitSaveOrder = container.querySelector('#split-save-order-btn');
  if (splitSaveOrder) {
    splitSaveOrder.addEventListener('click', () => {
      if (store.state.selectedTableId !== null) {
        store.saveActiveOrder();
      } else {
        showTableSelectionModal();
      }
    });
  }

  // Settings active table selection
  const settingTableSelect = container.querySelector('#settings-table-select');
  if (settingTableSelect) {
    settingTableSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'direct') {
        store.selectTable(null);
      } else {
        store.selectTable(parseInt(val, 10));
      }
    });
  }

  // Settings Theme button toggler
  const settingsThemeBtn = container.querySelector('#settings-theme-btn');
  if (settingsThemeBtn) {
    settingsThemeBtn.addEventListener('click', () => {
      const nextTheme = store.state.theme === 'dark' ? 'light' : 'dark';
      store.setTheme(nextTheme);
    });
  }

  // Settings TPV Data Reset
  const settingsReset = container.querySelector('#settings-reset-btn');
  if (settingsReset) {
    settingsReset.addEventListener('click', () => {
      if (confirm('¿CUIDADO! ¿Deseas restablecer de fábrica todo el TPV? Se borrará el historial de ventas y los tickets de las mesas.')) {
        store.state.transactions = [];
        store.state.tables.forEach(t => {
          t.status = 'available';
          t.items = [];
        });
        store.state.directSaleTicket.items = [];
        store.selectTable(null);
        store.navigateSettings([]); // reset settings view too
        alert('TPV Restablecido.');
      }
    });
  }

  // Settings Tree drill-down navigation
  const toArticulosBtn = container.querySelector('#settings-to-articulos');
  if (toArticulosBtn) {
    toArticulosBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos']);
    });
  }

  const toTodosArticulosBtn = container.querySelector('#settings-to-todos-articulos');
  if (toTodosArticulosBtn) {
    toTodosArticulosBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos', 'todos']);
    });
  }

  const backSettingsBtn = container.querySelector('#settings-back-btn');
  if (backSettingsBtn) {
    backSettingsBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  // Create Article button
  const createArticleBtn = container.querySelector('#settings-create-article-btn');
  if (createArticleBtn) {
    createArticleBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos', 'todos', 'new']);
    });
  }

  // Create Article form actions
  const createArticleCancelBtn = container.querySelector('#create-article-cancel-btn');
  if (createArticleCancelBtn) {
    createArticleCancelBtn.addEventListener('click', () => store.goBackSettings());
  }

  const createArticleSaveBtn = container.querySelector('#create-article-save-btn');
  if (createArticleSaveBtn) {
    createArticleSaveBtn.addEventListener('click', () => {
      const name = (container.querySelector('#create-article-name')?.value || '').trim();
      const priceRaw = container.querySelector('#create-article-price')?.value;
      const price = parseFloat(priceRaw);
      const category = container.querySelector('#create-article-category')?.value || '';

      if (!name) { alert('El nombre no puede estar vacío.'); return; }
      if (isNaN(price) || price < 0) { alert('El precio debe ser un número válido mayor o igual a 0.'); return; }
      if (!category) { alert('Selecciona una categoría.'); return; }

      const modifiers = Array.from(container.querySelectorAll('#create-article-modifiers-checklist .assign-checkbox-card.assigned'))
        .map(card => card.dataset.createModifierId);

      store.addMenuItem({ name, price, category, modifiers });
      store.navigateSettings(['articulos', 'todos']);
    });
  }

  // Create Article modifiers checklist toggling
  container.querySelectorAll('#create-article-modifiers-checklist .assign-checkbox-card').forEach(card => {
    card.addEventListener('click', () => {
      const isAssigned = card.classList.toggle('assigned');
      const chk = card.querySelector('input[type="checkbox"]');
      if (chk) chk.checked = isAssigned;
    });
  });

  // Edit item selection click
  container.querySelectorAll('[data-edit-item-id]').forEach(row => {
    row.addEventListener('click', () => {
      const itemId = row.dataset.editItemId;
      if (itemId) {
        store.navigateSettings(['articulos', 'todos', itemId]);
      }
    });
  });

  // Edit item form actions
  const editCancelBtn = container.querySelector('#edit-item-cancel-btn');
  if (editCancelBtn) {
    editCancelBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  const editSaveBtn = container.querySelector('#edit-item-save-btn');
  if (editSaveBtn) {
    editSaveBtn.addEventListener('click', () => {
      const itemId = editSaveBtn.dataset.saveItemId;
      const name = container.querySelector('#edit-item-name').value.trim();
      const price = parseFloat(container.querySelector('#edit-item-price').value);
      const category = container.querySelector('#edit-item-category').value;

      if (!name) {
        alert('El nombre no puede estar vacío.');
        return;
      }
      if (isNaN(price) || price < 0) {
        alert('El precio debe ser un número válido mayor o igual a 0.');
        return;
      }

      // Collect selected modifier IDs
      const modifiers = Array.from(container.querySelectorAll('#article-modifiers-checklist .assign-checkbox-card.assigned'))
        .map(card => card.dataset.articleModifierId);

      store.updateMenuItem(itemId, { name, price, category, modifiers });
      store.goBackSettings();
      alert('Artículo actualizado correctamente.');
    });
  }

  // Categories navigation & actions
  const toCategoriasBtn = container.querySelector('#settings-to-categorias');
  if (toCategoriasBtn) {
    toCategoriasBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos', 'categorias']);
    });
  }

  // 1. Root list actions
  const createCategoryBtn = container.querySelector('#settings-create-category-btn');
  if (createCategoryBtn) {
    createCategoryBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos', 'categorias', 'new']);
    });
  }

  container.querySelectorAll('[data-category-id]').forEach(row => {
    row.addEventListener('click', () => {
      const catId = row.dataset.categoryId;
      if (catId) {
        store.navigateSettings(['articulos', 'categorias', catId]);
      }
    });
  });

  // 2. Create Parent Category actions
  const createCatCancelBtn = container.querySelector('#create-cat-cancel-btn');
  if (createCatCancelBtn) {
    createCatCancelBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  const createCatSaveBtn = container.querySelector('#create-cat-save-btn');
  if (createCatSaveBtn) {
    createCatSaveBtn.addEventListener('click', () => {
      const nameInput = container.querySelector('#create-cat-name');
      const name = nameInput ? nameInput.value.trim() : '';

      if (!name) {
        alert('El nombre de la categoría no puede estar vacío.');
        return;
      }

      store.addCategory({ name, type: 'category' });
      store.goBackSettings();
      alert('Categoría creada correctamente.');
    });
  }

  // 3. Category Detail (Subcategories list) actions
  const editParentCategoryBtn = container.querySelector('#settings-edit-parent-category-btn');
  if (editParentCategoryBtn) {
    editParentCategoryBtn.addEventListener('click', () => {
      const catId = editParentCategoryBtn.dataset.parentCatId;
      if (catId) {
        store.navigateSettings(['articulos', 'categorias', catId, 'edit']);
      }
    });
  }

  const createSubcategoryBtn = container.querySelector('#settings-create-subcategory-btn');
  if (createSubcategoryBtn) {
    createSubcategoryBtn.addEventListener('click', () => {
      const catId = createSubcategoryBtn.dataset.parentCatId;
      if (catId) {
        store.navigateSettings(['articulos', 'categorias', catId, 'new']);
      }
    });
  }

  container.querySelectorAll('[data-subcategory-id]').forEach(row => {
    row.addEventListener('click', () => {
      const subcatId = row.dataset.subcategoryId;
      const parentId = store.state.settingsPath[2];
      if (subcatId && parentId) {
        store.navigateSettings(['articulos', 'categorias', parentId, subcatId]);
      }
    });
  });

  // 4. Create Subcategory actions
  const createSubcatCancelBtn = container.querySelector('#create-subcat-cancel-btn');
  if (createSubcatCancelBtn) {
    createSubcatCancelBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  const createSubcatSaveBtn = container.querySelector('#create-subcat-save-btn');
  if (createSubcatSaveBtn) {
    createSubcatSaveBtn.addEventListener('click', () => {
      const nameInput = container.querySelector('#create-subcat-name');
      const name = nameInput ? nameInput.value.trim() : '';
      const parentId = createSubcatSaveBtn.dataset.parentId;

      if (!name) {
        alert('El nombre de la subcategoría no puede estar vacío.');
        return;
      }

      store.addCategory({ name, type: 'subcategory', parentId });
      store.goBackSettings();
      alert('Subcategoría creada correctamente.');
    });
  }

  // 5. Edit Parent Category actions
  const editParentCatCancelBtn = container.querySelector('#edit-parent-cat-cancel-btn');
  if (editParentCatCancelBtn) {
    editParentCatCancelBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  const editParentCatSaveBtn = container.querySelector('#edit-parent-cat-save-btn');
  if (editParentCatSaveBtn) {
    editParentCatSaveBtn.addEventListener('click', () => {
      const catId = editParentCatSaveBtn.dataset.saveCatId;
      const nameInput = container.querySelector('#edit-parent-cat-name');
      const name = nameInput ? nameInput.value.trim() : '';

      if (!name) {
        alert('El nombre de la categoría no puede estar vacío.');
        return;
      }

      store.updateCategory(catId, { name, type: 'category' });
      store.goBackSettings();
      alert('Categoría actualizada correctamente.');
    });
  }

  const editParentCatDeleteBtn = container.querySelector('#edit-parent-cat-delete-btn');
  if (editParentCatDeleteBtn) {
    editParentCatDeleteBtn.addEventListener('click', () => {
      const catId = editParentCatDeleteBtn.dataset.deleteCatId;
      if (!catId) return;

      if (confirm('¿Seguro que deseas eliminar esta categoría? Se borrarán de forma recursiva todas sus subcategorías y sus atajos del grid.')) {
        store.deleteCategory(catId);
        store.navigateSettings(['articulos', 'categorias']);
        alert('Categoría eliminada correctamente.');
      }
    });
  }

  // 6. Edit Subcategory actions
  const editSubcatCancelBtn = container.querySelector('#edit-subcat-cancel-btn');
  if (editSubcatCancelBtn) {
    editSubcatCancelBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  const editSubcatSaveBtn = container.querySelector('#edit-subcat-save-btn');
  if (editSubcatSaveBtn) {
    editSubcatSaveBtn.addEventListener('click', () => {
      const subcatId = editSubcatSaveBtn.dataset.saveSubcatId;
      const nameInput = container.querySelector('#edit-subcat-name');
      const name = nameInput ? nameInput.value.trim() : '';
      const parentId = store.state.settingsPath[2];

      if (!name) {
        alert('El nombre de la subcategoría no puede estar vacío.');
        return;
      }

      store.updateCategory(subcatId, { name, type: 'subcategory', parentId });
      store.goBackSettings();
      alert('Subcategoría actualizada correctamente.');
    });
  }

  const editSubcatDeleteBtn = container.querySelector('#edit-subcat-delete-btn');
  if (editSubcatDeleteBtn) {
    editSubcatDeleteBtn.addEventListener('click', () => {
      const subcatId = editSubcatDeleteBtn.dataset.deleteSubcatId;
      if (!subcatId) return;

      if (confirm('¿Seguro que deseas eliminar esta subcategoría? Se borrará su atajo del grid.')) {
        store.deleteCategory(subcatId);
        store.goBackSettings();
        alert('Subcategoría eliminada correctamente.');
      }
    });
  }

  // ----------------------------------------------------
  // Modificadores navigation & actions
  // ----------------------------------------------------

  // 1. Settings Submenu click
  const toModificadoresBtn = container.querySelector('#settings-to-modificadores');
  if (toModificadoresBtn) {
    toModificadoresBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos', 'modificadores']);
    });
  }

  // 2. Modifiers List View actions
  const createModifierBtn = container.querySelector('#settings-create-modifier-btn');
  if (createModifierBtn) {
    createModifierBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos', 'modificadores', 'new']);
    });
  }

  container.querySelectorAll('[data-modifier-id]').forEach(row => {
    row.addEventListener('click', () => {
      const modId = row.dataset.modifierId;
      if (modId) {
        store.navigateSettings(['articulos', 'modificadores', modId]);
      }
    });
  });

  // 3. Create Modifier Form actions
  const createModCancelBtn = container.querySelector('#create-mod-cancel-btn');
  if (createModCancelBtn) {
    createModCancelBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  const createModSaveBtn = container.querySelector('#create-mod-save-btn');
  if (createModSaveBtn) {
    createModSaveBtn.addEventListener('click', () => {
      const nameInput = container.querySelector('#create-mod-name');
      const name = nameInput ? nameInput.value.trim() : '';

      if (!name) {
        alert('El nombre del modificador no puede estar vacío.');
        return;
      }

      const newMod = store.addModifier({ name });
      store.navigateSettings(['articulos', 'modificadores', newMod.id]);
      alert('Modificador creado. Añada opciones y asigne artículos.');
    });
  }

  // 4. Edit Modifier Form actions
  const editModCancelBtn = container.querySelector('#edit-mod-cancel-btn');
  if (editModCancelBtn) {
    editModCancelBtn.addEventListener('click', () => {
      store.goBackSettings();
    });
  }

  const editModSaveBtn = container.querySelector('#edit-mod-save-btn');
  if (editModSaveBtn) {
    editModSaveBtn.addEventListener('click', () => {
      const modId = editModSaveBtn.dataset.saveModId;
      const nameInput = container.querySelector('#edit-mod-name');
      const name = nameInput ? nameInput.value.trim() : '';

      if (!name) {
        alert('El nombre del grupo no puede estar vacío.');
        return;
      }

      store.updateModifier(modId, { name });
      store.goBackSettings();
      alert('Modificador guardado correctamente.');
    });
  }

  const editModDeleteBtn = container.querySelector('#edit-mod-delete-btn');
  if (editModDeleteBtn) {
    editModDeleteBtn.addEventListener('click', () => {
      const modId = editModDeleteBtn.dataset.deleteModId;
      if (modId && confirm('¿Seguro que deseas eliminar este modificador?')) {
        store.deleteModifier(modId);
        store.navigateSettings(['articulos', 'modificadores']);
        alert('Modificador eliminado correctamente.');
      }
    });
  }

  // Inline Option Add inside Edit Modifier Form
  const btnAddModOption = container.querySelector('#btn-add-mod-option');
  if (btnAddModOption) {
    btnAddModOption.addEventListener('click', () => {
      const modId = store.state.settingsPath[2];
      const optNameInput = container.querySelector('#new-opt-name');
      const optPriceInput = container.querySelector('#new-opt-price');
      const name = optNameInput ? optNameInput.value.trim() : '';
      const price = optPriceInput ? parseFloat(optPriceInput.value) : 0;

      if (!name) {
        alert('El nombre de la opción no puede estar vacío.');
        return;
      }
      if (isNaN(price) || price < 0) {
        alert('El precio debe ser un número válido mayor o igual a 0.');
        return;
      }

      const mod = store.state.modifiers.find(m => m.id === modId);
      if (mod) {
        const newOption = {
          id: 'opt-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now(),
          name,
          price
        };
        const newOptions = [...(mod.options || []), newOption];
        store.updateModifier(modId, { options: newOptions });
      }
    });
  }

  // Inline Option Delete inside Edit Modifier Form
  container.querySelectorAll('.btn-delete-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const modId = store.state.settingsPath[2];
      const optIndex = parseInt(btn.dataset.optionIndex, 10);
      const mod = store.state.modifiers.find(m => m.id === modId);
      if (mod && !isNaN(optIndex)) {
        const newOptions = [...(mod.options || [])];
        newOptions.splice(optIndex, 1);
        store.updateModifier(modId, { options: newOptions });
      }
    });
  });

  // Assigned articles checkbox cards toggling inside Edit Modifier Form
  container.querySelectorAll('#edit-mod-assignment-grid .assign-checkbox-card').forEach(card => {
    card.addEventListener('click', () => {
      const modId = store.state.settingsPath[2];
      const itemId = card.dataset.assignItemId;
      const mod = store.state.modifiers.find(m => m.id === modId);
      if (mod && itemId) {
        const isAssigned = (mod.assignedItems || []).includes(itemId);
        let newAssigned;
        if (isAssigned) {
          newAssigned = (mod.assignedItems || []).filter(id => id !== itemId);
        } else {
          newAssigned = [...(mod.assignedItems || []), itemId];
        }
        store.updateModifier(modId, { assignedItems: newAssigned });
      }
    });
  });

  // Article Editor modifiers checklist toggling
  container.querySelectorAll('#article-modifiers-checklist .assign-checkbox-card').forEach(card => {
    card.addEventListener('click', () => {
      const isAssigned = card.classList.toggle('assigned');
      const chk = card.querySelector('input[type="checkbox"]');
      if (chk) chk.checked = isAssigned;
    });
  });
}

// Bootstrapper
document.addEventListener('DOMContentLoaded', async () => {
  // Show loading overlay while fetching from Supabase
  const loadingEl = document.getElementById('app-loading-overlay');

  // Listen for DB write errors and show toast
  window.addEventListener('db-error', (e) => {
    const { operation, message } = e.detail;
    dbStatus = 'error';
    // Detect the most common cause and give actionable advice
    let userMsg = `Error guardando en Supabase (${operation})`;
    if (message.includes('permission denied') || message.includes('row-level security') || message.includes('RLS')) {
      userMsg = 'Sin permisos en Supabase \u2014 ejecuta fix_permissions.sql';
    } else if (message.includes('does not exist') || message.includes('relation')) {
      userMsg = 'Tablas no encontradas \u2014 ejecuta schema.sql y seed.sql';
    }
    showToast(userMsg, 'error');
    render(store.state); // refresh header dot color
  });

  // Bind store event reactive updates
  store.subscribe((state) => {
    render(state);
  });

  // Load catalog from Supabase before first paint
  const loaded = await store.loadFromSupabase();
  dbStatus = loaded ? 'connected' : 'fallback';

  if (loadingEl) {
    if (!loaded) {
      // Show fallback warning briefly
      const msgEl = loadingEl.querySelector('.loading-message');
      if (msgEl) {
        msgEl.textContent = 'Sin conexión a Supabase \u2014 ejecuta schema.sql y seed.sql';
        msgEl.style.color = '#f59e0b';
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    loadingEl.classList.add('fade-out');
    setTimeout(() => loadingEl.remove(), 400);
  }

  // First paint
  render(store.state);

  // Resize monitor to refresh template bindings (switching tablet split dynamically)
  window.addEventListener('resize', () => {
    render(store.state);
  });

  // PWA Service worker cleaner (temporary unregister to clear aggressive PWA caching in dev)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (let registration of registrations) {
        registration.unregister().then(() => {
          console.log('SW desregistrado para recargar de red.');
        });
      }
    });
  }
});
