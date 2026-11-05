import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kitchenRule,kitchenSelectionError,kitchenSnapshot,isLinkedKitchenOption} from '../src/kitchenCatalog.js';

// Exercise the production Store methods without its singleton constructor,
// Supabase, subscriptions or browser persistence. Do not place test tickets online.
const source=readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const methods=['addItemToActiveTicket','updateTicketItemModifiers','getActiveItems','getSelectedTable'].map(name=>{
  const start=source.indexOf(`\n  ${name}(`);
  assert.ok(start>0,`Production method ${name} exists`);
  return source.slice(start,source.indexOf('\n  }',start)+4);
});
const declaration=`class Store {${methods.join('\n')}}`;
let sequence=0;
const Store=new Function('kitchenSelectionError','kitchenSnapshot','isLinkedKitchenOption','createUuid',`${declaration}; return Store;`)(kitchenSelectionError,kitchenSnapshot,isLinkedKitchenOption,()=>`line-${++sequence}`);
const kdsSource=readFileSync(new URL('../src/kds.js',import.meta.url),'utf8');
const start=kdsSource.indexOf('function renderItem(');
const renderSource=kdsSource.slice(start,kdsSource.indexOf('\nfunction ',start+1));
const renderKDS=new Function('state','isItemDeferredForKds','escapeHtml',`${renderSource};return renderItem;`)({config:{showPrices:false}},()=>false,text=>String(text));

test('table and direct-sale flows keep quantities, notes and the existing KDS finish display',()=>{
  for(const table of [false,true]) {
    const store=Object.create(Store.prototype);
    const item={id:'cinnamon-roll',name:'Cinnamon Roll',price:4.5};
    const [classic,nutella]=kitchenRule(item).optionIds;
    store.state={menuItems:[item],selectedTableId:table?1:null,tables:[{id:1,status:'available',items:[]}],directSaleTicket:{items:[]}};
    store.notify=()=>{};store.sortTicketItemsForService=items=>items;
    const options=[{id:nutella,name:'Nutella',price:0,qty:1}];
    assert.equal(store.addItemToActiveTicket(item.id,[]),false);
    store.addItemToActiveTicket(item.id,options,2,'Sacar al final');
    assert.equal(store.getActiveItems().length,1);
    const line=store.getActiveItems()[0];
    assert.equal(line.id,item.id);assert.equal(line.qty,2);assert.equal(line.note,'Sacar al final');
    assert.deepEqual(line.selectedOptions,options);
    assert.equal(line.kitchenSnapshot.allergens.status,'pending');
    const html=renderKDS(line,[]);
    assert.match(html,/2×/);assert.match(html,/Cinnamon Roll/);assert.match(html,/\+ Nutella/);assert.match(html,/Sacar al final/);
    assert.doesNotMatch(html,/Clásico|Dulce de leche/);
    assert.equal(store.updateTicketItemModifiers(line.ticketItemId,[]),false);
    store.updateTicketItemModifiers(line.ticketItemId,[{id:classic,name:'Clasico',price:0,qty:1}]);
    assert.match(renderKDS(store.getActiveItems()[0],[]),/\+ Clasico/);
    assert.doesNotMatch(renderKDS(store.getActiveItems()[0],[]),/\+ Nutella/);
    assert.equal(store.getActiveItems()[0].qty,2);
  }
});
