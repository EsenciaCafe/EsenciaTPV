import { createClient } from '@supabase/supabase-js';

const loyaltySupabaseUrl = import.meta.env.VITE_LOYALTY_SUPABASE_URL;
const loyaltySupabaseAnonKey = import.meta.env.VITE_LOYALTY_SUPABASE_ANON_KEY;

export const isLoyaltyConfigured = Boolean(loyaltySupabaseUrl && loyaltySupabaseAnonKey);

export const loyaltySupabase = isLoyaltyConfigured
  ? createClient(loyaltySupabaseUrl, loyaltySupabaseAnonKey)
  : null;

const TIER_MULTIPLIERS = {
  Bronze: 1,
  Silver: 1.1,
  Gold: 1.2,
  Platinum: 1.3
};

export function normalizeRfidUid(uid = '') {
  return String(uid).trim().toUpperCase();
}

export function calculateLoyaltyTier(points = 0) {
  const total = Number(points || 0);
  if (total >= 2000) return 'Platinum';
  if (total >= 1000) return 'Gold';
  if (total >= 500) return 'Silver';
  return 'Bronze';
}

export function calculateLoyaltyPoints(amount, tier = 'Bronze') {
  const multiplier = TIER_MULTIPLIERS[tier] || 1;
  return Math.round(Number(amount || 0) * 10 * multiplier);
}

export function mapLoyaltyCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || 'Cliente',
    email: row.email || '',
    phone: row.phone || '',
    rfidUid: row.rfid_uid || '',
    points: Number(row.points || 0),
    visits: Number(row.visits || 0),
    totalSpent: Number(row.total_spent || 0),
    tier: row.tier || calculateLoyaltyTier(row.points)
  };
}

function mapLoyaltyDashboard(row) {
  return {
    totalCustomers: Number(row?.total_customers || 0),
    customersWithRfid: Number(row?.customers_with_rfid || 0),
    totalPoints: Number(row?.total_points || 0),
    totalVisits: Number(row?.total_visits || 0),
    totalSpent: Number(row?.total_spent || 0),
    pendingVouchers: Number(row?.pending_vouchers || 0)
  };
}

function mapJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapLoyaltyOverview(row) {
  const base = mapLoyaltyDashboard(row);
  return {
    ...base,
    active30d: Number(row?.active_30d || 0),
    retention30d: Number(row?.retention_30d || 0),
    avgTicket: Number(row?.avg_ticket || 0),
    expiringVouchers: Number(row?.expiring_vouchers || 0),
    tierDistribution: mapJsonArray(row?.tier_distribution),
    topPromos: mapJsonArray(row?.top_promos),
    recentPurchases: mapJsonArray(row?.recent_purchases)
  };
}

function mapLoyaltyPromo(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    tag: row.tag || '',
    type: row.type || 'redeem',
    pointsRequired: Number(row.pts_req || 0),
    expiry: row.expiry || '',
    active: row.active !== false,
    hidden: row.hidden === true
  };
}

function mapLoyaltyVoucher(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code || '',
    customerId: row.customer_id,
    customerName: row.customer_name || 'Cliente',
    promoId: row.promo_id,
    promoTitle: row.promo_title || 'Promo',
    status: row.status || 'pending',
    pointsCost: Number(row.pts_cost || 0),
    redeemedAt: row.redeemed_at || null,
    expiresAt: row.expires_at || null,
    usedAt: row.used_at || null
  };
}

function requireLoyaltyClient() {
  if (!loyaltySupabase) {
    throw new Error('Falta configurar la conexion con fidelidad');
  }
  return loyaltySupabase;
}

export async function findLoyaltyCustomerByRfid(rfidUid) {
  const cleanUid = normalizeRfidUid(rfidUid);
  if (!cleanUid) return null;

  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_find_loyalty_customer', {
    p_rfid_uid: cleanUid
  });

  if (error) throw error;
  return mapLoyaltyCustomer(Array.isArray(data) ? data[0] : data);
}

export async function searchLoyaltyCustomers(query = '') {
  const client = requireLoyaltyClient();
  const cleanQuery = String(query || '').trim();

  const { data, error } = await client.rpc('tpv_search_loyalty_customers', {
    p_query: cleanQuery
  });

  if (error) throw error;
  return (data || []).map(mapLoyaltyCustomer).filter(Boolean);
}

export async function getLoyaltyDashboard() {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_get_loyalty_dashboard');
  if (error) throw error;
  return mapLoyaltyDashboard(Array.isArray(data) ? data[0] : data);
}

