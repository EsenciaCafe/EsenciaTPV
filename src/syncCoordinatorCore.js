export class SyncCoordinatorCore {
  constructor({ onStatusChange, dependencies }) {
    this.onStatusChange = onStatusChange || (() => {});
    this.dependencies = dependencies;
    this.flushing = false;
    this.flushPromise = null;
    this.timer = null;
    this.failureCount = 0;
    this.retryDelay = 5000;
  }

  async getStatus() {
    return this.dependencies.getLocalReadiness();
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
    if (typeof navigator === 'undefined' || navigator.onLine === false) return false;
    if (this.flushPromise) return this.flushPromise;

    this.flushing = true;
    this.flushPromise = this.flushAllPending();
    try {
      return await this.flushPromise;
    } finally {
      this.flushing = false;
      this.flushPromise = null;
    }
  }

  async flushAllPending() {
    const dependencies = this.dependencies;
    let processedBatches = 0;

    while (processedBatches < 20) {
      const pending = await dependencies.getPendingOperations(50);
      if (pending.length === 0) {
        const readiness = await dependencies.getLocalReadiness();
        if (readiness.mode === 'emergency') {
          try {
            await dependencies.completeOfflineSession(readiness.sessionId);
            await dependencies.completeEmergencySession();
          } catch (error) {
            this.reportFailure(error);
            this.schedule(this.retryDelay);
            return false;
          }
        }
        this.reportSuccess();
        this.onStatusChange({
          syncing: false,
          degraded: false,
          readiness: await dependencies.getLocalReadiness()
        });
        return true;
      }

      const ids = pending.map(item => item.operationId);
      await dependencies.markOperationsSyncing(ids);
      this.onStatusChange({ syncing: true, pending: pending.length });

      try {
        const deviceId = pending[0].deviceId;
        const sessionId = pending.find(item => item.sessionId)?.sessionId || null;
        const results = await dependencies.applyOfflineBatch(deviceId, sessionId, pending);
        await dependencies.applySyncResults(results);
        const readiness = await dependencies.getLocalReadiness();
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
        this.onStatusChange({ syncing: readiness.pending > 0, degraded: false, readiness });
        processedBatches += 1;
      } catch (error) {
        await dependencies.resetSyncingOperations(error?.message || 'No se pudo sincronizar');
        const degraded = this.reportFailure(error);
        this.onStatusChange({ syncing: false, degraded, error: error?.message || String(error) });
        this.schedule(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 120000);
        return false;
      }
    }

    this.schedule(300);
    return false;
  }
}
