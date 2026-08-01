import Dexie from 'dexie';

const DB_NAME = 'esencia-tpv-local-v1';
const DEVICE_KEY = 'device';
const SNAPSHOT_KEY = 'operational';
const CATALOG_KEY = 'catalog';
const STAFF_KEY = 'staff';
const CLOSURES_KEY = 'closures';
const STATUS_KEY = 'offline-status';
const FISCAL_HEAD_KEY = 'emergency-fiscal-head';

const clone = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export function createUuid(prefix = '') {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return prefix ? `${prefix}-${id}` : id;
}

class LocalTpvDatabase extends Dexie {
  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      meta: '&key, updatedAt',
      snapshots: '&key, updatedAt',
      transactions: '&id, createdAt, type, syncStatus',
      closures: '&id, businessDate, closedAt, syncStatus',
      outbox: '&operationId, sequence, status, kind, entityId, occurredAt, [status+sequence]',
      conflicts: '&id, operationId, createdAt, resolvedAt'
    });
  }
}

const supported = typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
export const localDb = supported ? new LocalTpvDatabase() : null;

async function readMeta(key, fallback = null) {
  if (!localDb) return fallback;
  const row = await localDb.meta.get(key);
  return row?.value ?? fallback;
}

async function writeMeta(key, value) {
  if (!localDb) return false;
  await localDb.meta.put({ key, value: clone(value), updatedAt: new Date().toISOString() });
  return true;
}

export async function initializeLocalDatabase() {
  if (!localDb) return { available: false, persistent: false };
  await localDb.open();
  let persistent = false;
  try {
    if (navigator.storage?.persisted) persistent = await navigator.storage.persisted();
    if (!persistent && navigator.storage?.persist) persistent = await navigator.storage.persist();
  } catch (_) {
    persistent = false;
  }

  let device = await readMeta(DEVICE_KEY);
  if (!device?.id) {
    device = {
      id: createUuid('device'),
      label: 'TPV de Esencia',
      designated: false,
      createdAt: new Date().toISOString()
    };
    await writeMeta(DEVICE_KEY, device);
  }

  const offlineStatus = await readMeta(STATUS_KEY, {
    mode: 'online',
    sessionId: null,
    activatedAt: null,
    activatedBy: null,
    lastSyncAt: null
  });
  return { available: true, persistent, device, offlineStatus };
}

export async function loadCachedBootstrap() {
  if (!localDb) return null;
  const [operational, catalog, staff, closureSnapshot, localClosures, transactions, device, offlineStatus, pending] = await Promise.all([
    localDb.snapshots.get(SNAPSHOT_KEY),
    localDb.snapshots.get(CATALOG_KEY),
    localDb.snapshots.get(STAFF_KEY),
    localDb.snapshots.get(CLOSURES_KEY),
    localDb.closures.toArray(),
    localDb.transactions.orderBy('createdAt').reverse().toArray(),
    readMeta(DEVICE_KEY),
    readMeta(STATUS_KEY),
    localDb.outbox.where('status').anyOf('pending', 'failed', 'syncing').count()
  ]);
  const closuresById = new Map(
    (closureSnapshot?.payload || []).map(closure => [String(closure.id), closure])
  );
  localClosures.forEach(closure => closuresById.set(String(closure.id), closure));
  return {
    operational: operational?.payload || null,
    catalog: catalog?.payload || null,
    staff: staff?.payload || [],
    closures: [...closuresById.values()],
    transactions,
    device,
    offlineStatus,
    pending
  };
}

export async function cacheOperationalSnapshot(payload) {
  if (!localDb) return false;
  await localDb.snapshots.put({ key: SNAPSHOT_KEY, payload: clone(payload), updatedAt: new Date().toISOString() });
  return true;
}

export async function cacheCatalogSnapshot(payload) {
  if (!localDb) return false;
  await localDb.snapshots.put({ key: CATALOG_KEY, payload: clone(payload), updatedAt: new Date().toISOString() });
  return true;
}

