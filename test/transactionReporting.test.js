import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransactionPaymentSummary, getTransactionChargedAmount } from '../src/transactionReporting.js';
import { buildSalesReport, REPORT_PAYMENT_METHODS as METHODS } from '../src/salesReporting.js';

const transactions = [
  {
    id: 'cash', createdAt: '2026-09-12T12:00:00Z', total: 28,
    payments: [{ method: 'Efectivo', amount: 28, saleAmount: 28 }]
  },
  {
    id: 'card', createdAt: '2026-09-12T12:00:00Z', total: 462.2, tipAmount: 4.1, totalCharged: 466.3,
    payments: [{ method: 'Tarjeta', amount: 466.3, saleAmount: 462.2, tipAmount: 4.1 }]
  }
];

test('todos muestra el cobro completo de cada ticket y la retirada separada', () => {
  const summary = buildTransactionPaymentSummary(transactions);
  assert.equal(getTransactionChargedAmount(transactions[1], transactions[1].payments), 466.3);
  assert.equal(summary.total, 490.2);
  assert.equal(summary.withdrawnTips, 4.1);
  assert.equal(summary.transactions.length, 2);
});

test('el filtro efectivo resta propinas de tickets que solo se cobraron en tarjeta', () => {
  const summary = buildTransactionPaymentSummary(transactions, { method: METHODS.CASH });
  assert.equal(summary.total, 23.9);
  assert.equal(summary.withdrawnTips, 4.1);
  assert.deepEqual(summary.transactions.map(tx => tx.id), ['cash']);
  assert.equal(summary.transactions[0].total, 28);
});

test('la retirada sigue visible cuando no hay ventas en efectivo', () => {
  const summary = buildTransactionPaymentSummary([transactions[1]], { method: METHODS.CASH });
  assert.equal(summary.total, -4.1);
  assert.equal(summary.withdrawnTips, 4.1);
  assert.equal(summary.transactions.length, 0);
});

test('tarjeta incluye propinas y coincide con el informe, sin descontar la retirada otra vez', () => {
  const summary = buildTransactionPaymentSummary(transactions, { method: METHODS.CARD });
  assert.equal(summary.total, 466.3);
  assert.equal(summary.withdrawnTips, 0);
  const report = buildSalesReport(transactions);
  for (const method of [METHODS.CARD, METHODS.CASH, METHODS.GIFT_CARD]) {
    assert.equal(buildTransactionPaymentSummary(transactions, { method }).total, report.paymentMethods[method]);
  }
});

test('pagos divididos filtran solo su parte y las devoluciones antiguas conservan signo negativo', () => {
  const mixed = {
    total: 30, totalCharged: 32, tipAmount: 2,
    payments: [
      { method: 'Efectivo', amount: 10, saleAmount: 10 },
      { method: 'Tarjeta', amount: 12, saleAmount: 10, tipAmount: 2 },
      { method: 'Tarjeta Regalo', amount: 10, saleAmount: 10 }
    ]
  };
  const refund = { type: 'refund', total: -5, payments: [{ method: 'Tarjeta', amount: 5 }] };
  assert.equal(getTransactionChargedAmount(mixed, mixed.payments, METHODS.CARD), 12);
  assert.equal(buildTransactionPaymentSummary([mixed, refund], { method: METHODS.CARD }).total, 7);
  assert.equal(buildTransactionPaymentSummary([mixed, refund], { method: METHODS.CASH }).total, 8);
  assert.equal(buildTransactionPaymentSummary([mixed, refund], { method: METHODS.GIFT_CARD }).total, 10);
  assert.equal(buildTransactionPaymentSummary([mixed, refund]).total, 25);
});

test('sin propinas no se cambia el importe ni se crea una retirada', () => {
  const summary = buildTransactionPaymentSummary([transactions[0]]);
  assert.equal(summary.total, 28);
  assert.equal(summary.withdrawnTips, 0);
});
