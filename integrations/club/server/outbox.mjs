import {randomUUID} from 'node:crypto';
import {validate} from './contract.mjs';
import {Buffer} from 'node:buffer';
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
export function businessKey(action,p){
 const keys={
  'award.purchase':`sale:${p.sale_id}:assign:${p.expected_version}`,
  'assignment.withdraw':`sale:${p.sale_id}:withdraw:${p.expected_version}`,
  'award.clear':`clear:${p.clear_event_id}`,'award.courtesy':`courtesy:${p.event_id}`,
  'reward.configure':`reward:${p.reward_id}:version:${p.expected_version}`,
  'redemption.reserve':`application:${p.application_id}:reserve`,
  'redemption.commit':`reservation:${p.reservation_id}:commit`,
  'redemption.release':`reservation:${p.reservation_id}:release`,
 };
 return keys[action]||`read:${randomUUID()}`;
}
// Call using the fiscal transaction's query handle, not a separate connection.
// Context must be derived by the authenticated TPV server, never taken from browser input.
export async function enqueue(tx,{sourceProject,terminalId,employeeId},action,payload,{operationId=randomUUID(),key=businessKey(action,payload)}={}){
 const envelope=validate({version:1,operation_id:operationId,action,source_project:sourceProject,terminal_id:terminalId,employee_id:employeeId,business_key:key,payload});
 const raw=JSON.stringify(envelope);
 if(Buffer.byteLength(raw)>32768)throw Error('BODY_TOO_LARGE');
 await tx.query('insert into tpv_bridge_private.outbox(id,source,business_key,body) values($1,$2,$3,$4) on conflict do nothing',[operationId,sourceProject,key,raw]);
 const {rows}=await tx.query('select * from tpv_bridge_private.outbox where source=$1 and business_key=$2',[sourceProject,key]);
 const row=rows[0];if(!row)throw Error('OPERATION_CONFLICT');
 const previous=JSON.parse(row.body);
 // The first persisted operation is canonical for this ticket, across repeated clicks.
 if(canonical({...envelope,operation_id:previous.operation_id})!==canonical(previous))throw Error('INTENT_CONFLICT');
 return row;
}
function classify(id,{status,body}){
 if(status===200&&body?.operation_id===id&&body.state==='applied'&&body.result&&typeof body.result==='object')return {state:'applied'};
 if(status===200&&body?.operation_id===id&&body.state==='rejected'&&body.error?.retryable===false&&typeof body.error.code==='string')return {state:'rejected',code:body.error.code};
 if(status===200&&body?.retryable===false&&typeof body.code==='string')return {state:'review',code:body.code};
 if([400,401,403,404,413,415,422].includes(status))return {state:'review',code:'TRANSPORT_REJECTED'};
 return {state:'pending',code:'RESULT_UNKNOWN'};
}
export function createOutboxWorker({db,send,leaseSeconds=30}){
 if(leaseSeconds<1)throw Error('INVALID_LEASE');
 return {
  async runOne(operationId=null){
   const lease=randomUUID();
   const {rows}=await db.query(`with candidate as (
    select id from tpv_bridge_private.outbox
    where ((state='pending' and next_at<=now()) or (state='sending' and lease_until<=now())) and ($3::uuid is null or id=$3)
    order by created_at for update skip locked limit 1
   ) update tpv_bridge_private.outbox o set state='sending',lease_id=$1,lease_until=now()+($2::integer*interval '1 second'),attempts=attempts+1,updated_at=now()
   from candidate c where o.id=c.id returning o.*`,[lease,leaseSeconds,operationId]);
   const row=rows[0];if(!row)return null;
   let response,verdict;
   try{response=await send(row.body);verdict=classify(row.id,response);}
   catch(error){verdict=error.retryable===false?{state:'review',code:error.code||'LOCAL_AUTHORIZATION_FAILED'}:{state:'pending',code:'RESULT_UNKNOWN'};}
   const delay=Math.min(300,2**Math.min(row.attempts,8));
   await db.query(`update tpv_bridge_private.outbox set state=$3,response=$4,error_code=$5,
    next_at=now()+($6::integer*interval '1 second'),lease_id=null,lease_until=null,updated_at=now()
    where id=$1 and lease_id=$2 and state='sending'`,[row.id,lease,verdict.state,response?JSON.stringify(response.body):null,verdict.code||null,delay]);
   return {id:row.id,...verdict};
  },
 };
}
// A separate, permitted reconciler may read a disabled employee's result without
// resending the mutation as themselves. not_found never enables a new mutation.
export async function reconcile({db,send,context,id}){
 const {rows}=await db.query('select * from tpv_bridge_private.outbox where id=$1',[id]);
 const row=rows[0];if(!row)throw Error('OPERATION_NOT_FOUND');
 if(row.source!==context.sourceProject)throw Error('SOURCE_MISMATCH');
 if(['applied','rejected'].includes(row.state))return row;
 const op=validate({version:1,operation_id:randomUUID(),action:'operation.get',source_project:context.sourceProject,terminal_id:context.terminalId,employee_id:context.employeeId,business_key:`read:${randomUUID()}`,payload:{operation_id:id}});
 const response=await send(JSON.stringify(op)),verdict=classify(id,response);
 if(['applied','rejected'].includes(verdict.state))await db.query(`update tpv_bridge_private.outbox set state=$2,response=$3,error_code=$4,lease_id=null,lease_until=null,updated_at=now() where id=$1 and state not in ('applied','rejected')`,[id,verdict.state,JSON.stringify(response.body),verdict.code||null]);
 return {id,...verdict};
}
