import { store } from './store.js';
import QRCode from 'qrcode';
import { parseGeminiInvoiceText } from './geminiInvoiceParser.js';
import {
  addLoyaltyPurchase,
  addManualLoyaltyPointsWithoutPurchase,
  calculateLoyaltyPoints,
  createLoyaltyCustomer,
  findLoyaltyCustomerByRfid,
  getLoyaltyAdminOverview,
  getLoyaltyDashboard,
  getLoyaltyCustomerPurchases,
  isLoyaltyConfigured,
  listLoyaltyPromos,
  listPendingLoyaltyVouchers,
  normalizeRfidUid,
  saveLoyaltyPromo,
  searchLoyaltyCustomers,
  setLoyaltyPromoActive,
  updateLoyaltyCustomer,
  updateLoyaltyVoucherStatus
} from './loyalty.js';
import {
  formatGiftCardBalance,
  lookupSquareGiftCard,
  normalizeSquareGiftCardCode,
  redeemSquareGiftCard
} from './squareGiftCards.js';

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
let selectedReportsTab = 'horas'; // 'horas' | 'diaria' | 'semanal' | 'mensual' | 'anual'
let geminiInvoiceRawText = '';
let geminiInvoicePreview = null;
let loyaltyAdminQuery = '';
let loyaltyAdminTab = 'resumen';
let loyaltyAdminCustomers = [];
let loyaltyAdminSelectedCustomer = null;
let loyaltyAdminPurchases = [];
let loyaltyAdminDashboard = null;
let loyaltyAdminOverview = null;
let loyaltyAdminPromos = [];
let loyaltyAdminVouchers = [];
let loyaltyAdminLoading = false;
let loyaltyAdminError = '';
const GEMINI_SINGLE_INVOICE_PROMPT = `Analiza únicamente esta factura.

Devuélveme solo una tabla Markdown con estas columnas exactas:

Proveedor | Fecha | Factura | Artículo | Cant. | Precio Unit. | Importe

No añadas resumen, explicación ni texto adicional.
Usa una fila por cada artículo.
Conserva los códigos de producto que identifiquen variantes, por ejemplo "B13", "AL26" o combinaciones letra+número. Si la factura dice "Smoothie B13 - 20 x 150g", el artículo debe ser "Smoothie B13", no solo "Smoothie".
En facturas de Europastry, la columna "Precio" puede no ser el precio unitario real de compra. Usa la columna "Importe" como importe de la línea y calcula "Precio Unit." como Importe / Cantidad. Conserva descripciones completas como "Croissant Masa Madre (40u)" o "Rebanada Pan Payes (18px5u)".
Mantén el número de factura exacto.
Usa fecha en formato dd/mm/aaaa si aparece.
Si aparece un total final de factura distinto a la suma de líneas por IGIC u otros ajustes, añade debajo de la tabla una línea de texto: Total factura: X.
Si un dato no aparece claro, escribe "REVISAR".`;

