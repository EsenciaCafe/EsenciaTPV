import Dexie from 'dexie';
import { clubAmountCents, clubRequestId } from './clubIntegration.js';

export function createClubQueue({ name = 'esencia-tpv-club-v1', integration, actorId, loadSale, canSend = () => true }) {
  const db = new Dexie(name);
  db.version(1).stores({ operations: '&id,status,actorId,createdAt' });
  let running;
  const review = tx => tx?.type === 'refund' || tx?.hasRefund || Number(tx?.refundAmount || 0) > 0;
  const queue = {
    db,
    async preparePromotionClear({promotion,actorId,eventId,delivered}) {
      const id=await clubRequestId(`${eventId}:${promotion.id}`);
      const old=await db.operations.get(id);
      if(!old)await db.operations.add({id,kind:'promo-clear',promotion,actorId,transactionId:eventId,delivered,total:0,member:{id:promotion.memberId,name:promotion.title},createdAt:new Date().toISOString(),status:'prepared',error:'Vaciado con promoción preparado; comprobar si se interrumpe.',attempts:0});
      else if(old.status==='prepared')await db.operations.update(id,{delivered,actorId});
      return id;
    },
    async prepareClear(transaction) {
      const id=await clubRequestId(transaction.id), member=transaction.loyaltyCustomer;
      if(!member?.actorId || member.provider!=='club-esencia')throw new Error('Falta el socio del vaciado.');
      const existing=await db.operations.get(id);
      if(existing?.status==='prepared')await db.operations.update(id,{total:transaction.total,member,actorId:member.actorId});
      if(!existing)await db.operations.add({id,kind:'clear',transactionId:transaction.id,total:transaction.total,member,actorId:member.actorId,createdAt:new Date().toISOString(),status:'prepared',error:'Vaciado preparado: si se interrumpe, revisar si llegó a completarse.',attempts:0});
      return id;
    },
    async commitClear(id) { await db.operations.update(id,{status:'pending',error:''}); },
    async record(transaction) {
      const member = transaction?.loyaltyCustomer;
      if (member?.provider !== 'club-esencia' || !member.actorId || !transaction.id) return null;
      const id = await clubRequestId(transaction.id);
      await db.transaction('rw', db.operations, async () => {
        const old = await db.operations.get(id);
        if (old) {
          if (review(transaction) && old.status !== 'review') await db.operations.update(id, { status: 'review', error: 'Venta devuelta: revisar los puntos del Club. No se han retirado automáticamente.' });
          return;
        }
        let error = '';
        try { clubAmountCents(transaction.total); } catch (e) { error = e.message; }
        if (review(transaction)) error = 'Venta devuelta: revisar los puntos del Club. No se han retirado automáticamente.';
        await db.operations.add({ id, transactionId: transaction.id, total: transaction.total,
          member: { id: member.id, name: member.name, provider: member.provider }, actorId: member.actorId,
          createdAt: transaction.createdAt || new Date().toISOString(), status: error ? 'review' : 'pending', error, attempts: 0 });
      });
      return id;
    },
    async recover(transactions) {
      for (const tx of transactions) await queue.record(tx);
      for (const tx of transactions.filter(t => t.type === 'refund' && t.parentId)) {
        await queue.markRefund(tx.parentId);
      }
    },
    async markRefund(transactionId) {
      const id = await clubRequestId(transactionId);
      await db.operations.update(id, { status: 'review', error: 'Venta devuelta: revisar los puntos del Club. No se han retirado automáticamente.' });
    },
    list() { return db.operations.orderBy('createdAt').reverse().toArray(); },
    flush() {
      if (running) return running;
      const work = async () => {
        if (!canSend()) return;
        const actor = await actorId();
        if (!actor) return;
        for (const op of await db.operations.where('status').equals('pending').toArray()) {
          if (!canSend() || await actorId() !== actor) break;
          if (actor !== op.actorId) continue;
          let status = 'pending', error = '', points;
          try {
            // Read the authoritative TPV sale before EVERY attempt; never award
            // an unconfirmed checkout or blindly trust a stale local queue row.
            if(op.kind==='promo-clear') {
              await integration.finishPromoClear(op.promotion,op.transactionId,op.delivered);status='confirmed';
            } else if(op.kind==='clear') {
              const result=await integration.awardClearedTicket({id:op.transactionId,total:op.total},op.member);
              status='confirmed';points=result.points;
            } else {
            const sale = await loadSale(op.transactionId);
            if (!sale) throw new Error('No se pudo verificar la venta. Se conserva pendiente.');
            if (review(sale)) { status = 'review'; throw new Error('Venta devuelta: revisar los puntos del Club.'); }
            if (sale.loyaltyCustomer?.id !== op.member.id || sale.loyaltyCustomer?.provider !== 'club-esencia'
              || sale.loyaltyCustomer?.actorId !== op.actorId || sale.total !== op.total) {
              status = 'review'; throw new Error('Los datos de la venta han cambiado. Revisar antes de asignar puntos.');
            }
            if (!canSend() || await actorId() !== actor) break;
            const result = await integration.awardConfirmedSale(sale, op.member);
            status = 'confirmed'; points = result.points;
            }
          } catch (e) { error = e.message; }
          await db.transaction('rw', db.operations, async () => {
            const latest = await db.operations.get(op.id);
            // A refund discovered while the network request was in flight wins.
            if (latest?.status !== 'pending') return;
            await db.operations.update(op.id, { status, error, points, attempts: latest.attempts + 1, attemptedAt: new Date().toISOString() });
          });
        }
      };
      running = (globalThis.navigator?.locks
        ? navigator.locks.request(`${name}:flush`, work) : work()).finally(() => { running = null; });
      return running;
    },
  };
  return queue;
}



