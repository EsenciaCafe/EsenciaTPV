import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID as id} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pendingOffers} from '../pending-offers.mjs';

test('TPV lists only unused, unreserved web vouchers, never rewards purchasable with the balance',()=>{
  const rewards=[{id:'coffee',eligible:true,rule:{version:2}},{id:'topping',eligible:false,rule:{version:2}}];
  assert.deepEqual(pendingOffers({rewards,pending:[]}),[]);
  const offers=pendingOffers({rewards,pending:[
    {id:'used',reward_id:'coffee',status:'used'},
    {id:'held',reward_id:'coffee',status:'pending',reserved:true},
    {id:'web',reward_id:'topping',status:'pending',reserved:false,cost:500},
  ]});
  assert.equal(offers.length,1);assert.equal(offers[0].redemption_id,'web');
  assert.equal(offers[0].pending,true);
});

test('real Club SQL reserves/releases without touching points, consumes once, and rejects new TPV purchases',async()=>{
  const db=new PGlite(),staff=id(),member=id(),reward=id(),voucher=id();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create table auth.users(id uuid primary key);
      create table customers(auth_user_id uuid,role text);
      create table club_members(id uuid primary key,name text,code bigint,qr_token uuid,balance integer,legal_version text);
      create table club_rewards(id uuid primary key,title text,description text,cost integer,active boolean);
      create table club_settings(id boolean,legal_version text);
      create table club_redemptions(id uuid primary key default gen_random_uuid(),member_id uuid,reward_id uuid,title text,cost integer,status text default 'pending',resolved_by uuid,resolved_at timestamptz,created_at timestamptz default now());
      create table club_ledger(id uuid primary key default gen_random_uuid(),member_id uuid,delta integer,kind text,label text,created_by uuid,amount numeric,
        constraint club_ledger_delta_check check(delta<>0),constraint club_ledger_kind_check check(kind in ('redeem','refund','purchase')));
      create schema club_private;create table club_private.reward_benefits(reward_id uuid,rule jsonb);
      insert into auth.users values('${staff}');insert into customers values('${staff}','admin');
      insert into club_settings values(true,'legal-v1');
      insert into club_members values('${member}','Ana',1,gen_random_uuid(),1500,'legal-v1');
      insert into club_rewards values('${reward}','Café gratis','Un café',500,true);
      insert into club_redemptions(id,member_id,reward_id,title,cost) values('${voucher}','${member}','${reward}','Café gratis',500);
      insert into club_ledger(member_id,delta,kind,label) values('${member}',-500,'redeem','Canje web');`);
    const dir=new URL('../../fidelity/migrations/',import.meta.url);
    await db.exec(await readFile(new URL('20260928212145_fidelity_club_bridge_reference.sql',dir),'utf8'));
    await db.exec(await readFile(new URL('20260928231119_club_require_web_redemption.sql',dir),'utf8'));
    await db.query("insert into club_bridge_private.sources values('tpv',true)");
    await db.query("insert into club_bridge_private.employees values('tpv','cashier',$1,true,$2)",[staff,['member.offers','redemption.reserve','redemption.release','redemption.commit']]);
    await db.query("insert into club_bridge_private.rules values($1,'tpv',$2)",[reward,JSON.stringify({version:2,benefit:{type:'free_item'}})]);
    const envelope=(action,payload)=>({version:1,operation_id:id(),source_project:'tpv',terminal_id:'terminal',employee_id:'cashier',action,business_key:id(),payload});
    const send=async e=>(await db.query('select public.club_bridge_dispatch($1,$2,$3) result',[e,id(),new Date(Date.now()+60000).toISOString()])).rows[0].result;
    const offers=async()=>pendingOffers((await send(envelope('member.offers',{member_id:member}))).result);
    const payload=()=>({member_id:member,reward_id:reward,expected_cost:500,expected_version:1,cart_id:id(),application_id:id(),redemption_id:voucher});
    assert.equal((await offers()).length,1);
    const purchase=payload();delete purchase.redemption_id;
    assert.equal((await send(envelope('redemption.reserve',purchase))).error.code,'WEB_REDEMPTION_REQUIRED');
    const first=payload(),held=await send(envelope('redemption.reserve',first));
    assert.equal(held.state,'applied');assert.equal((await offers()).length,0);
    assert.equal((await send(envelope('redemption.reserve',payload()))).error.code,'ALREADY_RESERVED');
    await send(envelope('redemption.release',{reservation_id:held.result.reservation_id,application_id:first.application_id,cancel_event_id:id()}));
    assert.equal((await offers()).length,1);
    const second=payload(),reserved=await send(envelope('redemption.reserve',second));
    const delivery=envelope('redemption.commit',{reservation_id:reserved.result.reservation_id,application_id:second.application_id,sale_id:'paid-ticket'});
    const committed=await send(delivery);assert.equal(committed.state,'applied');
    assert.deepEqual(await send(delivery),committed);
    assert.equal((await offers()).length,0);
    assert.equal((await send(envelope('redemption.reserve',payload()))).error.code,'REDEMPTION_UNAVAILABLE');
    assert.equal((await db.query('select status from club_redemptions where id=$1',[voucher])).rows[0].status,'used');
    assert.equal((await db.query('select balance from club_members')).rows[0].balance,1500);
    assert.equal((await db.query('select count(*)::integer n from club_ledger')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::integer n from club_redemptions')).rows[0].n,1);
  } finally {await db.close();}
});
