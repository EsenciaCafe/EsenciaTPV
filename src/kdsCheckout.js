// This module only coordinates entry/return. Money is handled by the TPV panel.
export function openCheckoutTables(tables = []) {
  return tables.filter(table => Array.isArray(table.items) && table.items.some(item => Number(item.qty) > 0));
}

export function checkoutTableId(search) {
  return new URLSearchParams(search).get('kdsCheckout') || null;
}

export function checkoutUrl(tableId, base) {
  const url = new URL('./index.html', base);
  url.searchParams.set('kdsCheckout', String(tableId));
  return url.href;
}

export function checkoutSnapshot(items = []) {
  return items.map(item => ({
    ticketItemId: String(item.ticketItemId || ''),
    id: String(item.id || ''), name: item.name || '',
    qty: Number(item.qty || 0), price: Number(item.price || 0),
    discountPercent: Number(item.discountPercent || 0),
    clubPromotion: item.clubPromotion || null,
    selectedOptions: item.selectedOptions || []
  })).sort((a, b) => a.ticketItemId < b.ticketItemId ? -1 : a.ticketItemId > b.ticketItemId ? 1 : 0);
}

export function sameCheckoutItems(left, right) {
  return JSON.stringify(checkoutSnapshot(left)) === JSON.stringify(checkoutSnapshot(right));
}

// Square must see the same redemption key even from another device or retry.
export async function giftCardOrderReference(items, cryptoApi = globalThis.crypto) {
  const ids = items.map(item => String(item.ticketItemId || '')).sort();
  if (!ids.length || ids.some(id => !id)) throw new Error('La comanda necesita identificadores antes de canjear una tarjeta regalo.');
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(ids)));
  return `order-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

export async function fetchCheckoutTable(client, tableId) {
  const { data, error } = await client.rpc('get_kds_checkout_table', { p_table_id: String(tableId) });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new Error('El cobro desde KDS necesita activar primero la actualización de Supabase. Usa el TPV habitual.');
    }
    throw new Error(error.message || 'No se pudo comprobar la mesa. No confirmes otro cobro.');
  }
  if (!data || !openCheckoutTables([data]).length) throw new Error('La mesa ya no tiene una cuenta abierta.');
  return data;
}

