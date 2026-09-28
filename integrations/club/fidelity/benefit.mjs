// Internal staff configuration. Never add it to public club_rewards/customer snapshots.
export function validateBenefitRule(rule) {
  if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).sort().join(',')!=='benefit,version'||rule.version!==2)throw Error('INVALID_RULE');
  const b=rule.benefit;
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error('INVALID_BENEFIT');
  const keys=Object.keys(b).sort().join(',');
  if(['free_item','free_topping'].includes(b.type)) {
    if(keys!=='type')throw Error('INVALID_BENEFIT');
  }else if(b.type==='discount') {
    if(b.mode==='percentage') {
      if(keys!=='basis_points,mode,type'||!Number.isInteger(b.basis_points)||b.basis_points<1||b.basis_points>10000)throw Error('INVALID_DISCOUNT');
    }else if(b.mode==='fixed') {
      if(keys!=='amount_cents,mode,type'||!Number.isInteger(b.amount_cents)||b.amount_cents<1||b.amount_cents>999999)throw Error('INVALID_DISCOUNT');
    }else throw Error('INVALID_DISCOUNT');
  }else throw Error('INVALID_BENEFIT');
  return rule;
}

// Reference arithmetic for the TPV server, not a price authority or a public endpoint.
// Target refers to ONE priced unit selected from its authoritative cart.
export function benefitDiscount(rule,{kind,unit_cents,already_discounted=false}) {
  validateBenefitRule(rule);
  if(!['item','topping'].includes(kind)||!Number.isSafeInteger(unit_cents)||unit_cents<0||unit_cents>999999||typeof already_discounted!=='boolean')throw Error('INVALID_TARGET');
  if(already_discounted)throw Error('DISCOUNT_ALREADY_APPLIED');
  const b=rule.benefit;
  if(b.type==='free_topping') {
    if(kind!=='topping')throw Error('TOPPING_REQUIRED');
    return unit_cents;
  }
  if(kind!=='item')throw Error('ITEM_REQUIRED');
  if(b.type==='free_item')return unit_cents;
  return b.mode==='fixed'?Math.min(unit_cents,b.amount_cents):Math.min(unit_cents,Math.floor((unit_cents*b.basis_points+5000)/10000));
}
