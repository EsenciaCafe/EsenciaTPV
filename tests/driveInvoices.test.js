import test from 'node:test';
import assert from 'node:assert/strict';
import { driveImportStatus, folderId, validateSupplierDocument } from '../src/driveInvoices.js';

function validDocument() {
  return {
    schema_version: 'supplier-document/v1',
    drive_file_id: 'drive-001',
    drive_revision: 'rev-1',
    supplier: { name: 'Proveedor', tax_id: 'B00000000' },
    invoice: {
      number: 'F-001',
      issue_date: '2026-07-25',
      due_date: null,
      currency: 'EUR',
      document_type: 'invoice',
      payment_method: 'transfer'
    },
    lines: [{
      description: 'Compra',
      quantity: 1,
      unit_price: 100,
      taxable_base: 100,
      tax_rate: 7,
      tax_amount: 7,
      tax_scope: 'taxable',
      withholding_amount: 0
    }],
    totals: {
      taxable_base: 100,
      tax_amount: 7,
      withholding_amount: 0,
      total: 107
    },
    confidence: { 'invoice.number': 0.99, 'totals.total': 1 },
    warnings: []
  };
}

test('valida un documento supplier-document/v1 consistente', () => {
  const payload = validDocument();
  assert.equal(validateSupplierDocument(payload), payload);
});

test('rechaza totales incoherentes', () => {
  const payload = validDocument();
  payload.totals.total = 999;
  assert.throws(() => validateSupplierDocument(payload), /total no cuadra/i);
});

test('exige confianza y advertencias', () => {
  const payload = validDocument();
  delete payload.confidence;
  delete payload.warnings;
  assert.throws(() => validateSupplierDocument(payload), /warnings|confidence/i);
});

test('extrae IDs de URLs de carpeta y elige el último estado', () => {
  assert.equal(
    folderId('https://drive.google.com/drive/folders/abc_DEF-123?usp=sharing'),
    'abc_DEF-123'
  );
  assert.equal(driveImportStatus('drive-001', [
    { drive_file_id: 'drive-001', status: 'error', created_at: '2026-07-24T10:00:00Z' },
    { drive_file_id: 'drive-001', status: 'imported', processed_at: '2026-07-25T10:00:00Z' }
  ]), 'imported');
});
