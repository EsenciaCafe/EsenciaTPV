import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDocumentLine,
  calculateDocumentTotals,
  calculatePriceVariation
} from '../src/documentLines.js';

test('calcula una línea con IGIC y redondea a céntimos', () => {
  assert.deepEqual(
    calculateDocumentLine({ quantity: 1, unit_price: 19.92, tax_scope: 'taxable', tax_rate: 3, withholding_rate: 0 }),
    {
      quantity: 1,
      unit_price: 19.92,
      taxable_base: 19.92,
      tax_scope: 'taxable',
      tax_rate: 3,
      tax_amount: 0.6,
      withholding_rate: 0,
      withholding_amount: 0
    }
  );
});

test('suma una factura con artículos a tipos distintos', () => {
  const totals = calculateDocumentTotals([
    { quantity: 4, unit_price: 6.48, tax_scope: 'taxable', tax_rate: 0 },
    { quantity: 1, unit_price: 19.92, tax_scope: 'taxable', tax_rate: 3 }
  ]);
  assert.equal(totals.subtotal, 45.84);
  assert.equal(totals.taxAmount, 0.6);
  assert.equal(totals.totalAmount, 46.44);
});

test('reproduce correctamente el desglose agregado de Makro', () => {
  const totals = calculateDocumentTotals([
    { quantity: 1, unit_price: 111.86, tax_scope: 'taxable', tax_rate: 0 },
    { quantity: 1, unit_price: 424.77, tax_scope: 'taxable', tax_rate: 3 }
  ]);
  assert.equal(totals.subtotal, 536.63);
  assert.equal(totals.taxAmount, 12.74);
  assert.equal(totals.totalAmount, 549.37);
});

test('las operaciones exentas no generan cuota de IGIC', () => {
  const totals = calculateDocumentTotals([
    { quantity: 5, unit_price: 1.1, tax_scope: 'exempt', tax_rate: 7 }
  ]);
  assert.equal(totals.subtotal, 5.5);
  assert.equal(totals.taxAmount, 0);
  assert.equal(totals.lines[0].tax_rate, 0);
});

test('calcula la variación respecto al precio de compra anterior', () => {
  assert.deepEqual(calculatePriceVariation(12, 10), { amount: 2, percent: 20 });
  assert.deepEqual(calculatePriceVariation(8, 10), { amount: -2, percent: -20 });
  assert.equal(calculatePriceVariation(8, 0), null);
});
