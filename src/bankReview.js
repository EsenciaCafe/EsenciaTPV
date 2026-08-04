export const BANK_CLASSIFICATIONS = [
  {
    value: 'tpv_card_settlement',
    label: 'Cobro del datáfono / TPV',
    directions: ['in'],
    effect: 'No vuelve a sumar una venta. Registra el dinero recibido como liquidación de ventas ya existentes.',
    keywords: [/liquidacion remesa/, /remesa de comercios/, /tarjetas de credito/]
  },
  {
    value: 'cash_deposit',
    label: 'Ingreso de efectivo en el banco',
    directions: ['in'],
    effect: 'Mueve dinero de caja a banco sin crear un ingreso nuevo.',
    keywords: [/ingreso en efectivo/, /ingreso cajero/]
  },
  {
    value: 'owner_contribution',
    label: 'Aportación del titular',
    directions: ['in'],
    effect: 'Aumenta el banco, pero no se considera una venta del negocio.',
    keywords: [/aportacion/, /traspaso.*titular/]
  },
  {
    value: 'owner_withdrawal',
    label: 'Retirada o traspaso del titular',
    directions: ['out'],
    effect: 'Reduce el banco, pero no se considera un gasto del negocio.',
    keywords: [/traspaso a cuenta/, /retirada titular/]
  },
  {
    value: 'tax_payment',
    label: 'Pago de impuestos',
    directions: ['out'],
    effect: 'Registra la salida fiscal sin tratarla automáticamente como gasto operativo.',
    keywords: [/impuesto/, /agencia tributaria/, /nrc/]
  },
  {
    value: 'bank_fee',
    label: 'Comisión bancaria',
    directions: ['out'],
    effect: 'Crea un gasto pagado sin IGIC deducible y lo incluye en la rentabilidad.',
    keywords: [/comision/, /servicio bancario/]
  },
  {
    value: 'social_security',
    label: 'Seguridad Social',
    directions: ['out'],
    effect: 'Crea un gasto pagado sin IGIC y lo incluye en la rentabilidad.',
    keywords: [/seguridad social/, /tgss/]
  },
  {
    value: 'expense_without_invoice',
    label: 'Gasto sin factura justificativa',
    directions: ['out'],
    effect: 'Crea un gasto pagado con IGIC cero. Si aparece la factura, conviene deshacerlo y vincularla.',
    keywords: []
  },
  {
    value: 'other_income',
    label: 'Otro ingreso ajeno al TPV',
    directions: ['in'],
    effect: 'Crea un ingreso pagado. No lo uses para liquidaciones del datáfono ni ingresos de efectivo.',
    keywords: []
  },
  {
    value: 'ignore',
    label: 'Ignorar duplicado o movimiento de prueba',
    directions: ['in', 'out'],
    effect: 'No crea documentos ni asientos. El movimiento queda registrado como ignorado.',
    keywords: [/duplicado/, /prueba/]
  }
];

const CLASSIFICATION_BY_VALUE = new Map(BANK_CLASSIFICATIONS.map(item => [item.value, item]));

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

export function bankDirection(transaction = {}) {
  return Number(transaction.amount || 0) >= 0 ? 'in' : 'out';
}

export function classificationDefinition(value) {
  return CLASSIFICATION_BY_VALUE.get(value) || null;
}

export function classificationsForTransaction(transaction = {}) {
  const direction = bankDirection(transaction);
  return BANK_CLASSIFICATIONS.filter(item => item.directions.includes(direction));
}

export function suggestBankClassification(transaction = {}) {
  const direction = bankDirection(transaction);
  const text = normalize(`${transaction.description || ''} ${transaction.reference || ''}`);
  return BANK_CLASSIFICATIONS.find(item => item.directions.includes(direction)
    && item.keywords.some(pattern => pattern.test(text)))?.value || '';
}

export function outstandingDocumentsForTransaction(transaction = {}, documents = []) {
  const expectedDirection = bankDirection(transaction) === 'in' ? 'sale' : 'purchase';
  const target = Math.abs(Number(transaction.amount || 0));
  return documents
    .filter(document => document.direction === expectedDirection)
    .filter(document => ['approved', 'partially_paid', 'overdue'].includes(document.status))
    .map(document => ({
      ...document,
      outstanding: Math.max(0, Math.round((Number(document.total_amount || 0) - Number(document.paid_amount || 0)) * 100) / 100)
    }))
    .filter(document => document.outstanding + 0.01 >= target)
    .sort((left, right) => {
      const amountDifference = Math.abs(left.outstanding - target) - Math.abs(right.outstanding - target);
      return amountDifference || String(right.issue_date || '').localeCompare(String(left.issue_date || ''));
    });
}

export function pendingBankTransactions({
  transactions = [], reconciliations = [], search = '', direction = 'all'
} = {}) {
  const activeBankIds = new Set(reconciliations
    .filter(item => ['suggested', 'confirmed'].includes(item.status))
    .map(item => item.bank_transaction_id));
  const term = normalize(search);
  return transactions
    .filter(transaction => transaction.status === 'pending' && !activeBankIds.has(transaction.id))
    .filter(transaction => direction === 'all' || bankDirection(transaction) === direction)
    .filter(transaction => !term || normalize(`${transaction.description} ${transaction.reference} ${transaction.amount}`).includes(term));
}
