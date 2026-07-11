/**
 * db.js — Data Access Layer
 * Todas las operaciones CRUD contra Supabase para el catálogo del TPV.
 * Las mesas, tickets activos y transacciones del día permanecen en memoria.
 */

import { supabase } from './supabase.js';

// ─────────────────────────────────────────
// Error notification helper
// Muestra un toast rojo en pantalla cuando falla una escritura
// ─────────────────────────────────────────

function notifyDbError(operation, errorMessage) {
  console.error(`[DB] ${operation}:`, errorMessage);

  // Dispatch global event so the UI can show a toast
  window.dispatchEvent(new CustomEvent('db-error', {
    detail: { operation, message: errorMessage }
  }));
}

function mapFiscalDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    saleId: row.sale_id,
    type: row.document_type,
    status: row.status,
    series: row.series,
    number: Number(row.number || 0),
    fiscalNumber: row.fiscal_number,
    issuedAt: row.issued_at,
    totalAmount: parseFloat(row.total_amount || 0),
    taxName: row.tax_name || 'IGIC',
    taxRate: parseFloat(row.tax_rate || 0),
    taxableBase: parseFloat(row.taxable_base || 0),
    taxAmount: parseFloat(row.tax_amount || 0),
    previousHash: row.previous_hash || '',
    hash: row.hash || '',
    aeatStatus: row.aeat_status || 'pending',
    qrPayload: row.qr_payload || ''
  };
}

// ─────────────────────────────────────────
// LOAD — Carga inicial de todo el catálogo
// ─────────────────────────────────────────

export async function loadCatalog() {
  const [
    { data: categories, error: catErr },
    { data: menuItems, error: itemErr },
    { data: modifiers, error: modErr },
    { data: modifierOptions, error: optErr },
    { data: gridItems, error: gridErr }
  ] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('menu_items').select('*').order('name'),
    supabase.from('modifiers').select('*').order('name'),
    supabase.from('modifier_options').select('*'),
    supabase.from('grid_items').select('*')
  ]);

  if (catErr || itemErr || modErr || optErr || gridErr) {
    const err = catErr || itemErr || modErr || optErr || gridErr;
    console.error('[DB] Error cargando catálogo:', err.message);
    throw err;
  }

  // Mapear columnas snake_case → camelCase para el store
  const mappedCategories = categories.map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    ...(c.parent_id ? { parentId: c.parent_id } : {})
  }));

  const mappedMenuItems = menuItems.map(item => ({
    id: item.id,
    name: item.name,
    price: parseFloat(item.price),
    category: item.category,
    ...(item.image ? { image: item.image } : {}),
    modifiers: item.modifiers || []
  }));

  // Agrupar options dentro de cada modifier
  const mappedModifiers = modifiers.map(mod => ({
    id: mod.id,
    name: mod.name,
    assignedItems: mod.assigned_items || [],
    options: modifierOptions
      .filter(opt => opt.modifier_id === mod.id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(opt => ({
        id: opt.id,
        name: opt.name,
        price: parseFloat(opt.price)
      }))
  }));

  // ── Reconciliar asociaciones en ambas direcciones ──────────
  // La BD mantiene dos listas:
  //   • menu_items.modifiers        → IDs de modificadores del artículo
  //   • modifiers.assigned_items    → IDs de artículos del modificador
  // Si alguna quedó desincronizada, la fusionamos aquí al cargar.
  mappedModifiers.forEach(mod => {
    (mod.assignedItems || []).forEach(itemId => {
      const item = mappedMenuItems.find(i => i.id === itemId);
      if (item && !item.modifiers.includes(mod.id)) {
        item.modifiers = [...item.modifiers, mod.id];
      }
    });
  });
  mappedMenuItems.forEach(item => {
    (item.modifiers || []).forEach(modId => {
      const mod = mappedModifiers.find(m => m.id === modId);
      if (mod && !mod.assignedItems.includes(item.id)) {
        mod.assignedItems = [...mod.assignedItems, item.id];
      }
    });
  });
  // ───────────────────────────────────────────────────────────

  // Reconstruir el objeto gridItems { gridKey: slots[] }
  const mappedGridItems = {};
  gridItems.forEach(row => {
    mappedGridItems[row.grid_key] = row.slots;
  });

  return {
    categories: mappedCategories,
    menuItems: mappedMenuItems,
    modifiers: mappedModifiers,
    gridItems: mappedGridItems
  };
}

