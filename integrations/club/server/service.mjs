import {createHash,randomUUID} from 'node:crypto';
import {enqueue,createOutboxWorker} from './outbox.mjs';
import {createPinAuth} from './auth.mjs';
import {waitForOperation} from './operation-result.mjs';
import {benefitDiscount,validateBenefitRule} from './benefit.mjs';
import {allocateCartDiscount,cartPromotionPart} from '../../../src/clubCartPromotionMath.js';
import {promotionSnapshot,promotionDiscount} from '../../../src/clubPromotionMath.js';
const stable=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);
const hash=v=>createHash('sha256').update(stable(v)).digest('hex');
const amount=v=>{const n=Number(v),c=Math.round(n*100);if(!Number.isFinite(n)||c<0||!Number.isSafeInteger(c)||Math.abs(n*100-c)>0.00001)throw Error('Importe no válido.');return c;};
const uiRule=(r,version)=>r?(r.version===2?r:{scope:r.scope,targetIds:r.target_ids,includeExtras:r.include_extras,version,catalogVersion:r.catalog_version}):null;
const saleFingerprint=t=>hash({id:t.id,total:t.total,items:t.items,member:t.loyaltyCustomer?.id||null,paymentMethod:t.paymentMethod,payments:t.payments,tip:t.tipAmount||0});

