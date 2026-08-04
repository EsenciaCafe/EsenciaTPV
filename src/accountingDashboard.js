const ACCOUNTED_STATUSES = new Set([
  'approved',
  'partially_paid',
  'paid',
  'overdue',
  'rectified'
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function localDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function daysBetween(start, end) {
  return Math.floor((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
    - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / DAY_MS);
}

function naturalPeriodStart(period, anchor) {
  if (period === 'year') return new Date(anchor.getFullYear(), 0, 1);
  if (period === 'quarter') {
    return new Date(anchor.getFullYear(), Math.floor(anchor.getMonth() / 3) * 3, 1);
  }
  return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
}

function previousPeriodStart(period, start) {
  if (period === 'year') return new Date(start.getFullYear() - 1, 0, 1);
  if (period === 'quarter') return new Date(start.getFullYear(), start.getMonth() - 3, 1);
  return new Date(start.getFullYear(), start.getMonth() - 1, 1);
}

function naturalPeriodEnd(period, start) {
  if (period === 'year') return new Date(start.getFullYear(), 11, 31);
  if (period === 'quarter') return new Date(start.getFullYear(), start.getMonth() + 3, 0);
  return new Date(start.getFullYear(), start.getMonth() + 1, 0);
}

export function periodBounds(period = 'month', anchorValue = new Date()) {
  const anchor = localDate(anchorValue) || localDate(new Date());
  const start = naturalPeriodStart(period, anchor);
  const end = anchor < naturalPeriodEnd(period, start) ? anchor : naturalPeriodEnd(period, start);
  const comparisonStart = previousPeriodStart(period, start);
  const comparisonNaturalEnd = naturalPeriodEnd(period, comparisonStart);
  const elapsedDays = Math.max(1, daysBetween(start, end) + 1);
  const comparisonEnd = addDays(comparisonStart, elapsedDays - 1) < comparisonNaturalEnd
    ? addDays(comparisonStart, elapsedDays - 1)
    : comparisonNaturalEnd;

  return { period, anchor, start, end, comparisonStart, comparisonEnd };
}

export function isAccountedDocument(document) {
  return ACCOUNTED_STATUSES.has(document?.status);
}

function inRange(value, start, end) {
  const date = localDate(value);
  return Boolean(date && date >= start && date <= end);
}

function summarizeDocuments(documents, start, end) {
  const periodDocuments = documents.filter(document => (
    isAccountedDocument(document) && inRange(document.issue_date, start, end)
  ));
  const sales = periodDocuments.filter(document => document.direction === 'sale');
  const purchases = periodDocuments.filter(document => document.direction === 'purchase');
  const salesBase = sales.reduce((sum, document) => sum + amount(document.subtotal), 0);
  const salesTotal = sales.reduce((sum, document) => sum + amount(document.total_amount), 0);
  const expensesBase = purchases.reduce((sum, document) => sum + amount(document.subtotal), 0);
  const expensesTotal = purchases.reduce((sum, document) => sum + amount(document.total_amount), 0);
  const outputTax = sales.reduce((sum, document) => sum + amount(document.tax_amount), 0);
  const inputTax = purchases.reduce((sum, document) => sum + amount(document.tax_amount), 0);
  const result = salesBase - expensesBase;
  const ticketDocuments = sales.filter(document => (
    document.source_type === 'tpv' && document.document_type !== 'credit_note' && amount(document.total_amount) > 0
  ));
  const ticketNetTotal = sales
    .filter(document => document.source_type === 'tpv')
    .reduce((sum, document) => sum + amount(document.total_amount), 0);

  return {
    salesBase,
    salesTotal,
    expensesBase,
    expensesTotal,
    outputTax,
    inputTax,
    taxResult: outputTax - inputTax,
    result,
    margin: salesBase ? (result / salesBase) * 100 : null,
    estimatedIrpf: Math.max(result * 0.20, 0),
    salesCount: sales.length,
    purchaseCount: purchases.length,
    averageTicket: ticketDocuments.length ? ticketNetTotal / ticketDocuments.length : null
  };
}

function remainingAmount(document) {
  return Math.max(0, amount(document.total_amount) - amount(document.paid_amount));
}

function latestAccountBalances(bankAccounts, bankTransactions) {
  const latest = new Map();
  bankTransactions.forEach(transaction => {
    if (transaction.balance == null || !transaction.bank_account_id) return;
    const current = latest.get(transaction.bank_account_id);
    const candidateKey = `${transaction.booked_on || ''}|${transaction.created_at || ''}`;
    const currentKey = current ? `${current.booked_on || ''}|${current.created_at || ''}` : '';
    if (!current || candidateKey > currentKey) latest.set(transaction.bank_account_id, transaction);
  });

  const activeAccounts = bankAccounts.filter(account => account.active !== false);
  return {
    hasBalance: activeAccounts.length > 0,
    balance: activeAccounts.reduce((sum, account) => (
      sum + amount(latest.get(account.id)?.balance ?? account.opening_balance)
    ), 0),
    latestDate: [...latest.values()].reduce((value, transaction) => (
      !value || String(transaction.booked_on) > value ? String(transaction.booked_on) : value
    ), '')
  };
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthlyTrend(documents, anchor, length = 6) {
  return Array.from({ length }, (_, index) => {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() - (length - 1 - index), 1);
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const summary = summarizeDocuments(documents, start, end);
    return {
      key: monthKey(date),
      date,
      sales: summary.salesBase,
      expenses: summary.expensesBase,
      result: summary.result
    };
  });
}

export function percentageChange(current, previous) {
  if (Math.abs(previous) < 0.005) return Math.abs(current) < 0.005 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function buildBusinessSnapshot({
  documents = [],
  bankAccounts = [],
  bankTransactions = [],
  period = 'month',
  anchor = new Date()
} = {}) {
  const bounds = periodBounds(period, anchor);
  const current = summarizeDocuments(documents, bounds.start, bounds.end);
  const previous = summarizeDocuments(documents, bounds.comparisonStart, bounds.comparisonEnd);
  const bankPeriod = bankTransactions.filter(transaction => (
    inRange(transaction.booked_on, bounds.start, bounds.end)
  ));
  const accounted = documents.filter(isAccountedDocument);
  const unpaid = accounted.filter(document => remainingAmount(document) > 0.005);
  const cash = latestAccountBalances(bankAccounts, bankTransactions);
  const today = bounds.anchor;

  return {
    bounds,
    current,
    previous,
    changes: {
      sales: percentageChange(current.salesBase, previous.salesBase),
      expenses: percentageChange(current.expensesBase, previous.expensesBase),
      result: percentageChange(current.result, previous.result)
    },
    treasury: {
      ...cash,
      inflows: bankPeriod.filter(transaction => amount(transaction.amount) > 0)
        .reduce((sum, transaction) => sum + amount(transaction.amount), 0),
      outflows: Math.abs(bankPeriod.filter(transaction => amount(transaction.amount) < 0)
        .reduce((sum, transaction) => sum + amount(transaction.amount), 0)),
      pendingCount: bankTransactions.filter(transaction => transaction.status === 'pending').length
    },
    pending: {
      receivable: unpaid.filter(document => document.direction === 'sale')
        .reduce((sum, document) => sum + remainingAmount(document), 0),
      payable: unpaid.filter(document => document.direction === 'purchase')
        .reduce((sum, document) => sum + remainingAmount(document), 0),
      overdueCount: unpaid.filter(document => {
        const dueDate = localDate(document.due_date);
        return document.status === 'overdue' || Boolean(dueDate && dueDate < today);
      }).length
    },
    quality: {
      documentsToReview: documents.filter(document => ['draft', 'needs_review'].includes(document.status)).length,
      purchaseAmountToReview: documents
        .filter(document => document.direction === 'purchase' && ['draft', 'needs_review'].includes(document.status))
        .reduce((sum, document) => sum + amount(document.total_amount), 0)
    },
    trend: monthlyTrend(documents, bounds.anchor)
  };
}