// ─────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────

export async function upsertCategory(category) {
  const row = {
    id: category.id,
    name: category.name,
    type: category.type,
    parent_id: category.parentId || null
  };
  const { error } = await supabase.from('categories').upsert(row, { onConflict: 'id' });
  if (error) notifyDbError('upsertCategory', error.message);
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) notifyDbError('deleteCategory', error.message);
}

// ─────────────────────────────────────────
// MENU ITEMS
// ─────────────────────────────────────────

export async function upsertMenuItem(item) {
  const row = {
    id: item.id,
    name: item.name,
    price: item.price,
    category: item.category || null,
    image: item.image || null,
    modifiers: item.modifiers || []
  };
  const { error } = await supabase.from('menu_items').upsert(row, { onConflict: 'id' });
  if (error) notifyDbError('upsertMenuItem', error.message);
}

export async function deleteMenuItem(id) {
  const { error } = await supabase.from('menu_items').delete().eq('id', id);
  if (error) notifyDbError('deleteMenuItem', error.message);
}

// ─────────────────────────────────────────
// MODIFIERS
// ─────────────────────────────────────────

export async function upsertModifier(modifier) {
  // 1. Upsert the modifier group
  const { error: modErr } = await supabase.from('modifiers').upsert({
    id: modifier.id,
    name: modifier.name,
    assigned_items: modifier.assignedItems || []
  }, { onConflict: 'id' });
  if (modErr) { notifyDbError('upsertModifier', modErr.message); return; }

  // 2. Replace all options: delete existing, insert new
  await supabase.from('modifier_options').delete().eq('modifier_id', modifier.id);

  if (modifier.options && modifier.options.length > 0) {
    const optRows = modifier.options.map(opt => ({
      id: opt.id,
      modifier_id: modifier.id,
      name: opt.name,
      price: opt.price ?? 0
    }));
    const { error: optErr } = await supabase.from('modifier_options').insert(optRows);
    if (optErr) notifyDbError('upsertModifierOptions', optErr.message);
  }
}

export async function deleteModifier(id) {
  const { error } = await supabase.from('modifiers').delete().eq('id', id);
  if (error) notifyDbError('deleteModifier', error.message);
}

// ─────────────────────────────────────────
// GRID ITEMS
// ─────────────────────────────────────────

export async function upsertGridItems(gridKey, slots) {
  const { error } = await supabase.from('grid_items').upsert(
    { grid_key: gridKey, slots: slots },
    { onConflict: 'grid_key' }
  );
  if (error) notifyDbError('upsertGridItems', error.message);
}

export async function deleteGridItems(gridKey) {
  const { error } = await supabase.from('grid_items').delete().eq('grid_key', gridKey);
  if (error) notifyDbError('deleteGridItems', error.message);
}

// ─────────────────────────────────────────
// TPV STATE (Realtime Sync)
// ─────────────────────────────────────────

export async function upsertReceiptTicket(transaction) {
  if (!transaction?.receiptToken) return;

  const { error } = await supabase.from('receipt_tickets').upsert({
    token: transaction.receiptToken,
    transaction_id: transaction.id,
    payload: transaction,
    created_at: transaction.createdAt || new Date().toISOString()
  }, { onConflict: 'token' });

  if (error) notifyDbError('upsertReceiptTicket', error.message);
}

export async function loadReceiptTicket(token) {
  const { data, error } = await supabase
    .from('receipt_tickets')
    .select('payload')
    .eq('token', token)
    .single();

  if (error) throw error;
  return data?.payload || null;
}