const GEMINI_FOLDER_INVOICE_PROMPT = `Quiero que analices todas las facturas visibles en esta carpeta, una por una, sin saltarte ninguna.

Objetivo:
Extraer todos y cada uno de los articulos comprados, con proveedor, fecha, numero de factura, cantidad, precio unitario e importe.

Reglas obligatorias:
1. Primero lista cuantas facturas/archivos detectas y sus nombres o numeros.
2. Procesa las facturas una por una.
3. No resumas articulos.
4. No agrupes articulos parecidos.
5. No cambies nombres importantes.
6. Conserva codigos de producto o variantes, por ejemplo B13, AL26, 62306, 67850.
7. Si un articulo dice "Smoothie B13 - 20 x 150g", el articulo debe ser "Smoothie B13".
8. Si un articulo dice "Croissant Masa Madre (40u)", conserva esa descripcion.
9. Si un articulo dice "Rebanada Pan Payes (18px5u)", conserva esa descripcion.
10. En facturas de Europastry, la columna "Precio" puede no ser el precio unitario real de compra. Usa "Importe" como importe de linea y calcula "Precio Unit." como Importe / Cantidad.
11. Si una factura tiene total final, base imponible o IGIC, indicalo en los campos de la seccion de esa factura.
12. Si tienes dudas con una linea, no la inventes: escribe REVISAR.
13. Si la respuesta es demasiado larga, divide automaticamente la salida en varias partes consecutivas: PARTE 1, PARTE 2, PARTE 3, etc.
14. No me preguntes si quiero continuar. Continua directamente con la siguiente parte siempre que la plataforma te lo permita.
15. No repitas facturas ya procesadas entre partes.
16. Si por limite tecnico no puedes continuar, termina exactamente con: CONTINUAR DESDE: [nombre de la ultima factura pendiente].

Formato obligatorio para cada factura:

### Factura detectada

**Proveedor:** 
**Fecha:** 
**Factura:** 
**Archivo:** 
**Total factura:** 
**Base imponible:** 
**IGIC:** 

| Proveedor | Fecha | Factura | Articulo | Cant. | Precio Unit. | Importe |
| :-------- | :---- | :------ | :------- | :---- | :----------- | :------ |
| ... | ... | ... | ... | ... | ... | ... |

Despues de procesar todas las facturas, anade esta seccion final:

### Control final
Facturas detectadas:
Facturas procesadas:
Facturas con dudas:
Facturas posiblemente duplicadas:
Total general:
Observaciones:`;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatIsoDateEs(value = '') {
  if (!value || !String(value).includes('-')) return value || '';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function getTransactionDateObject(tx = {}) {
  if (tx.createdAt) {
    const parsed = new Date(tx.createdAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const [datePart = '', timePart = '00:00'] = String(tx.date || '').split(', ');
  const [day, month, year] = datePart.split('/').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const parsed = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function getTransactionDayKey(tx = {}) {
  const date = getTransactionDateObject(tx);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTransactionDayLabel(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const todayKey = getTransactionDayKey({ createdAt: new Date().toISOString() });
  const label = date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  return dayKey === todayKey ? `Hoy · ${label}` : label;
}

function getPaymentBreakdown(tx = {}) {
  if (Array.isArray(tx.payments) && tx.payments.length > 0) {
    return tx.payments
      .map(payment => ({
        method: payment.method || tx.paymentMethod || 'Pago',
        amount: Number(payment.amount || 0),
        provider: payment.provider || ''
      }))
      .filter(payment => payment.amount > 0 || payment.method);
  }

  return [{
    method: tx.paymentMethod || 'Pago',
    amount: Number(tx.total || 0),
    provider: String(tx.paymentMethod || '').toLowerCase().includes('tarjeta') ? 'BBVA' : ''
  }];
}

function summarizePayments(tx = {}) {
  const payments = getPaymentBreakdown(tx);
  const count = payments.length;
  const byMethod = payments.reduce((acc, payment) => {
    const method = payment.method || 'Pago';
    if (!acc[method]) acc[method] = { count: 0, amount: 0 };
    acc[method].count += 1;
    acc[method].amount += Number(payment.amount || 0);
    return acc;
  }, {});
  const parts = Object.entries(byMethod).map(([method, info]) =>
    `${info.count} ${method}${info.amount > 0 ? ` (${info.amount.toFixed(2)}€)` : ''}`
  );

  return {
    count,
    summary: count > 1 ? `${count} pagos: ${parts.join(' · ')}` : (payments[0]?.method || tx.paymentMethod || ''),
    rows: payments
  };
}

// ─────────────────────────────────────────
// Toast notification system
// ─────────────────────────────────────────
function showToast(message, type = 'error') {
  const existing = document.getElementById('db-toast');
  if (existing) existing.remove();

  let icon = '✓';
  if (type === 'error' || type === 'warning') icon = '⚠';
  else if (type === 'info') icon = 'ℹ';

  const toast = document.createElement('div');
  toast.id = 'db-toast';
  toast.className = `db-toast db-toast--${type}`;
  toast.innerHTML = `
    <span class="db-toast-icon">${icon}</span>
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

async function loadLoyaltyAdminCustomers({ keepSelection = true } = {}) {
  if (!isLoyaltyConfigured) {
    loyaltyAdminError = 'Falta configurar la conexion con fidelidad.';
    render(store.state);
    return;
  }

  loyaltyAdminLoading = true;
  loyaltyAdminError = '';
  render(store.state);

  try {
    const [dashboard, customers] = await Promise.all([
      getLoyaltyDashboard(),
      searchLoyaltyCustomers(loyaltyAdminQuery)
    ]);
    loyaltyAdminDashboard = dashboard;
    loyaltyAdminCustomers = customers;
    if (keepSelection && loyaltyAdminSelectedCustomer) {
      loyaltyAdminSelectedCustomer = loyaltyAdminCustomers.find(customer => customer.id === loyaltyAdminSelectedCustomer.id) || loyaltyAdminSelectedCustomer;
    } else {
      loyaltyAdminSelectedCustomer = null;
      loyaltyAdminPurchases = [];
    }
  } catch (error) {
    loyaltyAdminError = error.message || 'No se pudieron cargar los clientes.';
  } finally {
    loyaltyAdminLoading = false;
    render(store.state);
  }
}

async function loadLoyaltyAdminOverview() {
  if (!isLoyaltyConfigured) return;
  loyaltyAdminLoading = true;
  loyaltyAdminError = '';
  render(store.state);
  try {
    loyaltyAdminOverview = await getLoyaltyAdminOverview();
    loyaltyAdminDashboard = loyaltyAdminOverview;
  } catch (error) {
    loyaltyAdminError = error.message || 'No se pudo cargar el resumen de fidelidad.';
  } finally {
    loyaltyAdminLoading = false;
    render(store.state);
  }
}

async function loadLoyaltyAdminPromos() {
  if (!isLoyaltyConfigured) return;
  loyaltyAdminLoading = true;
  loyaltyAdminError = '';
  render(store.state);
  try {
    loyaltyAdminPromos = await listLoyaltyPromos();
  } catch (error) {
    loyaltyAdminError = error.message || 'No se pudieron cargar las promos.';
  } finally {
    loyaltyAdminLoading = false;
    render(store.state);
  }
}

async function loadLoyaltyAdminVouchers() {
  if (!isLoyaltyConfigured) return;
  loyaltyAdminLoading = true;
  loyaltyAdminError = '';
  render(store.state);
  try {
    loyaltyAdminVouchers = await listPendingLoyaltyVouchers();
  } catch (error) {
    loyaltyAdminError = error.message || 'No se pudieron cargar los canjes.';
  } finally {
    loyaltyAdminLoading = false;
    render(store.state);
  }
}

async function refreshLoyaltyAdminCurrentTab({ keepSelection = true } = {}) {
  if (loyaltyAdminTab === 'resumen') {
    await loadLoyaltyAdminOverview();
  } else if (loyaltyAdminTab === 'promos') {
    await loadLoyaltyAdminPromos();
  } else if (loyaltyAdminTab === 'canjes') {
    await loadLoyaltyAdminVouchers();
  } else {
    await loadLoyaltyAdminCustomers({ keepSelection });
  }
}

async function selectLoyaltyAdminCustomer(customerId) {
  const customer = loyaltyAdminCustomers.find(item => String(item.id) === String(customerId));
  if (!customer) return;

  loyaltyAdminSelectedCustomer = customer;
  loyaltyAdminPurchases = [];
  loyaltyAdminError = '';
  render(store.state);

  try {
    loyaltyAdminPurchases = await getLoyaltyCustomerPurchases(customer.id);
  } catch (error) {
    loyaltyAdminError = error.message || 'No se pudieron cargar las compras del cliente.';
  }
  render(store.state);
}

function showCreateLoyaltyCustomerModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'create-loyalty-customer-modal';
  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 440px; width: 94%; padding: 20px;">
      <div class="modal-header" style="border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:16px;">
        <h3>Nuevo cliente fidelidad</h3>
        <button class="modal-close-btn" id="loyalty-create-close-btn" aria-label="Cerrar">&times;</button>
      </div>
      <form id="loyalty-create-form" style="display:grid; gap:14px;">
        <div class="editor-form-group">
          <label class="editor-form-label">Nombre</label>
          <input class="editor-form-input" id="loyalty-create-name" autocomplete="off" required>
        </div>
        <div class="editor-form-group">
          <label class="editor-form-label">Email</label>
          <input class="editor-form-input" id="loyalty-create-email" type="email" autocomplete="off">
        </div>
        <div class="editor-form-group">
          <label class="editor-form-label">Teléfono</label>
          <input class="editor-form-input" id="loyalty-create-phone" inputmode="tel" autocomplete="off">
        </div>
        <div class="editor-form-group">
          <label class="editor-form-label">RFID</label>
          <input class="editor-form-input" id="loyalty-create-rfid" autocomplete="off" placeholder="Opcional">
        </div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-color); padding-top:14px;">
          <button type="button" class="btn btn-secondary" id="loyalty-create-cancel-btn" style="height:42px;">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="loyalty-create-save-btn" style="height:42px; background:var(--secondary); border-color:var(--secondary); color:white;">Crear</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#loyalty-create-close-btn').addEventListener('click', close);
  modal.querySelector('#loyalty-create-cancel-btn').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  modal.querySelector('#loyalty-create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveBtn = modal.querySelector('#loyalty-create-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creando...';
    try {
      const customer = await createLoyaltyCustomer({
        name: modal.querySelector('#loyalty-create-name')?.value,
        email: modal.querySelector('#loyalty-create-email')?.value,
        phone: modal.querySelector('#loyalty-create-phone')?.value,
        rfidUid: modal.querySelector('#loyalty-create-rfid')?.value
      });
      loyaltyAdminQuery = customer?.name || '';
      close();
      await loadLoyaltyAdminCustomers({ keepSelection: false });
      if (customer?.id) await selectLoyaltyAdminCustomer(customer.id);
      showToast('Cliente creado en fidelidad.', 'success');
    } catch (error) {
      console.error('[Fidelidad] Error creando cliente', error);
      showToast(error.message || error.details || 'No se pudo crear el cliente.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Crear';
    }
  });
  setTimeout(() => modal.querySelector('#loyalty-create-name')?.focus(), 50);
}

function showEditLoyaltyCustomerModal(customer) {
  if (!customer) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 440px; width: 94%; padding: 20px;">
      <div class="modal-header" style="border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:16px;">
        <h3>Editar cliente</h3>
        <button class="modal-close-btn" id="loyalty-edit-close-btn" aria-label="Cerrar">&times;</button>
      </div>
      <form id="loyalty-edit-form" style="display:grid; gap:14px;">
        <div class="editor-form-group"><label class="editor-form-label">Nombre</label><input class="editor-form-input" id="loyalty-edit-name" value="${escapeHtml(customer.name)}" required></div>
        <div class="editor-form-group"><label class="editor-form-label">Email</label><input class="editor-form-input" id="loyalty-edit-email" type="email" value="${escapeHtml(customer.email)}"></div>
        <div class="editor-form-group"><label class="editor-form-label">Teléfono</label><input class="editor-form-input" id="loyalty-edit-phone" inputmode="tel" value="${escapeHtml(customer.phone)}"></div>
        <div class="editor-form-group"><label class="editor-form-label">RFID</label><input class="editor-form-input" id="loyalty-edit-rfid" value="${escapeHtml(customer.rfidUid)}"></div>
        <div class="editor-form-group"><label class="editor-form-label">Puntos</label><input class="editor-form-input" id="loyalty-edit-points" type="number" min="0" step="1" value="${customer.points}"></div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-color); padding-top:14px;">
          <button type="button" class="btn btn-secondary" id="loyalty-edit-cancel-btn" style="height:42px;">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="loyalty-edit-save-btn" style="height:42px; background:var(--secondary); border-color:var(--secondary); color:white;">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#loyalty-edit-close-btn').addEventListener('click', close);
  modal.querySelector('#loyalty-edit-cancel-btn').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  modal.querySelector('#loyalty-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveBtn = modal.querySelector('#loyalty-edit-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    try {
      const updated = await updateLoyaltyCustomer({
        id: customer.id,
        name: modal.querySelector('#loyalty-edit-name')?.value,
        email: modal.querySelector('#loyalty-edit-email')?.value,
        phone: modal.querySelector('#loyalty-edit-phone')?.value,
        rfidUid: modal.querySelector('#loyalty-edit-rfid')?.value,
        points: modal.querySelector('#loyalty-edit-points')?.value
      });
      close();
      await loadLoyaltyAdminCustomers({ keepSelection: false });
      await selectLoyaltyAdminCustomer(updated.id);
      showToast('Cliente actualizado.', 'success');
    } catch (error) {
      console.error('[Fidelidad] Error editando cliente', error);
      showToast(error.message || 'No se pudo guardar el cliente.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
    }
  });
}

function showLoyaltyPromoModal(promo = null) {
  const isNew = !promo?.id;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 460px; width: 94%; padding: 20px;">
      <div class="modal-header" style="border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:16px;">
        <h3>${isNew ? 'Nueva promo' : 'Editar promo'}</h3>
        <button class="modal-close-btn" id="loyalty-promo-close-btn" aria-label="Cerrar">&times;</button>
      </div>
      <form id="loyalty-promo-form" style="display:grid; gap:14px;">
        <div class="editor-form-group"><label class="editor-form-label">Título</label><input class="editor-form-input" id="loyalty-promo-title" value="${escapeHtml(promo?.title || '')}" required></div>
        <div class="editor-form-group"><label class="editor-form-label">Descripción</label><textarea class="editor-form-input" id="loyalty-promo-description" rows="3">${escapeHtml(promo?.description || '')}</textarea></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="editor-form-group"><label class="editor-form-label">Etiqueta</label><input class="editor-form-input" id="loyalty-promo-tag" value="${escapeHtml(promo?.tag || '')}"></div>
          <div class="editor-form-group"><label class="editor-form-label">Tipo</label><select class="editor-form-input" id="loyalty-promo-type">
            ${['discount','deal','birthday','redeem'].map(type => `<option value="${type}" ${promo?.type === type ? 'selected' : ''}>${type}</option>`).join('')}
          </select></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="editor-form-group"><label class="editor-form-label">Puntos</label><input class="editor-form-input" id="loyalty-promo-points" type="number" min="0" step="1" value="${promo?.pointsRequired || 0}"></div>
          <div class="editor-form-group"><label class="editor-form-label">Caducidad</label><input class="editor-form-input" id="loyalty-promo-expiry" type="date" value="${escapeHtml((promo?.expiry || '').slice(0, 10))}"></div>
        </div>
        <label class="staff-active-toggle"><input type="checkbox" id="loyalty-promo-active" ${promo?.active !== false ? 'checked' : ''}><span>Promo activa</span></label>
        <label class="staff-active-toggle"><input type="checkbox" id="loyalty-promo-hidden" ${promo?.hidden ? 'checked' : ''}><span>Ocultar en la app de clientes</span></label>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-color); padding-top:14px;">
          <button type="button" class="btn btn-secondary" id="loyalty-promo-cancel-btn" style="height:42px;">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="loyalty-promo-save-btn" style="height:42px; background:var(--secondary); border-color:var(--secondary); color:white;">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#loyalty-promo-close-btn').addEventListener('click', close);
  modal.querySelector('#loyalty-promo-cancel-btn').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  modal.querySelector('#loyalty-promo-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveBtn = modal.querySelector('#loyalty-promo-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    try {
      await saveLoyaltyPromo({
        id: promo?.id || null,
        title: modal.querySelector('#loyalty-promo-title')?.value,
        description: modal.querySelector('#loyalty-promo-description')?.value,
        tag: modal.querySelector('#loyalty-promo-tag')?.value,
        type: modal.querySelector('#loyalty-promo-type')?.value,
        pointsRequired: modal.querySelector('#loyalty-promo-points')?.value,
        expiry: modal.querySelector('#loyalty-promo-expiry')?.value,
        active: modal.querySelector('#loyalty-promo-active')?.checked,
        hidden: modal.querySelector('#loyalty-promo-hidden')?.checked
      });
      close();
      await loadLoyaltyAdminPromos();
      showToast('Promo guardada.', 'success');
    } catch (error) {
      console.error('[Fidelidad] Error guardando promo', error);
      showToast(error.message || 'No se pudo guardar la promo.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
    }
  });
}

// 1. Header component renderer
function renderHeader(state) {
  const table = store.getSelectedTable();
  const title = state.activeTab === 'mesas' ? 'Mesas' : table ? table.name : 'Selecciona una mesa';
  const roleLabel = store.getRoleLabel();
  const staffName = state.auth.profile?.display_name || 'Usuario';

  const dbDot = dbStatus === 'connected'
    ? '<div class="status-dot" title="Base de Datos conectada"></div>'
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
        <button class="staff-session-btn" id="staff-session-btn" title="Cerrar sesion">
          <span class="staff-session-name">${staffName}</span>
          <span class="staff-session-role">${roleLabel}</span>
        </button>
        <div class="status-badge">
          ${dbDot}
          <span>${dbStatus === 'connected' ? 'Base de Datos' : dbStatus === 'fallback' ? 'Sin BD' : 'Comandero'}</span>
        </div>
      </div>
    </header>
  `;
}

// 2. Bottom Navbar renderer (MESAS, COMANDA, TRANSACCIONES, AJUSTES)
function renderNavbar(state) {
  const activeItems = store.getActiveItems();
  const ticketCount = activeItems.reduce((sum, item) => sum + item.qty, 0);
  const settingsItem = store.canAccessSettings() ? `
        <button class="bottom-nav__item ${state.activeTab === 'ajustes' ? 'is-active' : ''}" data-tab="ajustes">
          ${ICONS.ajustes}
          <span class="bottom-nav__label">AJUSTES</span>
        </button>
  ` : '';

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
        ${settingsItem}
      </div>
    </nav>
  `;
}

function renderAuthView(state) {
  const isDisabled = state.auth.isLoading ? 'disabled' : '';
  return `
    <section class="auth-screen">
      <form class="auth-card" id="staff-login-form">
        <div class="auth-brand">
          ${ICONS.coffee}
          <h1>Esencia TPV</h1>
        </div>
        <div class="auth-copy">
          <h2>Acceso de personal</h2>
          <p>Introduce tu codigo de 4 a 8 digitos para abrir tu sesion.</p>
        </div>
        <input id="staff-pin-input" class="pin-hidden-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" required ${isDisabled}>
        <div class="pin-dots" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="pin-keypad">
          ${[1,2,3,4,5,6,7,8,9].map(num => `<button type="button" class="pin-key" data-pin-key="${num}" ${isDisabled}>${num}</button>`).join('')}
          <button type="button" class="pin-key pin-key--ghost" data-pin-clear ${isDisabled}>C</button>
          <button type="button" class="pin-key" data-pin-key="0" ${isDisabled}>0</button>
          <button type="button" class="pin-key pin-key--ghost" data-pin-back ${isDisabled}>DEL</button>
        </div>
        <button class="auth-submit-btn" type="submit" ${isDisabled}>
          ${state.auth.isLoading ? 'Entrando...' : 'Entrar'}
        </button>
        <p class="auth-note">Los perfiles y codigos se gestionan desde Ajustes > Personal. Mínimo 4, máximo 8 dígitos.</p>
      </form>
    </section>
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
  const visibleSlots = state.isEditingGrid
    ? Math.max(items.length + 3, isNested ? 8 : 9)
    : Math.max(items.length, isNested ? 8 : 9);

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
  for (let slotIndex = 0; slotIndex < visibleSlots; slotIndex++) {
    const item = items[slotIndex];

    if (!item) {
      // Empty slot placeholder
      if (state.isEditingGrid) {
        gridHTML.push(`
          <div class="grid-card placeholder-card editable-placeholder" data-add-slot="${slotIndex}" data-grid-key="${currentKey}">
            <span style="font-size: 1.6rem; font-weight: bold; color: var(--text-muted);">+</span>
          </div>
        `);
      } else if (slotIndex < 9) {
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
  const grouped = (state.transactions || []).reduce((groups, tx) => {
    const dayKey = getTransactionDayKey(tx);
    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(tx);
    return groups;
  }, {});

  const daySections = Object.entries(grouped)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dayKey, transactions]) => {
      const dayTotal = transactions.reduce((sum, tx) => sum + Number(tx.total || 0), 0);
      const rows = transactions.map(tx => {
        const isRefund = tx.type === 'refund';
        const badge = isRefund
          ? `<span class="badge badge--danger" style="margin-left: 8px;">Devolución</span>`
          : tx.hasRefund
          ? `<span class="badge badge--warning" style="margin-left: 8px;">Devuelta parcial</span>`
          : '';
        const paymentSummary = summarizePayments(tx);

        return `
          <button class="tx-card" data-transaction-id="${tx.id}">
            <div class="tx-meta">
              <span class="tx-table-name">${tx.table} ${badge}</span>
              <span class="tx-date-method">${tx.date} · ${paymentSummary.summary}</span>
            </div>
            <div class="tx-financial">
              <span class="tx-amount ${isRefund ? 'text-danger' : ''}" style="${isRefund ? 'color: var(--danger); font-weight: 700;' : ''}">${Number(tx.total || 0).toFixed(2)}€</span>
              <div class="tx-qty">${tx.itemsCount} art.</div>
            </div>
          </button>
        `;
      }).join('');

      return `
        <section class="tx-day-group">
          <div class="tx-day-header">
            <span>${formatTransactionDayLabel(dayKey)}</span>
            <strong>${transactions.length} ticket${transactions.length !== 1 ? 's' : ''} · ${dayTotal.toFixed(2)}€</strong>
          </div>
          ${rows}
        </section>
      `;
    }).join('');

  return `
    <div class="tx-list-container">
      <h2 class="tx-header">Historial de Ventas</h2>
      <div class="tx-history-list">
        ${daySections.length > 0 ? daySections : '<p style="text-align:center; padding: 40px; color: var(--text-muted);">Aún no hay transacciones cobradas</p>'}
      </div>
    </div>
  `;

  const rows = state.transactions.map(tx => {
    const isRefund = tx.type === 'refund';
    const badge = isRefund
      ? `<span class="badge badge--danger" style="margin-left: 8px;">Devolución</span>`
      : tx.hasRefund
      ? `<span class="badge badge--warning" style="margin-left: 8px;">Devuelta parcial</span>`
      : '';

    return `
      <button class="tx-card" data-transaction-id="${tx.id}">
        <div class="tx-meta">
          <span class="tx-table-name">${tx.table} ${badge}</span>
          <span class="tx-date-method">${tx.date} • ${tx.paymentMethod}</span>
        </div>
        <div class="tx-financial">
          <span class="tx-amount ${isRefund ? 'text-danger' : ''}" style="${isRefund ? 'color: var(--danger); font-weight: 700;' : ''}">${tx.total.toFixed(2)}€</span>
          <div class="tx-qty">${tx.itemsCount} art.</div>
        </div>
      </button>
    `;
  }).join('');

  return `
    <div class="tx-list-container">
      <h2 class="tx-header">Historial de Ventas</h2>
      <div class="tx-history-list">
        ${rows.length > 0 ? rows : '<p style="text-align:center; padding: 40px; color: var(--text-muted);">Aún no hay transacciones cobradas hoy</p>'}
      </div>
    </div>
  `;
}

async function showReceiptQrModal(transactionId) {
  const tx = store.ensureTransactionReceiptToken(transactionId);
  if (!tx?.receiptToken) {
    showToast('No se pudo generar el enlace del ticket.', 'error');
    return;
  }
  const txDisplayNumber = tx.fiscalData?.fiscalNumber || tx.id;

  const ticketUrl = new URL(`ticket.html?t=${encodeURIComponent(tx.receiptToken)}`, window.location.href).href;
  let qrDataUrl = '';

  try {
    qrDataUrl = await QRCode.toDataURL(ticketUrl, {
      width: 280,
      margin: 1,
      color: {
        dark: '#111111',
        light: '#ffffff'
      }
    });
  } catch (err) {
    showToast('No se pudo generar el QR del ticket.', 'error');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-dialog receipt-qr-dialog">
      <div class="modal-header">
        <h3>Ticket para cliente</h3>
        <button class="modal-close-btn tx-detail-close-btn" id="receipt-qr-close-btn" aria-label="Cerrar QR">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div class="receipt-qr-body">
        <img class="receipt-qr-image" src="${qrDataUrl}" alt="QR del ticket ${txDisplayNumber}">
        <div class="receipt-qr-meta">
          <strong>${txDisplayNumber}</strong>
          <span>${tx.date} • ${Number(tx.total || 0).toFixed(2)}€</span>
        </div>
        <p>El cliente puede escanear este QR para ver el ticket en su móvil y descargarlo si lo necesita.</p>
        <button class="pay-btn-opt" id="receipt-copy-link-btn">Copiar enlace</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('#receipt-qr-close-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('#receipt-copy-link-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ticketUrl);
      showToast('Enlace del ticket copiado.', 'success');
    } catch (err) {
      window.prompt('Copia el enlace del ticket:', ticketUrl);
    }
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.remove();
  });
}

function showTransactionDetailModal(transactionId) {
  const tx = store.state.transactions.find(item => item.id === transactionId);
  if (!tx) return;

  const total = Number(tx.total || 0);
  const fiscal = tx.fiscalData || null;
  const txDisplayNumber = fiscal?.fiscalNumber || tx.id;
  const legal = tx.legalData || {
    businessName: "Esencia Café",
    companyName: "Esencia Café S.L.",
    nif: "B-87654321",
    address: "Calle del Grano 12, 38001 Santa Cruz de Tenerife",
    taxName: "IGIC",
    taxRate: 7
  };
  const taxRate = Number(legal.taxRate || 0);
  const taxName = legal.taxName || "IGIC";
  const baseImponible = total / (1 + (taxRate / 100));
  const cuotaImpuesto = total - baseImponible;
  const paymentSummary = summarizePayments(tx);
  const paymentRowsHTML = paymentSummary.rows.map((payment, index) => `
    <div class="tx-detail-payment-row">
      <span>Pago ${index + 1} · ${payment.method}${payment.provider ? ` · ${payment.provider}` : ''}</span>
      <strong>${Number(payment.amount || 0).toFixed(2)}€</strong>
    </div>
  `).join('');

  const items = Array.isArray(tx.items) ? tx.items : [];
  const itemsHTML = items.length > 0 ? items.map(item => `
    <div class="tx-detail-item">
      <div class="tx-detail-item-main">
        <div>
          <span class="tx-detail-item-name">${item.name}</span>
          <span class="tx-detail-item-unit">${Number(item.price || 0).toFixed(2)}€ x ud.</span>
          ${(item.selectedOptions || []).length > 0 ? `
            <div class="tx-detail-options">
              ${(item.selectedOptions || []).map(opt => `
                <div class="tx-detail-option-row">
                  <span>+ ${opt.name} (x${opt.qty})</span>
                  <span>+${(Number(opt.price || 0) * Number(opt.qty || 1)).toFixed(2)}€</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${item.note ? `<div class="tx-detail-note">Nota: ${escapeHtml(item.note)}</div>` : ''}
        </div>
        <span class="tx-detail-qty">x${item.qty}</span>
      </div>
      <strong>${Number(item.total || 0).toFixed(2)}€</strong>
    </div>
  `).join('') : `
    <div class="tx-detail-empty">
      Esta transacción se registró antes de guardar el detalle de artículos.
    </div>
  `;

  // Refund block elements
  let refundStatusHTML = '';
  if (tx.type === 'refund') {
    refundStatusHTML = `
      <div style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--border-radius-sm); padding: 10px; margin-bottom: 12px; font-size: 0.85rem; color: var(--danger);">
        <strong>Tipo: Devolución</strong><br>
        <span>Devolución del ticket: ${tx.parentId}</span><br>
        ${tx.reason ? `<span>Motivo: ${tx.reason}</span>` : ''}
      </div>
    `;
  } else if (tx.hasRefund) {
    refundStatusHTML = `
      <div style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: var(--border-radius-sm); padding: 10px; margin-bottom: 12px; font-size: 0.85rem; color: #f59e0b;">
        <strong>Estado: Devuelto</strong><br>
        <span>Importe devuelto: ${tx.refundAmount.toFixed(2)}€</span>
      </div>
    `;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-dialog tx-detail-dialog">
      <div class="modal-header" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
          <h3 style="margin:0;">Factura Simplificada</h3>
          <button class="modal-close-btn tx-detail-close-btn" id="tx-detail-close-btn" aria-label="Cerrar detalle" style="margin:0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div class="tx-detail-emitter" style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
          <strong>${legal.businessName || 'Esencia Café'}</strong><br>
          ${legal.companyName || 'Esencia Café S.L.'} · NIF: ${legal.nif || 'B-87654321'}<br>
          ${legal.address || 'Calle del Grano 12, 38001 Santa Cruz de Tenerife'}
        </div>
      </div>
      <div class="tx-detail-body">
        ${refundStatusHTML}
        <div class="tx-detail-summary">
          <div>
            <span>Factura Nº</span>
            <strong>${txDisplayNumber}</strong>
          </div>
          ${fiscal?.hash ? `
            <div>
              <span>Ref. fiscal</span>
              <strong>${fiscal.hash.slice(0, 12)}</strong>
            </div>
          ` : ''}
          <div>
            <span>Fecha</span>
            <strong>${tx.date}</strong>
          </div>
          <div>
            <span>Método de pago</span>
            <strong>${paymentSummary.summary}</strong>
          </div>
          <div>
            <span>Art&iacute;culos</span>
            <strong>${tx.itemsCount} art.</strong>
          </div>
        </div>
        <div class="tx-detail-list">
          ${itemsHTML}
        </div>

        ${paymentSummary.count > 1 ? `
          <div class="tx-detail-payments">
            <div class="tx-detail-section-title">Desglose de cobro</div>
            ${paymentRowsHTML}
          </div>
        ` : ''}
        
        <div class="tx-detail-tax-breakdown" style="padding: 12px 0; border-bottom: 1px dashed var(--border-color); display: grid; gap: 6px; font-size: 0.85rem; color: var(--text-muted);">
          <div style="display:flex; justify-content:space-between;">
            <span>Base Imponible (${taxRate}%)</span>
            <strong>${baseImponible.toFixed(2)}€</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>${taxName} (${taxRate}% Incluido)</span>
            <strong>${cuotaImpuesto.toFixed(2)}€</strong>
          </div>
        </div>

        <div class="tx-detail-total">
          <span>${tx.type === 'refund' ? 'Total devuelto' : 'Total cobrado'}</span>
          <strong class="${tx.type === 'refund' ? 'text-danger' : ''}">${total.toFixed(2)}€</strong>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button class="pay-btn-opt primary tx-detail-share-btn" id="tx-detail-share-btn" style="height: 40px; font-size: 0.9rem;">
            Mostrar QR del ticket
          </button>
          ${(!tx.hasRefund && tx.type !== 'refund' && store.canIssueRefunds()) ? `
            <button class="pay-btn-opt danger tx-detail-refund-btn" id="tx-detail-refund-btn" style="height: 40px; font-size: 0.9rem; margin: 0;">
              Registrar Devolución
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('#tx-detail-close-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('#tx-detail-share-btn').addEventListener('click', () => {
    showReceiptQrModal(tx.id);
  });
  
  const refundBtn = modal.querySelector('#tx-detail-refund-btn');
  if (refundBtn) {
    refundBtn.addEventListener('click', () => {
      modal.remove();
      showRefundModal(tx);
    });
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.remove();
  });
}

function showRefundModal(tx) {
  if (!store.canIssueRefunds()) {
    showToast('Solo administrador o encargado pueden registrar devoluciones.', 'error');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  
  modal.innerHTML = `
    <div class="modal-dialog refund-dialog" style="max-width: 400px; padding: 20px;">
      <div class="modal-header" style="padding-bottom: 12px; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0;">Registrar Devolución</h3>
        <button class="modal-close-btn" id="refund-close-btn" aria-label="Cerrar modal" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:20px; height:20px;">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div class="modal-body" style="padding: 16px 0 0 0; display: grid; gap: 16px;">
        <div>
          <span style="font-size: 0.8rem; color: var(--text-muted); text-transform:uppercase; font-weight:700;">Ticket Original:</span>
          <strong style="display: block; font-size: 1.05rem; color: var(--text-main); margin-top:4px;">${tx.id} (${tx.total.toFixed(2)}€)</strong>
        </div>
        <form id="refund-form" style="display: grid; gap: 16px; margin: 0;">
          <div class="editor-form-group">
            <label class="editor-form-label" style="font-weight:700;">Importe a Devolver (€)</label>
            <input type="number" step="0.01" min="0.01" max="${tx.total}" class="editor-form-input" id="refund-amount-input" value="${tx.total.toFixed(2)}" required style="width:100%; padding:10px; background:var(--bg-main); border:1px solid var(--border-color); border-radius:var(--border-radius-sm); color:var(--text-main); font-size:1.1rem; font-weight:700;">
          </div>
          <div class="editor-form-group">
            <label class="editor-form-label" style="font-weight:700;">Motivo de la Devolución (Opcional)</label>
            <textarea class="editor-form-input" id="refund-reason-input" rows="3" placeholder="Ej: Error en cobro, producto defectuoso, etc." style="width:100%; padding:10px; background:var(--bg-main); border:1px solid var(--border-color); border-radius:var(--border-radius-sm); color:var(--text-main); font-family:var(--font-family); resize:none; font-size:0.9rem;"></textarea>
          </div>
          <div style="display: flex; gap: 12px; margin-top: 8px;">
            <button type="button" class="btn btn-secondary" id="refund-cancel-btn" style="flex: 1; height: 44px; font-weight:700;">Cancelar</button>
            <button type="submit" class="btn btn-primary pay-btn-opt danger" style="flex: 1; height: 44px; margin:0; font-weight:700; color:white !important; display:flex; align-items:center; justify-content:center;">Confirmar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#refund-close-btn');
  const cancelBtn = modal.querySelector('#refund-cancel-btn');
  const form = modal.querySelector('#refund-form');

  const closeModal = () => modal.remove();
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat(modal.querySelector('#refund-amount-input').value);
    const reason = modal.querySelector('#refund-reason-input').value.trim();

    if (isNaN(amount) || amount <= 0 || amount > tx.total) {
      showToast('Por favor, introduce un importe válido de devolución.', 'error');
      return;
    }

    const result = store.registerRefund({
      parentTransactionId: tx.id,
      amount: amount,
      reason: reason
    });

    if (result) {
      closeModal();
      showToast('Devolución registrada correctamente.', 'success');
    } else {
      showToast('Error al registrar la devolución.', 'error');
    }
  });
}

// 8. Ajustes View
function renderAjustesView(state) {
  const path = state.settingsPath;

  // Icons
  const chevron = `<svg class="settings-tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>`;
  const backArrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:18px; height:18px;"><path d="m15 18-6-6 6-6"/></svg>`;
  const firstPath = path[0];
  const restrictedSettingsPath =
    (firstPath === 'articulos' && !store.canManageCatalog()) ||
    (firstPath === 'legal' && !store.canManageAccounting()) ||
    (firstPath === 'compras' && !store.canManageAccounting()) ||
    (firstPath === 'fidelidad' && !store.canManageLoyalty()) ||
    (firstPath === 'informes' && !store.canViewReports()) ||
    (firstPath === 'cierre' && !store.canCloseCash()) ||
    (firstPath === 'staff' && !store.canManageStaff());

  if (restrictedSettingsPath) {
    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
        </div>
        <div class="settings-editor-container">
          <h2 class="settings-nav-title">Sin permiso</h2>
          <p class="gemini-muted">Tu perfil no tiene acceso a este apartado.</p>
        </div>
      </div>
    `;
  }

  if (path.length === 0) {
    // 1. Root Settings Menu
    const tablesOptions = state.tables.map(t => {
      const isSelected = state.selectedTableId === t.id;
      return `<option value="${t.id}" ${isSelected ? 'selected' : ''}>${t.name} (${t.status === 'occupied' ? 'Ocupada' : t.status === 'pending-bill' ? 'Cuenta' : 'Libre'})</option>`;
    }).join('');

    const shiftSummary = store.getActiveShiftSummary();
    const shiftSinceText = shiftSummary.lastClosure?.closedAt
      ? `Desde ${new Date(shiftSummary.lastClosure.closedAt).toLocaleString('es-ES')}`
      : 'Desde el inicio';
    const settingsMenuItems = [
      store.canManageCatalog() ? `
          <button class="settings-tree-item" id="settings-to-articulos">
            <span>Art&iacute;culos</span>
            ${chevron}
          </button>` : '',
      store.canManageAccounting() ? `
          <button class="settings-tree-item" id="settings-to-legal">
            <span>Datos Fiscales</span>
            ${chevron}
          </button>` : '',
      store.canViewReports() ? `
          <button class="settings-tree-item" id="settings-to-informes">
            <span>Informes y Ventas</span>
            ${chevron}
          </button>` : '',
      store.canCloseCash() ? `
          <button class="settings-tree-item" id="settings-to-cierre">
            <span>Cierre de Caja</span>
            ${chevron}
          </button>` : '',
      store.canManageAccounting() ? `
          <button class="settings-tree-item" id="settings-to-compras">
            <span>Compras y Facturas</span>
            ${chevron}
          </button>` : '',
      store.canManageLoyalty() ? `
          <button class="settings-tree-item" id="settings-to-fidelidad">
            <span>Fidelidad</span>
            ${chevron}
          </button>` : '',
      store.canManageStaff() ? `
          <button class="settings-tree-item" id="settings-to-staff">
            <span>Personal y PIN</span>
            ${chevron}
          </button>` : ''
    ].join('');

    return `
      <div class="view-container">
        <h2 class="settings-nav-title">Ajustes</h2>
        <div class="settings-tree-list">
          ${settingsMenuItems}
          <div style="display:none;">
          <button class="settings-tree-item" id="settings-to-articulos">
            <span>Art&iacute;culos</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-legal">
            <span>Datos Fiscales</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-informes">
            <span>Informes y Ventas</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-cierre">
            <span>Cierre de Caja</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-compras">
            <span>Compras y Facturas</span>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-fidelidad">
            <span>Fidelidad</span>
            ${chevron}
          </button>
          ${store.canManageStaff() ? `
            <button class="settings-tree-item" id="settings-to-staff">
              <span>Personal y PIN</span>
              ${chevron}
            </button>
          ` : ''}
          </div>
          
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
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Elige la apariencia de la aplicación</div>
              </div>
              <div class="theme-select-group">
                <button class="theme-btn-opt ${state.theme === 'light' ? 'active' : ''}" data-theme="light">Claro</button>
                <button class="theme-btn-opt ${state.theme === 'dark' ? 'active' : ''}" data-theme="dark">Oscuro</button>
                <button class="theme-btn-opt ${state.theme === 'system' ? 'active' : ''}" data-theme="system">Sistema</button>
              </div>
            </div>

            <div class="settings-row" style="padding: 12px 0; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="settings-row-title" style="font-weight:600;">Resumen de Turno</div>
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${shiftSinceText} &middot; ${shiftSummary.tickets} tickets</div>
              </div>
              <span style="font-weight:700; font-size:1.1rem; color:var(--secondary);">${shiftSummary.net.toFixed(2)}&euro;</span>
            </div>

            <div class="settings-row" style="padding: 12px 0; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; opacity:0.5;">
              <div>
                <div class="settings-row-title" style="font-weight:600;">Impresoras</div>
                <div class="settings-row-desc" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Ninguna impresora vinculada</div>
              </div>
              ${chevron}
            </div>

            <div class="settings-row" style="padding: 16px 0; display:${store.canResetTerminal() ? 'flex' : 'none'}; justify-content:space-between; align-items:center;">
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

  if (path.length === 1 && path[0] === 'compras') {
    const selectedMonth = state.selectedReportMonth || new Date().toISOString().slice(0, 7);
    const summary = store.getAccountingSummary(selectedMonth);
    const monthInvoices = state.supplierInvoices
      .filter(invoice => (invoice.invoiceDate || '').slice(0, 7) === selectedMonth)
      .sort((a, b) => (b.invoiceDate || '').localeCompare(a.invoiceDate || ''));

    const rows = monthInvoices.map(invoice => `
      <button class="purchase-row" data-edit-invoice-id="${invoice.id}">
        <div>
          <strong>${invoice.supplierName}</strong>
          <span>${invoice.invoiceDate || ''} · ${invoice.invoiceNumber || 'Sin numero'} · ${invoice.deductible === false ? 'No deducible' : 'Deducible'}</span>
        </div>
        <div class="purchase-row-amount">
          <strong>${Number(invoice.totalAmount || 0).toFixed(2)}€</strong>
          <span>IGIC ${Number(invoice.taxAmount || 0).toFixed(2)}€</span>
        </div>
      </button>
    `).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
          <button class="btn btn-primary" id="settings-create-invoice-btn" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary);">
            Nueva
          </button>
          <button class="btn btn-secondary" id="settings-import-gemini-btn" style="height:36px; padding:0 12px; font-size:0.85rem;">
            Importar Gemini
          </button>
        </div>
        <h2 class="settings-nav-title">Compras y Facturas</h2>
        <div class="accounting-month-bar">
          <label>Mes</label>
          <input type="month" id="accounting-month-input" value="${selectedMonth}">
        </div>
        <div class="accounting-summary-grid">
          <div><span>Facturado</span><strong>${summary.sales.total.toFixed(2)}€</strong></div>
          <div><span>IGIC ventas</span><strong>${summary.sales.tax.toFixed(2)}€</strong></div>
          <div><span>Compras</span><strong>${summary.purchases.total.toFixed(2)}€</strong></div>
          <div><span>IGIC compras</span><strong>${summary.purchases.deductibleTax.toFixed(2)}€</strong></div>
          <div class="${summary.estimatedIgicDue < 0 ? 'is-credit' : 'is-due'}">
            <span>${summary.estimatedIgicDue < 0 ? 'A compensar' : 'IGIC estimado'}</span>
            <strong>${summary.estimatedIgicDue.toFixed(2)}€</strong>
          </div>
        </div>
        <div class="purchase-list">
          ${rows || '<p style="padding:24px; text-align:center; color:var(--text-muted);">No hay facturas registradas en este mes.</p>'}
        </div>
      </div>
    `;
  }

  if (path.length === 1 && path[0] === 'fidelidad') {
    const selected = loyaltyAdminSelectedCustomer;
    const dashboard = loyaltyAdminDashboard || {
      totalCustomers: 0,
      customersWithRfid: 0,
      totalPoints: 0,
      totalVisits: 0,
      totalSpent: 0,
      pendingVouchers: 0
    };
    const overview = loyaltyAdminOverview || {
      ...dashboard,
      active30d: 0,
      retention30d: 0,
      avgTicket: 0,
      expiringVouchers: 0,
      tierDistribution: [],
      topPromos: [],
      recentPurchases: []
    };
    const tabs = [
      ['resumen', 'Resumen'],
      ['clientes', 'Clientes'],
      ['promos', 'Promos'],
      ['canjes', 'Canjes']
    ];
    const tabButtons = tabs.map(([id, label]) => `
      <button class="loyalty-admin-tab-btn ${loyaltyAdminTab === id ? 'is-active' : ''}" data-loyalty-admin-tab="${id}">
        ${label}
      </button>
    `).join('');
    const customerRows = loyaltyAdminCustomers.map(customer => `
      <button class="loyalty-admin-row ${selected?.id === customer.id ? 'is-selected' : ''}" data-loyalty-customer-id="${customer.id}">
        <span>
          <strong>${escapeHtml(customer.name)}</strong>
          <small>${escapeHtml(customer.email || customer.phone || customer.rfidUid || 'Sin contacto')} · ${escapeHtml(customer.tier)} · ${customer.points.toLocaleString('es-ES')} pts</small>
        </span>
        <em>${Number(customer.totalSpent || 0).toFixed(2)}€</em>
      </button>
    `).join('');
    const purchaseRows = loyaltyAdminPurchases.map(purchase => `
      <div class="loyalty-admin-purchase-row">
        <span>${purchase.createdAt ? new Date(purchase.createdAt).toLocaleDateString('es-ES') : 'Sin fecha'}</span>
        <strong>${purchase.amount.toFixed(2)}€ · +${purchase.points} pts</strong>
      </div>
    `).join('');
    const promoRows = loyaltyAdminPromos.map(promo => `
      <div class="loyalty-admin-promo-row">
        <div>
          <strong>${escapeHtml(promo.title || 'Promo')}</strong>
          <small>${escapeHtml(promo.description || 'Sin descripcion')}</small>
          <span>${escapeHtml(promo.tag || promo.type || 'redeem')} · ${Number(promo.pointsRequired || 0).toLocaleString('es-ES')} pts${promo.expiry ? ` · hasta ${formatIsoDateEs(promo.expiry)}` : ''}</span>
        </div>
        <div class="loyalty-admin-actions">
          <button class="btn btn-secondary" data-loyalty-promo-edit-id="${promo.id}">Editar</button>
          <button class="btn ${promo.active ? 'btn-secondary' : 'btn-primary'}" data-loyalty-promo-toggle-id="${promo.id}" data-next-active="${promo.active ? 'false' : 'true'}">
            ${promo.active ? 'Pausar' : 'Activar'}
          </button>
        </div>
      </div>
    `).join('');
    const voucherRows = loyaltyAdminVouchers.map(voucher => `
      <div class="loyalty-admin-voucher-row">
        <div>
          <strong>${escapeHtml(voucher.customerName)}</strong>
          <small>${escapeHtml(voucher.promoTitle)} · ${escapeHtml(voucher.code || 'Sin codigo')}</small>
          <span>${Number(voucher.pointsCost || 0).toLocaleString('es-ES')} pts · ${voucher.redeemedAt ? new Date(voucher.redeemedAt).toLocaleDateString('es-ES') : 'Sin fecha'}</span>
        </div>
        <div class="loyalty-admin-actions">
          <button class="btn btn-primary" data-loyalty-voucher-use-id="${voucher.id}">Usado</button>
          <button class="btn btn-secondary" data-loyalty-voucher-cancel-id="${voucher.id}">Cancelar</button>
        </div>
      </div>
    `).join('');
    const tierRows = (overview.tierDistribution || []).map(tier => {
      const count = Number(tier.count || 0);
      const total = Math.max(Number(overview.totalCustomers || 0), 1);
      const width = Math.max(4, Math.round((count / total) * 100));
      return `
        <div class="loyalty-admin-tier-row">
          <span>${escapeHtml(tier.tier || 'Nivel')}</span>
          <div><i style="width:${width}%"></i></div>
          <strong>${count}</strong>
        </div>
      `;
    }).join('');
    const topPromoRows = (overview.topPromos || []).map(promo => `
      <div class="loyalty-admin-mini-row">
        <span>
          <strong>${escapeHtml(promo.title || 'Promo')}</strong>
          <small>${Number(promo.used || 0)} usados · ${Number(promo.pending || 0)} pendientes</small>
        </span>
        <em>${Number(promo.total || 0)}</em>
      </div>
    `).join('');
    const recentPurchaseRows = (overview.recentPurchases || []).map(purchase => `
      <div class="loyalty-admin-mini-row">
        <span>
          <strong>${escapeHtml(purchase.customerName || 'Cliente')}</strong>
          <small>${purchase.createdAt ? new Date(purchase.createdAt).toLocaleDateString('es-ES') : 'Sin fecha'} · +${Number(purchase.points || 0)} pts</small>
        </span>
        <em>${Number(purchase.amount || 0).toFixed(2)}€</em>
      </div>
    `).join('');
    const overviewPane = `
      <div class="loyalty-admin-overview-grid">
        <div class="loyalty-admin-kpi-card"><span>Activos 30 dias</span><strong>${Number(overview.active30d || 0).toLocaleString('es-ES')}</strong><small>${Number(overview.retention30d || 0).toFixed(0)}% de la base</small></div>
        <div class="loyalty-admin-kpi-card"><span>Ticket medio</span><strong>${Number(overview.avgTicket || 0).toFixed(2)}€</strong><small>compras fidelizadas</small></div>
        <div class="loyalty-admin-kpi-card"><span>Canjes pendientes</span><strong>${Number(overview.pendingVouchers || 0).toLocaleString('es-ES')}</strong><small>${Number(overview.expiringVouchers || 0)} caducan pronto</small></div>
        <div class="loyalty-admin-kpi-card"><span>Puntos vivos</span><strong>${Number(overview.totalPoints || 0).toLocaleString('es-ES')}</strong><small>${Number(overview.totalVisits || 0).toLocaleString('es-ES')} visitas</small></div>
      </div>
      <div class="loyalty-admin-layout">
        <div class="loyalty-admin-card">
          <div class="loyalty-admin-section-title">Distribucion por nivel</div>
          ${tierRows || '<p class="gemini-muted">Sin datos de niveles.</p>'}
        </div>
        <div class="loyalty-admin-card">
          <div class="loyalty-admin-section-title">Promos mas canjeadas</div>
          ${topPromoRows || '<p class="gemini-muted">Sin canjes todavia.</p>'}
        </div>
      </div>
      <div class="loyalty-admin-card">
        <div class="loyalty-admin-section-title">Ultimas compras fidelizadas</div>
        ${recentPurchaseRows || '<p class="gemini-muted">Sin compras recientes.</p>'}
      </div>
    `;
    const clientsPane = `
      <div class="loyalty-admin-search">
        <input class="search-input" id="loyalty-admin-search-input" value="${escapeHtml(loyaltyAdminQuery)}" placeholder="Buscar cliente, email, telefono o RFID">
        <button class="btn btn-primary" id="loyalty-admin-search-btn" ${loyaltyAdminLoading ? 'disabled' : ''}>
          ${loyaltyAdminLoading ? '...' : 'Buscar'}
        </button>
      </div>
      <div class="loyalty-admin-layout">
        <div class="loyalty-admin-list">
          <div class="loyalty-admin-section-title">Clientes</div>
          ${customerRows || `<p class="gemini-muted">${loyaltyAdminLoading ? 'Cargando clientes...' : 'Pulsa Actualizar. Si sigue vacio, ejecuta supabase/loyalty_admin_bridge.sql en la base de fidelidad.'}</p>`}
        </div>
        <div class="loyalty-admin-detail">
          ${selected ? `
            <div class="loyalty-admin-card">
              <div class="loyalty-admin-detail-head">
                <span>
                  <strong>${escapeHtml(selected.name)}</strong>
                  <small>${escapeHtml(selected.email || 'Sin email')} · ${escapeHtml(selected.phone || 'Sin telefono')}</small>
                </span>
                <em>${escapeHtml(selected.tier)}</em>
              </div>
              <div class="loyalty-admin-metrics">
                <div><span>Puntos</span><strong>${selected.points.toLocaleString('es-ES')}</strong></div>
                <div><span>Visitas</span><strong>${selected.visits}</strong></div>
                <div><span>Gastado</span><strong>${selected.totalSpent.toFixed(2)}€</strong></div>
                <div><span>RFID</span><strong>${escapeHtml(selected.rfidUid || '-')}</strong></div>
              </div>
              <div class="loyalty-admin-card-footer">
                <button class="btn btn-secondary" id="loyalty-admin-edit-customer-btn">Editar cliente</button>
              </div>
            </div>
            <div class="loyalty-admin-card">
              <div class="loyalty-admin-section-title">Ultimas compras</div>
              ${purchaseRows || '<p class="gemini-muted">Sin compras recientes.</p>'}
            </div>
          ` : `
            <div class="loyalty-admin-empty">
              <strong>Selecciona un cliente</strong>
              <span>Aqui veremos su ficha, puntos, RFID y compras recientes.</span>
            </div>
          `}
        </div>
      </div>
    `;
    const promosPane = `
      <div class="loyalty-admin-section-head">
        <span>
          <strong>Promociones</strong>
          <small>Se guardan en la base de fidelidad y aparecen en la app del cliente segun su estado.</small>
        </span>
        <button class="btn btn-primary" id="loyalty-admin-create-promo-btn">Nueva promo</button>
      </div>
      <div class="loyalty-admin-list">
        ${promoRows || `<p class="gemini-muted">${loyaltyAdminLoading ? 'Cargando promos...' : 'No hay promos para mostrar.'}</p>`}
      </div>
    `;
    const vouchersPane = `
      <div class="loyalty-admin-section-head">
        <span>
          <strong>Canjes pendientes</strong>
          <small>Marca como usado cuando entregues la promo o cancela para devolver puntos.</small>
        </span>
      </div>
      <div class="loyalty-admin-list">
        ${voucherRows || `<p class="gemini-muted">${loyaltyAdminLoading ? 'Cargando canjes...' : 'No hay canjes pendientes.'}</p>`}
      </div>
    `;
    const activePane = loyaltyAdminTab === 'promos'
      ? promosPane
      : loyaltyAdminTab === 'canjes'
      ? vouchersPane
      : loyaltyAdminTab === 'resumen'
      ? overviewPane
      : clientsPane;
    const createButton = loyaltyAdminTab === 'clientes'
      ? '<button class="btn btn-primary" id="loyalty-admin-create-btn" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary); color:white;">Nuevo</button>'
      : '';

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
          <button class="btn btn-secondary" id="loyalty-admin-refresh-btn" style="height:36px; padding:0 12px; font-size:0.85rem;">
            Actualizar
          </button>
          ${createButton}
        </div>
        <h2 class="settings-nav-title">Fidelidad</h2>
        <div class="settings-editor-container loyalty-admin-panel">
          ${isLoyaltyConfigured ? `
            <div class="loyalty-admin-dashboard">
              <div><span>Clientes</span><strong>${dashboard.totalCustomers.toLocaleString('es-ES')}</strong></div>
              <div><span>Con RFID</span><strong>${dashboard.customersWithRfid.toLocaleString('es-ES')}</strong></div>
              <div><span>Puntos vivos</span><strong>${dashboard.totalPoints.toLocaleString('es-ES')}</strong></div>
              <div><span>Canjes pendientes</span><strong>${dashboard.pendingVouchers.toLocaleString('es-ES')}</strong></div>
              <div><span>Visitas</span><strong>${dashboard.totalVisits.toLocaleString('es-ES')}</strong></div>
              <div><span>Gasto fidelizado</span><strong>${dashboard.totalSpent.toFixed(2)}€</strong></div>
            </div>
            <div class="loyalty-admin-tabs">${tabButtons}</div>
            ${loyaltyAdminError ? `<p class="payment-loyalty-status" style="color:var(--danger);">${escapeHtml(loyaltyAdminError)}</p>` : ''}
            ${activePane}
          ` : `
            <p class="gemini-muted">Falta configurar la conexión con la base de fidelidad. Revisa VITE_LOYALTY_SUPABASE_URL y VITE_LOYALTY_SUPABASE_ANON_KEY.</p>
          `}
        </div>
      </div>
    `;
  }

  if (path.length === 1 && path[0] === 'cierre') {
    const selectedDate = state.selectedReportDate || new Date().toISOString().slice(0, 10);
    const selectedMonth = state.selectedReportMonth || selectedDate.slice(0, 7);
    const lastClosure = store.getLatestCashClosure();
    const shiftStartAt = lastClosure?.closedAt || null;
    const summary = store.getCashClosureSummary(selectedDate, {
      sinceTime: shiftStartAt ? new Date(shiftStartAt).getTime() : 0
    });
    const nextShiftNumber = store.getNextCashClosureShiftNumber(selectedDate);
    const monthClosures = state.cashClosures
      .filter(item => String(item.businessDate || '').startsWith(selectedMonth))
      .sort((a, b) => {
        const byDate = String(a.businessDate).localeCompare(String(b.businessDate));
        return byDate || Number(a.shiftNumber || 1) - Number(b.shiftNumber || 1);
      });
    const monthSalesDates = [...new Set(state.transactions
      .filter(tx => store.getTransactionDateKey(tx).startsWith(selectedMonth) && tx.type !== 'refund')
      .map(tx => store.getTransactionDateKey(tx)))]
      .sort();
    const missingClosureDates = monthSalesDates.filter(date => {
      const latestForDate = store.getLatestCashClosure(date);
      if (!latestForDate) return true;
      const latestSaleTime = Math.max(...state.transactions
        .filter(tx => store.getTransactionDateKey(tx) === date && tx.type !== 'refund')
        .map(tx => store.getTransactionDate(tx).getTime()));
      return latestSaleTime > new Date(latestForDate.closedAt || `${date}T23:59:59`).getTime();
    });
    const monthClosureRows = monthClosures.map(closure => `
      <div class="gemini-summary-row">
        <span>${formatIsoDateEs(closure.businessDate)} · ${escapeHtml(closure.staffName || closure.staff?.name || 'Sin usuario')}</span>
        <strong>${Number(closure.cashDifference || 0).toFixed(2)}€ / ${Number(closure.cardDifference || 0).toFixed(2)}€</strong>
      </div>
    `).join('');
    const openingCash = 100;
    const countedCash = '';
    const bbvaTotal = summary.expectedCard;
    const expectedDrawer = openingCash + summary.expectedCash;
    const cashDifference = 0;
    const cardDifference = bbvaTotal - summary.expectedCard;
    const disabledAttr = '';

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
        </div>
        <h2 class="settings-nav-title">Cierre de Caja</h2>
        <div class="settings-editor-container">
          <div style="display:grid; gap:12px; margin-bottom:16px;">
            <div class="accounting-month-bar">
              <label>Mes para asesoria</label>
              <input type="month" id="cash-closure-export-month-input" value="${selectedMonth}">
            </div>
            <button type="button" class="btn btn-secondary" id="cash-closure-export-btn" style="height:44px;" ${monthClosures.length ? '' : 'disabled'}>
              Exportar cierres Excel
            </button>
            <div class="gemini-muted" style="padding:12px; border:1px solid var(--border-color); border-radius:var(--border-radius-md); background:var(--bg-item);">
              <strong>${monthClosures.length}</strong> cierres guardados en este mes.
              ${monthClosureRows || '<div style="margin-top:8px;">Todavia no hay cierres guardados para exportar.</div>'}
            </div>
            ${missingClosureDates.length ? `
              <div class="gemini-muted needs-review" style="padding:12px; border:1px solid #f59e0b; border-radius:var(--border-radius-md); background:var(--bg-item);">
                Faltan cierres en dias con ventas: ${missingClosureDates.map(formatIsoDateEs).join(', ')}.
              </div>
            ` : monthSalesDates.length ? `
              <div class="gemini-muted" style="padding:12px; border:1px solid var(--secondary); border-radius:var(--border-radius-md); background:var(--bg-item);">
                Todos los dias con ventas de este mes tienen cierre guardado.
              </div>
            ` : ''}
          </div>
          ${store.cashClosurePersistenceReady ? '' : `
            <div class="gemini-muted" style="padding:12px; border:1px solid var(--border-color); border-radius:var(--border-radius-md); background:var(--bg-item);">
              Ejecuta <strong>sql/cash_closures_migration.sql</strong> en Supabase para poder guardar cierres.
            </div>
          `}
          <form id="cash-closure-form" style="display:grid; gap:16px;">
            <div class="accounting-month-bar">
              <label>Dia</label>
              <input type="date" id="cash-closure-date-input" value="${selectedDate}">
            </div>
            <div class="gemini-muted" style="padding:12px; border:1px solid var(--border-color); border-radius:var(--border-radius-md); background:var(--bg-item);">
              Cierre del turno ${nextShiftNumber}. ${shiftStartAt ? `Turno iniciado automaticamente tras el cierre de ${new Date(shiftStartAt).toLocaleString('es-ES')}.` : 'Primer turno registrado.'}
            </div>
            <div class="accounting-summary-grid">
              <div><span>Ventas netas</span><strong>${summary.netTotal.toFixed(2)}€</strong></div>
              <div><span>Efectivo app</span><strong>${summary.expectedCash.toFixed(2)}€</strong></div>
              <div><span>Tarjeta app</span><strong>${summary.expectedCard.toFixed(2)}€</strong></div>
              <div><span>Devoluciones</span><strong>${summary.totalRefunds.toFixed(2)}€</strong></div>
              <div><span>Tickets</span><strong>${summary.transactionsCount}</strong></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="editor-form-group">
                <label class="editor-form-label">Fondo inicial</label>
                <input type="number" step="0.01" min="0" class="editor-form-input" id="closure-opening-cash" value="${openingCash}" ${disabledAttr}>
              </div>
              <div class="editor-form-group">
                <label class="editor-form-label">Efectivo contado</label>
                <input type="number" step="0.01" min="0" class="editor-form-input" id="closure-counted-cash" value="${countedCash}" ${disabledAttr}>
              </div>
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Total cierre datáfono BBVA</label>
              <input type="number" step="0.01" min="0" class="editor-form-input" id="closure-bbva-total" value="${bbvaTotal || ''}" ${disabledAttr}>
            </div>
            <div class="accounting-summary-grid">
              <div><span>Cajón esperado</span><strong>${expectedDrawer.toFixed(2)}€</strong></div>
              <div class="${Math.abs(cashDifference) > 0.009 ? 'needs-review' : ''}"><span>Diferencia efectivo</span><strong>${cashDifference.toFixed(2)}€</strong></div>
              <div class="${Math.abs(cardDifference) > 0.009 ? 'needs-review' : ''}"><span>Diferencia BBVA</span><strong>${cardDifference.toFixed(2)}€</strong></div>
            </div>
            <div id="closure-live-preview" class="gemini-muted" data-expected-cash="${summary.expectedCash}" data-expected-card="${summary.expectedCard}" style="padding:12px; border:1px solid var(--border-color); border-radius:var(--border-radius-md); background:var(--bg-item);">
              Introduce el efectivo contado y pulsa Calcular descuadre antes de cerrar el turno.
            </div>
            <button type="button" class="btn btn-secondary" id="closure-calc-btn" style="height:44px;">
              Calcular descuadre
            </button>
            <div class="editor-form-group">
              <label class="editor-form-label">Notas</label>
              <textarea class="editor-form-input" id="closure-notes" rows="3" placeholder="Descuadres, incidencias, observaciones..." ${disabledAttr}></textarea>
            </div>
            <button type="submit" class="btn btn-primary" style="height:48px; background-color:var(--secondary);" ${store.cashClosurePersistenceReady && store.canCloseCash() ? '' : 'disabled'}>
              Guardar cierre de turno
            </button>
            ${lastClosure ? `<p class="gemini-muted">Ultimo cierre guardado: ${new Date(lastClosure.closedAt).toLocaleString('es-ES')}</p>` : ''}
          </form>
        </div>
      </div>
    `;
  }

  if (path.length >= 2 && path[0] === 'compras' && path[1] === 'importar-gemini') {
    const preview = geminiInvoicePreview;
    const rows = preview?.rows || [];
    const invoices = preview?.invoices || [];
    const importableInvoices = invoices.filter(invoice => invoice.importable !== false);
    const providerRows = (preview?.summaries?.gasto_por_proveedor || []).map(item => `
      <div class="gemini-summary-row">
        <span>${escapeHtml(item.proveedor)}</span>
        <strong>${Number(item.total || 0).toFixed(2)}€</strong>
      </div>
    `).join('');
    const invoiceRows = invoices.map(invoice => `
      <div class="gemini-summary-row ${invoice.duplicate ? 'needs-review' : ''}">
        <span>
          ${escapeHtml(invoice.supplierName)} · ${escapeHtml(invoice.invoiceDate)} · ${escapeHtml(invoice.invoiceNumber || 'Sin numero')}
          ${invoice.duplicate ? `<em>${escapeHtml(invoice.duplicateReasons?.join(' ') || 'Factura duplicada')}</em>` : ''}
        </span>
        <strong>${Number(invoice.totalAmount || 0).toFixed(2)}€</strong>
      </div>
    `).join('');
    const lineRows = rows.slice(0, 80).map(row => `
      <div class="gemini-preview-row ${row.revision_necesaria ? 'needs-review' : ''}">
        <div>
          <strong>${escapeHtml(row.articulo_normalizado)}</strong>
          <span>${escapeHtml(row.proveedor)} · ${escapeHtml(row.fecha)} · ${escapeHtml(row.factura)}</span>
          ${row.revision_necesaria ? `<em>${escapeHtml(row.motivo_revision || 'Revisar linea')}</em>` : ''}
        </div>
        <div>
          <strong>${Number(row.importe || 0).toFixed(2)}€</strong>
          <span>${row.cantidad ?? '-'} ${escapeHtml(row.unidad || '')} · ${row.precio_unitario !== null ? Number(row.precio_unitario).toFixed(4) : '-'}€/${escapeHtml(row.unidad_precio || 'ud')}</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Compras
          </button>
        </div>
        <h2 class="settings-nav-title">Importar factura desde Gemini</h2>
        <div class="settings-editor-container gemini-import-panel">
          <div class="gemini-prompt-panel">
            <div>
              <h3>Prompt para Gemini</h3>
              <p>Usa este texto para que Gemini analice una carpeta completa y devuelva las facturas por partes, sin pedir permiso para continuar.</p>
            </div>
            <textarea class="editor-form-input" id="gemini-prompt-text" rows="12" readonly>${escapeHtml(GEMINI_FOLDER_INVOICE_PROMPT)}</textarea>
            <button class="btn btn-secondary" id="gemini-copy-prompt-btn" type="button">Copiar prompt</button>
          </div>
          <div class="editor-form-group">
            <label class="editor-form-label">Respuesta de Gemini</label>
            <textarea class="editor-form-input" id="gemini-invoice-raw-text" rows="12" placeholder="Pega aqui una o varias partes de la respuesta de Gemini">${escapeHtml(geminiInvoiceRawText)}</textarea>
          </div>
          <div class="gemini-import-actions">
            <button class="btn btn-secondary" id="gemini-clear-btn" type="button">Limpiar</button>
            <button class="btn btn-primary" id="gemini-preview-btn" type="button" style="background:var(--secondary); border-color:var(--secondary);">Analizar texto</button>
          </div>

          ${preview ? `
            <div class="gemini-preview-summary">
              <div><span>Lineas</span><strong>${preview.totals.rows}</strong></div>
              <div><span>Facturas</span><strong>${preview.totals.invoices}</strong></div>
              <div><span>Total</span><strong>${preview.totals.totalAmount.toFixed(2)}€</strong></div>
              <div class="${preview.totals.reviewRows > 0 ? 'needs-review' : ''}"><span>Dudosas</span><strong>${preview.totals.reviewRows}</strong></div>
              <div class="${preview.totals.duplicateInvoices > 0 ? 'needs-review' : ''}"><span>Duplicadas</span><strong>${preview.totals.duplicateInvoices || 0}</strong></div>
              <div><span>Importables</span><strong>${preview.totals.importableInvoices ?? invoices.length}</strong></div>
            </div>

            <div class="gemini-summary-panel">
              <h3>Gasto por proveedor</h3>
              ${providerRows || '<p>No se detectaron proveedores.</p>'}
            </div>

            <div class="gemini-summary-panel">
              <h3>Facturas detectadas</h3>
              ${invoices.map(invoice => `
                <div class="gemini-summary-row ${invoice.duplicate ? 'needs-review' : ''}">
                  <span>${escapeHtml(invoice.supplierName)} · ${escapeHtml(invoice.invoiceDate)} · ${escapeHtml(invoice.invoiceNumber || 'Sin numero')}</span>
                  <strong>${Number(invoice.totalAmount || 0).toFixed(2)}€</strong>
                </div>
              `).join('') || '<p>No se detectaron facturas.</p>'}
            </div>

            <div class="gemini-lines-panel">
              <h3>Lineas detectadas</h3>
              ${lineRows || '<p>No hay lineas para revisar.</p>'}
              ${rows.length > 80 ? `<p class="gemini-muted">Mostrando 80 de ${rows.length} lineas.</p>` : ''}
            </div>

            <button class="btn btn-primary" id="gemini-import-confirm-btn" type="button" ${importableInvoices.length === 0 ? 'disabled' : ''} style="height:48px; background:var(--secondary); border-color:var(--secondary);">
              Importar ${importableInvoices.length} factura${importableInvoices.length === 1 ? '' : 's'} nueva${importableInvoices.length === 1 ? '' : 's'}
            </button>
          ` : `
            <p class="gemini-muted">Pega aqui una respuesta completa o varias partes de Gemini. La app separara las facturas por numero, aplicara los totales de cada seccion y marcara duplicados.</p>
          `}
        </div>
      </div>
    `;
  }

  if (path.length >= 2 && path[0] === 'compras') {
    const isNew = path[1] === 'nueva';
    const invoice = isNew ? null : state.supplierInvoices.find(item => item.id === path[1]);
    if (!isNew && !invoice) {
      return '<div class="view-container"><p style="padding:24px;">Factura no encontrada.</p></div>';
    }

    const invoiceLines = invoice
      ? state.supplierInvoiceLines.filter(line => line.invoiceId === invoice.id)
      : [];
    const invoiceLineRows = invoiceLines.map(line => `
      <div class="supplier-line-row">
        <div>
          <strong>${line.description}</strong>
          <span>${line.quantity ?? '-'} uds. · ${line.unitPrice !== null ? `${line.unitPrice.toFixed(4)}€` : '-'} / ud.</span>
        </div>
        <strong>${line.totalAmount !== null ? `${line.totalAmount.toFixed(2)}€` : '-'}</strong>
      </div>
    `).join('');

    const baseAmount = Number(invoice?.baseAmount || 0);
    const taxRate = Number(invoice?.taxRate ?? state.legal?.taxRate ?? 7);
    const taxAmount = Number(invoice?.taxAmount || 0);
    const totalAmount = Number(invoice?.totalAmount || 0);

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Compras
          </button>
        </div>
        <h2 class="settings-nav-title">${isNew ? 'Nueva factura' : 'Editar factura'}</h2>
        <div class="settings-editor-container">
          <form id="supplier-invoice-form" data-invoice-id="${invoice?.id || ''}" style="display:grid; gap:16px;">
            <div class="editor-form-group">
              <label class="editor-form-label">Proveedor</label>
              <input type="text" class="editor-form-input" id="invoice-supplier-name" value="${invoice?.supplierName || ''}" required>
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Numero de factura</label>
              <input type="text" class="editor-form-input" id="invoice-number" value="${invoice?.invoiceNumber || ''}">
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Fecha</label>
              <input type="date" class="editor-form-input" id="invoice-date" value="${invoice?.invoiceDate || new Date().toISOString().slice(0, 10)}" required>
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Categoria</label>
              <input type="text" class="editor-form-input" id="invoice-category" value="${invoice?.category || ''}" placeholder="Mercancia, suministros, alquiler...">
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="editor-form-group">
                <label class="editor-form-label">Base imponible</label>
                <input type="number" step="0.01" min="0" class="editor-form-input" id="invoice-base-amount" value="${baseAmount || ''}" required>
              </div>
              <div class="editor-form-group">
                <label class="editor-form-label">IGIC %</label>
                <input type="number" step="0.01" min="0" class="editor-form-input" id="invoice-tax-rate" value="${taxRate}" required>
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="editor-form-group">
                <label class="editor-form-label">IGIC soportado</label>
                <input type="number" step="0.01" min="0" class="editor-form-input" id="invoice-tax-amount" value="${taxAmount || ''}" required>
              </div>
              <div class="editor-form-group">
                <label class="editor-form-label">Total factura</label>
                <input type="number" step="0.01" min="0" class="editor-form-input" id="invoice-total-amount" value="${totalAmount || ''}" required>
              </div>
            </div>
            <label class="staff-active-toggle">
              <input type="checkbox" id="invoice-deductible" ${invoice?.deductible === false ? '' : 'checked'}>
              <span>IGIC deducible</span>
            </label>
            <div class="editor-form-group">
              <label class="editor-form-label">Origen</label>
              <select class="editor-form-input" id="invoice-source">
                <option value="manual" ${invoice?.source === 'manual' ? 'selected' : ''}>Manual</option>
                <option value="drive" ${invoice?.source === 'drive' ? 'selected' : ''}>Drive</option>
                <option value="gmail" ${invoice?.source === 'gmail' ? 'selected' : ''}>Gmail</option>
              </select>
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Remitente email</label>
              <input type="email" class="editor-form-input" id="invoice-sender-email" value="${invoice?.senderEmail || ''}" placeholder="proveedor@ejemplo.com">
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Notas</label>
              <textarea class="editor-form-input" id="invoice-notes" rows="3">${invoice?.notes || ''}</textarea>
            </div>
            ${invoiceLines.length > 0 ? `
              <div class="supplier-lines-panel">
                <h3>Lineas detectadas</h3>
                ${invoiceLineRows}
              </div>
            ` : ''}
            <button type="submit" class="btn btn-primary" style="height:48px; background-color:var(--secondary);">Guardar factura</button>
            ${!isNew ? `
              <button type="button" class="btn btn-secondary" id="settings-delete-invoice-btn" style="height:44px; color:var(--danger); border-color:rgba(239,68,68,.3); background:rgba(239,68,68,.08);">
                Eliminar factura
              </button>
            ` : ''}
          </form>
        </div>
      </div>
    `;
  }

  if (path.length === 1 && path[0] === 'staff' && store.canManageStaff()) {
    const permissionsRow = `
      <button class="settings-tree-item" id="settings-to-role-permissions">
        <span>
          <strong>Permisos por rol</strong>
          <small>Otorgar o revocar accesos de encargado y staff</small>
        </span>
        ${chevron}
      </button>
    `;
    const staffRows = state.staffProfiles.map(profile => `
      <button class="settings-tree-item staff-row" data-edit-staff-id="${profile.id}">
        <span>
          <strong>${profile.display_name}</strong>
          <small>${store.getRoleLabel(profile.role)} · ${profile.pin_code ? 'PIN configurado' : 'Sin PIN'} · ${profile.active ? 'Activo' : 'Inactivo'}</small>
        </span>
        ${chevron}
      </button>
    `).join('');

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
          <button class="btn btn-primary" id="settings-create-staff-btn" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary);">
            Nuevo
          </button>
        </div>
        <h2 class="settings-nav-title">Personal</h2>
        <div class="settings-tree-list">
          ${permissionsRow}
          ${staffRows || '<p style="padding:24px; text-align:center; color:var(--text-muted);">No hay perfiles de personal.</p>'}
        </div>
      </div>
    `;
  }

  if (path.length === 2 && path[0] === 'staff' && path[1] === 'permisos' && store.canManageStaff()) {
    const permissions = state.rolePermissions || {};
    const permissionLabels = [
      ['accessSettings', 'Entrar en Ajustes'],
      ['manageCatalog', 'Gestionar articulos y cuadricula'],
      ['manageAccounting', 'Gestionar datos fiscales, compras y facturas'],
      ['viewReports', 'Ver y exportar informes'],
      ['closeCash', 'Cerrar caja'],
      ['issueRefunds', 'Registrar devoluciones'],
      ['resetTerminal', 'Restablecer terminal'],
      ['manageStaff', 'Gestionar personal'],
      ['managePermissions', 'Gestionar permisos'],
      ['manageLoyalty', 'Gestionar fidelidad']
    ];
    const renderRolePermissions = (role, label) => `
      <div class="settings-editor-container" style="margin-bottom:16px;">
        <h3 style="margin:0 0 12px;">${label}</h3>
        ${permissionLabels.map(([key, text]) => `
          <label class="staff-active-toggle">
            <input type="checkbox" class="role-permission-input" data-role="${role}" data-permission="${key}" ${permissions?.[role]?.[key] ? 'checked' : ''}>
            <span>${text}</span>
          </label>
        `).join('')}
      </div>
    `;

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Personal
          </button>
        </div>
        <h2 class="settings-nav-title">Permisos por rol</h2>
        ${renderRolePermissions('manager', 'Encargado')}
        ${renderRolePermissions('staff', 'Staff')}
      </div>
    `;
  }

  if (path.length >= 2 && path[0] === 'staff' && store.canManageStaff()) {
    const isNew = path[1] === 'nuevo';
    const profile = isNew ? null : state.staffProfiles.find(item => item.id === path[1]);
    if (!isNew && !profile) {
      return '<div class="view-container"><p style="padding:24px;">Empleado no encontrado.</p></div>';
    }

    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Personal
          </button>
        </div>
        <h2 class="settings-nav-title">${isNew ? 'Nuevo empleado' : 'Editar empleado'}</h2>
        <div class="settings-editor-container">
          <form id="settings-staff-form" data-staff-id="${profile?.id || ''}" style="display:grid; gap:16px;">
            <div class="editor-form-group">
              <label class="editor-form-label">Nombre</label>
              <input type="text" class="editor-form-input" id="staff-display-name" value="${profile?.display_name || ''}" required placeholder="Ej. Camarero 1">
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Rol</label>
              <select class="editor-form-input" id="staff-role" required>
                <option value="staff" ${profile?.role === 'staff' ? 'selected' : ''}>Staff</option>
                <option value="manager" ${profile?.role === 'manager' ? 'selected' : ''}>Encargado</option>
                <option value="admin" ${profile?.role === 'admin' ? 'selected' : ''}>Administrador</option>
              </select>
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Codigo PIN (4 a 8 digitos)</label>
              <input type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" class="editor-form-input" id="staff-pin-code" value="${profile?.pin_code || ''}" required placeholder="Minimo 4, maximo 8 digitos">
            </div>
            <label class="staff-active-toggle">
              <input type="checkbox" id="staff-active" ${profile?.active === false ? '' : 'checked'}>
              <span>Empleado activo</span>
            </label>
            <button type="submit" class="btn btn-primary" style="height:48px; background-color:var(--secondary);">Guardar empleado</button>
            ${!isNew ? `
              <button type="button" class="btn btn-secondary" id="settings-delete-staff-btn" style="height:44px; color:var(--danger); border-color:rgba(239,68,68,.3); background:rgba(239,68,68,.08);">
                Eliminar empleado
              </button>
            ` : ''}
          </form>
        </div>
      </div>
    `;
  }

  // Datos Fiscales Form
  if (path.length === 1 && path[0] === 'legal') {
    const legal = state.legal || {};
    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
        </div>
        <h2 class="settings-nav-title">Datos Fiscales</h2>
        <div class="settings-editor-container">
          <form id="settings-legal-form" style="display: grid; gap: 16px;">
            <div class="editor-form-group">
              <label class="editor-form-label">Nombre Comercial (Marca)</label>
              <input type="text" class="editor-form-input" id="legal-business-name" value="${legal.businessName || ''}" required placeholder="Ej. Esencia Café">
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Razón Social</label>
              <input type="text" class="editor-form-input" id="legal-company-name" value="${legal.companyName || ''}" required placeholder="Ej. Esencia Café S.L.">
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">NIF / CIF</label>
              <input type="text" class="editor-form-input" id="legal-nif" value="${legal.nif || ''}" required placeholder="Ej. B-87654321">
            </div>
            <div class="editor-form-group">
              <label class="editor-form-label">Dirección</label>
              <input type="text" class="editor-form-input" id="legal-address" value="${legal.address || ''}" required placeholder="Ej. Calle del Grano 12, 38001 Santa Cruz de Tenerife">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="editor-form-group">
                <label class="editor-form-label">Nombre del Impuesto</label>
                <input type="text" class="editor-form-input" id="legal-tax-name" value="${legal.taxName || ''}" required placeholder="Ej. IGIC">
              </div>
              <div class="editor-form-group">
                <label class="editor-form-label">Porcentaje (%)</label>
                <input type="number" step="0.01" min="0" class="editor-form-input" id="legal-tax-rate" value="${legal.taxRate ?? ''}" required placeholder="Ej. 7.00">
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top: 16px; height: 44px; font-weight: 600; background-color: var(--secondary);">
              Guardar Cambios
            </button>
          </form>
        </div>
      </div>
    `;
  }

  // 1c. Informes y Ventas
  if (path.length === 1 && path[0] === 'informes') {
    return `
      <div class="view-container">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Ajustes
          </button>
        </div>
        <h2 class="settings-nav-title">Informes de Ventas</h2>
        <div class="settings-tree-list">
          <button class="settings-tree-item" id="settings-to-informes-diario">
            <div>
              <div style="font-weight: 600;">Informe Diario</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Ventas detalladas, métodos de pago y devoluciones de un día específico</div>
            </div>
            ${chevron}
          </button>
          <button class="settings-tree-item" id="settings-to-informes-mensual">
            <div>
              <div style="font-weight: 600;">Informe Mensual</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Resumen mensual y desglose diario de facturación</div>
            </div>
            ${chevron}
          </button>
        </div>
      </div>
    `;
  }

  if (path.length === 2 && path[0] === 'informes' && path[1] === 'diario') {
    const getTxDate = (tx) => {
      if (tx.createdAt) return new Date(tx.createdAt);
      if (tx.date) {
        const [datePart, timePart] = tx.date.split(', ');
        const [day, month, year] = datePart.split('/').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        return new Date(year, month - 1, day, hour, minute);
      }
      return new Date();
    };

    const getTxDateKey = (tx) => {
      const d = getTxDate(tx);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const selectedDate = state.selectedReportDate || new Date().toISOString().slice(0, 10);
    const dayTx = state.transactions.filter(tx => getTxDateKey(tx) === selectedDate);

    // Calculate daily figures
    let totalGross = 0;
    let totalRefunds = 0;
    let totalDiscounts = 0; // future placeholder
    const paymentMethods = {
      'Efectivo': 0,
      'Tarjeta': 0,
      'Tarjeta Regalo': 0
    };

    dayTx.forEach(tx => {
      const val = Number(tx.total || 0);
      const method = (tx.paymentMethod || '').toLowerCase().trim();
      
      let matchedMethod = 'Tarjeta';
      if (method.includes('efectivo')) {
        matchedMethod = 'Efectivo';
      } else if (method.includes('regalo') || method.includes('gift')) {
        matchedMethod = 'Tarjeta Regalo';
      }

      if (tx.type === 'refund') {
        totalRefunds += Math.abs(val);
        paymentMethods[matchedMethod] += val; // negative
      } else {
        totalGross += val;
        paymentMethods[matchedMethod] += val; // positive
      }
    });

    const totalNet = totalGross - totalRefunds;

    // Time-based groupings for the hourly chart (only for selected day)
    const hourlySales = Array(24).fill(0);
    dayTx.forEach(tx => {
      const d = getTxDate(tx);
      const hour = d.getHours();
      hourlySales[hour] += Number(tx.total || 0);
    });

    // Render hourly chart
    let minH = 8;
    let maxH = 20;
    for (let h = 0; h < 24; h++) {
      if (hourlySales[h] !== 0) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    
    const activeHours = [];
    let maxVal = 0.01;
    for (let h = minH; h <= maxH; h++) {
      activeHours.push(h);
      const absVal = Math.abs(hourlySales[h]);
      if (absVal > maxVal) maxVal = absVal;
    }

    const barCount = activeHours.length;
    const svgW = 500;
    const svgH = 180;
    const paddingX = 40;
    const paddingY = 30;
    const chartW = svgW - paddingX * 2;
    const chartH = svgH - paddingY * 2;
    const barW = barCount > 0 ? (chartW / barCount) * 0.6 : 10;
    const barGap = barCount > 0 ? (chartW / barCount) * 0.4 : 10;

    let barsSVG = '';
    let labelsSVG = '';
    
    activeHours.forEach((h, index) => {
      const sales = hourlySales[h];
      const hPct = Math.abs(sales) / maxVal;
      const bHeight = hPct * chartH;
      const bX = paddingX + index * (barW + barGap) + barGap / 2;
      const bY = sales >= 0 ? (svgH - paddingY - bHeight) : (svgH - paddingY);
      const barFill = sales >= 0 ? 'url(#barGrad)' : 'url(#barGradRefund)';

      barsSVG += `
        <g>
          <rect class="chart-bar-hover" x="${bX}" y="${bY}" width="${barW}" height="${bHeight}" fill="${barFill}" rx="3" ry="3">
            <title>${h.toString().padStart(2, '0')}:00 - ${sales.toFixed(2)}€</title>
          </rect>
        </g>
      `;
      
      if (barCount <= 12 || index % 2 === 0) {
        labelsSVG += `
          <text x="${bX + barW / 2}" y="${svgH - 10}" fill="var(--text-muted)" font-size="10" font-family="var(--font-family)" font-weight="600" text-anchor="middle">
            ${h.toString().padStart(2, '0')}h
          </text>
        `;
      }
    });

    const chartHTML = `
      <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%">
        <defs>
          <linearGradient id="barGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="var(--secondary)" />
            <stop offset="100%" stop-color="#059669" stop-opacity="0.6" />
          </linearGradient>
          <linearGradient id="barGradRefund" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="var(--danger)" />
            <stop offset="100%" stop-color="#ef4444" stop-opacity="0.6" />
          </linearGradient>
        </defs>
        <line x1="${paddingX}" y1="${paddingY}" x2="${svgW - paddingX}" y2="${paddingY}" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="4" />
        <line x1="${paddingX}" y1="${paddingY + chartH / 2}" x2="${svgW - paddingX}" y2="${paddingY + chartH / 2}" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="4" />
        <line x1="${paddingX}" y1="${svgH - paddingY}" x2="${svgW - paddingX}" y2="${svgH - paddingY}" stroke="var(--border-color)" stroke-width="1.5" />
        
        <text x="${paddingX - 10}" y="${paddingY + 4}" fill="var(--text-muted)" font-size="9" font-weight="700" text-anchor="end">${maxVal.toFixed(0)}€</text>
        <text x="${paddingX - 10}" y="${svgH - paddingY}" fill="var(--text-muted)" font-size="9" font-weight="700" text-anchor="end">0€</text>
        
        ${barsSVG}
        ${labelsSVG}
      </svg>
    `;

    // Render transactions for this day
    const txRows = dayTx.map(tx => {
      const isRefund = tx.type === 'refund';
      const badge = isRefund
        ? `<span class="badge badge--danger" style="margin-left: 8px;">Devolución</span>`
        : tx.hasRefund
        ? `<span class="badge badge--warning" style="margin-left: 8px;">Devuelta parcial</span>`
        : '';
      const txTime = tx.date.split(', ')[1] || '';
      return `
        <button class="tx-card" data-transaction-id="${tx.id}">
          <div class="tx-meta">
            <span class="tx-table-name">${tx.id} ${badge}</span>
            <span class="tx-date-method">${txTime} • ${tx.table} • ${tx.paymentMethod}</span>
          </div>
          <div class="tx-financial">
            <span class="tx-amount ${isRefund ? 'text-danger' : ''}" style="${isRefund ? 'color: var(--danger); font-weight: 700;' : ''}">${tx.total.toFixed(2)}€</span>
            <div class="tx-qty">${tx.itemsCount} art.</div>
          </div>
        </button>
      `;
    }).join('');

    // Prettify date for header
    const formattedDateHeader = new Date(selectedDate + 'T00:00:00').toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    return `
      <div class="view-container" style="display:flex; flex-direction:column; height:100%; overflow:hidden;">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Informes
          </button>
        </div>
        
        <div style="flex-grow:1; overflow-y:auto; padding-bottom:32px;">
          <!-- Date Selector -->
          <div class="report-selector-card" style="margin: 0 16px 16px 16px; padding: 16px; background: var(--bg-item); border: 1px solid var(--border-color); border-radius: var(--border-radius); display: flex; flex-direction: column; gap: 12px; align-items: center;">
            <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Seleccionar Fecha</div>
            <div style="display: flex; align-items: center; gap: 12px; width: 100%; justify-content: center;">
              <button class="btn btn-secondary btn-icon-only" id="report-date-prev" style="height: 38px; width: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">&larr;</button>
              <input type="date" id="report-date-input" value="${selectedDate}" style="background: var(--bg-main); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); font-weight: 700; padding: 8px 16px; border-radius: var(--border-radius-sm); outline: none; text-align: center; font-size: 1rem;">
              <button class="btn btn-secondary btn-icon-only" id="report-date-next" style="height: 38px; width: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">&rarr;</button>
            </div>
            <div style="font-size: 0.9rem; font-weight: 600; color: var(--secondary); text-align: center; margin-top: 4px;">
              ${formattedDateHeader.charAt(0).toUpperCase() + formattedDateHeader.slice(1)}
            </div>
          </div>

          <!-- 1. KPIs Section -->
          <div class="reports-kpis-grid" style="margin-bottom: 16px;">
            <div class="reports-kpi-card kpi-total">
              <span class="reports-kpi-label">Ventas Netas</span>
              <span class="reports-kpi-val">${totalNet.toFixed(2)}€</span>
              <span style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">Bruto: ${totalGross.toFixed(2)}€</span>
            </div>
            <div class="reports-kpi-card kpi-cash">
              <span class="reports-kpi-label">Devoluciones</span>
              <span class="reports-kpi-val" style="color:var(--danger);">${totalRefunds.toFixed(2)}€</span>
              <span style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${dayTx.filter(t => t.type === 'refund').length} dev.</span>
            </div>
            <div class="reports-kpi-card kpi-card-pay">
              <span class="reports-kpi-label">Descuentos</span>
              <span class="reports-kpi-val" style="color:#f59e0b;">${totalDiscounts.toFixed(2)}€</span>
              <span style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">Aplicados</span>
            </div>
          </div>

          <!-- Payment Methods Breakdown Section -->
          <div class="reports-chart-card" style="margin-bottom: 16px; padding: 16px;">
            <div class="reports-chart-title" style="margin-bottom: 12px; font-weight: 700;">Desglose Métodos de Pago (Neto)</div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom: 6px; border-bottom: 1px solid var(--border-color);">
                <span style="font-weight: 600;">Efectivo</span>
                <strong style="color: #f59e0b;">${paymentMethods['Efectivo'].toFixed(2)}€</strong>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom: 6px; border-bottom: 1px solid var(--border-color);">
                <span style="font-weight: 600;">Tarjeta Bancaria</span>
                <strong style="color: #3b82f6;">${paymentMethods['Tarjeta'].toFixed(2)}€</strong>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom: 6px;">
                <span style="font-weight: 600;">Tarjeta Regalo</span>
                <strong style="color: var(--secondary);">${paymentMethods['Tarjeta Regalo'].toFixed(2)}€</strong>
              </div>
            </div>
          </div>

          <!-- Export Action -->
          <div style="padding: 0 16px 16px 16px;">
            <button class="btn btn-primary btn-full" id="btn-export-diario" style="height: 44px; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; background-color: var(--secondary); color: white;">
              📄 Exportar Diario (PDF)
            </button>
          </div>

          <!-- 3. Chart Container -->
          <div class="reports-chart-card" style="margin-bottom: 16px;">
            <div class="reports-chart-title">Ventas Netas por Hora</div>
            <div class="chart-svg-container">
              ${chartHTML}
            </div>
          </div>

          <!-- 4. Transactions List -->
          <div class="reports-items-section">
            <h3 style="margin:0 0 12px 0; font-size:1.05rem; font-weight:700; color:var(--text-main);">Tickets y Transacciones (${dayTx.length})</h3>
            <div class="tx-history-list">
              ${txRows ? txRows : '<p style="text-align:center; padding: 20px; color: var(--text-muted); font-size:0.85rem;">No hay transacciones registradas este día</p>'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (path.length === 2 && path[0] === 'informes' && path[1] === 'mensual') {
    const getTxDate = (tx) => {
      if (tx.createdAt) return new Date(tx.createdAt);
      if (tx.date) {
        const [datePart, timePart] = tx.date.split(', ');
        const [day, month, year] = datePart.split('/').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        return new Date(year, month - 1, day, hour, minute);
      }
      return new Date();
    };

    const getTxMonthKey = (tx) => {
      const d = getTxDate(tx);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${yyyy}-${mm}`;
    };

    const selectedMonth = state.selectedReportMonth || new Date().toISOString().slice(0, 7);
    const monthTx = state.transactions.filter(tx => getTxMonthKey(tx) === selectedMonth);

    // Calculate monthly figures
    let totalGross = 0;
    let totalRefunds = 0;
    let cashSales = 0;
    let cardSales = 0;
    const txCount = monthTx.filter(t => t.type !== 'refund').length;

    const dailyAgg = {};
    monthTx.forEach(tx => {
      const d = getTxDate(tx);
      const day = d.getDate();
      const dateStr = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      
      if (!dailyAgg[day]) {
        dailyAgg[day] = {
          day,
          dateStr,
          count: 0,
          gross: 0,
          refunds: 0,
          net: 0,
          cash: 0,
          card: 0
        };
      }

      const val = Number(tx.total || 0);
      const method = (tx.paymentMethod || '').toLowerCase().trim();
      const isCash = method.includes('efectivo');

      if (tx.type === 'refund') {
        totalRefunds += Math.abs(val);
        dailyAgg[day].refunds += Math.abs(val);
        dailyAgg[day].net += val; // negative
        if (isCash) {
          cashSales += val;
          dailyAgg[day].cash += val;
        } else {
          cardSales += val;
          dailyAgg[day].card += val;
        }
      } else {
        totalGross += val;
        dailyAgg[day].count += 1;
        dailyAgg[day].gross += val;
        dailyAgg[day].net += val; // positive
        if (isCash) {
          cashSales += val;
          dailyAgg[day].cash += val;
        } else {
          cardSales += val;
          dailyAgg[day].card += val;
        }
      }
    });

    const totalNet = totalGross - totalRefunds;
    const sortedDays = Object.values(dailyAgg).sort((a, b) => a.day - b.day);

    // Month name display
    const [yearPart, monthPart] = selectedMonth.split('-');
    const formattedMonthHeader = new Date(Number(yearPart), Number(monthPart) - 1, 1).toLocaleDateString('es-ES', {
      month: 'long',
      year: 'numeric'
    });

    // Build breakdown table rows
    const tableRowsHTML = sortedDays.map(day => `
      <tr>
        <td style="font-weight: 600;">${day.dateStr}</td>
        <td style="text-align: right;">${day.count}</td>
        <td style="text-align: right; color: #f59e0b;">${day.cash.toFixed(2)}€</td>
        <td style="text-align: right; color: #3b82f6;">${day.card.toFixed(2)}€</td>
        <td style="text-align: right; color: var(--danger); font-size: 0.85rem;">${day.refunds > 0 ? `-${day.refunds.toFixed(2)}€` : '0.00€'}</td>
        <td style="text-align: right; font-weight: 700; color: ${day.net >= 0 ? 'var(--secondary)' : 'var(--danger)'};">${day.net.toFixed(2)}€</td>
      </tr>
    `).join('');

    return `
      <div class="view-container" style="display:flex; flex-direction:column; height:100%; overflow:hidden;">
        <div class="settings-nav-header">
          <button class="settings-back-arrow-btn" id="settings-back-btn">
            ${backArrow} Informes
          </button>
        </div>
        
        <div style="flex-grow:1; overflow-y:auto; padding-bottom:32px;">
          <!-- Month Selector -->
          <div class="report-selector-card" style="margin: 0 16px 16px 16px; padding: 16px; background: var(--bg-item); border: 1px solid var(--border-color); border-radius: var(--border-radius); display: flex; flex-direction: column; gap: 12px; align-items: center;">
            <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Seleccionar Mes</div>
            <div style="display: flex; align-items: center; gap: 12px; width: 100%; justify-content: center;">
              <button class="btn btn-secondary btn-icon-only" id="report-month-prev" style="height: 38px; width: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">&larr;</button>
              <input type="month" id="report-month-input" value="${selectedMonth}" style="background: var(--bg-main); border: 1px solid var(--border-color); color: var(--text-main); font-family: var(--font-family); font-weight: 700; padding: 8px 16px; border-radius: var(--border-radius-sm); outline: none; text-align: center; font-size: 1rem;">
              <button class="btn btn-secondary btn-icon-only" id="report-month-next" style="height: 38px; width: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">&rarr;</button>
            </div>
            <div style="font-size: 0.9rem; font-weight: 600; color: var(--secondary); text-align: center; margin-top: 4px;">
              ${formattedMonthHeader.charAt(0).toUpperCase() + formattedMonthHeader.slice(1)}
            </div>
          </div>

          <!-- 1. KPIs Section -->
          <div class="reports-kpis-grid" style="margin-bottom: 16px;">
            <div class="reports-kpi-card kpi-total">
              <span class="reports-kpi-label">Ventas Netas</span>
              <span class="reports-kpi-val">${totalNet.toFixed(2)}€</span>
              <span style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${txCount} pedidos</span>
            </div>
            <div class="reports-kpi-card kpi-cash">
              <span class="reports-kpi-label">Efectivo (Neto)</span>
              <span class="reports-kpi-val" style="color:#f59e0b;">${cashSales.toFixed(2)}€</span>
            </div>
            <div class="reports-kpi-card kpi-card-pay">
              <span class="reports-kpi-label">Tarjeta (Neto)</span>
              <span class="reports-kpi-val" style="color:#3b82f6;">${cardSales.toFixed(2)}€</span>
            </div>
          </div>

          <!-- Export Action -->
          <div style="padding: 0 16px 16px 16px; display:grid; gap:10px;">
            <button class="btn btn-primary btn-full" id="btn-export-mensual" style="height: 44px; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; background-color: var(--secondary); color: white;">
              📅 Exportar Mensual (PDF)
            </button>
            <button class="btn btn-secondary btn-full" id="btn-export-mensual-excel" style="height: 44px; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;">
              Exportar Mensual Excel
            </button>
          </div>

          <!-- 4. Breakdown Table Section -->
          <div class="reports-items-section" style="padding: 0 16px;">
            <h3 style="margin:0 0 12px 0; font-size:1.05rem; font-weight:700; color:var(--text-main);">Desglose por Días</h3>
            <div style="overflow-x: auto; background: var(--bg-item); border: 1px solid var(--border-color); border-radius: var(--border-radius); padding: 8px;">
              <table class="reports-breakdown-table" style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                <thead>
                  <tr style="border-bottom: 1.5px solid var(--border-color); text-align: left; font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted);">
                    <th style="padding: 10px 8px;">Día</th>
                    <th style="padding: 10px 8px; text-align: right;">Pedidos</th>
                    <th style="padding: 10px 8px; text-align: right;">Efectivo</th>
                    <th style="padding: 10px 8px; text-align: right;">Tarjeta</th>
                    <th style="padding: 10px 8px; text-align: right;">Devoluciones</th>
                    <th style="padding: 10px 8px; text-align: right;">Total Neto</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRowsHTML ? tableRowsHTML : `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No hay ventas este mes</td></tr>`}
                </tbody>
                ${sortedDays.length > 0 ? `
                  <tfoot>
                    <tr style="border-top: 1.5px solid var(--border-color); font-weight: 700; background: rgba(0,0,0,0.02);">
                      <td style="padding: 10px 8px;">TOTAL</td>
                      <td style="padding: 10px 8px; text-align: right;">${txCount}</td>
                      <td style="padding: 10px 8px; text-align: right; color: #f59e0b;">${cashSales.toFixed(2)}€</td>
                      <td style="padding: 10px 8px; text-align: right; color: #3b82f6;">${cardSales.toFixed(2)}€</td>
                      <td style="padding: 10px 8px; text-align: right; color: var(--danger); font-size: 0.85rem;">-${totalRefunds.toFixed(2)}€</td>
                      <td style="padding: 10px 8px; text-align: right; color: var(--secondary); font-size: 1.05rem;">${totalNet.toFixed(2)}€</td>
                    </tr>
                  </tfoot>
                ` : ''}
              </table>
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
    const query = (state.articleSearchQuery || '').toLowerCase().trim();
    const filteredItems = query
      ? state.menuItems.filter(item => {
          const catName = (state.categories.find(c => c.id === item.category)?.name || '').toLowerCase();
          return item.name.toLowerCase().includes(query) || catName.includes(query);
        })
      : state.menuItems;

    const rows = filteredItems.map(item => {
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
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 class="settings-nav-title" style="margin-bottom:0;">Todos los artículos</h2>
          <button class="btn btn-primary" id="settings-create-article-btn" style="height:36px; padding:0 12px; font-size:0.85rem; background-color:var(--secondary);">
            + Crear Artículo
          </button>
        </div>
        <div style="position:relative; margin-bottom:10px;">
          <svg style="position:absolute; left:12px; top:50%; transform:translateY(-50%); width:16px; height:16px; color:var(--text-muted); pointer-events:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            id="article-search-input"
            type="text"
            placeholder="Buscar artículo o categoría..."
            value="${query.replace(/"/g, '&quot;')}"
            autocomplete="off"
            style="width:100%; padding:9px 12px 9px 36px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:10px; color:var(--text-main); font-family:var(--font-family); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
          >
        </div>
        <div class="settings-tree-list" style="padding-bottom: 24px;">
          ${rows.length > 0
            ? rows
            : `<p style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.85rem;">${query ? 'No se encontraron resultados.' : 'No hay artículos creados.'}</p>`
          }
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

          <div class="editor-form-group">
            <label class="editor-form-label">Imagen del artículo</label>
            <div style="display: flex; align-items: center; gap: 16px;">
              <div id="article-image-preview" data-image-base64="" style="width: 80px; height: 80px; border-radius: var(--border-radius-sm); border: 1px solid var(--border-color); background-size: cover; background-position: center; background-color: var(--bg-item); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
                <span style="font-size: 1.5rem; color: var(--text-muted);">📷</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <button type="button" class="btn btn-secondary" id="btn-select-article-image" style="height: 36px; font-size: 0.85rem; padding: 0 12px; font-weight:600;">Elegir foto de mi móvil</button>
                <button type="button" class="btn btn-secondary" id="btn-remove-article-image" style="height: 36px; font-size: 0.85rem; padding: 0 12px; color: var(--danger); border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); display: none; font-weight:600;">Quitar foto</button>
                <input type="file" id="article-image-file-input" accept="image/*" style="display: none;">
              </div>
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

          <div class="editor-form-group">
            <label class="editor-form-label">Imagen del artículo</label>
            <div style="display: flex; align-items: center; gap: 16px;">
              <div id="article-image-preview" data-image-base64="${item.image || ''}" style="width: 80px; height: 80px; border-radius: var(--border-radius-sm); border: 1px solid var(--border-color); background-size: cover; background-position: center; background-color: var(--bg-item); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; ${item.image ? `background-image: url('${item.image}');` : ''}">
                ${item.image ? '' : '<span style="font-size: 1.5rem; color: var(--text-muted);">📷</span>'}
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <button type="button" class="btn btn-secondary" id="btn-select-article-image" style="height: 36px; font-size: 0.85rem; padding: 0 12px; font-weight:600;">Elegir foto de mi móvil</button>
                <button type="button" class="btn btn-secondary" id="btn-remove-article-image" style="height: 36px; font-size: 0.85rem; padding: 0 12px; color: var(--danger); border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); ${item.image ? '' : 'display: none;'} font-weight:600;">Quitar foto</button>
                <input type="file" id="article-image-file-input" accept="image/*" style="display: none;">
              </div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; margin-top:24px;">
            <button class="btn btn-secondary" id="edit-item-delete-btn" data-delete-item-id="${item.id}" style="background-color: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger); display:flex; align-items:center; justify-content:center; gap:6px;">
              ${ICONS.trash} Eliminar
            </button>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-secondary" id="edit-item-cancel-btn">Cancelar</button>
              <button class="btn btn-primary" id="edit-item-save-btn" data-save-item-id="${item.id}" style="background-color: var(--secondary);">Guardar</button>
            </div>
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

    const options = mod.options || [];
    const optionsList = options.map((opt, idx) => `
      <div class="mod-option-row" data-option-index="${idx}">
        <div class="mod-option-info">
          <strong class="mod-option-name">${opt.name}</strong>
          <span class="mod-option-price">+${opt.price.toFixed(2)}€</span>
        </div>
        <div class="mod-option-actions">
          <button class="mod-option-btn btn-move-up-option" data-option-index="${idx}" title="Subir" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="mod-option-btn btn-move-down-option" data-option-index="${idx}" title="Bajar" ${idx === options.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="mod-option-btn btn-edit-option" data-option-index="${idx}" title="Editar">✏️</button>
          <button class="mod-option-btn btn-delete-option" data-option-index="${idx}" title="Eliminar" style="color:var(--danger);">✕</button>
        </div>
      </div>
    `).join('');

    const assignedCount = (mod.assignedItems || []).length;
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
            <div id="edit-mod-options-container" style="max-height:260px; overflow-y:auto; margin-bottom:8px;">
              ${options.length > 0 ? optionsList : '<p style="font-size:0.85rem; color:var(--text-muted); padding:4px 0;">No hay opciones creadas.</p>'}
            </div>
            
            <!-- Add/Edit Option Form -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--border-radius-sm); padding:10px; margin-top:4px;">
              <div style="font-size:0.78rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px;" id="option-form-label">Nueva opción</div>
              <input type="hidden" id="edit-opt-index" value="">
              <div style="display:grid; grid-template-columns: 2fr 1fr auto auto; gap:8px;">
                <input type="text" class="editor-form-input" id="new-opt-name" placeholder="Nombre opción" style="height:38px; padding:8px; font-size:0.9rem;">
                <input type="number" step="0.01" class="editor-form-input" id="new-opt-price" placeholder="0.00" style="height:38px; padding:8px; font-size:0.9rem;">
                <button class="btn btn-primary" id="btn-add-mod-option" style="height:38px; background-color:var(--secondary); border-color:var(--secondary); font-size:0.85rem; padding:0 12px; white-space:nowrap;">
                  Guardar
                </button>
                <button class="btn btn-secondary" id="btn-cancel-edit-option" style="height:38px; font-size:0.85rem; padding:0 10px; display:none;">
                  Cancelar
                </button>
              </div>
            </div>
          </div>

          <!-- Assignment Section (collapsible) -->
          <div class="editor-form-group" style="margin-top:24px;">
            <button type="button" id="toggle-assigned-items-btn" style="display:flex; align-items:center; justify-content:space-between; width:100%; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--border-radius-sm); padding:10px 14px; cursor:pointer; font-size:0.9rem; font-weight:600; color:var(--text-main);">
              <span>Artículos asignados <span style="font-weight:400; color:var(--text-muted); font-size:0.82rem;">(${assignedCount} asignado${assignedCount !== 1 ? 's' : ''})</span></span>
              <span id="assigned-toggle-icon" style="transition:transform 0.2s;">▼</span>
            </button>
            <div id="assigned-items-panel" style="display:none; margin-top:8px;">
              <div class="assigned-items-grid" id="edit-mod-assignment-grid">
                ${assignedChecklist}
              </div>
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
        <span class="ticket-item-modifiers ticket-item-base-price" style="cursor: pointer; text-decoration: underline dashed 1px; text-underline-offset: 2px;" title="Editar precio base">${item.price.toFixed(2)}€ x ud.</span>
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
        ${item.note ? `<div class="ticket-item-note">Nota: ${escapeHtml(item.note)}</div>` : ''}
        <div class="ticket-item-tools">
          <button class="ticket-defer-btn ${item.deferUntilLater ? 'active' : ''}" data-defer-ticket-item-id="${item.ticketItemId}" type="button">
                    ${item.deferUntilLater ? 'Para después' : 'Servir ahora'}
                  </button>
          <button class="ticket-note-btn ${item.note ? 'active' : ''}" data-note-ticket-item-id="${item.ticketItemId}" type="button">
            ${item.note ? 'Editar nota' : 'Nota'}
          </button>
        </div>
      </div>
      <div class="ticket-item-qty-actions">
        <button class="qty-btn qty-minus-btn" data-ticket-item-id="${item.ticketItemId}">-</button>
        <span class="ticket-item-qty">${item.qty}</span>
        <button class="qty-btn qty-plus-btn" data-ticket-item-id="${item.ticketItemId}">+</button>
      </div>
      <span class="ticket-item-total ticket-item-total-price" style="cursor: pointer; text-decoration: underline dashed 1px; text-underline-offset: 2px;" title="Editar precio base">${store.getItemTotal(item).toFixed(2)}€</span>
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
      <button class="pay-btn-opt danger" id="split-clear-btn">Vaciar</button>
    </div>
  ` : `
    <div class="empty-ticket-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:40px; height:40px;">
        <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      </svg>
      <p style="margin-top: 8px;">Ticket vacío</p>
    </div>
  `;

  const reassignButton = table ? `
    <button class="ticket-reassign-btn" title="Reasignar/Mover Mesa">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; display: block;">
        <path d="M17 2.1l4 4-4 4" />
        <path d="M3 12.2v-2a4 4 0 0 1 4-4h14" />
        <path d="M7 21.9l-4-4 4-4" />
        <path d="M21 11.8v2a4 4 0 0 1-4 4H3" />
      </svg>
    </button>
  ` : '';

  return `
    <div class="ticket-header">
      <span class="ticket-header-title">Ticket de Servicio</span>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="ticket-header-table" style="color:var(--primary); font-weight:700;">${tableName}</span>
        ${reassignButton}
      </div>
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
        <span class="ticket-item-modifiers ticket-item-base-price" style="cursor: pointer; text-decoration: underline dashed 1px; text-underline-offset: 2px;" title="Editar precio base">${item.price.toFixed(2)}€ x ud.</span>
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
        ${item.note ? `<div class="ticket-item-note">Nota: ${escapeHtml(item.note)}</div>` : ''}
        <div class="ticket-item-tools">
          <button class="ticket-defer-btn ${item.deferUntilLater ? 'active' : ''}" data-defer-ticket-item-id="${item.ticketItemId}" type="button">
                    ${item.deferUntilLater ? 'Para después' : 'Servir ahora'}
                  </button>
          <button class="ticket-note-btn ${item.note ? 'active' : ''}" data-note-ticket-item-id="${item.ticketItemId}" type="button">
            ${item.note ? 'Editar nota' : 'Nota'}
          </button>
        </div>
      </div>
      <div class="ticket-item-qty-actions">
        <button class="qty-btn qty-minus-btn" data-ticket-item-id="${item.ticketItemId}">-</button>
        <span class="ticket-item-qty">${item.qty}</span>
        <button class="qty-btn qty-plus-btn" data-ticket-item-id="${item.ticketItemId}">+</button>
      </div>
      <span class="ticket-item-total ticket-item-total-price" style="cursor: pointer; text-decoration: underline dashed 1px; text-underline-offset: 2px;" title="Editar precio base">${store.getItemTotal(item).toFixed(2)}€</span>
    </div>
  `).join('');

  const total = store.getActiveTicketTotal();
  const tax = total * 0.10;
  const subtotal = total - tax;

  const reassignButton = table ? `
    <button class="ticket-reassign-btn" title="Reasignar/Mover Mesa">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; display: block;">
        <path d="M17 2.1l4 4-4 4" />
        <path d="M3 12.2v-2a4 4 0 0 1 4-4h14" />
        <path d="M7 21.9l-4-4 4-4" />
        <path d="M21 11.8v2a4 4 0 0 1-4 4H3" />
      </svg>
    </button>
  ` : '';

  return `
    <div class="drawer-overlay" id="drawer-backdrop">
      <div class="drawer-content">
        <div class="drawer-close-indicator" id="drawer-pull-bar"></div>
        <div class="drawer-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="drawer-title">Pedido Actual</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="drawer-table-sel">${tableName}</span>
            ${reassignButton}
          </div>
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
            <button class="pay-btn-opt danger" id="drawer-clear-btn">Vaciar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function setupTicketOnlyEventListeners(container) {
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

  container.querySelectorAll('.ticket-defer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticketItemId = btn.dataset.deferTicketItemId;
      if (ticketItemId) store.toggleTicketItemDeferred(ticketItemId);
    });
  });

  container.querySelectorAll('.ticket-note-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticketItemId = btn.dataset.noteTicketItemId;
      if (ticketItemId) showItemNoteModal(ticketItemId);
    });
  });

  container.querySelectorAll('.ticket-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.ticket-item-qty-actions')) return;
      if (e.target.closest('.ticket-defer-btn')) return;
      if (e.target.closest('.ticket-note-btn')) return;
      const itemId = row.dataset.itemId;
      const ticketItemId = row.dataset.ticketItemId;
      if (itemHasModifiers(itemId) && ticketItemId) {
        showModifierSelectionModal(itemId, ticketItemId);
      }
    });
  });

  container.querySelectorAll('.ticket-item-base-price, .ticket-item-total-price').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = el.closest('.ticket-item');
      if (!row) return;
      const ticketItemId = row.dataset.ticketItemId;
      const item = store.getActiveItems().find(i => i.ticketItemId === ticketItemId);
      if (item) showPriceEditModal(ticketItemId, item.price);
    });
  });

  const drawerPull = container.querySelector('#drawer-pull-bar');
  if (drawerPull) {
    drawerPull.addEventListener('click', () => {
      isDrawerOpen = false;
      store.notify();
    });
  }

  const drawerClear = container.querySelector('#drawer-clear-btn');
  if (drawerClear) {
    drawerClear.addEventListener('click', () => {
      showConfirm(
        'Vaciar Pedido',
        '¿Seguro que deseas vaciar el pedido actual?',
        () => {
          store.clearActiveTicket();
          isDrawerOpen = false;
        },
        null,
        true
      );
    });
  }

  const drawerPrint = container.querySelector('#drawer-print-btn');
  if (drawerPrint) {
    drawerPrint.addEventListener('click', () => {
      showToast('Imprimiendo pre-factura del ticket...', 'success');
      store.printBill();
      isDrawerOpen = false;
    });
  }

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

  const splitClear = container.querySelector('#split-clear-btn');
  if (splitClear) {
    splitClear.addEventListener('click', () => {
      showConfirm('Vaciar Pedido', '¿Seguro que deseas vaciar el pedido actual?', () => {
        store.clearActiveTicket();
      }, null, true);
    });
  }

  const splitPayBtn = container.querySelector('#split-pay-btn');
  if (splitPayBtn) {
    splitPayBtn.addEventListener('click', () => {
      showPaymentModal(store.getActiveTicketTotal());
    });
  }

  const splitSaveOrderBtn = container.querySelector('#split-save-order-btn');
  if (splitSaveOrderBtn) {
    splitSaveOrderBtn.addEventListener('click', () => {
      store.saveActiveOrder();
      showToast('Comanda guardada.', 'success');
    });
  }

  container.querySelectorAll('.ticket-reassign-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showReassignTableModal();
    });
  });
}

