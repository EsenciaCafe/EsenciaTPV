import test from 'node:test';
import assert from 'node:assert/strict';
import {serverClubAction} from '../src/clubServerTransport.js';

test('clear and checkout use the same persistent Club session as PIN login, with legacy fallback',async()=>{
 const originals=Object.fromEntries(['localStorage','sessionStorage','location','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const persistent=new Map([['esencia-club-terminal-v1','test-terminal'],['esencia-club-pin-session-v1',JSON.stringify({token:'persistent-token',actorId:'staff-actor'})]]);
 const legacy=new Map([['esencia-club-pin-session-v1',JSON.stringify({token:'obsolete-token',actorId:'old-actor'})]]);
 const requests=[];
 try{
  for(const [key,value] of Object.entries({localStorage:{getItem:k=>persistent.get(k)||null},sessionStorage:{getItem:k=>legacy.get(k)||null},location:{origin:'http://localhost'},fetch:async(_url,init)=>{requests.push(JSON.parse(init.body));return {ok:true,json:async()=>({ok:true})};}}))Object.defineProperty(globalThis,key,{value,configurable:true});
  for(const action of ['prepare_clear','clear_ticket','finalize_sale'])await serverClubAction(action,{id:'operation'});
  for(const request of requests){assert.equal(request.p_session,'persistent-token');assert.equal(request.p_device,'test-terminal');assert.equal(request.p_payload._expectedActor,'staff-actor');}
  persistent.delete('esencia-club-pin-session-v1');
  await serverClubAction('prepare_clear',{});assert.equal(requests.at(-1).p_session,'obsolete-token');
 }finally{for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
