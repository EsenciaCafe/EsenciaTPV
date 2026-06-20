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

export async function saveTPVState(tables, directSale, transactions, legal) {
  const directSaleWithFallback = {
    ...directSale,
    legal_data: legal
  };

  const { error } = await supabase
    .from('tpv_state')
    .upsert({
      id: 'global',
      tables,
      direct_sale: directSaleWithFallback,
      transactions,
      legal_data: legal,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

  if (error) {
    // 42703: undefined_column (legal_data column doesn't exist yet on remote db)
    if (error.code === '42703') {
      const { error: fallbackError } = await supabase
        .from('tpv_state')
        .upsert({
          id: 'global',
          tables,
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
