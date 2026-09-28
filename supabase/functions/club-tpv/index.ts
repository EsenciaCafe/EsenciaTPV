import pg from 'npm:pg@8.23.0';
import {generateKeyPairSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {postgresAdapter} from '../../../integrations/club/server/postgres.mjs';
import {createTpvBridge} from '../../../integrations/club/server/service.mjs';
import {createBridgeClient} from '../../../integrations/club/server/client.mjs';
import {loadCatalog,finalizeFiscal} from '../../../integrations/club/server/catalog.mjs';
import {provisionEmployee,cashierPermissions,managerPermissions} from '../../../integrations/club/server/auth.mjs';
const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:3,connectionTimeoutMillis:8000,statement_timeout:15000});
pool.on('error',()=>console.error('TPV_CLUB_DB_CONNECTION'));
const db=postgresAdapter(pool),origin='https://esenciacafe.github.io',source='tbqvypdxcgeofsmiqmuo';
let ready;
async function initialize(){
 for(const staff of (await db.query('select s.id,s.role from public.staff_profiles s left join tpv_bridge_private.employees e on e.staff_id=s.id where s.active and e.staff_id is null')).rows)await provisionEmployee(db,staff.id,staff.role==='admin'?managerPermissions:cashierPermissions);
 let keys=(await db.query('select * from tpv_bridge_private.runtime_keys where id=true')).rows[0];
 if(!keys){const pair=generateKeyPairSync('ed25519');await db.query('insert into tpv_bridge_private.runtime_keys(id,private_key,public_key,worker_token) values(true,$1,$2,$3) on conflict do nothing',[pair.privateKey.export({type:'pkcs8',format:'pem'}),pair.publicKey.export({type:'spki',format:'pem'}),randomBytes(32).toString('base64url')]);keys=(await db.query('select * from tpv_bridge_private.runtime_keys where id=true')).rows[0];}
 const send=createBridgeClient({endpoint:'https://tojcqhfyjebefyfeqpxv.supabase.co/functions/v1/tpv-club-bridge',allowedOrigin:'https://tojcqhfyjebefyfeqpxv.supabase.co',sourceProject:source,issuer:'esencia-tpv',audience:'esencia-club',kid:'tpv-v1',privateKey:keys.private_key});
 const service=createTpvBridge({db,send,sourceProject:source,loadCatalog,finalizeFiscal});
 return {service,keys};
}
async function drain(service){for(let n=0;n<20;n++)if(!await service.worker.runOne())break;}
Deno.serve(async(req)=>{
 const headers={'content-type':'application/json','cache-control':'no-store','vary':'Origin',...(req.headers.get('origin')===origin?{'access-control-allow-origin':origin}:{})};
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return req.headers.get('origin')===origin?new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'POST','access-control-allow-headers':'content-type,x-tpv-request'}}):reply(403,{error:'Origen no autorizado.'});
 try{
  const runtime=await (ready||=initialize().catch(e=>{ready=null;throw e;}));
  if(req.method==='GET')return reply(200,{service:'tpv-club',version:1});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const worker=req.headers.get('x-club-worker');
  if(worker){const a=Buffer.from(worker),b=Buffer.from(runtime.keys.worker_token);if(a.length!==b.length||!timingSafeEqual(a,b))return reply(403,{error:'No autorizado.'});await drain(runtime.service);return reply(200,{ok:true});}
  if(req.headers.get('origin')!==origin||req.headers.get('x-tpv-request')!=='1'||!req.headers.get('content-type')?.startsWith('application/json'))return reply(403,{error:'Origen no autorizado.'});
  const reader=req.body?.getReader();if(!reader)return reply(400,{error:'Petición vacía.'});const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();return reply(413,{error:'Cuenta demasiado grande.'});}chunks.push(value);}
  const input=JSON.parse(Buffer.concat(chunks).toString());
  if(!input||typeof input.p_action!=='string'||!input.p_payload||typeof input.p_payload!=='object'||Array.isArray(input.p_payload))return reply(400,{error:'Petición no válida.'});
  const result=await runtime.service.call(input);
  EdgeRuntime.waitUntil(drain(runtime.service).catch(()=>console.error('CLUB_OUTBOX_PENDING')));
  return reply(200,result);
 }catch(error){console.error('TPV_CLUB_ACTION_FAILED',error.code||'domain');return reply(400,{error:error.code&&/^[0-9A-Z]{5}$/.test(error.code)?'No se pudo guardar la operación. Revisa la cuenta.':error.message||'Club no disponible.',...(['TERMINAL_UNKNOWN','TERMINAL_DISABLED'].includes(error.code)?{code:error.code}:{})});}
});