function refreshDrawerOverlay() {
  const existing = document.getElementById('drawer-backdrop');
  const html = renderDrawerOverlay();

  if (!html) {
    if (existing) existing.remove();
    return true;
  }

  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const freshOverlay = template.content.querySelector('#drawer-backdrop');
  if (!freshOverlay) return false;

  if (!existing) {
    document.body.appendChild(freshOverlay);
    freshOverlay.addEventListener('click', (e) => {
      if (e.target.id === 'drawer-backdrop') {
        isDrawerOpen = false;
        store.notify();
      }
    });
    setupTicketOnlyEventListeners(freshOverlay);
    return true;
  }

  const currentContent = existing.querySelector('.drawer-content');
  const freshContent = freshOverlay.querySelector('.drawer-content');
  if (!currentContent || !freshContent) {
    existing.replaceWith(freshOverlay);
    setupTicketOnlyEventListeners(freshOverlay);
    return true;
  }

  currentContent.innerHTML = freshContent.innerHTML;
  setupTicketOnlyEventListeners(currentContent);
  return true;
}

function renderTicketOnly() {
  const isDesktop = window.innerWidth >= 768;
  if (isDesktop && store.state.activeTab === 'inicio') {
    const splitTicket = document.querySelector('.pos-split-ticket');
    if (!splitTicket) return false;
    splitTicket.innerHTML = renderInlineTicketPanel();
    setupTicketOnlyEventListeners(splitTicket);
    return true;
  }

  if (isDrawerOpen) {
    return refreshDrawerOverlay();
  }

  return false;
}

