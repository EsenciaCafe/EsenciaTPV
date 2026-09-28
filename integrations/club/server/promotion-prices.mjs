// Staff can edit a ticket's base price in the existing TPV. Freeze that price,
// while still checking product identity and the catalogue price of every topping.
export function validatePromotionPrices(catalog, snapshot) {
  const item=catalog.items.find(i=>String(i.id)===snapshot?.id);
  if(!item)throw Error('El producto ya no está en la carta.');
  if(!Number.isSafeInteger(snapshot.price)||snapshot.price<0||snapshot.price>99999999)throw Error('El precio de la cuenta no es válido.');
  if(!Array.isArray(snapshot.options))throw Error('Extras no válidos.');
  const ids=new Set();
  for(const o of snapshot.options){
    const option=(item.options||[]).find(x=>String(x.id)===o.id);
    if(!option||ids.has(o.id)||!Number.isInteger(o.qty)||o.qty<1||o.qty>100||Math.round(Number(option.price)*100)!==o.price)throw Error('El topping ha cambiado. Revisa los extras de la cuenta.');
    ids.add(o.id);
  }
  return item;
}