// Restricted TPV backend. Callers supply only device/session and UI actions;
// source, employee, amount of a paid sale and catalog version are derived here.
export function createTpvBridge({db,send,sourceProject,loadCatalog,finalizeFiscal}){
 const auth=createPinAuth({db,sourceProject}),worker=createOutboxWorker({db,send:async raw=>{
  const e=JSON.parse(raw);
  const enabled=(await db.query('select 1 from tpv_bridge_private.employees e join public.staff_profiles s on s.id=e.staff_id where e.staff_id=$1 and e.active and s.active',[e.employee_id])).rows.length;
  if(!enabled)throw Object.assign(Error('El empleado necesita conciliación.'),{code:'EMPLOYEE_DISABLED',retryable:false});
  return send(raw);
 }});
 async function finishOperation(id){
  await worker.runOne(id);
  const row=await waitForOperation(db,id);
  if(row?.state==='applied')return row.response.result;
  const error=Error(row?.response?.error?.message||'Operación pendiente de confirmar. Reintenta sin crear otra operación.');
  error.code=row?.error_code||'RESULT_UNKNOWN';error.operationId=id;throw error;
 }
 async function perform(context,action,payload,options){const row=await enqueue(db,context,action,payload,options);return finishOperation(row.id);}
 async function catalogue(context){
  let cursor=null;const rewards=[],seen=new Set();
  do{const page=await perform(context,'reward.catalogue',{limit:100,cursor});
   for(const reward of page.rewards)if(!seen.has(reward.id)){seen.add(reward.id);rewards.push({...reward,rule:uiRule(reward.rule,reward.version)});}
   if(cursor&&cursor===page.next_cursor)throw Error('El catálogo no avanzó. Actualiza.');cursor=page.next_cursor;
  }while(cursor);
  return rewards;
 }
 async function syncApplication(row){
  if(row.state==='requested'){
   const op=(await db.query('select * from tpv_bridge_private.outbox where id=$1',[row.reserve_operation])).rows[0];
   if(op.state==='applied'){
    const result=op.response.result;
    if(stable(result.rule)!==stable(row.intent.rule))throw Error('La regla reservada ha cambiado. Requiere revisión.');
    const promotion=row.intent.input.scope==='cart'?{id:row.id,cartId:row.cart_id,memberId:row.member_id,title:row.intent.title,scope:'cart',...row.intent.allocation}:{id:row.id,cartId:row.cart_id,memberId:row.member_id,title:row.intent.title,snapshot:row.intent.snapshot,discountCents:row.intent.discountCents,...(row.intent.rule.version===2?{sourceLineId:row.intent.input.line_id,unitId:row.id,optionId:row.intent.input.option_id}: {})};
    await db.query("update tpv_bridge_private.applications set state='reserved',reservation_id=$2,promotion=$3 where id=$1 and state='requested'",[row.id,result.reservation_id,JSON.stringify(promotion)]);
   }else if(op.state==='rejected')await db.query("update tpv_bridge_private.applications set state='rejected' where id=$1 and state='requested'",[row.id]);
  }
  if(row.resolution_operation){const op=(await db.query('select state from tpv_bridge_private.outbox where id=$1',[row.resolution_operation])).rows[0];
   if(op?.state==='applied')await db.query("update tpv_bridge_private.applications set state=case when state='commit_pending' then 'committed' else 'released' end where id=$1 and state in ('commit_pending','release_pending')",[row.id]);
  }
  return (await db.query('select * from tpv_bridge_private.applications where id=$1',[row.id])).rows[0];
 }
 async function application(id){const row=(await db.query('select * from tpv_bridge_private.applications where id=$1',[id])).rows[0];if(!row)throw Error('Reserva no encontrada.');return syncApplication(row);}
 async function reserve(context,p){
  const prior=(await db.query('select * from tpv_bridge_private.applications where id=$1',[p.reservation_id])).rows[0];
  if(prior){
   if(prior.cart_id!==p.cart_id||prior.member_id!==p.member_id||stable(prior.intent.input)!==stable(p)||prior.context.employeeId!==context.employeeId||prior.context.terminalId!==context.terminalId)throw Error('La reserva corresponde a otra operación.');
   if(prior.state==='requested')await finishOperation(prior.reserve_operation);
   const current=await application(prior.id);if(current.state!=='reserved')throw Error('Reserva ya resuelta.');return current.promotion;
  }
  const offers=await perform(context,'member.offers',{member_id:p.member_id});
  const reward=offers.rewards.find(r=>r.id===p.reward_id),pending=offers.pending.find(r=>r.reward_id===p.reward_id&&!r.reserved);
  if(!reward||(!reward.eligible&&!pending)||reward.version!==p.ruleVersion)throw Error('La promoción ha cambiado o no está disponible.');
  const catalog=await loadCatalog(db);
  if(reward.rule.version!==2&&(reward.rule.version!==1||reward.rule.catalog_version!==catalog.version))throw Error('Actualiza la promoción para la versión actual de la carta.');
  let allocation,discount;
  if(p.scope==='cart'){
   if(reward.rule.version!==2||reward.rule.benefit?.type!=='discount')throw Error('Esta promoción no es un descuento de cuenta.');
   validateBenefitRule(reward.rule);
   if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>500||new Set(p.lines.map(l=>l.lineId)).size!==p.lines.length)throw Error('Cuenta no válida.');
   for(const line of p.lines){
    if(typeof line.lineId!=='string'||!line.lineId||!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>10000)throw Error('Cantidad no válida.');
    const item=catalog.items.find(i=>String(i.id)===line.snapshot.id);
    if(!item||amount(item.price)!==line.snapshot.price)throw Error('El precio del producto ha cambiado.');
    const ids=new Set();for(const o of line.snapshot.options){const option=(item.options||[]).find(x=>String(x.id)===o.id);
     if(!option||ids.has(o.id)||!Number.isInteger(o.qty)||o.qty<1||o.qty>100||amount(option.price)!==o.price)throw Error('Extras no válidos.');ids.add(o.id);
    }
   }
   allocation=allocateCartDiscount([...p.lines].sort((a,b)=>a.lineId.localeCompare(b.lineId)),reward.rule.benefit);discount=allocation.discountCents;
  }else{
  const item=catalog.items.find(i=>String(i.id)===p.snapshot.id);
  if(!item||amount(item.price)!==p.snapshot.price)throw Error('El precio del producto ha cambiado.');
  const ids=new Set();let extras=0;
  for(const o of p.snapshot.options){
   const option=(item.options||[]).find(x=>String(x.id)===o.id);
   if(!option||ids.has(o.id)||!Number.isInteger(o.qty)||o.qty<1||o.qty>100||amount(option.price)!==o.price)throw Error('Extras no válidos.');ids.add(o.id);extras+=o.price*o.qty;
  }
  if(reward.rule.version===2){
   if(typeof p.line_id!=='string'||!p.line_id)throw Error('Elige una unidad de la cuenta.');
   const topping=p.option_id===null?null:p.snapshot.options.find(o=>o.id===p.option_id);
   if(p.option_id!==null&&!topping)throw Error('El topping ya no está en la cuenta.');
   const unit=topping?topping.price:p.snapshot.price;
   if(unit<=0)throw Error('Elige una unidad con precio.');
   discount=benefitDiscount(reward.rule,{kind:topping?'topping':'item',unit_cents:unit});
  }
  else if(reward.rule.scope==='product'&&reward.rule.target_ids.includes(String(item.id)))discount=p.snapshot.price+(reward.rule.include_extras?extras:0);
  else if(reward.rule.scope==='topping'){
   const topping=p.snapshot.options.find(o=>o.id===p.option_id&&reward.rule.target_ids.includes(o.id));if(topping)discount=topping.price;
  }
  }
  if(!Number.isInteger(discount)||discount<0)throw Error('Producto o topping no válido para esta promoción.');
  const payload={member_id:p.member_id,reward_id:reward.id,expected_cost:pending?.cost??reward.cost,expected_version:reward.version,cart_id:p.cart_id,application_id:p.reservation_id,...(pending?{redemption_id:pending.id}:{})};
  let id;
  await db.transaction(async tx=>{
   const op=await enqueue(tx,context,'redemption.reserve',payload);id=op.id;
   const intent={input:p,rule:reward.rule,title:reward.title,snapshot:p.snapshot,discountCents:discount,...(allocation?{allocation}:{})};
   await tx.query('insert into tpv_bridge_private.applications(id,cart_id,member_id,context,intent,reserve_operation) values($1,$2,$3,$4,$5,$6)',[p.reservation_id,p.cart_id,p.member_id,JSON.stringify(context),JSON.stringify(intent),id]);
  });
  await finishOperation(id);return (await application(p.reservation_id)).promotion;
 }
 async function resolveApplication(tx,context,p,delivered,deliveryId){
  const row=(await tx.query('select * from tpv_bridge_private.applications where id=$1 for update',[p.id])).rows[0];
  if(!row||row.cart_id!==p.cart_id)throw Error('La reserva pertenece a otra cuenta.');
  const target=delivered?'commit_pending':'release_pending';
  if(row.state===target||row.state===(delivered?'committed':'released')){
   if(row.delivery_id!==deliveryId)throw Error('Reserva resuelta por otra operación.');return row.resolution_operation;
  }
  if(row.state!=='reserved')throw Error('Esta reserva ya está usada o requiere revisión.');
  const payload={reservation_id:row.reservation_id,application_id:row.id,...(delivered?{delivered_clear_id:deliveryId}:{cancel_event_id:deliveryId})};
  const op=await enqueue(tx,context,delivered?'redemption.commit':'redemption.release',payload);
  await tx.query('update tpv_bridge_private.applications set state=$2,delivery_id=$3,resolution_operation=$4 where id=$1',[row.id,target,deliveryId,op.id]);return op.id;
 }
 async function finalize(context,transaction){
  if(!transaction?.id||!Array.isArray(transaction.items)||!transaction.items.length)throw Error('Falta la cuenta.');
  const input=JSON.parse(JSON.stringify(transaction));input.staff={id:context.employeeId,name:context.name,role:context.role};
  if(input.type==='refund')return db.transaction(async tx=>{
   await tx.query('select pg_advisory_xact_lock(hashtext($1))',[`club-refund:${input.parentId}`]);
   const prior=(await tx.query('select payload from public.sales where id=$1',[input.id])).rows[0];
   if(prior){if(saleFingerprint(prior.payload)!==saleFingerprint(input))throw Error('La devolución ya existe con otros datos.');return finalizeFiscal(tx,input);}
   const parent=(await tx.query("select * from public.sales where id=$1 and type='sale' for update",[input.parentId])).rows[0];
   const refunded=Number((await tx.query("select coalesce(sum(-total_amount),0) total from public.sales where type='refund' and parent_sale_id=$1",[input.parentId])).rows[0].total);
   const refund=amount(-Number(input.total));
   if(!parent||refund>amount(Number(parent.total_amount)-refunded))throw Error('La devolución supera el importe pendiente.');
   const fiscal=await finalizeFiscal(tx,input);
   await tx.query("update public.sales set has_refund=true,refund_amount=$2,payload=payload||jsonb_build_object('hasRefund',true,'refundAmount',$2::numeric) where id=$1",[input.parentId,refunded+refund/100]);
   // No loyalty compensation: used rewards and points require explicit review.
   return fiscal;
  });
  const fingerprint=saleFingerprint(input),promos=input.items.filter(i=>i.clubPromotion);
  if(stable((input.clubPromotions||[]).map(p=>p.id).sort())!==stable(promos.map(i=>i.clubPromotion.id).sort()))throw Error('Promociones inconsistentes.');
  let net=0;
  for(const item of input.items){
   if(!Number.isInteger(item.qty)||item.qty<1)throw Error('Cantidad no válida.');
   const gross=(amount(item.price)+(item.selectedOptions||[]).reduce((n,o)=>{if(!Number.isInteger(o.qty)||o.qty<1)throw Error('Cantidad de extra no válida.');return n+amount(o.price)*o.qty;},0))*item.qty;
   const discount=item.clubPromotion?amount(promotionDiscount(item)):Math.round(gross*Number(item.discountPercent||0)/100);
   if(!Number.isInteger(discount)||discount<0||discount>gross||amount(item.total)!==gross-discount)throw Error('El importe de la línea no coincide.');net+=gross-discount;
  }
  if(net!==amount(input.total))throw Error('El total de la cuenta no coincide.');
  return db.transaction(async tx=>{
   await tx.query("select pg_advisory_xact_lock(hashtext($1))",[`club-sale:${input.id}`]);
   const old=(await tx.query('select * from tpv_bridge_private.completed_sales where sale_id=$1',[input.id])).rows[0];
   if(old){if(old.fingerprint!==fingerprint)throw Error('La venta ya se cerró con otros datos.');return finalizeFiscal(tx,input);}
   if((await tx.query('select id from public.sales where id=$1',[input.id])).rows.length)throw Error('Venta existente: revisa su asignación en Transacciones.');
   const used=new Set();
   for(const item of [...promos].sort((a,b)=>a.clubPromotion.id.localeCompare(b.clubPromotion.id))){
    const p=item.clubPromotion;
    if(used.has(p.id)){if(p.scope==='cart')continue;throw Error('Promoción repetida.');}used.add(p.id);
    const row=(await tx.query('select * from tpv_bridge_private.applications where id=$1 for update',[p.id])).rows[0];
    if(!row||row.state!=='reserved'||input.loyaltyCustomer?.id!==row.member_id)throw Error('Promoción no válida para esta cuenta.');
    if(row.promotion.scope==='cart'){
     const lines=row.promotion.lines;
     if(lines.length!==input.items.length)throw Error('La cuenta ha cambiado. Retira y confirma de nuevo el descuento.');
     for(const line of lines){const current=input.items.find(i=>i.ticketItemId===line.lineId);
      if(!current||current.qty!==line.qty||stable(current.clubPromotion)!==stable(cartPromotionPart(row.promotion,line))||stable(promotionSnapshot(current))!==stable(line.snapshot))throw Error('La cuenta ha cambiado. Retira y confirma de nuevo el descuento.');
     }
    }else if(stable(row.promotion)!==stable(p)||stable(p.snapshot)!==stable(promotionSnapshot(item)))throw Error('Promoción no válida para esta cuenta.');
    const op=await enqueue(tx,context,'redemption.commit',{reservation_id:row.reservation_id,application_id:row.id,sale_id:input.id});
    await tx.query("update tpv_bridge_private.applications set state='commit_pending',delivery_id=$2,resolution_operation=$3 where id=$1",[row.id,input.id,op.id]);
   }
   const fiscal=await finalizeFiscal(tx,input);if(!fiscal?.fiscal_number&&!fiscal?.fiscalNumber)throw Error('No se pudo fiscalizar la venta.');
   let award=null;
   if(input.loyaltyCustomer){const op=await enqueue(tx,context,'award.purchase',{sale_id:input.id,member_id:input.loyaltyCustomer.id,amount:net,expected_version:0});award=op.id;}
   await tx.query('insert into tpv_bridge_private.completed_sales values($1,$2,$3,$4)',[input.id,JSON.stringify(context),fingerprint,award]);return fiscal;
  });
 }
 async function clear(context,p,prepare=false){
  if(!p.id||!Array.isArray(p.promotions)||!Number.isInteger(p.amount)||p.amount<0)throw Error('Vaciado no válido.');
  await db.transaction(async tx=>{
   await tx.query('select pg_advisory_xact_lock(hashtext($1))',[`club-clear:${p.id}`]);
   const old=(await tx.query('select * from tpv_bridge_private.clear_events where id=$1',[p.id])).rows[0];
   if(old&&stable(old.payload)!==stable(p))throw Error('El vaciado ya se registró con otros datos.');
   if(prepare){if(!old)await tx.query('insert into tpv_bridge_private.clear_events(id,context,payload) values($1,$2,$3)',[p.id,JSON.stringify(context),JSON.stringify(p)]);return;}
   if(!old)throw Error('Falta preparar el vaciado.');if(old.state==='committed')return;
   if(old.context.employeeId!==context.employeeId)throw Error('El vaciado necesita revisión del empleado original.');
   for(const promo of [...p.promotions].sort((a,b)=>a.id.localeCompare(b.id))){if(typeof p.delivered!=='boolean')throw Error('Confirma si se entregaron las promociones.');await resolveApplication(tx,context,{id:promo.id,cart_id:p.cart_id},p.delivered,p.id);}
   const op=p.member_id?await enqueue(tx,context,'award.clear',{clear_event_id:p.id,member_id:p.member_id,amount:p.amount}):null;
   await tx.query("update tpv_bridge_private.clear_events set state='committed',award_operation=$2 where id=$1",[p.id,op?.id||null]);
  });return {ok:true};
 }
 const service={auth,worker,perform,catalogue,
  async call({p_device,p_session,p_action,p_payload={}}){
   if(p_action==='login')return auth.login(p_device,p_payload.pin,p_payload.staffId);
   const context=await auth.authorize(p_device,p_session,p_action,p_payload._expectedActor);
   const {_expectedActor,...p}=p_payload;
   if(p_action==='status')return {staffId:context.employeeId,actorId:context.actorId};
   if(p_action==='logout'){await auth.logout(p_session);return {ok:true};}
   if(p_action==='lookup'){
    const member=await perform(context,'member.lookup',{qr:p.qr});
    await db.query('insert into tpv_bridge_private.member_labels(id,name) values($1,$2) on conflict(id) do update set name=excluded.name,updated_at=now()',[member.id,member.name]);return member;
   }
   if(p_action==='promo_catalogue')return catalogue(context);
   if(p_action==='promo_save'){
    if(p.rule?.version===2){validateBenefitRule(p.rule);return perform(context,'reward.configure',{reward_id:p.id,expected_version:p.expected_version??0,title:p.title,description:p.description||'',cost:p.cost,active:p.active,rule:p.rule});}
    const catalog=await loadCatalog(db),ids=p.targetIds;
    if(!Array.isArray(ids)||ids.some(id=>p.scope==='product'?!catalog.items.some(i=>String(i.id)===id):!catalog.items.some(i=>(i.options||[]).some(o=>String(o.id)===id))))throw Error('Elige productos de la carta.');
    return perform(context,'reward.configure',{reward_id:p.id,expected_version:p.expected_version??0,title:p.title,description:p.description||'',cost:p.cost,active:p.active,rule:{version:1,catalog_version:catalog.version,scope:p.scope,target_ids:ids,include_extras:p.includeExtras}});
   }
   if(p_action==='promo_available'||p_action==='pending'){
    const member=p.member_id||p.memberId,offers=await perform(context,'member.offers',{member_id:member});
    if(p_action==='pending')return offers.pending.map(r=>({...r,member_id:member,title:offers.rewards.find(w=>w.id===r.reward_id)?.title||'Canje',status:r.status}));
    return offers.rewards.flatMap(r=>{const pending=offers.pending.find(p=>p.reward_id===r.id&&!p.reserved);return r.eligible||pending?[{...r,cost:pending?.cost??r.cost,pending:!!pending,rule:uiRule(r.rule,r.version)}]:[];});
   }
   if(p_action==='promo_reserve')return reserve(context,p);
   if(p_action==='promo_cart'||p_action==='promo_holds'){
    const rows=(await db.query("select * from tpv_bridge_private.applications where state in ('requested','reserved') and ($1::text is null or cart_id=$1)",[p_action==='promo_cart'?p.cart_id:null])).rows;
    const holds=[];for(const row of rows){const current=await syncApplication(row);if(current.state==='reserved')holds.push({...current.promotion,customer:current.member_id});}return holds;
   }
   if(p_action==='promo_validate'){
    const row=await application(p.id),part=row.promotion.scope==='cart'?row.promotion.lines.find(l=>l.lineId===p.line_id):row.promotion;if(!part||row.state!=='reserved'||row.cart_id!==p.cart_id||row.member_id!==p.member_id||stable(part.snapshot)!==stable(p.snapshot)||part.discountCents!==p.discountCents)throw Error('La reserva ha cambiado.');return {ok:true};
   }
   if(p_action==='promo_release'){
    const row=await application(p.id);let op;await db.transaction(async tx=>{op=await resolveApplication(tx,context,p,false,`remove:${row.id}`);});await finishOperation(op);await application(p.id);return {ok:true};
   }
   if(p_action==='finalize_sale')return finalize(context,p.transaction);
   if(p_action==='prepare_clear')return clear(context,p,true);
   if(p_action==='clear_ticket')return clear(context,p);
   if(p_action==='gift_points'){await perform(context,'award.courtesy',{event_id:p.event_id,member_id:p.member_id,points:p.points*100,reason:p.reason});return {ok:true};}
   if(p_action==='assignment'){
    const state=await perform(context,'assignment.get',{sale_id:p.sale_id}),a=state.assignment;
    const label=a?(await db.query('select name from tpv_bridge_private.member_labels where id=$1',[a.member_id])).rows[0]?.name:null;
    return {active:a?.active||false,name:label||a?.member_id||'',points:(a?.delta||0)/100,version:state.version,history:state.history.map(h=>({...h,action:h.reason==='assign'?'assign_sale':'withdraw_sale',at:h.created_at}))};
   }
   if(p_action==='withdraw_sale'){await perform(context,'assignment.withdraw',{sale_id:p.sale_id,expected_version:p.version,reason:p.reason});return {ok:true};}
   if(p_action==='purchase'||p_action==='assign_sale'){
    const sale=(await db.query('select s.*,c.award_operation from public.sales s left join tpv_bridge_private.completed_sales c on c.sale_id=s.id where s.id=$1',[p.sale_id])).rows[0];
    if(!sale||sale.type!=='sale'||sale.has_refund||Number(sale.refund_amount)>0)throw Error('La venta requiere revisión.');
    if(p_action==='purchase'){
     if(!sale.award_operation||sale.payload.loyaltyCustomer?.id!==p.member_id)throw Error('Revisa la asignación desde Transacciones.');await finishOperation(sale.award_operation);
    }else await perform(context,'award.purchase',{sale_id:p.sale_id,member_id:p.member_id,amount:amount(sale.total_amount),expected_version:p.version});
    return {ok:true};
   }
   if(p_action==='clear_award'){
    let row=(await db.query('select * from tpv_bridge_private.clear_events where id=$1',[p.event_id])).rows[0];
    if(row?.state==='prepared'){await clear(context,row.payload);row=(await db.query('select * from tpv_bridge_private.clear_events where id=$1',[p.event_id])).rows[0];}
    if(!row?.award_operation||row.payload.member_id!==p.member_id)throw Error('Vaciado no confirmado en el servidor.');await finishOperation(row.award_operation);return {ok:true};
   }
   if(p_action==='promo_clear'){
    const event=(await db.query('select * from tpv_bridge_private.clear_events where id=$1',[p.clear_id])).rows[0];if(event?.state==='prepared')await clear(context,event.payload);
    const row=await application(p.id);if(row.delivery_id!==p.clear_id)throw Error('Vaciado no confirmado en el servidor.');await finishOperation(row.resolution_operation);return {ok:true};
   }
   throw Error('Operación no disponible en este puente.');
  },
 };
 return service;
}