const SCROLL_PRESERVE_SELECTORS = [
  '.app-workspace',
  '.tables-view',
  '.products-scroll-area',
  '.tx-history-list',
  '.settings-tree-list',
  '.settings-editor-container',
  '.loyalty-admin-panel',
  '.gemini-import-panel',
  '.pos-split-grid > div',
  '.pos-grid-container > div',
  '.drawer-content .ticket-list'
];

function getScrollViewKey(state = store.state) {
  return [
    state.activeTab,
    state.activePosTab,
    (state.gridPath || []).join('/'),
    (state.settingsPath || []).join('/')
  ].join('|');
}

function captureScrollState(state = store.state) {
  const positions = [];

  SCROLL_PRESERVE_SELECTORS.forEach(selector => {
    document.querySelectorAll(selector).forEach((el, index) => {
      if (el.scrollTop > 0 || el.scrollLeft > 0) {
        positions.push({
          selector,
          index,
          top: el.scrollTop,
          left: el.scrollLeft
        });
      }
    });
  });

  return {
    key: getScrollViewKey(state),
    windowX: window.scrollX || 0,
    windowY: window.scrollY || 0,
    positions
  };
}

function restoreScrollState(snapshot, state = store.state) {
  if (!snapshot || snapshot.key !== getScrollViewKey(state)) return;

  snapshot.positions.forEach(pos => {
    const el = document.querySelectorAll(pos.selector)[pos.index];
    if (!el) return;
    el.scrollTop = pos.top;
    el.scrollLeft = pos.left;
  });

  if (snapshot.windowX || snapshot.windowY) {
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  }
}

