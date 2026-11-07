import test from 'node:test';
import assert from 'node:assert/strict';
import { renderKdsAccount } from '../src/kdsAccount.js';

const account = {
  tableName: 'Mesa 1', total: 8, grossTotal: 10, discountTotal: 2,
  lines: [{ name: 'Latte', qty: 2, total: 8, gross: 10, discount: 2, discountReason: 'Descuento 20%',
    selectedOptions: [{ name: 'Leche de soja', qty: 1, price: 0.5 }], note: 'Muy caliente' }]
};

test('account shows supplied TPV amounts, quantities, modifiers, notes and discounts without payment controls', () => {
  const html = renderKdsAccount(account);
  for (const value of ['Latte', '2 ×', 'Leche de soja', 'Muy caliente', 'Descuento 20%', '8,00', '10,00', '2,00', 'kds-account-pay', 'Volver al KDS']) assert.ok(html.includes(value), value);
  assert.ok(!html.includes('payment-confirm-btn'));
  assert.ok(!html.includes('kds-ready-btn'));
  assert.ok(!html.includes('data-pay-method'));
});

test('all articles remain visible, including free/deferred items, and zero accounts can be closed', () => {
  const lines = Array.from({ length: 40 }, (_, index) => ({ name: `Articulo ${index}`, qty: 1, total: 0, gross: 3, discount: 3, deferUntilLater: true }));
  const html = renderKdsAccount({ tableName: 'Mesa 12', lines, total: 0, grossTotal: 120, discountTotal: 120 });
  assert.equal((html.match(/<li class="kds-account-line">/g) || []).length, 40);
  assert.ok(html.includes('Articulo 39'));
  assert.ok(html.includes('Cerrar invitación'));
  assert.ok(html.includes('Invitación'));
});

test('account escapes customer/staff text and leaves the input snapshot unchanged', () => {
  const unsafe = structuredClone(account);
  unsafe.tableName = '<script>table</script>';
  unsafe.lines[0].name = '<img src=x onerror=alert(1)>';
  unsafe.lines[0].note = '<script>note</script>';
  unsafe.lines[0].selectedOptions[0].name = '<svg onload=alert(1)>';
  const before = JSON.stringify(unsafe);
  const html = renderKdsAccount(unsafe);
  assert.ok(!/<script>|<img|<svg/.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(JSON.stringify(unsafe), before);
});
