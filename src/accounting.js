import { createClient } from '@supabase/supabase-js';
import { mapBankRows, parseCsv, parseXlsx } from './bankStatement.js';
import {
  IGIC_RATES,
  calculateDocumentTotals,
  calculatePriceVariation,
  emptyDocumentLine
} from './documentLines.js';
import {
  GOOGLE_DRIVE_SCOPE,
  driveFileUrl,
  driveFolderUrl,
  driveImportStatus,
  folderId,
  isSupportedInvoiceFile,
  reviewableSupplierDocument,
  validateSupplierDocument
} from './driveInvoices.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const appRoot = document.querySelector('#accounting-app');
const baseClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const SESSION_KEY = 'accounting-session-v1';
const DEVICE_KEY = 'accounting-device-v1';
const VIEW_LABELS = {
  dashboard: 'Resumen',
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
    auth: { persistSession: false }
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
    query('accounting_drive_imports', '*, bookkeeping_documents(number,status,total_amount)', { column: 'created_at', ascending: false }).limit(500)
  ]);
  const failed = results.find(result => result.error);
  if (failed) throw failed.error;
  [
    state.business, state.documents, state.contacts, state.bankAccounts,
    state.bankTransactions, state.reconciliations, state.accounts, state.journalEntries, state.journalLines,
    state.taxDrafts, state.taxPeriods, state.driveSources, state.driveImports
  ] = [
    results[0].data?.[0] || null, results[1].data || [], results[2].data || [],
    results[3].data || [], results[4].data || [], results[5].data || [],
    results[6].data || [], results[7].data || [], results[8].data || [],
    results[9].data || [], results[10].data || [], results[11].data || [], results[12].data || []
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

function dashboardStats() {
  const year = new Date().getFullYear();
  const approved = state.documents.filter(doc => Number(String(doc.issue_date).slice(0,4)) === year && !['draft','voided'].includes(doc.status));
  const sales = approved.filter(doc => doc.direction === 'sale').reduce((sum, doc) => sum + Number(doc.total_amount), 0);
  const expenses = approved.filter(doc => doc.direction === 'purchase').reduce((sum, doc) => sum + Number(doc.subtotal), 0);
  const outputTax = approved.filter(doc => doc.direction === 'sale').reduce((sum, doc) => sum + Number(doc.tax_amount), 0);
  const inputTax = approved.filter(doc => doc.direction === 'purchase').reduce((sum, doc) => sum + Number(doc.tax_amount), 0);
  return { sales, expenses, profit: sales - expenses, tax: outputTax - inputTax };
}

function renderDashboard() {
  const stats = dashboardStats();
  const recent = state.documents.slice(0, 8);
  const months = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - index));
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const value = state.documents.filter(doc => doc.direction === 'sale' && String(doc.issue_date).startsWith(key))
      .reduce((sum, doc) => sum + Number(doc.total_amount), 0);
    return { label: d.toLocaleDateString('es-ES',{month:'short'}), value };
  });
  const max = Math.max(...months.map(item => item.value), 1);
  return `
    <div class="acc-grid acc-kpis">
      <div class="acc-kpi is-accent"><span>Ventas del ejercicio</span><strong>${money(stats.sales)}</strong><small>Facturas y TPV</small></div>
      <div class="acc-kpi"><span>Gastos deducibles</span><strong>${money(stats.expenses)}</strong><small>Base aprobada</small></div>
      <div class="acc-kpi"><span>Resultado estimado</span><strong>${money(stats.profit)}</strong><small>Antes de IRPF</small></div>
      <div class="acc-kpi"><span>IGIC estimado</span><strong>${money(stats.tax)}</strong><small>Repercutido − soportado</small></div>
    </div>
    <div class="acc-grid acc-two">
      <section class="acc-card">
        <div class="acc-card-head"><h2>Facturación últimos 6 meses</h2></div>
        <div class="acc-card-body"><div class="chart-bars">${months.map(item => `<div class="chart-bar" title="${money(item.value)}"><i style="height:${Math.max(2,(item.value/max)*160)}px"></i><span>${item.label}</span></div>`).join('')}</div></div>
      </section>
      <section class="acc-card">
        <div class="acc-card-head"><h2>Atención</h2></div>
        <div class="acc-card-body acc-form">
          <div><strong>${state.documents.filter(doc => doc.status === 'needs_review').length}</strong><br><small>documentos pendientes de revisión</small></div>
          <div><strong>${state.bankTransactions.filter(tx => tx.status === 'pending').length}</strong><br><small>movimientos sin conciliar</small></div>
          <div><strong>${state.documents.filter(doc => ['overdue','partially_paid'].includes(doc.status)).length}</strong><br><small>cobros o pagos pendientes</small></div>
        </div>
      </section>
    </div>
    <section class="acc-card" style="margin-top:18px">
      <div class="acc-card-head"><h2>Actividad reciente</h2></div>
      ${renderDocumentTable(recent)}
    </section>`;
}

