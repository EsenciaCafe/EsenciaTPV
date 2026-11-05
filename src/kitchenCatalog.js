// This pilot leaves item IDs, option names, ticket options and KDS rendering unchanged.
const pilot={itemId:'cinnamon-roll',groupId:'mod-cinnamon-roll-1793874198562',min:1,max:1,optionIds:['0000_opt-clasico-1793874206850','0002_opt-nutella-1793874217599','0001_opt-dulce-leche-1793874212974']};
export function kitchenRule(item) {
  if(item?.id!==pilot.itemId)return null;
  return pilot;
}
export function isLinkedKitchenOption(groupId, optionId) {
  return groupId === pilot.groupId && pilot.optionIds.includes(optionId);
}
export function kitchenSelectionError(item,options=[]) {
  const rule=kitchenRule(item);if(!rule)return '';
  const selected=options.filter(o=>Number(o.qty)>0);
  if(selected.length!==1 || !rule.optionIds.includes(selected[0].id) || Number(selected[0].qty)!==1)
    return 'Elige un acabado: Clásico, Nutella o Dulce de leche.';
  return '';
}
export function selectKitchenFinish(item,optionId,quantities) {
  const rule=kitchenRule(item);if(!rule?.optionIds.includes(optionId))return null;
  const next={...quantities};for(const id of rule.optionIds)next[id]=id===optionId?1:0;
  return next;
}
export function kitchenSnapshot(item,options=[]) {
  if(!kitchenRule(item))return null;
  const pending={status:'pending',contains:[],traces:[],pending:'Información de alérgenos pendiente de verificar.'};
  if(kitchenSelectionError(item,options))return {allergens:pending};
  const payload=item.kitchen;
  const selected=options.find(o=>Number(o.qty)>0);
  const variant=payload?.schemaVersion===1 && payload.itemId===item.id ? payload.variants?.find(v=>v.optionIds?.length===1&&v.optionIds[0]===selected.id) : null;
  return {specRevision:payload?.specRevision??null,documentRevision:payload?.documentRevision??null,
    updatedAt:payload?.updatedAt??null,allergens:variant?.allergens??pending};
}
export function kitchenNotice(item,options) {
  const snap=kitchenSnapshot(item,options);if(!snap)return '';
  if(!options.length)return 'Elige un acabado para consultar sus alérgenos. Todos llevan frosting.';
  const a=snap.allergens;
  return [a.contains?.length?`Contiene: ${a.contains.join(', ')}.`:'',a.traces?.length?`Puede contener: ${a.traces.join(', ')}.`:'',
    a.status==='reviewed'?'Fichas revisadas. Consulta la preparación si hay alergias.':'Información pendiente de verificar.',
    snap.updatedAt?`Ficha actualizada: ${new Date(snap.updatedAt).toLocaleString('es-ES')}.`:''].filter(Boolean).join(' ');
}
