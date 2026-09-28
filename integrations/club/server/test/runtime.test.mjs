import test from 'node:test';
import assert from 'node:assert/strict';
import {postgresAdapter} from '../postgres.mjs';
import {mapCatalog} from '../catalog.mjs';
import {startWorkerLoop} from '../worker-loop.mjs';
import {createTpvHandler} from '../http.mjs';
import {Readable} from 'node:stream';

test('fiscal write and outbox use one connection; rollback releases it once',async()=>{
 for(const fail of [false,true]){
  const calls=[],releases=[];
  const client={query:async(sql)=>{calls.push(sql);if(sql==='outbox'&&fail)throw Error('offline');return {};},release:arg=>releases.push(arg)};
  const db=postgresAdapter({connect:async()=>client,query:()=>{throw Error('wrong connection');}});
  const action=()=>db.transaction(async tx=>{await tx.query('sale');await tx.query('outbox');return 7;});
  if(fail)await assert.rejects(action,/offline/);else assert.equal(await action(),7);
  assert.equal(calls.at(-1),fail?'ROLLBACK':'COMMIT');assert.equal(releases.length,1);
 }
});
test('broken rollback discards connection once',async()=>{
 const releases=[];const db=postgresAdapter({connect:async()=>({query:async sql=>{if(sql==='ROLLBACK')throw Error('lost');},release:v=>releases.push(v)})});
 await assert.rejects(()=>db.transaction(()=>{throw Error('original');}),/original/);assert.deepEqual(releases,[true]);
});
test('catalog accepts both existing modifier links, excludes unrelated extras',()=>{
 const c=mapCatalog([{id:'coffee',name:'Café',price:'4.6',modifiers:['milk']}],
  [{id:'milk'},{id:'cream',assigned_items:['coffee']},{id:'other'}],
  [{id:'m',modifier_id:'milk',price:'0.3'},{id:'c',modifier_id:'cream',price:'0.5'},{id:'x',modifier_id:'other',price:1}]);
 assert.deepEqual(c.items[0].options.map(o=>o.id),['c','m']);assert.equal(c.items[0].price,4.6);
});
test('worker stop awaits current delivery and starts no additional operation',async()=>{
 let release,calls=0;const waiting=new Promise(resolve=>release=resolve);
 const loop=startWorkerLoop({runOne:async()=>{calls++;await waiting;return {id:'one'};}});
 const stopping=loop.stop();release();await stopping;assert.equal(calls,1);
});
test('HTTP accepts only the configured web origin, including CORS preflight',async()=>{
 let calls=0;const handler=createTpvHandler({origin:'https://tpv.example',service:{call:async()=>{calls++;return {ok:true};}}});
 async function request(origin,method='POST'){
  const req=Readable.from([Buffer.from(JSON.stringify({p_action:'status',p_payload:{}}))]);
  Object.assign(req,{url:'/api/tpv/club',method,headers:{origin,'content-type':'application/json','x-tpv-request':'1','sec-fetch-site':'cross-site'}});
  const result={};await handler(req,{writeHead:(status,headers)=>Object.assign(result,{status,headers}),end:body=>result.body=body});return result;
 }
 assert.equal((await request('https://evil.example')).status,403);
 assert.equal((await request(undefined)).status,403);
 assert.equal((await request('https://tpv.example','OPTIONS')).status,204);
 assert.equal((await request('https://tpv.example')).status,200);assert.equal(calls,1);
});