const STATUS_LABELS = {
  draft: 'Borrador', needs_review: 'Revisar', approved: 'Aprobada',
  partially_paid: 'Pago parcial', paid: 'Pagada', overdue: 'Vencida',
  voided: 'Anulada', rectified: 'Rectificada', unprocessed: 'Pendiente de análisis',
  pending: 'Revisar', imported: 'Importado', duplicate: 'Duplicado',
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

function renderTreasury() {
  const pending = state.bankTransactions.filter(tx => tx.status === 'pending').length;
  const balance = state.bankTransactions.find(tx => tx.balance != null)?.balance || 0;
  return `
    <div class="acc-grid acc-kpis">
      <div class="acc-kpi is-accent"><span>Último saldo importado</span><strong>${money(balance)}</strong></div>
      <div class="acc-kpi"><span>Sin conciliar</span><strong>${pending}</strong></div>
      <div class="acc-kpi"><span>Cuentas bancarias</span><strong>${state.bankAccounts.length}</strong></div>
      <div class="acc-kpi"><span>Movimientos</span><strong>${state.bankTransactions.length}</strong></div>
    </div>
    <section class="acc-card">
      <div class="acc-card-head"><h2>Movimientos bancarios</h2><div class="acc-actions"><button class="btn btn-small" id="suggest-matches-btn">Buscar coincidencias</button><button class="btn btn-small" id="new-bank-account-btn">Añadir cuenta</button></div></div>
      ${state.bankTransactions.length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th>Estado</th><th class="num">Importe</th><th class="num">Saldo</th></tr></thead><tbody>
        ${state.bankTransactions.map(tx => `<tr><td>${new Date(`${tx.booked_on}T12:00:00`).toLocaleDateString('es-ES')}</td><td>${escapeHtml(tx.description)}</td><td>${escapeHtml(tx.reference)}</td><td>${statusBadge(tx.status === 'matched' ? 'paid' : 'needs_review')}</td><td class="num">${money(tx.amount)}</td><td class="num">${tx.balance == null ? '—' : money(tx.balance)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="acc-empty"><strong>Importa tu primer extracto</strong>Compatible con CSV y la primera hoja de XLSX.</div>'}
    </section>
    <section class="acc-card" style="margin-top:18px">
      <div class="acc-card-head"><h2>Conciliación asistida</h2></div>
      ${state.reconciliations.filter(item=>item.status==='suggested').length ? `<div class="acc-table-wrap"><table class="acc-table"><thead><tr><th>Banco</th><th>Documento</th><th>Motivo</th><th class="num">Importe</th><th></th></tr></thead><tbody>
        ${state.reconciliations.filter(item=>item.status==='suggested').map(item=>`<tr><td>${escapeHtml(item.accounting_bank_transactions?.description)}<br><small>${item.accounting_bank_transactions?.booked_on || ''}</small></td><td>${escapeHtml(item.bookkeeping_documents?.number || '')}</td><td>${escapeHtml(item.reason || '')} · ${Number(item.score)}%</td><td class="num">${money(item.amount)}</td><td><button class="btn btn-small btn-primary" data-confirm-match="${item.id}">Confirmar</button> <button class="btn btn-small" data-reject-match="${item.id}">Descartar</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="acc-empty"><strong>Sin propuestas</strong>Importa movimientos y busca coincidencias.</div>'}
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
  const connectedLabel = state.googleUser?.emailAddress || state.googleUser?.displayName || 'Google Drive conectado';
  const sourceUrl = driveFolderUrl(source.source_folder_id);
  const resultUrl = driveFolderUrl(source.result_folder_id);
  return `
    <div class="acc-grid acc-kpis drive-kpis">
      <div class="acc-kpi"><span>Conexión</span><strong>${state.googleToken ? 'Activa' : 'Pendiente'}</strong><small>${escapeHtml(state.googleToken ? connectedLabel : googleClientId ? 'Autoriza tu cuenta de Google' : 'Falta el cliente OAuth')}</small></div>
      <div class="acc-kpi"><span>Facturas encontradas</span><strong>${state.driveFiles.length || '—'}</strong><small>${state.driveFiles.length ? `${pending} pendientes de análisis` : 'Pulsa Buscar facturas'}</small></div>
      <div class="acc-kpi"><span>Análisis registrados</span><strong>${state.driveImports.length}</strong><small>${state.documents.filter(doc => doc.source_type === 'drive_json' && doc.status === 'needs_review').length} esperando revisión humana</small></div>
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
          const reviewStatus = item.status === 'pending' && item.error_message ? 'needs_correction' : item.status;
          const reviewButton = item.document_id
            ? `<button class="btn btn-small" data-edit-document="${item.document_id}">Revisar</button>`
            : item.status === 'pending'
              ? `<button class="btn btn-small btn-primary" data-review-drive-import="${item.id}">Revisar</button>`
              : '';
          return `<tr><td><strong>${escapeHtml(reviewPayload.supplier?.name || 'Resultado sin proveedor')}</strong><br><small>${escapeHtml(reviewPayload.invoice?.number || item.drive_file_id)}</small></td><td>${statusBadge(reviewStatus)}${item.error_message ? `<br><small class="drive-error">${escapeHtml(item.error_message)}</small>` : ''}</td><td class="num">${reviewPayload.totals?.total != null ? money(reviewPayload.totals.total) : document?.total_amount != null ? money(document.total_amount) : '—'}</td><td>${item.processed_at ? new Date(item.processed_at).toLocaleString('es-ES') : new Date(item.created_at).toLocaleString('es-ES')}</td><td>${reviewButton}</td></tr>`;
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
  if (state.modal.type === 'bank-import') return renderBankImportModal();
  if (state.modal.type === 'bank-account') return renderBankAccountModal();
  if (state.modal.type === 'tax') return renderTaxModal(state.modal.model);
  if (state.modal.type === 'entry') return renderEntryModal();
  return '';
}

function modalFrame(title, body, foot = '', className = '') {
  return `<div class="acc-modal-backdrop"><div class="acc-modal ${className}"><div class="acc-modal-head"><h2>${title}</h2><button class="btn btn-small" data-close-modal>✕</button></div><div class="acc-modal-body">${body}</div>${foot ? `<div class="acc-modal-foot">${foot}</div>` : ''}</div></div>`;
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
    <article class="document-line" data-line-index="${index}" data-line-id="${line.id || ''}">
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
          <span>Base <strong data-line-base>${money(line.taxable_base)}</strong></span>
          <span>IGIC <strong data-line-tax>${money(line.tax_amount)}</strong></span>
        </div>
      </div>
      ${renderPriceHistory(line, readOnly)}
    </article>`;
}

function renderDocumentModal(document = {}) {
  const isPurchase = (document.direction || state.modal.direction) === 'purchase';
  if (state.modal.loading) {
    return modalFrame('Revisar documento', '<div class="acc-empty"><strong>Cargando líneas…</strong></div>', '', 'acc-modal-wide');
  }
  const readOnly = Boolean(document.id && !['draft', 'needs_review'].includes(document.status));
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
      <div class="field"><label>${isPurchase ? 'Proveedor' : 'Cliente'}</label><select id="doc-contact" ${readOnly ? 'disabled' : ''}><option value="">Sin contacto</option>${state.contacts.filter(c => c.kind === (isPurchase?'supplier':'customer') || c.kind === 'both').map(c => `<option value="${c.id}" ${document.contact_id===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <section class="document-lines-section">
        <div class="document-lines-title">
          <div><h3>Líneas de artículos</h3><p>El precio y el IGIC se guardan por artículo.</p></div>
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
      ${document.status === 'needs_review' ? '<div class="acc-notice">Documento extraído automáticamente. Revisa todos los campos antes de aprobar.</div>' : ''}
      ${readOnly ? '<div class="acc-notice acc-success">Documento aprobado. Sus líneas se conservan sin cambios; cualquier corrección deberá hacerse mediante una rectificativa.</div>' : ''}
    </form>`,
    `${originalButton}${document.id && !readOnly ? '<button class="btn" id="post-document-btn">Aprobar y contabilizar</button>' : ''}${!readOnly ? '<button class="btn btn-primary" type="submit" form="document-form">Guardar</button>' : '<button class="btn" data-close-modal>Cerrar</button>'}`,
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
  document.querySelector('#import-bank-btn')?.addEventListener('click', () => openModal({ type: 'bank-import' }));
  document.querySelector('#new-bank-account-btn')?.addEventListener('click', () => openModal({ type: 'bank-account' }));
  document.querySelector('#suggest-matches-btn')?.addEventListener('click', suggestMatches);
  document.querySelectorAll('[data-confirm-match]').forEach(button => button.addEventListener('click', () => updateMatch(button.dataset.confirmMatch, 'confirmed')));
  document.querySelectorAll('[data-reject-match]').forEach(button => button.addEventListener('click', () => updateMatch(button.dataset.rejectMatch, 'rejected')));
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
}

function openModal(modal) { state.modal = modal; renderApp(); }
function closeModal() { state.modal = null; renderApp(); }
async function openDocument(document = {}, direction = document.direction || 'purchase') {
  if (!document.id) {
    openModal({
      type: 'document',
      document,
      direction,
      lines: [emptyDocumentLine(direction)],
      priceHistory: []
    });
    return;
  }
  openModal({ type: 'document', document, direction, lines: [], priceHistory: [], loading: true });
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
    lines: linesResult.data?.length ? linesResult.data : [emptyDocumentLine(direction)],
    priceHistory: historyResult.data || [],
    loading: false
  };
  renderApp();
}

function openDriveImportReview(item) {
  const review = reviewableSupplierDocument(item.payload, {
    drive_file_id: item.drive_file_id,
    issue_date: isoDate(),
    number: `PENDIENTE-${String(item.drive_file_id || item.id).slice(-8)}`
  });
  const taxId = String(review.supplier.tax_id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const supplierName = review.supplier.name.toLocaleLowerCase('es');
  const contact = state.contacts.find(candidate => {
    const candidateTaxId = String(candidate.tax_id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return (taxId && candidateTaxId === taxId)
      || (!taxId && String(candidate.name || '').toLocaleLowerCase('es') === supplierName);
  });
  const sourceUrl = safeDriveUrl(review.source_url || driveFileUrl(review.drive_file_id));
  const notes = [
    item.error_message ? `Corrección pendiente: ${item.error_message}` : '',
    ...review.warnings
  ].filter(Boolean).join('\n');
  openModal({
    type: 'document',
    driveImportId: item.id,
    correctionError: item.error_message || 'El análisis necesita una revisión manual.',
    sourceUrl,
    direction: 'purchase',
    priceHistory: [],
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
  return [...document.querySelectorAll('.document-line')].map(row => ({
    id: row.dataset.lineId || '',
    supplier_item_code: row.querySelector('[data-line-field="supplier_item_code"]')?.value.trim() || '',
    description: row.querySelector('[data-line-field="description"]')?.value.trim() || '',
    quantity: Number(row.querySelector('[data-line-field="quantity"]')?.value || 0),
    unit_price: Number(row.querySelector('[data-line-field="unit_price"]')?.value || 0),
    tax_scope: row.querySelector('[data-line-field="tax_scope"]')?.value || 'taxable',
    tax_rate: Number(row.querySelector('[data-line-field="tax_rate"]')?.value || 0),
    withholding_rate: Number(row.querySelector('[data-line-field="withholding_rate"]')?.value || 0),
    account_code: state.modal.direction === 'sale' ? '700' : '600'
  }));
}

function refreshDocumentCalculations() {
  if (state.modal?.type !== 'document') return;
  const totals = calculateDocumentTotals(readDocumentLines());
  state.modal.lines = totals.lines;
  document.querySelectorAll('.document-line').forEach((row, index) => {
    const line = totals.lines[index];
    row.querySelector('[data-line-base]').textContent = money(line.taxable_base);
    row.querySelector('[data-line-tax]').textContent = money(line.tax_amount);
    const rateSelect = row.querySelector('[data-line-field="tax_rate"]');
    if (rateSelect) {
      rateSelect.disabled = line.tax_scope !== 'taxable';
      if (line.tax_scope !== 'taxable') rateSelect.value = '0';
    }
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
    const documentId = state.modal.driveImportId && !current.id
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
  await persistDocument();
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

async function updateMatch(id, status) {
  const match = state.reconciliations.find(item => item.id === id);
  if (!match) return;
  const { error } = await state.client.from('accounting_reconciliations').update({ status }).eq('id', id);
  if (error) return toast(error.message, 'error');
  if (status === 'confirmed') {
    await state.client.from('accounting_bank_transactions').update({ status: 'matched' }).eq('id', match.bank_transaction_id);
    const document = state.documents.find(item => item.id === match.document_id);
    if (document) {
      const paid = Math.min(Number(document.total_amount), Number(document.paid_amount || 0) + Number(match.amount));
      await state.client.from('bookkeeping_documents').update({
        paid_amount: paid,
        status: paid >= Number(document.total_amount) ? 'paid' : 'partially_paid'
      }).eq('id', document.id);
    }
  }
  await loadAll();
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
