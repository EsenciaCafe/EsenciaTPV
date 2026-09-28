import test from 'node:test';import assert from 'node:assert/strict';
import {promoTargets,promotionSnapshot,applyPromotion,promotionDiscount,removePromotion} from '../src/clubPromotionMath.js';
const item={id:'coffee',ticketItemId:'line',name:'Café',price:2,qty:3,selectedOptions:[{id:'cream',name:'Nata',price:.5,qty:2}]};
test('one free coffee preserves quantities, base price and paid extras',()=>{
 const reservation={id:'r',title:'Café gratis',discountCents:200,snapshot:promotionSnapshot(item)};
 const items=applyPromotion([item],'line',reservation);assert.equal(items.reduce((s,i)=>s+i.qty,0),3);assert.equal(items.length,2);
 const free=items.find(i=>i.clubPromotion);assert.equal(free.price,2);assert.equal(promotionDiscount(free),2);assert.equal(3-promotionDiscount(free),1);
 assert.equal(removePromotion(items,'r').some(i=>i.clubPromotion),false);
 assert.equal(promoTargets(items,{scope:'product',targetIds:['coffee']}).length,1);
});
test('one free topping discounts only one option; modified reserved lines fail closed',()=>{
 const items=applyPromotion([item],'line',{id:'r',title:'Nata gratis',discountCents:50,snapshot:promotionSnapshot(item)});
 const line=items.find(i=>i.clubPromotion);assert.equal(promotionDiscount(line),.5);assert.equal(line.selectedOptions[0].qty,2);
 assert.throws(()=>promotionDiscount({...line,qty:2}),/Retira/);
 assert.throws(()=>promotionDiscount({...line,price:9}),/Retira/);
 assert.throws(()=>applyPromotion(items,line.ticketItemId,line.clubPromotion),/cambiado/);
 assert.equal(promoTargets([item],{scope:'topping',targetIds:['cream']})[0].optionId,'cream');
});
