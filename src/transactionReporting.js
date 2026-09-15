import { getSignedChargedPaymentAmount } from './paymentAccounting.js';
import { classifyReportPaymentMethod, REPORT_PAYMENT_METHODS } from './salesReporting.js';

export function getTransactionChargedAmount(transaction, payments, method = null) {
  if (!method) {
    if (transaction.type === 'refund') return -Math.abs(Number(transaction.total || 0));
    return Number(transaction.totalCharged ?? (
      Number(transaction.total || 0) + Math.max(0, Number(transaction.tipAmount || 0))
    ));
  }
  return payments.reduce((sum, payment) => (
    classifyReportPaymentMethod(payment.method || transaction.paymentMethod) === method
      ? sum + getSignedChargedPaymentAmount(transaction, payment)
      : sum
  ), 0);
}

// Pass the full day's transactions so cash withdrawals include card-only tickets.
export function buildTransactionPaymentSummary(transactions, {
  method = null,
  getPayments = transaction => transaction.payments || []
} = {}) {
  const visibleTransactions = method
    ? transactions.filter(transaction => getPayments(transaction).some(payment => (
        classifyReportPaymentMethod(payment.method || transaction.paymentMethod) === method
      )))
    : transactions;
  const withdrawnTips = !method || method === REPORT_PAYMENT_METHODS.CASH
    ? transactions.reduce((sum, transaction) => (
        transaction.type === 'refund' ? sum : sum + Math.max(0, Number(transaction.tipAmount || 0))
      ), 0)
    : 0;
  const charged = visibleTransactions.reduce((sum, transaction) => (
    sum + getTransactionChargedAmount(transaction, getPayments(transaction), method)
  ), 0);
  return {
    transactions: visibleTransactions,
    withdrawnTips: Number(withdrawnTips.toFixed(2)),
    total: Number((charged - withdrawnTips).toFixed(2))
  };
}
