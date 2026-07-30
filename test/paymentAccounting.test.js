import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPaymentToBuckets,
  getSignedChargedPaymentAmount,
  getSignedPaymentAmount,
  reconcileTransactionPayments
} from '../src/paymentAccounting.js';

const resolveBucket = method => method.toLowerCase().includes('efectivo') ? 'cash' : 'card';

test('una venta y su devolucion dejan el metodo de pago a cero', () => {
  const buckets = { cash: 0, card: 0 };
  addPaymentToBuckets(
    { type: 'sale', paymentMethod: 'Tarjeta' },
    { method: 'Tarjeta', amount: 13 },
    buckets,
    resolveBucket
  );
  addPaymentToBuckets(
    { type: 'refund', paymentMethod: 'Tarjeta' },
    { method: 'Tarjeta', amount: -13 },
    buckets,
    resolveBucket
  );
  assert.deepEqual(buckets, { cash: 0, card: 0 });
});

test('una devolucion antigua con pago positivo tambien se contabiliza en negativo', () => {
  assert.equal(
    getSignedPaymentAmount(
      { type: 'refund' },
      { method: 'Efectivo', amount: 7.5 }
    ),
    -7.5
  );
});

test('el importe del datafono incluye la propina pero la venta no', () => {
  const transaction = { type: 'sale' };
  const payment = {
    method: 'Tarjeta',
    saleAmount: 20,
    tipAmount: 5,
    amount: 25
  };

  assert.equal(getSignedPaymentAmount(transaction, payment), 20);
  assert.equal(getSignedChargedPaymentAmount(transaction, payment), 25);
});

test('una devolucion parcial resta solo el importe devuelto', () => {
  const buckets = { cash: 0, card: 0 };
  addPaymentToBuckets(
    { type: 'sale' },
    { method: 'Tarjeta', saleAmount: 20 },
    buckets,
    resolveBucket
  );
  addPaymentToBuckets(
    { type: 'refund' },
    { method: 'Tarjeta', saleAmount: -5 },
    buckets,
    resolveBucket
  );
  assert.deepEqual(buckets, { cash: 0, card: 15 });
});

test('la conciliacion detecta si los metodos de pago no coinciden con las ventas', () => {
  const balanced = reconcileTransactionPayments([
    { type: 'sale', total: 13, payments: [{ method: 'Tarjeta', amount: 13 }] },
    { type: 'refund', total: -13, payments: [{ method: 'Tarjeta', amount: -13 }] }
  ]);
  assert.deepEqual(balanced, {
    transactionNet: 0,
    paymentNet: 0,
    difference: 0,
    isBalanced: true
  });

  const unbalanced = reconcileTransactionPayments([
    { type: 'sale', total: 13, payments: [{ method: 'Tarjeta', amount: 26 }] }
  ]);
  assert.equal(unbalanced.isBalanced, false);
  assert.equal(unbalanced.difference, 13);
});
