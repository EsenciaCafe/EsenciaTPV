const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const drinks = /\b(bebidas?|drinks?|cafes?|tes?|matcha|latte|leche|cappuccino|capuccino|espresso|americano|cortado|zumos?|smoothies?|batidos?|refrescos?|agua|cerveza|vino|infusiones?|chai|cola|fanta|sprite|tonica|mocha|frappe)\b/;
const food = /\b(comidas?|foods?|pancakes?|minipancakes?|tostas?|tostadas?|bocadillos?|sandwich|bagel|croissant|galletas?|ensaladas?|postres?|tartas?|brownie|arepa|pan|bolleria|cinnamon|roll)\b/;

export function getKitchenService(item, menuItems = [], categories = []) {
  const product = menuItems.find(candidate => candidate.id === item.id);
  let categoryId = product?.category || item.category;
  const visited = new Set();
  while (categoryId && !visited.has(categoryId)) {
    visited.add(categoryId);
    const category = categories.find(candidate => candidate.id === categoryId);
    const text = normalize(category?.name || categoryId);
    if (food.test(text)) return 'food';
    if (drinks.test(text)) return 'drink';
    categoryId = category?.parentId || category?.parent_id;
  }
  const name = normalize(item.name);
  if (food.test(name)) return 'food';
  return drinks.test(name) ? 'drink' : 'food';
}

export function getPendingKitchenItems(table, kds = {}) {
  return (table?.items || []).filter(item =>
    Number(item.qty) > Number((kds.deliveredItems || []).find(delivered => delivered.ticketItemId === item.ticketItemId)?.qty || 0)
  );
}

export function normalizeKitchenState(table, kds = {}) {
  // Older KDS versions published only the ready flag. Capture its baseline once.
  const deliveredItems = Array.isArray(kds.deliveredItems) ? kds.deliveredItems
    : kds.status === 'ready' ? (table?.items || []).map(({ ticketItemId, id, qty }) => ({ ticketItemId, id, qty })) : [];
  const pending = getPendingKitchenItems(table, { deliveredItems });
  const ready = (table?.items || []).length > 0 && pending.length === 0;
  return { ...kds, deliveredItems, status: ready ? 'ready' : 'waiting', readyAt: ready ? kds.readyAt : null };
}

export function isDeferredKitchenItem(item, kds = {}) {
  return item.deferUntilLater === true && !(kds.releasedDeferredItems || []).includes(item.ticketItemId);
}

export function createKitchenAction(table, kds, service, classify = getKitchenService, now = Date.now()) {
  const pending = getPendingKitchenItems(table, kds).filter(item => classify(item) === service);
  const active = pending.filter(item => !isDeferredKitchenItem(item, kds));
  const items = active.length ? active : pending;
  if (!items.length) return null;
  return {
    type: active.length ? 'complete' : 'release', at: now,
    baseline: kds.deliveredItems || [],
    items: items.map(({ ticketItemId, id, qty }) => ({ ticketItemId, id, qty }))
  };
}

export function applyKitchenAction(table, previous, action) {
  const kds = normalizeKitchenState(table, Array.isArray(previous.deliveredItems) ? previous
    : { ...previous, deliveredItems: action.baseline || [] });
  const currentItems = table?.items || [];
  const targets = (action.items || []).filter(target => target.ticketItemId && currentItems.some(item => item.ticketItemId === target.ticketItemId));
  const delivered = new Map(kds.deliveredItems.filter(item => currentItems.some(current => current.ticketItemId === item.ticketItemId)).map(item => [item.ticketItemId, item]));
  const released = new Set((kds.releasedDeferredItems || []).filter(id => currentItems.some(item => item.ticketItemId === id)));
  for (const target of targets) {
    if (action.type === 'reopen') delivered.delete(target.ticketItemId);
    if (action.type === 'release') released.add(target.ticketItemId);
    if (action.type === 'complete') {
      const current = currentItems.find(item => item.ticketItemId === target.ticketItemId);
      // A click only serves quantities visible then, never later additions.
      const qty = Math.min(Number(current.qty), Math.max(Number(delivered.get(target.ticketItemId)?.qty || 0), Number(target.qty)));
      delivered.set(target.ticketItemId, { ...target, qty });
    }
  }
  return normalizeKitchenState(table, {
    ...kds, deliveredItems: [...delivered.values()], releasedDeferredItems: [...released],
    readyAt: action.at, updatedAt: new Date(action.at).toISOString()
  });
}

export async function saveKitchenAction(client, tableId, action) {
  // Compare-and-swap prevents a kitchen update overwriting a concurrent TPV edit.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await client.from('tpv_state').select('tables,direct_sale,updated_at').eq('id', 'global').single().abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    const table = (data.tables || []).find(table => Number(table.id) === Number(tableId));
    const directSale = data.direct_sale || {};
    const next = applyKitchenAction(table, directSale.kds_state?.[tableId] || {}, action);
    let query = client.from('tpv_state').update({
      direct_sale: { ...directSale, kds_state: { ...directSale.kds_state, [tableId]: next } },
      updated_at: new Date(Math.max(Date.now(), (Date.parse(data.updated_at) || 0) + 1)).toISOString()
    }).eq('id', 'global');
    query = data.updated_at ? query.eq('updated_at', data.updated_at) : query.is('updated_at', null);
    const result = await query.select('updated_at').abortSignal(AbortSignal.timeout(8000));
    if (result.error) throw result.error;
    if (result.data?.length) return { table, kds: next };
  }
  throw new Error('La mesa ha cambiado. Vuelve a intentarlo.');
}
