import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderFingerprint } from '../src/orderIdentity.js';

test('la misma comanda conserva su identidad aunque cambie el orden visual', () => {
  const first = [
    { ticketItemId: 'line-b', id: 2, name: 'Tosta', qty: 1, selectedOptions: [] },
    { ticketItemId: 'line-a', id: 1, name: 'Cafe', qty: 2, selectedOptions: [] }
  ];
  const reordered = [...first].reverse();

  assert.equal(createOrderFingerprint(first), createOrderFingerprint(reordered));
});

test('dos comandas iguales mantienen identidades distintas por sus lineas', () => {
  const first = [{ ticketItemId: 'order-1-line', id: 1, name: 'Cafe', qty: 1 }];
  const second = [{ ticketItemId: 'order-2-line', id: 1, name: 'Cafe', qty: 1 }];

  assert.notEqual(createOrderFingerprint(first), createOrderFingerprint(second));
});

