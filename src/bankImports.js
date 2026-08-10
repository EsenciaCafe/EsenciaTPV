function isoDate(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

export function bankImportDateRange(rows = []) {
  const dates = rows.map(row => isoDate(row.booked_on)).filter(Boolean).sort();
  return {
    start: dates[0] || '',
    end: dates.at(-1) || ''
  };
}

export function quarterRange(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${isoDate(value)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { start: '', end: '' };
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3;
  const start = new Date(date.getFullYear(), quarterMonth, 1);
  const end = new Date(date.getFullYear(), quarterMonth + 3, 0);
  const format = item => [
    item.getFullYear(),
    String(item.getMonth() + 1).padStart(2, '0'),
    String(item.getDate()).padStart(2, '0')
  ].join('-');
  return { start: format(start), end: format(end) };
}

export function clampBankImportRange(range = {}, bounds = {}) {
  return {
    start: [isoDate(range.start), isoDate(bounds.start)].filter(Boolean).sort().at(-1) || '',
    end: [isoDate(range.end), isoDate(bounds.end)].filter(Boolean).sort()[0] || ''
  };
}

export function bankImportSelection(rows = [], start = '', end = '') {
  const range = bankImportDateRange(rows);
  const selectedStart = isoDate(start) || range.start;
  const selectedEnd = isoDate(end) || range.end;
  const included = [];
  const excluded = [];
  rows.forEach(row => {
    const date = isoDate(row.booked_on);
    if (date && date >= selectedStart && date <= selectedEnd) included.push(row);
    else excluded.push(row);
  });
  return { range, selectedStart, selectedEnd, included, excluded };
}

export function isBankTransactionIncluded(transaction = {}) {
  return transaction.review_scope !== 'excluded';
}

export function buildBankImportBatches({ imports = [], transactions = [], accounts = [] } = {}) {
  const importById = new Map(imports.map(item => [item.id, item]));
  const groups = new Map();
  transactions.filter(item => item.import_batch).forEach(transaction => {
    if (!groups.has(transaction.import_batch)) groups.set(transaction.import_batch, []);
    groups.get(transaction.import_batch).push(transaction);
  });

  const ids = new Set([...importById.keys(), ...groups.keys()]);
  return [...ids].map(id => {
    const metadata = importById.get(id) || {};
    const rows = groups.get(id) || [];
    const range = bankImportDateRange(rows);
    const accountId = metadata.bank_account_id || rows[0]?.bank_account_id || null;
    const account = accounts.find(item => item.id === accountId) || null;
    const excluded = rows.filter(item => !isBankTransactionIncluded(item));
    const processed = rows.filter(item => ['matched', 'ignored'].includes(item.status));
    return {
      ...metadata,
      id,
      account,
      transactions: rows,
      file_name: metadata.file_name || 'Extracto importado anteriormente',
      detected_start_on: metadata.detected_start_on || range.start,
      detected_end_on: metadata.detected_end_on || range.end,
      selected_start_on: metadata.selected_start_on || range.start,
      selected_end_on: metadata.selected_end_on || range.end,
      row_count: rows.length || Number(metadata.row_count || 0),
      excluded_count: excluded.length,
      included_count: rows.length - excluded.length,
      processed_count: processed.length,
      canUndo: rows.length > 0 && processed.length === 0,
      status: metadata.status || (excluded.length ? 'partially_excluded' : 'active')
    };
  }).sort((left, right) => (
    String(right.created_at || right.detected_end_on || '').localeCompare(String(left.created_at || left.detected_end_on || ''))
  ));
}
