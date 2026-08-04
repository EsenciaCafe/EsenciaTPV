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
  GOOGLE_DRIVE_SCOPE,
  driveFileUrl,
  driveFolderUrl,
  driveImportStatus,
  driveReviewStatus,
  folderId,
  isSupportedInvoiceFile,
  reviewableSupplierDocument,
  validateSupplierDocument
} from './driveInvoices.js';

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
  token: '',
  client: null,
  business: null,
  documents: [],
  contacts: [],
  bankAccounts: [],
  bankTransactions: [],
  reconciliations: [],
  journalEntries: [],
  journalLines: [],
  accounts: [],
  taxDrafts: [],
  taxPeriods: [],
  driveSources: [],
  driveImports: [],
  profitabilityAnalyses: [],
  driveFiles: [],
  driveFolders: {},
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
    query('accounting_reconciliations', '*, bookkeeping_documents(number,direction,total_amount), accounting_bank_transactions(booked_on,description,amount)', { column: 'created_at', ascending: false }),
    query('accounting_accounts', '*', { column: 'code', ascending: true }),
    query('accounting_journal_entries', '*', { column: 'entry_date', ascending: false }).limit(300),
    query('accounting_journal_lines'),
    query('accounting_tax_drafts', '*, accounting_tax_periods(year,quarter,starts_on,ends_on)', { column: 'generated_at', ascending: false }),
    query('accounting_tax_periods', '*', { column: 'starts_on', ascending: false }),
    query('accounting_drive_sources').limit(1),
    query('accounting_drive_imports', '*, bookkeeping_documents(number,status,total_amount,accounting_contacts(name))', { column: 'created_at', ascending: false }).limit(500),
    query('accounting_document_analysis')
  ]);
  const failed = results.find(result => result.error);
  if (failed) throw failed.error;
  [
    state.business, state.documents, state.contacts, state.bankAccounts,
    state.bankTransactions, state.reconciliations, state.accounts, state.journalEntries, state.journalLines,
    state.taxDrafts, state.taxPeriods, state.driveSources, state.driveImports, state.profitabilityAnalyses
  ] = [
    results[0].data?.[0] || null, results[1].data || [], results[2].data || [],
    results[3].data || [], results[4].data || [], results[5].data || [],
    results[6].data || [], results[7].data || [], results[8].data || [],
    results[9].data || [], results[10].data || [], results[11].data || [], results[12].data || [],
    results[13].data || []
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
    <div class="acc-grid acc-kpis">
      <div class="acc-kpi is-accent"><span>Ventas netas</span><strong>${money(snapshot.current.salesBase)}</strong>${variationMarkup(snapshot.changes.sales)}<small>Sin IGIC · ${snapshot.current.salesCount} documentos</small></div>
      <div class="acc-kpi"><span>Compras y gastos</span><strong>${money(snapshot.current.expensesBase)}</strong>${variationMarkup(snapshot.changes.expenses, { neutral: true })}<small>Sin IGIC · solo aprobados</small></div>
      <div class="acc-kpi ${snapshot.current.result < 0 ? 'is-danger' : ''}"><span>${missingCurrentCosts ? 'Resultado todavía incompleto' : 'Resultado del negocio'}</span><strong>${money(snapshot.current.result)}</strong>${missingCurrentCosts ? '<span class="metric-change is-neutral">Faltan gastos aprobados</span>' : variationMarkup(snapshot.changes.result)}<small>${missingCurrentCosts ? 'No es beneficio real todavía' : 'Antes de IRPF'}</small><button class="kpi-link" data-view="profitability">Entender la rentabilidad →</button></div>
      <div class="acc-kpi"><span>Margen sobre ventas</span><strong>${missingCurrentCosts ? '—' : `${percent(snapshot.current.margin)} %`}</strong><small>${missingCurrentCosts ? 'Se calculará cuando haya gastos' : snapshot.current.averageTicket == null ? 'Sin tickets TPV en el periodo' : `Ticket medio ${money(snapshot.current.averageTicket)}`}</small></div>
    </div>
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

function renderTreasury() {
  const pending = state.bankTransactions.filter(tx => tx.status === 'pending').length;
  const balance = state.bankTransactions.find(tx => tx.balance != null)?.balance || 0;
  const filteredReconciliations = reconciliationsByStatus(state.reconciliations, state.reconciliationFilter);
  const reconciliationCounts = Object.fromEntries(
    ['suggested', 'confirmed', 'rejected'].map(status => [status, reconciliationsByStatus(state.reconciliations, status).length])
  );
  return `
    <div class="acc-grid acc-kpis">
      <div class="acc-kpi is-accent"><span>Último saldo importado</span><strong>${money(balance)}</strong></div>
      <div class="acc-kpi"><span>Sin conciliar</span><strong>${pending}</strong></div>
      <div class="acc-kpi"><span>Cuentas bancarias</span><strong>${state.bankAccounts.length}</strong></div>
      <div class="acc-kpi"><span>Movimientos</span><strong>${state.bankTransactions.length}</strong></div>
    </div>
    <section class="acc-card reconciliation-section">
      <div class="acc-card-head reconciliation-head">
        <div><h2>Conciliación asistida</h2><small>Comprueba banco, documento y factura original antes de confirmar.</small></div>
        <div class="acc-actions"><button class="btn btn-small" id="suggest-matches-btn">Buscar coincidencias</button><button class="btn btn-small" id="new-bank-account-btn">Añadir cuenta</button></div>
      </div>
      <div class="reconciliation-toolbar period-switch">
        <button class="btn btn-small ${state.reconciliationFilter === 'suggested' ? 'is-active' : ''}" data-reconciliation-filter="suggested">Pendientes ${reconciliationCounts.suggested}</button>
        <button class="btn btn-small ${state.reconciliationFilter === 'confirmed' ? 'is-active' : ''}" data-reconciliation-filter="confirmed">Confirmadas ${reconciliationCounts.confirmed}</button>
        <button class="btn btn-small ${state.reconciliationFilter === 'rejected' ? 'is-active' : ''}" data-reconciliation-filter="rejected">Descartadas ${reconciliationCounts.rejected}</button>
      </div>
      ${filteredReconciliations.length
        ? `<div class="reconciliation-list">${filteredReconciliations.map(renderReconciliationCard).join('')}</div>`
        : `<div class="acc-empty"><strong>${state.reconciliationFilter === 'suggested' ? 'Sin propuestas pendientes' : 'No hay conciliaciones en este estado'}</strong>${state.reconciliationFilter === 'suggested' ? 'Pulsa Buscar coincidencias cuando hayas importado movimientos.' : 'Puedes cambiar de pestaña para revisar el historial.'}</div>`}
    </section>
    <section class="acc-card bank-movements-card" style="margin-top:18px">
      <details>
        <summary><span><strong>Movimientos bancarios</strong><small>${state.bankTransactions.length} movimientos · ${pending} sin conciliar</small></span><span>Mostrar listado</span></summary>
        ${state.bankTransactions.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th>Estado</th><th class="num">Importe</th><th class="num">Saldo</th></tr></thead><tbody>
          ${state.bankTransactions.slice(0, 50).map(tx => `<tr><td>${displayDate(tx.booked_on)}</td><td>${escapeHtml(tx.description)}</td><td>${escapeHtml(tx.reference)}</td><td>${statusBadge(tx.status === 'matched' ? 'paid' : 'needs_review')}</td><td class="num">${money(tx.amount)}</td><td class="num">${tx.balance == null ? '—' : money(tx.balance)}</td></tr>`).join('')}
        </tbody></table>${state.bankTransactions.length > 50 ? '<div class="bank-list-note">Se muestran los 50 movimientos más recientes.</div>' : ''}</div>` : '<div class="acc-empty"><strong>Importa tu primer extracto</strong>Compatible con CSV y la primera hoja de XLSX.</div>'}
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
  return `
    <div class="acc-grid acc-kpis drive-kpis">
      <div class="acc-kpi"><span>Conexión</span><strong>${state.googleToken ? 'Activa' : 'Pendiente'}</strong><small>${escapeHtml(state.googleToken ? connectedLabel : googleClientId ? 'Autoriza tu cuenta de Google' : 'Falta el cliente OAuth')}</small></div>
      <div class="acc-kpi"><span>Facturas encontradas</span><strong>${state.driveFiles.length || '—'}</strong><small>${state.driveFiles.length ? `${pending} pendientes de análisis` : 'Pulsa Buscar facturas'}</small></div>
      <div class="acc-kpi"><span>Análisis registrados</span><strong>${state.driveImports.length}</strong><small>${reviewed} revisadas pendientes de aprobar · ${needsCorrection} por corregir</small></div>
    </div>
    <div class="acc-grid acc-two">
      <section class="acc-card">
        <div class="acc-card-head"><h2>Carpetas supervisadas</h2>${state.googleToken ? '<span class="badge">Verificadas con Drive</span>' : ''}</div>
        <div class="acc-card-body">
          <form class="acc-form" id="drive-settings-form">
            <div class="field"><label>ID o URL de la carpeta con facturas</label><input id="drive-source-folder" value="${escapeHtml(source.source_folder_id || '')}" placeholder="https://drive.google.com/drive/folders/..."></div>
            <div class="field"><label>ID o URL de la carpeta fija de resultados JSON</label><input id="drive-result-folder" value="${escapeHtml(source.result_folder_id || '')}" placeholder="https://drive.google.com/drive/folders/..."></div>
            <div class="drive-folder-summary">
              <div><span>Origen</span><strong>${escapeHtml(sourceFolder?.name || 'Facturas')}</strong>${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer">Abrir ↗</a>` : ''}</div>
              <div><span>Historial</span><strong>${escapeHtml(resultFolder?.name || 'JSON de resultados')}</strong>${resultUrl ? `<a href="${resultUrl}" target="_blank" rel="noreferrer">Abrir ↗</a>` : ''}</div>
            </div>
            <button class="btn btn-primary" type="submit">Guardar y comprobar</button>
          </form>
        </div>
      </section>
      <section class="acc-card">
        <div class="acc-card-head"><h2>Conexión y análisis</h2></div>
        <div class="acc-card-body acc-form">
          <p>Codex analiza los originales bajo demanda y guarda resultados <strong>supplier-document/v1</strong>. La app valida cada suma y siempre lo deja pendiente de revisión humana.</p>
          ${googleClientId
            ? `<div class="acc-actions"><button class="btn" id="google-connect-btn">${state.googleToken ? 'Renovar autorización' : 'Autorizar Google Drive'}</button>${state.googleToken ? '<button class="btn" id="google-disconnect-btn">Desconectar</button>' : ''}</div>`
            : '<div class="acc-notice"><strong>OAuth preparado, falta activar la credencial.</strong><br>Crea un cliente web de Google con origen <code>https://esenciacafe.github.io</code> y guarda su ID en la variable <code>VITE_GOOGLE_CLIENT_ID</code> de GitHub Actions.</div>'}
          <div class="acc-actions">
            <button class="btn" id="scan-drive-inline-btn" ${state.driveBusy ? 'disabled' : ''}>${state.driveBusy ? 'Buscando…' : 'Buscar facturas'}</button>
            <button class="btn btn-primary" id="sync-drive-btn" ${state.driveBusy ? 'disabled' : ''}>Sincronizar análisis</button>
          </div>
          <label class="btn" style="display:grid;place-items:center"><input class="hidden" type="file" id="json-files-input" accept=".json,application/json" multiple>Importar JSON manualmente</label>
        </div>
      </section>
    </div>
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
  if (state.modal.type === 'reconciliation') return renderReconciliationModal();
  if (state.modal.type === 'bank-import') return renderBankImportModal();
  if (state.modal.type === 'bank-account') return renderBankAccountModal();
  if (state.modal.type === 'tax') return renderTaxModal(state.modal.model);
  if (state.modal.type === 'entry') return renderEntryModal();
  return '';
}

