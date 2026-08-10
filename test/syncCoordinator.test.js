import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true
});

const { SyncCoordinatorCore } = await import('../src/syncCoordinatorCore.js');

function createDependencies(overrides = {}) {
  return {
    getPendingOperations: async () => [],
    getLocalReadiness: async () => ({ mode: 'online', pending: 0, conflicts: 0 }),
    markOperationsSyncing: async () => {},
    applyOfflineBatch: async () => [],
    applySyncResults: async () => {},
    resetSyncingOperations: async () => {},
    completeOfflineSession: async () => {},
    completeEmergencySession: async () => {},
    ...overrides
  };
}

test('concurrent flush calls wait for the same active synchronization', async () => {
  let pendingReads = 0;
  let batchCalls = 0;
  let releaseBatch;
  const batchGate = new Promise(resolve => { releaseBatch = resolve; });
  const dependencies = createDependencies({
    getPendingOperations: async () => {
      pendingReads += 1;
      return pendingReads === 1
        ? [{ operationId: 'op-1', deviceId: 'device-1', sessionId: null }]
        : [];
    },
    applyOfflineBatch: async () => {
      batchCalls += 1;
      await batchGate;
      return [{ operationId: 'op-1', status: 'synced' }];
    }
  });
  const coordinator = new SyncCoordinatorCore({ dependencies });

  const first = coordinator.flush();
  const second = coordinator.flush();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(batchCalls, 1);

  releaseBatch();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(batchCalls, 1);
});

test('flush drains more than one pending batch before reporting success', async () => {
  const batches = [
    [{ operationId: 'op-1', deviceId: 'device-1', sessionId: 'session-1' }],
    [{ operationId: 'op-2', deviceId: 'device-1', sessionId: 'session-1' }],
    []
  ];
  let batchCalls = 0;
  const dependencies = createDependencies({
    getPendingOperations: async () => batches.shift() || [],
    applyOfflineBatch: async (_deviceId, _sessionId, operations) => {
      batchCalls += 1;
      return operations.map(operation => ({ operationId: operation.operationId, status: 'synced' }));
    }
  });
  const coordinator = new SyncCoordinatorCore({ dependencies });

  assert.equal(await coordinator.flush(), true);
  assert.equal(batchCalls, 2);
});

test('flush does not start while the browser is offline', async () => {
  const previousOnline = navigator.onLine;
  navigator.onLine = false;
  let pendingReads = 0;
  const coordinator = new SyncCoordinatorCore({
    dependencies: createDependencies({
      getPendingOperations: async () => {
        pendingReads += 1;
        return [];
      }
    })
  });

  assert.equal(await coordinator.flush(), false);
  assert.equal(pendingReads, 0);
  navigator.onLine = previousOnline;
});
