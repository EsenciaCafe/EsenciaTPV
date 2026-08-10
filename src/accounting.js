import { createClient } from '@supabase/supabase-js';
import {
  findMatchingContact,
  mergeContactKind
} from './accountingContacts.js';
import { mapBankRows, parseCsv, parseXlsx } from './bankStatement.js';
import { buildBusinessSnapshot } from './accountingDashboard.js';
import {
  PROFITABILITY_CATEGORIES,
  buildProfitabilityAnalysis,
  categoryDefinition
} from './profitabilityAnalysis.js';
import {
  IGIC_RATES,
  calculateDocumentTotals,
  calculatePriceVariation,
  emptyDocumentLine
} from './documentLines.js';
import {
  buildReconciliationComparison,
  reconciliationsByStatus
} from './reconciliationView.js';
import {
  classificationDefinition,
  classificationsForTransaction,
  outstandingDocumentsForTransaction,
  pendingBankTransactions,
  suggestBankClassification
} from './bankReview.js';
import { buildBankWorkspace, bankWorkspaceStatus } from './bankWorkspace.js';
import {
  bankImportSelection,
  buildBankImportBatches,
  clampBankImportRange,
  isBankTransactionIncluded,
  quarterRange
} from './bankImports.js';
import {
  GOOGLE_DRIVE_SCOPE,
  driveFileUrl,
  driveFolderUrl,
  driveImportStatus,
  driveReviewStatus,
  folderId,
  isSupportedInvoiceFile,
  resultFolderPrivacy,
  reviewableSupplierDocument,
  validateSupplierDocument
} from './driveInvoices.js';
import {
  RECURRING_FREQUENCIES,
  buildRecurringExpenseReview,
  recurringFrequencyLabel
} from './recurringExpenses.js';
import { buildControlCenter } from './controlCenter.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const appRoot = document.querySelector('#accounting-app');
const baseClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, storageKey: 'accounting-base-auth' }
}) : null;
const SESSION_KEY = 'accounting-session-v1';
const DEVICE_KEY = 'accounting-device-v1';
const VIEW_LABELS = {
  dashboard: 'Resumen',
  profitability: 'Rentabilidad',
  sales: 'Ventas',
  purchases: 'Compras y gastos',
  treasury: 'Tesorería',
  ledger: 'Contabilidad',
  taxes: 'Impuestos',
  drive: 'Google Drive',
  settings: 'Configuración'
};

const state = {
  view: 'dashboard',
  dashboardPeriod: 'month',
  profitabilityFilter: 'pending',
  reconciliationFilter: 'suggested',
  bankReviewView: 'pending',
  bankWorkFilter: 'all',
  bankReviewDirection: 'all',
  bankReviewSearch: '',
  bankReviewPage: 1,
  token: '',
  client: null,
  business: null,
  documents: [],
  contacts: [],
  bankAccounts: [],
  bankTransactions: [],
  bankImports: [],
  reconciliations: [],
  bankReviews: [],
  journalEntries: [],
  journalLines: [],
  accounts: [],
  taxDrafts: [],
  taxPeriods: [],
  driveSources: [],
  driveImports: [],
  profitabilityAnalyses: [],
  recurringExpenses: [],
  recurringExpenseOccurrences: [],
  driveFiles: [],
  driveFolders: {},
  driveResultPrivacy: null,
  driveBusy: false,
  loading: false,
  modal: null,
  googleToken: '',
  googleUser: null,
  error: ''
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}

function money(value = 0) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

function percent(value) {
  return value == null
    ? '—'
    : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(Number(value));
}

function compactDate(value) {
  return value.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
}

