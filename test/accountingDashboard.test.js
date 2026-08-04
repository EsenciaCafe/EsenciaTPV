import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBusinessSnapshot,
  percentageChange,
  periodBounds
} from '../src/accountingDashboard.js';

const document = (overrides = {}) => ({
  status: 'paid',
  direction: 'sale',
  document_type: 'simplified_invoice',
  source_type: 'tpv',
  issue_date: '2026-08-02',
  subtotal: 100,
  tax_amount: 7,
  total_amount: 107,
  paid_amount: 107,
  ...overrides
});

const dateKey = value => [
  value.getFullYear(),
  String(value.getMonth() + 1).padStart(2, '0'),
  String(value.getDate()).padStart(2, '0')
].join('-');

test('compara el mes actual con los mismos días del mes anterior', () => {
  const bounds = periodBounds('month', '2026-08-04');
  assert.equal(dateKey(bounds.start), '2026-08-01');
  assert.equal(dateKey(bounds.end), '2026-08-04');
  assert.equal(dateKey(bounds.comparisonStart), '2026-07-01');
  assert.equal(dateKey(bounds.comparisonEnd), '2026-07-04');
});

test('calcula resultado y margen sin mezclar el IGIC con ingresos y gastos', () => {
  const snapshot = buildBusinessSnapshot({
    anchor: '2026-08-04',
    documents: [
      document(),
      document({ direction: 'purchase', source_type: 'drive_json', subtotal: 40, tax_amount: 2.8, total_amount: 42.8, paid_amount: 0, status: 'approved' }),
      document({ status: 'needs_review', subtotal: 1000, total_amount: 1070, paid_amount: 0 })
    ]
  });

  assert.equal(snapshot.current.salesBase, 100);
  assert.equal(snapshot.current.expensesBase, 40);
  assert.equal(snapshot.current.result, 60);
  assert.equal(snapshot.current.margin, 60);
  assert.equal(snapshot.current.taxResult, 4.2);
  assert.equal(snapshot.current.estimatedIrpf, 12);
  assert.equal(snapshot.quality.documentsToReview, 1);
  assert.equal(snapshot.pending.payable, 42.8);
});

test('incluye rectificativas contabilizadas y excluye borradores', () => {
  const snapshot = buildBusinessSnapshot({
    anchor: '2026-08-04',
    documents: [
      document(),
      document({ status: 'rectified', document_type: 'credit_note', subtotal: -20, tax_amount: -1.4, total_amount: -21.4, paid_amount: -21.4 }),
      document({ status: 'draft', subtotal: 500, total_amount: 535 })
    ]
  });
  assert.equal(snapshot.current.salesBase, 80);
  assert.equal(snapshot.current.salesTotal, 85.6);
});

test('suma el último saldo de cada cuenta y los flujos bancarios del periodo', () => {
  const snapshot = buildBusinessSnapshot({
    anchor: '2026-08-04',
    bankAccounts: [
      { id: 'a', opening_balance: 20, active: true },
      { id: 'b', opening_balance: 10, active: true }
    ],
    bankTransactions: [
      { bank_account_id: 'a', booked_on: '2026-08-01', amount: 100, balance: 120, status: 'matched' },
      { bank_account_id: 'a', booked_on: '2026-08-03', amount: -30, balance: 90, status: 'pending' },
      { bank_account_id: 'b', booked_on: '2026-07-31', amount: 5, balance: 15, status: 'matched' }
    ]
  });
  assert.equal(snapshot.treasury.balance, 105);
  assert.equal(snapshot.treasury.inflows, 100);
  assert.equal(snapshot.treasury.outflows, 30);
  assert.equal(snapshot.treasury.pendingCount, 1);
});

test('calcula cambios porcentuales sin inventar un porcentaje desde cero', () => {
  assert.equal(percentageChange(120, 100), 20);
  assert.equal(percentageChange(0, 0), 0);
  assert.equal(percentageChange(100, 0), null);
});
