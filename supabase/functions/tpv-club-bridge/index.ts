import pg from 'npm:pg@8.23.0';
import {Buffer} from 'node:buffer';
import {verifyRequest,TransportError} from '../../../integrations/club/fidelity/transport.mjs';
const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:2,connectionTimeoutMillis:8000,statement_timeout:15000});
pool.on('error',()=>console.error('CLUB_DB_CONNECTION'));
Deno.serve(async(req)=>{
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='GET')return reply(200,{service:'fidelity-tpv-bridge',version:1});
 if(req.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  if(!req.headers.get('content-type')?.startsWith('application/json'))return reply(415,{code:'CONTENT_TYPE'});
  const reader=req.body?.getReader();if(!reader)return reply(400,{code:'EMPTY_BODY'});
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return reply(413,{code:'BODY_TOO_LARGE'});}chunks.push(value);}
  const keys=Object.fromEntries((await pool.query('select * from club_bridge_private.trusted_keys where enabled')).rows.map(k=>[k.kid,{publicKey:k.public_key,issuer:k.issuer,sourceProject:k.source,enabled:true}]));
  const {envelope,nonce,expiresAt}=verifyRequest(Buffer.concat(chunks),req.headers.get('x-club-assertion')||'',keys,'esencia-club');
  const result=(await pool.query('select public.club_bridge_dispatch($1::jsonb,$2::uuid,$3::timestamptz) as result',[JSON.stringify(envelope),nonce,expiresAt])).rows[0].result;
  return reply(200,result);
 }catch(error){if(error instanceof TransportError)return reply(error.status,{code:error.message,retryable:false});console.error('CLUB_DISPATCH_FAILED',error.code||'runtime');return reply(503,{code:'RESULT_UNKNOWN',retryable:true});}
});