export async function cacheStaffSnapshot(payload) {
  if (!localDb) return false;
  const deviceId = (await readMeta(DEVICE_KEY))?.id || 'unknown-device';
  const safeProfiles = await Promise.all((Array.isArray(payload) ? payload : []).map(async profile => ({
    ...clone(profile),
    pin_code: '',
    pin_verifier: profile.pin_code
      ? await sha256(`${deviceId}:${String(profile.pin_code)}`)
      : profile.pin_verifier || ''
  })));
  await localDb.snapshots.put({ key: STAFF_KEY, payload: safeProfiles, updatedAt: new Date().toISOString() });
  return true;
}

export async function cacheClosuresSnapshot(payload) {
  if (!localDb) return false;
  await localDb.snapshots.put({ key: CLOSURES_KEY, payload: clone(payload), updatedAt: new Date().toISOString() });
  return true;
}

async function nextSequence() {
  if (!localDb) return 0;
  return localDb.transaction('rw', localDb.meta, async () => {
    const current = Number(await readMeta('local-sequence', 0));
    const next = current + 1;
    await writeMeta('local-sequence', next);
    return next;
  });
}

export async function queueOperation(kind, entityId, payload, options = {}) {
  if (!localDb) return null;
  const sequence = await nextSequence();
  const operation = {
    operationId: options.operationId || createUuid('op'),
    deviceId: options.deviceId || (await readMeta(DEVICE_KEY))?.id || 'unknown-device',
    sessionId: options.sessionId || null,
    sequence,
    kind,
    entityId: String(entityId || ''),
    payload: clone(payload),
    occurredAt: options.occurredAt || new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    lastError: null
  };
  await localDb.outbox.put(operation);
  return operation;
}

export async function queueSharedState(payload, options = {}) {
  if (!localDb) return null;
  await localDb.transaction('rw', localDb.outbox, async () => {
    const pending = await localDb.outbox.where('kind').equals('shared_state.upsert').toArray();
    const replaceable = pending.filter(item => ['pending', 'failed'].includes(item.status));
    if (replaceable.length) await localDb.outbox.bulkDelete(replaceable.map(item => item.operationId));
  });
  return queueOperation('shared_state.upsert', 'global', payload, options);
}

export async function persistSaleLocally(transaction, options = {}) {
  if (!localDb || !transaction?.id) return transaction;
  const tx = clone(transaction);
  await localDb.transaction('rw', localDb.transactions, localDb.outbox, localDb.meta, async () => {
    await localDb.transactions.put({ ...tx, syncStatus: 'pending' });
    const sequence = Number(await readMeta('local-sequence', 0)) + 1;
    await writeMeta('local-sequence', sequence);
    await localDb.outbox.put({
      operationId: createUuid('op'),
      deviceId: options.deviceId || (await readMeta(DEVICE_KEY))?.id || 'unknown-device',
      sessionId: options.sessionId || null,
      sequence,
      kind: 'sale.upsert',
      entityId: tx.id,
      payload: tx,
      occurredAt: tx.createdAt || new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      lastError: null
    });
  });
  await pruneLocalHistory();
  return tx;
}

export async function pruneLocalHistory(retentionDays = 30) {
  if (!localDb) return 0;
  const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86400000).toISOString();
  const protectedIds = new Set((await localDb.outbox.toArray()).map(item => String(item.entityId)));
  const expired = await localDb.transactions.where('createdAt').below(cutoff).primaryKeys();
  const removable = expired.filter(id => !protectedIds.has(String(id)));
  if (removable.length) await localDb.transactions.bulkDelete(removable);
  return removable.length;
}

export async function persistClosureLocally(closure, options = {}) {
  if (!localDb || !closure?.id) return closure;
  const snapshot = clone(closure);
  await localDb.transaction('rw', localDb.closures, localDb.outbox, localDb.meta, async () => {
    await localDb.closures.put({ ...snapshot, syncStatus: 'pending' });
    const sequence = Number(await readMeta('local-sequence', 0)) + 1;
    await writeMeta('local-sequence', sequence);
    await localDb.outbox.put({
      operationId: createUuid('op'),
      deviceId: options.deviceId || (await readMeta(DEVICE_KEY))?.id || 'unknown-device',
      sessionId: options.sessionId || null,
      sequence,
      kind: 'closure.upsert',
      entityId: snapshot.id,
      payload: snapshot,
      occurredAt: snapshot.closedAt || new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      lastError: null
    });
  });
  return snapshot;
}