export async function getLoyaltyAdminOverview() {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_get_loyalty_admin_overview');
  if (error) throw error;
  return mapLoyaltyOverview(Array.isArray(data) ? data[0] : data);
}

export async function getLoyaltyCustomerPurchases(customerId, limit = 8) {
  const client = requireLoyaltyClient();
  if (!customerId) return [];

  const { data, error } = await client.rpc('tpv_get_loyalty_customer_purchases', {
    p_customer_id: customerId,
    p_limit: limit
  });

  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    amount: Number(row.amount || 0),
    points: Number(row.points || 0),
    createdAt: row.created_at || null
  }));
}

export async function createLoyaltyCustomer({ name, email = '', phone = '', rfidUid = '' }) {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_create_loyalty_customer', {
    p_name: String(name || '').trim(),
    p_email: String(email || '').trim(),
    p_phone: String(phone || '').trim(),
    p_rfid_uid: normalizeRfidUid(rfidUid)
  });

  if (error) throw error;
  return mapLoyaltyCustomer(Array.isArray(data) ? data[0] : data);
}

export async function updateLoyaltyCustomer({ id, name, email = '', phone = '', rfidUid = '', points = 0 }) {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_update_loyalty_customer', {
    p_customer_id: id,
    p_name: String(name || '').trim(),
    p_email: String(email || '').trim(),
    p_phone: String(phone || '').trim(),
    p_rfid_uid: normalizeRfidUid(rfidUid),
    p_points: Math.max(0, Math.round(Number(points || 0)))
  });

  if (error) throw error;
  return mapLoyaltyCustomer(Array.isArray(data) ? data[0] : data);
}

export async function listLoyaltyPromos() {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_list_loyalty_promos');
  if (error) throw error;
  return (data || []).map(mapLoyaltyPromo).filter(Boolean);
}

export async function saveLoyaltyPromo(promo) {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_save_loyalty_promo', {
    p_promo_id: promo.id || null,
    p_title: String(promo.title || '').trim(),
    p_description: String(promo.description || '').trim(),
    p_tag: String(promo.tag || '').trim(),
    p_type: promo.type || 'redeem',
    p_pts_req: Math.max(0, Math.round(Number(promo.pointsRequired || 0))),
    p_expiry: promo.expiry || null,
    p_active: promo.active !== false,
    p_hidden: promo.hidden === true
  });
  if (error) throw error;
  return mapLoyaltyPromo(Array.isArray(data) ? data[0] : data);
}

export async function setLoyaltyPromoActive(promoId, active) {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_set_loyalty_promo_active', {
    p_promo_id: promoId,
    p_active: active === true
  });
  if (error) throw error;
  return mapLoyaltyPromo(Array.isArray(data) ? data[0] : data);
}

export async function listPendingLoyaltyVouchers() {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_list_pending_loyalty_vouchers');
  if (error) throw error;
  return (data || []).map(mapLoyaltyVoucher).filter(Boolean);
}

export async function updateLoyaltyVoucherStatus(voucherId, status) {
  const client = requireLoyaltyClient();
  const { data, error } = await client.rpc('tpv_update_loyalty_voucher_status', {
    p_voucher_id: voucherId,
    p_status: status
  });
  if (error) throw error;
  return mapLoyaltyVoucher(Array.isArray(data) ? data[0] : data);
}

export async function addLoyaltyPurchase({ customer, amount, transactionId, paymentMethod }) {
  const client = requireLoyaltyClient();
  const total = Math.round(Number(amount || 0) * 100) / 100;
  if (!customer?.id || total <= 0) return null;

  const { data, error } = await client.rpc('tpv_award_paid_loyalty_purchase', {
    p_rfid_uid: customer.rfidUid,
    p_amount: total
  });

  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;

  return {
    customerId: customer.id,
    customerName: customer.name,
    points: Number(result?.points || 0),
    nextPoints: Number(result?.next_points || 0),
    nextTier: result?.next_tier || customer.tier,
    transactionId,
    paymentMethod
  };
}

export async function addManualLoyaltyPointsWithoutPurchase({ customer, amount }) {
  const client = requireLoyaltyClient();
  const total = Math.round(Number(amount || 0) * 100) / 100;
  if (!customer?.id || total <= 0) return null;

  const { data, error } = await client.rpc('tpv_award_manual_loyalty_points', {
    p_rfid_uid: customer.rfidUid,
    p_amount: total
  });

  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;

  return {
    customerId: customer.id,
    customerName: customer.name,
    points: Number(result?.points || 0),
    nextPoints: Number(result?.next_points || 0),
    nextTier: result?.next_tier || customer.tier
  };
}