function modalFrame(title, body, foot = '', className = '') {
  return `<div class="acc-modal-backdrop"><div class="acc-modal ${className}"><div class="acc-modal-head"><h2>${title}</h2><button class="btn btn-small" data-close-modal>✕</button></div><div class="acc-modal-body">${body}</div>${foot ? `<div class="acc-modal-foot">${foot}</div>` : ''}</div></div>`;
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
  return modalFrame('Importar extracto bancario', `
    <form class="acc-form" id="bank-import-form">
      <div class="field"><label>Cuenta bancaria</label><select id="bank-account-select" required><option value="">Seleccionar</option>${state.bankAccounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Archivo CSV o XLSX</label><input type="file" id="bank-file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div>
      <div class="acc-notice">Columnas reconocidas: fecha, fecha valor, concepto/descripción, referencia, importe, saldo. También se admite Debe/Haber.</div>
    </form>`, '<button class="btn btn-primary" type="submit" form="bank-import-form">Importar</button>');
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
  document.querySelector('#new-bank-account-btn')?.addEventListener('click', () => openModal({ type: 'bank-account' }));
  document.querySelector('#suggest-matches-btn')?.addEventListener('click', suggestMatches);
  document.querySelectorAll('[data-reconciliation-filter]').forEach(button => button.addEventListener('click', () => {
    state.reconciliationFilter = button.dataset.reconciliationFilter;
    renderApp();
  }));
  document.querySelectorAll('[data-review-reconciliation]').forEach(button => button.addEventListener('click', () => openReconciliation(button.dataset.reviewReconciliation)));
  document.querySelectorAll('[data-reject-match]').forEach(button => button.addEventListener('click', () => updateMatch(button.dataset.rejectMatch, 'reject', button)));
  document.querySelectorAll('[data-reopen-match]').forEach(button => button.addEventListener('click', () => updateMatch(button.dataset.reopenMatch, 'reopen', button)));
  document.querySelector('#new-entry-btn')?.addEventListener('click', () => openModal({ type: 'entry' }));
  document.querySelectorAll('[data-tax-model]').forEach(button => button.addEventListener('click', () => openModal({ type: 'tax', model: button.dataset.taxModel })));
  document.querySelector('#export-tax-btn')?.addEventListener('click', exportTaxCsv);
  document.querySelector('#print-tax-btn')?.addEventListener('click', () => window.print());
  document.querySelectorAll('[data-toggle-period]').forEach(button => button.addEventListener('click', () => togglePeriod(button.dataset.togglePeriod, button.dataset.status)));
  document.querySelector('#drive-settings-form')?.addEventListener('submit', saveDriveSettings);
  document.querySelector('#json-files-input')?.addEventListener('change', event => importJsonFiles([...event.target.files]));
  document.querySelector('#google-connect-btn')?.addEventListener('click', connectGoogle);
  document.querySelector('#google-disconnect-btn')?.addEventListener('click', disconnectGoogle);
  document.querySelector('#scan-drive-btn')?.addEventListener('click', scanDriveInvoices);
  document.querySelector('#scan-drive-inline-btn')?.addEventListener('click', scanDriveInvoices);
  document.querySelector('#sync-drive-btn')?.addEventListener('click', syncGoogleDrive);
  document.querySelector('#business-form')?.addEventListener('submit', saveBusiness);
  document.querySelector('#revoke-device-btn')?.addEventListener('click', logout);
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
  document.querySelector('#bank-account-form')?.addEventListener('submit', saveBankAccount);
  document.querySelector('#tax-form')?.addEventListener('submit', generateTaxDraft);
  document.querySelector('#entry-form')?.addEventListener('submit', saveEntry);
  document.querySelector('#reconciliation-reviewed')?.addEventListener('change', event => {
    const confirmButton = document.querySelector('#confirm-reconciliation-btn');
    if (confirmButton) confirmButton.disabled = !event.currentTarget.checked;
  });
  document.querySelectorAll('[data-match-action]').forEach(button => button.addEventListener('click', () => {
    updateMatch(button.dataset.matchId, button.dataset.matchAction, button);
  }));
}

