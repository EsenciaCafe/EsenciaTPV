import {createHash} from 'node:crypto';
// Same bidirectional modifier associations as the existing TPV data loader.
export function mapCatalog(menu,modifiers,options){
 const price=value=>{const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('INVALID_CATALOG_PRICE');return n;};
 const items=menu.map(item=>({id:String(item.id),name:item.name,price:price(item.price),
  options:options.filter(option=>modifiers.some(mod=>String(mod.id)===String(option.modifier_id)&&
   ((item.modifiers||[]).map(String).includes(String(mod.id))||(mod.assigned_items||[]).map(String).includes(String(item.id)))))
   .map(option=>({id:String(option.id),name:option.name,price:price(option.price)})).sort((a,b)=>a.id.localeCompare(b.id))
 })).sort((a,b)=>a.id.localeCompare(b.id));
 return {items,version:createHash('sha256').update(JSON.stringify(items)).digest('hex')};
}
export async function loadCatalog(db){
 // One SQL statement gives all three tables the same database snapshot.
 const {rows}=await db.query(`select
  (select coalesce(jsonb_agg(m),'[]'::jsonb) from public.menu_items m) menu,
  (select coalesce(jsonb_agg(m),'[]'::jsonb) from public.modifiers m) modifiers,
  (select coalesce(jsonb_agg(o),'[]'::jsonb) from public.modifier_options o) options`);
 return mapCatalog(rows[0].menu,rows[0].modifiers,rows[0].options);
}
export async function finalizeFiscal(tx,transaction){
 return (await tx.query('select * from public.finalize_tpv_sale($1::jsonb)',[JSON.stringify(transaction)])).rows[0];
}
