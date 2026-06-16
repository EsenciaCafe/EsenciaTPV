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
  saveTPVState
} from './db.js';
import { supabase } from './supabase.js';

const DINING_STATE_STORAGE_KEY = 'tpv-dining-state-v1';
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

      // ── CATALOG DATA (loaded from Supabase) ─────────────────
      categories: [],
      modifiers: [],
      menuItems: [],
      gridItems: {}
    };
    
    this.restoreDiningState();
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
            items
          };
        });
      }

      if (savedState.directSaleTicket && Array.isArray(savedState.directSaleTicket.items)) {
        this.state.directSaleTicket = { items: savedState.directSaleTicket.items };
      }

      if (Array.isArray(savedState.transactions)) {
        this.state.transactions = savedState.transactions;
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
          transactions: this.state.transactions
        }));
      } catch (err) {
        console.warn('[Store] No se pudo guardar el estado de mesas en LocalStorage.', err);
      }
    }

    // 2. Save to Supabase (Realtime Sync)
    saveTPVState(this.state.tables, this.state.directSaleTicket, this.state.transactions);
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
          if (tpvState.direct_sale) {
            this.state.directSaleTicket = tpvState.direct_sale;
          }
          if (Array.isArray(tpvState.transactions)) {
            this.state.transactions = tpvState.transactions;
          }
        }
      } catch (err) {
        console.warn('[Store] No se pudo cargar el estado del TPV desde la BD, usando local.', err);
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
              changed = true;
            }
            if (Array.isArray(newState.transactions) && JSON.stringify(this.state.transactions) !== JSON.stringify(newState.transactions)) {
              this.state.transactions = newState.transactions;
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

  setActiveTab(tab) {
    this.state.activeTab = tab;
    if (tab === 'inicio') {
      this.state.gridPath = ['root'];
    }
    this.notify();
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
              image: oldItem.image
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
                price: updatedData.price !== undefined ? parseFloat(updatedData.price) : gridItem.price
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
    }
  }

  toggleEditingGrid() {
    this.state.isEditingGrid = !this.state.isEditingGrid;
    this.notify();
  }

  addGridShortcut(gridKey, slotIndex, shortcutData) {
    if (this.state.gridItems[gridKey]) {
      this.state.gridItems[gridKey][slotIndex] = shortcutData;
      upsertGridItems(gridKey, this.state.gridItems[gridKey]);
      this.notify();
    }
  }

  removeGridShortcut(gridKey, slotIndex) {
    if (this.state.gridItems[gridKey]) {
      this.state.gridItems[gridKey][slotIndex] = null;
      upsertGridItems(gridKey, this.state.gridItems[gridKey]);
      this.notify();
    }
  }

  addCategory({ name, type, parentId = null }) {
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
    }
  }

  deleteCategory(id) {
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
  }

  getActiveItems() {
    if (this.state.selectedTableId !== null) {
      const table = this.state.tables.find(t => t.id === this.state.selectedTableId);
      return table ? table.items : [];
    } else {
      return this.state.directSaleTicket.items;
    }
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

      this.state.tables[tableIndex] = { ...table, items: newItems, status: newStatus };
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
      this.state.directSaleTicket.items = newItems;
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
    const id = 'mod-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
    const newModifier = { id, name, options: [], assignedItems: [] };
    this.state.modifiers.push(newModifier);
    upsertModifier(newModifier);
    this.notify();
    return newModifier;
  }

  updateModifier(id, { name, options, assignedItems }) {
    const modIndex = this.state.modifiers.findIndex(m => m.id === id);
    if (modIndex > -1) {
      const oldMod = this.state.modifiers[modIndex];
      
      this.state.modifiers[modIndex] = {
        ...oldMod,
        name: name !== undefined ? name : oldMod.name,
        options: options !== undefined ? options : oldMod.options,
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
    }
  }

  deleteModifier(id) {
    this.state.modifiers = this.state.modifiers.filter(m => m.id !== id);
    
    this.state.menuItems.forEach((item, idx) => {
      if (item.modifiers && item.modifiers.includes(id)) {
        this.state.menuItems[idx].modifiers = item.modifiers.filter(mId => mId !== id);
        upsertMenuItem(this.state.menuItems[idx]);
      }
    });
    
    dbDeleteModifier(id);
    this.notify();
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
      status: status 
    };

    this.state.directSaleTicket.items = [];
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
    const previousTableId = this.state.selectedTableId;
    
    if (previousTableId !== null) {
      const prevTable = this.state.tables.find(t => t.id === previousTableId);
      if (prevTable) {
        sourceItems = [...prevTable.items];
      }
    } else {
      sourceItems = [...this.state.directSaleTicket.items];
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
      status: status 
    };

    // Clear source items (if target is different)
    if (previousTableId !== null) {
      if (previousTableId !== tableId) {
        const prevTableIndex = this.state.tables.findIndex(t => t.id === previousTableId);
        if (prevTableIndex > -1) {
          this.state.tables[prevTableIndex] = {
            ...this.state.tables[prevTableIndex],
            items: [],
            status: 'available'
          };
        }
      }
    } else {
      this.state.directSaleTicket.items = [];
    }

    // Set selected table
    this.state.selectedTableId = tableId;
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    this.notify();
  }

  payActiveTicket(paymentMethod = 'Tarjeta') {
    const items = this.getActiveItems();
    if (items.length === 0) return;

    const total = this.getActiveTicketTotal();
    const itemsCount = items.reduce((sum, i) => sum + i.qty, 0);
    const selectedTable = this.getSelectedTable();
    const tableName = selectedTable ? selectedTable.name : 'Venta Directa';

    const txId = `TX-${1000 + this.state.transactions.length + 1}`;
    const dateNow = new Date();
    const timeStr = `${String(dateNow.getHours()).padStart(2, '0')}:${String(dateNow.getMinutes()).padStart(2, '0')}`;
    
    this.state.transactions.unshift({
      id: txId,
      date: `Hoy, ${timeStr}`,
      table: tableName,
      total: parseFloat(total.toFixed(2)),
      paymentMethod: paymentMethod,
      itemsCount: itemsCount
    });

    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex > -1) {
        this.state.tables[tableIndex] = { ...this.state.tables[tableIndex], status: 'available', items: [] };
      }
      this.state.selectedTableId = null;
    } else {
      this.state.directSaleTicket.items = [];
    }
    this.state.activeTab = 'inicio';
    this.state.gridPath = ['root'];
    this.notify();
  }

  clearActiveTicket() {
    if (this.state.selectedTableId !== null) {
      const tableIndex = this.state.tables.findIndex(t => t.id === this.state.selectedTableId);
      if (tableIndex > -1) {
        this.state.tables[tableIndex] = { ...this.state.tables[tableIndex], status: 'available', items: [] };
      }
    } else {
      this.state.directSaleTicket.items = [];
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
}

// Single instance of store across the app
export const store = new Store();
export default store;