function mapSaleRow(row, lines = [], payments = [], fiscalDocument = null) {
  const payload = row.payload || {};
  return {
    ...payload,
    id: row.id,
    type: row.type || payload.type || 'sale',
    parentId: row.parent_sale_id || payload.parentId,
    date: payload.date || new Date(row.closed_at || row.created_at).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(' ', ''),
    table: row.table_name || payload.table || 'Venta Directa',
    total: parseFloat(row.total_amount || payload.total || 0),
    paymentMethod: row.payment_method || payload.paymentMethod || '',
    itemsCount: Number(row.items_count || payload.itemsCount || 0),
    receiptToken: row.receipt_token || payload.receiptToken,
    createdAt: row.created_at || payload.createdAt,
    legalData: row.legal_data || payload.legalData || {},
    fiscalData: fiscalDocument || payload.fiscalData || null,
    loyaltyCustomer: row.loyalty_data?.customer || payload.loyaltyCustomer,
    refundAmount: parseFloat(row.refund_amount || payload.refundAmount || 0),
    reason: row.refund_reason || payload.reason || '',
    hasRefund: row.has_refund || payload.hasRefund || false,
    items: lines.map(line => ({
      ...(line.raw_payload || {}),
      ticketItemId: line.ticket_item_id,
      id: line.item_id,
      name: line.name,
      qty: parseFloat(line.quantity || 0),
      price: parseFloat(line.unit_price || 0),
      total: parseFloat(line.total_amount || 0),
      selectedOptions: line.selected_options || []
    })),
    payments: payments.map(payment => ({
      ...(payment.raw_payload || {}),
      id: payment.id,
      method: payment.method,
      amount: parseFloat(payment.amount || 0),
      provider: payment.provider || '',
      externalRef: payment.external_ref || ''
    }))
  };
}

export async function loadSales(limit = 1000) {
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('*')
    .order('closed_at', { ascending: false })
    .limit(limit);

  if (salesError) {
    console.warn('[DB] Error loading normalized sales:', salesError.message);
    return null;
  }

  const saleIds = (sales || []).map(row => row.id);
  if (saleIds.length === 0) return [];

  const [
    { data: lines, error: linesError },
    { data: payments, error: paymentsError },
    { data: fiscalDocuments, error: fiscalError }
  ] = await Promise.all([
    supabase.from('sale_lines').select('*').in('sale_id', saleIds),
    supabase.from('sale_payments').select('*').in('sale_id', saleIds),
    supabase.from('fiscal_documents').select('*').in('sale_id', saleIds)
  ]);

  if (linesError) console.warn('[DB] Error loading sale lines:', linesError.message);
  if (paymentsError) console.warn('[DB] Error loading sale payments:', paymentsError.message);
  if (fiscalError && !['42P01', 'PGRST205'].includes(fiscalError.code)) {
    console.warn('[DB] Error loading fiscal documents:', fiscalError.message);
  }

  const linesBySale = new Map();
  (lines || []).forEach(line => {
    if (!linesBySale.has(line.sale_id)) linesBySale.set(line.sale_id, []);
    linesBySale.get(line.sale_id).push(line);
  });

  const paymentsBySale = new Map();
  (payments || []).forEach(payment => {
    if (!paymentsBySale.has(payment.sale_id)) paymentsBySale.set(payment.sale_id, []);
    paymentsBySale.get(payment.sale_id).push(payment);
  });

  const fiscalBySale = new Map();
  (fiscalDocuments || []).forEach(document => {
    fiscalBySale.set(document.sale_id, mapFiscalDocument(document));
  });

  return (sales || []).map(row => mapSaleRow(
    row,
    linesBySale.get(row.id) || [],
    paymentsBySale.get(row.id) || [],
    fiscalBySale.get(row.id) || null
  ));
}