// Master Shell Render Engine
function render(state = store.state) {
  const appRoot = document.getElementById('app-root');
  if (!appRoot) return;

  const isDesktop = window.innerWidth >= 768;

  // Sync Theme CSS
  let isLight = false;
  if (state.theme === 'light') {
    isLight = true;
  } else if (state.theme === 'system') {
    isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  if (isLight) {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }

  if (!state.auth.profile) {
    appRoot.innerHTML = renderAuthView(state);
    setupAuthEventListeners(appRoot);
    return;
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
    workspaceHTML = store.canAccessSettings() ? renderAjustesView(state) : renderTablesView(state);
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
    </div>
  `;

  setupEventListeners(appRoot);
  refreshDrawerOverlay();
}

function setupAuthEventListeners(container) {
  const form = container.querySelector('#staff-login-form');
  if (!form) return;
  const pinInput = container.querySelector('#staff-pin-input');

  const updatePinDots = () => {
    const length = pinInput?.value.length || 0;
    const dotsContainer = container.querySelector('.pin-dots');
    if (!dotsContainer) return;
    const totalDots = Math.max(4, length);
    let html = '';
    for (let i = 0; i < totalDots; i++) {
      if (i < length) {
        html += '<span class="is-filled"></span>';
      } else {
        html += '<span></span>';
      }
    }
    dotsContainer.innerHTML = html;
  };

  container.querySelectorAll('[data-pin-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!pinInput || pinInput.value.length >= 8) return;
      pinInput.value = `${pinInput.value}${btn.dataset.pinKey}`;
      updatePinDots();
    });
  });

  const clearBtn = container.querySelector('[data-pin-clear]');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!pinInput) return;
      pinInput.value = '';
      updatePinDots();
    });
  }

  const backBtn = container.querySelector('[data-pin-back]');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (!pinInput) return;
      pinInput.value = pinInput.value.slice(0, -1);
      updatePinDots();
    });
  }

  if (pinInput) {
    pinInput.addEventListener('input', () => {
      pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 8);
      updatePinDots();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pinCode = pinInput?.value || '';
    if (pinCode.length < 4 || pinCode.length > 8) return;

    const submitBtn = container.querySelector('.auth-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Entrando...';
    }

    try {
      await store.signInWithPin(pinCode);
      dbStatus = 'loading';
      render(store.state);
      const loaded = await store.loadFromSupabase();
      dbStatus = loaded ? 'connected' : 'fallback';
      render(store.state);
    } catch (err) {
      showToast('Codigo incorrecto.', 'error');
      if (pinInput) {
        pinInput.value = '';
        updatePinDots();
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar';
      }
    }
  });
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
  const isEditingExistingItem = Boolean(ticketItemId);
  let itemQuantity = 1;
  let initialItemNote = '';

  // Find existing selected options if editing
  let initialSelectedOptions = [];
  if (ticketItemId) {
    const activeItems = store.getActiveItems();
    const existingItem = activeItems.find(i => i.ticketItemId === ticketItemId);
    if (existingItem) {
      initialSelectedOptions = existingItem.selectedOptions || [];
      initialItemNote = existingItem.note || '';
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
  modal.classList.add('modifier-selection-backdrop');

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
    const finalTotal = total * itemQuantity;
    const saveBtn = modal.querySelector('#modifier-save-btn');
    const itemQtyVal = modal.querySelector('#modifier-item-qty-val');
    if (itemQtyVal) itemQtyVal.innerText = itemQuantity;
    if (saveBtn) {
      saveBtn.innerText = isEditingExistingItem
        ? 'Guardar Cambios' 
        : `Añadir ${itemQuantity} · ${finalTotal.toFixed(2)}€`;
    }
  };

  modal.innerHTML = `
    <div class="modal-dialog modifier-selection-dialog">
      <div class="modal-header">
        <h3 class="modifier-selection-title">
          ${ticketItemId ? 'Editar' : 'Personalizar'} ${item.name}
        </h3>
        <div class="modifier-selection-subtitle">
          Precio base: ${item.price.toFixed(2)}€
        </div>
      </div>
      <div class="modal-body modifier-selection-body">
        ${!isEditingExistingItem ? `
          <div class="modifier-item-quantity">
            <div>
              <span class="modifier-item-quantity-label">Cantidad</span>
              <strong>${item.name}</strong>
            </div>
            <div class="modifier-item-quantity-controls">
              <button class="modifier-qty-btn" id="modifier-item-qty-minus" type="button" aria-label="Restar unidad">-</button>
              <span class="modifier-item-qty-val" id="modifier-item-qty-val">1</span>
              <button class="modifier-qty-btn" id="modifier-item-qty-plus" type="button" aria-label="Sumar unidad">+</button>
            </div>
          </div>
        ` : ''}
        ${modifiersHTML}
        <div class="modifier-note-group">
          <label class="modifier-note-label" for="modifier-item-note">Nota para cocina</label>
          <textarea class="modifier-note-input" id="modifier-item-note" rows="3" maxlength="180" placeholder="Ej: sin nata, poco hecho, sacar al final...">${escapeHtml(initialItemNote)}</textarea>
        </div>
      </div>
      <div class="modal-footer modifier-selection-footer">
        <button class="btn btn-secondary modifier-selection-action modifier-selection-cancel" id="modifier-cancel-btn">Cancelar</button>
        <button class="btn btn-primary" id="modifier-save-btn" style="background-color: var(--secondary); border-color: var(--secondary); height:44px; padding:0 24px; border-radius: var(--border-radius-md); font-weight:600; cursor:pointer; color: white;">Añadir</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add('modal-open');
  updateModalTotal();

  if (!isEditingExistingItem) {
    const itemQtyMinus = modal.querySelector('#modifier-item-qty-minus');
    const itemQtyPlus = modal.querySelector('#modifier-item-qty-plus');

    itemQtyMinus?.addEventListener('click', () => {
      if (itemQuantity <= 1) return;
      itemQuantity--;
      updateModalTotal();
    });

    itemQtyPlus?.addEventListener('click', () => {
      itemQuantity++;
      updateModalTotal();
    });
  }

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

  const closeModifierModal = () => {
    document.body.classList.remove('modal-open');
    modal.remove();
  };

  modal.querySelector('#modifier-cancel-btn').addEventListener('click', () => {
    closeModifierModal();
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

    const itemNote = modal.querySelector('#modifier-item-note')?.value || '';

    if (ticketItemId) {
      store.updateTicketItemModifiers(ticketItemId, selectedOptions);
      store.updateTicketItemNote(ticketItemId, itemNote);
    } else {
      store.addItemToActiveTicket(itemId, selectedOptions, itemQuantity, itemNote);
    }

    closeModifierModal();
  });
}

// Modal de confirmación estilizado
function showItemNoteModal(ticketItemId) {
  const item = store.getActiveItems().find(i => i.ticketItemId === ticketItemId);
  if (!item) return;

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'item-note-modal';
  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 420px; width: 92%;">
      <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px;">
        <h3 style="margin:0; font-size:1.15rem; font-weight:800;">Nota para ${escapeHtml(item.name)}</h3>
      </div>
      <div class="modal-body">
        <label class="modifier-note-label" for="ticket-item-note-input">Instruccion para cocina</label>
        <textarea class="modifier-note-input" id="ticket-item-note-input" rows="4" maxlength="180" placeholder="Ej: sin nata, sacar al final, poco hecho...">${escapeHtml(item.note || '')}</textarea>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:12px; margin-top:18px; border-top: 1px solid var(--border-color); padding-top: 16px;">
        <button class="btn btn-secondary" id="item-note-clear-btn" style="height:44px; padding:0 18px; background-color: var(--bg-item); color: var(--text-main); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); font-weight:700; cursor:pointer;">Borrar</button>
        <button class="btn btn-secondary" id="item-note-cancel-btn" style="height:44px; padding:0 18px; background-color: var(--bg-item); color: var(--text-main); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); font-weight:700; cursor:pointer;">Cancelar</button>
        <button class="btn btn-primary" id="item-note-save-btn" style="height:44px; padding:0 22px; background-color: var(--secondary); color:white; border: 1px solid var(--secondary); border-radius: var(--border-radius-md); font-weight:800; cursor:pointer;">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const input = modal.querySelector('#ticket-item-note-input');
  const save = () => {
    store.updateTicketItemNote(ticketItemId, input?.value || '');
    modal.remove();
  };

  modal.querySelector('#item-note-cancel-btn')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#item-note-clear-btn')?.addEventListener('click', () => {
    store.updateTicketItemNote(ticketItemId, '');
    modal.remove();
  });
  modal.querySelector('#item-note-save-btn')?.addEventListener('click', save);
  input?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
  });
  setTimeout(() => input?.focus(), 30);
}

function showConfirm(title, message, onConfirm, onCancel = null, isDanger = false) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'confirm-dialog-modal';
  
  const confirmBtnBg = isDanger ? 'var(--danger)' : 'var(--secondary)';

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 400px; width: 90%; text-align: center; padding: 24px; border-radius: var(--border-radius-lg); background: var(--bg-panel); border: 1px solid var(--border-color); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5); animation: slideUp 0.2s ease;">
      <h3 style="margin: 0 0 10px 0; font-size: 1.25rem; font-weight: 700; color: var(--text-main);">${title}</h3>
      <p style="margin: 0 0 24px 0; font-size: 0.9rem; color: var(--text-muted); line-height: 1.45; word-break: break-word; white-space: pre-line;">${message}</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <button class="btn btn-secondary" id="confirm-cancel-btn" style="height: 44px; font-weight: 600; border-radius: var(--border-radius-md); background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer; font-size: 0.85rem; transition: background 0.2s;">Cancelar</button>
        <button class="btn btn-primary" id="confirm-ok-btn" style="height: 44px; font-weight: 600; border-radius: var(--border-radius-md); background: ${confirmBtnBg}; border: none; color: white; cursor: pointer; font-size: 0.85rem; transition: opacity 0.2s;">Aceptar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#confirm-cancel-btn').addEventListener('click', () => {
    modal.remove();
    if (onCancel) onCancel();
  });

  modal.querySelector('#confirm-ok-btn').addEventListener('click', () => {
    modal.remove();
    if (onConfirm) onConfirm();
  });
}

// Modal para elegir en qué mesa guardar la comanda
function showAdminPinModal({ title = 'Confirmar administrador', onConfirm }) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'admin-pin-modal';
  modal.style.zIndex = '1200';

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 360px; width: 92%; padding: 22px; text-align: center;">
      <h3 style="margin:0 0 8px; font-size:1.15rem; font-weight:800; color:var(--text-main);">${title}</h3>
      <p style="margin:0 0 16px; color:var(--text-muted); font-size:0.86rem; line-height:1.35;">Introduce el PIN de administrador para continuar.</p>
      <input id="admin-pin-input" class="search-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="PIN admin" style="margin:0 0 16px; text-align:center; font-size:1.25rem; font-weight:800; letter-spacing:0.12em;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <button class="btn btn-secondary" id="admin-pin-cancel-btn" style="height:42px; font-weight:700;">Cancelar</button>
        <button class="btn btn-primary" id="admin-pin-confirm-btn" style="height:42px; font-weight:700; background:var(--secondary); border-color:var(--secondary); color:white;">Aceptar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const input = modal.querySelector('#admin-pin-input');
  const close = () => modal.remove();
  const confirm = async () => {
    const pinCode = (input?.value || '').trim();
    if (!pinCode) return;
    const adminProfile = await store.verifyAdminPin(pinCode);
    if (!adminProfile) {
      showToast('PIN de administrador no valido.', 'error');
      return;
    }
    close();
    if (onConfirm) onConfirm(adminProfile);
  };

  modal.querySelector('#admin-pin-cancel-btn').addEventListener('click', close);
  modal.querySelector('#admin-pin-confirm-btn').addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirm();
  });
  setTimeout(() => input.focus(), 30);
}

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
        showConfirm(
          'Mesa Ocupada',
          `La ${table.name} ya tiene una comanda activa.\n¿Deseas añadir estos artículos a la cuenta existente?`,
          () => {
            store.saveActiveOrderToTable(tableId);
            modal.remove();
            showToast(`Comanda añadida a la ${table.name}.`, 'success');
          }
        );
      } else {
        store.saveActiveOrderToTable(tableId);
        modal.remove();
        showToast(`Comanda guardada en la ${table.name}.`, 'success');
      }
    });
  });
}

// Modal para mover/reasignar comanda de mesa
function showReassignTableModal() {
  if (document.getElementById('table-reassign-modal')) return;

  const currentTable = store.getSelectedTable();
  if (!currentTable) {
    showToast('No hay ninguna mesa activa seleccionada.', 'warning');
    return;
  }

  const activeItems = store.getActiveItems();
  if (activeItems.length === 0) {
    showToast('No hay artículos en la comanda para mover.', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'table-reassign-modal';

  const tables = store.state.tables;
  const diningTables = tables.filter(t => (t.type || 'table') === 'table');
  const takeawayTables = tables.filter(t => t.type === 'takeaway');

  const renderTableButtons = (tableList) => {
    return tableList.map(table => {
      const total = store.getTableTotal(table);
      const itemCount = table.items.reduce((sum, item) => sum + item.qty, 0);
      const isOccupied = itemCount > 0;
      const isCurrent = currentTable.id === table.id;
      const statusClass = isCurrent ? 'current-table' : (isOccupied ? 'occupied' : 'available');
      const disabledAttr = isCurrent ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : '';

      return `
        <button class="modal-table-btn ${statusClass}" data-table-id="${table.id}" ${disabledAttr}>
          <span style="font-size: 0.95rem; font-weight: 700;">${table.name}</span>
          ${isCurrent 
            ? `<span class="table-badge" style="font-size: 0.7rem; font-weight: 700; color: var(--primary);">Actual</span>`
            : isOccupied 
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
        <h3 style="margin:0; font-size:1.2rem; font-weight:700;">Mover / Reasignar ${currentTable.name}</h3>
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
        <button class="btn btn-secondary" id="reassign-cancel-btn" style="height:40px; padding:0 16px; font-weight:600; border-radius:var(--border-radius-md); background:var(--bg-item); border:1px solid var(--border-color); color:var(--text-main); cursor:pointer; font-size:0.85rem;">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#reassign-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  modal.querySelectorAll('.modal-table-btn').forEach(btn => {
    if (btn.hasAttribute('disabled')) return;
    btn.addEventListener('click', () => {
      const tableId = parseInt(btn.dataset.tableId, 10);
      const table = store.state.tables.find(t => t.id === tableId);
      const isOccupied = table && table.items.length > 0;

      if (isOccupied) {
        showConfirm(
          'Combinar Comandas',
          `La ${table.name} ya tiene una comanda activa.\n¿Deseas combinar la comanda de la ${currentTable.name} con la ${table.name}?`,
          () => {
            const moved = store.moveActiveOrderToTable(tableId);
            if (moved) {
              isDrawerOpen = false;
              modal.remove();
              showToast(`Comanda de la ${currentTable.name} combinada con la ${table.name}.`, 'success');
            } else {
              showToast('No se pudo mover la comanda. Vuelve a seleccionar la mesa e intentalo otra vez.', 'error');
            }
          }
        );
      } else {
        const moved = store.moveActiveOrderToTable(tableId);
        if (moved) {
          isDrawerOpen = false;
          modal.remove();
          showToast(`Comanda movida de la ${currentTable.name} a la ${table.name}.`, 'success');
        } else {
          showToast('No se pudo mover la comanda. Vuelve a seleccionar la mesa e intentalo otra vez.', 'error');
        }
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

  let selectedMethod = 'Tarjeta'; // 'Tarjeta' | 'Efectivo' | 'Tarjeta Regalo' | 'Dividir'
  let splitType = 'iguales'; // 'iguales' | 'articulos' | 'libre'
  let cashReceived = totalAmount;
  let loyaltyRfidInput = '';
  let loyaltyCustomer = null;
  let loyaltyStatus = isLoyaltyConfigured ? '' : 'Configura fidelidad para activar RFID.';
  let loyaltyBusy = false;
  let giftCardCodeInput = '';
  let giftCardLookup = null;
  let giftCardStatus = '';
  let giftCardBusy = false;
  let giftCardRemainderMethod = 'Tarjeta';
  let giftCardScannerActive = false;
  let giftCardScannerControls = null;
  let giftCardScannerReader = null;

  const getEstimatedLoyaltyPoints = () => {
    if (!loyaltyCustomer) return 0;
    if (store.getActiveLoyaltyAward()) return 0;
    return calculateLoyaltyPoints(totalAmount, loyaltyCustomer.tier);
  };

  const identifyLoyaltyCustomer = async () => {
    const cleanUid = normalizeRfidUid(loyaltyRfidInput);
    if (!cleanUid) {
      loyaltyStatus = 'Escanea o introduce un RFID.';
      renderPaymentContent();
      return;
    }
    if (!isLoyaltyConfigured) {
      loyaltyStatus = 'Falta conectar la base de fidelidad.';
      renderPaymentContent();
      return;
    }

    loyaltyBusy = true;
    loyaltyStatus = 'Buscando cliente...';
    renderPaymentContent();

    try {
      const customer = await findLoyaltyCustomerByRfid(cleanUid);
      loyaltyCustomer = customer;
      loyaltyStatus = customer ? '' : 'Llavero no encontrado.';
    } catch (error) {
      console.warn(error);
      loyaltyCustomer = null;
      loyaltyStatus = error.message || 'No se pudo buscar el cliente.';
    } finally {
      loyaltyBusy = false;
      renderPaymentContent();
    }
  };

  const clearLoyaltyCustomer = () => {
    loyaltyCustomer = null;
    loyaltyRfidInput = '';
    loyaltyStatus = '';
    renderPaymentContent();
  };

  const awardManualLoyalty = () => {
    if (!loyaltyCustomer) {
      showToast('Identifica primero al cliente.', 'warning');
      return;
    }
    if (store.getActiveLoyaltyAward()) {
      showToast('Esta comanda ya tiene puntos asignados.', 'warning');
      return;
    }

    showAdminPinModal({
      title: 'Sumar puntos sin cobrar',
      onConfirm: async () => {
        try {
          const result = await addManualLoyaltyPointsWithoutPurchase({
            customer: loyaltyCustomer,
            amount: totalAmount
          });
          store.markActiveTicketLoyaltyAwarded({
            mode: 'manual',
            customerId: result.customerId,
            customerName: result.customerName,
            rfidUid: loyaltyCustomer.rfidUid,
            points: result.points,
            amount: totalAmount
          });
          modal.remove();
          showToast(`Puntos sumados a ${result.customerName}: +${result.points}. La comanda queda abierta.`, 'success');
        } catch (error) {
          console.warn(error);
          showToast(error.message || 'No se pudieron sumar los puntos.', 'error');
        }
      }
    });
  };

  const lookupGiftCard = async () => {
    const cleanCode = normalizeSquareGiftCardCode(giftCardCodeInput);
    if (!cleanCode) {
      giftCardStatus = 'Escanea o introduce el codigo de la tarjeta regalo.';
      renderPaymentContent();
      return;
    }

    giftCardBusy = true;
    giftCardStatus = 'Consultando saldo...';
    giftCardLookup = null;
    renderPaymentContent();

    try {
      const result = await lookupSquareGiftCard(cleanCode);
      giftCardLookup = result.giftCard || null;
      if (!giftCardLookup) {
        giftCardStatus = 'No se encontro la tarjeta regalo.';
      } else if (giftCardLookup.state !== 'ACTIVE') {
        giftCardStatus = `Tarjeta ${giftCardLookup.state || 'no activa'}.`;
      } else {
        giftCardStatus = '';
      }
    } catch (error) {
      console.warn(error);
      giftCardLookup = null;
      giftCardStatus = error.message || 'No se pudo consultar la tarjeta regalo.';
    } finally {
      giftCardBusy = false;
      renderPaymentContent();
    }
  };

  const stopGiftCardScanner = () => {
    if (giftCardScannerControls) {
      giftCardScannerControls.stop();
      giftCardScannerControls = null;
    }
    giftCardScannerReader = null;
    giftCardScannerActive = false;
  };

  const startGiftCardScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      giftCardStatus = 'Este navegador no permite usar la camara desde aqui.';
      renderPaymentContent();
      return;
    }

    stopGiftCardScanner();
    giftCardScannerActive = true;
    giftCardStatus = 'Abriendo camara...';
    renderPaymentContent();

    try {
      renderPaymentContent();

      const video = modal.querySelector('#gift-card-scanner-video');
      if (!video) throw new Error('No se pudo preparar el lector.');

      const [
        { BrowserMultiFormatReader },
        { BarcodeFormat, DecodeHintType }
      ] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library')
      ]);

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.MICRO_QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.CODABAR,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
        BarcodeFormat.PDF_417,
        BarcodeFormat.DATA_MATRIX
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      giftCardScannerReader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: 250
      });

      giftCardScannerControls = await giftCardScannerReader.decodeFromConstraints({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      }, video, (result) => {
        if (!result) return;
        const rawValue = result.getText();
        const normalized = normalizeSquareGiftCardCode(rawValue);
        if (!normalized) return;

        giftCardCodeInput = normalized;
        giftCardStatus = 'Codigo detectado. Consultando saldo...';
        giftCardLookup = null;
        stopGiftCardScanner();
        renderPaymentContent();
        void lookupGiftCard();
      });

      giftCardStatus = 'Apunta al QR o al codigo de barras de Square.';
    } catch (error) {
      console.warn(error);
      stopGiftCardScanner();
      giftCardStatus = error.name === 'NotAllowedError'
        ? 'Permiso de camara denegado. Revisa permisos del navegador.'
        : error.message || 'No se pudo abrir la camara.';
      renderPaymentContent();
    }
  };

  const payWithGiftCard = async () => {
    const cleanCode = normalizeSquareGiftCardCode(giftCardCodeInput);
    if (!cleanCode) {
      giftCardStatus = 'Escanea o introduce el codigo de la tarjeta regalo.';
      renderPaymentContent();
      return;
    }

    if (!giftCardLookup || giftCardLookup.gan !== cleanCode) {
      await lookupGiftCard();
      if (!giftCardLookup) return;
    }

    if (giftCardLookup.state !== 'ACTIVE') {
      giftCardStatus = 'La tarjeta regalo no esta activa.';
      renderPaymentContent();
      return;
    }

    const availableBalance = Number(giftCardLookup.balance || 0);
    const giftAmount = Number(Math.min(totalAmount, availableBalance).toFixed(2));
    const remainingAmount = Number(Math.max(0, totalAmount - giftAmount).toFixed(2));
    if (giftAmount <= 0) {
      giftCardStatus = 'La tarjeta regalo no tiene saldo disponible.';
      renderPaymentContent();
      return;
    }

    giftCardBusy = true;
    giftCardStatus = 'Canjeando tarjeta regalo...';
    renderPaymentContent();

    try {
      const referenceId = `tpv-${Date.now()}`;
      const result = await redeemSquareGiftCard({
        code: cleanCode,
        amount: giftAmount,
        referenceId
      });
      const payments = [{
        method: 'Tarjeta Regalo',
        amount: giftAmount,
        provider: 'Square',
        externalRef: result.activityId || result.referenceId || referenceId,
        giftCardId: result.giftCard?.id || giftCardLookup.id,
        giftCardLast4: result.giftCard?.last4 || giftCardLookup.last4,
        balanceAfter: result.giftCard?.balance
      }];

      if (remainingAmount > 0) {
        payments.push({
          method: giftCardRemainderMethod,
          amount: remainingAmount,
          provider: giftCardRemainderMethod === 'Tarjeta' ? 'BBVA' : ''
        });
      }

      const methodText = remainingAmount > 0 ? 'Mixto (Tarjeta regalo)' : 'Tarjeta Regalo';
      const message = remainingAmount > 0
        ? `Tarjeta regalo canjeada por ${giftAmount.toFixed(2)} euros. Resto cobrado en ${giftCardRemainderMethod}.`
        : 'Pago con tarjeta regalo registrado correctamente.';
      await completePaidTicket(methodText, message, payments);
    } catch (error) {
      console.warn(error);
      giftCardStatus = error.message || 'No se pudo canjear la tarjeta regalo.';
      showToast(giftCardStatus, 'error');
      giftCardBusy = false;
      renderPaymentContent();
    }
  };

  const completePaidTicket = async (paymentMethod, successMessage, paymentBreakdown = null) => {
    const loyaltySnapshot = loyaltyCustomer ? { ...loyaltyCustomer } : null;
    const existingLoyaltyAward = store.getActiveLoyaltyAward();
    const transaction = store.payActiveTicket(paymentMethod, loyaltySnapshot ? {
      loyaltyCustomer: {
        id: loyaltySnapshot.id,
        name: loyaltySnapshot.name,
        rfidUid: loyaltySnapshot.rfidUid,
        tier: loyaltySnapshot.tier
      },
      ...(paymentBreakdown ? { payments: paymentBreakdown } : {})
    } : (paymentBreakdown ? { payments: paymentBreakdown } : {}));

    if (transaction && loyaltySnapshot && !existingLoyaltyAward) {
      try {
        const result = await addLoyaltyPurchase({
          customer: loyaltySnapshot,
          amount: transaction.total,
          transactionId: transaction.id,
          paymentMethod
        });
        showToast(`${successMessage} +${result.points} puntos para ${result.customerName}.`, 'success');
      } catch (error) {
        console.warn(error);
        showToast('Venta cobrada, pero no se pudieron sumar los puntos.', 'warning');
      }
    } else if (transaction && existingLoyaltyAward) {
      showToast(`${successMessage} Puntos ya asignados anteriormente a ${existingLoyaltyAward.customerName}.`, 'success');
    } else {
      showToast(successMessage, 'success');
    }

    isDrawerOpen = false;
    stopGiftCardScanner();
    modal.remove();
  };

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
    const isGiftCard = selectedMethod === 'Tarjeta Regalo';
    const existingLoyaltyAward = store.getActiveLoyaltyAward();
    const loyaltyPoints = getEstimatedLoyaltyPoints();
    const giftCardBalance = Number(giftCardLookup?.balance || 0);
    const giftCardRedeemAmount = Number(Math.min(totalAmount, giftCardBalance).toFixed(2));
    const giftCardRemainingAmount = Number(Math.max(0, totalAmount - giftCardRedeemAmount).toFixed(2));
    const loyaltyHTML = `
      <div class="payment-loyalty-box">
        <div class="payment-loyalty-header">
          <span>Cliente fidelidad</span>
          ${loyaltyCustomer ? `<button type="button" class="payment-loyalty-link" id="loyalty-clear-btn">Quitar</button>` : ''}
        </div>
        ${loyaltyCustomer ? `
          <div class="payment-loyalty-customer">
            <div>
              <strong>${loyaltyCustomer.name}</strong>
              <small>${loyaltyCustomer.tier} · ${loyaltyCustomer.points.toLocaleString('es-ES')} pts</small>
            </div>
            <div class="payment-loyalty-points">+${loyaltyPoints} pts</div>
          </div>
        ` : `
          <div class="payment-loyalty-search">
            <input type="text" class="search-input" id="loyalty-rfid-input" value="${loyaltyRfidInput}" placeholder="Escanear RFID" ${!isLoyaltyConfigured || loyaltyBusy ? 'disabled' : ''}>
            <button type="button" class="btn btn-secondary" id="loyalty-search-btn" ${!isLoyaltyConfigured || loyaltyBusy ? 'disabled' : ''}>
              ${loyaltyBusy ? '...' : 'Buscar'}
            </button>
          </div>
          ${loyaltyStatus ? `<p class="payment-loyalty-status">${loyaltyStatus}</p>` : ''}
        `}
        ${existingLoyaltyAward ? `
          <p class="payment-loyalty-status payment-loyalty-status--awarded">
            Puntos ya asignados a ${existingLoyaltyAward.customerName}: +${existingLoyaltyAward.points}.
          </p>
        ` : ''}
        <button type="button" class="payment-loyalty-manual-btn" id="loyalty-manual-award-btn" ${!loyaltyCustomer || existingLoyaltyAward ? 'disabled' : ''}>
          ${existingLoyaltyAward ? 'Puntos ya asignados en esta comanda' : loyaltyCustomer ? 'Sumar puntos sin cobrar' : 'Identifica cliente para sumar sin cobrar'}
        </button>
      </div>
    `;

    let methodSpecificHTML = '';
    if (isEfectivo) {
      methodSpecificHTML = `
        <div class="payment-cash-section" style="margin-top: 16px; animation: fadeIn 0.2s ease;">
          <div class="editor-form-group">
            <label class="editor-form-label">Efectivo entregado por el cliente</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="text" class="search-input" id="cash-received-input" readonly placeholder="${totalAmount.toFixed(2)}" value="${(cashReceived === totalAmount || cashReceived === 0) ? '' : cashReceived.toFixed(2)}" style="font-size:1.3rem; text-align:right; font-weight:700; flex:1; height: 48px; padding-right:12px; background:var(--bg-panel); color:var(--text-main); border:1px solid var(--border-color); border-radius:var(--border-radius-md); cursor: pointer;">
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
    } else if (isGiftCard) {
      methodSpecificHTML = `
        <div class="payment-gift-card-section" style="margin-top: 16px; animation: fadeIn 0.2s ease;">
          <div class="editor-form-group">
            <label class="editor-form-label">Codigo de tarjeta regalo Square</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="text" class="search-input" id="gift-card-code-input" value="${giftCardCodeInput}" placeholder="Escanear QR o introducir codigo" ${giftCardBusy ? 'disabled' : ''} style="flex:1;">
              <button type="button" class="btn btn-secondary" id="gift-card-scan-btn" ${giftCardBusy ? 'disabled' : ''}>
                ${giftCardScannerActive ? 'Cerrar' : 'Camara'}
              </button>
              <button type="button" class="btn btn-secondary" id="gift-card-lookup-btn" ${giftCardBusy ? 'disabled' : ''}>
                ${giftCardBusy ? '...' : 'Saldo'}
              </button>
            </div>
          </div>

          ${giftCardStatus ? `<p class="payment-loyalty-status" style="margin-top:8px;">${giftCardStatus}</p>` : ''}

          ${giftCardScannerActive ? `
            <div style="position:relative; overflow:hidden; background:#000; border:1px solid var(--border-color); border-radius:var(--border-radius-md); margin-top:12px; aspect-ratio: 4 / 3;">
              <video id="gift-card-scanner-video" playsinline muted style="width:100%; height:100%; object-fit:cover;"></video>
              <div style="position:absolute; inset:18%; border:2px solid var(--secondary); border-radius:12px; box-shadow:0 0 0 999px rgba(0,0,0,0.35); pointer-events:none;"></div>
              <div style="position:absolute; left:12px; right:12px; bottom:10px; padding:8px 10px; border-radius:10px; background:rgba(0,0,0,0.58); color:white; font-weight:700; text-align:center; font-size:0.78rem;">
                Apunta al QR o al codigo de barras
              </div>
            </div>
          ` : ''}

          ${giftCardLookup ? `
            <div style="background:var(--bg-panel); border:1px solid var(--border-color); border-radius:var(--border-radius-md); padding:12px; margin-top:12px;">
              <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                <div>
                  <div style="font-size:0.72rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Tarjeta</div>
                  <strong style="display:block; margin-top:3px;">**** ${giftCardLookup.last4 || '----'}</strong>
                  <small style="color:var(--text-muted);">${giftCardLookup.state || 'Sin estado'}</small>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:0.72rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Saldo</div>
                  <strong style="display:block; margin-top:3px; font-size:1.25rem; color:var(--secondary);">${formatGiftCardBalance(giftCardBalance)}</strong>
                </div>
              </div>

              <div style="border-top:1px solid var(--border-color); margin-top:12px; padding-top:12px; display:grid; gap:8px;">
                <div style="display:flex; justify-content:space-between; color:var(--text-muted); font-weight:700;">
                  <span>Se canjea</span>
                  <span>${giftCardRedeemAmount.toFixed(2)}â‚¬</span>
                </div>
                ${giftCardRemainingAmount > 0 ? `
                  <div style="display:flex; justify-content:space-between; color:var(--text-main); font-weight:700;">
                    <span>Resto pendiente</span>
                    <span>${giftCardRemainingAmount.toFixed(2)}â‚¬</span>
                  </div>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:4px;">
                    <button type="button" class="split-part-pay-btn card-btn gift-remainder-btn ${giftCardRemainderMethod === 'Tarjeta' ? 'active' : ''}" data-method="Tarjeta">Resto tarjeta</button>
                    <button type="button" class="split-part-pay-btn cash-btn gift-remainder-btn ${giftCardRemainderMethod === 'Efectivo' ? 'active' : ''}" data-method="Efectivo">Resto efectivo</button>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : `
            <div style="background:var(--bg-panel); border:1px dashed var(--border-color); border-radius:var(--border-radius-md); padding:12px; margin-top:12px; color:var(--text-muted); font-size:0.85rem;">
              Escanea el QR de la tarjeta regalo o pega el codigo para consultar el saldo antes de cobrar.
            </div>
          `}
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
                <input type="text" class="search-input" id="free-charge-amount" readonly placeholder="${getFreeRemaining().toFixed(2)}" value="${freeInputValue === null ? '' : freeInputValue.toFixed(2)}" style="font-size:1.2rem; text-align:right; font-weight:700; flex:1; height: 44px; padding-right:12px; background:var(--bg-panel); color:var(--text-main); border:1px solid var(--border-color); border-radius:var(--border-radius-md); cursor: pointer;">
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

          ${loyaltyHTML}
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Método de Pago</div>

          <div class="payment-methods-grid" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px;">
            <button class="payment-method-card ${selectedMethod === 'Tarjeta' ? 'active' : ''}" data-method="Tarjeta" style="background:var(--bg-item); border: 1px solid var(--border-color); border-radius:var(--border-radius-md); padding:12px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; color:var(--text-main); font-family:var(--font-family); font-weight:600; font-size:0.8rem; transition:all 0.2s ease;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px; color:${selectedMethod === 'Tarjeta' ? 'var(--secondary)' : 'var(--text-muted)'};"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
              <span>Tarjeta</span>
            </button>
            <button class="payment-method-card ${selectedMethod === 'Efectivo' ? 'active' : ''}" data-method="Efectivo" style="background:var(--bg-item); border: 1px solid var(--border-color); border-radius:var(--border-radius-md); padding:12px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; color:var(--text-main); font-family:var(--font-family); font-weight:600; font-size:0.8rem; transition:all 0.2s ease;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px; color:${selectedMethod === 'Efectivo' ? '#10b981' : 'var(--text-muted)'};"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></svg>
              <span>Efectivo</span>
            </button>
            <button class="payment-method-card ${selectedMethod === 'Tarjeta Regalo' ? 'active' : ''}" data-method="Tarjeta Regalo" style="background:var(--bg-item); border: 1px solid var(--border-color); border-radius:var(--border-radius-md); padding:12px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; color:var(--text-main); font-family:var(--font-family); font-weight:600; font-size:0.72rem; transition:all 0.2s ease;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px; color:${selectedMethod === 'Tarjeta Regalo' ? 'var(--secondary)' : 'var(--text-muted)'};"><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M12 8v12M3 12h18M7.5 8a2.5 2.5 0 1 1 4.5 0M16.5 8a2.5 2.5 0 1 0-4.5 0" /></svg>
              <span>Regalo</span>
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
          ${!isDividir ? `<button class="btn btn-primary" id="payment-confirm-btn" ${giftCardBusy ? 'disabled' : ''} style="height:40px; padding:0 20px; font-weight:600; border-radius:var(--border-radius-md); background:var(--secondary); border:none; color:white; cursor:pointer; font-size:0.85rem; ${giftCardBusy ? 'opacity:0.65;' : ''}">${giftCardBusy ? 'Procesando...' : 'Confirmar Pago'}</button>` : ''}
        </div>
      </div>
    `;

    // ── Enlazar Eventos Generales
    // Cambio de Método de Pago Principal
    modal.querySelectorAll('.payment-method-card').forEach(card => {
      card.addEventListener('click', () => {
        if (card.dataset.method !== 'Tarjeta Regalo') {
          stopGiftCardScanner();
        }
        selectedMethod = card.dataset.method;
        if (selectedMethod === 'Efectivo') {
          cashReceived = totalAmount;
        }
        renderPaymentContent();
      });
    });

    // Botón de Cancelar
    modal.querySelector('#payment-cancel-btn').addEventListener('click', () => {
      stopGiftCardScanner();
      modal.remove();
    });

    const loyaltyInput = modal.querySelector('#loyalty-rfid-input');
    if (loyaltyInput) {
      loyaltyInput.addEventListener('input', (e) => {
        loyaltyRfidInput = e.target.value;
      });
      loyaltyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') identifyLoyaltyCustomer();
      });
      setTimeout(() => {
        if (!loyaltyCustomer && isLoyaltyConfigured) loyaltyInput.focus();
      }, 30);
    }

    const loyaltySearchBtn = modal.querySelector('#loyalty-search-btn');
    if (loyaltySearchBtn) {
      loyaltySearchBtn.addEventListener('click', identifyLoyaltyCustomer);
    }

    const loyaltyClearBtn = modal.querySelector('#loyalty-clear-btn');
    if (loyaltyClearBtn) {
      loyaltyClearBtn.addEventListener('click', clearLoyaltyCustomer);
    }

    const loyaltyManualBtn = modal.querySelector('#loyalty-manual-award-btn');
    if (loyaltyManualBtn) {
      loyaltyManualBtn.addEventListener('click', awardManualLoyalty);
    }

    const giftCardInput = modal.querySelector('#gift-card-code-input');
    if (giftCardInput) {
      giftCardInput.addEventListener('input', (e) => {
        giftCardCodeInput = e.target.value;
        giftCardLookup = null;
        giftCardStatus = '';
      });
      giftCardInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') lookupGiftCard();
      });
      setTimeout(() => giftCardInput.focus(), 30);
    }

    const giftCardLookupBtn = modal.querySelector('#gift-card-lookup-btn');
    if (giftCardLookupBtn) {
      giftCardLookupBtn.addEventListener('click', lookupGiftCard);
    }

    const giftCardScanBtn = modal.querySelector('#gift-card-scan-btn');
    if (giftCardScanBtn) {
      giftCardScanBtn.addEventListener('click', () => {
        if (giftCardScannerActive) {
          stopGiftCardScanner();
          giftCardStatus = '';
          renderPaymentContent();
        } else {
          void startGiftCardScanner();
        }
      });
    }

    modal.querySelectorAll('.gift-remainder-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        giftCardRemainderMethod = btn.dataset.method;
        renderPaymentContent();
      });
    });

    // Botón Confirmar Pago Directo (no dividido)
    const confirmBtn = modal.querySelector('#payment-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (selectedMethod === 'Efectivo') {
          const change = getChangeAmount();
          await completePaidTicket('Efectivo', `Pago en efectivo registrado. Cambio: ${change.toFixed(2)} euros.`);
        } else if (selectedMethod === 'Tarjeta') {
          await completePaidTicket('Tarjeta', 'Pago con tarjeta procesado correctamente.');
        } else if (selectedMethod === 'Tarjeta Regalo') {
          await payWithGiftCard();
        }
      });
    }

    // ── Enlazar Eventos de Métodos Directos
    // Input de Efectivo entregado
    if (isEfectivo) {
      const cashInput = modal.querySelector('#cash-received-input');
      if (cashInput) {
        cashInput.addEventListener('click', () => {
          showNumericKeypadModal({
            title: 'Efectivo Entregado',
            placeholder: totalAmount,
            onSave: (val) => {
              cashReceived = val;
              renderPaymentContent();
            }
          });
        });
      }

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
        if (freeInput) {
          freeInput.addEventListener('click', () => {
            showNumericKeypadModal({
              title: 'Importe a Cobrar',
              placeholder: getFreeRemaining(),
              onSave: (val) => {
                freeInputValue = val;
                renderPaymentContent();
              }
            });
          });
        }

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
      
      const breakdown = parts.map(part => ({
        method: part.status === 'paid-card' ? 'Tarjeta' : 'Efectivo',
        amount: part.amount,
        provider: part.status === 'paid-card' ? 'BBVA' : ''
      }));
      void completePaidTicket(methodText, 'Cobro por partes completado con exito.', breakdown);
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
      
      const breakdown = freePayments.map(payment => ({
        method: payment.method,
        amount: payment.amount,
        provider: payment.method === 'Tarjeta' ? 'BBVA' : ''
      }));
      void completePaidTicket(methodText, 'Cobro libre completado con exito.', breakdown);
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
      
      const breakdown = articlePayments.map(payment => ({
        method: payment.method,
        amount: payment.amount,
        provider: payment.method === 'Tarjeta' ? 'BBVA' : '',
        itemsText: payment.itemsText
      }));
      void completePaidTicket(methodText, 'Cobro por articulos completado con exito.', breakdown);
    } else {
      renderPaymentContent();
    }
  };

  renderPaymentContent();
  document.body.appendChild(modal);
}

