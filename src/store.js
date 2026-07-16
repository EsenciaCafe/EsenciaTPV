import {
  loadCatalog,
  upsertCategory,
  deleteCategory as dbDeleteCategory,
  upsertMenuItem,
  upsertModifier,
  deleteModifier as dbDeleteModifier,
  upsertGridItems,
  deleteGridItems,
  loadTPVState,
  saveTPVState,
  upsertReceiptTicket,
  loadSales,
  upsertSaleRecord,
  createFiscalDocumentForSale,
  loadCashClosures,
  upsertCashClosure,
  loadSquareGiftCardEvents,
  loadStaffProfiles,
  findStaffByPin,
  upsertStaffProfile,
  deleteStaffProfile as dbDeleteStaffProfile,
  loadSupplierInvoices,
  loadSupplierInvoiceLines,
  upsertSupplierInvoice,
  replaceSupplierInvoiceLines,
  deleteSupplierInvoice as dbDeleteSupplierInvoice,
  loadSupplierSenderRules,
  upsertSupplierSenderRule
} from './db.js';
import { supabase } from './supabase.js';


const DINING_STATE_STORAGE_KEY = 'tpv-dining-state-v1';
const STAFF_SESSION_STORAGE_KEY = 'tpv-staff-session-v1';
const SYNC_CLIENT_STORAGE_KEY = 'tpv-sync-client-id-v1';
const DEFAULT_ROLE_PERMISSIONS = {
  admin: {
    accessSettings: true,
    manageCatalog: true,
    manageAccounting: true,
    viewReports: true,
    closeCash: true,
    issueRefunds: true,
    resetTerminal: true,
    manageStaff: true,
    managePermissions: true,
    manageLoyalty: true
  },
  manager: {
    accessSettings: true,
    manageCatalog: false,
    manageAccounting: false,
    viewReports: true,
    closeCash: true,
    issueRefunds: true,
    resetTerminal: false,
    manageStaff: false,
    managePermissions: false,
    manageLoyalty: true
  },
  staff: {
    accessSettings: false,
    manageCatalog: false,
    manageAccounting: false,
    viewReports: false,
    closeCash: false,
    issueRefunds: false,
    resetTerminal: false,
    manageStaff: false,
    managePermissions: false,
    manageLoyalty: false
  }
};

const createInitialTables = () => [
  ...Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `Mesa ${i + 1}`,
  type: 'table',
  status: 'available', // 'available' | 'occupied' | 'pending-bill'
  items: []
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    id: 101 + i,
    name: `Take Away ${i + 1}`,
    type: 'takeaway',
    status: 'available',
    items: []
  }))
];

// simple pub/sub store for state management
class Store {
  constructor() {
    let initialTheme = 'system';
    if (typeof window !== 'undefined' && window.localStorage) {
      initialTheme = window.localStorage.getItem('tpv-theme') || 'system';
    }

    // Initial State — catalog data will be replaced by Supabase on loadFromSupabase()
    this.state = {
      theme: initialTheme,
      activeTab: 'inicio',           // 'mesas' | 'inicio' | 'transacciones' | 'ajustes'
      activePosTab: 'atajos',       // 'teclado' | 'atajos' | 'productos'
      selectedTableId: null,        // null = Venta Directa (Bar)
      gridPath: ['root'],          // Navigation path for the 3x3 grid
      settingsPath: [],            // Nested settings tree path
      isEditingGrid: false,        // Grid shortcut editing mode
      
      // 12 tables for our cafe
      tables: createInitialTables(),
      kdsState: {},
      
      // Direct Sale (Venta Directa) ticket when no table is selected
      directSaleTicket: {
        items: []
      },

      // Completed transactions history (in-memory, not persisted)
      transactions: [],

      // Fiscal / Legal Details (Default to Tenerife IGIC 7%)
      legal: {
        businessName: "Esencia Café",
        companyName: "Esencia Café S.L.",
        nif: "B-87654321",
        address: "Calle del Grano 12, 38001 Santa Cruz de Tenerife",
        taxName: "IGIC",
        taxRate: 7
      },

      // ── CATALOG DATA (loaded from Supabase) ─────────────────
      categories: [],
      modifiers: [],
      menuItems: [],
      gridItems: {},
      staffProfiles: [],
      supplierInvoices: [],
      supplierInvoiceLines: [],
      supplierSenderRules: [],
      cashClosures: [],
      squareGiftCardEvents: [],
      rolePermissions: JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS)),

      // ── REPORT NAVIGATION ─────────────────────────────────────
      // ISO date string YYYY-MM-DD (default = today)
      selectedReportDate: new Date().toISOString().slice(0, 10),
      // Month string YYYY-MM (default = current month)
      selectedReportMonth: new Date().toISOString().slice(0, 7),