export async function upsertSaleRecord(transaction) {
  if (!transaction?.id) return null;

  const saleRow = {
    id: transaction.id,
    type: transaction.type || 'sale',
    parent_sale_id: transaction.parentId || null,
    table_name: transaction.table || null,
    total_amount: transaction.total || 0,
    payment_method: transaction.paymentMethod || '',
    items_count: transaction.itemsCount || 0,
    receipt_token: transaction.receiptToken || null,
    staff_id: transaction.staff?.id || transaction.staffId || null,
    staff_name: transaction.staff?.name || transaction.staffName || null,
    closed_at: transaction.createdAt || new Date().toISOString(),
    created_at: transaction.createdAt || new Date().toISOString(),
    legal_data: transaction.legalData || {},
    loyalty_data: transaction.loyaltyCustomer ? { customer: transaction.loyaltyCustomer } : {},
    refund_amount: transaction.refundAmount || 0,
    refund_reason: transaction.reason || null,
    has_refund: transaction.hasRefund === true,
    payload: transaction
  };

  const { error: saleError } = await supabase.from('sales').upsert(saleRow, { onConflict: 'id' });
  if (saleError) {
    notifyDbError('upsertSaleRecord:sales', saleError.message);
    return null;
  }

  const { error: deleteLinesError } = await supabase.from('sale_lines').delete().eq('sale_id', transaction.id);
  if (deleteLinesError) notifyDbError('upsertSaleRecord:deleteLines', deleteLinesError.message);

  const { error: deletePaymentsError } = await supabase.from('sale_payments').delete().eq('sale_id', transaction.id);
  if (deletePaymentsError) notifyDbError('upsertSaleRecord:deletePayments', deletePaymentsError.message);

  const lines = (transaction.items || []).map((item, index) => ({
    id: `${transaction.id}-line-${String(index + 1).padStart(3, '0')}`,
    sale_id: transaction.id,
    item_id: item.id || null,
    ticket_item_id: item.ticketItemId || null,
    name: item.name || 'Articulo',
    quantity: item.qty || 0,
    unit_price: item.price || 0,
    total_amount: item.total ?? ((item.price || 0) * (item.qty || 0)),
    selected_options: item.selectedOptions || [],
    raw_payload: item
  }));

  if (lines.length > 0) {
    const { error: linesError } = await supabase.from('sale_lines').upsert(lines, { onConflict: 'id' });
    if (linesError) notifyDbError('upsertSaleRecord:lines', linesError.message);
  }

  const paymentRows = (transaction.payments?.length ? transaction.payments : [{
    method: transaction.paymentMethod || '',
    amount: transaction.total || 0
  }]).map((payment, index) => ({
    id: `${transaction.id}-payment-${String(index + 1).padStart(3, '0')}`,
    sale_id: transaction.id,
    method: payment.method || transaction.paymentMethod || '',
    amount: payment.amount || 0,
    provider: payment.provider || null,
    external_ref: payment.externalRef || null,
    raw_payload: payment
  }));

  if (paymentRows.length > 0) {
    const { error: paymentsError } = await supabase.from('sale_payments').upsert(paymentRows, { onConflict: 'id' });
    if (paymentsError) notifyDbError('upsertSaleRecord:payments', paymentsError.message);
  }

  return transaction.id;
}

export async function createFiscalDocumentForSale(transaction) {
  if (!transaction?.id) return null;

  const documentType = transaction.type === 'refund' ? 'refund' : 'simplified_invoice';
  const { data, error } = await supabase.rpc('create_fiscal_document', {
    p_sale_id: transaction.id,
    p_document_type: documentType
  });

  if (error) {
    if (['42883', '42P01', 'PGRST202', 'PGRST205'].includes(error.code)) {
      console.warn('[DB] Capa fiscal pendiente de activar. Ejecuta sql/fiscal_documents_migration.sql en Supabase.');
      return null;
    }
    notifyDbError('createFiscalDocumentForSale', error.message);
    return null;
  }

  return mapFiscalDocument(data);
}

