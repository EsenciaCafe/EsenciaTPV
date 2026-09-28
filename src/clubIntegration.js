// New Club adapter; activated only with the explicit Club build configuration.
// The caller supplies a dedicated Club staff client; never reuse the TPV session.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const validClubQr = value => typeof value === 'string'
  && value.startsWith('esencia-club:v1:') && UUID.test(value.slice(16));

export function clubAmountCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Importe no válido.');
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 999999
    || Math.abs(value * 100 - cents) > 0.000001) throw new Error('Importe fuera del límite de Club Esencia.');
  return cents;
}

export function mapClubMember(row) {
  if (!row || !UUID.test(row.id) || !Number.isSafeInteger(Number(row.balance)) || Number(row.balance) < 0) {
    throw new Error('Ficha de Club Esencia no válida.');
  }
  return Object.freeze({ id: row.id, name: row.name || 'Cliente', points: Number(row.balance) / 100, provider: 'club-esencia' });
}

// UUIDv8 from a namespaced SHA-256 digest of the immutable sale identifier.
// Deliberately excludes amount/member: changing them must conflict, not award twice.
export async function clubRequestId(transactionId) {
  if (typeof transactionId !== 'string' || !transactionId.trim() || transactionId.length > 200) {
    throw new Error('Falta el identificador estable de la venta.');
  }
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`esencia-tpv:club:purchase:v1:${transactionId}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function createClubIntegration(client) {
  if (client.withSession) return Object.fromEntries(['identify','pendingRedemptions','resolveRedemption','awardConfirmedSale','awardClearedTicket','finishPromoClear'].map(name => [name, (...args) => createClubIntegration(client.withSession())[name](...args)]));
  async function rpc(name, params) {
    const request = client.rpc(name, params);
    const { data, error } = await (typeof request.abortSignal === 'function'
      ? request.abortSignal(AbortSignal.timeout(12000)) : request);
    if (error) throw new Error(error.message || 'Club Esencia no está disponible.');
    return data;
  }
  async function requireStaff() {
    if (!await rpc('es_admin')) throw new Error('Inicia sesión con una cuenta del equipo de Club Esencia.');
  }
  return {
    async finishPromoClear(p,eventId,delivered) { return rpc('club_action',{p_action:'promo_clear',p_payload:{id:p.id,cart_id:p.cartId,clear_id:eventId,delivered}}); },
    async awardClearedTicket(ticket, member) {
      if(!client.awards)throw new Error('El servidor no admite puntos por vaciado.');
      if(member?.provider!=='club-esencia'||!UUID.test(member.id))throw new Error('Socio no válido.');
      const amount=ticket.total===0?0:clubAmountCents(ticket.total);
      await requireStaff();
      return rpc('club_action',{p_action:'clear_award',p_payload:{event_id:ticket.id,request_id:await clubRequestId(ticket.id),amount,member_id:member.id,version:0}});
    },
    async pendingRedemptions(memberId) {
      if (!UUID.test(memberId)) throw new Error('Socio no válido.');
      await requireStaff();
      const { data, error } = await client.from('club_redemptions')
        .select('id,member_id,title,cost,status').eq('member_id', memberId).eq('status', 'pending').limit(100);
      if (error) throw error;
      return data || [];
    },
    async resolveRedemption(id, status, actorId) {
      if (!UUID.test(id) || !UUID.test(actorId) || !['used', 'cancelled'].includes(status)) throw new Error('Canje no válido.');
      await requireStaff();
      const result = await rpc('club_action', { p_action: 'resolve', p_payload: {
        id, status, request_id: await clubRequestId(`resolve:${id}:${status}:${actorId}`),
      } });
      if (result?.ok !== true) throw new Error('No se pudo confirmar el canje. Actualiza antes de reintentar.');
      return result;
    },
    async identify(qr) {
      if (!validClubQr(qr)) throw new Error('Este código no es un QR de Club Esencia.');
      await requireStaff();
      return mapClubMember(await rpc('club_lookup_qr', { p_qr: qr }));
    },
    // Call only AFTER payActiveTicket confirms a new online sale. This adapter
    // cannot charge, fiscalize, reopen or change the TPV transaction.
    async awardConfirmedSale(transaction, member) {
      if (!transaction || transaction.duplicatePrevented || transaction.type === 'refund'
        || transaction.offlineSessionId || transaction.syncStatus === 'pending'
        || transaction.hasRefund || Number(transaction.refundAmount || 0) > 0) {
        throw new Error('Esta venta requiere revisión antes de asignar puntos.');
      }
      if (member?.provider !== 'club-esencia' || !UUID.test(member.id)) throw new Error('Selecciona un socio del nuevo club.');
      const amount = clubAmountCents(transaction.total); // Discounts included; tips excluded.
      const requestId = await clubRequestId(transaction.id);
      await requireStaff();
      const result = await rpc('club_action', { p_action: 'purchase', p_payload: {
        request_id: requestId, member_id: member.id, amount, ...(client.awards ? { sale_id: transaction.id, version: 0 } : {}),
      } });
      if (result?.ok !== true) throw new Error('Club Esencia no confirmó los puntos. Reintenta la misma venta.');
      return { requestId, transactionId: transaction.id, points: Math.floor(amount / 100), confirmed: true };
    },
  };
}

// A Club failure is reported separately. The original paid sale is never changed.
export async function settleClubAfterSale(integration, transaction, member) {
  try {
    return { state: 'confirmed', ...(await integration.awardConfirmedSale(transaction, member)) };
  } catch (error) {
    return { state: 'pending-review', transactionId: transaction?.id, message: error.message };
  }
}




