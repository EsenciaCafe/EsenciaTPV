import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfitabilityAnalysis,
  suggestDocumentClassification
} from '../src/profitabilityAnalysis.js';

const sale = (overrides = {}) => ({
  id: crypto.randomUUID(),
  status: 'paid',
  direction: 'sale',
  document_type: 'simplified_invoice',
  issue_date: '2026-08-02',
  subtotal: 1000,
  ...overrides
});

const purchase = (overrides = {}) => ({
  id: crypto.randomUUID(),
  status: 'approved',
  direction: 'purchase',
  document_type: 'invoice',
  issue_date: '2026-08-02',
  subtotal: 100,
  ...overrides
});

test('sugiere mercancía, costes fijos e inversiones desde los datos existentes', () => {
  assert.deepEqual(suggestDocumentClassification(purchase({ category: 'Compras de mercaderías' })), {
    category: 'merchandise', cost_behavior: 'variable'
  });
  assert.deepEqual(suggestDocumentClassification(purchase({ category: 'Otros servicios y suministros' })), {
    category: 'utilities', cost_behavior: 'fixed'
  });
  assert.deepEqual(suggestDocumentClassification(purchase({ document_type: 'asset' })), {
    category: 'investment', cost_behavior: 'investment'
  });
});

test('calcula rentabilidad operativa sin tratar una inversión como gasto del periodo', () => {
  const variable = purchase({ subtotal: 300, category: 'Compras de mercaderías' });
  const fixed = purchase({ subtotal: 200, category: 'Alquiler' });
  const asset = purchase({ subtotal: 400, document_type: 'asset' });
  const analyses = [
    { document_id: variable.id, category: 'merchandise', cost_behavior: 'variable' },
    { document_id: fixed.id, category: 'rent', cost_behavior: 'fixed' },
    { document_id: asset.id, category: 'investment', cost_behavior: 'investment' }
  ];
  const result = buildProfitabilityAnalysis({
    documents: [sale(), variable, fixed, asset], analyses, anchor: '2026-08-04'
  });

  assert.equal(result.sales, 1000);
  assert.equal(result.variableCosts, 300);
  assert.equal(result.fixedCosts, 200);
  assert.equal(result.investments, 400);
  assert.equal(result.operatingCosts, 500);
  assert.equal(result.result, 500);
  assert.equal(result.margin, 50);
  assert.equal(result.breakEvenSales, 200 / 0.7);
  assert.equal(result.provisional, false);
});

test('marca el análisis como provisional mientras falten clasificaciones o facturas', () => {
  const unknown = purchase({ subtotal: 80, category: '' });
  const pending = purchase({ status: 'needs_review', subtotal: 50 });
  const result = buildProfitabilityAnalysis({
    documents: [sale(), unknown, pending], anchor: '2026-08-04'
  });

  assert.equal(result.unclassifiedCosts, 80);
  assert.equal(result.pendingDocuments, 1);
  assert.equal(result.pendingAmount, 50);
  assert.equal(result.breakEvenSales, null);
  assert.equal(result.provisional, true);
  assert.match(result.verdict.label, /provisional/i);
});

test('no declara rentable un periodo con ventas pero sin ningún gasto registrado', () => {
  const result = buildProfitabilityAnalysis({ documents: [sale()], anchor: '2026-08-04' });
  assert.equal(result.missingCosts, true);
  assert.equal(result.breakEvenSales, null);
  assert.equal(result.provisional, true);
  assert.equal(result.classificationCoverage, 0);
  assert.equal(result.verdict.label, 'Aún no evaluable');
});
