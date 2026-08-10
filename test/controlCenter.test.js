import test from 'node:test';
import assert from 'node:assert/strict';
import { buildControlCenter } from '../src/controlCenter.js';

test('agrupa los pendientes y ofrece una acción directa por área', () => {
  const result = buildControlCenter({
    documents: [{ id: 'doc-1', direction: 'purchase', status: 'needs_review' }],
    recurringItems: [{ status: 'missing', periodKey: '2026-08', expense: { id: 'rent' } }],
    driveItems: [],
    pendingBankTransactions: [{ id: 'bank-1' }],
    reconciliations: [{ id: 'match-1', status: 'suggested' }],
    unclassifiedCount: 2,
    bankAccounts: [{ id: 'account-1' }],
    bankTransactions: [{ id: 'bank-1' }]
  });
  assert.deepEqual(result.tasks.map(task => task.action), [
    'recurring', 'document', 'reconciliation', 'bank', 'profitability'
  ]);
  assert.equal(result.total, 6);
});

test('no duplica como documento una factura de Drive que necesita corrección', () => {
  const result = buildControlCenter({
    documents: [{ id: 'doc-1', direction: 'purchase', status: 'needs_review' }],
    driveItems: [{ id: 'drive-1', document_id: 'doc-1', reviewStatus: 'needs_correction' }],
    bankAccounts: [{ id: 'account-1' }],
    bankTransactions: [{ id: 'bank-1' }]
  });
  assert.equal(result.tasks.filter(task => ['drive', 'documents'].includes(task.key)).length, 1);
  assert.equal(result.tasks[0].action, 'drive');
});

test('mantiene visibles otros documentos aunque Drive tenga una corrección', () => {
  const result = buildControlCenter({
    documents: [
      { id: 'drive-doc', direction: 'purchase', status: 'needs_review' },
      { id: 'manual-doc', direction: 'purchase', status: 'needs_review' }
    ],
    driveItems: [{ id: 'drive-1', document_id: 'drive-doc', reviewStatus: 'needs_correction' }],
    bankAccounts: [{ id: 'account-1' }],
    bankTransactions: [{ id: 'bank-1' }]
  });
  assert.deepEqual(result.tasks.slice(0, 2).map(task => task.action), ['drive', 'document']);
});

test('no cuenta dos veces una factura habitual pendiente de aprobar', () => {
  const result = buildControlCenter({
    documents: [{ id: 'recurring-doc', direction: 'purchase', status: 'needs_review' }],
    recurringItems: [{ status: 'pending', document: { id: 'recurring-doc' }, expense: { id: 'rent' } }],
    bankAccounts: [{ id: 'account-1' }],
    bankTransactions: [{ id: 'bank-1' }]
  });
  assert.equal(result.tasks.filter(task => ['documents', 'recurring-review'].includes(task.key)).length, 1);
  assert.equal(result.total, 1);
});

test('con todo resuelto devuelve el panel al día', () => {
  const result = buildControlCenter({
    bankAccounts: [{ id: 'account-1' }],
    bankTransactions: [{ id: 'bank-1' }]
  });
  assert.equal(result.total, 0);
  assert.deepEqual(result.tasks, []);
});

test('resume toda la revisión bancaria en una sola tarea sin duplicados', () => {
  const result = buildControlCenter({
    bankQueue: [
      { id: 'match', status: 'ready_match' },
      { id: 'missing', status: 'missing_document' },
      { id: 'classify', status: 'needs_classification' }
    ],
    pendingBankTransactions: [{ id: 'match' }, { id: 'missing' }, { id: 'classify' }],
    reconciliations: [{ id: 'rec', status: 'suggested' }],
    bankAccounts: [{ id: 'account-1' }],
    bankTransactions: [{ id: 'match' }]
  });
  assert.equal(result.tasks.filter(task => task.key === 'bank-work').length, 1);
  assert.equal(result.tasks.filter(task => ['bank', 'reconciliations'].includes(task.key)).length, 0);
  assert.equal(result.tasks[0].count, 3);
  assert.equal(result.areas.find(area => area.key === 'bank').pending, 3);
});

test('pide configurar gastos habituales cuando todavía no existe ninguna regla', () => {
  const result = buildControlCenter({
    recurringConfigured: false,
    bankAccounts: [{ id: 'account-1' }],
    bankTransactions: [{ id: 'bank-1' }]
  });
  assert.equal(result.tasks[0].action, 'recurring-setup');
  assert.equal(result.areas.find(area => area.key === 'recurring').pending, 1);
});
