function cents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 999999.99) throw new Error('Importe no válido.');
  return Math.round(number * 100);
}

export function correctionPayments(transaction) {
  const payments = transaction.payments?.length ? transaction.payments : [{
    method: transaction.paymentMethod, saleAmount: transaction.total,
    amount: transaction.totalCharged ?? (Number(transaction.total) + Number(transaction.tipAmount || 0)),
    tipAmount: transaction.tipAmount || 0
  }];
  return payments.map((payment, index) => ({
    ...payment,
    id: payment.id || `${transaction.id}-payment-${String(index + 1).padStart(3, '0')}`,
    method: payment.method || transaction.paymentMethod,
    saleAmount: Number(payment.saleAmount ?? payment.amount),
    amount: Number(payment.amount), tipAmount: Number(payment.tipAmount || 0)
  }));
}

export function paymentCorrectionSnapshot(transaction) {
  return correctionPayments(transaction).map(({id, method, amount, saleAmount, tipAmount}) => (
    {id, method, amount, saleAmount, tipAmount}
  )).sort((a, b) => a.id.localeCompare(b.id));
}

export function createPaymentCorrectionDraft(transaction) {
  return correctionPayments(transaction).map(payment => ({
    id: payment.id,
    method: /efectivo/i.test(payment.method) ? 'Efectivo' : 'Tarjeta',
    charged: payment.amount.toFixed(2)
  }));
}

// Only the actual card charge can change. The invoiced sale allocation is fixed.
export function buildPaymentCorrection(transaction, draft) {
  const original = correctionPayments(transaction);
  if (!draft.length || draft.length !== original.length || new Set(draft.map(p => p.id)).size !== original.length) {
    throw new Error('No se pueden añadir ni quitar pagos en esta corrección.');
  }
  if (transaction.type === 'refund' || transaction.hasRefund || Number(transaction.refundAmount) > 0) {
    throw new Error('No se puede corregir una venta con devolución.');
  }
  if (original.some(p => /regalo|gift|square/i.test(`${p.method} ${p.provider || ''}`))) {
    throw new Error('Las tarjetas regalo no admiten esta corrección.');
  }
  if (original.reduce((sum, p) => sum + cents(p.saleAmount), 0) !== cents(transaction.total)) {
    throw new Error('El desglose no coincide con la venta. Revisa el ticket antes de corregirlo.');
  }
  const payments = original.map(payment => {
    const edit = draft.find(p => p.id === payment.id);
    if (!edit || !['Efectivo', 'Tarjeta'].includes(edit.method)) throw new Error('Método de pago no válido.');
    const base = cents(payment.saleAmount);
    const text = String(edit.charged ?? '').trim().replace(',', '.');
    if (text && !/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Introduce un importe válido con un máximo de dos decimales.');
    const charged = text ? cents(text) : base;
    if (charged < base) throw new Error('El cobro no puede ser inferior a su parte de la venta.');
    if (edit.method === 'Efectivo' && charged !== base) throw new Error('El importe en efectivo debe coincidir con su parte de la venta.');
    return {...payment, method: edit.method, amount: charged / 100, saleAmount: base / 100,
      tipAmount: (charged - base) / 100, provider: edit.method === 'Tarjeta' ? 'BBVA' : '',
      externalRef: edit.method === 'Tarjeta' ? (payment.externalRef || '') : ''};
  });
  const methods = [...new Set(payments.map(p => p.method))];
  return {payments, paymentMethod: methods.length === 1 ? methods[0] : `Mixto (${payments.length} pagos)`,
    tipAmount: payments.reduce((sum, p) => sum + cents(p.tipAmount), 0) / 100,
    totalCharged: payments.reduce((sum, p) => sum + cents(p.amount), 0) / 100};
}
