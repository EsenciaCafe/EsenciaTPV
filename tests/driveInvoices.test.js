import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driveImportStatus,
  folderId,
  reviewableSupplierDocument,
  validateSupplierDocument
} from '../src/driveInvoices.js';

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

test('convierte un resultado de error en un documento editable', () => {
  const payload = {
    error: 'unsupported_tax_rate',
    drive_file_id: 'drive-zumit',
    source_url: 'https://drive.google.com/file/d/drive-zumit/view',
    extracted: {
      supplier: { name: 'Zumit', tax_id: 'B12345678' },
      invoice: {
        number: 'FA/2026/6084',
        issue_date: '2026-07-14',
        document_type: 'invoice'
      },
      lines: [{
        supplier_item_code: 'B1',
        description: 'Smoothie',
        quantity: 2,
        taxable_base: 64,
        tax_rate: 5,
        tax_amount: 3.2
      }],
      warnings: ['Revisar el tipo reducido.']
    }
  };

  const review = reviewableSupplierDocument(payload);
  assert.equal(review.supplier.name, 'Zumit');
  assert.equal(review.invoice.number, 'FA/2026/6084');
  assert.equal(review.lines[0].unit_price, 32);
  assert.equal(review.lines[0].tax_rate, 5);
  assert.equal(review.source_url, payload.source_url);
});

test('crea una línea manual si el JSON no contiene detalle recuperable', () => {
  const review = reviewableSupplierDocument({}, {
    drive_file_id: 'result-json',
    issue_date: '2026-07-25',
    number: 'PENDIENTE'
  });
  assert.equal(review.drive_file_id, 'result-json');
  assert.equal(review.lines.length, 1);
  assert.match(review.lines[0].description, /revisar/i);
});
