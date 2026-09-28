import test from 'node:test';import assert from 'node:assert/strict';
import {validatePromotionPrices} from '../promotion-prices.mjs';
import {promoTargets,promotionSnapshot,applyPromotion,promotionDiscount} from '../../../../src/clubPromotionMath.js';
const item={id:'pancakes',ticketItemId:'line',name:'MiniPancakes',price:0,qty:1,selectedOptions:[{id:'almond',name:'Almendra Triturada',price:1.5,qty:1}]};
const catalog={items:[{id:'pancakes',price:3.5,options:[{id:'almond',price:1.5}]}]};
test('zero-price MiniPancakes accepts one free paid topping and keeps the made article',()=>{
 const snapshot=promotionSnapshot(item);validatePromotionPrices(catalog,snapshot);
 assert.equal(promoTargets([item],{version:2,benefit:{type:'free_topping'}})[0].optionId,'almond');
 const [applied]=applyPromotion([item],'line',{id:'r',sourceLineId:'line',unitId:'r',snapshot,discountCents:150});
 assert.equal(applied.id,'pancakes');assert.equal(applied.qty,1);assert.equal(applied.selectedOptions[0].qty,1);assert.equal(promotionDiscount(applied),1.5);
 assert.throws(()=>promotionDiscount({...applied,price:3.5}),/Retira/);
 assert.equal(promoTargets([item],{version:2,benefit:{type:'discount',mode:'percentage',basis_points:1000}}).length,1);
 assert.equal(promoTargets([item],{version:2,benefit:{type:'free_item'}}).length,0);
});
test('editable base prices do not permit invalid amounts or forged toppings',()=>{
 const snapshot=promotionSnapshot(item);
 for(const price of [-1,NaN,1.5,100000000])assert.throws(()=>validatePromotionPrices(catalog,{...snapshot,price}),/precio/);
 assert.throws(()=>validatePromotionPrices(catalog,{...snapshot,id:'missing'}),/carta/);
 for(const options of [[{id:'almond',price:999,qty:1}],[{id:'missing',price:150,qty:1}],[{id:'almond',price:150,qty:0}],snapshot.options.concat(snapshot.options)])assert.throws(()=>validatePromotionPrices(catalog,{...snapshot,options}),/topping/);
});
