const snapshotKey = s => JSON.stringify([s.id,s.price,(s.options||[]).map(o=>[o.id,o.price,o.qty]).sort((a,b)=>a[0].localeCompare(b[0]))]);
export const cents = value => Math.round(Number(value || 0) * 100);
export function promoTargets(items, rule) {
  if(!rule)return [];
  if(rule.benefit)return items.filter(i=>!i.clubPromotion&&!Number(i.discountPercent)&&i.qty>=1).flatMap(i=>rule.benefit.type==='free_topping'
    ?(i.selectedOptions||[]).filter(o=>Number(o.qty)>0&&cents(o.price)>0).map(o=>({lineId:i.ticketItemId,optionId:String(o.id),label:`${i.name} · ${o.name}`}))
    :(rule.benefit.type==='discount'?cents(i.price)+(i.selectedOptions||[]).reduce((total,o)=>total+cents(o.price)*Number(o.qty),0):cents(i.price))>0?[{lineId:i.ticketItemId,optionId:null,label:i.name+(i.selectedOptions?.length?' · '+i.selectedOptions.map(o=>`${o.qty} ${o.name}`).join(', '):'')+' · '+Number(i.price).toFixed(2)+' €'}]:[]);
  return items.filter(item => !item.clubPromotion && !Number(item.discountPercent) && item.qty >= 1)
    .flatMap(item => rule.scope === 'product'
      ? (rule.targetIds.map(String).includes(String(item.id)) ? [{lineId:item.ticketItemId,optionId:null,label:item.name}] : [])
      : (item.selectedOptions || []).filter(o=>Number(o.qty)>0 && rule.targetIds.map(String).includes(String(o.id)))
        .map(o=>({lineId:item.ticketItemId,optionId:String(o.id),label:`${item.name} · ${o.name}`})));
}
export function promotionSnapshot(item) {
  return {id:String(item.id),price:cents(item.price),options:(item.selectedOptions||[]).map(o=>({id:String(o.id),price:cents(o.price),qty:Number(o.qty)})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function applyPromotion(items, lineId, reservation) {
  const item=items.find(i=>i.ticketItemId===lineId);
  if(reservation.sourceLineId&&reservation.sourceLineId!==lineId)throw new Error('La reserva pertenece a otra línea de la cuenta.');
  if(!item || item.clubPromotion || Number(item.discountPercent) || item.qty<1)throw new Error('El artículo ha cambiado. Vuelve a elegirlo.');
  if(snapshotKey(promotionSnapshot(item))!==snapshotKey(reservation.snapshot))throw new Error('El precio o los extras han cambiado.');
  const copy=items.filter(i=>i.ticketItemId!==lineId);
  if(item.qty>1)copy.push({...item,qty:item.qty-1});
  copy.push({...item,ticketItemId:reservation.unitId||crypto.randomUUID(),qty:1,clubPromotion:reservation,discountReason:`Promoción Club · ${reservation.title}`});
  return copy;
}
export function promotionDiscount(item) {
  const promo=item.clubPromotion;
  if(!promo)return 0;
  if(promo.unitId&&item.ticketItemId!==promo.unitId)throw new Error('La promoción pertenece a otra unidad.');
  if(item.qty!==(promo.scope==='cart'?promo.quantity:1) || Number(item.discountPercent) || snapshotKey(promotionSnapshot(item))!==snapshotKey(promo.snapshot))throw new Error('Retira la promoción antes de cambiar ese artículo.');
  const gross=(cents(item.price)+(item.selectedOptions||[]).reduce((sum,o)=>sum+cents(o.price)*Number(o.qty),0))*item.qty;
  if(!Number.isInteger(promo.discountCents)||promo.discountCents<0||promo.discountCents>gross)throw new Error('Descuento de promoción no válido.');
  return promo.discountCents/100;
}
export function removePromotion(items, reservationId) {
  return items.map(i=>{if(i.clubPromotion?.id!==reservationId)return i;const {clubPromotion,discountReason,...plain}=i;return plain;});
}