// Helper functions for sales reports export
function aggregateDailyData(transactions, getTxDate) {
  const groups = {};
  transactions.forEach(tx => {
    const d = getTxDate(tx);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const key = `${yyyy}-${mm}-${dd}`;
    
    if (!groups[key]) {
      groups[key] = {
        dateStr: `${dd}/${mm}/${yyyy}`,
        count: 0,
        base: 0,
        tax: 0,
        cash: 0,
        card: 0,
        total: 0
      };
    }
    
    const total = Number(tx.total || 0);
    const legal = tx.legalData || { taxRate: 7 };
    const rate = Number(legal.taxRate || 0);
    const base = total / (1 + (rate / 100));
    const tax = total - base;
    
    groups[key].count += 1;
    groups[key].base += base;
    groups[key].tax += tax;
    groups[key].total += total;
    
    const method = (tx.paymentMethod || '').toLowerCase().trim();
    if (method.includes('efectivo')) {
      groups[key].cash += total;
    } else {
      groups[key].card += total;
    }
  });
  
  return Object.keys(groups).sort().map(k => groups[k]);
}

function aggregateMonthlyData(transactions, getTxDate) {
  const groups = {};
  transactions.forEach(tx => {
    const d = getTxDate(tx);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const key = `${yyyy}-${mm}`;
    
    if (!groups[key]) {
      const monthLabel = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      groups[key] = {
        monthStr: monthLabel,
        count: 0,
        base: 0,
        tax: 0,
        cash: 0,
        card: 0,
        total: 0
      };
    }
    
    const total = Number(tx.total || 0);
    const legal = tx.legalData || { taxRate: 7 };
    const rate = Number(legal.taxRate || 0);
    const base = total / (1 + (rate / 100));
    const tax = total - base;
    
    groups[key].count += 1;
    groups[key].base += base;
    groups[key].tax += tax;
    groups[key].total += total;
    
    const method = (tx.paymentMethod || '').toLowerCase().trim();
    if (method.includes('efectivo')) {
      groups[key].cash += total;
    } else {
      groups[key].card += total;
    }
  });
  
  return Object.keys(groups).sort().map(k => groups[k]);
}

function triggerCSVDownload(filename, headers, rows) {
  const csvRows = [headers.join(';')];
  rows.forEach(row => {
    const formattedRow = row.map(val => {
      if (typeof val === 'number') {
        return val.toFixed(2).replace('.', ',');
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    csvRows.push(formattedRow.join(';'));
  });
  
  const csvContent = '\ufeff' + csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadCashClosuresExcel(selectedMonth, closures, legal) {
  const sortedClosures = [...closures].sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate)));
  const totals = sortedClosures.reduce((acc, closure) => {
    acc.totalSales += Number(closure.totalSales || 0);
    acc.totalRefunds += Number(closure.totalRefunds || 0);
    acc.expectedCash += Number(closure.expectedCash || 0);
    acc.countedCash += Number(closure.countedCash || 0);
    acc.cashDifference += Number(closure.cashDifference || 0);
    acc.expectedCard += Number(closure.expectedCard || 0);
    acc.bbvaTotal += Number(closure.bbvaTotal || 0);
    acc.cardDifference += Number(closure.cardDifference || 0);
    acc.transactionsCount += Number(closure.transactionsCount || 0);
    return acc;
  }, {
    totalSales: 0,
    totalRefunds: 0,
    expectedCash: 0,
    countedCash: 0,
    cashDifference: 0,
    expectedCard: 0,
    bbvaTotal: 0,
    cardDifference: 0,
    transactionsCount: 0
  });

  const moneyCell = value => Number(value || 0).toFixed(2);
  const tableRows = sortedClosures.map(closure => `
    <tr>
      <td>${formatIsoDateEs(closure.businessDate)}</td>
      <td>${Number(closure.shiftNumber || 1)}</td>
      <td>${Number(closure.transactionsCount || 0)}</td>
      <td>${moneyCell(closure.totalSales)}</td>
      <td>${moneyCell(closure.totalRefunds)}</td>
      <td>${moneyCell(closure.openingCash)}</td>
      <td>${moneyCell(closure.expectedCash)}</td>
      <td>${moneyCell(closure.countedCash)}</td>
      <td>${moneyCell(closure.cashDifference)}</td>
      <td>${moneyCell(closure.expectedCard)}</td>
      <td>${moneyCell(closure.bbvaTotal)}</td>
      <td>${moneyCell(closure.cardDifference)}</td>
      <td>${escapeHtml(closure.staffName || closure.staff?.name || '')}</td>
      <td>${closure.closedAt ? escapeHtml(new Date(closure.closedAt).toLocaleString('es-ES')) : ''}</td>
      <td>${escapeHtml(closure.notes || '')}</td>
    </tr>
  `).join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #999; padding: 6px; }
    th { background: #e8e8e8; font-weight: bold; }
    .total-row td { font-weight: bold; background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Cierres de caja - ${escapeHtml(legal?.businessName || 'Esencia Cafe')}</h1>
  <p>Mes: ${escapeHtml(selectedMonth)}</p>
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Turno</th>
        <th>Tickets</th>
        <th>Ventas brutas</th>
        <th>Devoluciones</th>
        <th>Fondo inicial</th>
        <th>Efectivo app</th>
        <th>Efectivo contado</th>
        <th>Diferencia efectivo</th>
        <th>Tarjeta app</th>
        <th>Total BBVA</th>
        <th>Diferencia BBVA</th>
        <th>Usuario</th>
        <th>Guardado</th>
        <th>Notas</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      <tr class="total-row">
        <td>Total</td>
        <td></td>
        <td>${totals.transactionsCount}</td>
        <td>${moneyCell(totals.totalSales)}</td>
        <td>${moneyCell(totals.totalRefunds)}</td>
        <td></td>
        <td>${moneyCell(totals.expectedCash)}</td>
        <td>${moneyCell(totals.countedCash)}</td>
        <td>${moneyCell(totals.cashDifference)}</td>
        <td>${moneyCell(totals.expectedCard)}</td>
        <td>${moneyCell(totals.bbvaTotal)}</td>
        <td>${moneyCell(totals.cardDifference)}</td>
        <td></td>
        <td></td>
        <td></td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `cierres-caja-${selectedMonth}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadMonthlySalesExcel(selectedMonth, transactions, legal) {
  const getTxDate = (tx) => {
    if (tx.createdAt) return new Date(tx.createdAt);
    if (tx.date) {
      const [datePart, timePart = '00:00'] = tx.date.split(', ');
      const [day, month, year] = datePart.split('/').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      return new Date(year, month - 1, day, hour || 0, minute || 0);
    }
    return new Date();
  };
  const getLocalDateKey = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const moneyCell = value => Number(value || 0).toFixed(2);
  const escapeCell = value => escapeHtml(value ?? '');
  const paymentBreakdown = (tx) => {
    if (Array.isArray(tx.payments) && tx.payments.length > 0) {
      return tx.payments.map(payment => ({
        method: payment.method || tx.paymentMethod || '',
        amount: Number(payment.amount || 0),
        provider: payment.provider || ''
      }));
    }
    return [{
      method: tx.paymentMethod || '',
      amount: Number(tx.total || 0),
      provider: String(tx.paymentMethod || '').toLowerCase().includes('tarjeta') ? 'BBVA' : ''
    }];
  };

  const sortedTx = [...transactions].sort((a, b) => getTxDate(a) - getTxDate(b));
  const daily = {};
  const paymentTotals = {};
  const itemTotals = {};
  let grossSales = 0;
  let refunds = 0;
  let ticketCount = 0;

  sortedTx.forEach(tx => {
    const d = getTxDate(tx);
    const dayKey = getLocalDateKey(d);
    if (!daily[dayKey]) {
      daily[dayKey] = { date: dayKey, tickets: 0, gross: 0, refunds: 0, net: 0, cash: 0, card: 0, other: 0 };
    }

    const total = Number(tx.total || 0);
    const isRefund = tx.type === 'refund';
    if (isRefund) {
      refunds += Math.abs(total);
      daily[dayKey].refunds += Math.abs(total);
    } else {
      grossSales += total;
      ticketCount += 1;
      daily[dayKey].tickets += 1;
      daily[dayKey].gross += total;
    }
    daily[dayKey].net += total;

    paymentBreakdown(tx).forEach(payment => {
      const method = payment.method || 'Sin metodo';
      const amount = Number(payment.amount || 0);
      paymentTotals[method] = (paymentTotals[method] || 0) + amount;
      const methodKey = method.toLowerCase();
      if (methodKey.includes('efectivo')) daily[dayKey].cash += amount;
      else if (methodKey.includes('tarjeta')) daily[dayKey].card += amount;
      else daily[dayKey].other += amount;
    });

    (tx.items || []).forEach(item => {
      const key = item.name || 'Articulo';
      if (!itemTotals[key]) itemTotals[key] = { name: key, qty: 0, total: 0 };
      itemTotals[key].qty += Number(item.qty || 0);
      itemTotals[key].total += Number(item.total ?? ((item.price || 0) * (item.qty || 0)));
    });
  });

  const dailyRows = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)).map(day => `
    <tr>
      <td>${formatIsoDateEs(day.date)}</td>
      <td>${day.tickets}</td>
      <td>${moneyCell(day.gross)}</td>
      <td>${moneyCell(day.refunds)}</td>
      <td>${moneyCell(day.cash)}</td>
      <td>${moneyCell(day.card)}</td>
      <td>${moneyCell(day.other)}</td>
      <td>${moneyCell(day.net)}</td>
    </tr>
  `).join('');

  const txRows = sortedTx.map(tx => {
    const d = getTxDate(tx);
    const payments = paymentBreakdown(tx);
    return `
      <tr>
        <td>${formatIsoDateEs(getLocalDateKey(d))}</td>
        <td>${escapeCell(d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}</td>
        <td>${escapeCell(tx.id)}</td>
        <td>${escapeCell(tx.table)}</td>
        <td>${escapeCell(tx.type === 'refund' ? 'Devolucion' : 'Venta')}</td>
        <td>${escapeCell(payments.map(payment => payment.method).join(' + '))}</td>
        <td>${escapeCell(payments.map(payment => payment.provider).filter(Boolean).join(' + '))}</td>
        <td>${Number(tx.itemsCount || 0)}</td>
        <td>${moneyCell(tx.total)}</td>
        <td>${escapeCell(tx.staff?.name || tx.staffName || '')}</td>
      </tr>
    `;
  }).join('');

  const itemRows = Object.values(itemTotals)
    .sort((a, b) => b.total - a.total)
    .map(item => `
      <tr>
        <td>${escapeCell(item.name)}</td>
        <td>${moneyCell(item.qty)}</td>
        <td>${moneyCell(item.total)}</td>
      </tr>
    `).join('');

  const paymentRows = Object.entries(paymentTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([method, total]) => `
      <tr>
        <td>${escapeCell(method)}</td>
        <td>${moneyCell(total)}</td>
      </tr>
    `).join('');

  const netSales = grossSales - refunds;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; }
    h1, h2 { margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th, td { border: 1px solid #999; padding: 6px; }
    th { background: #e8e8e8; font-weight: bold; }
    .total-row td { font-weight: bold; background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Ventas mensuales - ${escapeCell(legal?.businessName || 'Esencia Cafe')}</h1>
  <p>Mes: ${escapeCell(selectedMonth)}</p>

  <h2>Resumen</h2>
  <table>
    <tr><th>Tickets</th><th>Ventas brutas</th><th>Devoluciones</th><th>Ventas netas</th></tr>
    <tr><td>${ticketCount}</td><td>${moneyCell(grossSales)}</td><td>${moneyCell(refunds)}</td><td>${moneyCell(netSales)}</td></tr>
  </table>

  <h2>Resumen por dia</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Tickets</th><th>Ventas brutas</th><th>Devoluciones</th><th>Efectivo</th><th>Tarjeta</th><th>Otros</th><th>Neto</th></tr></thead>
    <tbody>${dailyRows || '<tr><td colspan="8">Sin ventas</td></tr>'}</tbody>
  </table>

  <h2>Metodos de pago</h2>
  <table>
    <thead><tr><th>Metodo</th><th>Total</th></tr></thead>
    <tbody>${paymentRows || '<tr><td colspan="2">Sin pagos</td></tr>'}</tbody>
  </table>

  <h2>Articulos vendidos</h2>
  <table>
    <thead><tr><th>Articulo</th><th>Cantidad</th><th>Total</th></tr></thead>
    <tbody>${itemRows || '<tr><td colspan="3">Sin articulos</td></tr>'}</tbody>
  </table>

  <h2>Detalle de tickets</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Hora</th><th>Ticket</th><th>Mesa</th><th>Tipo</th><th>Metodo</th><th>Proveedor pago</th><th>Articulos</th><th>Total</th><th>Usuario</th></tr></thead>
    <tbody>${txRows || '<tr><td colspan="10">Sin tickets</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `ventas-mensuales-${selectedMonth}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadDailyReportPDF(selectedDate, dayTx, legal, filename) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    const dateNow = new Date();
    const dateString = dateNow.toLocaleString('es-ES');

    // ── Header band ────────────────────────────────────────────────────────
    doc.setFillColor(15, 23, 42);           // #0f172a
    doc.rect(0, 0, pageW, 38, 'F');

    // ── Business name ──────────────────────────────────────────────────────
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(legal.businessName || 'Esencia Café', margin, 13);

    // ── Title ──────────────────────────────────────────────────────────────
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);        // slate-400
    doc.text(`INFORME DIARIO DE VENTAS — ${selectedDate}`, margin, 20);
    doc.text(`Generado el ${dateString}`, margin, 26);

    // ── Legal info ────────────────────────────────────────────────────────
    const rightX = pageW - margin;
    doc.setFontSize(8);
    doc.setTextColor(200, 210, 220);
    doc.text(legal.companyName || 'Esencia Café S.L.', rightX, 12, { align: 'right' });
    doc.text(`NIF: ${legal.nif || 'B-87654321'}`, rightX, 17, { align: 'right' });
    doc.text(legal.address || 'Santa Cruz de Tenerife', rightX, 22, { align: 'right' });

    // Calculate figures
    let totalGross = 0;
    let totalRefunds = 0;
    const paymentMethods = { 'Efectivo': 0, 'Tarjeta': 0, 'Tarjeta Regalo': 0 };

    dayTx.forEach(tx => {
      const val = Number(tx.total || 0);
      const method = (tx.paymentMethod || '').toLowerCase().trim();
      let matchedMethod = 'Tarjeta';
      if (method.includes('efectivo')) {
        matchedMethod = 'Efectivo';
      } else if (method.includes('regalo') || method.includes('gift')) {
        matchedMethod = 'Tarjeta Regalo';
      }
      
      if (tx.type === 'refund') {
        totalRefunds += Math.abs(val);
        paymentMethods[matchedMethod] += val;
      } else {
        totalGross += val;
        paymentMethods[matchedMethod] += val;
      }
    });
    const totalNet = totalGross - totalRefunds;

    // Draw KPI Summary boxes
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    
    // Summary metrics rectangle
    doc.rect(margin, 44, 85, 30, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text('RESUMEN DE VENTAS', margin + 5, 49);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Ventas Brutas: ${totalGross.toFixed(2)} €`, margin + 5, 55);
    doc.text(`Devoluciones: -${totalRefunds.toFixed(2)} €`, margin + 5, 60);
    doc.text(`Descuentos: 0.00 €`, margin + 5, 65);
    doc.setFont('helvetica', 'bold');
    doc.text(`VENTAS NETAS: ${totalNet.toFixed(2)} €`, margin + 5, 71);

    // Payment Methods rectangle
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.rect(margin + 95, 44, 85, 30, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('MÉTODOS DE PAGO (NETO)', margin + 95 + 5, 49);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Efectivo: ${paymentMethods['Efectivo'].toFixed(2)} €`, margin + 95 + 5, 55);
    doc.text(`Tarjeta Bancaria: ${paymentMethods['Tarjeta'].toFixed(2)} €`, margin + 95 + 5, 60);
    doc.text(`Tarjeta Regalo: ${paymentMethods['Tarjeta Regalo'].toFixed(2)} €`, margin + 95 + 5, 65);

    // Draw transaction table
    const headers = ['Ticket ID', 'Hora', 'Mesa / Concepto', 'Método Pago', 'Artículos', 'Importe'];
    const tableBody = dayTx.map(tx => {
      const isRefund = tx.type === 'refund';
      return [
        tx.id,
        tx.date.split(', ')[1] || '',
        tx.table,
        tx.paymentMethod,
        isRefund ? 'Devolución' : `${tx.itemsCount} art.`,
        isRefund ? `-${Math.abs(tx.total).toFixed(2)} €` : `${tx.total.toFixed(2)} €`
      ];
    });

    // Add totals row
    tableBody.push([
      'TOTAL NETO',
      '',
      '',
      '',
      `${dayTx.filter(t => t.type !== 'refund').reduce((sum, t) => sum + t.itemsCount, 0)} art.`,
      `${totalNet.toFixed(2)} €`
    ]);

    const totalRowIndex = tableBody.length - 1;

    doc.autoTable({
      startY: 80,
      head: [headers],
      body: tableBody,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.1
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [248, 250, 252],
        fontStyle: 'bold',
        fontSize: 7.5
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { halign: 'center', cellWidth: 20 },
        4: { halign: 'center', cellWidth: 25 },
        5: { halign: 'right', cellWidth: 25 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalRowIndex) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [241, 245, 249];
          if (data.column.index === 5) {
            data.cell.styles.textColor = totalNet >= 0 ? [5, 150, 105] : [220, 38, 38];
          } else {
            data.cell.styles.textColor = [15, 23, 42];
          }
        }
      }
    });

    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, finalY, pageW - margin, finalY);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Esencia TPV — Sistema de Gestión de Ventas', margin, finalY + 5);
    doc.text('Generado en formato PDF', pageW - margin, finalY + 5, { align: 'right' });

    doc.save(filename);
    showToast('Informe Diario PDF descargado.', 'success');
  } catch (err) {
    console.error('Error generando PDF diario:', err);
    showToast('Error al generar el PDF: ' + err.message, 'error');
  }
}

function downloadMonthlyReportPDF(selectedMonth, sortedDays, legal, filename) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    const dateNow = new Date();
    const dateString = dateNow.toLocaleString('es-ES');

    // ── Header band ────────────────────────────────────────────────────────
    doc.setFillColor(15, 23, 42);           // #0f172a
    doc.rect(0, 0, pageW, 38, 'F');

    // ── Business name ──────────────────────────────────────────────────────
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(legal.businessName || 'Esencia Café', margin, 13);

    // ── Title ──────────────────────────────────────────────────────────────
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);        // slate-400
    doc.text(`INFORME MENSUAL DE VENTAS — ${selectedMonth}`, margin, 20);
    doc.text(`Generado el ${dateString}`, margin, 26);

    // ── Legal info ────────────────────────────────────────────────────────
    const rightX = pageW - margin;
    doc.setFontSize(8);
    doc.setTextColor(200, 210, 220);
    doc.text(legal.companyName || 'Esencia Café S.L.', rightX, 12, { align: 'right' });
    doc.text(`NIF: ${legal.nif || 'B-87654321'}`, rightX, 17, { align: 'right' });
    doc.text(legal.address || 'Santa Cruz de Tenerife', rightX, 22, { align: 'right' });

    // Calculate figures
    let totalGross = 0;
    let totalRefunds = 0;
    let totalCash = 0;
    let totalCard = 0;
    let totalOrders = 0;

    sortedDays.forEach(day => {
      totalGross += day.gross;
      totalRefunds += day.refunds;
      totalCash += day.cash;
      totalCard += day.card;
      totalOrders += day.count;
    });
    const totalNet = totalGross - totalRefunds;

    // Draw KPI Summary boxes
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    
    // Summary metrics rectangle
    doc.rect(margin, 44, 85, 30, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text('RESUMEN DEL MES', margin + 5, 49);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Total Pedidos: ${totalOrders}`, margin + 5, 55);
    doc.text(`Ventas Brutas: ${totalGross.toFixed(2)} €`, margin + 5, 60);
    doc.text(`Devoluciones: -${totalRefunds.toFixed(2)} €`, margin + 5, 65);
    doc.setFont('helvetica', 'bold');
    doc.text(`VENTAS NETAS: ${totalNet.toFixed(2)} €`, margin + 5, 71);

    // Payment Methods rectangle
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.rect(margin + 95, 44, 85, 30, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('MÉTODOS DE PAGO (NETO)', margin + 95 + 5, 49);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Efectivo: ${totalCash.toFixed(2)} €`, margin + 95 + 5, 55);
    doc.text(`Tarjeta Bancaria: ${totalCard.toFixed(2)} €`, margin + 95 + 5, 60);

    // Draw breakdown table
    const headers = ['Día', 'Pedidos', 'Efectivo', 'Tarjeta', 'Devoluciones', 'Total Neto'];
    const tableBody = sortedDays.map(day => [
      day.dateStr,
      String(day.count),
      `${day.cash.toFixed(2)} €`,
      `${day.card.toFixed(2)} €`,
      day.refunds > 0 ? `-${day.refunds.toFixed(2)} €` : '0.00 €',
      `${day.net.toFixed(2)} €`
    ]);

    // Add totals row
    tableBody.push([
      'TOTAL MENSUAL',
      String(totalOrders),
      `${totalCash.toFixed(2)} €`,
      `${totalCard.toFixed(2)} €`,
      `-${totalRefunds.toFixed(2)} €`,
      `${totalNet.toFixed(2)} €`
    ]);

    const totalRowIndex = tableBody.length - 1;

    doc.autoTable({
      startY: 80,
      head: [headers],
      body: tableBody,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.1
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [248, 250, 252],
        fontStyle: 'bold',
        fontSize: 7.5
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { halign: 'right', cellWidth: 20 },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right', cellWidth: 30 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalRowIndex) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [241, 245, 249];
          if (data.column.index === 5) {
            data.cell.styles.textColor = totalNet >= 0 ? [5, 150, 105] : [220, 38, 38];
          } else {
            data.cell.styles.textColor = [15, 23, 42];
          }
        }
      }
    });

    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, finalY, pageW - margin, finalY);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Esencia TPV — Sistema de Gestión de Ventas', margin, finalY + 5);
    doc.text('Generado en formato PDF', pageW - margin, finalY + 5, { align: 'right' });

    doc.save(filename);
    showToast('Informe Mensual PDF descargado.', 'success');
  } catch (err) {
    console.error('Error generando PDF mensual:', err);
    showToast('Error al generar el PDF: ' + err.message, 'error');
  }
}

function downloadReportPDF(title, headers, rows, legal, filename) {
  // Use jsPDF directly (programmatic PDF, no html2canvas/DOM capture that could be blank)
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    const dateNow = new Date();
    const dateString = dateNow.toLocaleString('es-ES');

    // ── Header background band ─────────────────────────────────────────────
    doc.setFillColor(15, 23, 42);           // #0f172a
    doc.rect(0, 0, pageW, 38, 'F');

    // ── Business name (top-left) ──────────────────────────────────────────
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(legal.businessName || 'Esencia Café', margin, 13);

    // ── Report title (top-left, below business name) ──────────────────────
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);        // slate-400
    doc.text(title, margin, 20);
    doc.text(`Generado el ${dateString}`, margin, 26);

    // ── Legal info (top-right) ────────────────────────────────────────────
    const rightX = pageW - margin;
    doc.setFontSize(8);
    doc.setTextColor(200, 210, 220);
    doc.text(legal.companyName || 'Esencia Café S.L.', rightX, 12, { align: 'right' });
    doc.text(`NIF: ${legal.nif || 'B-87654321'}`, rightX, 17, { align: 'right' });
    doc.text(legal.address || 'Santa Cruz de Tenerife', rightX, 22, { align: 'right' });

    // ── Format helper ─────────────────────────────────────────────────────
    const fmtCurrency = (v) =>
      new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);
    const fmtInt = (v) => new Intl.NumberFormat('es-ES').format(Number(v) || 0);

    // ── Build autoTable body + totals row ─────────────────────────────────
    let totalCount = 0, totalBase = 0, totalTax = 0, totalCash = 0, totalCard = 0, totalRevenue = 0;
    const tableBody = rows.map((row, idx) => {
      totalCount   += Number(row[1] || 0);
      totalBase    += Number(row[2] || 0);
      totalTax     += Number(row[3] || 0);
      totalCash    += Number(row[4] || 0);
      totalCard    += Number(row[5] || 0);
      totalRevenue += Number(row[6] || 0);
      return [
        row[0],
        fmtInt(row[1]),
        fmtCurrency(row[2]),
        fmtCurrency(row[3]),
        fmtCurrency(row[4]),
        fmtCurrency(row[5]),
        fmtCurrency(row[6])
      ];
    });

    // Totals row appended as last body row (styled differently via didParseCell)
    tableBody.push([
      'TOTALES',
      fmtInt(totalCount),
      fmtCurrency(totalBase),
      fmtCurrency(totalTax),
      fmtCurrency(totalCash),
      fmtCurrency(totalCard),
      fmtCurrency(totalRevenue)
    ]);

    const totalRowIndex = tableBody.length - 1;

    doc.autoTable({
      startY: 44,
      head: [headers],
      body: tableBody,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: 3,
        overflow: 'linebreak',
        lineColor: [226, 232, 240],
        lineWidth: 0.1
      },
      headStyles: {
        fillColor: [30, 41, 59],       // slate-800
        textColor: [248, 250, 252],    // slate-50
        fontStyle: 'bold',
        fontSize: 7.5
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]     // slate-50
      },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { halign: 'right', cellWidth: 16 },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right', textColor: [5, 150, 105] }  // emerald-600
      },
      didParseCell: (data) => {
        // Style the TOTALES row
        if (data.section === 'body' && data.row.index === totalRowIndex) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [241, 245, 249];  // slate-100
          if (data.column.index === 6) {
            data.cell.styles.textColor = [5, 150, 105];  // emerald-600
          } else {
            data.cell.styles.textColor = [15, 23, 42];   // slate-900
          }
        }
      }
    });

    // ── Footer ────────────────────────────────────────────────────────────
    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, finalY, pageW - margin, finalY);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Esencia TPV — Sistema de Gestión de Ventas', margin, finalY + 5);
    doc.text('Generado en formato PDF', pageW - margin, finalY + 5, { align: 'right' });

    doc.save(filename);
    showToast('Informe PDF descargado correctamente.', 'success');
  } catch (err) {
    console.error('Error generando PDF:', err);
    showToast('Error al generar el PDF: ' + err.message, 'error');
  }
}

