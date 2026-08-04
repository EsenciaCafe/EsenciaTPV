import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classificationsForTransaction,
  outstandingDocumentsForTransaction,
  pendingBankTransactions,
  suggestBankClassification
} from '../src/bankReview.js';

test('reconoce liquidaciones TPV, impuestos, efectivo y Seguridad Social', () => {
  assert.equal(suggestBankClassification({ amount: 230.9, description: 'Liquidacion remesa de comercios' }), 'tpv_card_settlement');
  assert.equal(suggestBankClassification({ amount: 2005, description: 'Ingreso en efectivo' }), 'cash_deposit');
  assert.equal(suggestBankClassification({ amount: -274.14, description: 'Pago de impuestos', reference: 'NRC 123' }), 'tax_payment');
  assert.equal(suggestBankClassification({ amount: -588.64, description: 'Cuotas de la Seguridad Social' }), 'social_security');
});

test('no ofrece categorías de entrada para una salida bancaria', () => {
  const values = classificationsForTransaction({ amount: -20 }).map(item => item.value);
  assert.ok(values.includes('expense_without_invoice'));
  assert.ok(values.includes('owner_withdrawal'));
  assert.ok(!values.includes('other_income'));
  assert.ok(!values.includes('tpv_card_settlement'));
});

test('ordena primero los documentos pendientes con importe más cercano', () => {
  const documents = [
    { id: 'a', direction: 'purchase', status: 'approved', total_amount: 50, paid_amount: 0, issue_date: '2026-07-20' },
    { id: 'b', direction: 'purchase', status: 'partially_paid', total_amount: 100, paid_amount: 20, issue_date: '2026-07-21' },
    { id: 'c', direction: 'sale', status: 'approved', total_amount: 80, paid_amount: 0 }
  ];
  const candidates = outstandingDocumentsForTransaction({ amount: -79.99 }, documents);
  assert.deepEqual(candidates.map(item => item.id), ['b']);
  assert.equal(candidates[0].outstanding, 80);
});

test('la bandeja excluye conciliados y permite buscar y filtrar dirección', () => {
  const transactions = [
    { id: 'a', status: 'pending', amount: 10, description: 'Remesa comercio' },
    { id: 'b', status: 'pending', amount: -5, description: 'Comisión' },
    { id: 'c', status: 'matched', amount: 12, description: 'Cobro' }
  ];
  const result = pendingBankTransactions({
    transactions,
    reconciliations: [{ bank_transaction_id: 'a', status: 'suggested' }],
    search: 'comision',
    direction: 'out'
  });
  assert.deepEqual(result.map(item => item.id), ['b']);
});
