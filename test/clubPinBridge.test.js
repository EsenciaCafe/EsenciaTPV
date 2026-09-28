import test from 'node:test';
import assert from 'node:assert/strict';
import {createClubPinBridge} from '../src/clubPinBridge.js';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const key='esencia-club-pin-session-v1';
const session=()=>({token:'test-token',staffId:'staff-a',actorId:'actor-a',expiresAt:Date.now()+60000,device:'test-device'});
const client={rpc:async(_,p)=>({data:p.p_action==='login'?session():p.p_action==='status'?{actorId:'actor-a'}:{ok:true},error:null})};

test('Club survives reopening with TPV, migrates the old session once, and logout removes both copies',async()=>{
  const storage=memory(),devices=memory(),oldTab=memory();
  oldTab.setItem(key,JSON.stringify(session()));
  const bridge=createClubPinBridge(client,{storage,devices,legacyStorage:oldTab});
  assert.equal(bridge.actor(),'actor-a');assert.equal(oldTab.getItem(key),null);
  const reopened=createClubPinBridge(client,{storage,devices,legacyStorage:memory()});
  assert.equal(reopened.actor(),'actor-a');
  await reopened.logout();assert.equal(storage.getItem(key),null);
  assert.equal(createClubPinBridge(client,{storage,devices,legacyStorage:oldTab}).actor(),null);
});
test('ready waits for slow PIN login; errors are available without breaking the TPV login',async()=>{
  let release;const response=new Promise(resolve=>release=resolve);
  const bridge=createClubPinBridge({rpc:async(_,p)=>p.p_action==='login'?response:client.rpc(_,p)},{storage:memory(),devices:memory()});
  const login=bridge.login('1234','staff-a');let settled=false;
  const ready=bridge.ready().then(()=>{settled=true;});
  await Promise.resolve();assert.equal(settled,false);
  release({data:session()});assert.equal(await login,true);await ready;
  assert.equal(bridge.actor(),'actor-a');
  const failing=createClubPinBridge({rpc:async()=>({error:{message:'Terminal no autorizado.'}})},{storage:memory(),devices:memory()});
  assert.equal(await failing.login('1234','staff-a'),false);
  assert.equal(failing.loginError(),'Terminal no autorizado.');assert.equal(failing.actor(),null);
});
test('a delayed login cannot resurrect a logged-out employee and expired sessions stay unusable',async()=>{
  let release;const response=new Promise(resolve=>release=resolve);
  const storage=memory();
  const bridge=createClubPinBridge({rpc:async(_,p)=>p.p_action==='login'?response:client.rpc(_,p)},{storage,devices:memory()});
  const login=bridge.login('1234','staff-a');await bridge.logout();release({data:session()});
  assert.equal(await login,false);assert.equal(bridge.actor(),null);assert.equal(storage.getItem(key),null);
  storage.setItem(key,JSON.stringify({...session(),expiresAt:Date.now()-1}));
  assert.equal(createClubPinBridge(client,{storage,devices:memory()}).actor(),null);
});
test('replaces only an unknown legacy terminal credential and still validates the PIN',async()=>{
  for(const code of ['TERMINAL_UNKNOWN','TERMINAL_DISABLED']){
    const devices=memory();devices.setItem('esencia-club-terminal-v1','obsolete');let calls=0;
    const bridge=createClubPinBridge({rpc:async(_,p)=>{
      if(p.p_action!=='login')return client.rpc(_,p);
      calls++;assert.equal(p.p_payload.pin,'1234');
      return p.p_device==='obsolete'?{error:{code,message:'Terminal'}}:{data:session()};
    }},{storage:memory(),devices});
    assert.equal(await bridge.login('1234','staff-a'),code==='TERMINAL_UNKNOWN');
    assert.equal(calls,code==='TERMINAL_UNKNOWN'?2:1);
    if(code==='TERMINAL_DISABLED')assert.equal(devices.getItem('esencia-club-terminal-v1'),'obsolete');
  }
});
