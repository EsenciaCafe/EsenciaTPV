import {validateBenefitRule} from './benefit.mjs';
export const VERSION = 1;
export const ACTIONS = {
  'member.lookup': ['qr'], 'member.offers': ['member_id'],
  'reward.catalogue': ['limit','cursor'],
  'award.purchase': ['sale_id','member_id','amount','expected_version'],
  'award.clear': ['clear_event_id','member_id','amount'],
  'award.courtesy': ['event_id','member_id','points','reason'],
  'assignment.get': ['sale_id'],
  'assignment.withdraw': ['sale_id','expected_version','reason'],
  'reward.configure': ['reward_id','expected_version','title','description','cost','active','rule'],
  'redemption.reserve': ['member_id','reward_id','expected_cost','expected_version','cart_id','application_id','redemption_id?'],
  'redemption.commit': ['reservation_id','application_id','sale_id?','delivered_clear_id?'],
  'redemption.release': ['reservation_id','application_id','cancel_event_id'],
  'operation.get': ['operation_id'],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validate(e) {
  const fields=['version','operation_id','action','source_project','terminal_id','employee_id','business_key','payload'];
  if (!e || typeof e!=='object' || Object.keys(e).length!==fields.length || fields.some(k=>!Object.hasOwn(e,k))) throw Error('INVALID_ENVELOPE');
  if(e.version!==VERSION || !uuid.test(e.operation_id) || !ACTIONS[e.action]) throw Error('INVALID_ENVELOPE');
  for(const k of ['source_project','terminal_id','employee_id','business_key']) if(typeof e[k]!=='string'||!e[k].length||e[k].length>200) throw Error('INVALID_ENVELOPE');
  const p=e.payload, spec=ACTIONS[e.action];
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!spec.includes(k)&&!spec.includes(k+'?'))||spec.filter(k=>!k.endsWith('?')).some(k=>!Object.hasOwn(p,k))) throw Error('INVALID_PAYLOAD');
  for(const [k,v] of Object.entries(p)) {
    if(['member_id','reward_id','redemption_id','reservation_id','operation_id'].includes(k) && (typeof v!=='string'||!uuid.test(v))) throw Error('INVALID_ID');
    if(['sale_id','cart_id','application_id','event_id','clear_event_id','delivered_clear_id','cancel_event_id'].includes(k) && (typeof v!=='string'||!v.length||v.length>120||/[\u0000-\u001f]/.test(v))) throw Error('INVALID_EXTERNAL_ID');
    if(['amount','points','cost','expected_cost','expected_version'].includes(k) && (!Number.isSafeInteger(v)||v<0||v>99999999)) throw Error('INVALID_NUMBER');
  }
  if(['award.purchase','award.clear'].includes(e.action)&&p.amount>999999) throw Error('INVALID_AMOUNT');
  if(e.action==='reward.catalogue' && (!Number.isInteger(p.limit)||p.limit<1||p.limit>100||(p.cursor!==null&&(typeof p.cursor!=='string'||p.cursor.length<1||p.cursor.length>2048||!/^[A-Za-z0-9+/]+={0,2}$/.test(p.cursor))))) throw Error('INVALID_PAGINATION');
  if(e.action==='award.courtesy' && (p.points<1||typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>500)) throw Error('INVALID_COURTESY');
  if(e.action==='assignment.withdraw' && (typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>500)) throw Error('INVALID_REASON');
  if(e.action==='member.lookup' && !/^esencia-club:v1:[0-9a-f-]{36}$/.test(p.qr)) throw Error('INVALID_QR');
  if(e.action==='redemption.commit' && Number(!!p.sale_id)+Number(!!p.delivered_clear_id)!==1) throw Error('INVALID_DELIVERY');
  if(e.action==='reward.configure') {
    if(typeof p.title!=='string'||!p.title.trim()||p.title.length>100||typeof p.description!=='string'||p.description.length>500||p.cost<1||typeof p.active!=='boolean') throw Error('INVALID_REWARD');
    const r=p.rule;
    if(r?.version===2)validateBenefitRule(r);
    else {
    if(!r||Object.keys(r).sort().join(',')!=='catalog_version,include_extras,scope,target_ids,version'||r.version!==1||!['product','topping'].includes(r.scope)||typeof r.include_extras!=='boolean'||typeof r.catalog_version!=='string'||!r.catalog_version.length||r.catalog_version.length>100) throw Error('INVALID_RULE');
    if(!Array.isArray(r.target_ids)||!r.target_ids.length||r.target_ids.length>100||r.target_ids.some(id=>typeof id!=='string'||!id.length||id.length>200)||new Set(r.target_ids).size!==r.target_ids.length) throw Error('INVALID_RULE');
    }
  }
  const keys={
    'award.purchase':`sale:${p.sale_id}:assign:${p.expected_version}`,
    'award.clear':`clear:${p.clear_event_id}`, 'award.courtesy':`courtesy:${p.event_id}`,
    'assignment.withdraw':`sale:${p.sale_id}:withdraw:${p.expected_version}`,
    'reward.configure':`reward:${p.reward_id}:version:${p.expected_version}`,
    'redemption.reserve':`application:${p.application_id}:reserve`,
    'redemption.commit':`reservation:${p.reservation_id}:commit`,
    'redemption.release':`reservation:${p.reservation_id}:release`,
  };
  if(keys[e.action] && e.business_key!==keys[e.action]) throw Error('INVALID_BUSINESS_KEY');
  return e;
}
