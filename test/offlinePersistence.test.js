import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

globalThis.window = globalThis.window || {};

const offline = await import('../src/localDb.js');

async function resetDatabase() {
  if (offline.localDb?.isOpen()) offline.localDb.close();
  await offline.localDb?.delete();
  await offline.initializeLocalDatabase();
}

test.beforeEach(resetDatabase);
test.after(async () => {
  if (offline.localDb?.isOpen()) offline.localDb.close();
  await offline.localDb?.delete();
});

test('persists a complete sale and removes its outbox operation after sync', async () => {
  const initialized = await offline.initializeLocalDatabase();
  const sale = {
    id: 'TX-offline-1',
    type: 'sale',
    createdAt: '2026-08-01T12:00:00.000Z',
    table: 'Mesa 3',
    total: 8.5,
    itemsCount: 2,
    paymentMethod: 'Tarjeta',
    items: [
      { ticketItemId: 'line-1', id: 'latte', name: 'Latte', qty: 2, price: 4.25, total: 8.5 }
    ],
    payments: [{ method: 'Tarjeta', amount: 8.5, provider: 'BBVA' }]
  };

  await offline.persistSaleLocally(sale, {
    deviceId: initialized.device.id,
    sessionId: 'offline-session-1'
  });

  const bootstrap = await offline.loadCachedBootstrap();
  assert.equal(bootstrap.transactions.length, 1);
  assert.equal(bootstrap.transactions[0].items[0].name, 'Latte');

  const operations = await offline.getPendingOperations();
  assert.equal(operations.length, 1);
  assert.equal(operations[0].kind, 'sale.upsert');
  assert.deepEqual(operations[0].payload.payments, sale.payments);

  await offline.markOperationsSyncing([operations[0].operationId]);
  await offline.applySyncResults([{ operationId: operations[0].operationId, status: 'synced' }]);

  const readiness = await offline.getLocalReadiness();
  assert.equal(readiness.pending, 0);
  assert.equal((await offline.localDb.transactions.get(sale.id)).syncStatus, 'synced');
});

test('stores only a PIN verifier and authenticates the cached manager', async () => {
  await offline.cacheStaffSnapshot([{
    id: 'manager-1',
    display_name: 'Encargado',
    role: 'manager',
    active: true,
    pin_code: '2468'
  }]);

  const cached = await offline.loadCachedBootstrap();
  assert.equal(cached.staff[0].pin_code, '');
  assert.ok(cached.staff[0].pin_verifier);
  assert.equal((await offline.findCachedStaffByPin('2468', ['manager']))?.id, 'manager-1');
  assert.equal(await offline.findCachedStaffByPin('1111', ['manager']), null);
});

test('creates a correlated emergency fiscal chain and keeps the session durable', async () => {
  const initialized = await offline.initializeLocalDatabase();
  await offline.setEmergencyDesignation(true);
  const session = await offline.activateEmergencySession({
    id: 'admin-1',
    display_name: 'Administrador',
    role: 'admin'
  });
  const legal = {
    businessName: 'Esencia Cafe',
    companyName: 'Titular real',
    nif: '00000000T',
    address: 'Direccion real',
    taxName: 'IGIC',
    taxRate: 7
  };

  const first = await offline.createEmergencyFiscalDocument({
    id: 'TX-fiscal-1',
    type: 'sale',
    total: 10,
    createdAt: '2026-08-01T12:00:00.000Z'
  }, legal, initialized.device.id);
  const second = await offline.createEmergencyFiscalDocument({
    id: 'TX-fiscal-2',
    type: 'sale',
    total: 5,
    createdAt: '2026-08-01T12:05:00.000Z'
  }, legal, initialized.device.id);

  assert.equal(first.fiscalNumber, 'SE2026-000001');
  assert.equal(second.fiscalNumber, 'SE2026-000002');
  assert.equal(second.previousHash, first.hash);
  assert.equal(second.incident, true);
  assert.equal((await offline.getLocalReadiness()).sessionId, session.sessionId);
});

test('coalesces pending shared-state snapshots without dropping economic operations', async () => {
  await offline.queueOperation('sale.upsert', 'TX-keep', { id: 'TX-keep' });
  await offline.queueSharedState({ tables: [{ id: 1, items: [] }] });
  await offline.queueSharedState({ tables: [{ id: 1, items: [{ id: 'latte' }] }] });

  const operations = await offline.getPendingOperations();
  assert.equal(operations.filter(operation => operation.kind === 'sale.upsert').length, 1);
  assert.equal(operations.filter(operation => operation.kind === 'shared_state.upsert').length, 1);
  assert.equal(operations.find(operation => operation.kind === 'shared_state.upsert').payload.tables[0].items[0].id, 'latte');
});

test('persists a closure with its outbox operation and includes it in the recovery export', async () => {
  const initialized = await offline.initializeLocalDatabase();
  const closure = {
    id: 'closure-offline-1',
    businessDate: '2026-08-01',
    closedAt: '2026-08-01T23:00:00.000Z',
    openingCash: 100,
    expectedCash: 145.5,
    countedCash: 145.5,
    difference: 0,
    salesTotal: 45.5
  };

  await offline.persistClosureLocally(closure, {
    deviceId: initialized.device.id,
    sessionId: 'offline-session-closure'
  });

  const bootstrap = await offline.loadCachedBootstrap();
  assert.equal(bootstrap.closures.length, 1);
  assert.equal(bootstrap.closures[0].expectedCash, 145.5);

  const operations = await offline.getPendingOperations();
  assert.equal(operations.length, 1);
  assert.equal(operations[0].kind, 'closure.upsert');

  const backup = await offline.exportEmergencyBackup();
  assert.equal(backup.closures[0].id, closure.id);
  assert.equal(backup.outbox[0].operationId, operations[0].operationId);
});
