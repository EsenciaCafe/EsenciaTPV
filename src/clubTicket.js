// Per-ticket identity: survives closing the payment modal, never a global customer.
import {clubServerEnabled,serverClubAction} from './clubServerTransport.js';
export function clubTicket(store) { return store.getSelectedTable() || store.state.directSaleTicket; }
export function clubTicketOptions(store) {
  const ticket=clubTicket(store),tableId=store.state.selectedTableId;
  ticket.clubContext ||= {id:crypto.randomUUID(),member:null};
  const cartId=ticket.clubContext.id;
  return {
    initial: ticket.clubContext?.member || null,
    onSelection(member) {
      // Persistence/realtime replace table objects. Resolve the live account on
      // each update, but never let a late QR attach to a different/new account.
      const ticket=clubTicket(store);
      if(store.state.selectedTableId!==tableId||ticket.clubContext?.id!==cartId)return false;
      if(store.getActiveItems().some(i=>i.clubPromotion) && (!member || member.id!==ticket.clubContext?.member?.id))return false;
      if (member) ticket.clubContext={ id:ticket.clubContext?.id || crypto.randomUUID(), member };
      else if(ticket.clubContext) ticket.clubContext.member=null;
      store.notify();
    },
  };
}
export async function clearClubTicket(store, queue, actor) {
  const ticket=clubTicket(store), context=ticket.clubContext;
  if(context?.member&&context.member.actorId!==actor)throw new Error('Identifica de nuevo al socio con el empleado actual.');
  const promoIntents=await store.clubPromotionAdapter?.beforeClear() || [];
  let serverClear;
  if(clubServerEnabled && (context?.member || store.getActiveItems().some(i=>i.clubPromotion))){
    const promos=store.getActiveItems().filter(i=>i.clubPromotion).map(i=>i.clubPromotion);
    const op=promoIntents[0]?await queue.db.operations.get(promoIntents[0]):null;
    const cartId=context?.id||crypto.randomUUID();
    serverClear={id:`CLEAR-${cartId}`,cart_id:cartId,member_id:context?.member?.id||null,amount:Math.round(store.getActiveTicketTotal()*100),promotions:promos,delivered:op?.delivered??null};
    await serverClubAction('prepare_clear',serverClear);
  }
  let id;
  if (context?.member && store.getActiveItems().length) {
    if(!queue)throw new Error('No se pudieron guardar los puntos del vaciado.');
    if(context.member.actorId!==actor)throw new Error('Identifica de nuevo al socio con el empleado actual.');
    id=await queue.prepareClear({id:`CLEAR-${context.id}`,total:Number(store.getActiveTicketTotal().toFixed(2)),loyaltyCustomer:context.member});
  }
  const result=await store.clearActiveTicket();
  if(!result)throw new Error('No se pudo vaciar la cuenta.');
  if(serverClear)await serverClubAction('clear_ticket',serverClear).catch(()=>{/* The committed local queue retries the prepared server event after a lost response. */});
  // The store also clears clubContext from the new/empty ticket. Never reuse identity.
  delete ticket.clubContext;
  try{await store.clubPromotionAdapter?.afterClear(promoIntents);}catch{return {pointsQueued:false,review:true};}
  if(id){try{await queue.commitClear(id);}catch{return {pointsQueued:false,review:true};}void queue.flush().catch(()=>{});}
  return {pointsQueued:!!id};
}


