import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankImportDateRange,
  bankImportSelection,
  buildBankImportBatches,
  clampBankImportRange,
  isBankTransactionIncluded,
  quarterRange
} from '../src/bankImports.js';

const rows = [
  { id: 'june', import_batch: 'batch-1', booked_on: '2026-06-30', status: 'pending', review_scope: 'included', bank_account_id: 'a' },
  { id: 'july', import_batch: 'batch-1', booked_on: '2026-07-01', status: 'pending', review_scope: 'included', bank_account_id: 'a' },
  { id: 'august', import_batch: 'batch-1', booked_on: '2026-08-10', status: 'matched', review_scope: 'included', bank_account_id: 'a' }
];

test('detecta el periodo completo y permite importar solo desde julio', () => {
  assert.deepEqual(bankImportDateRange(rows), { start: '2026-06-30', end: '2026-08-10' });
  const selection = bankImportSelection(rows, '2026-07-01', '2026-09-30');
  assert.deepEqual(selection.included.map(row => row.id), ['july', 'august']);
  assert.deepEqual(selection.excluded.map(row => row.id), ['june']);
});

test('calcula el trimestre natural de una fecha', () => {
  assert.deepEqual(quarterRange('2026-08-10'), { start: '2026-07-01', end: '2026-09-30' });
  assert.deepEqual(quarterRange('2026-06-15'), { start: '2026-04-01', end: '2026-06-30' });
});

test('recorta el trimestre a las fechas que realmente contiene el extracto', () => {
  assert.deepEqual(clampBankImportRange(
    { start: '2026-07-01', end: '2026-09-30' },
    { start: '2026-05-25', end: '2026-07-24' }
  ), { start: '2026-07-01', end: '2026-07-24' });
});

test('solo review_scope excluded saca un movimiento del trabajo contable', () => {
  assert.equal(isBankTransactionIncluded({}), true);
  assert.equal(isBankTransactionIncluded({ review_scope: 'included' }), true);
  assert.equal(isBankTransactionIncluded({ review_scope: 'excluded' }), false);
});

test('agrupa movimientos por extracto y conserva los lotes antiguos', () => {
  const batches = buildBankImportBatches({
    imports: [{ id: 'batch-1', file_name: 'bbva.xlsx', created_at: '2026-08-10T10:00:00Z' }],
    transactions: [{ ...rows[0], review_scope: 'excluded' }, rows[1], rows[2]],
    accounts: [{ id: 'a', name: 'BBVA' }]
  });
  assert.equal(batches[0].file_name, 'bbva.xlsx');
  assert.equal(batches[0].account.name, 'BBVA');
  assert.equal(batches[0].excluded_count, 1);
  assert.equal(batches[0].included_count, 2);
  assert.equal(batches[0].processed_count, 1);
  assert.equal(batches[0].canUndo, false);
});
