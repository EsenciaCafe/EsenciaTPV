function stableOption(option = {}) {
  return {
    id: String(option.id || ''),
    name: String(option.name || ''),
    qty: Number(option.qty || 0),
    price: Number(option.price || 0)
  };
}

export function createOrderFingerprint(items = []) {
  const normalizedItems = (items || []).map(item => ({
    ticketItemId: String(item.ticketItemId || ''),
    id: String(item.id || ''),
    name: String(item.name || ''),
    qty: Number(item.qty || 0),
    note: String(item.note || '').trim(),
    selectedOptions: (item.selectedOptions || [])
      .map(stableOption)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  })).sort((a, b) => {
    const aKey = a.ticketItemId || JSON.stringify(a);
    const bKey = b.ticketItemId || JSON.stringify(b);
    return aKey.localeCompare(bKey);
  });

  return JSON.stringify(normalizedItems);
}

