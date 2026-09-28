import { createClient } from '@supabase/supabase-js';
import { createClubIntegration } from './clubIntegration.js';
import { createClubPinBridge } from './clubPinBridge.js';
import { createClubQueue } from './clubQueue.js';
import {clubServerEnabled,serverClubRaw} from './clubServerTransport.js';

export const clubEnabled = import.meta.env.VITE_LOYALTY_PROVIDER === 'club';
const url = import.meta.env.VITE_CLUB_SUPABASE_URL;
const key = import.meta.env.VITE_CLUB_SUPABASE_ANON_KEY;
export const clubPinEnabled = clubEnabled && import.meta.env.VITE_CLUB_PIN_LOGIN === 'true';
const rawClubClient = clubEnabled && url && key ? createClient(url, key, {
  auth: { storageKey: 'esencia-tpv-club-auth-v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;
export const clubPinBridge = clubPinEnabled && (clubServerEnabled||rawClubClient) ? createClubPinBridge(clubServerEnabled?serverClubRaw:rawClubClient, { storage:clubServerEnabled?localStorage:sessionStorage, legacyStorage:clubServerEnabled?sessionStorage:undefined, changed: () => window.dispatchEvent(new Event('club-session-changed')) }) : null;
export const clubClient = clubPinBridge || rawClubClient;
export async function clubLoginWithPin(pin, staffId) { if (!clubPinBridge) return; sessionLocked = false; if(clubServerEnabled&&clubPinBridge.currentStaff()===staffId&&clubPinBridge.actor())return true;return clubPinBridge.login(pin, staffId); }
export const clubIntegration = clubClient ? createClubIntegration(clubClient) : null;
export let clubStaff = () => null;
let permitted = () => false;
let notify = () => {};
const LOCK_KEY = 'esencia-tpv-club-locked-v1';
let sessionLocked = false;
if (clubEnabled) {
  try { sessionLocked = localStorage.getItem(LOCK_KEY) === 'true'; }
  catch { sessionLocked = true; }
}
export let clubQueue = null;
export async function clubActor() {
  if (clubPinBridge) { await clubPinBridge.ready(); return clubPinBridge.currentStaff() === clubStaff()?.id ? clubPinBridge.actor() : null; }
  if (!clubClient || sessionLocked) return null;
  const { data, error } = await clubClient.auth.getSession();
  if (error) throw error;
  return data.session?.user?.id || null;
}
export async function clubLogin(email, password) {
  if (!clubClient) throw new Error('Falta configurar Club Esencia en esta instalación.');
  const { error } = await clubClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const check = await clubClient.rpc('es_admin');
  if (check.error || check.data !== true) {
    await clubClient.auth.signOut({ scope: 'local' });
    throw new Error('La cuenta no tiene permisos de equipo en Club Esencia.');
  }
  localStorage.removeItem(LOCK_KEY);
  sessionLocked = false;
  window.dispatchEvent(new Event('club-session-changed'));
}
export async function clubLogout() {
  if (clubPinBridge) return clubPinBridge.logout();
  // Block the local integration even when the remote logout cannot complete.
  // A new staff member must explicitly sign in before resuming pending work.
  sessionLocked = true;
  try { localStorage.setItem(LOCK_KEY, 'true'); } catch { /* Keep the in-memory lock and still clear auth. */ }
  window.dispatchEvent(new Event('club-session-changed'));
  if (clubClient) {
    const { error } = await clubClient.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }
}
export async function clubAfterSale(transaction) {
  try {
    if (!clubQueue) throw new Error('Club no está configurado. La venta conserva los datos para revisión.');
    await clubQueue.record(transaction);
    // Never hold the payment modal open waiting on loyalty/network retries.
    void clubQueue.flush().catch(() => {});
    return { message: 'Venta cobrada. Puntos guardados para confirmar en Club Esencia.', type: 'success' };
  } catch (error) {
    return { message: `Venta cobrada. No se guardó la cola de puntos: ${error.message} Revisa esta venta en Fidelidad.`, type: 'warning' };
  }
}
export async function clubAfterRefund(parent) {
  if (!clubQueue || parent?.loyaltyCustomer?.provider !== 'club-esencia') return;
  await clubQueue.record({ ...parent, hasRefund: true });
}
export function initializeClub({ canSend, loadSale, transactions, onError, getStaff = () => null }) {
  if (!clubClient) return;
  permitted = canSend; notify = onError; clubStaff = getStaff;
  if (clubPinBridge) void clubPinBridge.refresh().catch(() => {});
  clubQueue = createClubQueue({ name: `esencia-tpv-club-v1:${clubServerEnabled?location.host:new URL(url).hostname}`, integration: clubIntegration,
    actorId: clubActor, loadSale, canSend: () => permitted() && navigator.onLine });
  let busy = false;
  const recover = async () => {
    if (busy || !permitted()) return;
    busy = true;
    try { await clubQueue.recover(transactions()); await clubQueue.flush(); }
    catch (error) { notify(`Club Esencia: ${error.message}`); }
    finally { busy = false; }
  };
  clubClient.auth.onAuthStateChange(() => { window.dispatchEvent(new Event('club-session-changed')); });
  window.addEventListener('online', recover);
  window.addEventListener('focus', recover);
  setInterval(recover, 30000);
  void recover();
}


