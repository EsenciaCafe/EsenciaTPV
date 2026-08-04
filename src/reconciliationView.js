function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value) {
  return Math.round(amount(value) * 100) / 100;
}

function dateValue(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function referenceToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]/g, '');
}

export function reconciliationDateDifference(bankDate, documentDate) {
  const bank = dateValue(bankDate);
  const document = dateValue(documentDate);
  return bank == null || document == null ? null : Math.round(Math.abs(bank - document) / 86400000);
}

export function buildReconciliationComparison({ match = {}, bankTransaction, document } = {}) {
  const bankAmount = Math.abs(cents(bankTransaction?.amount));
  const documentTotal = Math.abs(cents(document?.total_amount));
  const documentPaid = Math.abs(cents(document?.paid_amount));
  const outstanding = cents(Math.max(0, documentTotal - documentPaid));
  const reconciliationAmount = Math.abs(cents(match.amount));
  const amountDifference = cents(Math.abs(bankAmount - outstanding));
  const dateDifference = reconciliationDateDifference(bankTransaction?.booked_on, document?.issue_date);
  const reference = referenceToken(bankTransaction?.reference || bankTransaction?.description);
  const documentNumber = referenceToken(document?.number);
  const referenceMatches = documentNumber.length >= 4 && reference.length >= 4
    ? reference.includes(documentNumber) || documentNumber.includes(reference)
    : null;
  const warnings = [];

  if (!bankTransaction) warnings.push('No se ha encontrado el movimiento bancario.');
  if (!document) warnings.push('No se ha encontrado el documento contable.');
  if (bankTransaction && document && amountDifference > 0.01) {
    warnings.push(`El movimiento y el importe pendiente difieren en ${amountDifference.toFixed(2)} €.`);
  }
  if (dateDifference != null && dateDifference > 7) {
    warnings.push(`Las fechas están separadas por ${dateDifference} días.`);
  }
  if (referenceMatches === false) {
    warnings.push('La referencia bancaria no contiene el número del documento.');
  }
  if (reconciliationAmount <= 0) warnings.push('El importe a conciliar debe ser mayor que cero.');
  if (document && reconciliationAmount - outstanding > 0.01) {
    warnings.push('El importe propuesto supera lo que queda pendiente en el documento.');
  }
  if (bankTransaction && reconciliationAmount - bankAmount > 0.01) {
    warnings.push('El importe propuesto supera el movimiento bancario.');
  }

  return {
    bankAmount,
    documentTotal,
    documentPaid,
    outstanding,
    reconciliationAmount,
    amountDifference,
    amountMatches: amountDifference <= 0.01,
    dateDifference,
    referenceMatches,
    warnings,
    canConfirm: Boolean(bankTransaction && document && reconciliationAmount > 0
      && reconciliationAmount - outstanding <= 0.01
      && reconciliationAmount - bankAmount <= 0.01)
  };
}

export function reconciliationsByStatus(reconciliations = [], status = 'suggested') {
  return reconciliations.filter(item => item.status === status);
}
