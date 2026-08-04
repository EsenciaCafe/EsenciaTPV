import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReconciliationComparison,
  reconciliationDateDifference,
  reconciliationsByStatus
} from '../src/reconciliationView.js';

const bank = (overrides = {}) => ({
  booked_on: '2026-07-25',
  description: 'PAGO FACTURA FA/2026/5343',
  reference: 'FA/2026/5343',
  amount: -259.2,
  ...overrides
});

const document = (overrides = {}) => ({
  number: 'FA/2026/5343',
  issue_date: '2026-07-24',
  total_amount: 259.2,
  paid_amount: 0,
  ...overrides
});

test('detecta una coincidencia sólida por importe, fecha y referencia', () => {
  const result = buildReconciliationComparison({
    match: { amount: 259.2 },
    bankTransaction: bank(),
    document: document()
  });
  assert.equal(result.amountMatches, true);
  assert.equal(result.dateDifference, 1);
  assert.equal(result.referenceMatches, true);
  assert.equal(result.canConfirm, true);
  assert.deepEqual(result.warnings, []);
});

test('avisa cuando el número de factura no coincide aunque importe y fecha sí', () => {
  const result = buildReconciliationComparison({
    match: { amount: 259.2 },
    bankTransaction: bank(),
    document: document({ number: 'FA/2026/6084' })
  });
  assert.equal(result.referenceMatches, false);
  assert.match(result.warnings.join(' '), /referencia bancaria/i);
});

test('compara el banco con el importe aún pendiente, incluidos pagos parciales', () => {
  const result = buildReconciliationComparison({
    match: { amount: 59.2 },
    bankTransaction: bank({ amount: -59.2 }),
    document: document({ paid_amount: 200 })
  });
  assert.equal(result.outstanding, 59.2);
  assert.equal(result.amountMatches, true);
  assert.equal(result.canConfirm, true);
});

test('calcula distancia entre fechas y filtra el historial por estado', () => {
  assert.equal(reconciliationDateDifference('2026-08-03', '2026-07-25'), 9);
  assert.deepEqual(
    reconciliationsByStatus([{ id: 1, status: 'suggested' }, { id: 2, status: 'confirmed' }], 'confirmed'),
    [{ id: 2, status: 'confirmed' }]
  );
});
