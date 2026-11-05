import test from 'node:test';import assert from 'node:assert/strict';
import {kitchenSelectionError,selectKitchenFinish,kitchenSnapshot,kitchenRule,isLinkedKitchenOption} from '../src/kitchenCatalog.js';
const item={id:'cinnamon-roll',name:'Cinnamon Roll'},ids=kitchenRule(item).optionIds;
test('linked option IDs remain stable when the catalogue sorts or renames them',()=>{
  assert.ok(ids.every(id=>isLinkedKitchenOption(kitchenRule(item).groupId,id)));
  assert.equal(isLinkedKitchenOption('another-group',ids[0]),false);
  assert.equal(isLinkedKitchenOption(kitchenRule(item).groupId,'new-option'),false);
});
test('requires exactly one finish without changing the item or the selected-options ticket contract',()=>{
  assert.ok(kitchenSelectionError(item,[]));assert.ok(kitchenSelectionError(item,ids.slice(0,2).map(id=>({id,qty:1}))));
  assert.ok(kitchenSelectionError(item,[{id:ids[0],qty:2}]));assert.equal(kitchenSelectionError(item,[{id:ids[0],name:'Clasico',price:0,qty:1}]),'');
  assert.equal(kitchenSelectionError({id:'cafe'},[]),'');
});
test('selecting another finish replaces the selection and cannot toggle the selected finish off',()=>{
  const q=selectKitchenFinish(item,ids[1],{[ids[0]]:1});assert.equal(q[ids[0]],0);assert.equal(q[ids[1]],1);
  assert.deepEqual(selectKitchenFinish(item,ids[1],q),q);
});
test('no projection or incomplete projection is unknown, and each finish resolves independently',()=>{
  const options=[{id:ids[1],qty:1}];assert.equal(kitchenSnapshot(item,options).allergens.status,'pending');
  const linked={...item,kitchen:{schemaVersion:1,itemId:item.id,specRevision:2,documentRevision:7,variants:[{optionIds:[ids[1]],allergens:{contains:['Leche','Frutos de cáscara'],traces:[],status:'reviewed'}}]}};
  assert.equal(kitchenSnapshot(linked,options).allergens.status,'reviewed');assert.equal(kitchenSnapshot(linked,[{id:ids[0],qty:1}]).allergens.status,'pending');
});