export async function getPendingOperations(limit = 50) {
  if (!localDb) return [];
  const items = await localDb.outbox.toArray();
  return items
    .filter(item => ['pending', 'failed', 'syncing'].includes(item.status))
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .slice(0, limit);
}

export async function markOperationsSyncing(ids) {
  if (!localDb || ids.length === 0) return;
  await localDb.outbox.where('operationId').anyOf(ids).modify(item => {
    item.status = 'syncing';
    item.attempts = Number(item.attempts || 0) + 1;
  });
}

export async function applySyncResults(results = []) {
  if (!localDb) return;
  await localDb.transaction('rw', localDb.outbox, localDb.transactions, localDb.closures, localDb.conflicts, localDb.meta, async () => {
    for (const result of results) {
      const operation = await localDb.outbox.get(result.operationId);
      if (!operation) continue;
      if (result.status === 'synced' || result.status === 'duplicate') {
        await localDb.outbox.delete(operation.operationId);
        if (operation.kind === 'sale.upsert') {
          await localDb.transactions.update(operation.entityId, { syncStatus: 'synced' });
        } else if (operation.kind === 'closure.upsert') {
          await localDb.closures.update(operation.entityId, { syncStatus: 'synced' });
        }
      } else if (result.status === 'conflict') {
        await localDb.outbox.update(operation.operationId, { status: 'conflict', lastError: result.error || 'Conflicto' });
        await localDb.conflicts.put({
          id: createUuid('conflict'),
          operationId: operation.operationId,
          kind: operation.kind,
          entityId: operation.entityId,
          localPayload: operation.payload,
          serverPayload: result.serverPayload || null,
          message: result.error || 'Conflicto de sincronizacion',
          createdAt: new Date().toISOString(),
          resolvedAt: null
        });
      } else {
        await localDb.outbox.update(operation.operationId, { status: 'failed', lastError: result.error || 'Error de sincronizacion' });
      }
    }
    await writeMeta('last-sync-at', new Date().toISOString());
  });
}

export async function resetSyncingOperations(error = 'Sincronizacion interrumpida') {
  if (!localDb) return;
  await localDb.outbox.where('status').equals('syncing').modify(item => {
    item.status = 'failed';
    item.lastError = error;
  });
}

export async function getLocalReadiness() {
  if (!localDb) return { available: false, pending: 0, conflicts: 0 };
  const storageEstimate = typeof navigator !== 'undefined' && navigator.storage?.estimate
    ? await navigator.storage.estimate().catch(() => null)
    : null;
  const [device, status, operational, catalog, staff, pending, conflicts, lastSyncAt] = await Promise.all([
    readMeta(DEVICE_KEY),
    readMeta(STATUS_KEY),
    localDb.snapshots.get(SNAPSHOT_KEY),
    localDb.snapshots.get(CATALOG_KEY),
    localDb.snapshots.get(STAFF_KEY),
    localDb.outbox.where('status').anyOf('pending', 'failed', 'syncing').count(),
    localDb.conflicts.toArray().then(rows => rows.filter(row => !row.resolvedAt).length),
    readMeta('last-sync-at')
  ]);
  return {
    available: true,
    designated: device?.designated === true,
    deviceId: device?.id || null,
    mode: status?.mode || 'online',
    sessionId: status?.sessionId || null,
    activatedAt: status?.activatedAt || null,
    lastSyncAt: lastSyncAt || status?.lastSyncAt || null,
    pending,
    conflicts,
    storageUsage: Number(storageEstimate?.usage || 0),
    storageQuota: Number(storageEstimate?.quota || 0),
    hasOperationalSnapshot: Boolean(operational?.payload),
    hasCatalog: Boolean(catalog?.payload),
    hasStaff: Array.isArray(staff?.payload) && staff.payload.length > 0
  };
}

export async function setEmergencyDesignation(designated) {
  const device = await readMeta(DEVICE_KEY);
  if (!device) return null;
  const updated = { ...device, designated: Boolean(designated), updatedAt: new Date().toISOString() };
  await writeMeta(DEVICE_KEY, updated);
  return updated;
}