export async function loadCashClosures(limit = 120) {
  const { data, error } = await supabase
    .from('cash_closures')
    .select('*')
    .order('business_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[DB] Error loading cash closures:', error.message);
    return null;
  }

  return (data || []).map(row => ({
    ...(row.payload || {}),
    id: row.id,
    businessDate: row.business_date,
    shiftNumber: Number(row.shift_number || 1),
    shiftStartAt: row.shift_start_at || null,
    openingCash: parseFloat(row.opening_cash || 0),
    expectedCash: parseFloat(row.expected_cash || 0),
    countedCash: parseFloat(row.counted_cash || 0),
    cashDifference: parseFloat(row.cash_difference || 0),
    expectedCard: parseFloat(row.expected_card || 0),
    bbvaTotal: parseFloat(row.bbva_total || 0),
    cardDifference: parseFloat(row.card_difference || 0),
    totalSales: parseFloat(row.total_sales || 0),
    totalRefunds: parseFloat(row.total_refunds || 0),
    transactionsCount: Number(row.transactions_count || 0),
    staffId: row.staff_id || '',
    staffName: row.staff_name || '',
    notes: row.notes || '',
    closedAt: row.closed_at,
    payload: row.payload || {}
  }));
}

export async function upsertCashClosure(closure) {
  if (!closure?.businessDate) return null;
  const id = closure.id || `closure-${closure.businessDate}-shift-${closure.shiftNumber || 1}`;
  const row = {
    id,
    business_date: closure.businessDate,
    shift_number: closure.shiftNumber || 1,
    shift_start_at: closure.shiftStartAt || null,
    opening_cash: closure.openingCash || 0,
    expected_cash: closure.expectedCash || 0,
    counted_cash: closure.countedCash || 0,
    cash_difference: closure.cashDifference || 0,
    expected_card: closure.expectedCard || 0,
    bbva_total: closure.bbvaTotal || 0,
    card_difference: closure.cardDifference || 0,
    total_sales: closure.totalSales || 0,
    total_refunds: closure.totalRefunds || 0,
    transactions_count: closure.transactionsCount || 0,
    staff_id: closure.staff?.id || closure.staffId || null,
    staff_name: closure.staff?.name || closure.staffName || null,
    notes: closure.notes || null,
    payload: closure,
    closed_at: closure.closedAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('cash_closures').upsert(row, { onConflict: 'id' });
  if (error) {
    notifyDbError('upsertCashClosure', error.message);
    return null;
  }
  return id;
}

export async function loadSquareGiftCardEvents(limit = 1000) {
  const { data, error } = await supabase
    .from('square_gift_card_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code)) {
      console.warn('[DB] Ejecuta sql/square_gift_cards_migration.sql para cargar eventos de tarjetas regalo Square.');
      return [];
    }
    console.warn('[DB] Error loading Square gift card events:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    saleId: row.sale_id || '',
    eventType: row.event_type || '',
    giftCardId: row.gift_card_id || '',
    giftCardGanLast4: row.gift_card_gan_last4 || '',
    squareActivityId: row.square_activity_id || '',
    referenceId: row.reference_id || '',
    amount: parseFloat(row.amount || 0),
    currency: row.currency || 'EUR',
    rawPayload: row.raw_payload || {},
    createdAt: row.created_at
  }));
}

export async function loadStaffProfiles() {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, display_name, role, pin_code, active, created_at')
    .order('display_name');

  if (error) {
    console.warn('[DB] Error loading staff profiles:', error.message);
    return [];
  }

  return data || [];
}

export async function findStaffByPin(pinCode) {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, display_name, role, active')
    .eq('pin_code', pinCode)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    console.warn('[DB] Error loading staff profile:', error.message);
    return null;
  }

  return data || null;
}

