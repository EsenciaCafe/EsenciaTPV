export function getSignedPaymentAmount(transaction = {}, payment = {}) {
  const rawAmount = Number(payment.saleAmount ?? payment.amount ?? 0);
  if (!Number.isFinite(rawAmount)) return 0;
  return transaction.type === 'refund' ? -Math.abs(rawAmount) : rawAmount;
}

export function addPaymentToBuckets(transaction = {}, payment = {}, buckets = {}, resolveBucket) {
  const bucket = resolveBucket(payment.method || transaction.paymentMethod || '');
  if (!(bucket in buckets)) buckets[bucket] = 0;
  buckets[bucket] += getSignedPaymentAmount(transaction, payment);
  return buckets;
}

export function reconcileTransactionPayments(transactions = [], getPayments = transaction => transaction.payments || []) {
  const transactionNet = transactions.reduce((sum, transaction) => (
    sum + Number(transaction.total || 0)
  ), 0);
  const paymentNet = transactions.reduce((sum, transaction) => (
    sum + getPayments(transaction).reduce((paymentSum, payment) => (
      paymentSum + getSignedPaymentAmount(transaction, payment)
    ), 0)
  ), 0);
  const roundedTransactionNet = Number(transactionNet.toFixed(2));
  const roundedPaymentNet = Number(paymentNet.toFixed(2));
  const difference = Number((roundedPaymentNet - roundedTransactionNet).toFixed(2));
  return {
    transactionNet: roundedTransactionNet,
    paymentNet: roundedPaymentNet,
    difference,
    isBalanced: Math.abs(difference) < 0.01
  };
}
