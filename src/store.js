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
  loadCashClosures,
  upsertCashClosure,
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
    this.listeners = [];
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
    } catch (err) {
      console.warn('[Store] No se pudo restaurar el estado de mesas.', err);
    }
  }

  persistDiningState() {
    // 1. Save to LocalStorage fallback
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(DINING_STATE_STORAGE_KEY, JSON.stringify({
          tables: this.state.tables,
          directSaleTicket: this.state.directSaleTicket,
          transactions: this.state.transactions,
          legal: this.state.legal
        }));
      } catch (err) {
        console.warn('[Store] No se pudo guardar el estado de mesas en LocalStorage.', err);
      }
    }

    // 2. Save to Supabase (Realtime Sync)
    saveTPVState(this.state.tables, this.state.directSaleTicket, this.state.transactions, this.state.legal);
  }

  // Subscribe components
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.persistDiningState();
    this.listeners.forEach(listener => listener(this.state));
  }

  getRoleLabel(role = this.state.auth.role) {
    const labels = {
      admin: 'Administrador',
      manager: 'Encargado',
      staff: 'Staff'
    };
    return labels[role] || 'Sin rol';
  }

  canAccessSettings() {
    return ['admin', 'manager'].includes(this.state.auth.role);
  }

  canManageCatalog() {
    return this.state.auth.role === 'admin';
  }

  canManageAccounting() {
    return this.state.auth.role === 'admin';
  }

  canViewReports() {
    return ['admin', 'manager'].includes(this.state.auth.role);
  }

  canCloseCash() {
    return ['admin', 'manager'].includes(this.state.auth.role);
  }

  canIssueRefunds() {
    return ['admin', 'manager'].includes(this.state.auth.role);
  }

  canResetTerminal() {
    return this.state.auth.role === 'admin';
  }

  canManageStaff() {
    return this.state.auth.role === 'admin';
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

  async loadCashClosures() {
    const closures = await loadCashClosures();
    this.cashClosurePersistenceReady = Array.isArray(closures);
    if (Array.isArray(closures)) this.state.cashClosures = closures;
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
      this.listeners.forEach(listener => listener(this.state));
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
    this.listeners.forEach(listener => listener(this.state));
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
    if (!this.salesPersistenceReady) return;
    upsertSaleRecord(transaction).catch(err => {
      console.warn('[Store] No se pudo guardar la venta normalizada.', err);
    });
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
            this.state.tables = tpvState.tables;
          }
          // Restore direct sale ticket (but keep legal_data separate)
          if (tpvState.direct_sale) {
            // Merge legal from direct_sale.legal_data (embedded fallback)
            if (tpvState.direct_sale.legal_data && Object.keys(tpvState.direct_sale.legal_data).length > 0) {
              this.state.legal = { ...this.state.legal, ...tpvState.direct_sale.legal_data };
            }
            // Store directSaleTicket without legal_data inside it
            const { legal_data: _ld, ...directSaleClean } = tpvState.direct_sale;
            this.state.directSaleTicket = directSaleClean;
          }
          if (Array.isArray(tpvState.transactions)) {
            this.state.transactions = tpvState.transactions;
          }
          // Top-level legal_data column (if the column exists in Supabase)
          if (tpvState.legal_data && Object.keys(tpvState.legal_data).length > 0) {
            this.state.legal = { ...this.state.legal, ...tpvState.legal_data };
          }
        }
      } catch (err) {
        console.warn('[Store] No se pudo cargar el estado del TPV desde la BD, usando local.', err);
      }

      try {
        const normalizedSales = await loadSales();
        this.salesPersistenceReady = Array.isArray(normalizedSales);
        if (normalizedSales?.length > 0) {
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

      // Suscribirse a cambios en tiempo real
      this.subscribeToRealtime();
      
      this.notify();
      return true;
    } catch (err) {
      console.warn('[Store] No se pudo conectar a Supabase, usando datos locales como fallback.', err.message);
      return false;
    }
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
          console.log('[Store] Estado del TPV actualizado en tiempo real:', payload);
          const newState = payload.new;
          if (newState) {
            let changed = false;
            
            if (Array.isArray(newState.tables) && JSON.stringify(this.state.tables) !== JSON.stringify(newState.tables)) {
              this.state.tables = newState.tables;
              changed = true;
            }
            if (newState.direct_sale && JSON.stringify(this.state.directSaleTicket) !== JSON.stringify(newState.direct_sale)) {
              this.state.directSaleTicket = newState.direct_sale;
              if (newState.direct_sale.legal_data && JSON.stringify(this.state.legal) !== JSON.stringify(newState.direct_sale.legal_data)) {
                this.state.legal = newState.direct_sale.legal_data;
              }
              changed = true;
            }
            if (Array.isArray(newState.transactions) && JSON.stringify(this.state.transactions) !== JSON.stringify(newState.transactions)) {
              this.state.transactions = newState.transactions;
              changed = true;
            }
            if (newState.legal_data && JSON.stringify(this.state.legal) !== JSON.stringify(newState.legal_data)) {
              this.state.legal = newState.legal_data;
              changed = true;
            }

            if (changed) {
              this.listeners.forEach(listener => listener(this.state));
            }
          }
        }
      )
      .subscribe();
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
    const toLocalDateKey = (date) => {
      const d = new Date(date);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    if (tx.createdAt) return toLocalDateKey(tx.createdAt);
    if (tx.date) {
      const [datePart, timePart = '00:00'] = tx.date.split(', ');
      const [day, month, year] = datePart.split('/').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      return toLocalDateKey(new Date(year, month - 1, day, hour || 0, minute || 0));
    }
    return toLocalDateKey(new Date());
  }

  getPaymentBreakdownForTransaction(tx) {
    if (Array.isArray(tx.payments) && tx.payments.length > 0) {
      return tx.payments.map(payment => ({
        method: payment.method || tx.paymentMethod || '',
        amount: Number(payment.amount || 0)
      }));
    }
    return [{
      method: tx.paymentMethod || '',
      amount: Number(tx.total || 0)
    }];
  }

  getCashClosureSummary(date = new Date().toISOString().slice(0, 10)) {
    const dayTx = this.state.transactions.filter(tx => this.getTransactionDateKey(tx) === date);
    const summary = dayTx.reduce((acc, tx) => {
      const total = Number(tx.total || 0);
      if (tx.type === 'refund') {
        acc.totalRefunds += Math.abs(total);
      } else {
        acc.totalSales += total;
      }
      acc.netTotal += total;
      acc.transactionsCount += tx.type === 'refund' ? 0 : 1;

      this.getPaymentBreakdownForTransaction(tx).forEach(payment => {
        const method = (payment.method || '').toLowerCase();
        const amount = Number(payment.amount || 0);
        if (method.includes('efectivo')) {
          acc.expectedCash += amount;
        } else if (method.includes('tarjeta')) {
          acc.expectedCard += amount;
        } else {
          acc.otherPayments += amount;
        }
      });
      return acc;
    }, {
      businessDate: date,
      transactionsCount: 0,
      totalSales: 0,
      totalRefunds: 0,
      netTotal: 0,
      expectedCash: 0,
      expectedCard: 0,
      otherPayments: 0
    });

    Object.keys(summary).forEach(key => {
      if (typeof summary[key] === 'number') summary[key] = Number(summary[key].toFixed(2));
    });
    return summary;
  }

  async saveCashClosure(data) {
    if (!this.canCloseCash() || !this.cashClosurePersistenceReady) return false;
    const alreadyClosed = this.state.cashClosures.some(closure => closure.businessDate === data.businessDate);
    if (alreadyClosed) return false;

    const summary = this.getCashClosureSummary(data.businessDate);
    const countedCash = Number(data.countedCash || 0);
    const openingCash = Number(data.openingCash || 0);
    const bbvaTotal = Number(data.bbvaTotal || 0);
    const closure = {
      id: `closure-${data.businessDate}`,
      ...summary,
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
      return table ? table.items : [];
    } else {
      return this.state.directSaleTicket.items;
    }
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

  addItemToActiveTicket(itemId, selectedOptions = []) {
    const menuItem = this.state.menuItems.find(item => item.id === itemId);
    if (!menuItem) return;

    const sortedOptions = [...selectedOptions].sort((a, b) => a.id.localeCompare(b.id));
    const ticketItemId = `${itemId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex === -1) return;
      const table = this.state.tables[tableIndex];
      const newItems = [...table.items];
      
      const existingIdx = newItems.findIndex(i => 
        i.id === itemId && 
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions)
      );
      
      if (existingIdx > -1) {
        newItems[existingIdx] = { ...newItems[existingIdx], qty: newItems[existingIdx].qty + 1 };
      } else {
        newItems.push({ ticketItemId, id: menuItem.id, name: menuItem.name, price: menuItem.price, qty: 1, selectedOptions: sortedOptions });
      }

      this.state.tables[tableIndex] = {
        ...table,
        items: newItems,
        status: table.status === 'available' ? 'occupied' : table.status
      };
    } else {
      const newItems = [...this.state.directSaleTicket.items];
      const existingIdx = newItems.findIndex(i => 
        i.id === itemId && 
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions)
      );

      if (existingIdx > -1) {
        newItems[existingIdx] = { ...newItems[existingIdx], qty: newItems[existingIdx].qty + 1 };
      } else {
        newItems.push({ ticketItemId, id: menuItem.id, name: menuItem.name, price: menuItem.price, qty: 1, selectedOptions: sortedOptions });
      }
      this.state.directSaleTicket.items = newItems;
    }

    this.notify();
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
    this.notify();
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
        items: newItems,
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
        items: newItems,
        ...(newItems.length > 0 && this.state.directSaleTicket.loyaltyAwarded
          ? { loyaltyAwarded: this.state.directSaleTicket.loyaltyAwarded }
          : { loyaltyAwarded: undefined })
      };
    }
    this.notify();
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
          JSON.stringify(item.selectedOptions || []) === JSON.stringify(sortedOptions)
        );
        
        if (identicalIdx > -1) {
          newItems[identicalIdx] = { ...newItems[identicalIdx], qty: newItems[identicalIdx].qty + currentQty };
          newItems.splice(idx, 1);
        }
        
        this.state.tables[tableIndex] = { ...table, items: newItems };
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
          JSON.stringify(item.selectedOptions || []) === JSON.stringify(sortedOptions)
        );
        
        if (identicalIdx > -1) {
          newItems[identicalIdx] = { ...newItems[identicalIdx], qty: newItems[identicalIdx].qty + currentQty };
          newItems.splice(idx, 1);
        }
        
        this.state.directSaleTicket.items = newItems;
      }
    }
    this.notify();
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
    this.notify();
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
    this.notify();
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
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions)
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
      items: tableItems, 
      status: status,
      ...(table.loyaltyAwarded || sourceLoyaltyAward ? { loyaltyAwarded: table.loyaltyAwarded || sourceLoyaltyAward } : {})
    };

    this.state.directSaleTicket = { items: [] };
    this.state.selectedTableId = null;
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    this.notify();
  }

  assignActiveOrderToTable(tableId) {
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
        JSON.stringify(i.selectedOptions || []) === JSON.stringify(sortedOptions)
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
      items: tableItems, 
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

    // Set selected table
    this.state.selectedTableId = tableId;
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    this.notify();
  }

  payActiveTicket(paymentMethod = 'Tarjeta', options = {}) {
    const items = this.getActiveItems();
    if (items.length === 0) return;

    const total = this.getActiveTicketTotal();
    const itemsCount = items.reduce((sum, i) => sum + i.qty, 0);
    const selectedTable = this.getSelectedTable();
    const tableName = selectedTable ? selectedTable.name : 'Venta Directa';
    const transactionItems = items.map(item => ({
      ticketItemId: item.ticketItemId,
      id: item.id,
      name: item.name,
      price: item.price,
      qty: item.qty,
      selectedOptions: (item.selectedOptions || []).map(opt => ({ ...opt })),
      total: parseFloat(this.getItemTotal(item).toFixed(2))
    }));

    const txId = `TX-${1000 + this.state.transactions.length + 1}`;
    const dateNow = new Date();
    const dateStr = `${String(dateNow.getDate()).padStart(2, '0')}/${String(dateNow.getMonth() + 1).padStart(2, '0')}/${dateNow.getFullYear()}`;
    const timeStr = `${String(dateNow.getHours()).padStart(2, '0')}:${String(dateNow.getMinutes()).padStart(2, '0')}`;
    
    const transaction = {
      id: txId,
      date: `${dateStr}, ${timeStr}`,
      table: tableName,
      total: parseFloat(total.toFixed(2)),
      paymentMethod: paymentMethod,
      itemsCount: itemsCount,
      items: transactionItems,
      payments: options.payments || [{
        method: paymentMethod,
        amount: parseFloat(total.toFixed(2)),
        provider: paymentMethod.toLowerCase().includes('tarjeta') ? 'BBVA' : ''
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
    this.notify();
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
    this.notify();
  }

  getSelectedTable() {
    if (this.state.selectedTableId === null) return null;
    return this.state.tables.find(t => t.id === this.state.selectedTableId) || null;
  }
  
  getItemTotal(ticketItem) {
    const basePrice = ticketItem.price;
    const optionsPrice = (ticketItem.selectedOptions || []).reduce((sum, opt) => sum + (opt.price * opt.qty), 0);
    return (basePrice + optionsPrice) * ticketItem.qty;
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
    this.notify();
    return refundTx;
  }
}
// Single instance of store across the app
export const store = new Store();
export default store;
