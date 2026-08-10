import {
  applySyncResults,
  completeEmergencySession,
  getLocalReadiness,
  getPendingOperations,
  markOperationsSyncing,
  resetSyncingOperations
} from './localDb.js';
import { applyOfflineBatch, completeOfflineSession } from './db.js';
import { SyncCoordinatorCore } from './syncCoordinatorCore.js';

const defaultDependencies = {
  applySyncResults,
  completeEmergencySession,
  getLocalReadiness,
  getPendingOperations,
  markOperationsSyncing,
  resetSyncingOperations,
  applyOfflineBatch,
  completeOfflineSession
};

export class SyncCoordinator extends SyncCoordinatorCore {
  constructor({ onStatusChange, dependencies } = {}) {
    super({
      onStatusChange,
      dependencies: { ...defaultDependencies, ...(dependencies || {}) }
    });
  }
}
