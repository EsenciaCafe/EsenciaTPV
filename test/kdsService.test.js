import test from 'node:test';
import assert from 'node:assert/strict';
import { getKitchenService, getPendingKitchenItems, normalizeKitchenState, createKitchenAction, applyKitchenAction, saveKitchenAction } from '../src/kdsService.js';

const coffee = { ticketItemId: 'line-coffee', id: 'latte', name: 'Latte', qty: 2 };
const toast = { ticketItemId: 'line-toast', id: 'toast', name: 'Tostada', qty: 1 };
const later = { ticketItemId: 'line-later', id: 'pancakes', name: 'MiniPancakes', qty: 1, deferUntilLater: true };
const table = { id: 1, name: 'Mesa 1', items: [coffee, toast, later] };
const empty = { status: 'waiting', deliveredItems: [] };
const action = (table, kds, service) => createKitchenAction(table, kds, service, getKitchenService, 1000);

test('classifies by catalog before names, with safe food fallback and cyclic-category protection', () => {
  assert.equal(getKitchenService(coffee), 'drink');
  assert.equal(getKitchenService({ name: 'Tarta de café' }), 'food');
  assert.equal(getKitchenService({ name: 'Cinnamon Roll' }), 'food');
  assert.equal(getKitchenService({ name: 'Especial' }), 'food');
  const categories = [{ id: 'smoothies', name: 'Especiales', parent_id: 'drinks' }, { id: 'drinks', name: 'Bebidas' }];
  assert.equal(getKitchenService({ id: 'x', name: 'Nutella' }, [{ id: 'x', category: 'smoothies' }], categories), 'drink');
  assert.equal(getKitchenService({ category: 'cycle', name: 'Latte' }, [], [{ id: 'cycle', parent_id: 'cycle' }]), 'drink');
});

test('each service completes independently; deferred food keeps the table active', () => {
  const drinksDone = applyKitchenAction(table, empty, action(table, empty, 'drink'));
  assert.equal(drinksDone.status, 'waiting');
  assert.deepEqual(drinksDone.deliveredItems, [{ ticketItemId: coffee.ticketItemId, id: coffee.id, qty: coffee.qty }]);
  const foodDone = applyKitchenAction(table, drinksDone, action(table, drinksDone, 'food'));
  assert.equal(foodDone.status, 'waiting');
  assert.deepEqual(getPendingKitchenItems(table, foodDone), [later]);
  assert.equal(action(table, foodDone, 'drink'), null);
  const release = action(table, foodDone, 'food');
  assert.equal(release.type, 'release');
  const released = applyKitchenAction(table, foodDone, release);
  assert.equal(released.status, 'waiting');
  assert.deepEqual(getPendingKitchenItems(table, released), [later]);
  const complete = action(table, released, 'food');
  assert.equal(complete.type, 'complete');
  assert.equal(applyKitchenAction(table, released, complete).status, 'ready');
});

test('deferred drinks can start independently of active food', () => {
  const t = { items: [{ ...coffee, deferUntilLater: true }, toast] };
  const next = applyKitchenAction(t, empty, action(t, empty, 'drink'));
  assert.deepEqual(next.releasedDeferredItems, [coffee.ticketItemId]);
  assert.equal(next.deliveredItems.length, 0);
  assert.equal(next.status, 'waiting');
});

test('new lines and increased quantities stay pending after a completed service', () => {
  const before = { items: [coffee] };
  const click = action(before, empty, 'drink');
  const after = { items: [{ ...coffee, qty: 3 }, { ...coffee, ticketItemId: 'new-line', qty: 1 }] };
  const saved = applyKitchenAction(after, empty, click);
  assert.equal(saved.deliveredItems[0].qty, 2);
  assert.equal(saved.status, 'waiting');
  assert.equal(getPendingKitchenItems(after, saved).length, 2);
  const ready = applyKitchenAction(before, empty, click);
  assert.equal(normalizeKitchenState(after, ready).status, 'waiting');
});

test('completion is idempotent and survives serialization/reload', () => {
  const click = action(table, empty, 'drink');
  const done = applyKitchenAction(table, empty, click);
  assert.deepEqual(applyKitchenAction(table, done, click), done);
  const restored = normalizeKitchenState(table, JSON.parse(JSON.stringify(done)));
  assert.equal(action(table, restored, 'drink'), null);
  assert.equal(action(table, restored, 'food').type, 'complete');
});

