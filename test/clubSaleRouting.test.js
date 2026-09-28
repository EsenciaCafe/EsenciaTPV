import test from 'node:test';
import assert from 'node:assert/strict';
import {saleNeedsClubServer} from '../src/clubSaleRouting.js';
test('ordinary sales keep the existing fiscal path even with Club installed',()=>{
 assert.equal(saleNeedsClubServer({items:[{id:'coffee'}],total:4.6}),false);
 assert.equal(saleNeedsClubServer({loyaltyCustomer:{provider:'previous'},items:[]}),false);
});
test('Club customer and promotions require the atomic server fiscal path',()=>{
 for(const sale of [{loyaltyCustomer:{provider:'club-esencia'}},{clubPromotions:[{id:'r'}]},{items:[{clubPromotion:{id:'r'}}]}])assert.equal(saleNeedsClubServer(sale),true);
});