export async function upsertStaffProfile(profile) {
  const row = {
    id: profile.id || `staff-${Date.now()}`,
    display_name: profile.displayName,
    role: profile.role || 'staff',
    pin_code: profile.pinCode,
    active: profile.active !== false,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('staff_profiles').upsert(row, { onConflict: 'id' });
  if (error) notifyDbError('upsertStaffProfile', error.message);
}

export async function deleteStaffProfile(id) {
  const { error } = await supabase.from('staff_profiles').delete().eq('id', id);
  if (error) notifyDbError('deleteStaffProfile', error.message);
}

export async function loadSupplierInvoices() {
  const { data, error } = await supabase
    .from('supplier_invoices')
    .select('*')
    .order('invoice_date', { ascending: false });

  if (error) {
    console.warn('[DB] Error loading supplier invoices:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    supplierName: row.supplier_name,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    category: row.category || '',
    baseAmount: parseFloat(row.base_amount || 0),
    taxRate: parseFloat(row.tax_rate || 0),
    taxAmount: parseFloat(row.tax_amount || 0),
    totalAmount: parseFloat(row.total_amount || 0),
    deductible: row.deductible !== false,
    status: row.status || 'pending_review',
    source: row.source || 'manual',
    sourceId: row.source_id || '',
    senderEmail: row.sender_email || '',
    fileName: row.file_name || '',
    fileUrl: row.file_url || '',
    notes: row.notes || '',
    createdAt: row.created_at
  }));
}

export async function loadSupplierInvoiceLines() {
  const { data, error } = await supabase
    .from('supplier_invoice_lines')
    .select('*')
    .order('invoice_date', { ascending: false });

  if (error) {
    console.warn('[DB] Error loading supplier invoice lines:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    invoiceId: row.invoice_id,
    supplierName: row.supplier_name || '',
    invoiceDate: row.invoice_date || '',
    description: row.description || '',
    quantity: row.quantity === null ? null : parseFloat(row.quantity || 0),
    unitPrice: row.unit_price === null ? null : parseFloat(row.unit_price || 0),
    totalAmount: row.total_amount === null ? null : parseFloat(row.total_amount || 0),
    taxRate: row.tax_rate === null ? null : parseFloat(row.tax_rate || 0),
    rawPayload: row.raw_payload || {}
  }));
}

export async function upsertSupplierInvoice(invoice) {
  const id = invoice.id || `invoice-${Date.now()}`;
  const row = {
    id,
    supplier_name: invoice.supplierName,
    invoice_number: invoice.invoiceNumber || null,
    invoice_date: invoice.invoiceDate,
    category: invoice.category || null,
    base_amount: invoice.baseAmount || 0,
    tax_rate: invoice.taxRate || 0,
    tax_amount: invoice.taxAmount || 0,
    total_amount: invoice.totalAmount || 0,
    deductible: invoice.deductible !== false,
    status: invoice.status || 'pending_review',
    source: invoice.source || 'manual',
    source_id: invoice.sourceId || null,
    sender_email: invoice.senderEmail || null,
    file_name: invoice.fileName || null,
    file_url: invoice.fileUrl || null,
    notes: invoice.notes || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('supplier_invoices').upsert(row, { onConflict: 'id' });
  if (error) notifyDbError('upsertSupplierInvoice', error.message);
  return id;
}

export async function replaceSupplierInvoiceLines(invoiceId, lines = []) {
  if (!invoiceId) return;

  const { error: deleteError } = await supabase
    .from('supplier_invoice_lines')
    .delete()
    .eq('invoice_id', invoiceId);
  if (deleteError) {
    notifyDbError('replaceSupplierInvoiceLines:delete', deleteError.message);
    return;
  }

  if (!lines.length) return;

  const rows = lines.map((line, index) => ({
    id: `${invoiceId}-line-${String(index + 1).padStart(3, '0')}`,
    invoice_id: invoiceId,
    supplier_name: line.proveedor || line.supplierName || '',
    invoice_date: line.fecha || line.invoiceDate || null,
    description: line.articulo_normalizado || line.description || '',
    quantity: line.cantidad ?? line.quantity ?? null,
    unit_price: line.precio_unitario ?? line.unitPrice ?? null,
    total_amount: line.importe ?? line.totalAmount ?? null,
    tax_rate: line.taxRate ?? null,
    raw_payload: line
  }));

  const { error } = await supabase.from('supplier_invoice_lines').insert(rows);
  if (error) notifyDbError('replaceSupplierInvoiceLines:insert', error.message);
}

export async function deleteSupplierInvoice(id) {
  const { error } = await supabase.from('supplier_invoices').delete().eq('id', id);
  if (error) notifyDbError('deleteSupplierInvoice', error.message);
}

export async function loadSupplierSenderRules() {
  const { data, error } = await supabase
    .from('supplier_sender_rules')
    .select('*')
    .order('email');

  if (error) {
    console.warn('[DB] Error loading supplier sender rules:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    email: row.email,
    label: row.label || '',
    ignored: row.ignored === true
  }));
}

