import test from 'node:test';
import assert from 'node:assert/strict';
import {clubTicketOptions,clearClubTicket} from '../src/clubTicket.js';

const member={id:'member',name:'Ana',provider:'club-esencia',actorId:'employee'};
function fixture(table=true){
 const s={state:{selectedTableId:table?1:null,tables:[{id:1,items:[{qty:1,price:4.6}]},{id:2,items:[]}],directSaleTicket:{items:[{qty:1,price:4.6}]}},
 getSelectedTable(){return this.state.tables.find(t=>t.id===this.state.selectedTableId)||null;},
 getActiveItems(){return (this.getSelectedTable()||this.state.directSaleTicket).items;},getActiveTicketTotal:()=>4.6,
 // TPV notify/persistence and realtime replace table objects.
 notify(){this.state.tables=this.state.tables.map(t=>structuredClone(t));},
 async clearActiveTicket(){if(this.state.selectedTableId===null)this.state.directSaleTicket={items:[]};else this.state.tables=this.state.tables.map(t=>t.id===this.state.selectedTableId?{id:t.id,items:[]}:t);return true;}};
 return s;
}
test('identification survives table replacement and is shared with checkout and clear',async()=>{
 for(const table of [true,false]){
  const store=fixture(table),selector=clubTicketOptions(store);
  selector.onSelection(null);store.notify();selector.onSelection(member);
  assert.deepEqual(clubTicketOptions(store).initial,member);
  store.notify();const prepared=[];
  const queue={prepareClear:async tx=>{prepared.push(tx);return tx.id;},commitClear:async()=>{},flush:async()=>{}};
  const result=await clearClubTicket(store,queue,'employee');
  assert.equal(result.pointsQueued,true);assert.equal(prepared.length,1);assert.equal(prepared[0].total,4.6);assert.deepEqual(prepared[0].loyaltyCustomer,member);
  assert.equal(clubTicketOptions(store).initial,null);
 }
});
test('late identification cannot attach to another table or a newly cleared account',async()=>{
 const store=fixture(),selector=clubTicketOptions(store);selector.onSelection(null);
 store.state.selectedTableId=2;assert.equal(selector.onSelection(member),false);assert.equal(clubTicketOptions(store).initial,null);
 store.state.selectedTableId=1;await store.clearActiveTicket();assert.equal(selector.onSelection(member),false);assert.equal(clubTicketOptions(store).initial,null);
});
