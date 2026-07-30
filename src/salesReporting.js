import { getSignedPaymentAmount } from './paymentAccounting.js';

export const REPORT_PAYMENT_METHODS = Object.freeze({
  CASH: 'Efectivo',
  CARD: 'Tarjeta bancaria',
  GIFT_CARD: 'Tarjeta regalo',
  UNCLASSIFIED: 'Sin clasificar'
});

const roundMoney = value => Number(Number(value || 0).toFixed(2));

export function classifyReportPaymentMethod(method = '') {
  const normalized = String(method || '').trim().toLowerCase();
  if (normalized.includes('efectivo') || normalized.includes('cash')) {
    return REPORT_PAYMENT_METHODS.CASH;
  }
  if (normalized.includes('regalo') || normalized.includes('gift')) {
    return REPORT_PAYMENT_METHODS.GIFT_CARD;
  }
  if (normalized.includes('tarjeta') || normalized.includes('card') || normalized.includes('bbva')) {
    return REPORT_PAYMENT_METHODS.CARD;
  }
  return REPORT_PAYMENT_METHODS.UNCLASSIFIED;
}

function createPaymentTotals() {
  return {
    [REPORT_PAYMENT_METHODS.CASH]: 0,
    [REPORT_PAYMENT_METHODS.CARD]: 0,
    [REPORT_PAYMENT_METHODS.GIFT_CARD]: 0,
    [REPORT_PAYMENT_METHODS.UNCLASSIFIED]: 0
  };
}

function getLocalDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function roundPaymentTotals(paymentMethods) {
  return Object.fromEntries(
    Object.entries(paymentMethods).map(([method, amount]) => [method, roundMoney(amount)])
  );
}

export function buildSalesReport(
  transactions = [],
  {
    getTransactionDate = transaction => new Date(transaction.createdAt || Date.now()),
    getPayments = transaction => transaction.payments || []
  } = {}
) {
  const report = {
    ticketCount: 0,
    grossSales: 0,
    discounts: 0,
    refunds: 0,
    netSales: 0,
    tips: 0,
    paymentMethods: createPaymentTotals(),
    paymentNet: 0,
    days: []
  };
  const daily = new Map();

  transactions.forEach(transaction => {
    const date = getTransactionDate(transaction);
    const dayKey = getLocalDateKey(date);
    if (!daily.has(dayKey)) {
      daily.set(dayKey, {
        key: dayKey,
        day: date.getDate(),
        date,
        ticketCount: 0,
        grossSales: 0,
        discounts: 0,
        refunds: 0,
        netSales: 0,
        tips: 0,
        paymentMethods: createPaymentTotals(),
        paymentNet: 0
      });
    }

    const day = daily.get(dayKey);
    const total = Number(transaction.total || 0);
    const isRefund = transaction.type === 'refund';

    report.netSales += total;
    day.netSales += total;

    if (isRefund) {
      const refundAmount = Math.abs(total);
      report.refunds += refundAmount;
      day.refunds += refundAmount;
    } else {
      const discount = Number(transaction.discountTotal || 0);
      const gross = Number(transaction.grossTotal ?? (total + discount));
      const tip = Math.max(0, Number(transaction.tipAmount || 0));
      report.ticketCount += 1;
      report.grossSales += gross;
      report.discounts += discount;
      report.tips += tip;
      day.ticketCount += 1;
      day.grossSales += gross;
      day.discounts += discount;
      day.tips += tip;
    }

    getPayments(transaction).forEach(payment => {
      const method = classifyReportPaymentMethod(payment.method || transaction.paymentMethod || '');
      const amount = getSignedPaymentAmount(transaction, payment);
      report.paymentMethods[method] += amount;
      report.paymentNet += amount;
      day.paymentMethods[method] += amount;
      day.paymentNet += amount;
    });
  });

  report.ticketCount = Number(report.ticketCount);
  report.grossSales = roundMoney(report.grossSales);
  report.discounts = roundMoney(report.discounts);
  report.refunds = roundMoney(report.refunds);
  report.netSales = roundMoney(report.netSales);
  report.tips = roundMoney(report.tips);
  report.paymentMethods = roundPaymentTotals(report.paymentMethods);
  report.paymentNet = roundMoney(report.paymentNet);
  report.paymentDifference = roundMoney(report.paymentNet - report.netSales);
  report.isPaymentBalanced = Math.abs(report.paymentDifference) < 0.01;
  report.cardTerminalTotal = roundMoney(
    report.paymentMethods[REPORT_PAYMENT_METHODS.CARD] + report.tips
  );
  report.cashDrawerMovement = roundMoney(
    report.paymentMethods[REPORT_PAYMENT_METHODS.CASH] - report.tips
  );
  report.days = [...daily.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(day => ({
      ...day,
      grossSales: roundMoney(day.grossSales),
      discounts: roundMoney(day.discounts),
      refunds: roundMoney(day.refunds),
      netSales: roundMoney(day.netSales),
      tips: roundMoney(day.tips),
      paymentMethods: roundPaymentTotals(day.paymentMethods),
      paymentNet: roundMoney(day.paymentNet),
      paymentDifference: roundMoney(day.paymentNet - day.netSales)
    }));

  return report;
}
