import {
  applySyncResults,
  completeEmergencySession,
  getLocalReadiness,
  getPendingOperations,
  markOperationsSyncing,
  resetSyncingOperations
} from './localDb.js';
import { applyOfflineBatch, completeOfflineSession } from './db.js';

export class SyncCoordinator {
  constructor({ onStatusChange } = {}) {
    this.onStatusChange = onStatusChange || (() => {});
    this.flushing = false;
    this.timer = null;
    this.failureCount = 0;
    this.retryDelay = 5000;
  }

  async getStatus() {
    return getLocalReadiness();
  }

  reportSuccess() {
    this.failureCount = 0;
    this.retryDelay = 5000;
  }

  reportFailure(error) {
    this.failureCount += 1;
    const degraded = this.failureCount >= 3;
    this.onStatusChange({ degraded, failureCount: this.failureCount, error: error?.message || String(error || '') });
    return degraded;
  }

  schedule(delay = 250) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  async flush() {
    if (this.flushing || typeof navigator === 'undefined' || navigator.onLine === false) return false;
    const pending = await getPendingOperations(50);
    if (pending.length === 0) {
      const readiness = await getLocalReadiness();
      if (readiness.mode === 'emergency') {
        try {
          await completeOfflineSession(readiness.sessionId);
          await completeEmergencySession();
        } catch (error) {
          this.reportFailure(error);
          this.schedule(this.retryDelay);
          return false;
        }
      }
      this.reportSuccess();
      this.onStatusChange({ syncing: false, degraded: false, readiness: await getLocalReadiness() });
      return true;
    }

    this.flushing = true;
    const ids = pending.map(item => item.operationId);
    await markOperationsSyncing(ids);
    this.onStatusChange({ syncing: true, pending: pending.length });

    try {
      const deviceId = pending[0].deviceId;
      const sessionId = pending.find(item => item.sessionId)?.sessionId || null;
      const results = await applyOfflineBatch(deviceId, sessionId, pending);
      await applySyncResults(results);
      const readiness = await getLocalReadiness();
      const failed = results.some(result => result.status === 'failed');
      if (failed) {
        const error = new Error(results.find(result => result.status === 'failed')?.error || 'Hay operaciones pendientes de sincronizar.');
        const degraded = this.reportFailure(error);
        this.onStatusChange({ syncing: false, degraded, readiness, error: error.message });
        this.schedule(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 120000);
        return false;
      }

      this.reportSuccess();
      this.retryDelay = 5000;
      this.onStatusChange({ syncing: false, degraded: false, readiness });
      if (readiness.pending > 0) this.schedule(300);
      else if (readiness.mode === 'emergency' && readiness.conflicts === 0) {
        await completeOfflineSession(readiness.sessionId);
        await completeEmergencySession();
        this.onStatusChange({ syncing: false, degraded: false, readiness: await getLocalReadiness() });
      }
      return true;
    } catch (error) {
      await resetSyncingOperations(error?.message || 'No se pudo sincronizar');
      const degraded = this.reportFailure(error);
      this.onStatusChange({ syncing: false, degraded, error: error?.message || String(error) });
      this.schedule(this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 120000);
      return false;
    } finally {
      this.flushing = false;
    }
  }
}