test('reopen and delayed completion cannot affect another order reusing the table', () => {
  const otherOrder = { id: 1, items: [{ ...coffee, ticketItemId: 'new-order' }] };
  const done = applyKitchenAction(table, empty, action(table, empty, 'drink'));
  const reopened = applyKitchenAction(table, done, { type: 'reopen', at: 2000, items: table.items });
  assert.equal(reopened.deliveredItems.length, 0);
  const untouched = applyKitchenAction(otherOrder, empty, action(table, empty, 'drink'));
  assert.equal(untouched.deliveredItems.length, 0);
  assert.equal(untouched.status, 'waiting');
});

test('legacy ready flags get a baseline and do not silently serve later additions', () => {
  const oldTable = { items: [coffee] };
  const legacy = { status: 'ready', readyAt: 500 };
  const cached = normalizeKitchenState(oldTable, legacy);
  const newer = { items: [coffee, toast] };
  const next = applyKitchenAction(newer, legacy, action(newer, cached, 'food'));
  assert.equal(next.status, 'ready');
  assert.equal(next.deliveredItems.length, 2);
});

function mockServer(beforeWrite) {
  const server = {
    row: { tables: [table], direct_sale: { items: [{ id: 'untouched' }], legal_data: { nif: 'fixture' }, kds_state: { 2: { status: 'waiting' } } }, updated_at: '2026-11-06T12:00:00Z' },
    writes: [], reads: 0
  };
  server.client = { from(name) {
    assert.equal(name, 'tpv_state');
    let patch, version;
    const query = {
      select() {
        if (!patch) return query;
        return { abortSignal: async () => {
          await beforeWrite?.(server);
          if (server.row.updated_at !== version) return { data: [], error: null };
          server.writes.push(structuredClone(patch));
          server.row = { ...server.row, ...patch };
          return { data: [{ updated_at: server.row.updated_at }], error: null };
        } };
      },
      eq(key, value) { if (key === 'updated_at') version = value; return query; },
      is(key, value) { if (key === 'updated_at') version = value; return query; },
      update(value) { patch = value; return query; },
      single() { return { abortSignal: async () => { server.reads++; return { data: structuredClone(server.row), error: null }; } }; }
    };
    return query;
  } };
  return server;
}

test('saving modifies only kitchen state, never tables, transactions, or the direct-sale ticket', async () => {
  const server = mockServer();
  const originalTables = structuredClone(server.row.tables);
  await saveKitchenAction(server.client, 1, action(table, empty, 'drink'));
  assert.deepEqual(server.row.tables, originalTables);
  assert.deepEqual(server.row.direct_sale.items, [{ id: 'untouched' }]);
  assert.equal(server.row.direct_sale.legal_data.nif, 'fixture');
  assert.deepEqual(server.row.direct_sale.kds_state[2], { status: 'waiting' });
  assert.deepEqual(Object.keys(server.writes[0]).sort(), ['direct_sale', 'updated_at']);
});

test('concurrent food/drink updates merge after CAS retry without losing either service', async () => {
  let conflict = true;
  const t = { ...table, items: [coffee, toast] };
  const server = mockServer(s => {
    if (!conflict) return;
    conflict = false;
    s.row.updated_at = '2026-11-06T12:00:01Z';
    s.row.direct_sale.kds_state[1] = applyKitchenAction(t, empty, action(t, empty, 'food'));
    s.row.direct_sale.items = [{ id: 'newer-direct-sale' }];
  });
  server.row.tables = [t];
  const result = await saveKitchenAction(server.client, 1, action(t, empty, 'drink'));
  assert.equal(server.reads, 2);
  assert.equal(result.kds.status, 'ready');
  assert.equal(result.kds.deliveredItems.length, 2);
  assert.deepEqual(server.row.direct_sale.items, [{ id: 'newer-direct-sale' }]);
});

test('repeated contention fails visibly instead of reporting success', async () => {
  const server = mockServer(s => { s.row.updated_at += 'x'; });
  await assert.rejects(saveKitchenAction(server.client, 1, action(table, empty, 'drink')), /Vuelve a intentarlo/);
  assert.equal(server.reads, 3);
  assert.equal(server.writes.length, 0);
});

test('network errors are propagated without acknowledging or mutating the sale', async () => {
  const server = mockServer(() => { throw new Error('Connection lost'); });
  const original = structuredClone(server.row);
  await assert.rejects(saveKitchenAction(server.client, 1, action(table, empty, 'drink')), /Connection lost/);
  assert.deepEqual(server.row, original);
  assert.equal(server.writes.length, 0);
});
