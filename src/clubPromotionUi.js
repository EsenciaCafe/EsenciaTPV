import {createClubDialog as modal,placeClubActions} from './clubDialog.js';
import {clubPinBridge} from './clubRuntime.js';
import {promoTargets} from './clubPromotionMath.js';
import {cartSnapshot,allocateCartDiscount} from './clubCartPromotionMath.js';
import {ensurePromoCart,applyClubOffer,installReservedPromo,removeClubOffer} from './clubPromotionRuntime.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function choosePromotionClear(){return new Promise(resolve=>{
 const d=modal('Promociones de la cuenta');let choice=null;
 d.querySelector('[data-body]').innerHTML='<p>¿Se han entregado los productos de las promociones de esta cuenta?</p><button data-yes>Sí, ya entregados: consumir promociones</button><button data-no>No entregados: liberar promociones</button><button data-back>Volver a la cuenta</button>';
 d.querySelector('[data-yes]').onclick=()=>{choice=true;d.close();};d.querySelector('[data-no]').onclick=()=>{choice=false;d.close();};d.querySelector('[data-back]').onclick=()=>d.close();
 d.addEventListener('close',()=>resolve(choice),{once:true});
});}
export function showCustomerPromotions({store,member,onApplied=()=>{}}){
 const d=modal(`Promociones de ${member.name}`),body=d.querySelector('[data-body]');
 body.innerHTML='<div data-offers></div><button type="button" data-done>Cerrar sin canjear</button>';
 body.querySelector('[data-done]').onclick=()=>d.close();
 placeClubActions(d);
 void mountAvailablePromotions(body.querySelector('[data-offers]'),{store,member,onApplied:async()=>{d.close();await onApplied();}});
 return ()=>{if(d.open)d.close();};
}
export async function mountAvailablePromotions(root,{store,member,onApplied=()=>{}}){
 if(!root)return;root.textContent='Consultando promociones…';
 try{
 const cart=ensurePromoCart(store);
 const [offers,holds]=await Promise.all([clubPinBridge.action('promo_available',{member_id:member.id}),clubPinBridge.action('promo_cart',{cart_id:cart.id})]);
 if(!root.isConnected||cart.member?.id!==member.id)return;
 const unapplied=holds.filter(h=>!store.getActiveItems().some(i=>i.clubPromotion?.id===h.id));
 root.innerHTML='<h4>Promociones disponibles</h4>'+(offers.length?offers.map(r=>`<button data-offer="${esc(r.id)}" ${promoTargets(store.getActiveItems(),r.rule).length?'':'disabled'}>${esc(r.title)} · ${r.pending?'Ya canjeada':r.cost/100+' puntos'}${promoTargets(store.getActiveItems(),r.rule).length?'':' · Añade un artículo válido'}</button>`).join(''):'<p>No hay más promociones disponibles para esta cuenta.</p>')+unapplied.map(h=>`<p>Reserva pendiente: ${esc(h.title)}</p><button data-recover="${esc(h.id)}">Recuperar descuento</button><button data-release="${esc(h.id)}">Liberar reserva</button>`).join('')+'<p data-status role="status"></p>';
 const status=root.querySelector('[data-status]');let busy=false;
 for(const button of root.querySelectorAll('[data-offer]')){
  const benefit=offers.find(r=>r.id===button.dataset.offer)?.rule?.benefit;if(!benefit)continue;
  const label=benefit.type==='free_item'?'Una unidad de artículo gratis; extras aparte':benefit.type==='free_topping'?'Una unidad de topping gratis':benefit.mode==='percentage'?`${benefit.basis_points/100} % de descuento en toda la cuenta`:`${(benefit.amount_cents/100).toFixed(2)} € de descuento en toda la cuenta`;
  button.setAttribute('aria-label',button.textContent);button.setAttribute('aria-description',label);const detail=document.createElement('small');detail.setAttribute('aria-hidden','true');detail.textContent=label;button.append(detail);
 }
 const run=fn=>async()=>{if(busy)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();await onApplied();await mountAvailablePromotions(root,{store,member,onApplied});}catch(e){status.textContent=e.message;root.querySelectorAll('button').forEach(b=>b.disabled=false);}finally{busy=false;}};
 for(const b of root.querySelectorAll('[data-offer]'))b.onclick=()=>{
  const reward=offers.find(r=>r.id===b.dataset.offer),targets=promoTargets(store.getActiveItems(),reward.rule);
  const d=modal(reward.title),body=d.querySelector('[data-body]');
  const description=`${reward.description?`<p class="club-conditions">${esc(reward.description)}</p>`:''}`;
  if(reward.rule?.benefit?.type==='discount'){
   let allocation;try{allocation=allocateCartDiscount(cartSnapshot(store.getActiveItems()),reward.rule.benefit);}catch(e){body.innerHTML=description+`<p>${esc(e.message)}</p><button data-cancel>Cancelar</button>`;body.querySelector('[data-cancel]').onclick=()=>d.close();placeClubActions(d);return;}
   const total=store.getActiveTicketTotal();const confirmed=JSON.stringify(cartSnapshot(store.getActiveItems()));
   body.innerHTML=description+`<p class="club-selection-hint">Aplicar a toda la cuenta, incluidos los extras.</p><div class="club-total-card"><div><span>Total actual</span><strong>${total.toFixed(2)} €</strong></div><div><span>Descuento</span><strong>−${(allocation.discountCents/100).toFixed(2)} €</strong></div><div><span>Total final</span><strong>${(total-allocation.discountCents/100).toFixed(2)} €</strong></div></div><button data-confirm>Aplicar descuento</button><button data-cancel>Cancelar</button>`;
   body.querySelector('[data-confirm]').onclick=()=>{d.close();void run(()=>{if(JSON.stringify(cartSnapshot(store.getActiveItems()))!==confirmed)throw Error('La cuenta ha cambiado. Vuelve a revisar el descuento.');return applyClubOffer(store,reward,{scope:'cart'});})();};
  }else{
   body.innerHTML=description+'<p class="club-selection-hint">Toca una unidad válida para esta promoción.</p><div class="ticket-discount-items" role="radiogroup" aria-label="Artículo o topping para esta promoción">'+targets.map((t,i)=>{
    const item=store.getActiveItems().find(item=>item.ticketItemId===t.lineId),option=item.selectedOptions?.find(o=>String(o.id)===t.optionId);
    const extras=item.selectedOptions?.length?item.selectedOptions.map(o=>`${o.name}${o.qty>1?' ×'+o.qty:''}`).join(' · '):'Sin modificadores';
    return `<label class="ticket-discount-item club-target"><input type="radio" name="club-target" data-target value="${i}"><span class="ticket-discount-item-copy"><strong>${esc(option?option.name:item.name)} <small>×${option?option.qty:item.qty}</small></strong><span class="ticket-discount-item-modifiers">${esc(option?item.name:extras)}</span><span class="ticket-discount-item-price">${Number(option?option.price:item.price).toFixed(2)} € · Se regala 1 unidad</span></span></label>`;
   }).join('')+'</div><p class="club-selection-hint">Si ninguno cumple las condiciones, pulsa Cancelar.</p><button data-confirm disabled>Aplicar</button><button data-cancel>Cancelar</button>';
   const confirm=body.querySelector('[data-confirm]');let selected=null;
   body.querySelectorAll('[data-target]').forEach(input=>input.onchange=()=>{selected=Number(input.value);confirm.disabled=false;});
   confirm.onclick=()=>{if(selected===null)return;d.close();void run(()=>applyClubOffer(store,reward,targets[selected]))();};
  }
  body.querySelector('[data-cancel]').onclick=()=>d.close();
  placeClubActions(d);
 };
 for(const b of root.querySelectorAll('[data-release]'))b.onclick=run(()=>removeClubOffer(store,b.dataset.release));
 for(const b of root.querySelectorAll('[data-recover]'))b.onclick=run(async()=>{
  const hold=holds.find(h=>h.id===b.dataset.recover);
  if(!window.confirm(`¿Confirmar la recuperación de «${hold.title}» en esta cuenta?`))return;
  if(hold.scope==='cart'){await installReservedPromo(store,hold);return;}
  const target=store.getActiveItems().find(i=>!i.clubPromotion&&(!hold.sourceLineId||i.ticketItemId===hold.sourceLineId)&&String(i.id)===hold.snapshot.id&&Number(i.price)*100===hold.snapshot.price);
  if(!target)throw new Error('El artículo ya no está en esta cuenta. Libera la reserva.');
  await installReservedPromo(store,hold,target.ticketItemId);
 });
 }catch(e){if(root.isConnected)root.textContent=e.message;}
}