// Event bindings
function setupEventListeners(container) {
  const staffSessionBtn = container.querySelector('#staff-session-btn');
  if (staffSessionBtn) {
    staffSessionBtn.addEventListener('click', () => {
      showConfirm(
        'Cerrar sesion',
        '¿Quieres salir de esta cuenta de personal?',
        () => store.signOut()
      );
    });
  }

  // Bottom Nav tabs
  container.querySelectorAll('.bottom-nav [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) {
        if (tab === 'ajustes' && !store.canAccessSettings()) {
          showToast('Tu usuario no tiene acceso a Ajustes.', 'warning');
          return;
        }
        isDrawerOpen = false; // Reset drawer on tab switch
        store.state.settingsPath = []; // Always go to root of that section
        store.setActiveTab(tab);
      }
    });
  });

  container.querySelectorAll('[data-table-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableId = parseInt(btn.dataset.tableId, 10);
      if (!Number.isNaN(tableId)) {
        isDrawerOpen = false;
        
        const currentTableId = store.state.selectedTableId;
        const activeItems = store.getActiveItems();
        const hasActiveItems = activeItems.length > 0;
        
        if (hasActiveItems && tableId !== currentTableId) {
          const table = store.state.tables.find(t => t.id === tableId);
          const isOccupied = table && table.items.length > 0;
          
          if (isOccupied) {
            showConfirm(
              'Combinar Mesa y Comanda',
              `La ${table.name} ya tiene una comanda activa.\n¿Deseas combinar tu comanda actual con la cuenta de la mesa?`,
              () => {
                store.assignActiveOrderToTable(tableId);
                showToast(`Comanda combinada con la ${table.name}.`, 'success');
              }
            );
          } else {
            // Target table is empty
            if (currentTableId === null) {
              // Direct sale to empty table: move items automatically
              store.assignActiveOrderToTable(tableId);
              showToast(`Comanda asignada a la ${table.name}.`, 'success');
            } else {
              // Switch tables normally (leave items on the current table)
              store.selectTable(tableId);
            }
          }
        } else {
          // Normal selection when cart is empty or same table clicked
          store.selectTable(tableId);
        }
      }
    });
  });

  container.querySelectorAll('[data-transaction-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      showTransactionDetailModal(btn.dataset.transactionId);
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
        showToast('Cargo rápido añadido al ticket!', 'success');
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
      showConfirm(
        'Quitar Atajo',
        '¿Seguro que deseas quitar este atajo de la cuadrícula?',
        () => {
          store.removeGridShortcut(gridKey, slotIndex);
        },
        null,
        true // isDanger
      );
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
          showToast(`Añadido: ${btn.querySelector('.product-row-name').innerText}`, 'success');
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
                showToast(`Añadido: ${row.querySelector('.product-row-name').innerText}`, 'success');
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

  container.querySelectorAll('.ticket-defer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticketItemId = btn.dataset.deferTicketItemId;
      if (ticketItemId) store.toggleTicketItemDeferred(ticketItemId);
    });
  });

  container.querySelectorAll('.ticket-note-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ticketItemId = btn.dataset.noteTicketItemId;
      if (ticketItemId) showItemNoteModal(ticketItemId);
    });
  });

  // Ticket item click (edit modifiers)
  container.querySelectorAll('.ticket-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.ticket-item-qty-actions')) return;
      if (e.target.closest('.ticket-defer-btn')) return;
      if (e.target.closest('.ticket-note-btn')) return;
      const itemId = row.dataset.itemId;
      const ticketItemId = row.dataset.ticketItemId;
      if (itemHasModifiers(itemId) && ticketItemId) {
        showModifierSelectionModal(itemId, ticketItemId);
      }
    });
  });

  // Click on base price or total price to edit it
  container.querySelectorAll('.ticket-item-base-price, .ticket-item-total-price').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent triggering modifier selection modal!
      const row = el.closest('.ticket-item');
      if (row) {
        const ticketItemId = row.dataset.ticketItemId;
        const activeItems = store.getActiveItems();
        const item = activeItems.find(i => i.ticketItemId === ticketItemId);
        if (item) {
          showPriceEditModal(ticketItemId, item.price);
        }
      }
    });
  });

  // Drawer clear ticket
  const drawerClear = container.querySelector('#drawer-clear-btn');
  if (drawerClear) {
    drawerClear.addEventListener('click', () => {
      showConfirm(
        'Vaciar Pedido',
        '¿Seguro que deseas vaciar el pedido actual?',
        () => {
          store.clearActiveTicket();
          isDrawerOpen = false;
        },
        null,
        true // isDanger
      );
    });
  }

  // Drawer Print bill
  const drawerPrint = container.querySelector('#drawer-print-btn');
  if (drawerPrint) {
    drawerPrint.addEventListener('click', () => {
      showToast('Imprimiendo pre-factura del ticket...', 'success');
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
      showConfirm(
        'Vaciar Pedido',
        '¿Seguro que deseas vaciar el pedido actual?',
        () => {
          store.clearActiveTicket();
        },
        null,
        true // isDanger
      );
    });
  }

  const splitPrint = container.querySelector('#split-print-btn');
  if (splitPrint) {
    splitPrint.addEventListener('click', () => {
      showToast('Imprimiendo pre-factura...', 'success');
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

  // Reassign table action
  container.querySelectorAll('.ticket-reassign-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showReassignTableModal();
    });
  });

  // Settings active table selection
  const settingTableSelect = container.querySelector('#settings-table-select');
  if (settingTableSelect) {
    settingTableSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      const currentTableId = store.state.selectedTableId;
      if (val === 'direct') {
        store.selectTable(null);
      } else {
        const tableId = parseInt(val, 10);
        const activeItems = store.getActiveItems();
        const hasActiveItems = activeItems.length > 0;
        
        if (hasActiveItems && tableId !== currentTableId) {
          const table = store.state.tables.find(t => t.id === tableId);
          const isOccupied = table && table.items.length > 0;
          
          if (isOccupied) {
            showConfirm(
              'Combinar Mesa y Comanda',
              `La ${table.name} ya tiene una comanda activa.\n¿Deseas combinar tu comanda actual con la cuenta de la mesa?`,
              () => {
                store.assignActiveOrderToTable(tableId);
                showToast(`Comanda combinada con la ${table.name}.`, 'success');
              },
              () => {
                settingTableSelect.value = currentTableId === null ? 'direct' : currentTableId;
              }
            );
          } else {
            // Target table is empty
            if (currentTableId === null) {
              // Direct sale to empty table: move items automatically
              store.assignActiveOrderToTable(tableId);
              showToast(`Comanda asignada a la ${table.name}.`, 'success');
            } else {
              // Switch tables normally (leave items on the current table)
              store.selectTable(tableId);
            }
          }
        } else {
          // Normal selection when cart is empty or same table clicked
          store.selectTable(tableId);
        }
      }
    });
  }

  // Settings Theme button group listeners
  container.querySelectorAll('.theme-btn-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedTheme = btn.dataset.theme;
      store.setTheme(selectedTheme);
    });
  });

  // Settings TPV Data Reset
  const settingsReset = container.querySelector('#settings-reset-btn');
  if (settingsReset) {
    settingsReset.addEventListener('click', () => {
      if (!store.canResetTerminal()) {
        showToast('Solo el administrador puede restablecer el terminal.', 'error');
        return;
      }
      showConfirm(
        '¡Restablecer de Fábrica!',
        '¿CUIDADO!\n¿Deseas restablecer de fábrica todo el TPV?\nSe borrará el historial de ventas y los tickets de las mesas.',
        () => {
          store.state.transactions = [];
          store.state.tables.forEach(t => {
            t.status = 'available';
            t.items = [];
            t.loyaltyAwarded = undefined;
          });
          store.state.directSaleTicket = { items: [] };
          store.selectTable(null);
          store.navigateSettings([]); // reset settings view too
          showToast('TPV Restablecido.', 'success');
        },
        null,
        true // isDanger
      );
    });
  }

  // Settings Tree drill-down navigation
  const toArticulosBtn = container.querySelector('#settings-to-articulos');
  if (toArticulosBtn) {
    toArticulosBtn.addEventListener('click', () => {
      store.navigateSettings(['articulos']);
    });
  }

  const toLegalBtn = container.querySelector('#settings-to-legal');
  if (toLegalBtn) {
    toLegalBtn.addEventListener('click', () => {
      store.navigateSettings(['legal']);
    });
  }

  const legalForm = container.querySelector('#settings-legal-form');
  if (legalForm) {
    legalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const businessName = (container.querySelector('#legal-business-name')?.value || '').trim();
      const companyName = (container.querySelector('#legal-company-name')?.value || '').trim();
      const nif = (container.querySelector('#legal-nif')?.value || '').trim();
      const address = (container.querySelector('#legal-address')?.value || '').trim();
      const taxName = (container.querySelector('#legal-tax-name')?.value || '').trim();
      const taxRate = parseFloat(container.querySelector('#legal-tax-rate')?.value || '0');

      if (!businessName || !companyName || !nif || !address || !taxName || isNaN(taxRate)) {
        showToast('Por favor, rellena todos los campos correctamente.', 'error');
        return;
      }

      const saved = store.updateLegalSettings({
        businessName,
        companyName,
        nif,
        address,
        taxName,
        taxRate
      });

      if (!saved) {
        showToast('Solo el administrador puede modificar los datos fiscales.', 'error');
        return;
      }

      store.navigateSettings([]);
      showToast('Datos fiscales guardados y sincronizados.', 'success');
    });
  }

  const toInformesBtn = container.querySelector('#settings-to-informes');
  if (toInformesBtn) {
    toInformesBtn.addEventListener('click', () => {
      store.navigateSettings(['informes']);
    });
  }

  const toCierreBtn = container.querySelector('#settings-to-cierre');
  if (toCierreBtn) {
    toCierreBtn.addEventListener('click', () => {
      store.navigateSettings(['cierre']);
    });
  }

  const toComprasBtn = container.querySelector('#settings-to-compras');
  if (toComprasBtn) {
    toComprasBtn.addEventListener('click', () => {
      store.navigateSettings(['compras']);
    });
  }

  const toFidelidadBtn = container.querySelector('#settings-to-fidelidad');
  if (toFidelidadBtn) {
    toFidelidadBtn.addEventListener('click', () => {
      store.navigateSettings(['fidelidad']);
      if (isLoyaltyConfigured) {
        refreshLoyaltyAdminCurrentTab({ keepSelection: false });
      }
    });
  }

  container.querySelectorAll('[data-loyalty-admin-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      loyaltyAdminTab = btn.dataset.loyaltyAdminTab || 'resumen';
      refreshLoyaltyAdminCurrentTab({ keepSelection: true });
    });
  });

  const loyaltyAdminSearchInput = container.querySelector('#loyalty-admin-search-input');
  if (loyaltyAdminSearchInput) {
    loyaltyAdminSearchInput.addEventListener('input', (e) => {
      loyaltyAdminQuery = e.target.value;
    });
    loyaltyAdminSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadLoyaltyAdminCustomers({ keepSelection: false });
      }
    });
  }

  const loyaltyAdminSearchBtn = container.querySelector('#loyalty-admin-search-btn');
  if (loyaltyAdminSearchBtn) {
    loyaltyAdminSearchBtn.addEventListener('click', () => {
      loadLoyaltyAdminCustomers({ keepSelection: false });
    });
  }

  const loyaltyAdminRefreshBtn = container.querySelector('#loyalty-admin-refresh-btn');
  if (loyaltyAdminRefreshBtn) {
    loyaltyAdminRefreshBtn.addEventListener('click', () => {
      refreshLoyaltyAdminCurrentTab({ keepSelection: true });
    });
  }

  const loyaltyAdminCreateBtn = container.querySelector('#loyalty-admin-create-btn');
  if (loyaltyAdminCreateBtn) {
    loyaltyAdminCreateBtn.addEventListener('click', () => {
      showCreateLoyaltyCustomerModal();
    });
  }

  const loyaltyAdminEditCustomerBtn = container.querySelector('#loyalty-admin-edit-customer-btn');
  if (loyaltyAdminEditCustomerBtn) {
    loyaltyAdminEditCustomerBtn.addEventListener('click', () => {
      showEditLoyaltyCustomerModal(loyaltyAdminSelectedCustomer);
    });
  }

  const loyaltyAdminCreatePromoBtn = container.querySelector('#loyalty-admin-create-promo-btn');
  if (loyaltyAdminCreatePromoBtn) {
    loyaltyAdminCreatePromoBtn.addEventListener('click', () => {
      showLoyaltyPromoModal();
    });
  }

  container.querySelectorAll('[data-loyalty-customer-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectLoyaltyAdminCustomer(btn.dataset.loyaltyCustomerId);
    });
  });

  container.querySelectorAll('[data-loyalty-promo-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const promo = loyaltyAdminPromos.find(item => String(item.id) === String(btn.dataset.loyaltyPromoEditId));
      showLoyaltyPromoModal(promo);
    });
  });

  container.querySelectorAll('[data-loyalty-promo-toggle-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await setLoyaltyPromoActive(btn.dataset.loyaltyPromoToggleId, btn.dataset.nextActive === 'true');
        await loadLoyaltyAdminPromos();
        showToast('Promo actualizada.', 'success');
      } catch (error) {
        console.error('[Fidelidad] Error actualizando promo', error);
        showToast(error.message || 'No se pudo actualizar la promo.', 'error');
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('[data-loyalty-voucher-use-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await updateLoyaltyVoucherStatus(btn.dataset.loyaltyVoucherUseId, 'used');
        await loadLoyaltyAdminVouchers();
        showToast('Canje marcado como usado.', 'success');
      } catch (error) {
        console.error('[Fidelidad] Error usando canje', error);
        showToast(error.message || 'No se pudo actualizar el canje.', 'error');
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('[data-loyalty-voucher-cancel-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Cancelar este canje y devolver los puntos al cliente?')) return;
      btn.disabled = true;
      try {
        await updateLoyaltyVoucherStatus(btn.dataset.loyaltyVoucherCancelId, 'cancelled');
        await loadLoyaltyAdminVouchers();
        showToast('Canje cancelado y puntos devueltos.', 'success');
      } catch (error) {
        console.error('[Fidelidad] Error cancelando canje', error);
        showToast(error.message || 'No se pudo cancelar el canje.', 'error');
        btn.disabled = false;
      }
    });
  });

  const closureExportMonthInput = container.querySelector('#cash-closure-export-month-input');
  if (closureExportMonthInput) {
    closureExportMonthInput.addEventListener('change', (e) => {
      store.state.selectedReportMonth = e.target.value || new Date().toISOString().slice(0, 7);
      store.notify();
    });
  }

  const closureExportBtn = container.querySelector('#cash-closure-export-btn');
  if (closureExportBtn) {
    closureExportBtn.addEventListener('click', () => {
      const selectedMonth = store.state.selectedReportMonth || new Date().toISOString().slice(0, 7);
      const closures = store.state.cashClosures.filter(item => String(item.businessDate || '').startsWith(selectedMonth));
      if (!closures.length) {
        showToast('No hay cierres guardados en ese mes para exportar.', 'warning');
        return;
      }
      downloadCashClosuresExcel(selectedMonth, closures, store.state.legal);
    });
  }

  const closureDateInput = container.querySelector('#cash-closure-date-input');
  if (closureDateInput) {
    closureDateInput.addEventListener('change', (e) => {
      store.state.selectedReportDate = e.target.value || new Date().toISOString().slice(0, 10);
      store.state.selectedReportMonth = store.state.selectedReportDate.slice(0, 7);
      store.notify();
    });
  }

  const cashClosureForm = container.querySelector('#cash-closure-form');
  if (cashClosureForm) {
    const calcClosure = () => {
      const preview = container.querySelector('#closure-live-preview');
      if (!preview) return;
      const expectedCash = parseFloat(preview.dataset.expectedCash || '0');
      const expectedCard = parseFloat(preview.dataset.expectedCard || '0');
      const openingCash = parseFloat(container.querySelector('#closure-opening-cash')?.value || '0');
      const countedCash = parseFloat(container.querySelector('#closure-counted-cash')?.value || '0');
      const bbvaTotal = parseFloat(container.querySelector('#closure-bbva-total')?.value || '0');
      const expectedDrawer = openingCash + expectedCash;
      const cashDifference = countedCash - expectedDrawer;
      const cardDifference = bbvaTotal - expectedCard;
      const cashColor = Math.abs(cashDifference) > 0.009 ? 'var(--danger)' : 'var(--secondary)';
      const cardColor = Math.abs(cardDifference) > 0.009 ? 'var(--danger)' : 'var(--secondary)';
      preview.innerHTML = `
        <div style="display:grid; gap:6px;">
          <span>Cajón esperado: <strong>${expectedDrawer.toFixed(2)}€</strong> = fondo ${openingCash.toFixed(2)}€ + efectivo app ${expectedCash.toFixed(2)}€</span>
          <span>Diferencia efectivo: <strong style="color:${cashColor};">${cashDifference.toFixed(2)}€</strong></span>
          <span>Diferencia BBVA: <strong style="color:${cardColor};">${cardDifference.toFixed(2)}€</strong></span>
        </div>
      `;
    };

    const calcBtn = container.querySelector('#closure-calc-btn');
    if (calcBtn) {
      calcBtn.addEventListener('click', calcClosure);
    }

    ['#closure-opening-cash', '#closure-counted-cash', '#closure-bbva-total'].forEach(selector => {
      const input = container.querySelector(selector);
      if (input) input.addEventListener('input', calcClosure);
    });

    cashClosureForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const businessDate = container.querySelector('#cash-closure-date-input')?.value || new Date().toISOString().slice(0, 10);
      const saved = await store.saveCashClosure({
        businessDate,
        openingCash: parseFloat(container.querySelector('#closure-opening-cash')?.value || '0'),
        countedCash: parseFloat(container.querySelector('#closure-counted-cash')?.value || '0'),
        bbvaTotal: parseFloat(container.querySelector('#closure-bbva-total')?.value || '0'),
        notes: container.querySelector('#closure-notes')?.value || ''
      });
      showToast(saved ? 'Cierre guardado. El nuevo turno empieza automaticamente.' : 'No se pudo guardar el cierre. Puede estar ya cerrado o faltar la migracion de Supabase.', saved ? 'success' : 'warning');
    });
  }

  const accountingMonthInput = container.querySelector('#accounting-month-input');
  if (accountingMonthInput) {
    accountingMonthInput.addEventListener('change', (e) => {
      store.state.selectedReportMonth = e.target.value;
      store.notify();
    });
  }

  const createInvoiceBtn = container.querySelector('#settings-create-invoice-btn');
  if (createInvoiceBtn) {
    createInvoiceBtn.addEventListener('click', () => {
      store.navigateSettings(['compras', 'nueva']);
    });
  }

  const importGeminiBtn = container.querySelector('#settings-import-gemini-btn');
  if (importGeminiBtn) {
    importGeminiBtn.addEventListener('click', () => {
      store.navigateSettings(['compras', 'importar-gemini']);
    });
  }

  const geminiPreviewBtn = container.querySelector('#gemini-preview-btn');
  if (geminiPreviewBtn) {
    geminiPreviewBtn.addEventListener('click', () => {
      geminiInvoiceRawText = container.querySelector('#gemini-invoice-raw-text')?.value || '';
      if (!geminiInvoiceRawText.trim()) {
        showToast('Pega primero el texto de Gemini.', 'warning');
        return;
      }
      geminiInvoicePreview = parseGeminiInvoiceText(geminiInvoiceRawText, {
        taxRate: store.state.legal?.taxRate ?? 7,
        existingInvoices: store.state.supplierInvoices || []
      });
      if (geminiInvoicePreview.totals.rows === 0) {
        showToast('No pude detectar lineas de factura en el texto.', 'warning');
      } else {
        showToast(`Detectadas ${geminiInvoicePreview.totals.rows} lineas.`, 'success');
      }
      render(store.state);
    });
  }

  const geminiCopyPromptBtn = container.querySelector('#gemini-copy-prompt-btn');
  if (geminiCopyPromptBtn) {
    geminiCopyPromptBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(GEMINI_FOLDER_INVOICE_PROMPT);
        showToast('Prompt copiado.', 'success');
      } catch (error) {
        const promptBox = container.querySelector('#gemini-prompt-text');
        promptBox?.select();
        showToast('Selecciona y copia el prompt manualmente.', 'warning');
      }
    });
  }

  const geminiClearBtn = container.querySelector('#gemini-clear-btn');
  if (geminiClearBtn) {
    geminiClearBtn.addEventListener('click', () => {
      geminiInvoiceRawText = '';
      geminiInvoicePreview = null;
      render(store.state);
    });
  }

  const geminiImportConfirmBtn = container.querySelector('#gemini-import-confirm-btn');
  if (geminiImportConfirmBtn) {
    geminiImportConfirmBtn.addEventListener('click', async () => {
      if (!geminiInvoicePreview?.invoices?.length) {
        showToast('No hay facturas para importar.', 'warning');
        return;
      }
      const invoicesToImport = geminiInvoicePreview.invoices.filter(invoice => invoice.importable !== false);
      const imported = await store.importGeminiInvoices(invoicesToImport);
      if (imported) {
        const importedCount = invoicesToImport.length;
        const skippedCount = geminiInvoicePreview.invoices.length - invoicesToImport.length;
        const month = invoicesToImport[0]?.invoiceDate?.slice(0, 7);
        if (month) store.state.selectedReportMonth = month;
        geminiInvoicePreview = null;
        geminiInvoiceRawText = '';
        render(store.state);
        showToast(`${importedCount} factura${importedCount === 1 ? '' : 's'} importada${importedCount === 1 ? '' : 's'}${skippedCount ? `, ${skippedCount} duplicada${skippedCount === 1 ? '' : 's'} omitida${skippedCount === 1 ? '' : 's'}` : ''}. Lista para la siguiente.`, 'success');
      } else {
        showToast('No tienes permiso para importar facturas.', 'error');
      }
    });
  }

  container.querySelectorAll('[data-edit-invoice-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.navigateSettings(['compras', btn.dataset.editInvoiceId]);
    });
  });

  const invoiceForm = container.querySelector('#supplier-invoice-form');
  if (invoiceForm) {
    const baseInput = container.querySelector('#invoice-base-amount');
    const rateInput = container.querySelector('#invoice-tax-rate');
    const taxInput = container.querySelector('#invoice-tax-amount');
    const totalInput = container.querySelector('#invoice-total-amount');

    const recalcInvoiceTotals = () => {
      const base = parseFloat(baseInput?.value || '0');
      const rate = parseFloat(rateInput?.value || '0');
      if (!Number.isFinite(base) || !Number.isFinite(rate)) return;
      const tax = parseFloat((base * rate / 100).toFixed(2));
      const total = parseFloat((base + tax).toFixed(2));
      if (taxInput && document.activeElement !== taxInput) taxInput.value = tax ? tax.toFixed(2) : '';
      if (totalInput && document.activeElement !== totalInput) totalInput.value = total ? total.toFixed(2) : '';
    };

    baseInput?.addEventListener('input', recalcInvoiceTotals);
    rateInput?.addEventListener('input', recalcInvoiceTotals);

    invoiceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = invoiceForm.dataset.invoiceId || undefined;
      const supplierName = (container.querySelector('#invoice-supplier-name')?.value || '').trim();
      const invoiceNumber = (container.querySelector('#invoice-number')?.value || '').trim();
      const invoiceDate = container.querySelector('#invoice-date')?.value || '';
      const category = (container.querySelector('#invoice-category')?.value || '').trim();
      const baseAmount = parseFloat(baseInput?.value || '0');
      const taxRate = parseFloat(rateInput?.value || '0');
      const taxAmount = parseFloat(taxInput?.value || '0');
      const totalAmount = parseFloat(totalInput?.value || '0');
      const deductible = container.querySelector('#invoice-deductible')?.checked !== false;
      const source = container.querySelector('#invoice-source')?.value || 'manual';
      const senderEmail = (container.querySelector('#invoice-sender-email')?.value || '').trim().toLowerCase();
      const notes = (container.querySelector('#invoice-notes')?.value || '').trim();

      if (!supplierName || !invoiceDate || !Number.isFinite(baseAmount) || !Number.isFinite(taxAmount) || !Number.isFinite(totalAmount)) {
        showToast('Revisa proveedor, fecha e importes.', 'error');
        return;
      }

      const saved = await store.saveSupplierInvoice({
        id,
        supplierName,
        invoiceNumber,
        invoiceDate,
        category,
        baseAmount,
        taxRate,
        taxAmount,
        totalAmount,
        deductible,
        source,
        senderEmail,
        notes,
        status: 'confirmed'
      });

      if (saved) {
        store.state.selectedReportMonth = invoiceDate.slice(0, 7);
        store.navigateSettings(['compras']);
        showToast('Factura guardada.', 'success');
      } else {
        showToast('No tienes permiso para guardar facturas.', 'error');
      }
    });
  }

  const deleteInvoiceBtn = container.querySelector('#settings-delete-invoice-btn');
  if (deleteInvoiceBtn) {
    deleteInvoiceBtn.addEventListener('click', () => {
      const id = container.querySelector('#supplier-invoice-form')?.dataset.invoiceId;
      if (!id) return;
      showConfirm(
        'Eliminar factura',
        'La compra dejara de contar en el calculo contable. ¿Quieres continuar?',
        async () => {
          const deleted = await store.deleteSupplierInvoice(id);
          if (deleted) {
            store.navigateSettings(['compras']);
            showToast('Factura eliminada.', 'success');
          }
        },
        null,
        true
      );
    });
  }

  const toStaffBtn = container.querySelector('#settings-to-staff');
  if (toStaffBtn) {
    toStaffBtn.addEventListener('click', () => {
      store.navigateSettings(['staff']);
    });
  }

  const createStaffBtn = container.querySelector('#settings-create-staff-btn');
  if (createStaffBtn) {
    createStaffBtn.addEventListener('click', () => {
      store.navigateSettings(['staff', 'nuevo']);
    });
  }

  const rolePermissionsBtn = container.querySelector('#settings-to-role-permissions');
  if (rolePermissionsBtn) {
    rolePermissionsBtn.addEventListener('click', () => {
      store.navigateSettings(['staff', 'permisos']);
    });
  }

  container.querySelectorAll('.role-permission-input').forEach(input => {
    input.addEventListener('change', () => {
      const role = input.dataset.role;
      const permission = input.dataset.permission;
      const current = store.state.rolePermissions?.[role] || {};
      const saved = store.updateRolePermissions(role, {
        ...current,
        [permission]: input.checked
      });
      showToast(saved ? 'Permisos actualizados.' : 'No tienes permiso para cambiar permisos.', saved ? 'success' : 'error');
    });
  });

  container.querySelectorAll('[data-edit-staff-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.navigateSettings(['staff', btn.dataset.editStaffId]);
    });
  });

  const staffForm = container.querySelector('#settings-staff-form');
  if (staffForm) {
    staffForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = staffForm.dataset.staffId || undefined;
      const displayName = (container.querySelector('#staff-display-name')?.value || '').trim();
      const role = container.querySelector('#staff-role')?.value || 'staff';
      const pinCode = (container.querySelector('#staff-pin-code')?.value || '').trim();
      const active = container.querySelector('#staff-active')?.checked !== false;

      if (!displayName || !/^\d{4,8}$/.test(pinCode)) {
        showToast('El nombre es obligatorio y el PIN debe tener entre 4 y 8 digitos.', 'error');
        return;
      }

      const pinExists = store.state.staffProfiles.some(profile => profile.id !== id && profile.pin_code === pinCode);
      if (pinExists) {
        showToast('Ese PIN ya lo usa otro empleado.', 'error');
        return;
      }

      const saved = await store.saveStaffProfile({ id, displayName, role, pinCode, active });
      if (saved) {
        store.navigateSettings(['staff']);
        showToast('Empleado guardado.', 'success');
      } else {
        showToast('No tienes permiso para gestionar personal.', 'error');
      }
    });
  }

  const deleteStaffBtn = container.querySelector('#settings-delete-staff-btn');
  if (deleteStaffBtn) {
    deleteStaffBtn.addEventListener('click', () => {
      const id = container.querySelector('#settings-staff-form')?.dataset.staffId;
      if (!id) return;
      showConfirm(
        'Eliminar empleado',
        'Este PIN dejara de funcionar. ¿Quieres continuar?',
        async () => {
          const deleted = await store.deleteStaffProfile(id);
          if (deleted) {
            store.navigateSettings(['staff']);
            showToast('Empleado eliminado.', 'success');
          } else {
            showToast('No puedes eliminar tu propio usuario activo.', 'error');
          }
        },
        null,
        true
      );
    });
  }

  const toDiarioBtn = container.querySelector('#settings-to-informes-diario');
  if (toDiarioBtn) {
    toDiarioBtn.addEventListener('click', () => {
      store.navigateSettings(['informes', 'diario']);
    });
  }

  const toMensualBtn = container.querySelector('#settings-to-informes-mensual');
  if (toMensualBtn) {
    toMensualBtn.addEventListener('click', () => {
      store.navigateSettings(['informes', 'mensual']);
    });
  }

  // Date picker events
  const dateInput = container.querySelector('#report-date-input');
  if (dateInput) {
    dateInput.addEventListener('change', (e) => {
      store.state.selectedReportDate = e.target.value;
      store.notify();
    });
  }

  const datePrev = container.querySelector('#report-date-prev');
  if (datePrev) {
    datePrev.addEventListener('click', () => {
      const parts = store.state.selectedReportDate.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const dateObj = new Date(y, m, d);
      dateObj.setDate(dateObj.getDate() - 1);
      
      const resY = dateObj.getFullYear();
      const resM = String(dateObj.getMonth() + 1).padStart(2, '0');
      const resD = String(dateObj.getDate()).padStart(2, '0');
      
      store.state.selectedReportDate = `${resY}-${resM}-${resD}`;
      store.notify();
    });
  }

  const dateNext = container.querySelector('#report-date-next');
  if (dateNext) {
    dateNext.addEventListener('click', () => {
      const parts = store.state.selectedReportDate.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const dateObj = new Date(y, m, d);
      dateObj.setDate(dateObj.getDate() + 1);
      
      const resY = dateObj.getFullYear();
      const resM = String(dateObj.getMonth() + 1).padStart(2, '0');
      const resD = String(dateObj.getDate()).padStart(2, '0');
      
      store.state.selectedReportDate = `${resY}-${resM}-${resD}`;
      store.notify();
    });
  }

  // Month picker events
  const monthInput = container.querySelector('#report-month-input');
  if (monthInput) {
    monthInput.addEventListener('change', (e) => {
      store.state.selectedReportMonth = e.target.value;
      store.notify();
    });
  }

  const monthPrev = container.querySelector('#report-month-prev');
  if (monthPrev) {
    monthPrev.addEventListener('click', () => {
      const parts = store.state.selectedReportMonth.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const dateObj = new Date(y, m, 1);
      dateObj.setMonth(dateObj.getMonth() - 1);
      
      const resY = dateObj.getFullYear();
      const resM = String(dateObj.getMonth() + 1).padStart(2, '0');
      
      store.state.selectedReportMonth = `${resY}-${resM}`;
      store.notify();
    });
  }

  const monthNext = container.querySelector('#report-month-next');
  if (monthNext) {
    monthNext.addEventListener('click', () => {
      const parts = store.state.selectedReportMonth.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const dateObj = new Date(y, m, 1);
      dateObj.setMonth(dateObj.getMonth() + 1);
      
      const resY = dateObj.getFullYear();
      const resM = String(dateObj.getMonth() + 1).padStart(2, '0');
      
      store.state.selectedReportMonth = `${resY}-${resM}`;
      store.notify();
    });
  }

  // Export buttons
  const btnExportDiario = container.querySelector('#btn-export-diario');
  if (btnExportDiario) {
    btnExportDiario.addEventListener('click', () => {
      const getTxDate = (tx) => {
        if (tx.createdAt) return new Date(tx.createdAt);
        if (tx.date) {
          const [datePart, timePart] = tx.date.split(', ');
          const [day, month, year] = datePart.split('/').map(Number);
          const [hour, minute] = timePart.split(':').map(Number);
          return new Date(year, month - 1, day, hour, minute);
        }
        return new Date();
      };

      const getTxDateKey = (tx) => {
        const d = getTxDate(tx);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      };

      const selectedDate = store.state.selectedReportDate || new Date().toISOString().slice(0, 10);
      const dayTx = store.state.transactions.filter(tx => getTxDateKey(tx) === selectedDate);
      const filename = `Informe-Diario-${selectedDate}.pdf`;

      downloadDailyReportPDF(selectedDate, dayTx, store.state.legal, filename);
    });
  }

  const btnExportMensual = container.querySelector('#btn-export-mensual');
  if (btnExportMensual) {
    btnExportMensual.addEventListener('click', () => {
      const getTxDate = (tx) => {
        if (tx.createdAt) return new Date(tx.createdAt);
        if (tx.date) {
          const [datePart, timePart] = tx.date.split(', ');
          const [day, month, year] = datePart.split('/').map(Number);
          const [hour, minute] = timePart.split(':').map(Number);
          return new Date(year, month - 1, day, hour, minute);
        }
        return new Date();
      };

      const getTxMonthKey = (tx) => {
        const d = getTxDate(tx);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${yyyy}-${mm}`;
      };

      const selectedMonth = store.state.selectedReportMonth || new Date().toISOString().slice(0, 7);
      const monthTx = store.state.transactions.filter(tx => getTxMonthKey(tx) === selectedMonth);

      const dailyAgg = {};
      monthTx.forEach(tx => {
        const d = getTxDate(tx);
        const day = d.getDate();
        const dateStr = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        
        if (!dailyAgg[day]) {
          dailyAgg[day] = {
            day,
            dateStr,
            count: 0,
            gross: 0,
            refunds: 0,
            net: 0,
            cash: 0,
            card: 0
          };
        }

        const val = Number(tx.total || 0);
        const method = (tx.paymentMethod || '').toLowerCase().trim();
        const isCash = method.includes('efectivo');

        if (tx.type === 'refund') {
          dailyAgg[day].refunds += Math.abs(val);
          dailyAgg[day].net += val;
          if (isCash) dailyAgg[day].cash += val;
          else dailyAgg[day].card += val;
        } else {
          dailyAgg[day].count += 1;
          dailyAgg[day].gross += val;
          dailyAgg[day].net += val;
          if (isCash) dailyAgg[day].cash += val;
          else dailyAgg[day].card += val;
        }
      });

      const sortedDays = Object.values(dailyAgg).sort((a, b) => a.day - b.day);
      const filename = `Informe-Mensual-${selectedMonth}.pdf`;

      downloadMonthlyReportPDF(selectedMonth, sortedDays, store.state.legal, filename);
    });
  }

  const btnExportMensualExcel = container.querySelector('#btn-export-mensual-excel');
  if (btnExportMensualExcel) {
    btnExportMensualExcel.addEventListener('click', () => {
      const getTxDate = (tx) => {
        if (tx.createdAt) return new Date(tx.createdAt);
        if (tx.date) {
          const [datePart, timePart = '00:00'] = tx.date.split(', ');
          const [day, month, year] = datePart.split('/').map(Number);
          const [hour, minute] = timePart.split(':').map(Number);
          return new Date(year, month - 1, day, hour || 0, minute || 0);
        }
        return new Date();
      };

      const selectedMonth = store.state.selectedReportMonth || new Date().toISOString().slice(0, 7);
      const monthTx = store.state.transactions.filter(tx => {
        const d = getTxDate(tx);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${yyyy}-${mm}` === selectedMonth;
      });

      if (!monthTx.length) {
        showToast('No hay ventas en ese mes para exportar.', 'warning');
        return;
      }

      downloadMonthlySalesExcel(selectedMonth, monthTx, store.state.legal);
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
      // Clear article search when leaving the list
      store.state.articleSearchQuery = '';
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

  // Article live search
  const articleSearchInput = container.querySelector('#article-search-input');
  if (articleSearchInput) {
    // Focus at end of current text (preserves typed query on re-render)
    articleSearchInput.focus();
    const len = articleSearchInput.value.length;
    articleSearchInput.setSelectionRange(len, len);

    articleSearchInput.addEventListener('input', (e) => {
      store.state.articleSearchQuery = e.target.value;
      store.notify();
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
      const image = container.querySelector('#article-image-preview')?.dataset.imageBase64 || null;

      if (!name) { showToast('El nombre no puede estar vacío.', 'error'); return; }
      if (isNaN(price) || price < 0) { showToast('El precio debe ser un número válido mayor o igual a 0.', 'error'); return; }
      if (!category) { showToast('Selecciona una categoría.', 'error'); return; }

      const modifiers = Array.from(container.querySelectorAll('#create-article-modifiers-checklist .assign-checkbox-card.assigned'))
        .map(card => card.dataset.createModifierId);

      store.addMenuItem({ name, price, category, modifiers, image });
      store.navigateSettings(['articulos', 'todos']);
      showToast('Artículo creado correctamente.', 'success');
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
      const image = container.querySelector('#article-image-preview')?.dataset.imageBase64 || null;

      if (!name) {
        showToast('El nombre no puede estar vacío.', 'error');
        return;
      }
      if (isNaN(price) || price < 0) {
        showToast('El precio debe ser un número válido mayor o igual a 0.', 'error');
        return;
      }

      // Collect selected modifier IDs
      const modifiers = Array.from(container.querySelectorAll('#article-modifiers-checklist .assign-checkbox-card.assigned'))
        .map(card => card.dataset.articleModifierId);

      store.updateMenuItem(itemId, { name, price, category, modifiers, image });
      store.goBackSettings();
      showToast('Artículo actualizado correctamente.', 'success');
    });
  }

  // Article Image Picker (For both Create and Edit Article)
  const btnSelectImage = container.querySelector('#btn-select-article-image');
  const btnRemoveImage = container.querySelector('#btn-remove-article-image');
  const fileInput = container.querySelector('#article-image-file-input');
  const previewEl = container.querySelector('#article-image-preview');

  if (btnSelectImage && fileInput) {
    btnSelectImage.addEventListener('click', () => {
      fileInput.click();
    });
  }

  if (fileInput && previewEl) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Show loading state on preview briefly
        previewEl.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">...</span>';
        
        const reader = new FileReader();
        reader.onload = function(event) {
          const img = new Image();
          img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxDim = 300; // max size

            if (width > height) {
              if (width > maxDim) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              }
            } else {
              if (height > maxDim) {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            previewEl.dataset.imageBase64 = dataUrl;
            previewEl.style.backgroundImage = `url('${dataUrl}')`;
            previewEl.innerHTML = '';
            
            if (btnRemoveImage) btnRemoveImage.style.display = 'inline-block';
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (btnRemoveImage && previewEl && fileInput) {
    btnRemoveImage.addEventListener('click', () => {
      previewEl.dataset.imageBase64 = '';
      previewEl.style.backgroundImage = 'none';
      previewEl.innerHTML = '<span style="font-size: 1.5rem; color: var(--text-muted);">📷</span>';
      fileInput.value = '';
      btnRemoveImage.style.display = 'none';
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
        showToast('El nombre de la categoría no puede estar vacío.', 'error');
        return;
      }

      store.addCategory({ name, type: 'category' });
      store.goBackSettings();
      showToast('Categoría creada correctamente.', 'success');
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
        showToast('El nombre de la subcategoría no puede estar vacío.', 'error');
        return;
      }

      store.addCategory({ name, type: 'subcategory', parentId });
      store.goBackSettings();
      showToast('Subcategoría creada correctamente.', 'success');
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
        showToast('El nombre de la categoría no puede estar vacío.', 'error');
        return;
      }

      store.updateCategory(catId, { name, type: 'category' });
      store.goBackSettings();
      showToast('Categoría actualizada correctamente.', 'success');
    });
  }

  const editParentCatDeleteBtn = container.querySelector('#edit-parent-cat-delete-btn');
  if (editParentCatDeleteBtn) {
    editParentCatDeleteBtn.addEventListener('click', () => {
      const catId = editParentCatDeleteBtn.dataset.deleteCatId;
      if (!catId) return;

      showConfirm(
        'Eliminar Categoría',
        '¿Seguro que deseas eliminar esta categoría? Se borrarán de forma recursiva todas sus subcategorías y sus atajos del grid.',
        () => {
          store.deleteCategory(catId);
          store.navigateSettings(['articulos', 'categorias']);
          showToast('Categoría eliminada correctamente.', 'success');
        },
        null,
        true // isDanger
      );
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
        showToast('El nombre de la subcategoría no puede estar vacío.', 'error');
        return;
      }

      store.updateCategory(subcatId, { name, type: 'subcategory', parentId });
      store.goBackSettings();
      showToast('Subcategoría actualizada correctamente.', 'success');
    });
  }

  const editSubcatDeleteBtn = container.querySelector('#edit-subcat-delete-btn');
  if (editSubcatDeleteBtn) {
    editSubcatDeleteBtn.addEventListener('click', () => {
      const subcatId = editSubcatDeleteBtn.dataset.deleteSubcatId;
      if (!subcatId) return;

      showConfirm(
        'Eliminar Subcategoría',
        '¿Seguro que deseas eliminar esta subcategoría? Se borrará su atajo del grid.',
        () => {
          store.deleteCategory(subcatId);
          store.goBackSettings();
          showToast('Subcategoría eliminada correctamente.', 'success');
        },
        null,
        true // isDanger
      );
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
        showToast('El nombre del modificador no puede estar vacío.', 'error');
        return;
      }

      const newMod = store.addModifier({ name });
      store.navigateSettings(['articulos', 'modificadores', newMod.id]);
      showToast('Modificador creado. Añada opciones y asigne artículos.', 'success');
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
        showToast('El nombre del grupo no puede estar vacío.', 'error');
        return;
      }

      store.updateModifier(modId, { name });
      store.goBackSettings();
      showToast('Modificador guardado correctamente.', 'success');
    });
  }

  const editModDeleteBtn = container.querySelector('#edit-mod-delete-btn');
  if (editModDeleteBtn) {
    editModDeleteBtn.addEventListener('click', () => {
      const modId = editModDeleteBtn.dataset.deleteModId;
      if (modId) {
        showConfirm(
          'Eliminar Modificador',
          '¿Seguro que deseas eliminar este modificador?',
          () => {
            store.deleteModifier(modId);
            store.navigateSettings(['articulos', 'modificadores']);
            showToast('Modificador eliminado correctamente.', 'success');
          },
          null,
          true // isDanger
        );
      }
    });
  }

  // Toggle assigned articles panel in Modifier Editor
  const toggleAssignedBtn = container.querySelector('#toggle-assigned-items-btn');
  if (toggleAssignedBtn) {
    toggleAssignedBtn.addEventListener('click', () => {
      const panel = container.querySelector('#assigned-items-panel');
      const icon = container.querySelector('#assigned-toggle-icon');
      if (panel) {
        const isHidden = window.getComputedStyle(panel).display === 'none';
        panel.style.display = isHidden ? 'block' : 'none';
        if (icon) {
          icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        }
      }
    });
  }

  // Inline Option Add / Edit inside Edit Modifier Form
  const btnAddModOption = container.querySelector('#btn-add-mod-option');
  if (btnAddModOption) {
    btnAddModOption.addEventListener('click', () => {
      const modId = store.state.settingsPath[2];
      const optNameInput = container.querySelector('#new-opt-name');
      const optPriceInput = container.querySelector('#new-opt-price');
      const editOptIndexInput = container.querySelector('#edit-opt-index');
      const optionFormLabel = container.querySelector('#option-form-label');
      const cancelBtn = container.querySelector('#btn-cancel-edit-option');
      
      const name = optNameInput ? optNameInput.value.trim() : '';
      const price = optPriceInput ? parseFloat(optPriceInput.value) : 0;
      const editIndexRaw = editOptIndexInput ? editOptIndexInput.value : '';

      if (!name) {
        showToast('El nombre de la opción no puede estar vacío.', 'error');
        return;
      }
      if (isNaN(price) || price < 0) {
        showToast('El precio debe ser un número válido mayor o igual a 0.', 'error');
        return;
      }

      const mod = store.state.modifiers.find(m => m.id === modId);
      if (mod) {
        let newOptions = [...(mod.options || [])];
        if (editIndexRaw !== '') {
          // Edit existing option
          const idx = parseInt(editIndexRaw, 10);
          if (!isNaN(idx) && idx >= 0 && idx < newOptions.length) {
            newOptions[idx] = {
              ...newOptions[idx],
              name,
              price
            };
            showToast('Opción actualizada correctamente.', 'success');
          }
        } else {
          // Add new option
          const newOption = {
            id: 'opt-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now(),
            name,
            price
          };
          newOptions.push(newOption);
          showToast('Opción añadida correctamente.', 'success');
        }

        store.updateModifier(modId, { options: newOptions });

        // Reset form
        if (optNameInput) optNameInput.value = '';
        if (optPriceInput) optPriceInput.value = '';
        if (editOptIndexInput) editOptIndexInput.value = '';
        if (optionFormLabel) optionFormLabel.innerText = 'Nueva opción';
        if (cancelBtn) cancelBtn.style.display = 'none';
      }
    });
  }

  // Cancel edit option mode button
  const btnCancelEditOption = container.querySelector('#btn-cancel-edit-option');
  if (btnCancelEditOption) {
    btnCancelEditOption.addEventListener('click', () => {
      const optNameInput = container.querySelector('#new-opt-name');
      const optPriceInput = container.querySelector('#new-opt-price');
      const editOptIndexInput = container.querySelector('#edit-opt-index');
      const optionFormLabel = container.querySelector('#option-form-label');

      if (optNameInput) optNameInput.value = '';
      if (optPriceInput) optPriceInput.value = '';
      if (editOptIndexInput) editOptIndexInput.value = '';
      if (optionFormLabel) optionFormLabel.innerText = 'Nueva opción';
      btnCancelEditOption.style.display = 'none';
    });
  }

  // Inline Option Edit button trigger inside Edit Modifier Form
  container.querySelectorAll('.btn-edit-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const modId = store.state.settingsPath[2];
      const optIndex = parseInt(btn.dataset.optionIndex, 10);
      const mod = store.state.modifiers.find(m => m.id === modId);
      if (mod && !isNaN(optIndex) && optIndex >= 0 && optIndex < (mod.options || []).length) {
        const opt = mod.options[optIndex];
        const optNameInput = container.querySelector('#new-opt-name');
        const optPriceInput = container.querySelector('#new-opt-price');
        const editOptIndexInput = container.querySelector('#edit-opt-index');
        const optionFormLabel = container.querySelector('#option-form-label');
        const cancelBtn = container.querySelector('#btn-cancel-edit-option');

        if (optNameInput) optNameInput.value = opt.name;
        if (optPriceInput) optPriceInput.value = opt.price.toFixed(2);
        if (editOptIndexInput) editOptIndexInput.value = optIndex;
        if (optionFormLabel) optionFormLabel.innerText = 'Editar opción';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        if (optNameInput) optNameInput.focus();
      }
    });
  });

  // Inline Option Move Up inside Edit Modifier Form
  container.querySelectorAll('.btn-move-up-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const modId = store.state.settingsPath[2];
      const optIndex = parseInt(btn.dataset.optionIndex, 10);
      const mod = store.state.modifiers.find(m => m.id === modId);
      if (mod && !isNaN(optIndex) && optIndex > 0) {
        const newOptions = [...(mod.options || [])];
        const temp = newOptions[optIndex];
        newOptions[optIndex] = newOptions[optIndex - 1];
        newOptions[optIndex - 1] = temp;
        store.updateModifier(modId, { options: newOptions });
      }
    });
  });

  // Inline Option Move Down inside Edit Modifier Form
  container.querySelectorAll('.btn-move-down-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const modId = store.state.settingsPath[2];
      const optIndex = parseInt(btn.dataset.optionIndex, 10);
      const mod = store.state.modifiers.find(m => m.id === modId);
      if (mod && !isNaN(optIndex) && optIndex < (mod.options || []).length - 1) {
        const newOptions = [...(mod.options || [])];
        const temp = newOptions[optIndex];
        newOptions[optIndex] = newOptions[optIndex + 1];
        newOptions[optIndex + 1] = temp;
        store.updateModifier(modId, { options: newOptions });
      }
    });
  });

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

  // Article Editor Delete Button trigger
  const editItemDeleteBtn = container.querySelector('#edit-item-delete-btn');
  if (editItemDeleteBtn) {
    editItemDeleteBtn.addEventListener('click', () => {
      const itemId = editItemDeleteBtn.dataset.deleteItemId;
      if (itemId) {
        showConfirm(
          'Eliminar Artículo',
          '¿Seguro que deseas eliminar este artículo? Esto lo quitará del menú y de todos los atajos de pantalla.',
          () => {
            store.deleteMenuItem(itemId);
            store.navigateSettings(['articulos', 'todos']);
            showToast('Artículo eliminado correctamente.', 'success');
          },
          null,
          true // isDanger
        );
      }
    });
  }
}

