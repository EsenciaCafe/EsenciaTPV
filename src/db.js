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