function dashboardPeriodLabel(snapshot) {
  const { period, start } = snapshot.bounds;
  if (period === 'year') return `Ejercicio ${start.getFullYear()}`;
  if (period === 'quarter') return `${Math.floor(start.getMonth() / 3) + 1}T ${start.getFullYear()}`;
  const label = start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function variationMarkup(value, options = {}) {
  if (value == null) return '<small class="metric-change is-neutral">Sin base comparable</small>';
  const sign = value > 0 ? '+' : '';
  const className = options.neutral ? 'is-neutral' : value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-neutral';
  return `<small class="metric-change ${className}">${sign}${percent(value)} % <span>vs tramo anterior</span></small>`;
}

function safeDriveUrl(value = '') {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname)
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function drivePreviewUrl(value = '') {
  const safeUrl = safeDriveUrl(value);
  if (!safeUrl) return '';
  const url = new URL(safeUrl);
  const fileId = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id');
  return fileId ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview` : safeUrl;
}

function displayDate(value) {
  if (!value) return '—';
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES');
}

function isoDate(value = new Date()) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function uuid() {
  return crypto.randomUUID();
}

function getDeviceKey() {
  let key = localStorage.getItem(DEVICE_KEY);
  if (!key) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    key = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_KEY, key);
  }
  return key;
}

function setSession(token, expiresAt) {
  state.token = token;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
  state.client = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { 'x-accounting-session': token } },
    auth: { persistSession: false, storageKey: 'accounting-owner-auth' }
  });
}

function clearSession() {
  state.token = '';
  state.client = null;
  localStorage.removeItem(SESSION_KEY);
}

function toast(message, kind = '') {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

async function rpc(name, params = {}, client = state.client || baseClient) {
  if (!client) throw new Error('Supabase no está configurado.');
  const { data, error } = await client.rpc(name, params);
  if (error) throw error;
  return data;
}

async function resumeOrPair() {
  if (!baseClient) return renderConfigurationMissing();
  const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  if (saved?.token && (!saved.expiresAt || new Date(saved.expiresAt) > new Date())) {
    setSession(saved.token, saved.expiresAt);
    try {
      await loadAll();
      return;
    } catch {
      clearSession();
    }
  }

  const knownDevice = localStorage.getItem(DEVICE_KEY);
  if (knownDevice) {
    try {
      const resumed = await rpc('accounting_resume_device', { p_device_key: knownDevice }, baseClient);
      if (resumed?.token) {
        setSession(resumed.token, resumed.expires_at);
        await loadAll();
        return;
      }
    } catch {
      // El dispositivo fue revocado o todavía no está vinculado.
    }
  }
  renderPairing();
}

function renderConfigurationMissing() {
  appRoot.innerHTML = `
    <div class="acc-login">
      <div class="acc-login-card">
        <div class="acc-mark">€</div>
        <h1>Falta configurar Supabase</h1>
        <p>Añade VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo de entorno y ejecuta la migración contable.</p>
      </div>
    </div>`;
}

function renderPairing() {
  const pairFromUrl = new URLSearchParams(location.search).get('pair') || '';
  appRoot.innerHTML = `
    <div class="acc-login">
      <form class="acc-login-card" id="pairing-form">
        <div class="acc-mark">€</div>
        <h1>Vincular Contabilidad</h1>
        <p>Abre esta app desde Ajustes del TPV. El código de un solo uso caduca a los 10 minutos.</p>
        <div class="acc-form">
          <div class="field">
            <label>Código de vinculación</label>
            <input id="pairing-code" value="${escapeHtml(pairFromUrl)}" maxlength="10" autocomplete="one-time-code" required>
          </div>
          <div class="field">
            <label>Nombre de este dispositivo</label>
            <input id="device-name" value="${escapeHtml(navigator.platform || 'Mi dispositivo')}" maxlength="80" required>
          </div>
          <button class="btn btn-primary" type="submit">Vincular dispositivo</button>
        </div>
      </form>
    </div>`;
  document.querySelector('#pairing-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const result = await rpc('accounting_pair_device', {
        p_pairing_code: document.querySelector('#pairing-code').value,
        p_device_key: getDeviceKey(),
        p_device_name: document.querySelector('#device-name').value
      }, baseClient);
      setSession(result.token, result.expires_at);
      history.replaceState({}, '', 'accounting.html');
      await rpc('accounting_seed_defaults');
      await loadAll();
    } catch (error) {
      toast(error.message || 'No se pudo vincular.', 'error');
      button.disabled = false;
    }
  });
}

async function loadAll() {
  state.loading = true;
  const query = (table, select = '*', order = null) => {
    let req = state.client.from(table).select(select);
    if (order) req = req.order(order.column, { ascending: order.ascending });
    return req;
  };
  const results = await Promise.all([
    query('accounting_businesses').limit(1),
    query('bookkeeping_documents', '*, accounting_contacts(name,tax_id)', { column: 'issue_date', ascending: false }),
    query('accounting_contacts', '*', { column: 'name', ascending: true }),
    query('accounting_bank_accounts', '*', { column: 'name', ascending: true }),
    query('accounting_bank_transactions', '*', { column: 'booked_on', ascending: false }).limit(500),
    query('accounting_bank_imports', '*', { column: 'created_at', ascending: false }).limit(100),
    query('accounting_reconciliations', '*, bookkeeping_documents(number,direction,total_amount), accounting_bank_transactions(booked_on,description,amount)', { column: 'created_at', ascending: false }),
    query('accounting_bank_reviews', '*', { column: 'reviewed_at', ascending: false }),
    query('accounting_accounts', '*', { column: 'code', ascending: true }),
    query('accounting_journal_entries', '*', { column: 'entry_date', ascending: false }).limit(300),
    query('accounting_journal_lines'),
    query('accounting_tax_drafts', '*, accounting_tax_periods(year,quarter,starts_on,ends_on)', { column: 'generated_at', ascending: false }),
    query('accounting_tax_periods', '*', { column: 'starts_on', ascending: false }),
    query('accounting_drive_sources').limit(1),
    query('accounting_drive_imports', '*, bookkeeping_documents(number,status,total_amount,accounting_contacts(name))', { column: 'created_at', ascending: false }).limit(500),
    query('accounting_document_analysis'),
    query('accounting_recurring_expenses', '*, accounting_contacts(name)', { column: 'name', ascending: true }),
    query('accounting_recurring_expense_occurrences', '*', { column: 'expected_on', ascending: false })
  ]);
  const failed = results.find(result => result.error);
  if (failed) throw failed.error;
  [
    state.business, state.documents, state.contacts, state.bankAccounts,
    state.bankTransactions, state.bankImports, state.reconciliations, state.bankReviews, state.accounts, state.journalEntries, state.journalLines,
    state.taxDrafts, state.taxPeriods, state.driveSources, state.driveImports, state.profitabilityAnalyses,
    state.recurringExpenses, state.recurringExpenseOccurrences
  ] = [
    results[0].data?.[0] || null, results[1].data || [], results[2].data || [],
    results[3].data || [], results[4].data || [], results[5].data || [], results[6].data || [], results[7].data || [],
    results[8].data || [], results[9].data || [], results[10].data || [],
    results[11].data || [], results[12].data || [], results[13].data || [], results[14].data || [],
    results[15].data || [], results[16].data || [], results[17].data || []
  ];
  state.loading = false;
  renderApp();
}

function navButton(view, icon, label) {
  return `<button data-view="${view}" class="${state.view === view ? 'is-active' : ''}"><span>${icon}</span><span>${label}</span></button>`;
}

function renderApp() {
  appRoot.innerHTML = `
    <div class="acc-shell">
      <aside class="acc-sidebar">
        <div class="acc-brand"><div class="acc-mark">€</div><div><strong>${escapeHtml(state.business?.name || 'Contabilidad')}</strong><small>Autónomo canario</small></div></div>
        <nav class="acc-nav">
          ${navButton('dashboard','⌂','Resumen')}
          ${navButton('profitability','◎','Rentabilidad')}
          ${navButton('sales','↗','Ventas')}
          ${navButton('purchases','↙','Compras')}
          ${navButton('treasury','≈','Tesorería')}
          ${navButton('ledger','▤','Contabilidad')}
          ${navButton('taxes','%','Impuestos')}
          ${navButton('drive','◈','Google Drive')}
          ${navButton('settings','⚙','Configuración')}
        </nav>
        <div class="acc-sidebar-foot"><button class="btn" id="logout-btn">Desvincular sesión</button></div>
      </aside>
      <section class="acc-main">
        <header class="acc-topbar">
          <div><h1>${VIEW_LABELS[state.view]}</h1><small>${new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</small></div>
          <div class="acc-actions">${renderTopActions()}</div>
        </header>
        <main class="acc-content">${renderView()}</main>
      </section>
    </div>
    <div id="modal-root">${state.modal ? renderModal() : ''}</div>`;
  wireEvents();
}

function renderTopActions() {
  if (state.view === 'sales') return '<button class="btn btn-primary" data-new-document="sale">Nueva factura</button>';
  if (state.view === 'purchases') return '<button class="btn btn-primary" data-new-document="purchase">Nuevo gasto</button>';
  if (state.view === 'treasury') return '<button class="btn btn-primary" id="import-bank-btn">Importar extracto</button>';
  if (state.view === 'ledger') return '<button class="btn btn-primary" id="new-entry-btn">Nuevo asiento</button>';
  if (state.view === 'drive') return '<button class="btn btn-primary" id="scan-drive-btn">Buscar facturas</button>';
  return '<button class="btn" id="sync-tpv-btn">Actualizar TPV</button>';
}

function renderView() {
  const views = {
    dashboard: renderDashboard,
    profitability: renderProfitability,
    sales: () => renderDocuments('sale'),
    purchases: () => renderDocuments('purchase'),
    treasury: renderTreasury,
    ledger: renderLedger,
    taxes: renderTaxes,
    drive: renderDrive,
    settings: renderSettings
  };
  return (views[state.view] || renderDashboard)();
}

function currentRecurringReview() {
  return buildRecurringExpenseReview({
    expenses: state.recurringExpenses,
    occurrences: state.recurringExpenseOccurrences,
    documents: state.documents,
    anchor: new Date(),
    lookbackMonths: 1
  });
}

function recurringStatus(item) {
  const definitions = {
    missing: ['danger', 'Falta la factura'],
    pending: ['warning', 'Pendiente de revisar'],
    upcoming: ['', 'Próximo'],
    accounted: ['success', 'Contabilizado'],
    skipped: ['', 'No corresponde']
  };
  return definitions[item.status] || definitions.upcoming;
}

function renderRecurringExpensesWidget() {
  const review = currentRecurringReview();
  const today = new Date();
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const visible = review.items.filter(item => item.status === 'missing' || item.periodKey === currentKey).slice(0, 6);
  const actionCount = review.summary.missing + review.summary.pending;
  if (!state.recurringExpenses.length) {
    return `<section class="acc-card recurring-widget recurring-widget-empty">
      <div class="acc-card-head"><div><h2>Gastos habituales</h2><small>Evita que falte un gasto en tus cuentas</small></div></div>
      <div class="acc-card-body recurring-empty">
        <span>↻</span><div><strong>¿Qué pagas todos los meses?</strong><p>Añade alquiler, luz, gestoría, seguros o software. Te avisaremos si no aparece su factura.</p></div>
        <button class="btn btn-primary" id="add-first-recurring-expense">Añadir el primero</button>
      </div>
    </section>`;
  }
  return `<section class="acc-card recurring-widget">
    <div class="acc-card-head">
      <div><h2>Gastos habituales</h2><small>Este mes y facturas atrasadas</small></div>
      <div class="acc-actions"><span class="badge ${actionCount ? 'warning' : ''}">${actionCount ? `${actionCount} por resolver` : 'Al día'}</span><button class="btn btn-small" id="manage-recurring-expenses">Configurar</button></div>
    </div>
    <div class="recurring-summary">
      <div class="${review.summary.missing ? 'is-danger' : ''}"><strong>${review.summary.missing}</strong><span>faltan</span></div>
      <div class="${review.summary.pending ? 'is-warning' : ''}"><strong>${review.summary.pending}</strong><span>por revisar</span></div>
      <div><strong>${review.summary.accounted}</strong><span>guardados</span></div>
    </div>
    <div class="recurring-list">${visible.length ? visible.map(item => {
      const [tone, label] = recurringStatus(item);
      const documentAction = item.document
        ? `<button class="btn btn-small" data-edit-document="${item.document.id}">Ver factura</button>`
        : item.status === 'skipped'
          ? `<button class="btn btn-small" data-restore-recurring="${item.expense.id}" data-period-key="${item.periodKey}">Restaurar</button>`
          : `<button class="btn btn-primary btn-small" data-create-recurring-document="${item.expense.id}" data-period-key="${item.periodKey}">Guardar factura</button>
             <button class="btn btn-small" data-skip-recurring="${item.expense.id}" data-period-key="${item.periodKey}">Este mes no</button>`;
      return `<article class="recurring-row is-${item.status}">
        <div class="recurring-date"><strong>${item.expectedOn.getDate()}</strong><span>${item.expectedOn.toLocaleDateString('es-ES',{month:'short'}).replace('.','')}</span></div>
        <div class="recurring-name"><strong>${escapeHtml(item.expense.name)}</strong><span>${escapeHtml(item.expense.accounting_contacts?.name || recurringFrequencyLabel(item.expense.frequency))}${item.expectedAmount ? ` · aprox. ${money(item.expectedAmount)}` : ''}</span></div>
        <span class="badge ${tone}">${label}</span>
        <div class="recurring-actions">${documentAction}</div>
      </article>`;
    }).join('') : '<div class="acc-empty"><strong>No hay gastos previstos este mes.</strong>Puedes configurarlos cuando quieras.</div>'}</div>
  </section>`;
}

function currentControlCenter() {
  const profitability = buildProfitabilityAnalysis({
    documents: state.documents,
    analyses: state.profitabilityAnalyses,
    period: state.dashboardPeriod
  });
  const bankWorkspace = buildBankWorkspace({
    transactions: state.bankTransactions,
    reconciliations: state.reconciliations,
    reviews: state.bankReviews,
    documents: state.documents
  });
  return buildControlCenter({
    documents: state.documents,
    recurringItems: currentRecurringReview().items,
    driveItems: state.driveImports.map(item => ({
      ...item,
      reviewStatus: driveReviewStatus(item)
    })),
    pendingBankTransactions: pendingBankTransactions({
      transactions: state.bankTransactions,
      reconciliations: state.reconciliations
    }),
    bankQueue: bankWorkspace.allItems,
    reconciliations: state.reconciliations,
    unclassifiedCount: profitability.needsConfirmation.length,
    recurringConfigured: state.recurringExpenses.length > 0,
    bankAccounts: state.bankAccounts,
    bankTransactions: state.bankTransactions
  });
}

function renderControlCenter() {
  const center = currentControlCenter();
  const taskMarkup = center.tasks.length
    ? `<div class="control-task-list">${center.tasks.map(task => `<article class="control-task ${task.tone ? `is-${task.tone}` : ''}">
        <span class="control-task-icon" aria-hidden="true">${task.icon}</span>
        <div class="control-task-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.detail)}</span></div>
        <button class="btn ${task.tone === 'danger' ? 'btn-primary' : ''}" data-control-action="${task.action}" data-target-id="${task.targetId || ''}" data-period-key="${task.periodKey || ''}">${escapeHtml(task.actionLabel)}</button>
      </article>`).join('')}</div>`
    : `<div class="control-center-clear"><span aria-hidden="true">✓</span><div><strong>No queda nada urgente por hacer</strong><p>Las facturas, el banco y la rentabilidad están al día con los datos disponibles.</p></div></div>`;
  return `<section class="acc-card control-center ${center.total ? '' : 'is-clear'}">
    <div class="control-center-head">
      <div>
        <span class="control-center-kicker">TU MESA DE TRABAJO</span>
        <h2>${center.total ? 'Qué necesita tu atención' : 'Todo está al día'}</h2>
        <p>Resuelve lo importante desde aquí, sin buscarlo por los menús.</p>
      </div>
      <div class="control-center-total ${center.total ? 'has-pending' : ''}"><strong>${center.total}</strong><span>${center.total === 1 ? 'pendiente' : 'pendientes'}</span></div>
    </div>
    <div class="control-quick-actions" aria-label="Acciones rápidas">
      <button data-control-quick="purchase"><span>＋</span><strong>Guardar gasto</strong><small>Factura o ticket</small></button>
      <button data-control-quick="sale"><span>＋</span><strong>Crear factura</strong><small>Factura de venta</small></button>
      <button data-control-quick="bank"><span>≋</span><strong>${state.bankTransactions.length ? 'Revisar banco' : 'Importar banco'}</strong><small>${state.bankTransactions.length ? 'Continuar por donde ibas' : 'CSV o Excel'}</small></button>
      <button data-control-quick="drive"><span>↻</span><strong>Sincronizar Drive</strong><small>Traer análisis</small></button>
      <button data-control-quick="recurring"><span>↻</span><strong>Gastos habituales</strong><small>Revisar y configurar</small></button>
      <button data-control-quick="tax"><span>％</span><strong>Preparar IGIC</strong><small>Modelo 420</small></button>
    </div>
    ${taskMarkup}
    <div class="control-areas">${center.areas.map(area => `<div class="${area.pending ? 'has-pending' : ''}"><span>${escapeHtml(area.label)}</span><strong>${area.pending ? `${area.pending} por hacer` : 'Al día'}</strong></div>`).join('')}</div>
  </section>`;
}

function renderDashboard() {
  const snapshot = buildBusinessSnapshot({
    documents: state.documents,
    bankAccounts: state.bankAccounts,
    bankTransactions: state.bankTransactions,
    period: state.dashboardPeriod
  });
  const recent = state.documents.slice(0, 8);
  const maxTrend = Math.max(...snapshot.trend.flatMap(item => [Math.abs(item.sales), Math.abs(item.expenses)]), 1);
  const driveCorrections = state.driveImports.filter(item => (
    ['needs_correction', 'invalid', 'error'].includes(driveReviewStatus(item))
  )).length;
  const dataWarnings = snapshot.quality.documentsToReview + snapshot.treasury.pendingCount + driveCorrections;
  const periodRange = `${compactDate(snapshot.bounds.start)} – ${compactDate(snapshot.bounds.end)}`;
  const comparisonRange = `${compactDate(snapshot.bounds.comparisonStart)} – ${compactDate(snapshot.bounds.comparisonEnd)}`;
  const taxReserve = Math.max(snapshot.current.taxResult, 0) + snapshot.current.estimatedIrpf;
  const missingCurrentCosts = snapshot.current.salesBase > 0 && snapshot.current.expensesBase === 0;
  return `
    <div class="dashboard-toolbar">
      <div>
        <strong>${escapeHtml(dashboardPeriodLabel(snapshot))}</strong>
        <small>${periodRange} · comparación homogénea con ${comparisonRange}</small>
      </div>
      <div class="period-switch" role="group" aria-label="Periodo del resumen">
        ${[['month','Mes'],['quarter','Trimestre'],['year','Año']].map(([value,label]) => `<button class="btn btn-small ${state.dashboardPeriod === value ? 'is-active' : ''}" data-dashboard-period="${value}">${label}</button>`).join('')}
      </div>
    </div>
    ${renderControlCenter()}
    <div class="acc-grid acc-kpis">
      <div class="acc-kpi is-accent"><span>Ventas netas</span><strong>${money(snapshot.current.salesBase)}</strong>${variationMarkup(snapshot.changes.sales)}<small>Sin IGIC · ${snapshot.current.salesCount} documentos</small></div>
      <div class="acc-kpi"><span>Compras y gastos</span><strong>${money(snapshot.current.expensesBase)}</strong>${variationMarkup(snapshot.changes.expenses, { neutral: true })}<small>Sin IGIC · solo aprobados</small></div>
      <div class="acc-kpi ${snapshot.current.result < 0 ? 'is-danger' : ''}"><span>${missingCurrentCosts ? 'Resultado todavía incompleto' : 'Resultado del negocio'}</span><strong>${money(snapshot.current.result)}</strong>${missingCurrentCosts ? '<span class="metric-change is-neutral">Faltan gastos aprobados</span>' : variationMarkup(snapshot.changes.result)}<small>${missingCurrentCosts ? 'No es beneficio real todavía' : 'Antes de IRPF'}</small><button class="kpi-link" data-view="profitability">Entender la rentabilidad →</button></div>
      <div class="acc-kpi"><span>Margen sobre ventas</span><strong>${missingCurrentCosts ? '—' : `${percent(snapshot.current.margin)} %`}</strong><small>${missingCurrentCosts ? 'Se calculará cuando haya gastos' : snapshot.current.averageTicket == null ? 'Sin tickets TPV en el periodo' : `Ticket medio ${money(snapshot.current.averageTicket)}`}</small></div>
    </div>
    ${renderRecurringExpensesWidget()}
    <div class="acc-grid acc-two">
      <section class="acc-card">
        <div class="acc-card-head"><h2>Evolución real del negocio</h2><div class="chart-legend"><span><i class="sales"></i>Ventas</span><span><i class="expenses"></i>Gastos</span></div></div>
        <div class="acc-card-body"><div class="chart-bars chart-business">${snapshot.trend.map(item => `<div class="chart-period" title="Ventas: ${money(item.sales)} · Gastos: ${money(item.expenses)} · Resultado: ${money(item.result)}"><div><i class="sales" style="height:${Math.max(2,(Math.abs(item.sales)/maxTrend)*160)}px"></i><i class="expenses" style="height:${Math.max(2,(Math.abs(item.expenses)/maxTrend)*160)}px"></i></div><span>${item.date.toLocaleDateString('es-ES',{month:'short'}).replace('.','')}</span><small class="${item.result < 0 ? 'is-negative' : ''}">${money(item.result)}</small></div>`).join('')}</div></div>
      </section>
      <section class="acc-card">
        <div class="acc-card-head"><h2>Tesorería</h2><button class="btn btn-small" data-view="treasury">Ver banco</button></div>
        <div class="acc-card-body dashboard-stack">
          <div class="dashboard-main-figure"><span>Saldo bancario conocido</span><strong>${snapshot.treasury.hasBalance ? money(snapshot.treasury.balance) : 'Sin datos'}</strong><small>${snapshot.treasury.latestDate ? `Actualizado al ${new Date(`${snapshot.treasury.latestDate}T12:00:00`).toLocaleDateString('es-ES')}` : 'Añade una cuenta e importa un extracto'}</small></div>
          <div class="dashboard-split"><div><span>Entradas del periodo</span><strong class="positive">${money(snapshot.treasury.inflows)}</strong></div><div><span>Salidas del periodo</span><strong class="negative">${money(snapshot.treasury.outflows)}</strong></div></div>
          <div class="dashboard-callout ${snapshot.treasury.pendingCount ? 'warning' : 'success'}"><strong>${snapshot.treasury.pendingCount}</strong> movimientos sin conciliar</div>
        </div>
      </section>
    </div>
    <div class="acc-grid dashboard-three">
      <section class="acc-card">
        <div class="acc-card-head"><h2>Cobros y pagos pendientes</h2><button class="btn btn-small" data-view="treasury">Conciliar</button></div>
        <div class="acc-card-body dashboard-stack">
          <div class="dashboard-split"><div><span>Por cobrar</span><strong>${money(snapshot.pending.receivable)}</strong></div><div><span>Por pagar</span><strong>${money(snapshot.pending.payable)}</strong></div></div>
          <small>${snapshot.pending.overdueCount ? `<strong class="negative">${snapshot.pending.overdueCount} vencimientos atrasados</strong>` : 'No hay vencimientos atrasados detectados'}</small>
        </div>
      </section>
      <section class="acc-card">
        <div class="acc-card-head"><h2>Reserva fiscal orientativa</h2><button class="btn btn-small" data-view="taxes">Ver impuestos</button></div>
        <div class="acc-card-body dashboard-stack">
          <div class="dashboard-main-figure"><span>IGIC + estimación IRPF</span><strong>${money(taxReserve)}</strong><small>No equivale a una declaración presentada</small></div>
          <div class="dashboard-split"><div><span>IGIC neto</span><strong>${money(snapshot.current.taxResult)}</strong></div><div><span>IRPF orientativo</span><strong>${money(snapshot.current.estimatedIrpf)}</strong></div></div>
        </div>
      </section>
      <section class="acc-card">
        <div class="acc-card-head"><h2>Fiabilidad del resumen</h2><span class="badge ${dataWarnings ? 'warning' : ''}">${dataWarnings ? `${dataWarnings} pendientes` : 'Al día'}</span></div>
        <div class="acc-card-body dashboard-quality">
          <button data-view="purchases"><span>Documentos por revisar</span><strong>${snapshot.quality.documentsToReview}</strong><small>${money(snapshot.quality.purchaseAmountToReview)} sin incluir en gastos</small></button>
          <button data-view="treasury"><span>Banco sin conciliar</span><strong>${snapshot.treasury.pendingCount}</strong></button>
          <button data-view="drive"><span>Errores de Drive</span><strong>${driveCorrections}</strong></button>
        </div>
      </section>
    </div>
    <section class="acc-card dashboard-recent">
      <div class="acc-card-head"><h2>Actividad reciente</h2></div>
      ${renderDocumentTable(recent)}
    </section>`;
}

function analysisBehaviorOptions(selected) {
  return [
    ['variable', 'Variable · cambia con las ventas'],
    ['fixed', 'Fijo · se paga aunque vendas menos'],
    ['investment', 'Inversión · no es gasto operativo'],
    ['unclassified', 'Sin clasificar']
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function renderProfitabilityClassificationRow(row) {
  const document = row.document;
  const supplier = document.accounting_contacts?.name || 'Sin proveedor';
  const sourceLabel = row.source === 'confirmed'
    ? '<span class="badge">Confirmada</span>'
    : row.source === 'suggested'
      ? '<span class="badge warning">Sugerida</span>'
      : '<span class="badge danger">Sin clasificar</span>';
  return `
    <article class="profitability-classification-row" data-analysis-row="${document.id}">
      <div class="profitability-document-name">
        <strong>${escapeHtml(supplier)}</strong>
        <small>${escapeHtml(document.number || document.document_type)} · ${new Date(`${document.issue_date}T12:00:00`).toLocaleDateString('es-ES')}</small>
        ${sourceLabel}
      </div>
      <div class="field">
        <label>Categoría</label>
        <select data-analysis-category="${document.id}">${PROFITABILITY_CATEGORIES.map(category => `<option value="${category.value}" ${row.category === category.value ? 'selected' : ''}>${category.label}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Comportamiento</label>
        <select data-analysis-behavior="${document.id}">${analysisBehaviorOptions(row.cost_behavior)}</select>
      </div>
      <div class="profitability-row-amount"><span>Base sin IGIC</span><strong>${money(row.amount)}</strong></div>
      <button class="btn btn-primary" data-save-analysis="${document.id}">Guardar</button>
    </article>`;
}

function renderProfitability() {
  const analysis = buildProfitabilityAnalysis({
    documents: state.documents,
    analyses: state.profitabilityAnalyses,
    period: state.dashboardPeriod
  });
  const periodRange = `${compactDate(analysis.bounds.start)} – ${compactDate(analysis.bounds.end)}`;
  const visibleRows = analysis.rows
    .filter(row => state.profitabilityFilter === 'all' || row.source !== 'confirmed')
    .sort((a, b) => {
      if (a.source === 'confirmed' && b.source !== 'confirmed') return 1;
      if (a.source !== 'confirmed' && b.source === 'confirmed') return -1;
      return String(b.document.issue_date).localeCompare(String(a.document.issue_date));
    });
  const suggestedCount = analysis.needsConfirmation.filter(row => row.category !== 'unclassified').length;
  const categoryMax = Math.max(...analysis.categories.map(category => category.amount), 1);
  const perHundred = analysis.margin == null ? null : analysis.margin;
  const resultTone = analysis.result < 0 ? 'danger' : analysis.verdict.tone;
  const breakEvenProgress = analysis.breakEvenSales && analysis.breakEvenSales > 0
    ? Math.min(100, (analysis.sales / analysis.breakEvenSales) * 100)
    : 0;
  return `
    <div class="dashboard-toolbar">
      <div>
        <strong>${escapeHtml(dashboardPeriodLabel(analysis))}</strong>
        <small>${periodRange} · importes sin IGIC</small>
      </div>
      <div class="period-switch" role="group" aria-label="Periodo del análisis">
        ${[['month','Mes'],['quarter','Trimestre'],['year','Año']].map(([value,label]) => `<button class="btn btn-small ${state.dashboardPeriod === value ? 'is-active' : ''}" data-dashboard-period="${value}">${label}</button>`).join('')}
      </div>
    </div>

    <section class="profitability-hero is-${resultTone}">
      <div>
        <span class="profitability-verdict">${escapeHtml(analysis.verdict.label)}</span>
        <h2>${analysis.missingCosts ? `Ventas registradas ${money(analysis.sales)}` : `${analysis.result >= 0 ? 'El negocio deja' : 'El negocio pierde'} ${money(Math.abs(analysis.result))}`}</h2>
        <p>${escapeHtml(analysis.verdict.explanation)} ${perHundred == null || analysis.missingCosts ? '' : `Por cada 100 € vendidos quedan ${money(perHundred)} antes de IRPF.`}</p>
      </div>
      <div class="profitability-confidence">
        <div><span>Datos clasificados</span><strong>${percent(analysis.classificationCoverage)} %</strong></div>
        <div class="progress"><i style="width:${Math.max(2, analysis.classificationCoverage)}%"></i></div>
        <small>${analysis.needsConfirmation.length} gastos por confirmar · ${analysis.pendingDocuments} facturas pendientes</small>
      </div>
    </section>

    ${analysis.provisional ? `<div class="acc-notice profitability-notice"><strong>Resultado provisional.</strong> ${analysis.missingCosts ? 'Todavía no hay gastos aprobados; no tomes el margen mostrado como beneficio real. ' : ''}${analysis.needsConfirmation.length ? `Confirma la clasificación de ${analysis.needsConfirmation.length} gastos.` : ''} ${analysis.pendingDocuments ? `Hay ${analysis.pendingDocuments} facturas con una base de ${money(analysis.pendingAmount)} todavía fuera del cálculo.` : ''}</div>` : '<div class="acc-notice acc-success profitability-notice"><strong>Análisis completo.</strong> Todos los gastos del periodo están clasificados y no hay facturas pendientes.</div>'}

    <div class="acc-grid profitability-main-grid">
      <section class="acc-card">
        <div class="acc-card-head"><h2>Cómo se obtiene el resultado</h2><small>Ventas − gastos operativos</small></div>
        <div class="acc-card-body profitability-equation">
          <div><span>Ventas netas</span><strong>${money(analysis.sales)}</strong></div>
          <div class="subtract"><span>Costes variables</span><strong>− ${money(analysis.variableCosts)}</strong></div>
          <div class="subtotal"><span>Margen de contribución</span><strong>${money(analysis.contribution)}</strong><small>${percent(analysis.contributionMargin)} % de las ventas</small></div>
          <div class="subtract"><span>Costes fijos</span><strong>− ${money(analysis.fixedCosts)}</strong></div>
          ${analysis.unclassifiedCosts > 0 ? `<div class="subtract warning"><span>Gastos aún sin clasificar</span><strong>− ${money(analysis.unclassifiedCosts)}</strong></div>` : ''}
          <div class="total ${analysis.result < 0 ? 'negative' : ''}"><span>${analysis.missingCosts ? 'Resultado todavía incompleto' : 'Resultado antes de IRPF'}</span><strong>${money(analysis.result)}</strong><small>${analysis.missingCosts ? 'Faltan gastos aprobados' : `Margen ${percent(analysis.margin)} %`}</small></div>
          ${analysis.investments > 0 ? `<div class="investment"><span>Inversiones del periodo</span><strong>${money(analysis.investments)}</strong><small>Se muestran aparte: no se restan enteras como gasto operativo. Su amortización se incorporará cuando esté configurada.</small></div>` : ''}
        </div>
      </section>

      <section class="acc-card">
        <div class="acc-card-head"><h2>Punto de equilibrio</h2><small>Ventas mínimas para no perder</small></div>
        <div class="acc-card-body profitability-break-even">
          ${analysis.breakEvenSales == null
            ? `<div class="acc-empty"><strong>Necesita clasificación completa</strong>Confirma qué gastos son variables y cuáles fijos para calcularlo sin inventar datos.<button class="btn" data-profitability-filter="pending">Clasificar gastos</button></div>`
            : `<div class="dashboard-main-figure"><span>Debes vender al menos</span><strong>${money(analysis.breakEvenSales)}</strong><small>en este periodo</small></div>
              <div class="break-even-track"><i style="width:${breakEvenProgress}%"></i></div>
              <div class="dashboard-split"><div><span>Ventas actuales</span><strong>${money(analysis.sales)}</strong></div><div><span>${analysis.safetyMargin >= 0 ? 'Colchón sobre equilibrio' : 'Ventas que faltan'}</span><strong class="${analysis.safetyMargin < 0 ? 'negative' : 'positive'}">${money(Math.abs(analysis.safetyMargin))}</strong></div></div>`}
        </div>
      </section>
    </div>

    <section class="acc-card profitability-categories">
      <div class="acc-card-head"><h2>En qué se va el dinero</h2><small>Gastos aprobados del periodo</small></div>
      <div class="acc-card-body">
        ${analysis.categories.length ? analysis.categories.map(category => `<div class="profitability-category"><div><strong>${category.label}</strong><span>${category.behavior === 'variable' ? 'Variable' : category.behavior === 'investment' ? 'Inversión' : 'Fijo'}</span></div><div class="profitability-category-bar"><i style="width:${Math.max(2,(category.amount/categoryMax)*100)}%"></i></div><strong>${money(category.amount)}</strong></div>`).join('') : '<div class="acc-empty"><strong>Sin gastos aprobados</strong>No hay categorías que mostrar para este periodo.</div>'}
      </div>
    </section>

    <section class="acc-card profitability-classification">
      <div class="acc-card-head profitability-classification-head">
        <div><h2>Clasificación de gastos</h2><small>Confirma la sugerencia una vez; quedará guardada para el análisis.</small></div>
        <div class="acc-actions">
          <div class="period-switch profitability-filter"><button class="btn btn-small ${state.profitabilityFilter === 'pending' ? 'is-active' : ''}" data-profitability-filter="pending">Pendientes (${analysis.needsConfirmation.length})</button><button class="btn btn-small ${state.profitabilityFilter === 'all' ? 'is-active' : ''}" data-profitability-filter="all">Todos</button></div>
          ${suggestedCount ? `<button class="btn btn-primary btn-small" id="confirm-analysis-suggestions">Confirmar ${suggestedCount} sugerencias</button>` : ''}
        </div>
      </div>
      <div class="acc-card-body profitability-classification-list">
        ${visibleRows.length ? visibleRows.map(renderProfitabilityClassificationRow).join('') : analysis.missingCosts ? '<div class="acc-empty"><strong>A la espera de gastos</strong>Cuando apruebes facturas o tickets de este periodo aparecerán aquí para clasificarlos.</div>' : '<div class="acc-empty"><strong>Todo clasificado</strong>Ya puedes confiar en la separación de costes fijos y variables.</div>'}
      </div>
    </section>`;
}

const STATUS_LABELS = {
  draft: 'Borrador', needs_review: 'Revisar', approved: 'Aprobada',
  partially_paid: 'Pago parcial', paid: 'Pagada', overdue: 'Vencida',
  voided: 'Anulada', rectified: 'Rectificada', unprocessed: 'Pendiente de análisis',
  pending: 'Revisar', imported: 'Importado', duplicate: 'Duplicado',
  ignored: 'Ignorado',
  reviewed: 'Revisada · falta aprobar',
  needs_correction: 'Pendiente de corrección', invalid: 'JSON inválido', error: 'Error'
};

function statusBadge(status) {
  const cls = ['overdue','voided','invalid','error'].includes(status)
    ? 'danger'
    : ['draft','needs_review','partially_paid','pending','needs_correction','unprocessed'].includes(status) ? 'warning' : '';
  return `<span class="badge ${cls}">${STATUS_LABELS[status] || status}</span>`;
}

function renderDocumentTable(documents) {
  if (!documents.length) return '<div class="acc-empty"><strong>Sin documentos</strong>Los documentos aparecerán aquí.</div>';
  return `<div class="acc-table-wrap"><table class="acc-table">
    <thead><tr><th>Fecha</th><th>Documento</th><th>Contacto</th><th>Estado</th><th class="num">Base</th><th class="num">IGIC</th><th class="num">Total</th><th></th></tr></thead>
    <tbody>${documents.map(doc => `<tr>
      <td>${new Date(`${doc.issue_date}T12:00:00`).toLocaleDateString('es-ES')}</td>
      <td><strong>${escapeHtml(doc.number || 'Sin número')}</strong><br><small>${escapeHtml(doc.document_type)}</small></td>
      <td>${escapeHtml(doc.accounting_contacts?.name || (doc.source_type === 'tpv' ? 'Venta TPV' : '—'))}</td>
      <td>${statusBadge(doc.status)}</td>
      <td class="num">${money(doc.subtotal)}</td><td class="num">${money(doc.tax_amount)}</td><td class="num"><strong>${money(doc.total_amount)}</strong></td>
      <td><button class="btn btn-small" data-edit-document="${doc.id}">Ver</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderDocuments(direction) {
  const docs = state.documents.filter(doc => doc.direction === direction);
  const title = direction === 'sale' ? 'Facturas emitidas y ventas TPV' : 'Facturas recibidas y gastos';
  return `<section class="acc-card"><div class="acc-card-head"><h2>${title}</h2><span class="badge muted">${docs.length} documentos</span></div>${renderDocumentTable(docs)}</section>`;
}

function reconciliationContext(match) {
  const bankTransaction = state.bankTransactions.find(item => item.id === match.bank_transaction_id)
    || match.accounting_bank_transactions
    || null;
  const document = state.documents.find(item => item.id === match.document_id)
    || match.bookkeeping_documents
    || null;
  const contact = state.contacts.find(item => item.id === document?.contact_id) || null;
  const bankAccount = state.bankAccounts.find(item => item.id === bankTransaction?.bank_account_id) || null;
  return { bankTransaction, document, contact, bankAccount };
}

function reconciliationOriginal(document) {
  if (!document) return { url: '', previewUrl: '' };
  const driveImport = state.driveImports.find(item => item.document_id === document.id);
  const review = driveImport
    ? reviewableSupplierDocument(driveImport.payload, { drive_file_id: driveImport.drive_file_id })
    : null;
  const url = safeDriveUrl(
    document.attachment_url
    || document.source_payload?.source_url
    || review?.source_url
    || driveFileUrl(driveImport?.drive_file_id || '')
  );
  return { url, previewUrl: drivePreviewUrl(url) };
}

function reconciliationComparison(match, bankTransaction, document) {
  const comparisonDocument = match.status === 'confirmed' && match.document_paid_before != null
    ? { ...document, paid_amount: match.document_paid_before }
    : document;
  return buildReconciliationComparison({ match, bankTransaction, document: comparisonDocument });
}

function renderReconciliationCard(match) {
  const { bankTransaction, document, contact, bankAccount } = reconciliationContext(match);
  const comparison = reconciliationComparison(match, bankTransaction, document);
  const stateLabel = match.status === 'confirmed' ? 'Confirmada' : match.status === 'rejected' ? 'Descartada' : 'Pendiente';
  const stateClass = match.status === 'confirmed' ? '' : match.status === 'rejected' ? 'danger' : 'warning';
  const warningLabel = comparison.warnings.length
    ? `<span class="badge warning">${comparison.warnings.length} aviso${comparison.warnings.length === 1 ? '' : 's'}</span>`
    : '<span class="badge">Datos coherentes</span>';
  return `<article class="reconciliation-card">
    <div class="reconciliation-card-top">
      <div><span class="badge ${stateClass}">${stateLabel}</span>${warningLabel}</div>
      <strong>${money(match.amount)}</strong>
    </div>
    <div class="reconciliation-card-pair">
      <div>
        <small>Movimiento bancario</small>
        <strong>${escapeHtml(bankTransaction?.description || 'Movimiento no disponible')}</strong>
        <span>${displayDate(bankTransaction?.booked_on)} · ${escapeHtml(bankAccount?.name || 'Cuenta bancaria')}</span>
        <span>Ref. ${escapeHtml(bankTransaction?.reference || 'sin referencia')}</span>
      </div>
      <div>
        <small>Documento contable</small>
        <strong>${escapeHtml(document?.number || 'Documento no disponible')}</strong>
        <span>${displayDate(document?.issue_date)} · ${escapeHtml(contact?.name || (document?.direction === 'sale' ? 'Venta' : 'Proveedor sin asignar'))}</span>
        <span>Pendiente antes de conciliar: ${money(comparison.outstanding)}</span>
      </div>
    </div>
    <div class="reconciliation-card-bottom">
      <span>${escapeHtml(match.reason || 'Coincidencia propuesta')} · ${Number(match.score || 0)}%</span>
      <div class="acc-actions">
        <button class="btn btn-small btn-primary" data-review-reconciliation="${match.id}">${match.status === 'confirmed' ? 'Ver conciliación' : 'Revisar coincidencia'}</button>
        ${match.status === 'suggested' ? `<button class="btn btn-small" data-reject-match="${match.id}">Descartar</button>` : ''}
        ${match.status === 'rejected' ? `<button class="btn btn-small" data-reopen-match="${match.id}">Volver a pendientes</button>` : ''}
      </div>
    </div>
  </article>`;
}

function bankReviewForTransaction(transactionId) {
  return state.bankReviews.find(item => item.bank_transaction_id === transactionId
    && ['active', 'waiting_document'].includes(item.status)) || null;
}

function bankReviewSearchMatches(transaction) {
  const term = state.bankReviewSearch.trim().toLocaleLowerCase('es');
  if (!term) return true;
  return [transaction.description, transaction.reference, transaction.amount, transaction.booked_on]
    .some(value => String(value || '').toLocaleLowerCase('es').includes(term));
}

function currentBankWorkspace(overrides = {}) {
  return buildBankWorkspace({
    transactions: state.bankTransactions,
    reconciliations: state.reconciliations,
    reviews: state.bankReviews,
    documents: state.documents,
    search: state.bankReviewSearch,
    direction: state.bankReviewDirection,
    filter: state.bankWorkFilter,
    ...overrides
  });
}

function renderBankReviewCard(transaction, review = null) {
  const account = state.bankAccounts.find(item => item.id === transaction.bank_account_id);
  const suggested = !review ? suggestBankClassification(transaction) : '';
  const definition = classificationDefinition(review?.classification || suggested);
  const directionLabel = Number(transaction.amount) >= 0 ? 'Entrada' : 'Salida';
  return `<article class="bank-review-card ${Number(transaction.amount) >= 0 ? 'is-in' : 'is-out'}">
    <div class="bank-review-date"><strong>${displayDate(transaction.booked_on)}</strong><span>${escapeHtml(account?.name || 'Cuenta bancaria')}</span></div>
    <div class="bank-review-concept"><strong>${escapeHtml(transaction.description || 'Sin concepto')}</strong><span>${escapeHtml(transaction.reference || 'Sin referencia')}</span>${definition ? `<small>${review ? 'Clasificado como' : 'Sugerencia'}: ${escapeHtml(definition.label)}</small>` : ''}</div>
    <div class="bank-review-amount"><span>${directionLabel}</span><strong>${money(transaction.amount)}</strong></div>
    <button class="btn btn-small ${review ? '' : 'btn-primary'}" data-open-bank-review="${transaction.id}">${review ? 'Ver clasificación' : 'Revisar movimiento'}</button>
  </article>`;
}

function renderBankWorkCard(item) {
  const transaction = item.transaction;
  const account = state.bankAccounts.find(candidate => candidate.id === transaction.bank_account_id);
  const status = bankWorkspaceStatus(item.status);
  const context = item.reconciliation ? reconciliationContext(item.reconciliation) : null;
  const candidate = context?.document || item.candidate;
  const contactName = context?.contact?.name || candidate?.accounting_contacts?.name;
  let supportTitle = status.explanation;
  let supportDetail = '';
  if (candidate) {
    supportTitle = `${candidate.number || 'Documento sin número'} · ${contactName || (candidate.direction === 'sale' ? 'Cliente' : 'Proveedor')}`;
    supportDetail = `${displayDate(candidate.issue_date)} · ${money(candidate.total_amount)}${item.reconciliation ? ` · coincidencia ${Number(item.reconciliation.score || 0)}%` : ''}`;
  } else if (item.classification) {
    supportTitle = item.classification.label;
    supportDetail = item.classification.effect;
  } else if (item.waitingReview) {
    supportTitle = 'Ya está anotado que falta la factura';
    supportDetail = item.waitingReview.notes || 'El movimiento seguirá pendiente hasta que aparezca el justificante.';
  }
  const actionLabel = item.status === 'ready_match' ? 'Comparar y confirmar'
    : item.status === 'possible_document' ? 'Vincular factura'
      : item.status === 'missing_document' ? 'Buscar justificante'
        : 'Identificar';
  return `<article class="bank-work-card is-${status.tone}">
    <div class="bank-work-main">
      <div class="bank-work-date"><strong>${displayDate(transaction.booked_on)}</strong><span>${escapeHtml(account?.name || 'Cuenta bancaria')}</span></div>
      <div class="bank-work-concept"><strong>${escapeHtml(transaction.description || 'Sin concepto')}</strong><span>${escapeHtml(transaction.reference || 'Sin referencia')}</span></div>
      <div class="bank-work-amount"><span>${Number(transaction.amount) >= 0 ? 'Entrada' : 'Salida'}</span><strong>${money(transaction.amount)}</strong></div>
    </div>
    <div class="bank-work-support">
      <span class="badge ${status.tone}">${escapeHtml(status.label)}</span>
      <div><strong>${escapeHtml(supportTitle)}</strong>${supportDetail ? `<span>${escapeHtml(supportDetail)}</span>` : ''}</div>
      <button class="btn btn-primary" data-open-bank-work="${item.id}">${actionLabel}</button>
    </div>
  </article>`;
}

function renderBankWorkspace() {
  const workspace = currentBankWorkspace();
  const completedReviews = state.bankReviews
    .filter(review => review.status === 'active')
    .map(review => ({ review, transaction: state.bankTransactions.find(item => item.id === review.bank_transaction_id) }))
    .filter(item => item.transaction && bankReviewSearchMatches(item.transaction));
  const confirmedMatches = state.reconciliations.filter(item => item.status === 'confirmed');
  const completedTotal = completedReviews.length + confirmedMatches.length;
  const filterButtons = [
    ['all', 'Todo', workspace.stats.pending],
    ['ready', 'Con factura', workspace.stats.ready],
    ['missing', 'Falta justificar', workspace.stats.missing],
    ['classify', 'Identificar', workspace.stats.classify]
  ];
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(workspace.items.length / pageSize));
  const page = Math.min(state.bankReviewPage, pageCount);
  const visibleItems = workspace.items.slice((page - 1) * pageSize, page * pageSize);
  const completedMarkup = completedTotal
    ? `<div class="bank-reviewed-stack">
        ${confirmedMatches.length ? `<div><h3>Facturas conciliadas</h3><div class="reconciliation-list">${confirmedMatches.map(renderReconciliationCard).join('')}</div></div>` : ''}
        ${completedReviews.length ? `<div><h3>Movimientos clasificados</h3><div class="bank-review-list">${completedReviews.map(item => renderBankReviewCard(item.transaction, item.review)).join('')}</div></div>` : ''}
      </div>`
    : '<div class="acc-empty"><strong>Todavía no hay movimientos terminados</strong>Cuando confirmes uno, aparecerá aquí y podrás revisarlo o deshacerlo.</div>';
  return `<section class="acc-card bank-workspace">
    <div class="bank-workspace-hero">
      <div><span class="control-center-kicker">BANDEJA BANCARIA</span><h2>Revisa el banco, nosotros ordenamos el resto</h2><p>Empieza por el primer movimiento. La app te dirá si hay factura, si falta o si no debe contar como ingreso o gasto.</p></div>
      ${workspace.next ? '<button class="btn btn-primary" id="start-bank-work">Continuar revisión</button>' : '<span class="badge success">Todo revisado</span>'}
    </div>
    <div class="bank-workspace-stats">
      <div class="is-primary"><strong>${workspace.stats.pending}</strong><span>por resolver</span></div>
      <div><strong>${workspace.stats.ready}</strong><span>con factura posible</span></div>
      <div class="${workspace.stats.missing ? 'is-danger' : ''}"><strong>${workspace.stats.missing}</strong><span>sin justificante</span></div>
      <div><strong>${workspace.stats.completed}</strong><span>terminados</span></div>
    </div>
    <div class="bank-workspace-tabs period-switch">
      <button class="btn btn-small ${state.bankReviewView === 'pending' ? 'is-active' : ''}" data-bank-review-view="pending">Por hacer ${workspace.stats.pending}</button>
      <button class="btn btn-small ${state.bankReviewView === 'reviewed' ? 'is-active' : ''}" data-bank-review-view="reviewed">Terminados ${completedTotal}</button>
    </div>
    ${state.bankReviewView === 'pending' ? `
      <div class="bank-work-filters period-switch">${filterButtons.map(([value, label, count]) => `<button class="btn btn-small ${state.bankWorkFilter === value ? 'is-active' : ''}" data-bank-work-filter="${value}">${label} ${count}</button>`).join('')}</div>
      <form class="bank-review-toolbar" id="bank-review-search-form">
        <input type="search" id="bank-review-search" value="${escapeHtml(state.bankReviewSearch)}" placeholder="Buscar concepto, referencia, factura o importe">
        <select id="bank-review-direction" aria-label="Filtrar por dirección">
          <option value="all" ${state.bankReviewDirection === 'all' ? 'selected' : ''}>Entradas y salidas</option>
          <option value="in" ${state.bankReviewDirection === 'in' ? 'selected' : ''}>Solo entradas</option>
          <option value="out" ${state.bankReviewDirection === 'out' ? 'selected' : ''}>Solo salidas</option>
        </select>
        <button class="btn btn-small" type="submit">Buscar</button>
      </form>
      ${visibleItems.length
        ? `<div class="bank-work-list">${visibleItems.map(renderBankWorkCard).join('')}</div>`
        : `<div class="acc-empty"><strong>${workspace.hasActiveFilters ? 'No hay movimientos con este filtro' : 'Todo el banco está revisado'}</strong>${workspace.hasActiveFilters ? 'Pulsa Todo o cambia la búsqueda.' : 'Importa el siguiente extracto cuando esté disponible.'}</div>`}
      ${pageCount > 1 ? `<div class="bank-review-pagination"><button class="btn btn-small" data-bank-review-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Anterior</button><span>Página ${page} de ${pageCount} · ${workspace.items.length} movimientos</span><button class="btn btn-small" data-bank-review-page="${page + 1}" ${page === pageCount ? 'disabled' : ''}>Siguiente</button></div>` : ''}
    ` : completedMarkup}
  </section>`;
}

function currentBankImportBatches() {
  return buildBankImportBatches({
    imports: state.bankImports,
    transactions: state.bankTransactions,
    accounts: state.bankAccounts
  });
}

function quarterLabel(range) {
  if (!range?.start) return 'trimestre';
  const date = new Date(`${range.start}T12:00:00`);
  return `${Math.floor(date.getMonth() / 3) + 1}T ${date.getFullYear()}`;
}

function renderBankImports() {
  const batches = currentBankImportBatches().filter(batch => batch.status !== 'removed');
  const removed = currentBankImportBatches().filter(batch => batch.status === 'removed');
  const rows = batches.length ? batches.map(batch => {
    const period = batch.detected_start_on && batch.detected_end_on
      ? `${displayDate(batch.detected_start_on)} – ${displayDate(batch.detected_end_on)}`
      : 'Periodo sin detectar';
    return `<article class="bank-import-row">
      <div class="bank-import-file"><span class="bank-import-icon">XLS</span><div><strong>${escapeHtml(batch.file_name)}</strong><span>${escapeHtml(batch.account?.name || 'Cuenta bancaria')} · ${period}</span></div></div>
      <div class="bank-import-counts">
        <span><strong>${batch.included_count}</strong> en uso</span>
        <span class="${batch.excluded_count ? 'is-excluded' : ''}"><strong>${batch.excluded_count}</strong> excluidos</span>
        <span><strong>${batch.processed_count}</strong> revisados</span>
      </div>
      <button class="btn btn-small" data-manage-bank-import="${escapeHtml(batch.id)}">Gestionar</button>
    </article>`;
  }).join('') : '<div class="acc-empty"><strong>Aún no hay extractos</strong>Cuando importes uno podrás elegir el periodo y gestionarlo desde aquí.</div>';
  return `<section class="acc-card bank-imports-card">
    <div class="acc-card-head"><div><h2>Extractos importados</h2><p>Decide qué periodo entra en la revisión sin borrar el historial bancario.</p></div><button class="btn btn-small" id="import-bank-inline-btn">+ Importar</button></div>
    <div class="bank-import-list">${rows}</div>
    ${removed.length ? `<details class="bank-import-removed"><summary>${removed.length} importación${removed.length === 1 ? '' : 'es'} deshecha${removed.length === 1 ? '' : 's'}</summary><div>${removed.map(batch => `<span>${escapeHtml(batch.file_name)} · ${displayDate(batch.created_at)}</span>`).join('')}</div></details>` : ''}
  </section>`;
}

function renderTreasury() {
  const workspace = currentBankWorkspace({ search: '', direction: 'all', filter: 'all' });
  const pending = workspace.stats.pending;
  const includedTransactions = state.bankTransactions.filter(isBankTransactionIncluded);
  const balance = includedTransactions.find(tx => tx.balance != null)?.balance || 0;
  const rejected = reconciliationsByStatus(state.reconciliations, 'rejected');
  return `
    <div class="acc-grid acc-kpis">
      <div class="acc-kpi is-accent"><span>Último saldo importado</span><strong>${money(balance)}</strong></div>
      <div class="acc-kpi"><span>Por resolver</span><strong>${pending}</strong></div>
      <div class="acc-kpi"><span>Falta justificante</span><strong>${workspace.stats.missing}</strong></div>
      <div class="acc-kpi"><span>Terminados</span><strong>${workspace.stats.completed}</strong></div>
    </div>
    <div class="bank-workspace-actions"><button class="btn" id="suggest-matches-btn">Buscar facturas que coincidan</button><button class="btn" id="new-bank-account-btn">Añadir cuenta</button></div>
    ${renderBankImports()}
    ${renderBankWorkspace()}
    ${rejected.length ? `<section class="acc-card bank-movements-card" style="margin-top:18px"><details><summary><span><strong>Coincidencias descartadas</strong><small>${rejected.length} propuestas conservadas en el historial</small></span><span>Mostrar</span></summary><div class="reconciliation-list">${rejected.map(renderReconciliationCard).join('')}</div></details></section>` : ''}
    <section class="acc-card bank-movements-card" style="margin-top:18px">
      <details>
        <summary><span><strong>Movimientos bancarios en uso</strong><small>${includedTransactions.length} movimientos · ${pending} sin conciliar</small></span><span>Mostrar listado</span></summary>
        ${includedTransactions.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th>Estado</th><th class="num">Importe</th><th class="num">Saldo</th></tr></thead><tbody>
          ${includedTransactions.slice(0, 50).map(tx => `<tr><td>${displayDate(tx.booked_on)}</td><td>${escapeHtml(tx.description)}</td><td>${escapeHtml(tx.reference)}</td><td>${statusBadge(tx.status === 'matched' ? 'paid' : tx.status === 'ignored' ? 'ignored' : 'needs_review')}</td><td class="num">${money(tx.amount)}</td><td class="num">${tx.balance == null ? '—' : money(tx.balance)}</td></tr>`).join('')}
        </tbody></table>${includedTransactions.length > 50 ? '<div class="bank-list-note">Se muestran los 50 movimientos más recientes.</div>' : ''}</div>` : '<div class="acc-empty"><strong>Importa tu primer extracto</strong>Compatible con CSV y la primera hoja de XLSX.</div>'}
      </details>
    </section>`;
}

function renderLedger() {
  return `
    <div class="acc-grid acc-two">
      <section class="acc-card">
        <div class="acc-card-head"><h2>Libro diario</h2><span class="badge muted">${state.journalEntries.length} asientos</span></div>
        ${state.journalEntries.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Origen</th><th>Estado</th><th class="num">Debe/Haber</th></tr></thead><tbody>
        ${state.journalEntries.map(entry => {
          const lines = state.journalLines.filter(line => line.entry_id === entry.id);
          return `<tr><td>${new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString('es-ES')}</td><td>${escapeHtml(entry.description)}</td><td>${escapeHtml(entry.source_type)}</td><td>${statusBadge(entry.status === 'posted' ? 'approved' : 'draft')}</td><td class="num">${money(lines.reduce((sum,line)=>sum+Number(line.debit),0))}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="acc-empty"><strong>Sin asientos</strong>Aprueba documentos o crea un asiento manual.</div>'}
      </section>
      <section class="acc-card">
        <div class="acc-card-head"><h2>Plan contable</h2></div>
        <div class="acc-table-wrap"><table class="acc-table"><tbody>${state.accounts.map(account => `<tr><td><strong>${account.code}</strong></td><td>${escapeHtml(account.name)}</td><td>${escapeHtml(account.kind)}</td></tr>`).join('')}</tbody></table></div>
      </section>
    </div>`;
}

function renderTaxes() {
  const currentYear = new Date().getFullYear();
  return `
    <div class="acc-notice">Los importes son borradores para revisión. Esta aplicación no presenta declaraciones ante la ATC o la AEAT.</div>
    <div class="acc-grid acc-kpis" style="margin-top:18px">
      ${['420','425','130'].map(model => `<div class="acc-kpi"><span>Modelo ${model}</span><strong>${model === '420' ? 'IGIC trimestral' : model === '425' ? 'Resumen anual' : 'IRPF'}</strong><button class="btn btn-small" data-tax-model="${model}" style="margin-top:15px">Generar borrador</button></div>`).join('')}
      <div class="acc-kpi"><span>Ejercicio activo</span><strong>${currentYear}</strong><small>${state.business?.accounting_regime === 'direct_normal' ? 'Estimación directa normal' : 'Directa simplificada'}</small></div>
    </div>
    <section class="acc-card">
      <div class="acc-card-head"><h2>Borradores fiscales</h2><div class="acc-actions"><button class="btn btn-small" id="print-tax-btn">Imprimir / PDF</button><button class="btn btn-small" id="export-tax-btn">Exportar CSV</button></div></div>
      ${state.taxDrafts.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Modelo</th><th>Periodo</th><th>Generado</th><th class="num">Repercutido</th><th class="num">Soportado</th><th class="num">Resultado</th></tr></thead><tbody>
        ${state.taxDrafts.map(draft => `<tr><td><strong>${draft.model}</strong></td><td>${draft.accounting_tax_periods?.quarter ? `T${draft.accounting_tax_periods.quarter}` : 'Anual'} ${draft.accounting_tax_periods?.year || ''}</td><td>${new Date(draft.generated_at).toLocaleString('es-ES')}</td><td class="num">${money(draft.totals?.igic_output)}</td><td class="num">${money(draft.totals?.igic_input)}</td><td class="num"><strong>${money(draft.totals?.net_result)}</strong></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="acc-empty"><strong>Sin borradores</strong>Genera un modelo para el periodo que quieras revisar.</div>'}
    </section>
    <section class="acc-card" style="margin-top:18px">
      <div class="acc-card-head"><h2>Bloqueo de periodos</h2></div>
      ${state.taxPeriods.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Periodo</th><th>Desde</th><th>Hasta</th><th>Estado</th><th></th></tr></thead><tbody>${state.taxPeriods.map(period=>`<tr><td>${period.quarter ? `${period.quarter}T` : 'Anual'} ${period.year}</td><td>${period.starts_on}</td><td>${period.ends_on}</td><td>${statusBadge(period.status==='locked'?'approved':'draft')}</td><td><button class="btn btn-small" data-toggle-period="${period.id}" data-status="${period.status}">${period.status==='locked'?'Reabrir':'Bloquear'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="acc-empty">Los periodos aparecen al generar borradores.</div>'}
    </section>`;
}

function renderDrive() {
  const source = state.driveSources[0] || {};
  const sourceFolder = state.driveFolders.source;
  const resultFolder = state.driveFolders.result;
  const analyzed = state.driveFiles.filter(file => driveImportStatus(file.id, state.driveImports) !== 'unprocessed').length;
  const pending = Math.max(0, state.driveFiles.length - analyzed);
  const reviewed = state.driveImports.filter(item => driveReviewStatus(item) === 'reviewed').length;
  const needsCorrection = state.driveImports.filter(item => driveReviewStatus(item) === 'needs_correction').length;
  const connectedLabel = state.googleUser?.emailAddress || state.googleUser?.displayName || 'Google Drive conectado';
  const sourceUrl = driveFolderUrl(source.source_folder_id);
  const resultUrl = driveFolderUrl(source.result_folder_id);
  const privacyStatus = state.driveResultPrivacy?.status || source.result_folder_privacy_status || 'unverified';
  const privacyLabel = privacyStatus === 'private'
    ? 'Privada · solo tú'
    : privacyStatus === 'shared' ? 'Compartida · requiere corrección' : 'Privacidad pendiente de comprobar';
  const privacyDetail = state.driveResultPrivacy?.reason
    || (privacyStatus === 'private'
      ? `Comprobada${source.result_folder_verified_at ? ` el ${new Date(source.result_folder_verified_at).toLocaleString('es-ES')}` : ''}.`
      : 'Autoriza Drive y pulsa “Comprobar privacidad”.');
  return `
    <div class="acc-grid acc-kpis drive-kpis">
      <div class="acc-kpi"><span>Conexión</span><strong>${state.googleToken ? 'Activa' : 'Pendiente'}</strong><small>${escapeHtml(state.googleToken ? connectedLabel : googleClientId ? 'Autoriza tu cuenta de Google' : 'Falta el cliente OAuth')}</small></div>
      <div class="acc-kpi"><span>Facturas encontradas</span><strong>${state.driveFiles.length || '—'}</strong><small>${state.driveFiles.length ? `${pending} pendientes de análisis` : 'Pulsa Buscar facturas'}</small></div>
      <div class="acc-kpi"><span>Análisis registrados</span><strong>${state.driveImports.length}</strong><small>${reviewed} revisadas pendientes de aprobar · ${needsCorrection} por corregir</small></div>
    </div>
    <div class="acc-grid acc-two">
      <section class="acc-card drive-folders-card">
        <div class="acc-card-head"><div><h2>Carpeta que vamos a analizar</h2><small>Puede cambiar cuando recibas facturas en otra carpeta.</small></div>${state.googleToken ? '<span class="badge">Drive autorizado</span>' : ''}</div>
        <div class="acc-card-body">
          <form class="acc-form" id="drive-settings-form">
            <div class="field"><label>Carpeta de entrada</label><div class="drive-source-picker-row"><input id="drive-source-folder" value="${escapeHtml(source.source_folder_id || '')}" placeholder="Pega una URL de Drive o elígela"><button class="btn" id="choose-drive-source-btn" type="button">Elegir carpeta</button></div><small>Codex analizará únicamente los PDF e imágenes que estén directamente dentro de esta carpeta.</small></div>
            <div class="drive-folder-summary drive-source-summary">
              <div><span>Seleccionada ahora</span><strong>${escapeHtml(sourceFolder?.name || (source.source_folder_id ? 'Carpeta de facturas configurada' : 'Ninguna carpeta'))}</strong>${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer">Abrir carpeta ↗</a>` : ''}</div>
            </div>
            <button class="btn btn-primary" type="submit">Guardar carpeta de facturas</button>
          </form>
        </div>
      </section>
      <section class="acc-card drive-private-results-card">
        <div class="acc-card-head"><div><h2>Carpeta privada de resultados</h2><small>Es fija: todos los JSON se guardarán siempre aquí.</small></div><span class="badge ${privacyStatus === 'shared' ? 'danger' : privacyStatus === 'private' ? '' : 'warning'}">${escapeHtml(privacyLabel)}</span></div>
        <div class="acc-card-body acc-form">
          ${source.result_folder_id ? `<div class="drive-fixed-folder"><span>Historial bloqueado</span><strong>${escapeHtml(resultFolder?.name || 'HISTORIAL CONTABILIDAD - JSON')}</strong><small>${escapeHtml(source.result_folder_id)}</small>${resultUrl ? `<a href="${resultUrl}" target="_blank" rel="noreferrer">Abrir carpeta privada ↗</a>` : ''}</div>` : '<div class="acc-notice"><strong>Aún falta fijar la carpeta privada.</strong><br>Solo se podrá elegir una vez y debe pertenecer únicamente a tu cuenta.</div>'}
          <div class="drive-privacy-status is-${privacyStatus}"><strong>${escapeHtml(privacyLabel)}</strong><span>${escapeHtml(privacyDetail)}</span></div>
          <div class="acc-actions">${source.result_folder_id ? '<button class="btn" id="verify-drive-result-btn">Comprobar privacidad</button>' : '<button class="btn btn-primary" id="choose-drive-result-btn">Elegir y bloquear carpeta privada</button>'}</div>
          <p class="drive-fixed-explanation">La carpeta de facturas puede ser compartida. Esta carpeta de resultados no: así ninguna otra persona del Drive verá los JSON contables.</p>
        </div>
      </section>
    </div>
    <section class="acc-card drive-analysis-card" style="margin-top:18px">
      <div class="acc-card-head"><h2>Conexión y análisis</h2><span class="badge muted">supplier-document/v1</span></div>
      <div class="acc-card-body acc-form">
          <p>Codex analiza los originales bajo demanda, no los mueve y guarda cada resultado en el historial privado fijo. La app valida las sumas y lo deja pendiente de revisión humana.</p>
          ${googleClientId
            ? `<div class="acc-actions"><button class="btn" id="google-connect-btn">${state.googleToken ? 'Renovar autorización' : 'Autorizar Google Drive'}</button>${state.googleToken ? '<button class="btn" id="google-disconnect-btn">Desconectar</button>' : ''}</div>`
            : '<div class="acc-notice"><strong>OAuth preparado, falta activar la credencial.</strong><br>Crea un cliente web de Google con origen <code>https://esenciacafe.github.io</code> y guarda su ID en la variable <code>VITE_GOOGLE_CLIENT_ID</code> de GitHub Actions.</div>'}
          <div class="acc-actions">
            <button class="btn" id="scan-drive-inline-btn" ${state.driveBusy ? 'disabled' : ''}>${state.driveBusy ? 'Buscando…' : 'Buscar facturas'}</button>
            <button class="btn btn-primary" id="sync-drive-btn" ${state.driveBusy || privacyStatus === 'shared' ? 'disabled' : ''}>Sincronizar análisis</button>
          </div>
          <label class="btn" style="display:grid;place-items:center"><input class="hidden" type="file" id="json-files-input" accept=".json,application/json" multiple>Importar JSON manualmente</label>
      </div>
    </section>
    <section class="acc-card" style="margin-top:18px">
      <div class="acc-card-head"><h2>Facturas de la carpeta de origen</h2><small>${state.driveFiles.length ? `${pending} pendientes · ${analyzed} analizadas` : 'Todavía no se ha consultado Drive'}</small></div>
      ${state.driveFiles.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Archivo</th><th>Modificado</th><th>Estado</th><th></th></tr></thead><tbody>
        ${state.driveFiles.map(file => {
          const status = driveImportStatus(file.id, state.driveImports);
          return `<tr><td><strong>${escapeHtml(file.name)}</strong><br><small>${escapeHtml(file.mimeType || '')}</small></td><td>${file.modifiedTime ? new Date(file.modifiedTime).toLocaleString('es-ES') : '—'}</td><td>${statusBadge(status)}</td><td><a class="btn btn-small" href="${escapeHtml(file.webViewLink || driveFileUrl(file.id))}" target="_blank" rel="noreferrer">Ver original</a></td></tr>`;
        }).join('')}
      </tbody></table></div>` : '<div class="acc-empty"><strong>Conecta Drive y busca facturas</strong>Se mostrarán PDF e imágenes sin mover ni modificar los originales.</div>'}
    </section>
    <section class="acc-card" style="margin-top:18px">
      <div class="acc-card-head"><h2>Historial de resultados</h2><small>Últimos 500 registros</small></div>
      ${state.driveImports.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Proveedor / documento</th><th>Resultado</th><th>Total</th><th>Procesado</th><th></th></tr></thead><tbody>
        ${state.driveImports.map(item => {
          const payload = item.payload || {};
          const reviewPayload = payload.extracted || payload;
          const document = item.bookkeeping_documents;
          const reviewStatus = driveReviewStatus(item);
          const reviewButton = item.document_id
            ? `<button class="btn btn-small" data-review-drive-document="${item.id}">${reviewStatus === 'reviewed' ? 'Continuar revisión' : ['approved','paid'].includes(reviewStatus) ? 'Ver' : 'Revisar'}</button>`
            : item.status === 'pending'
              ? `<button class="btn btn-small btn-primary" data-review-drive-import="${item.id}">Revisar</button>`
              : '';
          const showError = item.error_message && ['needs_correction','invalid','error'].includes(reviewStatus);
          const supplierName = document?.accounting_contacts?.name || reviewPayload.supplier?.name || 'Resultado sin proveedor';
          const documentNumber = document?.number || reviewPayload.invoice?.number || item.drive_file_id;
          const total = document?.total_amount != null ? document.total_amount : reviewPayload.totals?.total;
          return `<tr><td><strong>${escapeHtml(supplierName)}</strong><br><small>${escapeHtml(documentNumber)}</small></td><td>${statusBadge(reviewStatus)}${showError ? `<br><small class="drive-error">${escapeHtml(item.error_message)}</small>` : ''}</td><td class="num">${total != null ? money(total) : '—'}</td><td>${item.processed_at ? new Date(item.processed_at).toLocaleString('es-ES') : new Date(item.created_at).toLocaleString('es-ES')}</td><td>${reviewButton}</td></tr>`;
        }).join('')}
      </tbody></table></div>` : '<div class="acc-empty"><strong>Sin análisis importados</strong>Los JSON nuevos aparecerán aquí, incluidos duplicados y errores.</div>'}
    </section>
    <section class="acc-card" style="margin-top:18px">
      <div class="acc-card-head"><h2>Garantías del flujo</h2></div>
      <div class="acc-card-body"><ol><li>Los originales no se mueven ni modifican.</li><li>Drive ID, revisión y checksum impiden reprocesados.</li><li>Las sumas deben cuadrar con un máximo de 0,02 € de diferencia.</li><li>Ningún documento se contabiliza sin aprobación humana.</li></ol></div>
    </section>`;
}

function renderSettings() {
  return `
    <div class="acc-grid acc-two">
      <section class="acc-card">
        <div class="acc-card-head"><h2>Perfil fiscal</h2></div>
        <div class="acc-card-body">
          <form class="acc-form" id="business-form">
            <div class="acc-form-grid"><div class="field"><label>Nombre comercial</label><input id="business-name" value="${escapeHtml(state.business?.name)}" required></div><div class="field"><label>NIF</label><input id="business-nif" value="${escapeHtml(state.business?.nif)}"></div></div>
            <div class="field"><label>Razón social</label><input id="business-legal-name" value="${escapeHtml(state.business?.legal_name)}"></div>
            <div class="field"><label>Régimen</label><select id="business-regime"><option value="direct_simplified" ${state.business?.accounting_regime === 'direct_simplified' ? 'selected' : ''}>Estimación directa simplificada</option><option value="direct_normal" ${state.business?.accounting_regime === 'direct_normal' ? 'selected' : ''}>Estimación directa normal</option></select></div>
            <button class="btn btn-primary" type="submit">Guardar configuración</button>
          </form>
        </div>
      </section>
      <section class="acc-card">
        <div class="acc-card-head"><h2>Seguridad</h2></div>
        <div class="acc-card-body acc-form">
          <p>Este dispositivo está vinculado y su sesión caduca automáticamente. Puedes revocarla desde aquí.</p>
          <button class="btn btn-danger" id="revoke-device-btn">Revocar este dispositivo</button>
        </div>
      </section>
    </div>`;
}

function renderModal() {
  if (state.modal.type === 'document') return renderDocumentModal(state.modal.document);
  if (state.modal.type === 'recurring-manager') return renderRecurringExpensesModal();
  if (state.modal.type === 'recurring-editor') return renderRecurringExpenseEditorModal();
  if (state.modal.type === 'reconciliation') return renderReconciliationModal();
  if (state.modal.type === 'bank-review') return renderBankReviewModal();
  if (state.modal.type === 'drive-folder-picker') return renderDriveFolderPickerModal();
  if (state.modal.type === 'bank-import') return renderBankImportModal();
  if (state.modal.type === 'bank-import-manage') return renderBankImportManageModal();
  if (state.modal.type === 'bank-account') return renderBankAccountModal();
  if (state.modal.type === 'tax') return renderTaxModal(state.modal.model);
  if (state.modal.type === 'entry') return renderEntryModal();
  return '';
}

function modalFrame(title, body, foot = '', className = '') {
  return `<div class="acc-modal-backdrop"><div class="acc-modal ${className}"><div class="acc-modal-head"><h2>${title}</h2><button class="btn btn-small" data-close-modal>✕</button></div><div class="acc-modal-body">${body}</div>${foot ? `<div class="acc-modal-foot">${foot}</div>` : ''}</div></div>`;
}

function recurringCategoryOptions(selected = 'other') {
  const allowed = new Set([
    'staff', 'rent', 'utilities', 'bank_fees', 'professional_services',
    'maintenance', 'taxes', 'insurance', 'marketing', 'other'
  ]);
  return PROFITABILITY_CATEGORIES
    .filter(category => allowed.has(category.value))
    .map(category => `<option value="${category.value}" ${selected === category.value ? 'selected' : ''}>${escapeHtml(category.label)}</option>`)
    .join('');
}

function renderRecurringExpensesModal() {
  const rows = state.recurringExpenses.length
    ? state.recurringExpenses.map(expense => `<article class="recurring-manager-row ${expense.active === false ? 'is-inactive' : ''}">
        <div><strong>${escapeHtml(expense.name)}</strong><span>${escapeHtml(expense.accounting_contacts?.name || 'Sin proveedor asociado')} · ${recurringFrequencyLabel(expense.frequency)} · día ${expense.due_day}</span></div>
        <strong>${expense.expected_amount ? money(expense.expected_amount) : 'Importe variable'}</strong>
        <div class="acc-actions">
          <button class="btn btn-small" data-edit-recurring="${expense.id}">Editar</button>
          <button class="btn btn-small" data-toggle-recurring="${expense.id}" data-active="${expense.active !== false}">${expense.active === false ? 'Activar' : 'Pausar'}</button>
        </div>
      </article>`).join('')
    : '<div class="acc-empty"><strong>Aún no has configurado gastos habituales.</strong>Añade el primero para empezar a recibir avisos.</div>';
  return modalFrame(
    'Gastos habituales',
    `<div class="recurring-manager-intro"><p>Solo necesitas añadir los pagos que esperas con regularidad. La app buscará sus facturas automáticamente.</p><button class="btn btn-primary" id="new-recurring-expense">+ Añadir gasto habitual</button></div><div class="recurring-manager-list">${rows}</div>`,
    '<button class="btn" data-close-modal>Cerrar</button>',
    'acc-modal-wide recurring-manager-modal'
  );
}

function renderRecurringExpenseEditorModal() {
  const expense = state.modal.expense || {};
  const firstDay = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  return modalFrame(
    expense.id ? 'Editar gasto habitual' : 'Añadir gasto habitual',
    `<form class="acc-form" id="recurring-expense-form" data-id="${expense.id || ''}">
      <div class="field"><label>Nombre sencillo</label><input id="recurring-name" value="${escapeHtml(expense.name || '')}" placeholder="Ej. Alquiler del local" required maxlength="160"></div>
      <div class="field"><label>Proveedor</label><select id="recurring-contact"><option value="">Sin proveedor fijo</option>${state.contacts.map(contact => `<option value="${contact.id}" ${expense.contact_id === contact.id ? 'selected' : ''}>${escapeHtml(contact.name)}</option>`).join('')}</select><small>Elegirlo ayuda a reconocer la factura automáticamente.</small></div>
      <div class="acc-form-grid three">
        <div class="field"><label>Importe aproximado</label><input id="recurring-amount" type="number" min="0" step=".01" value="${Number(expense.expected_amount || 0)}"><small>Puede variar; solo sirve de referencia.</small></div>
        <div class="field"><label>Frecuencia</label><select id="recurring-frequency">${RECURRING_FREQUENCIES.map(item => `<option value="${item.value}" ${expense.frequency === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}</select></div>
        <div class="field"><label>Día esperado</label><input id="recurring-day" type="number" min="1" max="28" value="${Number(expense.due_day || 1)}" required></div>
      </div>
      <div class="acc-form-grid">
        <div class="field"><label>Tipo de gasto</label><select id="recurring-category">${recurringCategoryOptions(expense.category)}</select></div>
        <div class="field"><label>Empezar a comprobar desde</label><input id="recurring-start" type="date" value="${expense.start_on || firstDay}" required></div>
      </div>
      <div class="acc-notice">La app avisará si llega la fecha y no encuentra una factura de este proveedor. Nada se contabiliza sin que tú revises la factura.</div>
    </form>`,
    '<button class="btn" id="back-to-recurring-manager" type="button">Cancelar</button><button class="btn btn-primary" type="submit" form="recurring-expense-form">Guardar</button>'
  );
}

function renderDriveFolderPickerModal() {
  const picker = state.modal;
  const isResult = picker.purpose === 'result';
  const current = picker.currentFolder;
  const canSelectCurrent = Boolean(current?.id && !current.pseudo);
  const privacy = isResult && canSelectCurrent
    ? resultFolderPrivacy(current, state.googleUser?.emailAddress || '')
    : null;
  const privacyMarkup = !isResult || !canSelectCurrent ? '' : `<div class="drive-picker-privacy is-${privacy.status}">
    <strong>${privacy.status === 'private' ? 'Carpeta privada comprobada' : privacy.status === 'shared' ? 'Esta carpeta está compartida' : 'No se puede confirmar su privacidad'}</strong>
    <span>${escapeHtml(privacy.reason)}</span>
    ${privacy.sharedWith.length ? `<small>Acceso adicional: ${escapeHtml(privacy.sharedWith.map(item => item.name).join(', '))}</small>` : ''}
  </div>`;
  const folderList = picker.loading
    ? '<div class="acc-empty"><strong>Cargando carpetas…</strong></div>'
    : picker.error
      ? `<div class="acc-notice"><strong>No se pudieron cargar las carpetas.</strong><br>${escapeHtml(picker.error)}</div>`
      : picker.folders?.length
        ? `<div class="drive-picker-list">${picker.folders.map(folder => `<button type="button" data-open-drive-folder="${escapeHtml(folder.id)}"><span class="drive-folder-icon">▰</span><span><strong>${escapeHtml(folder.name)}</strong><small>${folder.modifiedTime ? `Modificada ${new Date(folder.modifiedTime).toLocaleDateString('es-ES')}` : 'Carpeta de Google Drive'}</small></span><span>›</span></button>`).join('')}</div>`
        : '<div class="acc-empty"><strong>No hay subcarpetas aquí</strong>Puedes elegir la carpeta actual o volver atrás.</div>';
  const confirmation = isResult && privacy?.status === 'private'
    ? '<label class="reconciliation-confirm-check"><input type="checkbox" id="drive-result-lock-confirm"><span><strong>Entiendo que esta carpeta quedará fija.</strong><small>Los JSON futuros se guardarán siempre aquí.</small></span></label>'
    : '';
  const selectDisabled = !canSelectCurrent || isResult;
  return modalFrame(
    isResult ? 'Elegir carpeta privada de resultados' : 'Elegir carpeta de facturas',
    `<div class="drive-picker-tabs"><button class="btn btn-small ${picker.location === 'my-drive' ? 'is-active' : ''}" data-drive-picker-location="my-drive">Mi unidad</button><button class="btn btn-small ${picker.location === 'shared' ? 'is-active' : ''}" data-drive-picker-location="shared">Compartidas conmigo</button></div>
    <div class="drive-picker-current"><button class="btn btn-small" data-drive-folder-back ${picker.history?.length ? '' : 'disabled'}>← Atrás</button><div><span>Carpeta actual</span><strong>${escapeHtml(current?.name || (picker.location === 'shared' ? 'Compartidas conmigo' : 'Mi unidad'))}</strong></div></div>
    ${privacyMarkup}
    ${folderList}
    ${confirmation}`,
    `<button class="btn" data-close-modal>Cancelar</button><button class="btn btn-primary" id="select-current-drive-folder" ${selectDisabled ? 'disabled' : ''}>${isResult ? 'Fijar como historial privado' : 'Usar esta carpeta'}</button>`,
    'drive-folder-picker-modal'
  );
}

function renderReconciliationLines(lines = []) {
  if (!lines.length) {
    return state.modal.loading
      ? '<div class="acc-empty reconciliation-lines-empty"><strong>Cargando artículos…</strong></div>'
      : '<div class="acc-empty reconciliation-lines-empty"><strong>Sin líneas desglosadas</strong>Comprueba los totales y la factura original.</div>';
  }
  return `<div class="acc-table-wrap"><table class="acc-table reconciliation-lines-table">
    <thead><tr><th>Artículo / concepto</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Base</th><th class="num">IGIC</th></tr></thead>
    <tbody>${lines.map(line => {
      const quantity = Number(line.quantity || 0);
      const unitPrice = Number(line.unit_price || 0);
      const base = Number(line.taxable_base ?? line.total_amount ?? (quantity * unitPrice));
      const tax = Number(line.tax_amount ?? (base * Number(line.tax_rate || 0) / 100));
      return `<tr><td><strong>${escapeHtml(line.description || 'Sin descripción')}</strong>${line.supplier_item_code ? `<br><small>Cód. ${escapeHtml(line.supplier_item_code)}</small>` : ''}</td><td class="num">${quantity}</td><td class="num">${money(unitPrice)}</td><td class="num">${money(base)}</td><td class="num">${money(tax)} <small>(${Number(line.tax_rate || 0)}%)</small></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderReconciliationModal() {
  const match = state.modal.match;
  const { bankTransaction, document, contact, bankAccount } = reconciliationContext(match);
  const comparison = reconciliationComparison(match, bankTransaction, document);
  const original = reconciliationOriginal(document);
  const referenceTone = comparison.referenceMatches === true ? 'is-ok' : comparison.referenceMatches === false ? 'is-warning' : '';
  const dateTone = comparison.dateDifference != null && comparison.dateDifference <= 7 ? 'is-ok' : 'is-warning';
  const statusTitle = match.status === 'confirmed' ? 'Conciliación confirmada' : match.status === 'rejected' ? 'Propuesta descartada' : 'Revisar conciliación';
  const warnings = comparison.warnings.length
    ? `<div class="reconciliation-warnings"><strong>Antes de confirmar, revisa:</strong><ul>${comparison.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>`
    : '<div class="reconciliation-validation is-ok"><strong>Los datos básicos son coherentes.</strong><span>Aun así, comprueba el concepto y la factura original.</span></div>';
  const originalMarkup = original.previewUrl
    ? `<div class="reconciliation-original-head"><div><strong>Factura original</strong><small>Se muestra aquí para que no tengas que abandonar la conciliación.</small></div><a class="btn btn-small" href="${escapeHtml(original.url)}" target="_blank" rel="noopener noreferrer">Abrir en Drive ↗</a></div><iframe src="${escapeHtml(original.previewUrl)}" title="Factura original" loading="lazy"></iframe>`
    : '<div class="acc-empty reconciliation-original-empty"><strong>No hay una factura original vinculada</strong>Puedes revisar los datos contables guardados, pero no hay un archivo de Drive disponible.</div>';
  let foot = '<button class="btn" data-close-modal>Cerrar</button>';
  if (match.status === 'suggested') {
    foot += `<button class="btn" data-match-action="reject" data-match-id="${match.id}">Descartar</button><button class="btn btn-primary" id="confirm-reconciliation-btn" data-match-action="confirm" data-match-id="${match.id}" disabled>Confirmar conciliación</button>`;
  } else if (match.status === 'confirmed') {
    foot += `<button class="btn btn-danger" data-match-action="undo" data-match-id="${match.id}">Deshacer conciliación</button>`;
  } else {
    foot += `<button class="btn btn-primary" data-match-action="reopen" data-match-id="${match.id}">Volver a pendientes</button>`;
  }
  return modalFrame(statusTitle, `
    <div class="reconciliation-modal-summary">
      <div><span class="badge ${match.status === 'confirmed' ? '' : match.status === 'rejected' ? 'danger' : 'warning'}">${match.status === 'confirmed' ? 'Confirmada' : match.status === 'rejected' ? 'Descartada' : 'Pendiente'}</span><span class="badge muted">Confianza ${Number(match.score || 0)}%</span></div>
      <strong>${money(match.amount)}</strong>
      <small>${escapeHtml(match.reason || 'Coincidencia propuesta')}</small>
    </div>
    <div class="reconciliation-comparison">
      <section class="reconciliation-side">
        <div class="reconciliation-side-title"><span>B</span><div><strong>Movimiento bancario</strong><small>${escapeHtml(bankAccount?.name || 'Cuenta bancaria')}${bankAccount?.iban_last4 ? ` · ···· ${escapeHtml(bankAccount.iban_last4)}` : ''}</small></div></div>
        <dl>
          <div><dt>Fecha operación</dt><dd>${displayDate(bankTransaction?.booked_on)}</dd></div>
          <div><dt>Fecha valor</dt><dd>${displayDate(bankTransaction?.value_on)}</dd></div>
          <div><dt>Concepto</dt><dd>${escapeHtml(bankTransaction?.description || '—')}</dd></div>
          <div><dt>Referencia</dt><dd>${escapeHtml(bankTransaction?.reference || '—')}</dd></div>
          <div><dt>Importe</dt><dd class="reconciliation-amount">${money(bankTransaction?.amount)}</dd></div>
          <div><dt>Saldo tras movimiento</dt><dd>${bankTransaction?.balance == null ? '—' : money(bankTransaction.balance)}</dd></div>
        </dl>
      </section>
      <section class="reconciliation-side">
        <div class="reconciliation-side-title document"><span>D</span><div><strong>Documento contable</strong><small>${escapeHtml(contact?.name || (document?.direction === 'sale' ? 'Venta' : 'Proveedor sin asignar'))}</small></div></div>
        <dl>
          <div><dt>Número</dt><dd>${escapeHtml(document?.number || '—')}</dd></div>
          <div><dt>NIF</dt><dd>${escapeHtml(contact?.tax_id || '—')}</dd></div>
          <div><dt>Fecha emisión</dt><dd>${displayDate(document?.issue_date)}</dd></div>
          <div><dt>Vencimiento</dt><dd>${displayDate(document?.due_date)}</dd></div>
          <div><dt>Base + IGIC</dt><dd>${money(document?.subtotal)} + ${money(document?.tax_amount)}</dd></div>
          <div><dt>Total / pendiente antes</dt><dd class="reconciliation-amount">${money(document?.total_amount)} / ${money(comparison.outstanding)}</dd></div>
        </dl>
      </section>
    </div>
    <div class="reconciliation-checks">
      <div class="${comparison.amountMatches ? 'is-ok' : 'is-warning'}"><span>Importe</span><strong>${comparison.amountMatches ? 'Coincide' : `Diferencia ${money(comparison.amountDifference)}`}</strong></div>
      <div class="${dateTone}"><span>Fechas</span><strong>${comparison.dateDifference == null ? 'Sin comparar' : comparison.dateDifference === 0 ? 'Mismo día' : `${comparison.dateDifference} día${comparison.dateDifference === 1 ? '' : 's'}`}</strong></div>
      <div class="${referenceTone}"><span>Referencia</span><strong>${comparison.referenceMatches === true ? 'Coincide' : comparison.referenceMatches === false ? 'No coincide' : 'Sin dato suficiente'}</strong></div>
    </div>
    ${warnings}
    ${match.status === 'suggested' && comparison.canConfirm ? '<label class="reconciliation-confirm-check"><input type="checkbox" id="reconciliation-reviewed"> <span><strong>He comprobado el movimiento, el documento y la factura original.</strong><small>La confirmación marcará el banco como conciliado y actualizará el pago del documento.</small></span></label>' : ''}
    <section class="reconciliation-detail-section"><h3>Artículos del documento</h3>${renderReconciliationLines(state.modal.lines)}</section>
    <section class="reconciliation-original">${originalMarkup}</section>
  `, foot, 'acc-modal-wide reconciliation-modal');
}

function renderBankMovementSummary(transaction) {
  const account = state.bankAccounts.find(item => item.id === transaction.bank_account_id);
  return `<section class="bank-review-movement-summary ${Number(transaction.amount) >= 0 ? 'is-in' : 'is-out'}">
    <div><span>${Number(transaction.amount) >= 0 ? 'Entrada' : 'Salida'} · ${displayDate(transaction.booked_on)}</span><strong>${money(transaction.amount)}</strong></div>
    <h3>${escapeHtml(transaction.description || 'Sin concepto')}</h3>
    <dl>
      <div><dt>Referencia</dt><dd>${escapeHtml(transaction.reference || '—')}</dd></div>
      <div><dt>Cuenta</dt><dd>${escapeHtml(account?.name || 'Cuenta bancaria')}${account?.iban_last4 ? ` · ···· ${escapeHtml(account.iban_last4)}` : ''}</dd></div>
      <div><dt>Fecha valor</dt><dd>${displayDate(transaction.value_on)}</dd></div>
      <div><dt>Saldo posterior</dt><dd>${transaction.balance == null ? '—' : money(transaction.balance)}</dd></div>
    </dl>
  </section>`;
}

function renderBankReviewModal() {
  const transaction = state.modal.transaction;
  const review = state.modal.review;
  if (!transaction) return modalFrame('Revisar movimiento', '<div class="acc-empty"><strong>Movimiento no encontrado</strong></div>');
  const summary = renderBankMovementSummary(transaction);
  if (review?.status === 'active') {
    const definition = classificationDefinition(review.classification);
    const generatedDocument = state.documents.find(item => item.id === review.document_id);
    return modalFrame('Movimiento revisado', `${summary}
      <section class="bank-review-result">
        <span class="badge">Clasificación confirmada</span>
        <h3>${escapeHtml(definition?.label || review.classification)}</h3>
        <p>${escapeHtml(definition?.effect || '')}</p>
        ${review.notes ? `<div><strong>Notas</strong><p>${escapeHtml(review.notes)}</p></div>` : ''}
        ${generatedDocument ? `<div class="bank-review-generated"><span>Documento generado</span><strong>${escapeHtml(generatedDocument.number)} · ${money(generatedDocument.total_amount)}</strong><small>Estado: ${escapeHtml(STATUS_LABELS[generatedDocument.status] || generatedDocument.status)}</small></div>` : ''}
        <small>Revisado el ${new Date(review.reviewed_at).toLocaleString('es-ES')} · revisión ${Number(review.revision || 1)}</small>
      </section>
    `, `<button class="btn" data-close-modal>Cerrar</button><button class="btn btn-danger" data-unclassify-bank="${transaction.id}">Deshacer clasificación</button>`, 'bank-review-modal');
  }

  const candidates = outstandingDocumentsForTransaction(transaction, state.documents);
  const bankAmount = Math.abs(Number(transaction.amount || 0));
  const defaultCandidate = candidates[0];
  const defaultAmount = bankAmount;
  const suggested = suggestBankClassification(transaction);
  const classifications = classificationsForTransaction(transaction);
  const selectedClassification = state.modal.classification || suggested || classifications[0]?.value || '';
  const selectedDefinition = classificationDefinition(selectedClassification);
  const waitingNotice = review?.status === 'waiting_document'
    ? `<div class="bank-waiting-banner"><span>!</span><div><strong>Estamos esperando la factura</strong><p>${escapeHtml(review.notes || 'Este pago no se llevará a gastos ni al IGIC hasta que aparezca un justificante.')}</p></div><button class="btn btn-small" data-clear-bank-missing="${transaction.id}">Quitar aviso</button></div>`
    : '';
  const missingDocumentOption = Number(transaction.amount) < 0 ? `
    <div class="bank-review-or"><span>o</span></div>
    <section class="bank-review-option ${review?.status === 'waiting_document' ? 'is-selected' : ''}">
      <div class="bank-review-option-title"><span>2</span><div><h3>Todavía no tengo la factura</h3><p>Déjalo señalado para pedirla o encontrarla después. No se contabilizará ni deducirá IGIC.</p></div></div>
      <form class="acc-form" id="bank-missing-document-form">
        <div class="field"><label>Nota opcional</label><input id="bank-missing-document-notes" value="${escapeHtml(review?.status === 'waiting_document' ? review.notes : '')}" placeholder="Ej.: pedir factura al proveedor"></div>
        <button class="btn" type="submit">${review?.status === 'waiting_document' ? 'Actualizar recordatorio' : 'Marcar que falta factura'}</button>
      </form>
    </section>` : '';
  return modalFrame('Revisar movimiento bancario', `${summary}
    ${waitingNotice}
    <div class="bank-review-choice-intro"><strong>¿Qué representa este movimiento?</strong><span>Elige la opción más sencilla. Nada se contabiliza hasta que confirmes.</span></div>
    <section class="bank-review-option">
      <div class="bank-review-option-title"><span>1</span><div><h3>Vincular con una factura existente</h3><p>Es la opción correcta cuando el proveedor o cliente ya tiene un documento pendiente.</p></div></div>
      ${candidates.length ? `<form class="acc-form" id="manual-bank-match-form">
        <div class="field"><label>Documento pendiente</label><select id="manual-bank-document">${candidates.map(document => `<option value="${document.id}">${escapeHtml(document.number || 'Sin número')} · ${escapeHtml(document.accounting_contacts?.name || (document.direction === 'sale' ? 'Cliente' : 'Proveedor'))} · pendiente ${money(document.outstanding)} · ${displayDate(document.issue_date)}</option>`).join('')}</select></div>
        <div class="field"><label>Importe del movimiento</label><input id="manual-bank-amount" type="number" value="${defaultAmount.toFixed(2)}" readonly required><small>Esta versión vincula el movimiento completo a un documento. Los pagos agrupados se tratarán por separado.</small></div>
        <button class="btn btn-primary" type="submit">Crear comparación banco–factura</button>
      </form>` : '<div class="acc-notice">No hay documentos pendientes compatibles con esta entrada o salida. Puedes dejar el movimiento pendiente o clasificarlo abajo.</div>'}
    </section>
    ${missingDocumentOption}
    <div class="bank-review-or"><span>o</span></div>
    <section class="bank-review-option">
      <div class="bank-review-option-title"><span>${Number(transaction.amount) < 0 ? '3' : '2'}</span><div><h3>No necesita una factura de proveedor</h3><p>Úsalo para datáfono, traspasos, préstamos, titular, impuestos, nóminas o comisiones.</p></div></div>
      <form class="acc-form" id="bank-classification-form">
        <div class="field"><label>Clasificación</label><select id="bank-classification">${classifications.map(item => `<option value="${item.value}" ${selectedClassification === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></div>
        ${suggested ? `<div class="bank-review-suggestion"><span class="badge">Sugerencia automática</span><strong>${escapeHtml(classificationDefinition(suggested)?.label || '')}</strong><small>Comprueba que describe realmente el movimiento.</small></div>` : ''}
        <div class="acc-notice bank-classification-effect" id="bank-classification-effect">${escapeHtml(selectedDefinition?.effect || '')}</div>
        <div class="field"><label>Notas opcionales</label><textarea id="bank-classification-notes" placeholder="Explica cualquier detalle útil para revisarlo más adelante"></textarea></div>
        <label class="reconciliation-confirm-check"><input type="checkbox" id="bank-classification-reviewed"><span><strong>He comprobado el concepto y el efecto de esta clasificación.</strong><small>Podrás deshacerla desde la pestaña Revisados.</small></span></label>
        <button class="btn btn-primary" id="classify-bank-button" type="submit" disabled>Confirmar clasificación</button>
      </form>
    </section>
  `, '<button class="btn" data-close-modal>Cerrar sin cambios</button>', 'acc-modal-wide bank-review-modal');
}

function documentHistoryFor(line) {
  return state.modal.priceHistory?.find(item => item.line_id === line.id) || null;
}

function renderPriceHistory(line, readOnly = false) {
  const history = documentHistoryFor(line);
  if (!history?.previous_unit_price) {
    return `<span class="line-price-history muted">${line.id ? 'Sin compras anteriores' : 'Se comparará al guardar'}</span>`;
  }
  const variation = calculatePriceVariation(line.unit_price, history.previous_unit_price);
  const direction = variation?.percent > 0 ? 'up' : variation?.percent < 0 ? 'down' : 'same';
  const variationText = variation ? `${variation.percent > 0 ? '+' : ''}${variation.percent.toFixed(2)} %` : '—';
  return `<span class="line-price-history ${direction}" data-price-history data-previous-price="${history.previous_unit_price}">
    Anterior: ${money(history.previous_unit_price)} · <strong>${variationText}</strong>
    <small>${history.previous_issue_date ? new Date(`${history.previous_issue_date}T12:00:00`).toLocaleDateString('es-ES') : ''}${history.previous_document_number ? ` · ${escapeHtml(history.previous_document_number)}` : ''}</small>
  </span>`;
}

function renderDocumentLine(line, index, readOnly) {
  const scope = line.tax_scope || 'taxable';
  const disabled = readOnly ? 'disabled' : '';
  return `
    <article class="document-line" data-line-index="${index}" data-line-id="${line.id || ''}" data-manual-base="${Boolean(line.manual_taxable_base)}" data-manual-tax="${Boolean(line.manual_tax_amount)}">
      <div class="document-line-head">
        <strong>Artículo ${index + 1}</strong>
        ${!readOnly ? `<button class="btn btn-small btn-danger" type="button" data-remove-line="${index}" ${state.modal.lines.length === 1 ? 'disabled' : ''}>Eliminar</button>` : ''}
      </div>
      <div class="document-line-grid">
        <div class="field line-code"><label>Código proveedor</label><input data-line-field="supplier_item_code" value="${escapeHtml(line.supplier_item_code || '')}" placeholder="Opcional" ${disabled}></div>
        <div class="field line-description"><label>Artículo / concepto</label><input data-line-field="description" value="${escapeHtml(line.description || '')}" required ${disabled}></div>
        <div class="field"><label>Cantidad</label><input data-line-field="quantity" type="number" min=".001" step=".001" value="${Number(line.quantity ?? 1)}" required ${disabled}></div>
        <div class="field"><label>Precio compra/unidad</label><input data-line-field="unit_price" type="number" step=".0001" value="${Number(line.unit_price ?? 0)}" required ${disabled}></div>
        <div class="field"><label>Tratamiento</label><select data-line-field="tax_scope" ${disabled}>
          <option value="taxable" ${scope === 'taxable' ? 'selected' : ''}>Gravado</option>
          <option value="exempt" ${scope === 'exempt' ? 'selected' : ''}>Exento</option>
          <option value="not_subject" ${scope === 'not_subject' ? 'selected' : ''}>No sujeto</option>
        </select></div>
        <div class="field"><label>IGIC</label><select data-line-field="tax_rate" ${scope !== 'taxable' || readOnly ? 'disabled' : ''}>${IGIC_RATES.map(value => `<option value="${value}" ${Number(line.tax_rate) === value ? 'selected' : ''}>${value}%</option>`).join('')}</select></div>
        <div class="field"><label>Retención IRPF</label><input data-line-field="withholding_rate" type="number" min="0" max="100" step=".01" value="${Number(line.withholding_rate || 0)}" ${disabled}></div>
        <div class="document-line-amounts">
          <label>Base imponible<input data-line-field="taxable_base" data-line-base type="number" step=".01" value="${Number(line.taxable_base ?? 0)}" ${disabled}></label>
          <label>Cuota IGIC<input data-line-field="tax_amount" data-line-tax type="number" step=".01" value="${Number(line.tax_amount ?? 0)}" ${scope !== 'taxable' || readOnly ? 'disabled' : ''}></label>
        </div>
      </div>
      ${renderPriceHistory(line, readOnly)}
    </article>`;
}

function renderNewContactPanel(kind) {
  const draft = state.modal.newContact || {};
  const label = kind === 'supplier' ? 'proveedor' : 'cliente';
  return `
    <section class="document-contact-panel">
      <div class="document-contact-panel-head">
        <div><strong>Nuevo ${label}</strong><small>Se guardará para poder seleccionarlo en próximas facturas.</small></div>
        <button class="btn btn-small" id="cancel-document-contact" type="button">Cancelar</button>
      </div>
      <div class="acc-form-grid three">
        <div class="field"><label>Nombre comercial</label><input id="new-contact-name" value="${escapeHtml(draft.name || '')}" maxlength="160" autocomplete="organization"></div>
        <div class="field"><label>Razón social</label><input id="new-contact-legal-name" value="${escapeHtml(draft.legal_name || '')}" maxlength="200"></div>
        <div class="field"><label>NIF/CIF</label><input id="new-contact-tax-id" value="${escapeHtml(draft.tax_id || '')}" maxlength="30" autocapitalize="characters"></div>
      </div>
      <div class="acc-form-grid three">
        <div class="field"><label>Correo</label><input id="new-contact-email" type="email" value="${escapeHtml(draft.email || '')}" maxlength="200"></div>
        <div class="field"><label>Teléfono</label><input id="new-contact-phone" type="tel" value="${escapeHtml(draft.phone || '')}" maxlength="40"></div>
        <div class="field"><label>Dirección</label><input id="new-contact-address" value="${escapeHtml(draft.address || '')}" maxlength="300"></div>
      </div>
      <div class="document-contact-panel-actions">
        <button class="btn btn-primary" id="save-document-contact" type="button">Guardar y seleccionar</button>
      </div>
    </section>`;
}

function renderDocumentModal(document = {}) {
  const isPurchase = (document.direction || state.modal.direction) === 'purchase';
  if (state.modal.loading) {
    return modalFrame('Revisar documento', '<div class="acc-empty"><strong>Cargando líneas…</strong></div>', '', 'acc-modal-wide');
  }
  const readOnly = Boolean(document.id && !['draft', 'needs_review'].includes(document.status));
  const contactKind = isPurchase ? 'supplier' : 'customer';
  const contactLabel = isPurchase ? 'Proveedor' : 'Cliente';
  const contacts = state.contacts.filter(contact => (
    contact.active !== false
    && (contact.kind === contactKind || contact.kind === 'both')
  ));
  const totals = calculateDocumentTotals(state.modal.lines || []);
  const originalUrl = safeDriveUrl(
    document.attachment_url
    || document.source_payload?.source_url
    || state.modal.sourceUrl
    || ''
  );
  const originalButton = originalUrl
    ? `<a class="btn document-original-link" href="${escapeHtml(originalUrl)}" target="_blank" rel="noreferrer">Abrir factura original ↗</a>`
    : '';
  return modalFrame(document.id ? 'Revisar documento' : isPurchase ? 'Nuevo gasto' : 'Nueva factura', `
    <form class="acc-form" id="document-form" data-id="${document.id || ''}">
      <input type="hidden" id="doc-direction" value="${isPurchase ? 'purchase' : 'sale'}">
      <div class="acc-form-grid three">
        <div class="field"><label>Tipo</label><select id="doc-type" ${readOnly ? 'disabled' : ''}>${(isPurchase ? ['invoice','ticket','expense','payroll','asset'] : ['invoice','credit_note']).map(type => `<option value="${type}" ${document.document_type===type?'selected':''}>${type}</option>`).join('')}</select></div>
        <div class="field"><label>Número</label><input id="doc-number" value="${escapeHtml(document.number || '')}" required ${readOnly ? 'disabled' : ''}></div>
        <div class="field"><label>Fecha</label><input type="date" id="doc-date" value="${document.issue_date || isoDate()}" required ${readOnly ? 'disabled' : ''}></div>
      </div>
      <div class="document-contact-row">
        <div class="field"><label>${contactLabel}</label><select id="doc-contact" ${readOnly ? 'disabled' : ''}><option value="">Sin contacto</option>${contacts.map(contact => `<option value="${contact.id}" ${document.contact_id===contact.id?'selected':''}>${escapeHtml(contact.name)}${contact.tax_id ? ` · ${escapeHtml(contact.tax_id)}` : ''}</option>`).join('')}</select></div>
        ${!readOnly ? `<button class="btn" id="new-document-contact" type="button">+ Nuevo ${contactLabel.toLocaleLowerCase('es')}</button>` : ''}
      </div>
      ${state.modal.newContact && !readOnly ? renderNewContactPanel(contactKind) : ''}
      <section class="document-lines-section">
        <div class="document-lines-title">
          <div><h3>Líneas de artículos</h3><p>Puedes corregir la base y la cuota; al cambiar cantidad, precio o tipo se recalculan.</p></div>
          ${!readOnly ? '<button class="btn btn-small" id="add-document-line" type="button">+ Añadir artículo</button>' : ''}
        </div>
        <div class="document-lines">${(state.modal.lines || []).map((line, index) => renderDocumentLine(line, index, readOnly)).join('')}</div>
      </section>
      <div class="document-totals">
        <div><span>Base imponible</span><strong id="doc-total-base">${money(totals.subtotal)}</strong></div>
        <div><span>IGIC total</span><strong id="doc-total-tax">${money(totals.taxAmount)}</strong></div>
        <div><span>Retención IRPF</span><strong id="doc-total-withholding">${money(totals.withholdingAmount)}</strong></div>
        <div class="grand-total"><span>Total factura</span><strong id="doc-total-amount">${money(totals.totalAmount)}</strong></div>
      </div>
      <div class="field"><label>Notas</label><textarea id="doc-notes" ${readOnly ? 'disabled' : ''}>${escapeHtml(document.notes || '')}</textarea></div>
      ${state.modal.correctionError ? `<div class="acc-notice"><strong>Pendiente de corrección manual.</strong><br>${escapeHtml(state.modal.correctionError)}</div>` : ''}
      ${state.modal.savedReview
        ? '<div class="acc-notice acc-success"><strong>Revisión guardada.</strong><br>Las correcciones están registradas. Puedes seguir editando o pulsar “Aprobar y contabilizar”.</div>'
        : document.status === 'needs_review' ? '<div class="acc-notice">Documento extraído automáticamente. Revisa todos los campos antes de aprobar.</div>' : ''}
      ${readOnly ? '<div class="acc-notice acc-success">Documento aprobado. Sus líneas se conservan sin cambios; cualquier corrección deberá hacerse mediante una rectificativa.</div>' : ''}
    </form>`,
    `${originalButton}${document.id && !readOnly ? '<button class="btn" id="post-document-btn">Aprobar y contabilizar</button>' : ''}${!readOnly ? `<button class="btn btn-primary" type="submit" form="document-form">${state.modal.driveImportId ? 'Guardar revisión' : 'Guardar'}</button>` : '<button class="btn" data-close-modal>Cerrar</button>'}`,
    'acc-modal-wide');
}

function renderBankImportModal() {
  const preview = state.modal.preview;
  const accountId = state.modal.accountId || '';
  if (preview) {
    const selection = bankImportSelection(preview.rows, state.modal.start, state.modal.end);
    const quarter = quarterRange(preview.range.end);
    const boundedQuarter = clampBankImportRange(quarter, preview.range);
    const quarterSelection = bankImportSelection(preview.rows, boundedQuarter.start, boundedQuarter.end);
    return modalFrame('Importar extracto bancario', `
      <form class="acc-form" id="bank-import-form">
        <div class="field"><label>Cuenta bancaria</label><select id="bank-account-select" required><option value="">Seleccionar</option>${state.bankAccounts.map(account=>`<option value="${account.id}" ${accountId === account.id ? 'selected' : ''}>${escapeHtml(account.name)}</option>`).join('')}</select></div>
        <div class="bank-import-preview-file"><span class="bank-import-icon">XLS</span><div><strong>${escapeHtml(preview.fileName)}</strong><span>${preview.rows.length} movimientos detectados · ${displayDate(preview.range.start)} – ${displayDate(preview.range.end)}</span></div><button class="btn btn-small" type="button" id="change-bank-file">Cambiar</button></div>
        <section class="bank-import-period-picker">
          <div><h3>¿Qué fechas quieres revisar?</h3><p>Los movimientos de fuera se guardan como historial, pero no cuentan ni aparecen como tareas.</p></div>
          <div class="bank-import-presets">
            <button class="btn btn-small" type="button" data-bank-import-preset="all">Todo el extracto</button>
            ${quarterSelection.included.length ? `<button class="btn btn-small" type="button" data-bank-import-preset="quarter">Solo ${quarterLabel(quarter)}</button>` : ''}
          </div>
          <div class="acc-form-grid">
            <div class="field"><label>Desde</label><input type="date" id="bank-import-start" value="${selection.selectedStart}" min="${preview.range.start}" max="${preview.range.end}" required></div>
            <div class="field"><label>Hasta</label><input type="date" id="bank-import-end" value="${selection.selectedEnd}" min="${preview.range.start}" max="${preview.range.end}" required></div>
          </div>
          <div class="bank-import-selection-summary">
            <div class="is-included"><strong>${selection.included.length}</strong><span>se revisarán</span></div>
            <div class="${selection.excluded.length ? 'is-excluded' : ''}"><strong>${selection.excluded.length}</strong><span>quedarán fuera</span></div>
          </div>
          ${selection.excluded.length ? `<div class="acc-notice"><strong>No se borrarán ${selection.excluded.length} movimientos.</strong><br>Quedarán excluidos y podrás recuperarlos después desde “Gestionar extracto”.</div>` : ''}
        </section>
      </form>`, '<button class="btn" data-close-modal>Cancelar</button><button class="btn btn-primary" type="submit" form="bank-import-form">Importar y continuar</button>', 'bank-import-modal');
  }
  return modalFrame('Importar extracto bancario', `
    <form class="acc-form" id="bank-import-form">
      <div class="field"><label>Cuenta bancaria</label><select id="bank-account-select" required><option value="">Seleccionar</option>${state.bankAccounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Archivo CSV o XLSX</label><input type="file" id="bank-file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div>
      <div class="acc-notice">Primero verás las fechas y cuántos movimientos entrarán. Columnas reconocidas: fecha, fecha valor, concepto/descripción, referencia, importe, saldo y Debe/Haber.</div>
    </form>`, '<button class="btn" data-close-modal>Cancelar</button><button class="btn btn-primary" type="button" id="preview-bank-file">Revisar antes de importar</button>', 'bank-import-modal');
}

function renderBankImportManageModal() {
  const batch = currentBankImportBatches().find(item => item.id === state.modal.batchId);
  if (!batch) return modalFrame('Gestionar extracto', '<div class="acc-empty"><strong>Extracto no encontrado</strong>Puede que ya se haya deshecho.</div>', '<button class="btn" data-close-modal>Cerrar</button>');
  const start = state.modal.start || batch.selected_start_on || batch.detected_start_on;
  const end = state.modal.end || batch.selected_end_on || batch.detected_end_on;
  const selection = bankImportSelection(batch.transactions, start, end);
  const quarter = quarterRange(batch.detected_end_on);
  const reviewedOutside = selection.excluded.filter(transaction => transaction.status !== 'pending').length;
  return modalFrame('Gestionar extracto', `
    <div class="bank-import-preview-file"><span class="bank-import-icon">XLS</span><div><strong>${escapeHtml(batch.file_name)}</strong><span>${escapeHtml(batch.account?.name || 'Cuenta bancaria')} · ${batch.row_count} movimientos · ${displayDate(batch.detected_start_on)} – ${displayDate(batch.detected_end_on)}</span></div></div>
    <form class="acc-form bank-import-period-picker" id="bank-import-manage-form">
      <div><h3>Periodo que quieres utilizar</h3><p>Lo excluido deja de aparecer en la revisión y no entra en los cálculos bancarios.</p></div>
      <div class="bank-import-presets">
        <button class="btn btn-small" type="button" data-bank-manage-preset="all">Usar todo</button>
        <button class="btn btn-small" type="button" data-bank-manage-preset="quarter">Solo ${quarterLabel(quarter)}</button>
      </div>
      <div class="acc-form-grid">
        <div class="field"><label>Desde</label><input type="date" id="bank-manage-start" value="${start}" min="${batch.detected_start_on}" max="${batch.detected_end_on}" required></div>
        <div class="field"><label>Hasta</label><input type="date" id="bank-manage-end" value="${end}" min="${batch.detected_start_on}" max="${batch.detected_end_on}" required></div>
      </div>
      <div class="bank-import-selection-summary">
        <div class="is-included"><strong>${selection.included.length}</strong><span>en uso</span></div>
        <div class="${selection.excluded.length ? 'is-excluded' : ''}"><strong>${selection.excluded.length}</strong><span>fuera del periodo</span></div>
      </div>
      ${reviewedOutside ? `<div class="acc-notice"><strong>${reviewedOutside} movimiento${reviewedOutside === 1 ? '' : 's'} ya revisado${reviewedOutside === 1 ? '' : 's'} quedará fuera.</strong><br>Su factura, conciliación o asiento seguirá guardado en el historial.</div>` : ''}
      <div class="acc-notice acc-success"><strong>La exclusión se puede deshacer.</strong><br>Vuelve a “Usar todo” para recuperar los movimientos pendientes.</div>
    </form>
    <section class="bank-import-danger-zone"><div><strong>Deshacer esta importación</strong><span>${batch.canUndo ? 'Elimina estos movimientos; después podrás volver a subir el archivo.' : 'No está disponible porque ya hay movimientos revisados.'}</span></div><button class="btn btn-danger" id="undo-bank-import" ${batch.canUndo ? '' : 'disabled'}>Deshacer importación</button></section>
  `, '<button class="btn" data-close-modal>Cerrar</button><button class="btn btn-primary" type="submit" form="bank-import-manage-form">Guardar periodo</button>', 'bank-import-modal');
}

function renderBankAccountModal() {
  return modalFrame('Nueva cuenta bancaria', `<form class="acc-form" id="bank-account-form"><div class="field"><label>Nombre</label><input id="bank-name" placeholder="BBVA principal" required></div><div class="field"><label>Últimos 4 del IBAN</label><input id="bank-last4" maxlength="4"></div><div class="field"><label>Saldo inicial</label><input type="number" step=".01" id="bank-opening" value="0"></div></form>`, '<button class="btn btn-primary" type="submit" form="bank-account-form">Guardar</button>');
}

function renderTaxModal(model) {
  return modalFrame(`Generar modelo ${model}`, `<form class="acc-form" id="tax-form"><div class="field"><label>Ejercicio</label><input id="tax-year" type="number" value="${new Date().getFullYear()}" required></div>${model !== '425' ? '<div class="field"><label>Trimestre</label><select id="tax-quarter"><option value="1">1T</option><option value="2">2T</option><option value="3">3T</option><option value="4">4T</option></select></div>' : ''}<div class="acc-notice">Se recalculará desde los documentos aprobados del periodo.</div></form>`, '<button class="btn btn-primary" type="submit" form="tax-form">Generar borrador</button>');
}

function renderEntryModal() {
  return modalFrame('Nuevo asiento manual', `<form class="acc-form" id="entry-form"><div class="acc-form-grid"><div class="field"><label>Fecha</label><input id="entry-date" type="date" value="${isoDate()}" required></div><div class="field"><label>Concepto</label><input id="entry-description" required></div></div><div class="acc-form-grid"><div class="field"><label>Cuenta Debe</label><select id="entry-debit-account">${state.accounts.map(a=>`<option value="${a.id}">${a.code} · ${escapeHtml(a.name)}</option>`).join('')}</select></div><div class="field"><label>Cuenta Haber</label><select id="entry-credit-account">${state.accounts.map(a=>`<option value="${a.id}">${a.code} · ${escapeHtml(a.name)}</option>`).join('')}</select></div></div><div class="field"><label>Importe</label><input id="entry-amount" type="number" step=".01" min=".01" required></div></form>`, '<button class="btn btn-primary" type="submit" form="entry-form">Registrar asiento</button>');
}

async function handleControlAction(button) {
  const action = button.dataset.controlAction;
  const targetId = button.dataset.targetId;
  if (action === 'drive') {
    const item = state.driveImports.find(candidate => candidate.id === targetId);
    if (!item) return toast('No se encontró la factura de Drive.', 'error');
    return item.document_id ? openDriveDocumentReview(item) : openDriveImportReview(item);
  }
  if (action === 'recurring') return openRecurringDocument(targetId, button.dataset.periodKey);
  if (action === 'document') {
    const document = state.documents.find(candidate => candidate.id === targetId);
    return document ? openDocument(document, document.direction) : toast('No se encontró el documento pendiente.', 'error');
  }
  if (action === 'reconciliation') return openReconciliation(targetId);
  if (action === 'bank') return openBankReview(targetId);
  if (action === 'bank-work') return openBankWorkspaceItem(targetId);
  if (action === 'profitability') {
    state.view = 'profitability';
    state.profitabilityFilter = 'pending';
    renderApp();
    requestAnimationFrame(() => document.querySelector('.profitability-classification')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return;
  }
  if (action === 'bank-account') return openModal({ type: 'bank-account' });
  if (action === 'recurring-setup') return openModal({ type: 'recurring-editor', expense: {} });
  if (action === 'bank-import') return state.bankAccounts.length
    ? openModal({ type: 'bank-import' })
    : openModal({ type: 'bank-account' });
}

async function handleControlQuick(action) {
  if (action === 'purchase') return openDocument({}, 'purchase');
  if (action === 'sale') return openDocument({}, 'sale');
  if (action === 'bank') {
    if (!state.bankAccounts.length) return openModal({ type: 'bank-account' });
    if (!state.bankTransactions.length) return openModal({ type: 'bank-import' });
    state.view = 'treasury';
    state.modal = null;
    state.bankReviewView = 'pending';
    renderApp();
    return;
  }
  if (action === 'drive') return syncGoogleDrive();
  if (action === 'recurring') return state.recurringExpenses.length
    ? openModal({ type: 'recurring-manager' })
    : openModal({ type: 'recurring-editor', expense: {} });
  if (action === 'tax') return openModal({ type: 'tax', model: '420' });
}

function wireEvents() {
  document.querySelectorAll('[data-dashboard-period]').forEach(button => button.addEventListener('click', () => {
    state.dashboardPeriod = button.dataset.dashboardPeriod;
    renderApp();
  }));
  document.querySelectorAll('[data-profitability-filter]').forEach(button => button.addEventListener('click', () => {
    state.profitabilityFilter = button.dataset.profitabilityFilter;
    renderApp();
    document.querySelector('.profitability-classification')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-analysis-category]').forEach(select => select.addEventListener('change', () => {
    const behavior = document.querySelector(`[data-analysis-behavior="${select.dataset.analysisCategory}"]`);
    if (behavior) behavior.value = categoryDefinition(select.value).behavior;
  }));
  document.querySelectorAll('[data-save-analysis]').forEach(button => button.addEventListener('click', () => {
    saveProfitabilityClassification(button.dataset.saveAnalysis, button);
  }));
  document.querySelector('#confirm-analysis-suggestions')?.addEventListener('click', confirmProfitabilitySuggestions);
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    state.view = button.dataset.view; state.modal = null; renderApp();
  }));
  document.querySelectorAll('[data-control-action]').forEach(button => button.addEventListener('click', () => handleControlAction(button)));
  document.querySelectorAll('[data-control-quick]').forEach(button => button.addEventListener('click', () => handleControlQuick(button.dataset.controlQuick)));
  document.querySelector('#logout-btn')?.addEventListener('click', logout);
  document.querySelector('#sync-tpv-btn')?.addEventListener('click', syncTpv);
  document.querySelectorAll('[data-new-document]').forEach(button => button.addEventListener('click', () => openDocument({}, button.dataset.newDocument)));
  document.querySelectorAll('[data-edit-document]').forEach(button => button.addEventListener('click', () => openDocument(state.documents.find(doc => doc.id === button.dataset.editDocument))));
  document.querySelectorAll('[data-review-drive-import]').forEach(button => button.addEventListener('click', () => {
    const item = state.driveImports.find(importItem => importItem.id === button.dataset.reviewDriveImport);
    if (item) openDriveImportReview(item);
  }));
  document.querySelectorAll('[data-review-drive-document]').forEach(button => button.addEventListener('click', () => {
    const item = state.driveImports.find(importItem => importItem.id === button.dataset.reviewDriveDocument);
    if (item) openDriveDocumentReview(item);
  }));
  document.querySelector('#import-bank-btn')?.addEventListener('click', () => openModal({ type: 'bank-import' }));
  document.querySelector('#import-bank-inline-btn')?.addEventListener('click', () => openModal({ type: 'bank-import' }));
  document.querySelectorAll('[data-manage-bank-import]').forEach(button => button.addEventListener('click', () => {
    const batch = currentBankImportBatches().find(item => item.id === button.dataset.manageBankImport);
    if (batch) openModal({
      type: 'bank-import-manage',
      batchId: batch.id,
      start: batch.selected_start_on || batch.detected_start_on,
      end: batch.selected_end_on || batch.detected_end_on
    });
  }));
  document.querySelector('#new-bank-account-btn')?.addEventListener('click', () => openModal({ type: 'bank-account' }));
  document.querySelector('#suggest-matches-btn')?.addEventListener('click', suggestMatches);
  document.querySelectorAll('[data-reconciliation-filter]').forEach(button => button.addEventListener('click', () => {
    state.reconciliationFilter = button.dataset.reconciliationFilter;
    renderApp();
  }));
  document.querySelectorAll('[data-review-reconciliation]').forEach(button => button.addEventListener('click', () => openReconciliation(button.dataset.reviewReconciliation)));
  document.querySelectorAll('[data-reject-match]').forEach(button => button.addEventListener('click', () => updateMatch(button.dataset.rejectMatch, 'reject', button)));
  document.querySelectorAll('[data-reopen-match]').forEach(button => button.addEventListener('click', () => updateMatch(button.dataset.reopenMatch, 'reopen', button)));
  document.querySelectorAll('[data-bank-review-view]').forEach(button => button.addEventListener('click', () => {
    state.bankReviewView = button.dataset.bankReviewView;
    state.bankReviewPage = 1;
    renderApp();
  }));
  document.querySelectorAll('[data-bank-work-filter]').forEach(button => button.addEventListener('click', () => {
    state.bankWorkFilter = button.dataset.bankWorkFilter;
    state.bankReviewPage = 1;
    renderApp();
  }));
  document.querySelector('#bank-review-search-form')?.addEventListener('submit', event => {
    event.preventDefault();
    state.bankReviewSearch = document.querySelector('#bank-review-search').value;
    state.bankReviewDirection = document.querySelector('#bank-review-direction').value;
    state.bankReviewPage = 1;
    renderApp();
  });
  document.querySelector('#bank-review-direction')?.addEventListener('change', event => {
    state.bankReviewDirection = event.currentTarget.value;
    state.bankReviewPage = 1;
    renderApp();
  });
  document.querySelectorAll('[data-bank-review-page]').forEach(button => button.addEventListener('click', () => {
    state.bankReviewPage = Number(button.dataset.bankReviewPage);
    renderApp();
    document.querySelector('.bank-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-open-bank-review]').forEach(button => button.addEventListener('click', () => openBankReview(button.dataset.openBankReview)));
  document.querySelectorAll('[data-open-bank-work]').forEach(button => button.addEventListener('click', () => openBankWorkspaceItem(button.dataset.openBankWork)));
  document.querySelector('#start-bank-work')?.addEventListener('click', () => {
    const item = currentBankWorkspace({ search: '', direction: 'all', filter: 'all' }).next;
    if (item) openBankWorkspaceItem(item.id);
  });
  document.querySelector('#new-entry-btn')?.addEventListener('click', () => openModal({ type: 'entry' }));
  document.querySelectorAll('[data-tax-model]').forEach(button => button.addEventListener('click', () => openModal({ type: 'tax', model: button.dataset.taxModel })));
  document.querySelector('#export-tax-btn')?.addEventListener('click', exportTaxCsv);
  document.querySelector('#print-tax-btn')?.addEventListener('click', () => window.print());
  document.querySelectorAll('[data-toggle-period]').forEach(button => button.addEventListener('click', () => togglePeriod(button.dataset.togglePeriod, button.dataset.status)));
  document.querySelector('#drive-settings-form')?.addEventListener('submit', saveDriveSettings);
  document.querySelector('#choose-drive-source-btn')?.addEventListener('click', () => openDriveFolderPicker('source'));
  document.querySelector('#choose-drive-result-btn')?.addEventListener('click', () => openDriveFolderPicker('result'));
  document.querySelector('#verify-drive-result-btn')?.addEventListener('click', verifyDriveResultFolder);
  document.querySelector('#json-files-input')?.addEventListener('change', event => importJsonFiles([...event.target.files]));
  document.querySelector('#google-connect-btn')?.addEventListener('click', connectGoogle);
  document.querySelector('#google-disconnect-btn')?.addEventListener('click', disconnectGoogle);
  document.querySelector('#scan-drive-btn')?.addEventListener('click', scanDriveInvoices);
  document.querySelector('#scan-drive-inline-btn')?.addEventListener('click', scanDriveInvoices);
  document.querySelector('#sync-drive-btn')?.addEventListener('click', syncGoogleDrive);
  document.querySelector('#business-form')?.addEventListener('submit', saveBusiness);
  document.querySelector('#revoke-device-btn')?.addEventListener('click', logout);
  document.querySelector('#manage-recurring-expenses')?.addEventListener('click', () => openModal({ type: 'recurring-manager' }));
  document.querySelector('#add-first-recurring-expense')?.addEventListener('click', () => openModal({ type: 'recurring-editor', expense: {} }));
  document.querySelector('#new-recurring-expense')?.addEventListener('click', () => openModal({ type: 'recurring-editor', expense: {} }));
  document.querySelector('#back-to-recurring-manager')?.addEventListener('click', () => openModal({ type: 'recurring-manager' }));
  document.querySelector('#recurring-expense-form')?.addEventListener('submit', saveRecurringExpense);
  document.querySelectorAll('[data-edit-recurring]').forEach(button => button.addEventListener('click', () => {
    const expense = state.recurringExpenses.find(item => item.id === button.dataset.editRecurring);
    if (expense) openModal({ type: 'recurring-editor', expense });
  }));
  document.querySelectorAll('[data-toggle-recurring]').forEach(button => button.addEventListener('click', () => toggleRecurringExpense(button.dataset.toggleRecurring, button.dataset.active === 'true')));
  document.querySelectorAll('[data-create-recurring-document]').forEach(button => button.addEventListener('click', () => openRecurringDocument(button.dataset.createRecurringDocument, button.dataset.periodKey)));
  document.querySelectorAll('[data-skip-recurring]').forEach(button => button.addEventListener('click', () => setRecurringOccurrence(button.dataset.skipRecurring, button.dataset.periodKey, true)));
  document.querySelectorAll('[data-restore-recurring]').forEach(button => button.addEventListener('click', () => setRecurringOccurrence(button.dataset.restoreRecurring, button.dataset.periodKey, false)));
  wireModal();
}

function wireModal() {
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  document.querySelector('.acc-modal-backdrop')?.addEventListener('click', event => {
    if (event.target.classList.contains('acc-modal-backdrop')) closeModal();
  });
  document.querySelector('#document-form')?.addEventListener('submit', saveDocument);
  document.querySelector('#post-document-btn')?.addEventListener('click', postDocument);
  document.querySelector('#new-document-contact')?.addEventListener('click', showNewDocumentContact);
  document.querySelector('#cancel-document-contact')?.addEventListener('click', cancelNewDocumentContact);
  document.querySelector('#save-document-contact')?.addEventListener('click', saveNewDocumentContact);
  document.querySelector('.document-contact-panel')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveNewDocumentContact();
    }
  });
  document.querySelector('#add-document-line')?.addEventListener('click', addDocumentLine);
  document.querySelectorAll('[data-remove-line]').forEach(button => button.addEventListener('click', () => removeDocumentLine(Number(button.dataset.removeLine))));
  document.querySelectorAll('[data-line-field]').forEach(input => {
    input.addEventListener('input', refreshDocumentCalculations);
    input.addEventListener('change', refreshDocumentCalculations);
  });
  document.querySelector('#bank-import-form')?.addEventListener('submit', importBankFile);
  document.querySelector('#bank-file')?.addEventListener('change', prepareBankImportPreview);
  document.querySelector('#preview-bank-file')?.addEventListener('click', prepareBankImportPreview);
  document.querySelector('#change-bank-file')?.addEventListener('click', () => {
    state.modal.preview = null;
    state.modal.start = '';
    state.modal.end = '';
    renderApp();
  });
  document.querySelector('#bank-account-select')?.addEventListener('change', event => {
    if (state.modal?.type === 'bank-import') state.modal.accountId = event.currentTarget.value;
  });
  document.querySelectorAll('[data-bank-import-preset]').forEach(button => button.addEventListener('click', () => {
    const preview = state.modal.preview;
    const range = button.dataset.bankImportPreset === 'quarter'
      ? clampBankImportRange(quarterRange(preview.range.end), preview.range)
      : preview.range;
    state.modal.start = range.start;
    state.modal.end = range.end;
    renderApp();
  }));
  ['start', 'end'].forEach(field => document.querySelector(`#bank-import-${field}`)?.addEventListener('change', event => {
    state.modal[field] = event.currentTarget.value;
    renderApp();
  }));
  document.querySelector('#bank-import-manage-form')?.addEventListener('submit', saveBankImportPeriod);
  document.querySelectorAll('[data-bank-manage-preset]').forEach(button => button.addEventListener('click', () => {
    const batch = currentBankImportBatches().find(item => item.id === state.modal.batchId);
    if (!batch) return;
    const range = button.dataset.bankManagePreset === 'quarter' ? clampBankImportRange(quarterRange(batch.detected_end_on), {
      start: batch.detected_start_on,
      end: batch.detected_end_on
    }) : {
      start: batch.detected_start_on,
      end: batch.detected_end_on
    };
    state.modal.start = range.start;
    state.modal.end = range.end;
    renderApp();
  }));
  ['start', 'end'].forEach(field => document.querySelector(`#bank-manage-${field}`)?.addEventListener('change', event => {
    state.modal[field] = event.currentTarget.value;
    renderApp();
  }));
  document.querySelector('#undo-bank-import')?.addEventListener('click', undoBankImport);
  document.querySelector('#bank-account-form')?.addEventListener('submit', saveBankAccount);
  document.querySelector('#tax-form')?.addEventListener('submit', generateTaxDraft);
  document.querySelector('#entry-form')?.addEventListener('submit', saveEntry);
  document.querySelectorAll('[data-open-drive-folder]').forEach(button => button.addEventListener('click', () => navigateDriveFolder(button.dataset.openDriveFolder)));
  document.querySelector('[data-drive-folder-back]')?.addEventListener('click', navigateDriveFolderBack);
  document.querySelectorAll('[data-drive-picker-location]').forEach(button => button.addEventListener('click', () => switchDrivePickerLocation(button.dataset.drivePickerLocation)));
  document.querySelector('#select-current-drive-folder')?.addEventListener('click', selectCurrentDriveFolder);
  document.querySelector('#drive-result-lock-confirm')?.addEventListener('change', event => {
    const selectButton = document.querySelector('#select-current-drive-folder');
    if (selectButton) selectButton.disabled = !event.currentTarget.checked;
  });
  document.querySelector('#reconciliation-reviewed')?.addEventListener('change', event => {
    const confirmButton = document.querySelector('#confirm-reconciliation-btn');
    if (confirmButton) confirmButton.disabled = !event.currentTarget.checked;
  });
  document.querySelectorAll('[data-match-action]').forEach(button => button.addEventListener('click', () => {
    updateMatch(button.dataset.matchId, button.dataset.matchAction, button);
  }));
  document.querySelector('#manual-bank-match-form')?.addEventListener('submit', createManualBankMatch);
  document.querySelector('#bank-missing-document-form')?.addEventListener('submit', markBankDocumentMissing);
  document.querySelectorAll('[data-clear-bank-missing]').forEach(button => button.addEventListener('click', () => clearBankDocumentMissing(button.dataset.clearBankMissing, button)));
  document.querySelector('#bank-classification-form')?.addEventListener('submit', classifyBankTransaction);
  document.querySelector('#bank-classification')?.addEventListener('change', event => {
    state.modal.classification = event.currentTarget.value;
    const definition = classificationDefinition(event.currentTarget.value);
    const effect = document.querySelector('#bank-classification-effect');
    if (effect) effect.textContent = definition?.effect || '';
    const checkbox = document.querySelector('#bank-classification-reviewed');
    const button = document.querySelector('#classify-bank-button');
    if (checkbox) checkbox.checked = false;
    if (button) button.disabled = true;
  });
  document.querySelector('#bank-classification-reviewed')?.addEventListener('change', event => {
    const button = document.querySelector('#classify-bank-button');
    if (button) button.disabled = !event.currentTarget.checked;
  });
  document.querySelectorAll('[data-unclassify-bank]').forEach(button => button.addEventListener('click', () => unclassifyBankTransaction(button.dataset.unclassifyBank, button)));
}

function openModal(modal) { state.modal = modal; renderApp(); }
function closeModal() { state.modal = null; renderApp(); }

function recurringReviewItem(expenseId, periodKey) {
  return currentRecurringReview().items.find(item => (
    item.expense.id === expenseId && item.periodKey === periodKey
  ));
}

async function saveRecurringExpense(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector(`button[form="${form.id}"]`);
  if (button) button.disabled = true;
  const row = {
    id: form.dataset.id || undefined,
    business_id: state.business.id,
    contact_id: document.querySelector('#recurring-contact').value || null,
    name: document.querySelector('#recurring-name').value.trim(),
    category: document.querySelector('#recurring-category').value,
    expected_amount: Number(document.querySelector('#recurring-amount').value || 0),
    frequency: document.querySelector('#recurring-frequency').value,
    due_day: Number(document.querySelector('#recurring-day').value),
    start_on: document.querySelector('#recurring-start').value,
    active: state.modal.expense?.active !== false,
    updated_at: new Date().toISOString()
  };
  if (!row.id) delete row.id;
  const { error } = await state.client.from('accounting_recurring_expenses').upsert(row);
  if (error) {
    if (button) button.disabled = false;
    return toast(error.message || 'No se pudo guardar el gasto habitual.', 'error');
  }
  state.modal = null;
  await loadAll();
  toast('Gasto habitual guardado. Los avisos se han actualizado.');
}

async function toggleRecurringExpense(expenseId, currentlyActive) {
  const { error } = await state.client.from('accounting_recurring_expenses')
    .update({ active: !currentlyActive, updated_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) return toast(error.message || 'No se pudo cambiar el gasto habitual.', 'error');
  await loadAll();
  openModal({ type: 'recurring-manager' });
}

async function setRecurringOccurrence(expenseId, periodKey, skipped) {
  const item = recurringReviewItem(expenseId, periodKey);
  if (!item) return toast('No se encontró este gasto previsto.', 'error');
  const { error } = await state.client.from('accounting_recurring_expense_occurrences').upsert({
    business_id: state.business.id,
    recurring_expense_id: expenseId,
    period_key: periodKey,
    expected_on: isoDate(item.expectedOn),
    status: skipped ? 'skipped' : 'pending',
    document_id: null,
    note: skipped ? 'El propietario indicó que no corresponde en este periodo.' : '',
    updated_at: new Date().toISOString()
  }, { onConflict: 'recurring_expense_id,period_key' });
  if (error) return toast(error.message || 'No se pudo actualizar el aviso.', 'error');
  await loadAll();
  toast(skipped ? 'Marcado como “este mes no corresponde”.' : 'Aviso restaurado.');
}

function openRecurringDocument(expenseId, periodKey) {
  const item = recurringReviewItem(expenseId, periodKey);
  if (!item) return toast('No se encontró este gasto previsto.', 'error');
  const line = {
    ...emptyDocumentLine('purchase'),
    description: item.expense.name,
    unit_price: 0,
    taxable_base: 0
  };
  openDocument({
    contact_id: item.expense.contact_id || null,
    issue_date: isoDate(item.expectedOn),
    notes: `Gasto habitual: ${item.expense.name}${item.expectedAmount ? ` · importe aproximado ${money(item.expectedAmount)}` : ''}. Revisa la base y el IGIC con la factura original.`
  }, 'purchase', {
    lines: [line],
    recurringExpenseId: expenseId,
    recurringPeriodKey: periodKey,
    recurringExpectedOn: isoDate(item.expectedOn)
  });
}

async function linkRecurringDocument(documentId, context) {
  if (!context?.recurringExpenseId || !context?.recurringPeriodKey) return;
  const { error } = await state.client.from('accounting_recurring_expense_occurrences').upsert({
    business_id: state.business.id,
    recurring_expense_id: context.recurringExpenseId,
    period_key: context.recurringPeriodKey,
    expected_on: context.recurringExpectedOn,
    status: 'linked',
    document_id: documentId,
    note: '',
    updated_at: new Date().toISOString()
  }, { onConflict: 'recurring_expense_id,period_key' });
  if (error) throw error;
}

async function saveProfitabilityClassification(documentId, button) {
  const category = document.querySelector(`[data-analysis-category="${documentId}"]`)?.value;
  const costBehavior = document.querySelector(`[data-analysis-behavior="${documentId}"]`)?.value;
  if (!category || !costBehavior) return;
  if (button) button.disabled = true;
  const row = {
    document_id: documentId,
    business_id: state.business.id,
    category,
    cost_behavior: costBehavior,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await state.client.from('accounting_document_analysis')
    .upsert(row, { onConflict: 'document_id' })
    .select('*')
    .single();
  if (error) {
    if (button) button.disabled = false;
    return toast(error.message || 'No se pudo guardar la clasificación.', 'error');
  }
  state.profitabilityAnalyses = [
    ...state.profitabilityAnalyses.filter(item => item.document_id !== documentId),
    data
  ];
  renderApp();
  toast('Clasificación guardada. El análisis se ha recalculado.');
}

async function confirmProfitabilitySuggestions() {
  const analysis = buildProfitabilityAnalysis({
    documents: state.documents,
    analyses: state.profitabilityAnalyses,
    period: state.dashboardPeriod
  });
  const rows = analysis.needsConfirmation
    .filter(item => item.category !== 'unclassified')
    .map(item => ({
      document_id: item.document.id,
      business_id: state.business.id,
      category: item.category,
      cost_behavior: item.cost_behavior,
      updated_at: new Date().toISOString()
    }));
  if (!rows.length) return toast('No hay sugerencias listas para confirmar.');
  const button = document.querySelector('#confirm-analysis-suggestions');
  if (button) button.disabled = true;
  const { data, error } = await state.client.from('accounting_document_analysis')
    .upsert(rows, { onConflict: 'document_id' })
    .select('*');
  if (error) {
    if (button) button.disabled = false;
    return toast(error.message || 'No se pudieron confirmar las sugerencias.', 'error');
  }
  const savedIds = new Set((data || []).map(item => item.document_id));
  state.profitabilityAnalyses = [
    ...state.profitabilityAnalyses.filter(item => !savedIds.has(item.document_id)),
    ...(data || [])
  ];
  renderApp();
  toast(`${rows.length} clasificaciones confirmadas.`);
}

async function openDocument(document = {}, direction = document.direction || 'purchase', context = {}) {
  if (!document.id) {
    openModal({
      type: 'document',
      document,
      direction,
      lines: [emptyDocumentLine(direction)],
      priceHistory: [],
      ...context
    });
    return;
  }
  openModal({ type: 'document', document, direction, lines: [], priceHistory: [], ...context, loading: true });
  const [linesResult, historyResult] = await Promise.all([
    state.client.from('bookkeeping_document_lines').select('*').eq('document_id', document.id).order('position'),
    state.client.rpc('accounting_purchase_price_history', { p_document_id: document.id })
  ]);
  if (linesResult.error || historyResult.error) {
    state.modal = null;
    renderApp();
    toast((linesResult.error || historyResult.error).message, 'error');
    return;
  }
  state.modal = {
    type: 'document',
    document,
    direction,
    lines: linesResult.data?.length
      ? linesResult.data.map(line => ({
          ...line,
          manual_taxable_base: true,
          manual_tax_amount: true
        }))
      : [emptyDocumentLine(direction)],
    priceHistory: historyResult.data || [],
    ...context,
    loading: false
  };
  renderApp();
}

function openDriveDocumentReview(item) {
  const document = state.documents.find(candidate => candidate.id === item.document_id);
  if (!document) {
    toast('No se encontró el documento guardado para esta factura.', 'error');
    return;
  }
  const review = reviewableSupplierDocument(item.payload, {
    drive_file_id: item.drive_file_id,
    issue_date: document.issue_date,
    number: document.number
  });
  openDocument(document, document.direction, {
    driveImportId: item.id,
    savedReview: driveReviewStatus(item) === 'reviewed',
    sourceUrl: safeDriveUrl(document.attachment_url || review.source_url || driveFileUrl(review.drive_file_id)),
    contactDefaults: review.supplier
  });
}

function openDriveImportReview(item) {
  const review = reviewableSupplierDocument(item.payload, {
    drive_file_id: item.drive_file_id,
    issue_date: isoDate(),
    number: `PENDIENTE-${String(item.drive_file_id || item.id).slice(-8)}`
  });
  const contact = findMatchingContact(state.contacts, review.supplier);
  const sourceUrl = safeDriveUrl(review.source_url || driveFileUrl(review.drive_file_id));
  const notes = [
    item.error_message ? `Corrección pendiente: ${item.error_message}` : '',
    ...review.warnings
  ].filter(Boolean).join('\n');
  openModal({
    type: 'document',
    driveImportId: item.id,
    correctionError: item.error_message || '',
    sourceUrl,
    direction: 'purchase',
    priceHistory: [],
    contactDefaults: review.supplier,
    lines: review.lines,
    document: {
      direction: 'purchase',
      status: 'needs_review',
      document_type: review.invoice.document_type,
      number: review.invoice.number,
      issue_date: review.invoice.issue_date,
      contact_id: contact?.id || null,
      source_type: 'drive_json',
      source_id: review.drive_file_id || item.drive_file_id,
      source_payload: item.payload || {},
      attachment_url: sourceUrl,
      notes
    }
  });
}

async function syncTpv() {
  try {
    await rpc('accounting_seed_defaults');
    const count = await rpc('accounting_sync_tpv_sales');
    toast(`${count} ventas sincronizadas.`);
    await loadAll();
  } catch (error) { toast(error.message, 'error'); }
}

function readDocumentLines() {
  return [...document.querySelectorAll('.document-line')].map(row => {
    const taxableBase = row.querySelector('[data-line-field="taxable_base"]');
    const taxAmount = row.querySelector('[data-line-field="tax_amount"]');
    return {
      id: row.dataset.lineId || '',
      supplier_item_code: row.querySelector('[data-line-field="supplier_item_code"]')?.value.trim() || '',
      description: row.querySelector('[data-line-field="description"]')?.value.trim() || '',
      quantity: Number(row.querySelector('[data-line-field="quantity"]')?.value || 0),
      unit_price: Number(row.querySelector('[data-line-field="unit_price"]')?.value || 0),
      taxable_base: Number(taxableBase?.value || 0),
      manual_taxable_base: row.dataset.manualBase === 'true',
      tax_scope: row.querySelector('[data-line-field="tax_scope"]')?.value || 'taxable',
      tax_rate: Number(row.querySelector('[data-line-field="tax_rate"]')?.value || 0),
      tax_amount: Number(taxAmount?.value || 0),
      manual_tax_amount: row.dataset.manualTax === 'true',
      withholding_rate: Number(row.querySelector('[data-line-field="withholding_rate"]')?.value || 0),
      account_code: state.modal.direction === 'sale' ? '700' : '600'
    };
  });
}

function refreshDocumentCalculations(event) {
  if (state.modal?.type !== 'document') return;
  const changedField = event?.target?.dataset?.lineField;
  const changedRow = event?.target?.closest('.document-line');
  if (changedRow) {
    if (changedField === 'taxable_base') changedRow.dataset.manualBase = 'true';
    if (changedField === 'tax_amount') changedRow.dataset.manualTax = 'true';
    if (['quantity', 'unit_price'].includes(changedField)) {
      changedRow.dataset.manualBase = 'false';
      changedRow.dataset.manualTax = 'false';
    }
    if (['tax_scope', 'tax_rate'].includes(changedField)) {
      changedRow.dataset.manualTax = 'false';
    }
  }
  const totals = calculateDocumentTotals(readDocumentLines());
  state.modal.lines = totals.lines;
  document.querySelectorAll('.document-line').forEach((row, index) => {
    const line = totals.lines[index];
    const baseInput = row.querySelector('[data-line-base]');
    const taxInput = row.querySelector('[data-line-tax]');
    if (baseInput && (event?.type === 'change' || baseInput !== event?.target)) baseInput.value = line.taxable_base;
    if (taxInput && (event?.type === 'change' || taxInput !== event?.target)) taxInput.value = line.tax_amount;
    const rateSelect = row.querySelector('[data-line-field="tax_rate"]');
    if (rateSelect) {
      rateSelect.disabled = line.tax_scope !== 'taxable';
      if (line.tax_scope !== 'taxable') rateSelect.value = '0';
    }
    if (taxInput) taxInput.disabled = line.tax_scope !== 'taxable';
    const historyNode = row.querySelector('[data-price-history]');
    if (historyNode) {
      const variation = calculatePriceVariation(line.unit_price, Number(historyNode.dataset.previousPrice));
      historyNode.classList.remove('up', 'down', 'same');
      historyNode.classList.add(variation?.percent > 0 ? 'up' : variation?.percent < 0 ? 'down' : 'same');
      const strong = historyNode.querySelector('strong');
      if (strong) strong.textContent = variation ? `${variation.percent > 0 ? '+' : ''}${variation.percent.toFixed(2)} %` : '—';
    }
  });
  document.querySelector('#doc-total-base').textContent = money(totals.subtotal);
  document.querySelector('#doc-total-tax').textContent = money(totals.taxAmount);
  document.querySelector('#doc-total-withholding').textContent = money(totals.withholdingAmount);
  document.querySelector('#doc-total-amount').textContent = money(totals.totalAmount);
}

function captureDocumentHeader() {
  captureNewContactDraft();
  const current = state.modal.document || {};
  const recurringContext = {
    recurringExpenseId: state.modal.recurringExpenseId,
    recurringPeriodKey: state.modal.recurringPeriodKey,
    recurringExpectedOn: state.modal.recurringExpectedOn
  };
  state.modal.document = {
    ...current,
    direction: document.querySelector('#doc-direction')?.value || state.modal.direction,
    document_type: document.querySelector('#doc-type')?.value || current.document_type,
    number: document.querySelector('#doc-number')?.value || '',
    issue_date: document.querySelector('#doc-date')?.value || current.issue_date,
    contact_id: document.querySelector('#doc-contact')?.value || null,
    notes: document.querySelector('#doc-notes')?.value || ''
  };
}

function captureNewContactDraft() {
  if (!state.modal?.newContact) return;
  const value = id => document.querySelector(id)?.value.trim() || '';
  state.modal.newContact = {
    ...state.modal.newContact,
    name: value('#new-contact-name'),
    legal_name: value('#new-contact-legal-name'),
    tax_id: value('#new-contact-tax-id'),
    email: value('#new-contact-email'),
    phone: value('#new-contact-phone'),
    address: value('#new-contact-address')
  };
}

function showNewDocumentContact() {
  captureDocumentHeader();
  state.modal.lines = readDocumentLines();
  const defaults = state.modal.contactDefaults || {};
  state.modal.newContact = {
    name: defaults.name === 'Proveedor pendiente' ? '' : defaults.name || '',
    legal_name: defaults.legal_name || '',
    tax_id: defaults.tax_id || '',
    email: defaults.email || '',
    phone: defaults.phone || '',
    address: defaults.address || ''
  };
  renderApp();
  requestAnimationFrame(() => document.querySelector('#new-contact-name')?.focus());
}

function cancelNewDocumentContact() {
  captureDocumentHeader();
  state.modal.lines = readDocumentLines();
  state.modal.newContact = null;
  renderApp();
}

async function saveNewDocumentContact() {
  captureDocumentHeader();
  state.modal.lines = readDocumentLines();
  const draft = state.modal.newContact || {};
  if (!draft.name) {
    toast('Escribe el nombre del proveedor.', 'error');
    document.querySelector('#new-contact-name')?.focus();
    return;
  }
  if (!document.querySelector('#new-contact-email')?.reportValidity()) return;
  if (!state.business?.id) {
    toast('No se ha podido identificar el negocio.', 'error');
    return;
  }

  const button = document.querySelector('#save-document-contact');
  if (button) button.disabled = true;
  const requestedKind = state.modal.direction === 'sale' ? 'customer' : 'supplier';
  const contactLabel = requestedKind === 'supplier' ? 'proveedor' : 'cliente';

  try {
    let contact = findMatchingContact(state.contacts, draft);
    let reused = Boolean(contact);
    if (contact) {
      const updates = {
        kind: mergeContactKind(contact.kind, requestedKind),
        active: true,
        updated_at: new Date().toISOString()
      };
      ['legal_name', 'tax_id', 'email', 'phone', 'address'].forEach(field => {
        if (!String(contact[field] || '').trim() && draft[field]) updates[field] = draft[field];
      });
      const { data, error } = await state.client
        .from('accounting_contacts')
        .update(updates)
        .eq('id', contact.id)
        .select('*')
        .single();
      if (error) throw error;
      contact = data;
    } else {
      const { data, error } = await state.client
        .from('accounting_contacts')
        .insert({
          business_id: state.business.id,
          kind: requestedKind,
          name: draft.name,
          legal_name: draft.legal_name || draft.name,
          tax_id: draft.tax_id,
          email: draft.email,
          phone: draft.phone,
          address: draft.address,
          default_account_code: requestedKind === 'supplier' ? '600' : '700'
        })
        .select('*')
        .single();
      if (error) throw error;
      contact = data;
    }

    state.contacts = [
      ...state.contacts.filter(item => item.id !== contact.id),
      contact
    ].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    state.modal.document.contact_id = contact.id;
    state.modal.contactDefaults = contact;
    state.modal.newContact = null;
    renderApp();
    toast(reused
      ? `El ${contactLabel} ya existía: se ha seleccionado.`
      : `${contactLabel[0].toUpperCase()}${contactLabel.slice(1)} guardado y seleccionado.`);
  } catch (error) {
    toast(error.message || 'No se pudo guardar el proveedor.', 'error');
    if (button) button.disabled = false;
  }
}

function addDocumentLine() {
  captureDocumentHeader();
  state.modal.lines = readDocumentLines();
  state.modal.lines.push(emptyDocumentLine(state.modal.direction));
  renderApp();
}

function removeDocumentLine(index) {
  captureDocumentHeader();
  const lines = readDocumentLines();
  if (lines.length <= 1) return;
  lines.splice(index, 1);
  state.modal.lines = lines;
  renderApp();
}

async function persistDocument({ closeAfter = true } = {}) {
  if (state.modal.newContact) {
    toast('Guarda o cancela el nuevo proveedor antes de continuar.', 'error');
    return null;
  }
  const form = document.querySelector('#document-form');
  if (!form?.reportValidity()) return null;
  const current = state.modal.document || {};
  const lines = readDocumentLines();
  if (!lines.length || lines.some(line => !line.description || line.quantity <= 0 || !Number.isFinite(line.unit_price))) {
    toast('Revisa la descripción, cantidad y precio de cada artículo.', 'error');
    return null;
  }
  const header = {
    contact_id: document.querySelector('#doc-contact').value || null,
    source_type: current.source_type || 'manual',
    source_id: current.source_id || `manual-${uuid()}`,
    direction: document.querySelector('#doc-direction').value || state.modal.direction,
    document_type: document.querySelector('#doc-type').value,
    number: document.querySelector('#doc-number').value.trim(),
    issue_date: document.querySelector('#doc-date').value,
    notes: document.querySelector('#doc-notes').value,
    source_payload: current.source_payload || {},
    attachment_url: current.attachment_url || state.modal.sourceUrl || ''
  };
  try {
    const documentId = state.modal.driveImportId
      ? await rpc('accounting_save_drive_review', {
          p_import_id: state.modal.driveImportId,
          p_document: header,
          p_lines: lines
        })
      : await rpc('accounting_save_document_with_lines', {
          p_document_id: current.id || null,
          p_document: header,
          p_lines: lines
        });
    try {
      await linkRecurringDocument(documentId, recurringContext);
    } catch (linkError) {
      console.warn('[Gastos habituales] No se pudo enlazar el documento', linkError);
      toast('La factura se guardó, pero el aviso no pudo enlazarse automáticamente.', 'error');
    }
    if (closeAfter) {
      state.modal = null;
      toast('Documento y artículos guardados.');
      await loadAll();
    }
    return documentId;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  }
}

async function saveDocument(event) {
  event.preventDefault();
  const driveImportId = state.modal.driveImportId;
  if (!driveImportId) {
    await persistDocument();
    return;
  }

  const context = {
    driveImportId,
    savedReview: true,
    correctionError: '',
    sourceUrl: state.modal.sourceUrl || '',
    contactDefaults: state.modal.contactDefaults || {}
  };
  const documentId = await persistDocument({ closeAfter: false });
  if (!documentId) return;
  try {
    await loadAll();
    const document = state.documents.find(candidate => candidate.id === documentId);
    if (!document) throw new Error('No se encontró el documento guardado.');
    await openDocument(document, document.direction, context);
    if (state.modal?.document?.id === documentId) {
      toast('Revisión guardada. La factura queda pendiente de aprobar.');
    }
  } catch {
    state.modal = null;
    renderApp();
    toast('La revisión se guardó, pero no se pudo actualizar la pantalla. Recarga la app.', 'error');
  }
}

async function postDocument() {
  try {
    const documentId = await persistDocument({ closeAfter: false });
    if (!documentId) return;
    await rpc('accounting_post_document', { p_document_id: documentId });
    state.modal = null; toast('Documento aprobado y contabilizado.'); await loadAll();
  } catch (error) { toast(error.message, 'error'); }
}

async function saveBankAccount(event) {
  event.preventDefault();
  const { error } = await state.client.from('accounting_bank_accounts').insert({
    business_id: state.business.id,
    name: document.querySelector('#bank-name').value,
    iban_last4: document.querySelector('#bank-last4').value,
    opening_balance: Number(document.querySelector('#bank-opening').value || 0)
  });
  if (error) return toast(error.message, 'error');
  state.modal = null; await loadAll();
}

async function suggestMatches() {
  try {
    const count = await rpc('accounting_suggest_reconciliations');
    toast(`${count} posibles coincidencias revisadas.`);
    await loadAll();
  } catch (error) { toast(error.message, 'error'); }
}

function openBankReview(transactionId) {
  const transaction = state.bankTransactions.find(item => item.id === transactionId);
  if (!transaction) return toast('No se encontró el movimiento bancario.', 'error');
  const review = bankReviewForTransaction(transactionId);
  openModal({
    type: 'bank-review',
    transaction,
    review,
    classification: review?.status === 'active' ? review.classification : suggestBankClassification(transaction)
  });
}

function openBankWorkspaceItem(itemId) {
  const workspace = currentBankWorkspace({ search: '', direction: 'all', filter: 'all' });
  const item = workspace.allItems.find(candidate => candidate.id === itemId || candidate.transaction.id === itemId);
  if (!item) return toast('Este movimiento ya no está pendiente.', 'error');
  state.view = 'treasury';
  if (item.action === 'reconciliation') return openReconciliation(item.reconciliation.id);
  return openBankReview(item.transaction.id);
}

function openNextBankWorkItem() {
  state.bankReviewView = 'pending';
  state.bankWorkFilter = 'all';
  state.bankReviewSearch = '';
  state.bankReviewDirection = 'all';
  state.bankReviewPage = 1;
  const next = currentBankWorkspace({ search: '', direction: 'all', filter: 'all' }).next;
  if (next) return openBankWorkspaceItem(next.id);
  state.modal = null;
  renderApp();
}

async function createManualBankMatch(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const reconciliationId = await rpc('accounting_create_manual_reconciliation', {
      p_bank_transaction_id: state.modal.transaction.id,
      p_document_id: document.querySelector('#manual-bank-document').value,
      p_amount: Number(document.querySelector('#manual-bank-amount').value)
    });
    state.modal = null;
    await loadAll();
    await openReconciliation(reconciliationId);
    toast('Comparación creada. Revisa banco, factura y original antes de confirmar.');
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo crear la comparación.', 'error');
  }
}

async function markBankDocumentMissing(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await rpc('accounting_mark_bank_document_missing', {
      p_bank_transaction_id: state.modal.transaction.id,
      p_notes: document.querySelector('#bank-missing-document-notes')?.value || ''
    });
    state.modal = null;
    await loadAll();
    toast('Anotado: falta la factura. No se deducirá el gasto ni el IGIC mientras tanto.');
    openNextBankWorkItem();
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo guardar el recordatorio.', 'error');
  }
}

async function clearBankDocumentMissing(transactionId, button) {
  if (button) button.disabled = true;
  try {
    await rpc('accounting_clear_bank_document_missing', {
      p_bank_transaction_id: transactionId
    });
    state.modal = null;
    await loadAll();
    openBankReview(transactionId);
    toast('Aviso eliminado. El movimiento sigue pendiente de revisión.');
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo quitar el aviso.', 'error');
  }
}

async function classifyBankTransaction(event) {
  event.preventDefault();
  const button = document.querySelector('#classify-bank-button');
  if (button) button.disabled = true;
  const transactionId = state.modal.transaction.id;
  try {
    await rpc('accounting_classify_bank_transaction_v2', {
      p_bank_transaction_id: transactionId,
      p_classification: document.querySelector('#bank-classification').value,
      p_notes: document.querySelector('#bank-classification-notes').value
    });
    state.modal = null;
    await loadAll();
    toast('Movimiento clasificado. Abrimos el siguiente pendiente.');
    openNextBankWorkItem();
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo clasificar el movimiento.', 'error');
  }
}

async function unclassifyBankTransaction(transactionId, button) {
  if (button) button.disabled = true;
  try {
    await rpc('accounting_unclassify_bank_transaction', {
      p_bank_transaction_id: transactionId
    });
    state.modal = null;
    state.bankReviewView = 'pending';
    state.bankReviewPage = 1;
    await loadAll();
    toast('Clasificación deshecha. El movimiento vuelve a estar pendiente.');
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo deshacer la clasificación.', 'error');
  }
}

async function openReconciliation(id) {
  const match = state.reconciliations.find(item => item.id === id);
  if (!match) return toast('No se encontró la propuesta de conciliación.', 'error');
  state.modal = { type: 'reconciliation', match, lines: [], loading: true };
  renderApp();
  if (!match.document_id) {
    state.modal.loading = false;
    renderApp();
    return;
  }
  const { data, error } = await state.client.from('bookkeeping_document_lines')
    .select('*')
    .eq('document_id', match.document_id)
    .order('position');
  if (state.modal?.type !== 'reconciliation' || state.modal.match.id !== id) return;
  state.modal.lines = data || [];
  state.modal.loading = false;
  if (error) toast('No se pudo cargar el desglose del documento.', 'error');
  renderApp();
}

async function updateMatch(id, action, button) {
  const match = state.reconciliations.find(item => item.id === id);
  if (!match) return;
  const keepModalOpen = state.modal?.type === 'reconciliation' && state.modal.match.id === id;
  if (button) button.disabled = true;
  try {
    await rpc('accounting_update_reconciliation', {
      p_reconciliation_id: id,
      p_action: action
    });
    const messages = {
      confirm: 'Conciliación confirmada. El banco y el documento se han actualizado juntos.',
      reject: 'Propuesta descartada. Puedes recuperarla desde Descartadas.',
      reopen: 'La propuesta vuelve a estar pendiente de revisión.',
      undo: 'Conciliación deshecha. Se han restaurado el banco y el documento.'
    };
    state.modal = null;
    await loadAll();
    toast(messages[action] || 'Conciliación actualizada.');
    if (keepModalOpen && action === 'confirm') openNextBankWorkItem();
    else if (keepModalOpen) await openReconciliation(id);
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo actualizar la conciliación.', 'error');
  }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Buffer(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function prepareBankImportPreview(event) {
  event?.preventDefault?.();
  try {
    const input = document.querySelector('#bank-file');
    const file = input?.files?.[0];
    if (!file) return toast('Elige primero un archivo CSV o XLSX.', 'error');
    const accountId = document.querySelector('#bank-account-select')?.value || state.modal.accountId || '';
    const buffer = await file.arrayBuffer();
    const rows = file.name.toLowerCase().endsWith('.xlsx')
      ? parseXlsx(buffer)
      : parseCsv(new TextDecoder('utf-8').decode(buffer));
    const mapped = mapBankRows(rows);
    if (!mapped.length) throw new Error('No se encontraron movimientos con fecha e importe reconocibles.');
    const selection = bankImportSelection(mapped);
    state.modal = {
      ...state.modal,
      accountId,
      preview: {
        rows: mapped,
        range: selection.range,
        fileName: file.name,
        fileSize: file.size,
        checksum: await sha256Buffer(buffer)
      },
      start: selection.range.start,
      end: selection.range.end
    };
    renderApp();
  } catch (error) {
    toast(error.message || 'No se pudo leer el extracto.', 'error');
  }
}

async function importBankFile(event) {
  event.preventDefault();
  if (!state.modal?.preview) return prepareBankImportPreview(event);
  try {
    const preview = state.modal.preview;
    const mapped = preview.rows;
    const accountId = document.querySelector('#bank-account-select').value;
    const selection = bankImportSelection(mapped, state.modal.start, state.modal.end);
    if (!accountId) throw new Error('Selecciona la cuenta bancaria.');
    if (!selection.included.length) throw new Error('El periodo elegido no contiene ningún movimiento.');
    const batch = uuid();
    const payload = [];
    for (const item of mapped) {
      payload.push({
        ...item, business_id: state.business.id, bank_account_id: accountId,
        fingerprint: await sha256([accountId,item.booked_on,item.amount,item.description,item.reference].join('|')),
        import_batch: batch,
        review_scope: item.booked_on >= selection.selectedStart && item.booked_on <= selection.selectedEnd ? 'included' : 'excluded',
        excluded_at: item.booked_on >= selection.selectedStart && item.booked_on <= selection.selectedEnd ? null : new Date().toISOString(),
        exclusion_reason: item.booked_on >= selection.selectedStart && item.booked_on <= selection.selectedEnd ? null : 'Fuera del periodo elegido al importar',
        raw_payload: item
      });
    }
    const { data, error } = await state.client.from('accounting_bank_transactions')
      .upsert(payload, { onConflict: 'business_id,fingerprint', ignoreDuplicates: true }).select();
    if (error) throw error;
    const importedCount = data?.length || 0;
    const excludedCount = (data || []).filter(item => item.review_scope === 'excluded').length;
    const duplicateCount = Math.max(0, mapped.length - importedCount);
    if (importedCount) {
      const { error: importError } = await state.client.from('accounting_bank_imports').insert({
        id: batch,
        business_id: state.business.id,
        bank_account_id: accountId,
        file_name: preview.fileName,
        file_size: preview.fileSize,
        file_checksum: preview.checksum,
        detected_start_on: preview.range.start,
        detected_end_on: preview.range.end,
        selected_start_on: selection.selectedStart,
        selected_end_on: selection.selectedEnd,
        row_count: mapped.length,
        imported_count: importedCount,
        duplicate_count: duplicateCount,
        excluded_count: excludedCount,
        status: excludedCount === importedCount ? 'excluded' : excludedCount ? 'partially_excluded' : 'active'
      });
      if (importError) console.warn('No se pudo guardar el nombre del extracto:', importError.message);
    }
    let matchCount = 0;
    try { matchCount = Number(await rpc('accounting_suggest_reconciliations')) || 0; } catch { /* La bandeja seguirá funcionando sin sugerencias. */ }
    state.modal = null;
    state.view = 'treasury';
    state.bankReviewView = 'pending';
    state.bankWorkFilter = 'all';
    state.bankReviewSearch = '';
    state.bankReviewDirection = 'all';
    toast(`${importedCount} nuevos · ${excludedCount} fuera del periodo · ${duplicateCount} duplicados · ${matchCount} facturas posibles.`);
    await loadAll();
  } catch (error) { toast(error.message, 'error'); }
}

async function saveBankImportPeriod(event) {
  event.preventDefault();
  const start = document.querySelector('#bank-manage-start')?.value;
  const end = document.querySelector('#bank-manage-end')?.value;
  const button = document.querySelector('button[form="bank-import-manage-form"]');
  if (button) button.disabled = true;
  try {
    const result = await rpc('accounting_set_bank_import_period', {
      p_import_batch: state.modal.batchId,
      p_start: start,
      p_end: end
    });
    state.modal = null;
    await loadAll();
    const reviewedText = Number(result?.reviewed_outside_count || 0)
      ? ` · ${result.reviewed_outside_count} revisados conservaron su historial`
      : '';
    toast(`${result.included_count} movimientos en uso · ${result.excluded_count} excluidos${reviewedText}.`);
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo guardar el periodo.', 'error');
  }
}

async function undoBankImport() {
  const batch = currentBankImportBatches().find(item => item.id === state.modal?.batchId);
  if (!batch?.canUndo) return;
  if (!window.confirm(`Se eliminarán ${batch.row_count} movimientos de “${batch.file_name}”. Podrás volver a importar el archivo. ¿Continuar?`)) return;
  const button = document.querySelector('#undo-bank-import');
  if (button) button.disabled = true;
  try {
    const result = await rpc('accounting_undo_bank_import', { p_import_batch: batch.id });
    state.modal = null;
    await loadAll();
    toast(`Importación deshecha: ${result.deleted_count} movimientos eliminados.`);
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo deshacer la importación.', 'error');
  }
}

async function generateTaxDraft(event) {
  event.preventDefault();
  try {
    await rpc('accounting_generate_tax_draft', {
      p_year: Number(document.querySelector('#tax-year').value),
      p_quarter: Number(document.querySelector('#tax-quarter')?.value || 1),
      p_model: state.modal.model
    });
    state.modal = null; toast('Borrador fiscal generado.'); await loadAll();
  } catch (error) { toast(error.message, 'error'); }
}

async function togglePeriod(id, currentStatus) {
  const next = currentStatus === 'locked' ? 'open' : 'locked';
  const { error } = await state.client.from('accounting_tax_periods').update({
    status: next,
    locked_at: next === 'locked' ? new Date().toISOString() : null
  }).eq('id', id);
  if (error) return toast(error.message, 'error');
  await state.client.from('accounting_audit_log').insert({
    business_id: state.business.id,
    event_type: next === 'locked' ? 'tax_period_locked' : 'tax_period_reopened',
    entity_type: 'tax_period',
    entity_id: id
  });
  toast(next === 'locked' ? 'Periodo bloqueado.' : 'Periodo reabierto.');
  await loadAll();
}

async function saveEntry(event) {
  event.preventDefault();
  const id = uuid(), amount = Number(document.querySelector('#entry-amount').value);
  const entry = {
    id, business_id: state.business.id, entry_date: document.querySelector('#entry-date').value,
    description: document.querySelector('#entry-description').value, source_type: 'manual',
    source_id: `manual-${id}`, status: 'draft', posted_at: null
  };
  const lines = [
    { business_id: state.business.id, entry_id: id, account_id: document.querySelector('#entry-debit-account').value, debit: amount, credit: 0 },
    { business_id: state.business.id, entry_id: id, account_id: document.querySelector('#entry-credit-account').value, debit: 0, credit: amount }
  ];
  const { error } = await state.client.from('accounting_journal_entries').insert(entry);
  if (error) return toast(error.message, 'error');
  const { error: lineError } = await state.client.from('accounting_journal_lines').insert(lines);
  if (lineError) return toast(lineError.message, 'error');
  const { error: postError } = await state.client.from('accounting_journal_entries')
    .update({ status: 'posted', posted_at: new Date().toISOString() }).eq('id', id);
  if (postError) return toast(postError.message, 'error');
  state.modal = null; await loadAll();
}

async function saveDriveSettings(event) {
  event.preventDefault();
  const sourceFolderId = folderId(document.querySelector('#drive-source-folder').value);
  if (!sourceFolderId) return toast('Indica o elige la carpeta con facturas.', 'error');
  if (sourceFolderId === state.driveSources[0]?.result_folder_id) return toast('La carpeta de facturas debe ser distinta del historial privado.', 'error');
  try {
    if (state.googleToken) await getDriveFolder(sourceFolderId);
    await rpc('accounting_set_drive_source_folder', { p_source_folder_id: sourceFolderId });
    toast('Carpeta de facturas guardada. El historial JSON no ha cambiado.');
    await loadAll();
    if (state.googleToken) await scanDriveInvoices();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function importSupplierJson(payload, resultFileId = '') {
  validateSupplierDocument(payload);
  const result = await rpc('accounting_import_supplier_document', {
    p_payload: payload,
    p_result_file_id: resultFileId
  });
  return typeof result === 'string' ? result : result?.status || 'imported';
}

async function importJsonFiles(files) {
  let imported = 0, duplicates = 0, errors = 0;
  for (const file of files) {
    let payload = null;
    try {
      payload = JSON.parse(await file.text());
      const result = await importSupplierJson(payload, file.name);
      if (result === 'duplicate') duplicates++; else imported++;
    } catch (error) {
      errors++;
      console.warn(`[Contabilidad] ${file.name}`, error);
      await recordDriveImportError(payload, { id: file.name, name: file.name }, error, payload ? 'pending' : 'error');
    }
  }
  toast(`${imported} importados · ${duplicates} duplicados · ${errors} con error`, errors ? 'error' : '');
  await loadAll();
}

async function recordDriveImportError(payload, resultFile, error, status = 'error') {
  try {
    await rpc('accounting_record_drive_import_error', {
      p_drive_file_id: payload?.drive_file_id || '',
      p_drive_revision: payload?.drive_revision || resultFile?.modifiedTime || '',
      p_checksum: payload?.checksum || resultFile?.md5Checksum || '',
      p_schema_version: payload?.schema_version || 'unknown',
      p_result_file_id: resultFile?.id || '',
      p_payload: payload || {},
      p_status: status,
      p_error_message: error?.message || String(error)
    });
  } catch (recordError) {
    console.warn('[Contabilidad] No se pudo registrar el error de Drive', recordError);
  }
}

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  const existing = document.querySelector('script[data-google-identity]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity.')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.dataset.googleIdentity = 'true';
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve; script.onerror = () => reject(new Error('No se pudo cargar Google Identity.'));
    document.head.appendChild(script);
  });
}

async function connectGoogle() {
  try {
    if (!googleClientId) throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID.');
    await loadGoogleIdentity();
    const response = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: tokenResponse => tokenResponse.error
          ? reject(new Error(tokenResponse.error_description || tokenResponse.error))
          : resolve(tokenResponse)
      });
      client.requestAccessToken({ prompt: 'select_account' });
    });
    state.googleToken = response.access_token;
    const about = await driveJson('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)');
    state.googleUser = about.user || null;
    toast('Google Drive autorizado para esta sesión.');
    await scanDriveInvoices();
  } catch (error) { toast(error.message, 'error'); }
}

function disconnectGoogle() {
  const token = state.googleToken;
  state.googleToken = '';
  state.googleUser = null;
  state.driveFiles = [];
  state.driveFolders = {};
  state.driveResultPrivacy = null;
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  toast('Google Drive desconectado de esta sesión.');
  renderApp();
}

async function driveFetch(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${state.googleToken}` } });
  if (response.status === 401) {
    state.googleToken = '';
    state.googleUser = null;
    throw new Error('La autorización de Google Drive ha caducado. Vuelve a autorizarla.');
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error?.message || ''; } catch { /* respuesta sin JSON */ }
    throw new Error(detail || `Google Drive respondió ${response.status}.`);
  }
  return response;
}

async function driveJson(url) {
  return (await driveFetch(url)).json();
}

async function listDriveFiles(folder, query = '') {
  const files = [];
  let pageToken = '';
  do {
    const filters = [`'${folder}' in parents`, 'trashed = false', query].filter(Boolean).join(' and ');
    const params = new URLSearchParams({
      q: filters,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,version,webViewLink)',
      pageSize: '1000',
      orderBy: 'modifiedTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await driveJson(`https://www.googleapis.com/drive/v3/files?${params}`);
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function listDriveFolders(parentId = 'root', sharedWithMe = false) {
  const files = [];
  let pageToken = '';
  do {
    const folderFilter = "mimeType = 'application/vnd.google-apps.folder'";
    const locationFilter = sharedWithMe ? 'sharedWithMe = true' : `'${parentId}' in parents`;
    const params = new URLSearchParams({
      q: `${locationFilter} and ${folderFilter} and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,parents,ownedByMe,shared,webViewLink)',
      pageSize: '1000',
      orderBy: 'name_natural',
      spaces: 'drive',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await driveJson(`https://www.googleapis.com/drive/v3/files?${params}`);
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function getDriveFolder(id) {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,modifiedTime,webViewLink,parents,ownedByMe,shared,owners(displayName,emailAddress),permissions(id,type,role,emailAddress,displayName,domain,allowFileDiscovery,deleted,permissionDetails)',
    supportsAllDrives: 'true'
  });
  const folder = await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${params}`);
  if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error(`${folder.name || id} no es una carpeta de Drive.`);
  return folder;
}

async function persistDriveResultPrivacy(privacy) {
  const source = state.driveSources[0];
  if (!source?.result_folder_id || !privacy) return;
  await rpc('accounting_verify_drive_result_folder', {
    p_result_folder_id: source.result_folder_id,
    p_privacy_status: privacy.status,
    p_owner_email: privacy.ownerEmail || state.googleUser?.emailAddress || ''
  });
  source.result_folder_privacy_status = privacy.status;
  source.result_folder_verified_at = new Date().toISOString();
  source.result_folder_owner_email = privacy.ownerEmail || state.googleUser?.emailAddress || '';
}

async function verifyDriveResultFolder() {
  const source = state.driveSources[0];
  if (!source?.result_folder_id) return toast('Primero fija la carpeta privada de resultados.', 'error');
  if (!state.googleToken) {
    await connectGoogle();
    if (!state.googleToken) return null;
  }
  state.driveBusy = true;
  renderApp();
  try {
    const folder = await getDriveFolder(source.result_folder_id);
    const privacy = resultFolderPrivacy(folder, state.googleUser?.emailAddress || '');
    state.driveFolders.result = folder;
    state.driveResultPrivacy = privacy;
    await persistDriveResultPrivacy(privacy);
    if (privacy.status === 'private') {
      toast('Carpeta de resultados comprobada: solo tú tienes acceso.');
    } else if (privacy.status === 'shared') {
      toast('La carpeta de resultados está compartida. Quita los accesos desde Google Drive antes de sincronizar.', 'error');
    } else {
      toast('No se pudo confirmar que la carpeta sea únicamente tuya.', 'error');
    }
    return privacy;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  } finally {
    state.driveBusy = false;
    renderApp();
  }
}

async function loadDrivePickerLocation(location = 'my-drive') {
  state.modal.location = location;
  state.modal.history = [];
  state.modal.loading = true;
  state.modal.error = '';
  state.modal.currentFolder = location === 'shared'
    ? { id: 'shared-with-me', name: 'Compartidas conmigo', pseudo: true }
    : null;
  renderApp();
  try {
    if (location === 'shared') {
      state.modal.folders = await listDriveFolders('root', true);
    } else {
      const [root, folders] = await Promise.all([getDriveFolder('root'), listDriveFolders('root')]);
      state.modal.currentFolder = root;
      state.modal.folders = folders;
    }
  } catch (error) {
    state.modal.error = error.message;
    state.modal.folders = [];
  } finally {
    state.modal.loading = false;
    renderApp();
  }
}

async function openDriveFolderPicker(purpose = 'source') {
  if (!state.googleToken) {
    await connectGoogle();
    if (!state.googleToken) return;
  }
  openModal({
    type: 'drive-folder-picker',
    purpose,
    location: 'my-drive',
    currentFolder: null,
    folders: [],
    history: [],
    loading: true,
    error: ''
  });
  await loadDrivePickerLocation('my-drive');
}

async function switchDrivePickerLocation(location) {
  if (!state.modal || state.modal.type !== 'drive-folder-picker') return;
  await loadDrivePickerLocation(location);
}

async function navigateDriveFolder(folderId) {
  if (!state.modal || state.modal.type !== 'drive-folder-picker') return;
  const selected = state.modal.folders.find(folder => folder.id === folderId);
  if (!selected) return;
  const previous = {
    currentFolder: state.modal.currentFolder,
    folders: state.modal.folders,
    location: state.modal.location
  };
  state.modal.history.push(previous);
  state.modal.loading = true;
  state.modal.error = '';
  renderApp();
  try {
    const [folder, folders] = await Promise.all([getDriveFolder(folderId), listDriveFolders(folderId)]);
    state.modal.currentFolder = folder;
    state.modal.folders = folders;
  } catch (error) {
    state.modal.error = error.message;
    state.modal.history.pop();
  } finally {
    state.modal.loading = false;
    renderApp();
  }
}

function navigateDriveFolderBack() {
  if (!state.modal?.history?.length) return;
  const previous = state.modal.history.pop();
  state.modal.currentFolder = previous.currentFolder;
  state.modal.folders = previous.folders;
  state.modal.location = previous.location;
  state.modal.error = '';
  renderApp();
}

async function selectCurrentDriveFolder() {
  const picker = state.modal;
  const folder = picker?.currentFolder;
  if (!picker || picker.type !== 'drive-folder-picker' || !folder?.id || folder.pseudo) return;
  const purpose = picker.purpose;
  try {
    if (purpose === 'result') {
      const privacy = resultFolderPrivacy(folder, state.googleUser?.emailAddress || '');
      if (privacy.status !== 'private') throw new Error('El historial debe ser una carpeta privada que pertenezca solo a tu cuenta.');
      await rpc('accounting_lock_drive_result_folder', {
        p_result_folder_id: folder.id,
        p_owner_email: privacy.ownerEmail || state.googleUser?.emailAddress || ''
      });
      state.driveResultPrivacy = privacy;
      toast('Carpeta privada de resultados fijada. Ya no se cambiará accidentalmente.');
    } else {
      await rpc('accounting_set_drive_source_folder', { p_source_folder_id: folder.id });
      toast(`Carpeta de facturas seleccionada: ${folder.name}.`);
    }
    state.modal = null;
    await loadAll();
    if (state.googleToken) await scanDriveInvoices();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function scanDriveInvoices() {
  const source = state.driveSources[0];
  if (!source?.source_folder_id || !source?.result_folder_id) return toast('Configura las carpetas de Drive.', 'error');
  if (!state.googleToken) return connectGoogle();
  state.driveBusy = true;
  renderApp();
  try {
    const [sourceFolder, resultFolder, files] = await Promise.all([
      getDriveFolder(source.source_folder_id),
      getDriveFolder(source.result_folder_id),
      listDriveFiles(source.source_folder_id)
    ]);
    if (sourceFolder.id === resultFolder.id) throw new Error('Origen e historial deben ser carpetas distintas.');
    state.driveFolders = { source: sourceFolder, result: resultFolder };
    state.driveResultPrivacy = resultFolderPrivacy(resultFolder, state.googleUser?.emailAddress || '');
    await persistDriveResultPrivacy(state.driveResultPrivacy);
    state.driveFiles = files.filter(isSupportedInvoiceFile);
    const privacyWarning = state.driveResultPrivacy.status === 'private'
      ? ''
      : ' · el historial JSON no está confirmado como privado';
    toast(`${state.driveFiles.length} facturas encontradas · ${state.driveFiles.filter(file => driveImportStatus(file.id, state.driveImports) === 'unprocessed').length} pendientes${privacyWarning}.`, privacyWarning ? 'error' : '');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.driveBusy = false;
    renderApp();
  }
}

async function syncGoogleDrive() {
  if (!state.driveSources[0]?.result_folder_id) return toast('Configura la carpeta de resultados.', 'error');
  if (!state.googleToken) {
    await connectGoogle();
    if (state.googleToken) return syncGoogleDrive();
    return;
  }
  state.driveBusy = true;
  renderApp();
  try {
    const folder = state.driveSources[0].result_folder_id;
    const resultFolder = await getDriveFolder(folder);
    const privacy = resultFolderPrivacy(resultFolder, state.googleUser?.emailAddress || '');
    state.driveFolders.result = resultFolder;
    state.driveResultPrivacy = privacy;
    await persistDriveResultPrivacy(privacy);
    if (privacy.status !== 'private') {
      throw new Error('No se sincronizarán JSON hasta confirmar que la carpeta de resultados es privada y pertenece solo a ti.');
    }
    const resultFiles = await listDriveFiles(folder);
    const jsonFiles = resultFiles.filter(file => file.mimeType === 'application/json' || /\.json$/i.test(file.name || ''));
    const registeredResultIds = new Set(state.driveImports.map(item => item.source_file_id).filter(Boolean));
    let imported = 0, duplicates = 0, errors = 0;
    for (const file of jsonFiles.filter(item => !registeredResultIds.has(item.id))) {
      let payload = null;
      try {
        payload = await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
        payload.drive_revision ||= file.modifiedTime;
        payload.checksum ||= file.md5Checksum;
        payload.source_file_id ||= file.id;
        const result = await importSupplierJson(payload, file.id);
        result === 'duplicate' ? duplicates++ : imported++;
      } catch (error) {
        errors++;
        console.warn(`[Drive] ${file.name}`, error);
        await recordDriveImportError(payload, file, error, payload ? 'pending' : 'error');
      }
    }
    await state.client.from('accounting_drive_sources').update({ last_sync_at: new Date().toISOString() }).eq('id', state.driveSources[0].id);
    await loadAll();
    await scanDriveInvoices();
    toast(`${imported} nuevos · ${duplicates} duplicados · ${errors} errores`, errors ? 'error' : '');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.driveBusy = false;
    renderApp();
  }
}

async function saveBusiness(event) {
  event.preventDefault();
  const { error } = await state.client.from('accounting_businesses').update({
    name: document.querySelector('#business-name').value,
    legal_name: document.querySelector('#business-legal-name').value,
    nif: document.querySelector('#business-nif').value,
    accounting_regime: document.querySelector('#business-regime').value,
    updated_at: new Date().toISOString()
  }).eq('id', state.business.id);
  if (error) return toast(error.message, 'error');
  toast('Perfil fiscal guardado.'); await loadAll();
}

function downloadCsv(name, rows) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = name; link.click(); URL.revokeObjectURL(link.href);
}

function exportTaxCsv() {
  downloadCsv('borradores-fiscales.csv', [
    ['Modelo','Año','Trimestre','Base ventas','IGIC repercutido','Base compras','IGIC soportado','Resultado'],
    ...state.taxDrafts.map(d => [d.model,d.accounting_tax_periods?.year,d.accounting_tax_periods?.quarter || '',
      d.totals?.sales_base,d.totals?.igic_output,d.totals?.purchases_base,d.totals?.igic_input,d.totals?.net_result])
  ]);
}

async function logout() {
  try { if (state.client) await rpc('accounting_revoke_current_session'); } catch { /* revocación local */ }
  localStorage.removeItem(DEVICE_KEY);
  clearSession();
  renderPairing();
}

function renderBankWorkspacePreview() {
  state.business = { id: 'preview-business', name: 'Esencia Café' };
  state.view = 'treasury';
  state.bankAccounts = [{ id: 'bank-main', name: 'BBVA principal', iban_last4: '1842' }];
  state.bankImports = [{
    id: 'preview-batch', bank_account_id: 'bank-main', file_name: 'BBVA mayo-julio.xlsx',
    detected_start_on: '2026-05-25', detected_end_on: '2026-08-08',
    selected_start_on: '2026-07-01', selected_end_on: '2026-09-30',
    row_count: 6, excluded_count: 1, status: 'partially_excluded', created_at: new Date().toISOString()
  }];
  state.documents = [
    { id: 'invoice-ready', direction: 'purchase', status: 'approved', number: 'F-2026-184', issue_date: '2026-08-07', total_amount: 259.2, paid_amount: 0, accounting_contacts: { name: 'Proveedor Atlántico' } },
    { id: 'invoice-possible', direction: 'purchase', status: 'approved', number: 'A-8841', issue_date: '2026-08-05', total_amount: 80, paid_amount: 0, accounting_contacts: { name: 'Suministros Canarias' } }
  ];
  state.bankTransactions = [
    { id: 'bank-ready', bank_account_id: 'bank-main', status: 'pending', booked_on: '2026-08-08', value_on: '2026-08-08', amount: -259.2, balance: 10240.8, description: 'TRANSFERENCIA PROVEEDOR ATLANTICO', reference: 'F-2026-184' },
    { id: 'bank-possible', bank_account_id: 'bank-main', status: 'pending', booked_on: '2026-08-07', value_on: '2026-08-07', amount: -80, balance: 10500, description: 'SUMINISTROS CANARIAS', reference: 'PAGO TARJETA' },
    { id: 'bank-missing', bank_account_id: 'bank-main', status: 'pending', booked_on: '2026-08-06', value_on: '2026-08-06', amount: -45.3, balance: 10580, description: 'COMPRA MATERIAL LOCAL', reference: 'TARJETA 4832' },
    { id: 'bank-square', bank_account_id: 'bank-main', status: 'pending', booked_on: '2026-08-05', value_on: '2026-08-05', amount: 640.5, balance: 10625.3, description: 'LIQUIDACION REMESA DE COMERCIOS', reference: 'SQUARE' },
    { id: 'bank-done', bank_account_id: 'bank-main', status: 'matched', booked_on: '2026-08-04', value_on: '2026-08-04', amount: -2.82, balance: 9984.8, description: 'COMISION SERVICIO BANCARIO', reference: '' },
    { id: 'bank-june', bank_account_id: 'bank-main', status: 'pending', booked_on: '2026-06-20', value_on: '2026-06-20', amount: -32.5, balance: 9900, description: 'MOVIMIENTO ANTIGUO', reference: '', review_scope: 'excluded' }
  ].map(item => ({ ...item, import_batch: 'preview-batch', review_scope: item.review_scope || 'included' }));
  state.reconciliations = [{ id: 'match-ready', bank_transaction_id: 'bank-ready', document_id: 'invoice-ready', amount: 259.2, status: 'suggested', score: 98, reason: 'Importe, fecha y referencia compatibles' }];
  state.bankReviews = [
    { id: 'review-missing', bank_transaction_id: 'bank-missing', classification: 'awaiting_document', status: 'waiting_document', notes: 'Pedir factura al proveedor', revision: 1, reviewed_at: new Date().toISOString() },
    { id: 'review-done', bank_transaction_id: 'bank-done', classification: 'bank_fee', status: 'active', notes: '', revision: 1, reviewed_at: new Date().toISOString() }
  ];
  renderApp();
}

if (import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === 'bank-workspace') {
  renderBankWorkspacePreview();
} else {
  resumeOrPair().catch(error => {
    console.error(error);
    clearSession();
    renderPairing();
    toast(error.message, 'error');
  });
}