// Generic Numeric Keypad Modal for Cash Payments / Split Payments
function showNumericKeypadModal({ title, placeholder, onSave }) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'generic-keypad-modal';
  modal.style.zIndex = '1100'; // Sits above payment modal (which has z-index 1000)

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 320px;">
      <div class="modal-header" style="border-bottom: none; padding-bottom: 0;">
        <h3 style="margin-bottom: 0; font-weight: 700; text-align: center; color: var(--text-main);">${title}</h3>
      </div>
      <div class="modal-body" style="padding: 10px 0;">
        <div class="keypad-display" id="generic-modal-keypad-display" style="font-size: 2.2rem; text-align: center; font-weight: 700; margin-bottom: 12px; color: var(--secondary); padding: 8px; background: var(--bg-item); border-radius: var(--border-radius-sm); border: 1px solid var(--border-color); min-height: 52px; display: flex; align-items: center; justify-content: center;">0.00 €</div>
        
        <div class="keypad-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 0 4px;">
          <button class="keypad-btn generic-modal-num-key" data-val="1" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">1</button>
          <button class="keypad-btn generic-modal-num-key" data-val="2" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">2</button>
          <button class="keypad-btn generic-modal-num-key" data-val="3" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">3</button>
          <button class="keypad-btn generic-modal-num-key" data-val="4" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">4</button>
          <button class="keypad-btn generic-modal-num-key" data-val="5" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">5</button>
          <button class="keypad-btn generic-modal-num-key" data-val="6" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">6</button>
          <button class="keypad-btn generic-modal-num-key" data-val="7" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">7</button>
          <button class="keypad-btn generic-modal-num-key" data-val="8" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">8</button>
          <button class="keypad-btn generic-modal-num-key" data-val="9" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">9</button>
          <button class="keypad-btn generic-modal-clear-key" style="height: 48px; font-size: 1.1rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--danger); border-radius: var(--border-radius-sm); cursor: pointer;">C</button>
          <button class="keypad-btn generic-modal-num-key" data-val="0" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">0</button>
          <button class="keypad-btn generic-modal-backspace-key" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-muted); border-radius: var(--border-radius-sm); cursor: pointer;">⌫</button>
        </div>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:space-between; gap:12px; border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 8px;">
        <button class="btn btn-secondary" id="generic-modal-cancel-btn" style="height:40px; flex: 1; font-weight:600;">Cancelar</button>
        <button class="btn btn-primary" id="generic-modal-save-btn" style="background-color: var(--secondary); border-color: var(--secondary); height:40px; flex: 1; color: white; font-weight:600;">Aceptar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let currentCents = 0;
  const displayEl = modal.querySelector('#generic-modal-keypad-display');

  const updateDisplay = () => {
    if (displayEl) {
      if (currentCents === 0 && placeholder !== undefined) {
        displayEl.innerText = `${placeholder.toFixed(2)} €`;
        displayEl.style.color = 'var(--text-muted)';
        displayEl.style.opacity = '0.6';
      } else {
        displayEl.innerText = `${(currentCents / 100).toFixed(2)} €`;
        displayEl.style.color = 'var(--secondary)';
        displayEl.style.opacity = '1';
      }
    }
  };

  updateDisplay();

  modal.querySelectorAll('.generic-modal-num-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      if (String(currentCents).length < 7) {
        if (currentCents === 0) {
          currentCents = parseInt(val, 10);
        } else {
          currentCents = parseInt(String(currentCents) + val, 10);
        }
        updateDisplay();
      }
    });
  });

  const clearBtn = modal.querySelector('.generic-modal-clear-key');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentCents = 0;
      updateDisplay();
    });
  }

  const backspaceBtn = modal.querySelector('.generic-modal-backspace-key');
  if (backspaceBtn) {
    backspaceBtn.addEventListener('click', () => {
      if (currentCents > 0) {
        const str = String(currentCents);
        if (str.length > 1) {
          currentCents = parseInt(str.substring(0, str.length - 1), 10);
        } else {
          currentCents = 0;
        }
        updateDisplay();
      }
    });
  }

  const handleKeyDown = (e) => {
    if (e.key >= '0' && e.key <= '9') {
      if (String(currentCents).length < 7) {
        if (currentCents === 0) {
          currentCents = parseInt(e.key, 10);
        } else {
          currentCents = parseInt(String(currentCents) + e.key, 10);
        }
        updateDisplay();
      }
    } else if (e.key === 'Backspace') {
      if (currentCents > 0) {
        const str = String(currentCents);
        if (str.length > 1) {
          currentCents = parseInt(str.substring(0, str.length - 1), 10);
        } else {
          currentCents = 0;
        }
        updateDisplay();
      }
    } else if (e.key === 'Escape') {
      closeModal();
    } else if (e.key === 'Enter') {
      saveValue();
    }
  };

  window.addEventListener('keydown', handleKeyDown);

  const closeModal = () => {
    window.removeEventListener('keydown', handleKeyDown);
    modal.remove();
  };

  const saveValue = () => {
    const finalAmount = currentCents === 0 && placeholder !== undefined ? placeholder : (currentCents / 100);
    onSave(finalAmount);
    closeModal();
  };

  modal.querySelector('#generic-modal-cancel-btn').addEventListener('click', closeModal);
  modal.querySelector('#generic-modal-save-btn').addEventListener('click', saveValue);
}

// Price Edit Modal Dialog
function showPriceEditModal(ticketItemId, currentPrice) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'price-edit-modal';

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 320px;">
      <div class="modal-header" style="border-bottom: none; padding-bottom: 0;">
        <h3 style="margin-bottom: 0; font-weight: 700; text-align: center;">Editar Precio Base</h3>
      </div>
      <div class="modal-body" style="padding: 10px 0;">
        <div class="keypad-display" id="modal-keypad-display" style="font-size: 2.2rem; text-align: center; font-weight: 700; margin-bottom: 12px; color: var(--secondary); padding: 8px; background: var(--bg-item); border-radius: var(--border-radius-sm); border: 1px solid var(--border-color);">0.00 €</div>
        
        <div class="keypad-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 0 4px;">
          <button class="keypad-btn modal-num-key" data-val="1" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">1</button>
          <button class="keypad-btn modal-num-key" data-val="2" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">2</button>
          <button class="keypad-btn modal-num-key" data-val="3" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">3</button>
          <button class="keypad-btn modal-num-key" data-val="4" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">4</button>
          <button class="keypad-btn modal-num-key" data-val="5" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">5</button>
          <button class="keypad-btn modal-num-key" data-val="6" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">6</button>
          <button class="keypad-btn modal-num-key" data-val="7" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">7</button>
          <button class="keypad-btn modal-num-key" data-val="8" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">8</button>
          <button class="keypad-btn modal-num-key" data-val="9" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">9</button>
          <button class="keypad-btn modal-clear-key" style="height: 48px; font-size: 1.1rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--danger); border-radius: var(--border-radius-sm); cursor: pointer;">C</button>
          <button class="keypad-btn modal-num-key" data-val="0" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer;">0</button>
          <button class="keypad-btn modal-backspace-key" style="height: 48px; font-size: 1.25rem; font-weight:600; background: var(--bg-item); border: 1px solid var(--border-color); color: var(--text-muted); border-radius: var(--border-radius-sm); cursor: pointer;">⌫</button>
        </div>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:space-between; gap:12px; border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 8px;">
        <button class="btn btn-secondary" id="price-edit-cancel-btn" style="height:40px; flex: 1; font-weight:600;">Cancelar</button>
        <button class="btn btn-primary" id="price-edit-save-btn" style="background-color: var(--secondary); border-color: var(--secondary); height:40px; flex: 1; color: white; font-weight:600;">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  let currentCents = Math.round(currentPrice * 100);
  const displayEl = modal.querySelector('#modal-keypad-display');
  
  const updateDisplay = () => {
    if (displayEl) {
      displayEl.innerText = `${(currentCents / 100).toFixed(2)} €`;
    }
  };
  
  updateDisplay();

  modal.querySelectorAll('.modal-num-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      if (String(currentCents).length < 7) {
        if (currentCents === 0) {
          currentCents = parseInt(val, 10);
        } else {
          currentCents = parseInt(String(currentCents) + val, 10);
        }
        updateDisplay();
      }
    });
  });

  modal.querySelector('.modal-clear-key').addEventListener('click', () => {
    currentCents = 0;
    updateDisplay();
  });

  modal.querySelector('.modal-backspace-key').addEventListener('click', () => {
    let s = String(currentCents);
    s = s.slice(0, -1);
    if (!s || s === '0') {
      currentCents = 0;
    } else {
      currentCents = parseInt(s, 10);
    }
    updateDisplay();
  });

  modal.querySelector('#price-edit-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  modal.querySelector('#price-edit-save-btn').addEventListener('click', () => {
    const val = currentCents / 100;
    store.updateItemBasePrice(ticketItemId, val);
    modal.remove();
  });

  const keydownHandler = (e) => {
    if (e.key >= '0' && e.key <= '9') {
      if (String(currentCents).length < 7) {
        if (currentCents === 0) currentCents = parseInt(e.key, 10);
        else currentCents = parseInt(String(currentCents) + e.key, 10);
        updateDisplay();
      }
    } else if (e.key === 'Backspace') {
      let s = String(currentCents);
      s = s.slice(0, -1);
      currentCents = (!s || s === '0') ? 0 : parseInt(s, 10);
      updateDisplay();
    } else if (e.key === 'Escape') {
      modal.querySelector('#price-edit-cancel-btn').click();
    } else if (e.key === 'Enter') {
      modal.querySelector('#price-edit-save-btn').click();
    }
  };
  
  document.addEventListener('keydown', keydownHandler);
  
  const originalRemove = modal.remove;
  modal.remove = function() {
    document.removeEventListener('keydown', keydownHandler);
    originalRemove.call(modal);
  };
}

// Bootstrapper
document.addEventListener('DOMContentLoaded', async () => {
  // Show loading overlay while fetching from Supabase
  const loadingEl = document.getElementById('app-loading-overlay');
  let pendingRenderState = null;
  let pendingRenderFrame = null;

  const scheduleRender = (state = store.state) => {
    const scrollSnapshot = captureScrollState(store.state);
    pendingRenderState = state;
    if (pendingRenderFrame) return;

    pendingRenderFrame = requestAnimationFrame(() => {
      pendingRenderFrame = null;
      const nextState = pendingRenderState || store.state;
      render(nextState);
      restoreScrollState(scrollSnapshot, nextState);
      pendingRenderState = null;
    });
  };

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
    scheduleRender(store.state); // refresh header dot color
  });

  // Bind store event reactive updates
  store.subscribe((state, meta = {}) => {
    if (meta.renderScope === 'ticket' && renderTicketOnly()) {
      return;
    }
    scheduleRender(state);
  });

  // Watch system theme changes for System theme mode
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (store.state.theme === 'system') {
      scheduleRender(store.state);
    }
  });

  await store.loadAuthSession();

  let loaded = false;
  if (store.state.auth.profile) {
    loaded = await store.loadFromSupabase();
    dbStatus = loaded ? 'connected' : 'fallback';
  } else {
    dbStatus = 'fallback';
  }

  if (loadingEl) {
    if (store.state.auth.profile && !loaded) {
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
    scheduleRender(store.state);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './' }).catch((error) => {
      console.warn('No se pudo registrar el service worker:', error);
    });
  }
});
