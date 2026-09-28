// Served only by vite.club-distributed.config.js, never by the production entry.
import { store } from '/src/store.js';
import * as clubRuntime from '/src/clubRuntime.js';
import '/src/main.js';
if ('serviceWorker' in navigator) navigator.serviceWorker.register = async () => ({ update: async () => {} });

const staff = {id:'demo-tpv-staff',display_name:'Equipo de prueba',role:'admin'};
store.initializeLocalPersistence = async () => true;
store.loadAuthSession = async () => { const bootstrap=await fetch('/__club_demo/bootstrap').then(r=>r.json());await clubRuntime.clubPinBridge.configure(bootstrap.device);store.state.auth={profile:null,role:null,isLoading:false}; };
store.loadFromSupabase = async () => {
  const state = await fetch('/__club_demo/state').then(r=>r.json());
  store.state.transactions=state.sales;
  store.state.staffProfiles=await fetch('/tpv/rest/v1/staff_profiles').then(r=>r.json());
  store.state.legal={businessName:'TPV DE PRUEBA',companyName:'DATOS FICTICIOS',nif:'PRUEBA',address:'Sin dirección real',taxName:'IGIC',taxRate:7};
  store.state.menuItems=[{id:'1',name:'Café de prueba',price:4.60,categoryId:'1',taxRate:7,modifiers:['extras']}];
  store.state.modifiers=[{id:'extras',name:'Extras',assignedItems:['1'],options:[{id:'cream',name:'Nata',price:.5,allowMultiple:true}]}];
  store.state.categories=[{id:'1',name:'Pruebas'}];
  store.state.gridItems={root:[{id:'1',type:'article',itemId:'1',name:'Café de prueba',price:4.6}]};
  return true;
};
store.persistDiningState=()=>{};
store.flushRemotePersist=async()=>{};
store.refreshFromRemote=async()=>{};
store.publishReceiptTicket=()=>{};
store.broadcastSaleChange=()=>{};
store.scheduleSalesRefresh=()=>{};
store.persistSaleRecord=async tx=>{
  await fetch('/__club_demo/sale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tx)});
  return tx.id;
};
store.loadSalesForDate=async()=>true;
store.loadSalesForMonth=async()=>true;
window.clubDemo={store,clubRuntime};
document.title='TPV · PRUEBA LOCAL · Sin ventas reales';
