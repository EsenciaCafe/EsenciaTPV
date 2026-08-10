import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecurringExpenseReview,
  expectedDateForMonth,
  recurringPeriodKey
} from '../src/recurringExpenses.js';

const monthly = {
  id: 'rent',
  name: 'Alquiler',
  contact_id: 'landlord',
  expected_amount: 900,
  frequency: 'monthly',
  due_day: 5,
  start_on: '2026-01-01',
  active: true
};

test('calcula correctamente las fechas mensuales y trimestrales', () => {
  assert.equal(recurringPeriodKey(new Date(2026, 7, 1)), '2026-08');
  assert.equal(expectedDateForMonth(monthly, new Date(2026, 7, 1)).getDate(), 5);
  const quarterly = { ...monthly, frequency: 'quarterly', start_on: '2026-02-01' };
  assert.equal(expectedDateForMonth(quarterly, new Date(2026, 4, 1)).getMonth(), 4);
  assert.equal(expectedDateForMonth(quarterly, new Date(2026, 5, 1)), null);
});

test('avisa cuando ya venció y no existe factura', () => {
  const review = buildRecurringExpenseReview({
    expenses: [monthly],
    anchor: new Date(2026, 7, 12),
    lookbackMonths: 0
  });
  assert.equal(review.items[0].status, 'missing');
  assert.equal(review.summary.missing, 1);
});

test('reconoce una factura pendiente y una aprobada por proveedor', () => {
  const base = { id: 'doc', contact_id: 'landlord', direction: 'purchase', issue_date: '2026-08-04', total_amount: 900 };
  const pending = buildRecurringExpenseReview({
    expenses: [monthly], documents: [{ ...base, status: 'needs_review' }], anchor: new Date(2026, 7, 12), lookbackMonths: 0
  });
  assert.equal(pending.items[0].status, 'pending');
  const accounted = buildRecurringExpenseReview({
    expenses: [monthly], documents: [{ ...base, status: 'approved' }], anchor: new Date(2026, 7, 12), lookbackMonths: 0
  });
  assert.equal(accounted.items[0].status, 'accounted');
});

test('respeta un mes marcado como no corresponde', () => {
  const review = buildRecurringExpenseReview({
    expenses: [monthly],
    occurrences: [{ recurring_expense_id: 'rent', period_key: '2026-08', status: 'skipped' }],
    anchor: new Date(2026, 7, 12),
    lookbackMonths: 0
  });
  assert.equal(review.items[0].status, 'skipped');
  assert.equal(review.summary.skipped, 1);
});