      auth: {
        profile: null,
        role: null,
        isLoading: true
      }
    };
    
    this.restoreDiningState();
    this.salesPersistenceReady = false;
    this.cashClosurePersistenceReady = false;
    this.syncClientId = this.getSyncClientId();
    this.tableSyncFingerprints = new Map();
    this.refreshTableSyncFingerprints();
    this.lastLocalPersistSnapshot = '';
    this.lastRemotePersistSnapshot = '';
    this.pendingRemotePersist = null;
    this.remotePersistTimer = null;
    this.resumeSyncTimer = null;
    this.realtimeReconnectTimer = null;
    this.salesRefreshTimer = null;
    this.listeners = [];
    this.setupResumeSync();
  }

  restoreDiningState() {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const rawState = window.localStorage.getItem(DINING_STATE_STORAGE_KEY);
      if (!rawState) return;

      const savedState = JSON.parse(rawState);
      if (Array.isArray(savedState.tables)) {
        const savedTables = new Map(savedState.tables.map(table => [Number(table.id), table]));
        this.state.tables = this.state.tables.map(defaultTable => {
          const savedTable = savedTables.get(defaultTable.id);
          if (!savedTable) return defaultTable;

          const items = Array.isArray(savedTable.items) ? savedTable.items : [];
          const savedStatus = ['available', 'occupied', 'pending-bill'].includes(savedTable.status)
            ? savedTable.status
            : 'available';
          const status = items.length === 0
            ? 'available'
            : savedStatus === 'available' ? 'occupied' : savedStatus;

          return {
            ...defaultTable,
            name: savedTable.name || defaultTable.name,
            type: savedTable.type || defaultTable.type || 'table',
            status,
            items,
            ...(items.length > 0 && savedTable.loyaltyAwarded ? { loyaltyAwarded: savedTable.loyaltyAwarded } : {})
          };
        });
      }

      if (savedState.directSaleTicket && Array.isArray(savedState.directSaleTicket.items)) {
        this.state.directSaleTicket = {
          items: savedState.directSaleTicket.items,
          ...(savedState.directSaleTicket.items.length > 0 && savedState.directSaleTicket.loyaltyAwarded
            ? { loyaltyAwarded: savedState.directSaleTicket.loyaltyAwarded }
            : {})
        };
      }

      if (Array.isArray(savedState.transactions)) {
        this.state.transactions = savedState.transactions;
      }

      if (savedState.legal) {
        this.state.legal = { ...this.state.legal, ...savedState.legal };
      }
      if (savedState.rolePermissions) {
        this.state.rolePermissions = this.mergeRolePermissions(savedState.rolePermissions);
      }
      if (savedState.kdsState && typeof savedState.kdsState === 'object') {
        this.state.kdsState = savedState.kdsState;
      }
    } catch (err) {
      console.warn('[Store] No se pudo restaurar el estado de mesas.', err);
    }
  }

  getSyncClientId() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return `client-${Math.random().toString(36).slice(2)}`;
    }

    let clientId = window.localStorage.getItem(SYNC_CLIENT_STORAGE_KEY);
    if (!clientId) {
      clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(SYNC_CLIENT_STORAGE_KEY, clientId);
    }
    return clientId;
  }

  getTableSyncFingerprint(table = {}) {
    const { syncUpdatedAt, syncClientId, ...stableTable } = table;
    return JSON.stringify(stableTable);
  }

  ensureTableSyncMetadata(tables = this.state.tables) {
    const now = new Date().toISOString();
    return tables.map(table => {
      const fingerprint = this.getTableSyncFingerprint(table);
      const previousFingerprint = this.tableSyncFingerprints.get(table.id);
      const changedLocally = previousFingerprint !== undefined && previousFingerprint !== fingerprint;
      const nextTable = (changedLocally || !table.syncUpdatedAt)
        ? {
            ...table,
            syncUpdatedAt: changedLocally ? now : (table.syncUpdatedAt || now),
            syncClientId: changedLocally ? this.syncClientId : (table.syncClientId || this.syncClientId)
          }
        : table;
      this.tableSyncFingerprints.set(table.id, this.getTableSyncFingerprint(nextTable));
      return nextTable;
    });
  }

  refreshTableSyncFingerprints(tables = this.state.tables) {
    this.tableSyncFingerprints = new Map(
      tables.map(table => [table.id, this.getTableSyncFingerprint(table)])
    );
  }

  getPersistPayload() {
    return {
      tables: this.state.tables,
      kdsState: this.state.kdsState,
      directSaleTicket: this.state.directSaleTicket,
      transactions: this.state.transactions,
      legal: this.state.legal,
      rolePermissions: this.state.rolePermissions
    };
  }

  getRemotePersistPayload() {
    this.state.tables = this.ensureTableSyncMetadata(this.state.tables);
    return {
      tables: this.state.tables,
      kdsState: null,
      directSaleTicket: { items: [] },
      transactions: [],
      legal: this.state.legal,
      rolePermissions: this.state.rolePermissions
    };
  }

  flushRemotePersist() {
    if (!this.pendingRemotePersist) return;
    if (this.remotePersistTimer) {
      clearTimeout(this.remotePersistTimer);
      this.remotePersistTimer = null;
    }

    const { payload, snapshot } = this.pendingRemotePersist;
    this.pendingRemotePersist = null;
    this.lastRemotePersistSnapshot = snapshot;

    saveTPVState(payload.tables, payload.directSaleTicket, payload.transactions, payload.legal, payload.rolePermissions, payload.kdsState)
      .catch(err => {
        console.warn('[Store] No se pudo guardar el estado en Supabase.', err);
        this.lastRemotePersistSnapshot = '';
      });
  }

  persistDiningState({ remote = true } = {}) {
    this.state.tables = this.ensureTableSyncMetadata(this.state.tables);
    const localPayload = this.getPersistPayload();
    const localSnapshot = JSON.stringify(localPayload);

    // 1. Save to LocalStorage fallback
    if (localSnapshot !== this.lastLocalPersistSnapshot && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(DINING_STATE_STORAGE_KEY, localSnapshot);
        this.lastLocalPersistSnapshot = localSnapshot;
      } catch (err) {
        console.warn('[Store] No se pudo guardar el estado de mesas en LocalStorage.', err);
      }
    }

    // 2. Save to Supabase (Realtime Sync)
    const remotePayload = this.getRemotePersistPayload();
    const remoteSnapshot = JSON.stringify(remotePayload);
    if (!remote || remoteSnapshot === this.lastRemotePersistSnapshot) return;

    this.pendingRemotePersist = { payload: remotePayload, snapshot: remoteSnapshot };
    if (this.remotePersistTimer) clearTimeout(this.remotePersistTimer);
    this.remotePersistTimer = setTimeout(() => {
      this.remotePersistTimer = null;
      this.flushRemotePersist();
    }, 180);
  }

  // Subscribe components
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  emitChange(meta = {}) {
    this.listeners.forEach(listener => listener(this.state, meta));
  }

  notify(options = {}) {
    this.persistDiningState(options);
    if (options.flushRemote) this.flushRemotePersist();
    this.emitChange(options);
  }

  getRoleLabel(role = this.state.auth.role) {
    const labels = {
      admin: 'Administrador',
      manager: 'Encargado',
      staff: 'Staff'
    };
    return labels[role] || 'Sin rol';
  }

  mergeRolePermissions(source = {}) {
    const merged = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
    ['manager', 'staff'].forEach(role => {
      if (source[role]) {
        merged[role] = { ...merged[role], ...source[role] };
      }
    });
    return merged;
  }

  hasPermission(permission, role = this.state.auth.role) {
    if (role === 'admin') return true;
    return this.state.rolePermissions?.[role]?.[permission] === true;
  }

  updateRolePermissions(role, permissions = {}) {
    if (!this.hasPermission('managePermissions') || role === 'admin') return false;
    this.state.rolePermissions = this.mergeRolePermissions({
      ...this.state.rolePermissions,
      [role]: {
        ...(this.state.rolePermissions?.[role] || {}),
        ...permissions
      }
    });
    this.notify();
    return true;
  }

  canAccessSettings() {
    return this.hasPermission('accessSettings') ||
      this.canManageCatalog() ||
      this.canManageAccounting() ||
      this.canViewReports() ||
      this.canCloseCash() ||
      this.canManageStaff() ||
      this.canManageLoyalty();
  }

  canManageCatalog() {
    return this.hasPermission('manageCatalog');
  }

  canManageAccounting() {
    return this.hasPermission('manageAccounting');
  }

  canViewReports() {
    return this.hasPermission('viewReports');
  }

  canCloseCash() {
    return this.hasPermission('closeCash');
  }

  canIssueRefunds() {
    return this.hasPermission('issueRefunds');
  }

  canResetTerminal() {
    return this.hasPermission('resetTerminal');
  }

  canManageStaff() {
    return this.hasPermission('manageStaff');
  }

  canManageLoyalty() {
    return this.hasPermission('manageLoyalty');
  }

  setStaffSession(profile) {
    const authProfile = profile ? {
      id: profile.id,
      display_name: profile.display_name,
      role: profile.role,
      active: profile.active !== false
    } : null;

    this.state.auth = {
      profile: authProfile,
      role: authProfile?.role || null,
      isLoading: false
    };

    if (typeof window !== 'undefined' && window.localStorage) {
      if (authProfile) {
        window.localStorage.setItem(STAFF_SESSION_STORAGE_KEY, JSON.stringify(authProfile));
      } else {
        window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
      }
    }

    if (!this.canAccessSettings() && this.state.activeTab === 'ajustes') {
      this.state.activeTab = 'mesas';
      this.state.settingsPath = [];
    }

    this.listeners.forEach(listener => listener(this.state));
  }

  async loadStaffDirectory() {
    this.state.staffProfiles = await loadStaffProfiles();
  }

  async loadSupplierInvoices() {
    this.state.supplierInvoices = await loadSupplierInvoices();
  }

  async loadSupplierInvoiceLines() {
    this.state.supplierInvoiceLines = await loadSupplierInvoiceLines();
  }

  async loadSupplierSenderRules() {
    this.state.supplierSenderRules = await loadSupplierSenderRules();
  }

  async refreshSupplierAccountingData({ notify = true } = {}) {
    await Promise.all([
      this.loadSupplierInvoices(),
      this.loadSupplierInvoiceLines(),
      this.loadSupplierSenderRules()
    ]);
    if (notify) this.notify();
  }

  async loadCashClosures() {
    const closures = await loadCashClosures();
    this.cashClosurePersistenceReady = Array.isArray(closures);
    if (Array.isArray(closures)) this.state.cashClosures = closures;
  }

  scheduleSalesRefresh(delay = 250) {
    if (this.salesRefreshTimer) clearTimeout(this.salesRefreshTimer);
    this.salesRefreshTimer = setTimeout(async () => {
      this.salesRefreshTimer = null;
      await this.refreshSalesFromSupabase();
    }, delay);
  }

  async refreshSalesFromSupabase() {
    if (!this.salesPersistenceReady) return false;
    try {
      const normalizedSales = await loadSales();
      if (!Array.isArray(normalizedSales)) return false;
      if (JSON.stringify(this.state.transactions) === JSON.stringify(normalizedSales)) return false;
      this.state.transactions = normalizedSales;
      this.persistDiningState({ remote: false });
      this.emitChange({ source: 'sales-realtime' });
      return true;
    } catch (err) {
      console.warn('[Store] No se pudieron refrescar las ventas normalizadas.', err);
      return false;
    }
  }

  async loadSquareGiftCardEvents() {
    this.state.squareGiftCardEvents = await loadSquareGiftCardEvents();
  }

  mapSquareGiftCardEventRow(row = {}) {
    return {
      id: row.id,
      saleId: row.sale_id || '',
      eventType: row.event_type || '',
      giftCardId: row.gift_card_id || '',
      giftCardGanLast4: row.gift_card_gan_last4 || '',
      squareActivityId: row.square_activity_id || '',
      referenceId: row.reference_id || '',
      amount: parseFloat(row.amount || 0),
      currency: row.currency || 'EUR',
      rawPayload: row.raw_payload || {},
      createdAt: row.created_at
    };
  }

  async loadAuthSession() {
    this.state.auth.isLoading = true;
    try {
      await this.loadStaffDirectory();
      let savedProfile = null;

      if (typeof window !== 'undefined' && window.localStorage) {
        const rawSession = window.localStorage.getItem(STAFF_SESSION_STORAGE_KEY);
        if (rawSession) {
          const parsed = JSON.parse(rawSession);
          savedProfile = this.state.staffProfiles.find(profile => profile.id === parsed.id && profile.active !== false) || null;
        }
      }

      this.setStaffSession(savedProfile);
    } catch (err) {
      console.warn('[Store] No se pudo cargar la sesion.', err);
      this.state.auth = {
        profile: null,
        role: null,
        isLoading: false
      };
      this.emitChange();
    }
  }

  async signInWithPin(pinCode) {
    const profile = await findStaffByPin(pinCode);
    if (!profile) {
      throw new Error('PIN no valido');
    }
    this.setStaffSession(profile);
    return profile;
  }

  async verifyAdminPin(pinCode) {
    const profile = await findStaffByPin(pinCode);
    return profile?.role === 'admin' ? profile : null;
  }

  async signOut() {
    this.setStaffSession(null);
    this.state.activeTab = 'inicio';
    this.state.selectedTableId = null;
    this.emitChange();
  }

  async saveStaffProfile(profileData) {
    if (!this.canManageStaff()) return false;
    await upsertStaffProfile(profileData);
    await this.loadStaffDirectory();
    this.notify();
    return true;
  }

  async deleteStaffProfile(id) {
    if (!this.canManageStaff()) return false;
    if (this.state.auth.profile?.id === id) return false;
    await dbDeleteStaffProfile(id);
    await this.loadStaffDirectory();
    this.notify();
    return true;
  }

  createReceiptToken() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }

  publishReceiptTicket(transaction) {
    upsertReceiptTicket(transaction).catch(err => {
      console.warn('[Store] No se pudo publicar el ticket público.', err);
    });
  }

  persistSaleRecord(transaction) {
    if (!this.salesPersistenceReady) return Promise.resolve(null);
    return upsertSaleRecord(transaction).catch(err => {
      console.warn('[Store] No se pudo guardar la venta normalizada.', err);
      return null;
    });
  }

  async ensureFiscalDocument(transactionId) {
    if (!this.salesPersistenceReady) return null;

    const txIndex = this.state.transactions.findIndex(tx => tx.id === transactionId);
    if (txIndex === -1) return null;

    const currentTx = this.state.transactions[txIndex];
    if (currentTx.fiscalData?.fiscalNumber) return currentTx.fiscalData;

    await this.persistSaleRecord(currentTx);
    const fiscalData = await createFiscalDocumentForSale(currentTx);
    if (!fiscalData?.fiscalNumber) return null;

    const updatedTx = {
      ...this.state.transactions[txIndex],
      fiscalData
    };
    this.state.transactions[txIndex] = updatedTx;

    await this.persistSaleRecord(updatedTx);
    if (updatedTx.receiptToken) {
      this.publishReceiptTicket(updatedTx);
    }

    this.notify();
    return fiscalData;
  }

  ensureTransactionReceiptToken(transactionId) {
    const txIndex = this.state.transactions.findIndex(tx => tx.id === transactionId);
    if (txIndex === -1) return null;

    if (!this.state.transactions[txIndex].receiptToken) {
      this.state.transactions[txIndex] = {
        ...this.state.transactions[txIndex],
        receiptToken: this.createReceiptToken()
      };
      this.notify();
    }

    this.publishReceiptTicket(this.state.transactions[txIndex]);

    return this.state.transactions[txIndex];
  }

  // ─────────────────────────────────────────
  // Supabase: Load catalog from DB
  // ─────────────────────────────────────────
  async loadFromSupabase() {
    try {
      const catalog = await loadCatalog();
      
      this.state.categories = catalog.categories;
      this.state.menuItems = catalog.menuItems;
      this.state.modifiers = catalog.modifiers;
      this.state.gridItems = catalog.gridItems;
      await this.loadStaffDirectory();
      await this.loadSupplierInvoices();
      await this.loadSupplierInvoiceLines();
      await this.loadSupplierSenderRules();
      
      console.log('[Store] Catálogo cargado desde Supabase:', {
        categorias: catalog.categories.length,
        articulos: catalog.menuItems.length,
        modificadores: catalog.modifiers.length,
        grids: Object.keys(catalog.gridItems).length
      });
      
      // Cargar el estado del TPV desde Supabase
      try {
        const tpvState = await loadTPVState();
        if (tpvState) {
          if (Array.isArray(tpvState.tables) && tpvState.tables.length > 0) {
            this.state.tables = tpvState.tables.map(table => ({
              ...table,
              items: this.sortTicketItemsForService(table.items || [])
            }));
            this.refreshTableSyncFingerprints();
          }
          // Restore direct sale ticket (but keep legal_data separate)
          if (tpvState.direct_sale) {
            // Merge legal from direct_sale.legal_data (embedded fallback)
            if (tpvState.direct_sale.legal_data && Object.keys(tpvState.direct_sale.legal_data).length > 0) {
              this.state.legal = { ...this.state.legal, ...tpvState.direct_sale.legal_data };
            }
            // Store directSaleTicket without legal_data inside it
            if (tpvState.direct_sale.role_permissions) {
              this.state.rolePermissions = this.mergeRolePermissions(tpvState.direct_sale.role_permissions);
            }
            if (tpvState.direct_sale.kds_state && typeof tpvState.direct_sale.kds_state === 'object') {
              this.state.kdsState = tpvState.direct_sale.kds_state;
            }
          }
          if (Array.isArray(tpvState.transactions)) {
            this.state.transactions = tpvState.transactions;
          }
          // Top-level legal_data column (if the column exists in Supabase)
          if (tpvState.legal_data && Object.keys(tpvState.legal_data).length > 0) {
            this.state.legal = { ...this.state.legal, ...tpvState.legal_data };
          }
          if (tpvState.role_permissions) {
            this.state.rolePermissions = this.mergeRolePermissions(tpvState.role_permissions);
          }
        }
      } catch (err) {
        console.warn('[Store] No se pudo cargar el estado del TPV desde la BD, usando local.', err);
      }

      try {
        const normalizedSales = await loadSales();
        this.salesPersistenceReady = Array.isArray(normalizedSales);
        if (Array.isArray(normalizedSales)) {
          this.state.transactions = normalizedSales;
        }
      } catch (err) {
        this.salesPersistenceReady = false;
        console.warn('[Store] No se pudieron cargar las ventas normalizadas.', err);
      }

      try {
        await this.loadCashClosures();
      } catch (err) {
        this.cashClosurePersistenceReady = false;
        console.warn('[Store] No se pudieron cargar los cierres de caja.', err);
      }

      try {
        await this.loadSquareGiftCardEvents();
      } catch (err) {
        console.warn('[Store] No se pudieron cargar los eventos de tarjetas regalo Square.', err);
      }

      // Suscribirse a cambios en tiempo real
      this.subscribeToRealtime();
      
      this.lastLocalPersistSnapshot = JSON.stringify(this.getPersistPayload());
      this.lastRemotePersistSnapshot = JSON.stringify(this.getRemotePersistPayload());
      this.emitChange();
      return true;
    } catch (err) {
      console.warn('[Store] No se pudo conectar a Supabase, usando datos locales como fallback.', err.message);
      return false;
    }
  }

  applyRemoteSharedState(newState) {
    if (!newState) return false;

    let changed = false;

    if (Array.isArray(newState.tables) && newState.tables.length > 0) {
      const remoteTables = new Map(newState.tables.map(table => [Number(table.id), table]));
      const mergedTables = this.state.tables.map(localTable => {
        const remoteTable = remoteTables.get(Number(localTable.id));
        if (!remoteTable) return localTable;

        const localTime = new Date(localTable.syncUpdatedAt || 0).getTime();
        const remoteTime = new Date(remoteTable.syncUpdatedAt || 0).getTime();
        const shouldAcceptRemote = remoteTime > localTime ||
          (!localTable.syncUpdatedAt && JSON.stringify(localTable) !== JSON.stringify(remoteTable));

        return shouldAcceptRemote
          ? {
              ...remoteTable,
              items: this.sortTicketItemsForService(remoteTable.items || [])
            }
          : localTable;
      });

      if (JSON.stringify(this.state.tables) !== JSON.stringify(mergedTables)) {
        this.state.tables = mergedTables;
        this.refreshTableSyncFingerprints();
        changed = true;
      }
    }

    if (newState.direct_sale) {
      const { role_permissions: rolePermissions } = newState.direct_sale;
      const nextKdsState = newState.direct_sale.kds_state && typeof newState.direct_sale.kds_state === 'object'
        ? newState.direct_sale.kds_state
        : {};
      if (newState.direct_sale.legal_data && JSON.stringify(this.state.legal) !== JSON.stringify(newState.direct_sale.legal_data)) {
        this.state.legal = newState.direct_sale.legal_data;
        changed = true;
      }
      if (JSON.stringify(this.state.kdsState || {}) !== JSON.stringify(nextKdsState)) {
        this.state.kdsState = nextKdsState;
        changed = true;
      }
      if (rolePermissions) {
        const mergedPermissions = this.mergeRolePermissions(rolePermissions);
        if (JSON.stringify(this.state.rolePermissions) !== JSON.stringify(mergedPermissions)) {
          this.state.rolePermissions = mergedPermissions;
          changed = true;
        }
      }
    }

    // Do not merge transactions from tpv_state. Sales are persisted in the normalized
    // sales tables; the legacy snapshot can be stale and can resurrect or hide tickets.

    if (newState.legal_data && JSON.stringify(this.state.legal) !== JSON.stringify(newState.legal_data)) {
      this.state.legal = newState.legal_data;
      changed = true;
    }

    if (newState.role_permissions && JSON.stringify(this.state.rolePermissions) !== JSON.stringify(newState.role_permissions)) {
      this.state.rolePermissions = this.mergeRolePermissions(newState.role_permissions);
      changed = true;
    }

    return changed;
  }

  persistRemoteSnapshotLocally() {
    const remoteSnapshot = JSON.stringify(this.getRemotePersistPayload());
    const localSnapshot = JSON.stringify(this.getPersistPayload());
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(DINING_STATE_STORAGE_KEY, localSnapshot);
      } catch (err) {
        console.warn('[Store] No se pudo guardar el estado remoto en LocalStorage.', err);
      }
    }
    this.lastLocalPersistSnapshot = localSnapshot;
    this.lastRemotePersistSnapshot = remoteSnapshot;
  }

  async refreshSharedStateFromSupabase({ silent = true } = {}) {
    if (this.pendingRemotePersist) return false;

    try {
      const tpvState = await loadTPVState();
      const changed = this.applyRemoteSharedState(tpvState);
      if (changed) {
        this.persistRemoteSnapshotLocally();
        this.emitChange({ source: 'remote-refresh', silent });
      }
      return changed;
    } catch (err) {
      console.warn('[Store] No se pudo refrescar el estado compartido.', err);
      return false;
    }
  }

  scheduleResumeSync(delay = 250) {
    if (typeof window === 'undefined') return;
    if (this.resumeSyncTimer) clearTimeout(this.resumeSyncTimer);
    this.resumeSyncTimer = setTimeout(() => {
      this.resumeSyncTimer = null;
      void this.refreshSharedStateFromSupabase();
    }, delay);
  }

  setupResumeSync() {
    if (typeof window === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.scheduleResumeSync(150);
      }
    });
    window.addEventListener('focus', () => this.scheduleResumeSync(200));
    window.addEventListener('online', () => {
      this.subscribeToRealtime();
      this.scheduleResumeSync(250);
    });
  }

  subscribeToRealtime() {
    if (this.realtimeChannel) {
      this.realtimeChannel.unsubscribe();
    }

    this.realtimeChannel = supabase
      .channel('tpv-state-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tpv_state',
          filter: 'id=eq.global'
        },
        (payload) => {
          if (this.applyRemoteSharedState(payload.new)) {
            this.persistRemoteSnapshotLocally();
            this.emitChange({ source: 'realtime' });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'square_gift_card_events'
        },
        (payload) => {
          const event = this.mapSquareGiftCardEventRow(payload.new || {});
          if (!event.id || this.state.squareGiftCardEvents.some(item => item.id === event.id)) return;
          this.state.squareGiftCardEvents = [event, ...this.state.squareGiftCardEvents].slice(0, 1000);
          this.emitChange({ source: 'square-gift-card-event' });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales'
        },
        () => {
          this.scheduleSalesRefresh();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.scheduleResumeSync(50);
          return;
        }

        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          if (this.realtimeReconnectTimer) clearTimeout(this.realtimeReconnectTimer);
          this.realtimeReconnectTimer = setTimeout(() => {
            this.realtimeReconnectTimer = null;
            this.subscribeToRealtime();
            this.scheduleResumeSync(200);
          }, 2000);
        }
      });
  }

  // Action Methods
  setTheme(theme) {
    this.state.theme = theme;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('tpv-theme', theme);
    }
    this.notify();
  }

  updateLegalSettings(legalData) {
    if (!this.canManageAccounting()) return false;
    this.state.legal = {
      ...this.state.legal,
      ...legalData,
      taxRate: parseFloat(legalData.taxRate || 0)
    };
    this.notify();
    return true;
  }

  setActiveTab(tab) {
    if (tab === 'ajustes' && !this.canAccessSettings()) {
      tab = 'mesas';
    }
    this.state.activeTab = tab;
    if (tab === 'mesas') {
      this.scheduleResumeSync(50);
    }
    if (tab === 'inicio') {
      this.state.gridPath = ['root'];
    }
    this.state.settingsPath = [];
    this.notify();
  }

  async saveSupplierInvoice(invoiceData) {
    if (!this.canManageAccounting()) return false;
    await upsertSupplierInvoice(invoiceData);
    await this.loadSupplierInvoices();
    await this.loadSupplierInvoiceLines();
    this.notify();
    return true;
  }

  async importGeminiInvoices(parsedInvoices) {
    if (!this.canManageAccounting()) return false;

    const invoicesToImport = parsedInvoices.filter(invoice => invoice.importable !== false);

    for (const invoice of invoicesToImport) {
      const invoiceId = invoice.id || `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await upsertSupplierInvoice({
        id: invoiceId,
        supplierName: invoice.supplierName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        category: invoice.category,
        baseAmount: invoice.baseAmount,
        taxRate: invoice.taxRate,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        deductible: invoice.deductible,
        status: invoice.status || 'pending_review',
        source: 'drive',
        sourceId: `gemini-${invoiceId}`,
        notes: invoice.notes || 'Importado desde resumen de Gemini.'
      });
      await replaceSupplierInvoiceLines(invoiceId, invoice.lines || []);
    }

    await this.loadSupplierInvoices();
    await this.loadSupplierInvoiceLines();
    this.notify();
    return true;
  }

  async toggleSupplierSenderIgnored(email) {
    if (!this.canManageAccounting()) return false;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return false;
    const existing = this.state.supplierSenderRules.find(rule => rule.email === normalizedEmail);
    await upsertSupplierSenderRule({
      email: normalizedEmail,
      label: existing?.label || '',
      ignored: !(existing?.ignored === true)
    });
    await this.loadSupplierSenderRules();
    this.notify();
    return true;
  }

  async deleteSupplierInvoice(id) {
    if (!this.canManageAccounting()) return false;
    await dbDeleteSupplierInvoice(id);
    await this.loadSupplierInvoices();
    await this.loadSupplierInvoiceLines();
    this.notify();
    return true;
  }

  getTransactionTaxDetails(tx) {
    const total = Number(tx.total || 0);
    const legal = tx.legalData || this.state.legal || {};
    const taxRate = Number(legal.taxRate ?? this.state.legal.taxRate ?? 0);
    const base = taxRate > 0 ? total / (1 + taxRate / 100) : total;
    const tax = total - base;
    return { base, tax, taxRate };
  }

  getAccountingSummary(month = this.state.selectedReportMonth) {
    const monthPrefix = month || new Date().toISOString().slice(0, 7);
    const sales = this.state.transactions.filter(tx => (tx.createdAt || '').slice(0, 7) === monthPrefix);
    const purchases = this.state.supplierInvoices.filter(invoice => (invoice.invoiceDate || '').slice(0, 7) === monthPrefix);

    const salesTotals = sales.reduce((acc, tx) => {
      const { base, tax } = this.getTransactionTaxDetails(tx);
      acc.total += Number(tx.total || 0);
      acc.base += base;
      acc.tax += tax;
      return acc;
    }, { total: 0, base: 0, tax: 0 });

    const purchaseTotals = purchases.reduce((acc, invoice) => {
      acc.total += Number(invoice.totalAmount || 0);
      acc.base += Number(invoice.baseAmount || 0);
      if (invoice.deductible !== false) {
        acc.deductibleTax += Number(invoice.taxAmount || 0);
      }
      acc.tax += Number(invoice.taxAmount || 0);
      return acc;
    }, { total: 0, base: 0, tax: 0, deductibleTax: 0 });

    return {
      month: monthPrefix,
      salesCount: sales.length,
      purchaseCount: purchases.length,
      sales: salesTotals,
      purchases: purchaseTotals,
      estimatedIgicDue: salesTotals.tax - purchaseTotals.deductibleTax
    };
  }

  getTransactionDateKey(tx) {
    return this.toLocalDateKey(this.getTransactionDate(tx));
  }

  toLocalDateKey(date) {
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  getTransactionDate(tx) {
    if (tx.createdAt) return new Date(tx.createdAt);
    if (tx.date) {
      const [datePart, timePart = '00:00'] = tx.date.split(', ');
      const [day, month, year] = datePart.split('/').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      return new Date(year, month - 1, day, hour || 0, minute || 0);
    }
    return new Date();
  }

  getLatestCashClosure(date = null) {
    return [...this.state.cashClosures]
      .filter(closure => (!date || closure.businessDate === date) && (closure.closedAt || closure.businessDate))
      .sort((a, b) => {
        const aTime = new Date(a.closedAt || `${a.businessDate}T23:59:59`).getTime();
        const bTime = new Date(b.closedAt || `${b.businessDate}T23:59:59`).getTime();
        return bTime - aTime;
      })[0] || null;
  }

  getPendingPreviousDayClosure(referenceDate = new Date()) {
    const reference = referenceDate instanceof Date
      ? new Date(referenceDate)
      : new Date(`${String(referenceDate).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(reference.getTime())) return null;

    reference.setHours(12, 0, 0, 0);
    const refYyyy = reference.getFullYear();
    const refMm = String(reference.getMonth() + 1).padStart(2, '0');
    const refDd = String(reference.getDate()).padStart(2, '0');
    const referenceKey = `${refYyyy}-${refMm}-${refDd}`;
    const salesDates = [...new Set(this.state.transactions
      .filter(tx => tx.type !== 'refund')
      .map(tx => this.getTransactionDateKey(tx))
      .filter(date => date < referenceKey))]
      .sort()
      .reverse();

    for (const businessDate of salesDates) {
      const daySales = this.state.transactions.filter(tx =>
        this.getTransactionDateKey(tx) === businessDate &&
        tx.type !== 'refund'
      );

      if (daySales.length === 0) continue;

      const latestSaleTime = Math.max(...daySales.map(tx => this.getTransactionDate(tx).getTime()));
      const latestClosure = this.getLatestCashClosure(businessDate);
      const latestClosureTime = latestClosure
        ? new Date(latestClosure.closedAt || `${businessDate}T23:59:59`).getTime()
        : 0;

      if (latestClosure && latestClosureTime >= latestSaleTime) continue;

      const totalSales = daySales.reduce((sum, tx) => sum + Number(tx.total || 0), 0);
      return {
        businessDate,
        transactionsCount: daySales.length,
        totalSales: Number(totalSales.toFixed(2)),
        latestSaleAt: new Date(latestSaleTime).toISOString()
      };
    }

    return null;
  }

  getNextCashClosureShiftNumber(date) {
    const shifts = this.state.cashClosures
      .filter(closure => closure.businessDate === date)
      .map(closure => Number(closure.shiftNumber || 1));
    return shifts.length ? Math.max(...shifts) + 1 : 1;
  }

  getActiveShiftSummary() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const businessDate = `${yyyy}-${mm}-${dd}`;
    const lastClosure = this.getLatestCashClosure(businessDate);
    const lastClosureTime = lastClosure ? new Date(lastClosure.closedAt || `${businessDate}T23:59:59`).getTime() : 0;
    const transactions = this.state.transactions.filter(tx =>
      this.getTransactionDateKey(tx) === businessDate &&
      this.getTransactionDate(tx).getTime() > lastClosureTime
    );

    return transactions.reduce((acc, tx) => {
      const total = Number(tx.total || 0);
      if (tx.type === 'refund') {
        acc.refunds += Math.abs(total);
      } else {
        acc.sales += total;
        acc.tickets += 1;
      }
      acc.net += total;
      return acc;
    }, {
      lastClosure,
      businessDate,
      transactions,
      tickets: 0,
      sales: 0,
      refunds: 0,
      net: 0
    });
  }

  getPaymentBreakdownForTransaction(tx) {
    if (Array.isArray(tx.payments) && tx.payments.length > 0) {
      return tx.payments.map(payment => ({
        method: payment.method || tx.paymentMethod || '',
        amount: Number(payment.amount || 0),
        saleAmount: Number(payment.saleAmount ?? payment.amount ?? 0),
        tipAmount: Number(payment.tipAmount || 0),
        provider: payment.provider || ''
      }));
    }
    return [{
      method: tx.paymentMethod || '',
      amount: Number(tx.totalCharged ?? (Number(tx.total || 0) + Math.max(0, Number(tx.tipAmount || 0)))),
      saleAmount: Number(tx.total || 0),
      tipAmount: Math.max(0, Number(tx.tipAmount || 0)),
      provider: String(tx.paymentMethod || '').toLowerCase().includes('tarjeta') ? 'BBVA' : ''
    }];
  }

  isTransactionPaymentCorrectionLocked(transaction) {
    if (!transaction) return true;
    const businessDate = this.getTransactionDateKey(transaction);
    const transactionTime = this.getTransactionDate(transaction).getTime();
    return this.state.cashClosures.some(closure => {
      if (closure.businessDate !== businessDate) return false;
      const closureTime = new Date(closure.closedAt || `${businessDate}T23:59:59`).getTime();
      return closureTime >= transactionTime;
    });
  }

  canCorrectTransactionPayment(transaction) {
    if (!transaction || transaction.type === 'refund' || transaction.hasRefund) return false;
    const payments = this.getPaymentBreakdownForTransaction(transaction);
    const hasExternalGiftCardPayment = payments.some(payment => {
      const method = String(payment.method || '').toLowerCase();
      const provider = String(payment.provider || '').toLowerCase();
      return method.includes('regalo') || method.includes('gift') || provider.includes('square');
    });
    return this.salesPersistenceReady &&
      payments.length > 0 &&
      !hasExternalGiftCardPayment &&
      !this.isTransactionPaymentCorrectionLocked(transaction);
  }

  async correctTransactionPayments(transactionId, correctedPayments = []) {
    const transactionIndex = this.state.transactions.findIndex(tx => tx.id === transactionId);
    if (transactionIndex === -1) return null;

    const currentTransaction = this.state.transactions[transactionIndex];
    if (!this.canCorrectTransactionPayment(currentTransaction) || correctedPayments.length === 0) return null;

    const payments = correctedPayments.map((payment, index) => {
      const method = String(payment.method || '').toLowerCase().includes('efectivo')
        ? 'Efectivo'
        : 'Tarjeta';
      const saleAmount = Number(payment.saleAmount ?? payment.amount ?? 0);
      const tipAmount = method === 'Tarjeta' ? Math.max(0, Number(payment.tipAmount || 0)) : 0;
      return {
        ...payment,
        id: payment.id || `${transactionId}-payment-${String(index + 1).padStart(3, '0')}`,
        method,
        saleAmount: Number(saleAmount.toFixed(2)),
        tipAmount: Number(tipAmount.toFixed(2)),
        amount: Number((saleAmount + tipAmount).toFixed(2)),
        provider: method === 'Tarjeta' ? 'BBVA' : '',
        externalRef: method === 'Tarjeta' ? (payment.externalRef || '') : ''
      };
    });

    const methods = [...new Set(payments.map(payment => payment.method))];
    const tipAmount = payments.reduce((sum, payment) => sum + Number(payment.tipAmount || 0), 0);
    const totalCharged = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const updatedTransaction = {
      ...currentTransaction,
      paymentMethod: methods.length === 1 ? methods[0] : `Mixto (${payments.length} pagos)`,
      payments,
      tipAmount: Number(tipAmount.toFixed(2)),
      totalCharged: Number(totalCharged.toFixed(2))
    };

    this.state.transactions[transactionIndex] = updatedTransaction;
    const persistedId = await this.persistSaleRecord(updatedTransaction);
    if (!persistedId) {
      this.state.transactions[transactionIndex] = currentTransaction;
      return null;
    }
    if (updatedTransaction.receiptToken) this.publishReceiptTicket(updatedTransaction);
    this.notify({ flushRemote: true });
    return updatedTransaction;
  }

  getSquareGiftCardOnlineSalesSummary(date = new Date().toISOString().slice(0, 10), options = {}) {
    const sinceTime = Number(options.sinceTime || 0);
    const events = (this.state.squareGiftCardEvents || []).filter(event => {
      const eventTime = event.createdAt ? new Date(event.createdAt).getTime() : 0;
      return event.eventType === 'activate' &&
        this.toLocalDateKey(new Date(event.createdAt || Date.now())) === date &&
        eventTime > sinceTime;
    });

    const total = events.reduce((sum, event) => sum + Number(event.amount || 0), 0);
    return {
      count: events.length,
      total: Number(total.toFixed(2))
    };
  }

  getCashClosureSummary(date = new Date().toISOString().slice(0, 10), options = {}) {
    const sinceTime = Number(options.sinceTime || 0);
    const dayTx = this.state.transactions.filter(tx =>
      this.getTransactionDateKey(tx) === date &&
      this.getTransactionDate(tx).getTime() > sinceTime
    );
    const summary = dayTx.reduce((acc, tx) => {
      const total = Number(tx.total || 0);
      const tipAmount = tx.type === 'refund' ? 0 : Math.max(0, Number(tx.tipAmount || 0));
      if (tx.type === 'refund') {
        acc.totalRefunds += Math.abs(total);
      } else {
        acc.totalSales += total;
        acc.totalTips += tipAmount;
      }
      acc.netTotal += total;
      acc.transactionsCount += tx.type === 'refund' ? 0 : 1;

      this.getPaymentBreakdownForTransaction(tx).forEach(payment => {
        const method = (payment.method || '').toLowerCase();
        const amount = Number(payment.amount || 0);
        if (method.includes('regalo') || method.includes('gift')) {
          acc.otherPayments += amount;
        } else if (method.includes('efectivo')) {
          acc.cashPayments += amount;
          acc.expectedCash += amount;
        } else if (method.includes('tarjeta')) {
          acc.expectedCard += amount;
        } else {
          acc.otherPayments += amount;
        }
      });
      acc.expectedCash -= tipAmount;
      return acc;
    }, {
      businessDate: date,
      transactionsCount: 0,
      totalSales: 0,
      totalRefunds: 0,
      netTotal: 0,
      totalTips: 0,
      cashPayments: 0,
      expectedCash: 0,
      expectedCard: 0,
      otherPayments: 0
    });

    const squareGiftCardOnlineSales = this.getSquareGiftCardOnlineSalesSummary(date, { sinceTime });
    summary.squareGiftCardOnlineSales = squareGiftCardOnlineSales.total;
    summary.squareGiftCardOnlineSalesCount = squareGiftCardOnlineSales.count;

    Object.keys(summary).forEach(key => {
      if (typeof summary[key] === 'number') summary[key] = Number(summary[key].toFixed(2));
    });
    return summary;
  }

  async saveCashClosure(data) {
    if (!this.canCloseCash() || !this.cashClosurePersistenceReady) return false;
    const lastClosure = this.getLatestCashClosure(data.businessDate);
    const shiftStartAt = lastClosure?.closedAt || null;
    const sinceTime = shiftStartAt ? new Date(shiftStartAt).getTime() : 0;
    const shiftNumber = this.getNextCashClosureShiftNumber(data.businessDate);
    const summary = this.getCashClosureSummary(data.businessDate, { sinceTime });
    const countedCash = Number(data.countedCash || 0);
    const openingCash = Number(data.openingCash || 0);
    const bbvaTotal = Number(data.bbvaTotal || 0);
    const closure = {
      id: `closure-${data.businessDate}-shift-${shiftNumber}`,
      ...summary,
      shiftNumber,
      shiftStartAt,
      openingCash,
      countedCash,
      cashDifference: Number((countedCash - openingCash - summary.expectedCash).toFixed(2)),
      bbvaTotal,
      cardDifference: Number((bbvaTotal - summary.expectedCard).toFixed(2)),
      notes: data.notes || '',
      staff: this.state.auth.profile ? {
        id: this.state.auth.profile.id,
        name: this.state.auth.profile.display_name,
        role: this.state.auth.profile.role
      } : null,
      closedAt: new Date().toISOString()
    };

    await upsertCashClosure(closure);
    await this.loadCashClosures();
    this.notify();
    return true;
  }

  setActivePosTab(tab) {
    this.state.activePosTab = tab;
    this.notify();
  }

  setGridPath(path) {
    this.state.gridPath = path;
    this.notify();
  }

  goBackGrid() {
    if (this.state.gridPath.length > 1) {
      this.state.gridPath.pop();
      this.notify();
    }
  }

  selectTable(tableId) {
    this.state.selectedTableId = tableId;
    this.state.activeTab = 'inicio';
    this.state.activePosTab = 'atajos';
    this.state.gridPath = ['root'];
    this.state.settingsPath = [];
    this.notify();
  }

  navigateSettings(path) {
    this.state.settingsPath = path;
    this.notify();
  }

  goBackSettings() {
    if (this.state.settingsPath.length > 0) {
      this.state.settingsPath.pop();
      this.notify();
    }
  }

  addMenuItem({ name, price, category, modifiers = [], image = null }) {
    if (!this.canManageCatalog()) return null;

    // Generate unique ID from name
    let id = name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id || this.state.menuItems.some(m => m.id === id)) {
      id = `${id || 'item'}-${Date.now()}`;
    }

    const newItem = { id, name, price: parseFloat(price), category, image, modifiers };
    this.state.menuItems.push(newItem);

    // Sync modifiers bidirectional associations
    modifiers.forEach(modId => {
      const modIdx = this.state.modifiers.findIndex(m => m.id === modId);
      if (modIdx > -1 && !(this.state.modifiers[modIdx].assignedItems || []).includes(id)) {
        this.state.modifiers[modIdx].assignedItems = [...(this.state.modifiers[modIdx].assignedItems || []), id];
        upsertModifier(this.state.modifiers[modIdx]);
      }
    });

    // Place in category grid (first empty slot)
    if (category && this.state.gridItems[category]) {
      const grid = this.state.gridItems[category];
      const emptyIdx = grid.indexOf(null);
      if (emptyIdx > -1) {
        grid[emptyIdx] = { type: 'article', itemId: id, name, price: parseFloat(price), ...(image ? { image } : {}) };
        upsertGridItems(category, grid);
      }
    }

    // Persist to Supabase
    upsertMenuItem(newItem);
    this.notify();
    return newItem;
  }

  updateMenuItem(itemId, updatedData) {
    if (!this.canManageCatalog()) return false;

    const itemIndex = this.state.menuItems.findIndex(item => item.id === itemId);
    if (itemIndex > -1) {
      const oldItem = this.state.menuItems[itemIndex];
      this.state.menuItems[itemIndex] = { ...oldItem, ...updatedData };
      
      // Sync modifiers bidirectional associations
      if (updatedData.modifiers !== undefined) {
        this.state.modifiers.forEach((mod, idx) => {
          const shouldBeAssigned = updatedData.modifiers.includes(mod.id);
          const isCurrentlyAssigned = (mod.assignedItems || []).includes(itemId);
          if (shouldBeAssigned && !isCurrentlyAssigned) {
            this.state.modifiers[idx].assignedItems = [...(mod.assignedItems || []), itemId];
          } else if (!shouldBeAssigned && isCurrentlyAssigned) {
            this.state.modifiers[idx].assignedItems = (mod.assignedItems || []).filter(id => id !== itemId);
          }
        });
      }
      
      // If category changed, move grid shortcut card
      if (updatedData.category && updatedData.category !== oldItem.category) {
        const oldGridKey = oldItem.category;
        if (oldGridKey && this.state.gridItems[oldGridKey]) {
          const oldGrid = this.state.gridItems[oldGridKey];
          const oldIdx = oldGrid.findIndex(g => g && g.type === 'article' && g.itemId === itemId);
          if (oldIdx > -1) oldGrid[oldIdx] = null;
        }
        
        const newGridKey = updatedData.category;
        if (newGridKey) {
          if (!this.state.gridItems[newGridKey]) {
            this.state.gridItems[newGridKey] = Array(8).fill(null);
          }
          const newGrid = this.state.gridItems[newGridKey];
          const emptySlotIdx = newGrid.indexOf(null);
          if (emptySlotIdx > -1) {
            newGrid[emptySlotIdx] = {
              type: 'article',
              itemId: itemId,
              name: updatedData.name || oldItem.name,
              price: updatedData.price !== undefined ? parseFloat(updatedData.price) : oldItem.price,
              image: updatedData.image !== undefined ? updatedData.image : oldItem.image
            };
          }
        }
        
        if (oldItem.category && this.state.gridItems[oldItem.category]) {
          upsertGridItems(oldItem.category, this.state.gridItems[oldItem.category]);
        }
        if (updatedData.category && this.state.gridItems[updatedData.category]) {
          upsertGridItems(updatedData.category, this.state.gridItems[updatedData.category]);
        }
      } else {
        const affectedGridKeys = [];
        Object.keys(this.state.gridItems).forEach(key => {
          this.state.gridItems[key].forEach((gridItem, idx) => {
            if (gridItem && gridItem.type === 'article' && gridItem.itemId === itemId) {
              this.state.gridItems[key][idx] = {
                ...gridItem,
                name: updatedData.name || gridItem.name,
                price: updatedData.price !== undefined ? parseFloat(updatedData.price) : gridItem.price,
                image: updatedData.image !== undefined ? updatedData.image : gridItem.image
              };
              if (!affectedGridKeys.includes(key)) affectedGridKeys.push(key);
            }
          });
        });
        affectedGridKeys.forEach(key => upsertGridItems(key, this.state.gridItems[key]));
      }
      
      upsertMenuItem(this.state.menuItems[itemIndex]);
      if (updatedData.modifiers !== undefined) {
        this.state.modifiers.forEach(mod => upsertModifier(mod));
      }
      this.notify();
      return true;
    }
    return false;
  }

  toggleEditingGrid() {
    if (!this.canManageCatalog()) return;
    this.state.isEditingGrid = !this.state.isEditingGrid;
    this.notify();
  }

  deleteMenuItem(itemId) {
    if (!this.canManageCatalog()) return false;

    // Remove from menuItems
    this.state.menuItems = this.state.menuItems.filter(i => i.id !== itemId);

    // Remove from all grid slots
    Object.keys(this.state.gridItems).forEach(key => {
      this.state.gridItems[key] = this.state.gridItems[key].map(slot =>
        slot && slot.type === 'article' && slot.itemId === itemId ? null : slot
      );
      upsertGridItems(key, this.state.gridItems[key]);
    });

    // Remove from all modifier assignedItems
    this.state.modifiers.forEach((mod, idx) => {
      if ((mod.assignedItems || []).includes(itemId)) {
        this.state.modifiers[idx].assignedItems = mod.assignedItems.filter(id => id !== itemId);
        upsertModifier(this.state.modifiers[idx]);
      }
    });

    // Delete from DB
    import('./db.js').then(db => {
      if (db.deleteMenuItem) db.deleteMenuItem(itemId);
    });

    this.notify();
    return true;
  }


  addGridShortcut(gridKey, slotIndex, shortcutData) {
    if (!this.canManageCatalog()) return;

    if (this.state.gridItems[gridKey]) {
      this.state.gridItems[gridKey][slotIndex] = shortcutData;
      upsertGridItems(gridKey, this.state.gridItems[gridKey]);

      if ((shortcutData.type === 'category' || shortcutData.type === 'subcategory') && shortcutData.target) {
        this.rebuildCategoryGridTree(shortcutData.target);
      }

      this.notify();
    }
  }

  createCategoryGridShortcut(category) {
    return {
      type: category.type,
      target: category.id,
      name: category.name,
      color: category.type === 'category' ? 'blue' : 'green'
    };
  }

  createArticleGridShortcut(item) {
    return {
      type: 'article',
      itemId: item.id,
      name: item.name,
      price: item.price,
      ...(item.image ? { image: item.image } : {})
    };
  }

  buildDefaultCategoryGrid(categoryId) {
    const category = this.state.categories.find(c => c.id === categoryId);
    if (!category) return [];

    const childShortcuts = [
      ...this.state.menuItems
        .filter(item => item.category === categoryId)
        .map(item => this.createArticleGridShortcut(item)),
      ...this.state.categories
        .filter(c => c.type === 'subcategory' && c.parentId === categoryId)
        .map(c => this.createCategoryGridShortcut(c))
    ];

    return childShortcuts;
  }

  rebuildCategoryGridTree(categoryId, visited = new Set()) {
    if (visited.has(categoryId)) return;
    visited.add(categoryId);

    const category = this.state.categories.find(c => c.id === categoryId);
    if (!category) return;

    const grid = this.buildDefaultCategoryGrid(categoryId);
    this.state.gridItems[categoryId] = grid;
    upsertGridItems(categoryId, grid);

    this.state.categories
      .filter(c => c.type === 'subcategory' && c.parentId === categoryId)
      .forEach(child => this.rebuildCategoryGridTree(child.id, visited));
  }

  removeGridShortcut(gridKey, slotIndex) {
    if (!this.canManageCatalog()) return;

    if (this.state.gridItems[gridKey]) {
      this.state.gridItems[gridKey][slotIndex] = null;
      upsertGridItems(gridKey, this.state.gridItems[gridKey]);
      this.notify();
    }
  }

  addCategory({ name, type, parentId = null }) {
    if (!this.canManageCatalog()) return null;

    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id || this.state.categories.some(c => c.id === id)) {
      id = `${id}-${Date.now()}`;
    }
    
    const newCategory = { id, name, type };
    if (type === 'subcategory') {
      newCategory.parentId = parentId;
    }
    this.state.categories.push(newCategory);
    
    const targetGridKey = type === 'category' ? 'root' : parentId;
    if (targetGridKey && this.state.gridItems[targetGridKey]) {
      const grid = this.state.gridItems[targetGridKey];
      const emptySlotIdx = grid.indexOf(null);
      if (emptySlotIdx > -1) {
        grid[emptySlotIdx] = {
          type: type,
          target: id,
          name: name,
          color: type === 'category' ? 'blue' : 'green'
        };
      }
    }
    
    this.state.gridItems[id] = Array(8).fill(null);
    
    upsertCategory(newCategory);
    if (targetGridKey && this.state.gridItems[targetGridKey]) {
      upsertGridItems(targetGridKey, this.state.gridItems[targetGridKey]);
    }
    upsertGridItems(id, this.state.gridItems[id]);
    
    this.notify();
    return newCategory;
  }

  updateCategory(id, { name, type, parentId = null }) {
    if (!this.canManageCatalog()) return false;

    const catIndex = this.state.categories.findIndex(c => c.id === id);
    if (catIndex > -1) {
      const oldCategory = this.state.categories[catIndex];
      this.state.categories[catIndex] = {
        ...oldCategory,
        name,
        type,
        parentId: type === 'subcategory' ? parentId : undefined
      };
      
      const targetGridKey = type === 'category' ? 'root' : parentId;
      const oldGridKey = oldCategory.type === 'category' ? 'root' : oldCategory.parentId;
      
      if (oldGridKey !== targetGridKey) {
        if (oldGridKey && this.state.gridItems[oldGridKey]) {
          const oldGrid = this.state.gridItems[oldGridKey];
          const oldIdx = oldGrid.findIndex(g => g && g.target === id);
          if (oldIdx > -1) oldGrid[oldIdx] = null;
        }
        if (targetGridKey && this.state.gridItems[targetGridKey]) {
          const newGrid = this.state.gridItems[targetGridKey];
          const emptyIdx = newGrid.indexOf(null);
          if (emptyIdx > -1) {
            newGrid[emptyIdx] = { type, target: id, name, color: type === 'category' ? 'blue' : 'green' };
          }
        }
      } else {
        if (targetGridKey && this.state.gridItems[targetGridKey]) {
          const grid = this.state.gridItems[targetGridKey];
          grid.forEach((gridItem, idx) => {
            if (gridItem && gridItem.target === id) {
              grid[idx] = { ...gridItem, name, type, color: type === 'category' ? 'blue' : 'green' };
            }
          });
        }
      }
      
      upsertCategory(this.state.categories[catIndex]);
      if (oldGridKey && this.state.gridItems[oldGridKey]) upsertGridItems(oldGridKey, this.state.gridItems[oldGridKey]);
      if (targetGridKey && targetGridKey !== oldGridKey && this.state.gridItems[targetGridKey]) {
        upsertGridItems(targetGridKey, this.state.gridItems[targetGridKey]);
      }
      
      this.notify();
      return true;
    }
    return false;
  }

  deleteCategory(id) {
    if (!this.canManageCatalog()) return false;

    const catToDelete = this.state.categories.find(c => c.id === id);
    if (!catToDelete) return;
    
    const isMainCategory = catToDelete.type === 'category';
    
    if (isMainCategory) {
      const childSubcategories = this.state.categories.filter(c => c.type === 'subcategory' && c.parentId === id);
      childSubcategories.forEach(child => {
        this.deleteCategory(child.id);
      });
    }
    
    this.state.categories = this.state.categories.filter(c => c.id !== id);
    
    const parentGridKey = isMainCategory ? 'root' : catToDelete.parentId;
    if (parentGridKey && this.state.gridItems[parentGridKey]) {
      const grid = this.state.gridItems[parentGridKey];
      grid.forEach((gridItem, idx) => {
        if (gridItem && gridItem.target === id) grid[idx] = null;
      });
    }
    
    delete this.state.gridItems[id];
    
    const remainingCats = this.state.categories.filter(c => c.id !== id);
    const fallbackCategory = remainingCats.length > 0 ? remainingCats[0].id : 'drinks';
    this.state.menuItems.forEach((item, idx) => {
      if (item.category === id) this.state.menuItems[idx].category = fallbackCategory;
    });
    
    dbDeleteCategory(id);
    deleteGridItems(id);
    if (parentGridKey && this.state.gridItems[parentGridKey]) {
      upsertGridItems(parentGridKey, this.state.gridItems[parentGridKey]);
    }
    
    this.notify();
    return true;
  }

  getActiveItems() {
    if (this.state.selectedTableId !== null) {
      const table = this.state.tables.find(t => t.id === this.state.selectedTableId);
      return table ? this.sortTicketItemsForService(table.items) : [];
    } else {
      return this.sortTicketItemsForService(this.state.directSaleTicket.items);
    }
  }

  normalizeServiceText(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  getCategoryTrailText(categoryId) {
    const names = [];
    let currentId = categoryId;
    const visited = new Set();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const category = this.state.categories.find(c => c.id === currentId);
      if (!category) break;
      names.push(category.name || '');
      currentId = category.parentId || null;
    }

    return names.join(' ');
  }

  getTicketItemServiceGroup(ticketItem = {}) {
    const menuItem = this.state.menuItems.find(item => item.id === ticketItem.id) || null;
    const text = this.normalizeServiceText([
      ticketItem.name,
      menuItem?.name,
      menuItem?.category,
      this.getCategoryTrailText(menuItem?.category)
    ].filter(Boolean).join(' '));

    const drinkPattern = /\b(bebida|bebidas|cafe|cafes|te|tes|matcha|latte|leche|cappuccino|capuccino|espresso|americano|cortado|zumo|smoothie|batido|refresco|agua|cerveza|vino|infusion|chai|cola|fanta|sprite|tonica)\b/;
    const foodPattern = /\b(comida|comidas|alimento|alimentos|pancake|pancakes|minipancake|minipancakes|tostada|tostadas|bocadillo|sandwich|bagel|croissant|galleta|dulce|salado|ensalada|postre|tarta|brownie|arepa|pan|bolleria)\b/;

    if (drinkPattern.test(text)) return 0;
    if (foodPattern.test(text)) return 1;
    return 2;
  }

  sortTicketItemsForService(items = []) {
    return [...items]
      .map((item, index) => ({
        item,
        index,
        group: this.getTicketItemServiceGroup(item)
      }))
      .sort((a, b) => (a.group - b.group) || (a.index - b.index))
      .map(entry => entry.item);
  }

  getActiveLoyaltyAward() {
    if (this.state.selectedTableId !== null) {
      const table = this.state.tables.find(t => t.id === this.state.selectedTableId);
      return table?.loyaltyAwarded || null;
    }
    return this.state.directSaleTicket.loyaltyAwarded || null;
  }

  markActiveTicketLoyaltyAwarded(award) {
    const loyaltyAwarded = {
      ...award,
      awardedAt: award.awardedAt || new Date().toISOString()
    };

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return false;
      this.state.tables[tableIndex] = {
        ...this.state.tables[tableIndex],
        loyaltyAwarded
      };
    } else {
      this.state.directSaleTicket = {
        ...this.state.directSaleTicket,
        loyaltyAwarded
      };
    }

    this.notify();
    return true;
  }

  addItemToActiveTicket(itemId, selectedOptions = [], quantity = 1, note = '') {
    const menuItem = this.state.menuItems.find(item => item.id === itemId);
    if (!menuItem) return;

    const itemQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
    const sortedOptions = [...selectedOptions].sort((a, b) => a.id.localeCompare(b.id));
    const itemNote = String(note || '').trim();
    const ticketItemId = `${itemId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return;
      const table = this.state.tables[tableIndex];
      const newItems = [...table.items];
      
      const existingIdx = newItems.findIndex(i => 
        i.id === itemId && 
        (i.deferUntilLater === true) === false &&
        Number(i.discountPercent || 0) === 0 &&
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions) &&
        String(i.note || '').trim() === itemNote
      );
      
      if (existingIdx > -1) {
        newItems[existingIdx] = { ...newItems[existingIdx], qty: newItems[existingIdx].qty + itemQuantity };
      } else {
        newItems.push({ ticketItemId, id: menuItem.id, name: menuItem.name, price: menuItem.price, qty: itemQuantity, selectedOptions: sortedOptions, deferUntilLater: false, note: itemNote });
      }

      this.state.tables[tableIndex] = {
        ...table,
        items: this.sortTicketItemsForService(newItems),
        status: table.status === 'available' ? 'occupied' : table.status
      };
    } else {
      const newItems = [...this.state.directSaleTicket.items];
      const existingIdx = newItems.findIndex(i => 
        i.id === itemId && 
        (i.deferUntilLater === true) === false &&
        Number(i.discountPercent || 0) === 0 &&
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions) &&
        String(i.note || '').trim() === itemNote
      );

      if (existingIdx > -1) {
        newItems[existingIdx] = { ...newItems[existingIdx], qty: newItems[existingIdx].qty + itemQuantity };
      } else {
        newItems.push({ ticketItemId, id: menuItem.id, name: menuItem.name, price: menuItem.price, qty: itemQuantity, selectedOptions: sortedOptions, deferUntilLater: false, note: itemNote });
      }
      this.state.directSaleTicket.items = this.sortTicketItemsForService(newItems);
    }

    this.notify({ renderScope: 'ticket' });
  }

  updateTicketItemNote(ticketItemId, note = '') {
    if (!ticketItemId) return false;
    const cleanNote = String(note || '').trim();

    const updateInItems = (items = []) => {
      const idx = items.findIndex(i => i.ticketItemId === ticketItemId);
      if (idx === -1) return { items, changed: false };

      const nextItems = [...items];
      nextItems[idx] = { ...nextItems[idx], note: cleanNote };
      const target = nextItems[idx];
      const identicalIdx = nextItems.findIndex((item, i) =>
        i !== idx &&
        item.id === target.id &&
        (item.deferUntilLater === true) === (target.deferUntilLater === true) &&
        Number(item.discountPercent || 0) === Number(target.discountPercent || 0) &&
        String(item.discountReason || '') === String(target.discountReason || '') &&
        JSON.stringify(item.selectedOptions || []) === JSON.stringify(target.selectedOptions || []) &&
        String(item.note || '').trim() === cleanNote
      );

      if (identicalIdx > -1) {
        nextItems[identicalIdx] = {
          ...nextItems[identicalIdx],
          qty: nextItems[identicalIdx].qty + target.qty
        };
        nextItems.splice(idx, 1);
      }

      return { items: nextItems, changed: true };
    };

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return false;
      const result = updateInItems(this.state.tables[tableIndex].items);
      if (!result.changed) return false;
      this.state.tables[tableIndex] = {
        ...this.state.tables[tableIndex],
        items: this.sortTicketItemsForService(result.items)
      };
    } else {
      const result = updateInItems(this.state.directSaleTicket.items);
      if (!result.changed) return false;
      this.state.directSaleTicket = {
        ...this.state.directSaleTicket,
        items: this.sortTicketItemsForService(result.items)
      };
    }

    this.notify({ renderScope: 'ticket' });
    return true;
  }

  toggleTicketItemDeferred(ticketItemId) {
    if (!ticketItemId) return false;

    const toggleInItems = (items = []) => {
      const idx = items.findIndex(i => i.ticketItemId === ticketItemId);
      if (idx === -1) return { items, changed: false };
      const nextItems = [...items];
      nextItems[idx] = {
        ...nextItems[idx],
        deferUntilLater: nextItems[idx].deferUntilLater !== true
      };
      return { items: nextItems, changed: true };
    };

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return false;
      const result = toggleInItems(this.state.tables[tableIndex].items);
      if (!result.changed) return false;
      this.state.tables[tableIndex] = {
        ...this.state.tables[tableIndex],
        items: this.sortTicketItemsForService(result.items)
      };
    } else {
      const result = toggleInItems(this.state.directSaleTicket.items);
      if (!result.changed) return false;
      this.state.directSaleTicket = {
        ...this.state.directSaleTicket,
        items: this.sortTicketItemsForService(result.items)
      };
    }

    this.notify({ renderScope: 'ticket' });
    return true;
  }

  updateItemBasePrice(ticketItemId, newPrice) {
    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return;
      const table = this.state.tables[tableIndex];
      const newItems = [...table.items];
      const idx = newItems.findIndex(i => i.ticketItemId === ticketItemId);
      if (idx > -1) {
        newItems[idx] = { ...newItems[idx], price: parseFloat(newPrice) };
        this.state.tables[tableIndex] = { ...table, items: newItems };
      }
    } else {
      const newItems = [...this.state.directSaleTicket.items];
      const idx = newItems.findIndex(i => i.ticketItemId === ticketItemId);
      if (idx > -1) {
        newItems[idx] = { ...newItems[idx], price: parseFloat(newPrice) };
        this.state.directSaleTicket.items = newItems;
      }
    }
    this.notify({ renderScope: 'ticket' });
  }

  updateItemQty(ticketItemId, change) {
    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return;
      const table = this.state.tables[tableIndex];
      const newItems = [...table.items];
      const existingIdx = newItems.findIndex(i => i.ticketItemId === ticketItemId);
      if (existingIdx === -1) return;

      const newQty = newItems[existingIdx].qty + change;
      if (newQty <= 0) {
        newItems.splice(existingIdx, 1);
      } else {
        newItems[existingIdx] = { ...newItems[existingIdx], qty: newQty };
      }

      let newStatus = table.status;
      if (newItems.length === 0) newStatus = 'available';

      this.state.tables[tableIndex] = {
        ...table,
        items: this.sortTicketItemsForService(newItems),
        status: newStatus,
        ...(newItems.length > 0 && table.loyaltyAwarded ? { loyaltyAwarded: table.loyaltyAwarded } : { loyaltyAwarded: undefined })
      };
    } else {
      const newItems = [...this.state.directSaleTicket.items];
      const existingIdx = newItems.findIndex(i => i.ticketItemId === ticketItemId);
      if (existingIdx === -1) return;

      const newQty = newItems[existingIdx].qty + change;
      if (newQty <= 0) {
        newItems.splice(existingIdx, 1);
      } else {
        newItems[existingIdx] = { ...newItems[existingIdx], qty: newQty };
      }
      this.state.directSaleTicket = {
        ...this.state.directSaleTicket,
        items: this.sortTicketItemsForService(newItems),
        ...(newItems.length > 0 && this.state.directSaleTicket.loyaltyAwarded
          ? { loyaltyAwarded: this.state.directSaleTicket.loyaltyAwarded }
          : { loyaltyAwarded: undefined })
      };
    }
    this.notify({ renderScope: 'ticket' });
  }

  updateTicketItemModifiers(ticketItemId, selectedOptions) {
    const sortedOptions = [...selectedOptions].sort((a, b) => a.id.localeCompare(b.id));

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return;
      const table = this.state.tables[tableIndex];
      const newItems = [...table.items];
      const idx = newItems.findIndex(i => i.ticketItemId === ticketItemId);
      if (idx > -1) {
        newItems[idx] = { ...newItems[idx], selectedOptions: sortedOptions };
        
        const targetId = newItems[idx].id;
        const currentQty = newItems[idx].qty;
        const identicalIdx = newItems.findIndex((item, i) => 
          i !== idx && item.id === targetId &&
          Number(item.discountPercent || 0) === Number(newItems[idx].discountPercent || 0) &&
          String(item.discountReason || '') === String(newItems[idx].discountReason || '') &&
          JSON.stringify(item.selectedOptions || []) === JSON.stringify(sortedOptions) &&
          String(item.note || '').trim() === String(newItems[idx].note || '').trim()
        );
        
        if (identicalIdx > -1) {
          newItems[identicalIdx] = { ...newItems[identicalIdx], qty: newItems[identicalIdx].qty + currentQty };
          newItems.splice(idx, 1);
        }
        
        this.state.tables[tableIndex] = { ...table, items: this.sortTicketItemsForService(newItems) };
      }
    } else {
      const newItems = [...this.state.directSaleTicket.items];
      const idx = newItems.findIndex(i => i.ticketItemId === ticketItemId);
      if (idx > -1) {
        newItems[idx] = { ...newItems[idx], selectedOptions: sortedOptions };
        
        const targetId = newItems[idx].id;
        const currentQty = newItems[idx].qty;
        const identicalIdx = newItems.findIndex((item, i) => 
          i !== idx && item.id === targetId &&
          Number(item.discountPercent || 0) === Number(newItems[idx].discountPercent || 0) &&
          String(item.discountReason || '') === String(newItems[idx].discountReason || '') &&
          JSON.stringify(item.selectedOptions || []) === JSON.stringify(sortedOptions) &&
          String(item.note || '').trim() === String(newItems[idx].note || '').trim()
        );
        
        if (identicalIdx > -1) {
          newItems[identicalIdx] = { ...newItems[identicalIdx], qty: newItems[identicalIdx].qty + currentQty };
          newItems.splice(idx, 1);
        }
        
        this.state.directSaleTicket.items = this.sortTicketItemsForService(newItems);
      }
    }
    this.notify({ renderScope: 'ticket' });
  }

  addModifier({ name }) {
    if (!this.canManageCatalog()) return null;

    const id = 'mod-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
    const newModifier = { id, name, options: [], assignedItems: [] };
    this.state.modifiers.push(newModifier);
    upsertModifier(newModifier);
    this.notify();
    return newModifier;
  }

  updateModifier(id, { name, options, assignedItems }) {
    if (!this.canManageCatalog()) return false;

    const modIndex = this.state.modifiers.findIndex(m => m.id === id);
    if (modIndex > -1) {
      const oldMod = this.state.modifiers[modIndex];
      
      let newOptions = options;
      if (options !== undefined) {
        // Sort options alphabetically by name before reindexing
        const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
        newOptions = sorted.map((opt, idx) => {
          let suffix = opt.id;
          if (/^\d{4}_/.test(suffix)) {
            suffix = suffix.substring(5);
          }
          return {
            ...opt,
            id: `${String(idx).padStart(4, '0')}_${suffix}`
          };
        });
      }

      this.state.modifiers[modIndex] = {
        ...oldMod,
        name: name !== undefined ? name : oldMod.name,
        options: newOptions !== undefined ? newOptions : oldMod.options,
        assignedItems: assignedItems !== undefined ? assignedItems : oldMod.assignedItems
      };
      
      if (assignedItems !== undefined) {
        this.state.menuItems.forEach((item, idx) => {
          const shouldBeAssigned = assignedItems.includes(item.id);
          const itemModifiers = item.modifiers || [];
          const isCurrentlyAssigned = itemModifiers.includes(id);
          
          if (shouldBeAssigned && !isCurrentlyAssigned) {
            this.state.menuItems[idx].modifiers = [...itemModifiers, id];
            upsertMenuItem(this.state.menuItems[idx]);
          } else if (!shouldBeAssigned && isCurrentlyAssigned) {
            this.state.menuItems[idx].modifiers = itemModifiers.filter(m => m !== id);
            upsertMenuItem(this.state.menuItems[idx]);
          }
        });
      }
      
      upsertModifier(this.state.modifiers[modIndex]);
      this.notify();
      return true;
    }
    return false;
  }

  deleteModifier(id) {
    if (!this.canManageCatalog()) return false;

    this.state.modifiers = this.state.modifiers.filter(m => m.id !== id);
    
    this.state.menuItems.forEach((item, idx) => {
      if (item.modifiers && item.modifiers.includes(id)) {
        this.state.menuItems[idx].modifiers = item.modifiers.filter(mId => mId !== id);
        upsertMenuItem(this.state.menuItems[idx]);
      }
    });
    
    dbDeleteModifier(id);
    this.notify();
    return true;
  }

  printBill() {
    if (this.state.selectedTableId === null) return;
    
    const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
    if (tableIndex === -1) return;
    const table = this.state.tables[tableIndex];
    if (table.items.length === 0) return;
    
    this.state.tables[tableIndex] = { ...table, status: 'pending-bill' };
    this.state.selectedTableId = null;
    this.state.activeTab = 'inicio';
    this.notify({ flushRemote: true });
  }

  saveActiveOrder() {
    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex > -1) {
        const table = this.state.tables[tableIndex];
        const status = table.items.length > 0 ? 'occupied' : 'available';
        this.state.tables[tableIndex] = { ...table, status };
      }
    }

    this.state.selectedTableId = null;
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    this.notify({ flushRemote: true });
  }

  saveActiveOrderToTable(tableId) {
    const tableIndex = this.state.tables.findIndex(t => t.id === tableId);
    if (tableIndex === -1) return;
    const table = this.state.tables[tableIndex];

    const tableItems = [...table.items];
    const sourceItems = this.state.directSaleTicket.items;
    const sourceLoyaltyAward = this.state.directSaleTicket.loyaltyAwarded || null;

    sourceItems.forEach(sourceItem => {
      const sortedOptions = [...(sourceItem.selectedOptions || [])].sort((a, b) => a.id.localeCompare(b.id));
      const existingIdx = tableItems.findIndex(i => 
        i.id === sourceItem.id && 
        Number(i.discountPercent || 0) === Number(sourceItem.discountPercent || 0) &&
        String(i.discountReason || '') === String(sourceItem.discountReason || '') &&
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions) &&
        String(i.note || '').trim() === String(sourceItem.note || '').trim()
      );

      if (existingIdx > -1) {
        tableItems[existingIdx] = { 
          ...tableItems[existingIdx], 
          qty: tableItems[existingIdx].qty + sourceItem.qty 
        };
      } else {
        tableItems.push({ ...sourceItem });
      }
    });

    const status = tableItems.length > 0 ? 'occupied' : 'available';
    this.state.tables[tableIndex] = { 
      ...table, 
      items: this.sortTicketItemsForService(tableItems),
      status: status,
      ...(table.loyaltyAwarded || sourceLoyaltyAward ? { loyaltyAwarded: table.loyaltyAwarded || sourceLoyaltyAward } : {})
    };

    this.state.directSaleTicket = { items: [] };
    this.state.selectedTableId = null;
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    this.notify({ flushRemote: true });
  }

  assignActiveOrderToTable(tableId, options = {}) {
    const shouldNotify = options.notify !== false;
    const tableIndex = this.state.tables.findIndex(t => t.id === tableId);
    if (tableIndex === -1) return;
    const table = this.state.tables[tableIndex];

    const tableItems = [...table.items];
    
    // Get source items (either from the current selected table or from the direct sale ticket)
    let sourceItems = [];
    let sourceLoyaltyAward = null;
    const previousTableId = this.state.selectedTableId;
    
    if (previousTableId !== null) {
      const prevTable = this.state.tables.find(t => t.id === previousTableId);
      if (prevTable) {
        sourceItems = [...prevTable.items];
        sourceLoyaltyAward = prevTable.loyaltyAwarded || null;
      }
    } else {
      sourceItems = [...this.state.directSaleTicket.items];
      sourceLoyaltyAward = this.state.directSaleTicket.loyaltyAwarded || null;
    }

    // Merge source items into target table items
    sourceItems.forEach(sourceItem => {
      const sortedOptions = [...(sourceItem.selectedOptions || [])].sort((a, b) => a.id.localeCompare(b.id));
      const existingIdx = tableItems.findIndex(i => 
        i.id === sourceItem.id && 
        Number(i.discountPercent || 0) === Number(sourceItem.discountPercent || 0) &&
        String(i.discountReason || '') === String(sourceItem.discountReason || '') &&
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions) &&
        String(i.note || '').trim() === String(sourceItem.note || '').trim()
      );

      if (existingIdx > -1) {
        tableItems[existingIdx] = { 
          ...tableItems[existingIdx], 
          qty: tableItems[existingIdx].qty + sourceItem.qty 
        };
      } else {
        tableItems.push({ ...sourceItem });
      }
    });

    // Save target table state
    const status = tableItems.length > 0 ? 'occupied' : 'available';
    this.state.tables[tableIndex] = { 
      ...table, 
      items: this.sortTicketItemsForService(tableItems),
      status: status,
      ...(table.loyaltyAwarded || sourceLoyaltyAward ? { loyaltyAwarded: table.loyaltyAwarded || sourceLoyaltyAward } : {})
    };

    // Clear source items (if target is different)
    if (previousTableId !== null) {
      if (previousTableId !== tableId) {
        const prevTableIndex = this.state.tables.findIndex(t => t.id === previousTableId);
        if (prevTableIndex > -1) {
          this.state.tables[prevTableIndex] = {
            ...this.state.tables[prevTableIndex],
            items: [],
            status: 'available',
            loyaltyAwarded: undefined
          };
        }
      }
    } else {
      this.state.directSaleTicket = { items: [] };
    }

    // Return to direct sale after assigning; tables should not remain armed for the next order.
    this.state.selectedTableId = null;
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    if (shouldNotify) this.notify({ flushRemote: true });
  }

  moveActiveOrderToTable(tableId) {
    const previousTableId = this.state.selectedTableId;
    if (previousTableId === null || previousTableId === tableId) return false;
    const previousTable = this.state.tables.find(t => t.id === previousTableId);
    if (!previousTable || !Array.isArray(previousTable.items) || previousTable.items.length === 0) return false;

    this.assignActiveOrderToTable(tableId, { notify: false });
    this.state.selectedTableId = null;
    this.state.activeTab = 'mesas';
    this.state.gridPath = ['root'];
    this.notify({ flushRemote: true });
    return true;
  }

  payActiveTicket(paymentMethod = 'Tarjeta', options = {}) {
    const items = this.getActiveItems();
    if (items.length === 0) return;

    const total = this.getActiveTicketTotal();
    const grossTotal = this.getActiveTicketGrossTotal();
    const discountTotal = this.getActiveTicketDiscountTotal();
    const itemsCount = items.reduce((sum, i) => sum + i.qty, 0);
    const selectedTable = this.getSelectedTable();
    const tableName = selectedTable ? selectedTable.name : 'Venta Directa';
    const transactionItems = items.map(item => ({
      ticketItemId: item.ticketItemId,
      id: item.id,
      name: item.name,
      price: item.price,
      qty: item.qty,
      note: item.note || '',
      deferUntilLater: item.deferUntilLater === true,
      selectedOptions: (item.selectedOptions || []).map(opt => ({ ...opt })),
      grossTotal: parseFloat(this.getItemGrossTotal(item).toFixed(2)),
      discountPercent: Number(item.discountPercent || 0),
      discountReason: item.discountReason || '',
      discountAmount: parseFloat(this.getItemDiscountAmount(item).toFixed(2)),
      total: parseFloat(this.getItemTotal(item).toFixed(2))
    }));

    const dateNow = new Date();
    const tipAmount = Math.max(0, Number(options.tipAmount || 0));
    const txId = `TX-${dateNow.getTime()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const dateStr = `${String(dateNow.getDate()).padStart(2, '0')}/${String(dateNow.getMonth() + 1).padStart(2, '0')}/${dateNow.getFullYear()}`;
    const timeStr = `${String(dateNow.getHours()).padStart(2, '0')}:${String(dateNow.getMinutes()).padStart(2, '0')}`;
    
    const transaction = {
      id: txId,
      date: `${dateStr}, ${timeStr}`,
      table: tableName,
      total: parseFloat(total.toFixed(2)),
      grossTotal: parseFloat(grossTotal.toFixed(2)),
      discountTotal: parseFloat(discountTotal.toFixed(2)),
      tipAmount: parseFloat(tipAmount.toFixed(2)),
      totalCharged: parseFloat(Number(options.totalCharged ?? (total + tipAmount)).toFixed(2)),
      paymentMethod: paymentMethod,
      itemsCount: itemsCount,
      items: transactionItems,
      payments: options.payments || [{
        method: paymentMethod,
        amount: parseFloat(total.toFixed(2)),
        provider: paymentMethod.toLowerCase().includes('regalo')
          ? 'Square'
          : paymentMethod.toLowerCase().includes('tarjeta') ? 'BBVA' : ''
      }],
      createdAt: dateNow.toISOString(),
      receiptToken: this.createReceiptToken(),
      legalData: { ...this.state.legal },
      staff: this.state.auth.profile ? {
        id: this.state.auth.profile.id,
        name: this.state.auth.profile.display_name,
        role: this.state.auth.profile.role
      } : null,
      ...(options.loyaltyCustomer ? { loyaltyCustomer: { ...options.loyaltyCustomer } } : {})
    };

    this.state.transactions.unshift(transaction);
    this.publishReceiptTicket(transaction);
    this.persistSaleRecord(transaction);
    this.ensureFiscalDocument(transaction.id);

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex > -1) {
        this.state.tables[tableIndex] = {
          ...this.state.tables[tableIndex],
          status: 'available',
          items: [],
          loyaltyAwarded: undefined
        };
      }
      this.state.selectedTableId = null;
    } else {
      this.state.directSaleTicket = { items: [] };
    }
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    this.notify({ flushRemote: true });
    return transaction;
  }

  clearActiveTicket() {
    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex > -1) {
        this.state.tables[tableIndex] = {
          ...this.state.tables[tableIndex],
          status: 'available',
          items: [],
          loyaltyAwarded: undefined
        };
      }
    } else {
      this.state.directSaleTicket = { items: [] };
    }
    this.notify({ flushRemote: this.state.selectedTableId !== null });
  }

  getSelectedTable() {
    if (this.state.selectedTableId === null) return null;
    return this.state.tables.find(t => t.id === this.state.selectedTableId) || null;
  }

  applyDiscountToItems(ticketItemIds = [], percent = 0, reason = 'Descuento') {
    const selectedIds = new Set((ticketItemIds || []).filter(Boolean));
    if (selectedIds.size === 0) return false;

    const cleanPercent = Math.min(100, Math.max(0, Number(percent) || 0));
    const cleanReason = cleanPercent === 100 ? 'Invitación' : String(reason || 'Descuento').trim();
    const updateItems = (items = []) => items.map(item => {
      if (!selectedIds.has(item.ticketItemId)) return item;
      if (cleanPercent <= 0) {
        const { discountPercent, discountReason, ...rest } = item;
        return rest;
      }
      return {
        ...item,
        discountPercent: cleanPercent,
        discountReason: cleanReason || 'Descuento'
      };
    });

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return false;
      this.state.tables[tableIndex] = {
        ...this.state.tables[tableIndex],
        items: updateItems(this.state.tables[tableIndex].items)
      };
    } else {
      this.state.directSaleTicket = {
        ...this.state.directSaleTicket,
        items: updateItems(this.state.directSaleTicket.items)
      };
    }

    this.notify({ renderScope: 'ticket', flushRemote: this.state.selectedTableId !== null });
    return true;
  }

  getItemGrossTotal(ticketItem) {
    const basePrice = Number(ticketItem.price || 0);
    const optionsPrice = (ticketItem.selectedOptions || []).reduce((sum, opt) => (
      sum + (Number(opt.price || 0) * Number(opt.qty || 0))
    ), 0);
    return (basePrice + optionsPrice) * Number(ticketItem.qty || 0);
  }

  getItemDiscountAmount(ticketItem) {
    const percent = Math.min(100, Math.max(0, Number(ticketItem.discountPercent || 0)));
    return this.getItemGrossTotal(ticketItem) * (percent / 100);
  }
  
  getItemTotal(ticketItem) {
    return this.getItemGrossTotal(ticketItem) - this.getItemDiscountAmount(ticketItem);
  }

  getActiveTicketGrossTotal() {
    return this.getActiveItems().reduce((sum, item) => sum + this.getItemGrossTotal(item), 0);
  }

  getActiveTicketDiscountTotal() {
    return this.getActiveItems().reduce((sum, item) => sum + this.getItemDiscountAmount(item), 0);
  }
  
  getActiveTicketTotal() {
    const items = this.getActiveItems();
    return items.reduce((sum, item) => sum + this.getItemTotal(item), 0);
  }

  getTableTotal(table) {
    if (!table || !table.items) return 0;
    return table.items.reduce((sum, item) => sum + this.getItemTotal(item), 0);
  }

  // ─────────────────────────────────────────────────────────────────
  // Devoluciones / Refunds
  // ─────────────────────────────────────────────────────────────────
  registerRefund({ parentTransactionId, amount, reason = '' }) {
    if (!this.canIssueRefunds()) return null;

    const parent = this.state.transactions.find(t => t.id === parentTransactionId);
    if (!parent) return null;

    const refundAmount = parseFloat(amount);
    if (isNaN(refundAmount) || refundAmount <= 0) return null;

    const dateNow = new Date();
    const dateStr = `${String(dateNow.getDate()).padStart(2, '0')}/${String(dateNow.getMonth() + 1).padStart(2, '0')}/${dateNow.getFullYear()}`;
    const timeStr = `${String(dateNow.getHours()).padStart(2, '0')}:${String(dateNow.getMinutes()).padStart(2, '0')}`;

    const refundTx = {
      id: `DEV-${Date.now()}`,
      type: 'refund',
      parentId: parentTransactionId,
      date: `${dateStr}, ${timeStr}`,
      createdAt: dateNow.toISOString(),
      table: parent.table,
      total: -Math.abs(refundAmount),
      paymentMethod: parent.paymentMethod,
      reason,
      itemsCount: 0,
      items: [],
      payments: [{
        method: parent.paymentMethod,
        amount: -Math.abs(refundAmount),
        provider: (parent.paymentMethod || '').toLowerCase().includes('tarjeta') ? 'BBVA' : ''
      }],
      legalData: { ...this.state.legal }
    };

    // Mark the original transaction
    const parentIdx = this.state.transactions.findIndex(t => t.id === parentTransactionId);
    if (parentIdx > -1) {
      this.state.transactions[parentIdx] = {
        ...this.state.transactions[parentIdx],
        hasRefund: true,
        refundAmount: refundAmount
      };
    }

    this.state.transactions.unshift(refundTx);
    this.persistSaleRecord(this.state.transactions[parentIdx] || parent);
    this.persistSaleRecord(refundTx);
    this.ensureFiscalDocument(refundTx.id);
    this.notify();
    return refundTx;
  }
}
// Single instance of store across the app
export const store = new Store();
export default store;
