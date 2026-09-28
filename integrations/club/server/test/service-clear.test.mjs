import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';
import {createTpvBridge} from '../service.mjs';import {provisionEmployee,cashierPermissions} from '../auth.mjs';
import {promotionSnapshot,applyPromotion,promotionDiscount} from '../../../../src/clubPromotionMath.js';

test('PIN-authenticated bridge reserves a web topping on a zero-base item and clears once with points and voucher resolution',async()=>{
 const db=new PGlite();
 try{
  await db.exec("create table public.staff_profiles(id text primary key,display_name text,role text,pin_code text,active boolean);insert into staff_profiles values('staff','Empleado','staff','5678',true);create table public.sales(id text primary key);");
  for(const name of ['outbox.sql','tpv-schema.sql'])await db.exec(await readFile(new URL('../'+name,import.meta.url),'utf8'));
  await db.exec('create table tpv_bridge_private.login_limit(id boolean primary key,attempts integer default 0,window_start timestamptz default now());insert into tpv_bridge_private.login_limit(id) values(true);');
  await provisionEmployee(db,'staff',cashierPermissions);
  const member=randomUUID(),reward=randomUUID(),voucher=randomUUID(),rule={version:2,benefit:{type:'free_topping'}},sent=[];
  const service=createTpvBridge({db,sourceProject:'test',loadCatalog:async()=>({items:[{id:'pancakes',price:3.5,options:[{id:'almond',price:1.5}]}]}),finalizeFiscal:()=>{throw Error('No sale expected');},send:async raw=>{
   const e=JSON.parse(raw);sent.push(e);
   const result=e.action==='member.offers'?{rewards:[{id:reward,title:'Topping gratis',version:1,cost:500,rule}],pending:[{id:voucher,reward_id:reward,cost:500,status:'pending'}]}:e.action==='redemption.reserve'?{reservation_id:randomUUID(),rule}:{ok:true};
   return {status:200,body:{operation_id:e.operation_id,state:'applied',result}};
  }});
  const session=await service.call({p_action:'login',p_payload:{staffId:'staff',pin:'5678'}});
  const call=(action,payload)=>service.call({p_device:session.device,p_session:session.token,p_action:action,p_payload:payload});
  const item={id:'pancakes',ticketItemId:'line',name:'MiniPancakes',price:0,qty:1,selectedOptions:[{id:'almond',price:1.5,qty:1}]};
  for(const delivered of [true,false]){
   const cart='cart-'+delivered,id='application-'+delivered;
   const request={reservation_id:id,cart_id:cart,member_id:member,reward_id:reward,redemption_id:voucher,ruleVersion:1,line_id:'line',option_id:'almond',snapshot:promotionSnapshot(item)};
   const promotion=await call('promo_reserve',request);
   assert.deepEqual(await call('promo_reserve',request),promotion);
   const [line]=applyPromotion([item],'line',promotion);assert.equal(promotionDiscount(line),1.5);assert.equal(line.qty,1);
   const clear={id:'CLEAR-'+cart,cart_id:cart,member_id:member,amount:0,promotions:[{id}],delivered};
   await call('prepare_clear',clear);await call('prepare_clear',clear);
   await call('clear_ticket',clear);await call('clear_ticket',clear);
   await call('promo_clear',{id,clear_id:clear.id});await call('clear_award',{event_id:clear.id,member_id:member});
   assert.equal((await db.query('select state from tpv_bridge_private.clear_events where id=$1',[clear.id])).rows[0].state,'committed');
  }
  const plain={id:'CLEAR-plain',cart_id:'plain',member_id:member,amount:300,promotions:[],delivered:null};
  await call('prepare_clear',plain);await call('clear_ticket',plain);await call('clear_ticket',plain);await call('clear_award',{event_id:plain.id,member_id:member});
  assert.equal(sent.filter(e=>e.action==='redemption.reserve').length,2);
  assert.ok(sent.filter(e=>e.action==='redemption.reserve').every(e=>e.payload.redemption_id===voucher));
  assert.equal(sent.filter(e=>e.action==='redemption.commit').length,1);assert.equal(sent.filter(e=>e.action==='redemption.release').length,1);
  assert.deepEqual(sent.filter(e=>e.action==='award.clear').map(e=>e.payload.amount),[0,0,300]);
  assert.ok(sent.every(e=>e.employee_id==='staff'));
 }finally{await db.close();}
});
