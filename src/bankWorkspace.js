import {
  bankDirection,
  classificationDefinition,
  outstandingDocumentsForTransaction,
  suggestBankClassification
} from './bankReview.js';
import { isBankTransactionIncluded } from './bankImports.js';

const STATUS_PRIORITY = {
  ready_match: 0,
  possible_document: 1,
  missing_document: 2,
  needs_classification: 3
};

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

function closeEnough(transaction, document) {
  const target = Math.abs(Number(transaction?.amount || 0));
  const outstanding = Math.abs(Number(document?.outstanding || 0));
  return Math.abs(target - outstanding) <= Math.max(0.01, Math.min(5, target * 0.03));
}

function statusMatchesFilter(status, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'ready') return ['ready_match', 'possible_document'].includes(status);
  if (filter === 'missing') return status === 'missing_document';
  if (filter === 'classify') return status === 'needs_classification';
  return true;
}

function itemSearchText(item) {
  const candidate = item.candidate || {};
  return normalize([
    item.transaction?.booked_on,
    item.transaction?.description,
    item.transaction?.reference,
    item.transaction?.amount,
    candidate.number,
    candidate.accounting_contacts?.name,
    item.classification?.label
  ].join(' '));
}

export function buildBankWorkspace({
  transactions = [],
  reconciliations = [],
  reviews = [],
  documents = [],
  search = '',
  direction = 'all',
  filter = 'all'
} = {}) {
  const suggestedByTransaction = new Map();
  reconciliations
    .filter(item => item.status === 'suggested')
    .forEach(item => {
      const current = suggestedByTransaction.get(item.bank_transaction_id);
      if (!current || Number(item.score || 0) > Number(current.score || 0)) {
        suggestedByTransaction.set(item.bank_transaction_id, item);
      }
    });

  const waitingByTransaction = new Map(reviews
    .filter(item => item.status === 'waiting_document')
    .map(item => [item.bank_transaction_id, item]));

  const allItems = transactions
    .filter(transaction => transaction.status === 'pending' && isBankTransactionIncluded(transaction))
    .map(transaction => {
      const reconciliation = suggestedByTransaction.get(transaction.id) || null;
      const waitingReview = waitingByTransaction.get(transaction.id) || null;
      const candidates = reconciliation ? [] : outstandingDocumentsForTransaction(transaction, documents);
      const candidate = candidates.find(document => closeEnough(transaction, document)) || null;
      const suggestionValue = suggestBankClassification(transaction);
      const classification = classificationDefinition(suggestionValue);
      const directionValue = bankDirection(transaction);
      let status = 'needs_classification';

      if (reconciliation) status = 'ready_match';
      else if (waitingReview) status = 'missing_document';
      else if (candidate) status = 'possible_document';
      else if (directionValue === 'out' && !classification) status = 'missing_document';

      return {
        id: reconciliation?.id || transaction.id,
        transaction,
        reconciliation,
        waitingReview,
        candidates,
        candidate,
        classification,
        status,
        action: reconciliation ? 'reconciliation' : 'bank-review'
      };
    })
    .sort((left, right) => (
      (STATUS_PRIORITY[left.status] ?? 9) - (STATUS_PRIORITY[right.status] ?? 9)
      || String(right.transaction.booked_on || '').localeCompare(String(left.transaction.booked_on || ''))
      || String(left.transaction.id || '').localeCompare(String(right.transaction.id || ''))
    ));

  const term = normalize(search);
  const items = allItems
    .filter(item => direction === 'all' || bankDirection(item.transaction) === direction)
    .filter(item => statusMatchesFilter(item.status, filter))
    .filter(item => !term || itemSearchText(item).includes(term));

  const completedCount = transactions.filter(transaction => (
    isBankTransactionIncluded(transaction) && ['matched', 'ignored'].includes(transaction.status)
  )).length;
  const stats = {
    pending: allItems.length,
    ready: allItems.filter(item => ['ready_match', 'possible_document'].includes(item.status)).length,
    missing: allItems.filter(item => item.status === 'missing_document').length,
    classify: allItems.filter(item => item.status === 'needs_classification').length,
    completed: completedCount
  };

  return {
    items,
    allItems,
    stats,
    next: allItems[0] || null,
    hasActiveFilters: Boolean(term || direction !== 'all' || filter !== 'all')
  };
}

export function bankWorkspaceStatus(status) {
  return ({
    ready_match: {
      label: 'Coincidencia lista',
      tone: 'success',
      explanation: 'Compara el banco y la factura antes de confirmar.'
    },
    possible_document: {
      label: 'Factura posible',
      tone: 'success',
      explanation: 'Hay un documento con un importe compatible.'
    },
    missing_document: {
      label: 'Falta justificar',
      tone: 'danger',
      explanation: 'Busca o solicita la factura. El pago aún no se deduce.'
    },
    needs_classification: {
      label: 'Identificar movimiento',
      tone: 'warning',
      explanation: 'Indica qué representa sin volver a contar ventas del TPV.'
    }
  })[status] || { label: 'Pendiente', tone: 'warning', explanation: 'Revisa este movimiento.' };
}
