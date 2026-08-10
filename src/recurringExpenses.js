const ACCOUNTED_STATUSES = new Set(['approved', 'partially_paid', 'paid', 'overdue', 'rectified']);
const PENDING_STATUSES = new Set(['draft', 'needs_review']);

export const RECURRING_FREQUENCIES = [
  { value: 'monthly', label: 'Cada mes' },
  { value: 'quarterly', label: 'Cada 3 meses' },
  { value: 'yearly', label: 'Una vez al año' }
];

function dateFrom(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function monthStart(value) {
  const date = value instanceof Date ? value : dateFrom(value);
  return date ? new Date(date.getFullYear(), date.getMonth(), 1) : null;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthDifference(start, end) {
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function recurringPeriodKey(value) {
  const date = value instanceof Date ? value : dateFrom(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function expectedDateForMonth(expense, monthValue) {
  const month = monthStart(monthValue);
  const start = monthStart(expense?.start_on);
  if (!month || !start) return null;
  const elapsed = monthDifference(start, month);
  if (elapsed < 0) return null;
  const interval = expense.frequency === 'yearly' ? 12 : expense.frequency === 'quarterly' ? 3 : 1;
  if (elapsed % interval !== 0) return null;
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const dueDay = Math.max(1, Math.min(lastDay, Number(expense.due_day || 1)));
  return new Date(month.getFullYear(), month.getMonth(), dueDay);
}

function documentDateInMonth(document, month) {
  const date = dateFrom(document?.issue_date);
  return Boolean(date && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth());
}

function supplierName(document) {
  return document?.accounting_contacts?.name || document?.supplier_name || '';
}

function matchesExpense(document, expense) {
  if (document?.direction !== 'purchase' || document?.status === 'voided') return false;
  if (expense.contact_id && document.contact_id === expense.contact_id) return true;
  const expectedName = normalizeText(expense.name);
  const actualName = normalizeText(supplierName(document));
  return Boolean(expectedName && actualName && (actualName.includes(expectedName) || expectedName.includes(actualName)));
}

function chooseDocument(candidates, expectedAmount) {
  return [...candidates].sort((left, right) => {
    const leftPending = PENDING_STATUSES.has(left.status) ? 1 : 0;
    const rightPending = PENDING_STATUSES.has(right.status) ? 1 : 0;
    if (leftPending !== rightPending) return leftPending - rightPending;
    return Math.abs(amount(left.total_amount) - expectedAmount) - Math.abs(amount(right.total_amount) - expectedAmount);
  })[0] || null;
}

export function buildRecurringExpenseReview({
  expenses = [],
  occurrences = [],
  documents = [],
  anchor = new Date(),
  lookbackMonths = 1
} = {}) {
  const today = anchor instanceof Date ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()) : dateFrom(anchor);
  const currentMonth = monthStart(today);
  if (!currentMonth) return { items: [], summary: { missing: 0, pending: 0, accounted: 0, upcoming: 0, skipped: 0 } };
  const occurrenceByRuleAndPeriod = new Map(occurrences.map(item => [
    `${item.recurring_expense_id}|${item.period_key}`,
    item
  ]));
  const documentById = new Map(documents.map(document => [document.id, document]));
  const usedDocumentIds = new Set();
  const items = [];

  for (let offset = -Math.max(0, lookbackMonths); offset <= 0; offset += 1) {
    const month = addMonths(currentMonth, offset);
    expenses.filter(expense => expense.active !== false).forEach(expense => {
      const expectedOn = expectedDateForMonth(expense, month);
      if (!expectedOn) return;
      const periodKey = recurringPeriodKey(month);
      const occurrence = occurrenceByRuleAndPeriod.get(`${expense.id}|${periodKey}`);
      const linkedDocument = occurrence?.document_id ? documentById.get(occurrence.document_id) : null;
      let matchedDocument = linkedDocument || null;
      if (!matchedDocument && occurrence?.status !== 'skipped') {
        matchedDocument = chooseDocument(documents.filter(document => (
          !usedDocumentIds.has(document.id)
          && documentDateInMonth(document, month)
          && matchesExpense(document, expense)
        )), amount(expense.expected_amount));
      }
      if (matchedDocument) usedDocumentIds.add(matchedDocument.id);

      let status = 'upcoming';
      if (occurrence?.status === 'skipped') status = 'skipped';
      else if (matchedDocument && ACCOUNTED_STATUSES.has(matchedDocument.status)) status = 'accounted';
      else if (matchedDocument) status = 'pending';
      else if (expectedOn <= today) status = 'missing';

      items.push({
        expense,
        occurrence,
        document: matchedDocument,
        periodKey,
        expectedOn,
        status,
        expectedAmount: amount(expense.expected_amount)
      });
    });
  }

  const priority = { missing: 0, pending: 1, upcoming: 2, accounted: 3, skipped: 4 };
  items.sort((left, right) => priority[left.status] - priority[right.status]
    || left.expectedOn - right.expectedOn
    || left.expense.name.localeCompare(right.expense.name, 'es'));
  const summary = { missing: 0, pending: 0, accounted: 0, upcoming: 0, skipped: 0 };
  items.forEach(item => { summary[item.status] += 1; });
  return { items, summary };
}

export function recurringFrequencyLabel(value) {
  return RECURRING_FREQUENCIES.find(item => item.value === value)?.label || 'Cada mes';
}
