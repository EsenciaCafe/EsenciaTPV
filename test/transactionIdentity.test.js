import test from 'node:test';
import assert from 'node:assert/strict';
import {transactionIdentityRows} from '../src/transactionIdentity.js';

const tx = {staff:{name:'Isabel'},loyaltyCustomer:{name:'Ana'}};
test('receipt distinguishes cashier from employee assigning points, including reassignment', () => {
  assert.deepEqual(transactionIdentityRows(tx,{status:'ready',assignment:{active:true,name:'Bea',assignedBy:{name:'Joel'}}}),[
    ['Cobrado por','Isabel'],['Cliente Club','Bea'],['Puntos asignados por','Joel'],
  ]);
});
test('withdrawn assignment never falls back to the customer originally recorded in the sale', () => {
  assert.deepEqual(transactionIdentityRows(tx,{status:'ready',assignment:{active:false}}),[
    ['Cobrado por','Isabel'],['Cliente Club','Sin cliente asociado'],
  ]);
});
test('unavailable Club distinguishes historical identity from unverified current assignment', () => {
  assert.deepEqual(transactionIdentityRows(tx,{status:'error'}),[
    ['Cobrado por','Isabel'],['Cliente Club','No se pudo consultar la asignación actual'],['Cliente al cobrar','Ana'],
  ]);
  assert.equal(transactionIdentityRows({}, {status:'stored'})[0][1],'No registrado');
  assert.equal(transactionIdentityRows(tx,{status:'ready',assignment:{active:true,name:'Ana'}})[2][1],'No registrado');
});