export async function upsertSupplierSenderRule(rule) {
  const email = String(rule.email || '').trim().toLowerCase();
  if (!email) return;

  const { error } = await supabase.from('supplier_sender_rules').upsert({
    email,
    label: rule.label || null,
    ignored: rule.ignored === true,
    updated_at: new Date().toISOString()
  }, { onConflict: 'email' });

  if (error) notifyDbError('upsertSupplierSenderRule', error.message);
}

export async function loadTPVState() {
  const { data, error } = await supabase
    .from('tpv_state')
    .select('*')
    .eq('id', 'global')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Row not found, create a default one
      const defaultState = {
        id: 'global',
        tables: [],
        direct_sale: { items: [] },
        transactions: []
      };
      const { error: insErr } = await supabase.from('tpv_state').insert(defaultState);
      if (insErr) {
        console.warn('[DB] Error creating default TPV state:', insErr.message);
      }
      return defaultState;
    }
    console.warn('[DB] Error loading TPV state:', error.message);
    throw error;
  }
  return data;
}

export async function saveTPVState(tables, directSale, transactions, legal, rolePermissions = null, kdsState = null) {
  let preservedKdsState = {};
  const { data: currentState } = await supabase
    .from('tpv_state')
    .select('tables, direct_sale')
    .eq('id', 'global')
    .maybeSingle();

  if (!kdsState && !directSale?.kds_state) {
    preservedKdsState = currentState?.direct_sale?.kds_state && typeof currentState.direct_sale.kds_state === 'object'
      ? currentState.direct_sale.kds_state
      : {};
  }

  const currentTablesById = new Map((currentState?.tables || []).map(table => [Number(table.id), table]));
  const mergedTables = (tables || []).map(localTable => {
    const currentTable = currentTablesById.get(Number(localTable.id));
    if (!currentTable) return localTable;

    const localTime = new Date(localTable.syncUpdatedAt || 0).getTime();
    const currentTime = new Date(currentTable.syncUpdatedAt || 0).getTime();
    return currentTime > localTime ? currentTable : localTable;
  });

  const directSaleWithFallback = {
    ...directSale,
    legal_data: legal,
    role_permissions: rolePermissions || undefined,
    kds_state: kdsState || directSale?.kds_state || preservedKdsState
  };

  const { error } = await supabase
    .from('tpv_state')
    .upsert({
      id: 'global',
      tables: mergedTables,
      direct_sale: directSaleWithFallback,
      transactions,
      legal_data: legal,
      role_permissions: rolePermissions,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

  if (error) {
    // 42703: undefined_column (legal_data column doesn't exist yet on remote db)
    if (error.code === '42703') {
      const { error: fallbackError } = await supabase
        .from('tpv_state')
        .upsert({
          id: 'global',
          tables: mergedTables,
          direct_sale: directSaleWithFallback,
          transactions,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (fallbackError) {
        console.warn('[DB] Error saving TPV state to Supabase (fallback):', fallbackError.message);
      }
    } else {
      console.warn('[DB] Error saving TPV state to Supabase:', error.message);
    }
  }
}
