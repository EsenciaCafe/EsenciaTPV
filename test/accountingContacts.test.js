import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findMatchingContact,
  mergeContactKind,
  normalizeContactName,
  normalizeContactTaxId
} from '../src/accountingContacts.js';

test('normaliza NIF y nombres de proveedor', () => {
  assert.equal(normalizeContactTaxId(' b-123.456-78 '), 'B12345678');
  assert.equal(normalizeContactName('Café del Mar, S.L.'), 'cafe del mar s l');
});

test('encuentra primero al proveedor por NIF aunque cambie el nombre', () => {
  const contacts = [
    { id: '1', name: 'Proveedor antiguo', legal_name: '', tax_id: 'B12345678' }
  ];
  assert.equal(findMatchingContact(contacts, {
    name: 'Proveedor con nombre nuevo',
    tax_id: 'B-12345678'
  })?.id, '1');
});

test('encuentra por nombre cuando la factura no contiene NIF', () => {
  const contacts = [
    { id: '2', name: 'Café del Mar S.L.', legal_name: '', tax_id: '' }
  ];
  assert.equal(findMatchingContact(contacts, {
    name: 'CAFE DEL MAR, S.L.',
    tax_id: ''
  })?.id, '2');
});

test('reutiliza por nombre un proveedor sin NIF para poder completarlo', () => {
  const contacts = [
    { id: '3', name: 'One Stop Bar Supplies', legal_name: '', tax_id: '' }
  ];
  assert.equal(findMatchingContact(contacts, {
    name: 'ONE STOP BAR SUPPLIES',
    tax_id: 'B76543210'
  })?.id, '3');
});

test('no mezcla proveedores con el mismo nombre si tienen NIF distintos', () => {
  const contacts = [
    { id: '4', name: 'Proveedor igual', legal_name: '', tax_id: 'B11111111' }
  ];
  assert.equal(findMatchingContact(contacts, {
    name: 'Proveedor igual',
    tax_id: 'B22222222'
  }), null);
});

test('convierte un cliente existente en contacto de ambos tipos', () => {
  assert.equal(mergeContactKind('customer', 'supplier'), 'both');
  assert.equal(mergeContactKind('supplier', 'supplier'), 'supplier');
  assert.equal(mergeContactKind('both', 'supplier'), 'both');
});
