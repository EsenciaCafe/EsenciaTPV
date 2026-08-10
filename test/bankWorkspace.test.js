import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBankWorkspace, bankWorkspaceStatus } from '../src/bankWorkspace.js';

const transactions = [
  { id: 'match', status: 'pending', amount: -80, booked_on: '2026-08-08', description: 'Proveedor Uno' },
  { id: 'candidate', status: 'pending', amount: -50, booked_on: '2026-08-07', description: 'Proveedor Dos' },
  { id: 'missing', status: 'pending', amount: -30, booked_on: '2026-08-06', description: 'Compra desconocida' },
  { id: 'square', status: 'pending', amount: 120, booked_on: '2026-08-05', description: 'Liquidacion remesa de comercios' },
  { id: 'done', status: 'matched', amount: -10, booked_on: '2026-08-04', description: 'Comision' }
];

const documents = [
  {
    id: 'doc-50', direction: 'purchase', status: 'approved', total_amount: 50, paid_amount: 0,
    issue_date: '2026-08-07', number: 'F-50', accounting_contacts: { name: 'Proveedor Dos' }
  }
];

test('convierte banco, coincidencias y facturas en una sola cola ordenada', () => {
  const result = buildBankWorkspace({
    transactions,
    documents,
    reconciliations: [{ id: 'rec-1', bank_transaction_id: 'match', status: 'suggested', score: 94 }]
  });

  assert.deepEqual(result.allItems.map(item => item.status), [
    'ready_match', 'possible_document', 'missing_document', 'needs_classification'
  ]);
  assert.equal(result.allItems[0].action, 'reconciliation');
  assert.equal(result.allItems[1].candidate.id, 'doc-50');
  assert.equal(result.allItems[3].classification.value, 'tpv_card_settlement');
  assert.deepEqual(result.stats, { pending: 4, ready: 2, missing: 1, classify: 1, completed: 1 });
});

test('mantiene visible un pago marcado como pendiente de factura', () => {
  const result = buildBankWorkspace({
    transactions: [{ id: 'a', status: 'pending', amount: -25, description: 'Compra', booked_on: '2026-08-01' }],
    reviews: [{ bank_transaction_id: 'a', status: 'waiting_document', classification: 'awaiting_document' }]
  });
  assert.equal(result.items[0].status, 'missing_document');
  assert.ok(result.items[0].waitingReview);
});

test('filtra por tarea, dirección y texto sin alterar los contadores generales', () => {
  const result = buildBankWorkspace({
    transactions,
    documents,
    reconciliations: [{ id: 'rec-1', bank_transaction_id: 'match', status: 'suggested', score: 94 }],
    filter: 'ready',
    direction: 'out',
    search: 'proveedor dos'
  });
  assert.deepEqual(result.items.map(item => item.transaction.id), ['candidate']);
  assert.equal(result.stats.pending, 4);
  assert.equal(result.hasActiveFilters, true);
});

test('explica de forma sencilla qué falta en cada estado', () => {
  assert.equal(bankWorkspaceStatus('missing_document').label, 'Falta justificar');
  assert.match(bankWorkspaceStatus('needs_classification').explanation, /TPV/);
});
