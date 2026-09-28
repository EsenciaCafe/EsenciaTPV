import {clubActor,clubPinBridge,clubQueue,clubIntegration} from './clubRuntime.js';
import {clubTicket} from './clubTicket.js';
import {clubServerEnabled} from './clubServerTransport.js';
import {cartSnapshot,applyCartPromotion} from './clubCartPromotionMath.js';
import {applyPromotion,removePromotion,promotionSnapshot,promotionDiscount} from './clubPromotionMath.js';
export function ensurePromoCart(store){const ticket=clubTicket(store);ticket.clubContext ||= {id:crypto.randomUUID(),member:null};return ticket.clubContext;}
async function refreshMember(store,context){
 if(!context.member?.qr)return;
 try{const member=await clubIntegration.identify(context.member.qr);if(clubTicket(store).clubContext===context){context.member={...context.member,...member};store.notify();}}catch{/* A refresh failure must not undo a confirmed reservation. */}
}
export async function applyClubOffer(store,reward,target){
 const context=ensurePromoCart(store),item=store.getActiveItems().find(i=>i.ticketItemId===target.lineId);
 if(!context.member || (!item&&target.scope!=='cart'))throw new Error('Identifica al cliente y elige un artículo de la cuenta.');
 const key=`club-promo-intent:${context.id}:${reward.id}`;
 let intent=JSON.parse(localStorage.getItem(key)||'null');
 if(!intent){intent={reservation_id:crypto.randomUUID(),reward_id:reward.id,member_id:context.member.id,cart_id:context.id,ruleVersion:reward.version??reward.rule.version,...(target.scope==='cart'?{scope:'cart',lines:cartSnapshot(store.getActiveItems())}:{...(reward.rule.benefit?{line_id:target.lineId}:{}),option_id:target.optionId,snapshot:promotionSnapshot(item)})};localStorage.setItem(key,JSON.stringify(intent));}
 const reservation=await clubPinBridge.action('promo_reserve',intent);
 await installReservedPromo(store,reservation,target.lineId);
 localStorage.removeItem(key);
 await refreshMember(store,context);
}
export async function installReservedPromo(store,reservation,lineId){
 const context=ensurePromoCart(store);
 if(context.id!==reservation.cartId||context.member?.id!==reservation.memberId)throw new Error('La cuenta o el cliente han cambiado. La reserva se conserva para revisión.');
 const ticket=clubTicket(store);ticket.items=reservation.scope==='cart'?applyCartPromotion(store.getActiveItems(),reservation):applyPromotion(store.getActiveItems(),lineId,reservation);store.notify();
}
export async function removeClubOffer(store,id){
 const item=store.getActiveItems().find(i=>i.clubPromotion?.id===id),context=ensurePromoCart(store);
 await clubPinBridge.action('promo_release',{id,cart_id:context.id});
 if(item){clubTicket(store).items=removePromotion(store.getActiveItems(),id);store.notify();}
 await refreshMember(store,context);
}
export function initializePromotionFlow(store,{chooseClear}){
 store.clubPromotionAdapter={
  async beforePay(items){
   const context=ensurePromoCart(store);if(!await clubActor())throw new Error('Entra con tu PIN para validar las promociones.');
   for(const item of items.filter(i=>i.clubPromotion)){
    promotionDiscount(item);const p=item.clubPromotion;
    if(context.id!==p.cartId||context.member?.id!==p.memberId)throw new Error('La promoción pertenece a otro cliente o cuenta. Retírala.');
    await clubPinBridge.action('promo_validate',{id:p.id,cart_id:p.cartId,member_id:p.memberId,snapshot:promotionSnapshot(item),discountCents:p.discountCents,...(p.scope==='cart'?{line_id:item.ticketItemId}: {})});
   }
  },
  async afterPay(){/* The database consumes reservations atomically with the sale. */},
  async beforeClear(){
   const promos=store.getActiveItems().filter(i=>i.clubPromotion).map(i=>i.clubPromotion);if(!promos.length)return [];
   const delivered=await chooseClear(promos);if(delivered===null)throw new Error('Vaciado cancelado.');
   const actor=await clubActor();if(!actor||!clubQueue)throw new Error('Entra con tu PIN para resolver las promociones.');
   const eventId=`${clubServerEnabled?'CLEAR':'PROMOCLEAR'}-${ensurePromoCart(store).id}`;const ids=[];
   for(const promotion of promos)ids.push(await clubQueue.preparePromotionClear({promotion,actorId:actor,eventId,delivered}));
   return ids;
  },
  async afterClear(ids){for(const id of ids)await clubQueue.commitClear(id);void clubQueue.flush().catch(()=>{});},
 };
}
