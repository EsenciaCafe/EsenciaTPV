import {promotionSnapshot} from './clubPromotionMath.js';
export function cartSnapshot(items){
 if(!items.length||items.some(i=>i.clubPromotion||Number(i.discountPercent)||!Number.isSafeInteger(i.qty)||i.qty<1))throw Error('Retira los descuentos existentes antes de aplicar una promoción a toda la cuenta.');
 const lines=items.map(i=>({lineId:i.ticketItemId,qty:i.qty,snapshot:promotionSnapshot(i)})).sort((a,b)=>a.lineId.localeCompare(b.lineId));
 if(new Set(lines.map(l=>l.lineId)).size!==lines.length)throw Error('Líneas repetidas.');return lines;
}
export function allocateCartDiscount(lines,benefit){
 const gross=lines.map(l=>(l.snapshot.price+l.snapshot.options.reduce((n,o)=>n+o.price*o.qty,0))*l.qty);
 const total=gross.reduce((n,v)=>n+v,0);
 if(!Number.isSafeInteger(total)||total<=0||total>99999999||gross.some(v=>!Number.isSafeInteger(v)||v<0))throw Error('Importe de cuenta no válido.');
 const discount=benefit.mode==='percentage'?Math.floor((total*benefit.basis_points+5000)/10000):Math.min(total,benefit.amount_cents);
 const parts=gross.map((g,index)=>{const product=BigInt(discount)*BigInt(g);return {index,cents:Number(product/BigInt(total)),remainder:Number(product%BigInt(total))};});
 let left=discount-parts.reduce((n,p)=>n+p.cents,0);
 for(const p of [...parts].sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(left--<=0)break;p.cents++;}
 return {discountCents:discount,lines:lines.map((l,i)=>({...l,discountCents:parts[i].cents}))};
}
export function cartPromotionPart(p,l){return {id:p.id,cartId:p.cartId,memberId:p.memberId,title:p.title,scope:'cart',unitId:l.lineId,quantity:l.qty,snapshot:l.snapshot,discountCents:l.discountCents,totalDiscountCents:p.discountCents};}
export function applyCartPromotion(items,p){
 const current=cartSnapshot(items),expected=p.lines.map(({discountCents,...line})=>line);
 const key=lines=>JSON.stringify(lines.map(l=>[l.lineId,l.qty,l.snapshot.id,l.snapshot.price,l.snapshot.options.map(o=>[o.id,o.price,o.qty]).sort((a,b)=>a[0].localeCompare(b[0]))]).sort((a,b)=>a[0].localeCompare(b[0])));
 if(key(current)!==key(expected))throw Error('La cuenta ha cambiado. Libera la reserva y vuelve a confirmar el descuento.');
 return items.map(i=>({...i,clubPromotion:cartPromotionPart(p,p.lines.find(l=>l.lineId===i.ticketItemId)),discountReason:`Promoción Club · ${p.title}`}));
}