export async function activateEmergencySession(profile) {
  const device = await readMeta(DEVICE_KEY);
  if (!device?.designated) throw new Error('Este dispositivo no esta designado para emergencias.');
  const status = {
    mode: 'emergency',
    sessionId: createUuid('offline'),
    activatedAt: new Date().toISOString(),
    activatedBy: profile ? { id: profile.id, name: profile.display_name, role: profile.role } : null,
    lastSyncAt: await readMeta('last-sync-at')
  };
  await writeMeta(STATUS_KEY, status);
  return status;
}

export async function completeEmergencySession() {
  const current = await readMeta(STATUS_KEY, {});
  const status = {
    ...current,
    mode: 'online',
    sessionId: null,
    endedAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString()
  };
  await writeMeta(STATUS_KEY, status);
  return status;
}

export async function findCachedStaffByPin(pinCode, roles = null) {
  if (!localDb) return null;
  const row = await localDb.snapshots.get(STAFF_KEY);
  const profiles = Array.isArray(row?.payload) ? row.payload : [];
  const deviceId = (await readMeta(DEVICE_KEY))?.id || 'unknown-device';
  const verifier = await sha256(`${deviceId}:${String(pinCode || '')}`);
  return profiles.find(profile => (
    profile.active !== false &&
    (profile.pin_verifier === verifier || String(profile.pin_code || '') === String(pinCode || '')) &&
    (!roles || roles.includes(profile.role))
  )) || null;
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createEmergencyFiscalDocument(transaction, legalData, deviceId) {
  if (!localDb || !transaction?.id || !crypto?.subtle) return null;
  const date = new Date(transaction.createdAt || Date.now());
  const year = String(date.getFullYear());
  const isRefund = transaction.type === 'refund';
  const series = `${isRefund ? 'RE' : 'SE'}${year}`;
  const sifId = `ESENCIA-OFFLINE-${deviceId}`;
  return localDb.transaction('rw', localDb.meta, async () => {
    const heads = await readMeta(FISCAL_HEAD_KEY, {});
    const head = heads[series] || { number: 0, hash: '' };
    const number = Number(head.number || 0) + 1;
    const fiscalNumber = `${series}-${String(number).padStart(6, '0')}`;
    const total = Number(transaction.total || 0);
    const taxRate = Number(legalData?.taxRate || 0);
    const taxableBase = taxRate === 0 ? total : Number((total / (1 + taxRate / 100)).toFixed(2));
    const taxAmount = Number((total - taxableBase).toFixed(2));
    const issuedAt = transaction.createdAt || new Date().toISOString();
    const hashSource = [head.hash || '', sifId, fiscalNumber, transaction.type || 'sale', issuedAt, total, taxableBase, taxAmount, legalData?.nif || '', transaction.id].join('|');
    const hash = await Dexie.waitFor(sha256(hashSource));
    const document = {
      id: createUuid('fiscal'),
      saleId: transaction.id,
      sifId,
      type: isRefund ? 'refund' : 'simplified_invoice',
      status: 'issued',
      series,
      number,
      fiscalNumber,
      issuedAt,
      totalAmount: total,
      taxName: legalData?.taxName || 'IGIC',
      taxRate,
      taxableBase,
      taxAmount,
      previousHash: head.hash || '',
      hash,
      aeatStatus: 'pending',
      incident: true
    };
    heads[series] = { number, hash, fiscalNumber, updatedAt: issuedAt };
    await writeMeta(FISCAL_HEAD_KEY, heads);
    return document;
  });
}

export async function exportEmergencyBackup() {
  if (!localDb) throw new Error('IndexedDB no esta disponible.');
  const [meta, snapshots, transactions, closures, outbox, conflicts] = await Promise.all([
    localDb.meta.toArray(),
    localDb.snapshots.toArray(),
    localDb.transactions.toArray(),
    localDb.closures.toArray(),
    localDb.outbox.toArray(),
    localDb.conflicts.toArray()
  ]);
  return {
    format: 'esencia-tpv-emergency-backup/v1',
    exportedAt: new Date().toISOString(),
    meta,
    snapshots,
    transactions,
    closures,
    outbox,
    conflicts
  };
}
