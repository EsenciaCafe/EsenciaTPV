import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSalesReport,
  REPORT_PAYMENT_METHODS
} from '../src/salesReporting.js';

const date = '2026-07-18T12:00:00.000Z';

test('concilia ventas, descuentos, devoluciones, propinas y los tres metodos de pago', () => {
  const report = buildSalesReport([
    {
      type: 'sale',
      createdAt: date,
      total: 100,
      grossTotal: 106,
      discountTotal: 6,
      payments: [{ method: 'Efectivo', amount: 100, saleAmount: 100 }]
    },
    {
      type: 'sale',
      createdAt: date,
      total: 51.1,
      payments: [
        { method: 'Tarjeta Regalo', amount: 30, saleAmount: 30 },
        { method: 'Tarjeta', amount: 21.1, saleAmount: 21.1 }
      ]
    },
    {
      type: 'sale',
      createdAt: date,
      total: 20,
      tipAmount: 5,
      totalCharged: 25,
      payments: [{ method: 'Tarjeta', amount: 25, saleAmount: 20, tipAmount: 5 }]
    },
    {
      type: 'refund',
      createdAt: date,
      total: -13,
      payments: [{ method: 'Tarjeta', amount: -13 }]
    }
  ]);

  assert.equal(report.ticketCount, 3);
  assert.equal(report.grossSales, 177.1);
  assert.equal(report.discounts, 6);
  assert.equal(report.refunds, 13);
  assert.equal(report.netSales, 158.1);
  assert.equal(report.tips, 5);
  assert.deepEqual(report.paymentMethods, {
    [REPORT_PAYMENT_METHODS.CASH]: 100,
    [REPORT_PAYMENT_METHODS.CARD]: 28.1,
    [REPORT_PAYMENT_METHODS.GIFT_CARD]: 30,
    [REPORT_PAYMENT_METHODS.UNCLASSIFIED]: 0
  });
  assert.equal(report.paymentNet, 158.1);
  assert.equal(report.paymentDifference, 0);
  assert.equal(report.isPaymentBalanced, true);
  assert.equal(report.cardTerminalTotal, 33.1);
  assert.equal(report.cashDrawerMovement, 95);
  assert.equal(report.days.length, 1);
  assert.equal(report.days[0].netSales, report.netSales);
  assert.deepEqual(report.days[0].paymentMethods, report.paymentMethods);
});

test('no mezcla tarjeta regalo con tarjeta bancaria', () => {
  const report = buildSalesReport([{
    type: 'sale',
    createdAt: date,
    total: 30,
    payments: [{ method: 'Tarjeta Regalo', amount: 30 }]
  }]);

  assert.equal(report.paymentMethods[REPORT_PAYMENT_METHODS.CARD], 0);
  assert.equal(report.paymentMethods[REPORT_PAYMENT_METHODS.GIFT_CARD], 30);
});