function openModal(modal) { state.modal = modal; renderApp(); }
function closeModal() { state.modal = null; renderApp(); }

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
    if (keepModalOpen) await openReconciliation(id);
    toast(messages[action] || 'Conciliación actualizada.');
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message || 'No se pudo actualizar la conciliación.', 'error');
  }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function importBankFile(event) {
  event.preventDefault();
  try {
    const file = document.querySelector('#bank-file').files[0];
    const rows = file.name.toLowerCase().endsWith('.xlsx')
      ? parseXlsx(await file.arrayBuffer())
      : parseCsv(await file.text());
    const mapped = mapBankRows(rows);
    const accountId = document.querySelector('#bank-account-select').value;
    const batch = uuid();
    const payload = [];
    for (const item of mapped) {
      payload.push({
        ...item, business_id: state.business.id, bank_account_id: accountId,
        fingerprint: await sha256([accountId,item.booked_on,item.amount,item.description,item.reference].join('|')),
        import_batch: batch, raw_payload: item
      });
    }
    const { data, error } = await state.client.from('accounting_bank_transactions')
      .upsert(payload, { onConflict: 'business_id,fingerprint', ignoreDuplicates: true }).select();
    if (error) throw error;
    state.modal = null; toast(`${data?.length || 0} movimientos nuevos importados.`); await loadAll();
  } catch (error) { toast(error.message, 'error'); }
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
  const resultFolderId = folderId(document.querySelector('#drive-result-folder').value);
  if (!sourceFolderId || !resultFolderId) return toast('Indica las dos carpetas de Drive.', 'error');
  if (sourceFolderId === resultFolderId) return toast('La carpeta de resultados debe ser distinta de la carpeta con facturas.', 'error');
  const row = {
    business_id: state.business.id,
    source_folder_id: sourceFolderId,
    result_folder_id: resultFolderId,
    updated_at: new Date().toISOString()
  };
  const request = state.driveSources[0]
    ? state.client.from('accounting_drive_sources').update(row).eq('id', state.driveSources[0].id)
    : state.client.from('accounting_drive_sources').insert(row);
  const { error } = await request;
  if (error) return toast(error.message, 'error');
  toast('Carpetas guardadas.');
  await loadAll();
  if (state.googleToken) await scanDriveInvoices();
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

async function getDriveFolder(id) {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,modifiedTime,webViewLink',
    supportsAllDrives: 'true'
  });
  const folder = await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${params}`);
  if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error(`${folder.name || id} no es una carpeta de Drive.`);
  return folder;
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
    state.driveFiles = files.filter(isSupportedInvoiceFile);
    toast(`${state.driveFiles.length} facturas encontradas · ${state.driveFiles.filter(file => driveImportStatus(file.id, state.driveImports) === 'unprocessed').length} pendientes.`);
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

resumeOrPair().catch(error => {
  console.error(error);
  clearSession();
  renderPairing();
  toast(error.message, 'error');
});
