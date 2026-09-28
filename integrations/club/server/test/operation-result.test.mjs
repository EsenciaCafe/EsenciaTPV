import test from 'node:test';import assert from 'node:assert/strict';
import {waitForOperation} from '../operation-result.mjs';
test('waits for the existing worker lease without sending a second operation',async()=>{
 let reads=0,waits=0;const db={query:async(_sql,[id])=>{assert.equal(id,'same-id');return {rows:[++reads<3?{state:'sending'}:{state:'applied',response:{result:{ok:true}}}]};}};
 assert.equal((await waitForOperation(db,'same-id',{pause:async()=>{waits++;}})).state,'applied');assert.equal(waits,2);
});
test('pending failures and timeout stay unresolved, never become success',async()=>{
 for(const state of ['pending','rejected','sending'])assert.equal((await waitForOperation({query:async()=>({rows:[{state}]})},'id',{timeoutMs:0,pause:()=>{throw Error('unexpected wait');}})).state,state);
});
