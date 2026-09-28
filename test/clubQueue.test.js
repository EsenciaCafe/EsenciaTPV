import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createClubQueue } from '../src/clubQueue.js';

const member = { provider:'club-esencia', id:'00000000-0000-4000-8000-000000000001', name:'Prueba', actorId:'staff-a' };
const sale = { id:'TX-queue', total:4.6, loyaltyCustomer:member };
test('durable Club queue survives restart, defers offline/other actor and never charges', async () => {
  const name = `test-club-${crypto.randomUUID()}`;
  let actor = 'staff-a', online = true, sends = 0, failure = true;
  const applied = new Set();
  const integration = { async awardConfirmedSale(tx) {
    sends++; applied.add(tx.id);
    if (failure) throw new Error('Lost response');
    return {points:4};
  } };
  const options = {name, integration, actorId:async()=>actor, loadSale:async()=>sale, canSend:()=>online};
  let q = createClubQueue(options);
  try {
    await q.record(sale); await q.flush();
    assert.equal((await q.list())[0].status, 'pending');
    q.db.close(); q = createClubQueue(options);
    online = false; await q.flush(); assert.equal(sends, 1);
    online = true; actor = 'staff-b'; await q.flush(); assert.equal(sends, 1);
    actor = 'staff-a'; failure = false;
    await Promise.all([q.flush(),q.flush()]);
    assert.equal(sends, 2); assert.equal(applied.size, 1);
    assert.equal((await q.list())[0].status, 'confirmed');
    await q.recover([sale]); await q.flush(); assert.equal(sends, 2);
  } finally { await q.db.delete(); }
});
test('Club queue checks authoritative sale, retains review across recovery and in-flight refund', async () => {
  let current = sale, called = 0, release;
  const q = createClubQueue({name:`test-club-${crypto.randomUUID()}`, actorId:async()=>member.actorId,
    loadSale:async()=>current, integration:{async awardConfirmedSale() {called++; await new Promise(r=>{release=r;}); return {points:4};}}});
  try {
    await q.record(sale);
    current = null; await q.flush(); assert.equal(called, 0);
    current = sale;
    const flush = q.flush();
    while (!release) await new Promise(r=>setTimeout(r,1));
    await q.markRefund(sale.id); release(); await flush;
    assert.equal((await q.list())[0].status,'review');
    await q.recover([sale]); await q.flush(); assert.equal(called,1);
  } finally {await q.db.delete();}
});
test('Club queue rejects altered or refunded sales before sending', async () => {
  for (const current of [{...sale,total:5},{...sale,hasRefund:true}]) {
    let sends=0;
    const q=createClubQueue({name:`test-club-${crypto.randomUUID()}`,actorId:async()=>member.actorId,loadSale:async()=>current,
      integration:{async awardConfirmedSale(){sends++;}}});
    try {await q.record(sale);await q.flush();assert.equal(sends,0);assert.equal((await q.list())[0].status,'review');}
    finally {await q.db.delete();}
  }
});

import { clearClubTicket, clubTicketOptions } from '../src/clubTicket.js';
test('clear intent is durable, never sent before a successful clear, and removes customer identity',async()=>{
 let sends=0,fail=true;const ticket={items:[1],clubContext:{id:'ticket-1',member}};
 const store={state:{directSaleTicket:ticket},getSelectedTable:()=>null,getActiveItems(){return this.state.directSaleTicket.items;},getActiveTicketTotal:()=>4.6,notify(){},
 async clearActiveTicket(){if(fail)throw new Error('Clear failed');this.state.directSaleTicket={items:[]};return true;}};
 const q=createClubQueue({name:`clear-${crypto.randomUUID()}`,actorId:async()=>member.actorId,loadSale:async()=>{throw new Error('Clear is not a sale');},integration:{async awardClearedTicket(){sends++;return {points:4};}}});
 try{
 await assert.rejects(clearClubTicket(store,q,member.actorId),/Clear failed/);await q.flush();assert.equal(sends,0);assert.equal((await q.list())[0].status,'prepared');assert.equal(ticket.clubContext.member.id,member.id);
 fail=false;await clearClubTicket(store,q,member.actorId);await q.flush();assert.equal(sends,1);assert.equal((await q.list())[0].status,'confirmed');
 assert.equal(store.state.directSaleTicket.clubContext,undefined);assert.equal(clubTicketOptions(store).initial,null);
 await q.flush();assert.equal(sends,1);
 }finally{await q.db.delete();}
});
