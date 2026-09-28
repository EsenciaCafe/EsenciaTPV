import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import pg from 'pg';
import {postgresAdapter} from './postgres.mjs';
import {createBridgeClient} from './client.mjs';
import {createTpvBridge} from './service.mjs';
import {createTpvHandler} from './http.mjs';
import {loadCatalog,finalizeFiscal} from './catalog.mjs';
import {startWorkerLoop} from './worker-loop.mjs';

// Secrets belong to the server's environment, never to a VITE_* variable.
const required=name=>{const value=process.env[name];if(!value)throw Error(`Falta ${name}`);return value;};
async function start(){
 const origin=new URL(required('TPV_WEB_ORIGIN'));
 if(origin.href!==origin.origin+'/'||origin.username||origin.password||(origin.protocol!=='https:'&&origin.hostname!=='127.0.0.1'))throw Error('TPV_WEB_ORIGIN no válido');
 const connectionString=required('TPV_DATABASE_URL'),database=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(database.protocol))throw Error('TPV_DATABASE_URL no válido');
 // pg URL SSL options can override the supplied TLS settings: disallow them.
 if([...database.searchParams.keys()].some(k=>k.startsWith('ssl')))throw Error('Configura TLS mediante TPV_DATABASE_CA_FILE');
 const local=['127.0.0.1','localhost','[::1]'].includes(database.hostname);
 const ca=process.env.TPV_DATABASE_CA_FILE?await readFile(process.env.TPV_DATABASE_CA_FILE,'utf8'):undefined;
 const privateKey=await readFile(required('TPV_SIGNING_KEY_FILE'),'utf8');
 const endpoint=required('CLUB_BRIDGE_URL');
 const send=createBridgeClient({endpoint,allowedOrigin:new URL(endpoint).origin,sourceProject:required('TPV_PROJECT_REF'),
  issuer:required('TPV_BRIDGE_ISSUER'),audience:required('CLUB_BRIDGE_AUDIENCE'),kid:required('TPV_SIGNING_KEY_ID'),privateKey});
 const pool=new pg.Pool({connectionString,max:5,connectionTimeoutMillis:8000,statement_timeout:15000,idle_in_transaction_session_timeout:20000,
  ssl:local?false:{rejectUnauthorized:true,...(ca?{ca}:{})}});
 pool.on('error',()=>console.error('CLUB_DATABASE_CONNECTION_ERROR'));
 const db=postgresAdapter(pool);
 try{
  await db.query('select id from tpv_bridge_private.outbox limit 0');
  await loadCatalog(db);
  const fiscal=await db.query("select to_regprocedure('public.finalize_tpv_sale(jsonb)') as fn");
  if(!fiscal.rows[0]?.fn)throw Error('Falta la función fiscal del TPV');
 }catch(error){await pool.end();throw error;}
 const service=createTpvBridge({db,send,sourceProject:process.env.TPV_PROJECT_REF,loadCatalog,finalizeFiscal});
 const handler=createTpvHandler({service,origin:origin.origin});
 const server=createServer(async(req,res)=>{
  if(req.url==='/health'&&req.method==='GET'){
   try{await db.query('select 1');res.writeHead(200,{'cache-control':'no-store'});res.end('ok');}
   catch{res.writeHead(503,{'cache-control':'no-store'});res.end('unavailable');}return;
  }
  if(!await handler(req,res)){res.writeHead(404);res.end();}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;
 const port=Number(process.env.PORT||8788);
 if(!Number.isInteger(port)||port<1||port>65535){await pool.end();throw Error('PORT no válido');}
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,process.env.HOST||'127.0.0.1',resolve);});}
 catch(error){await pool.end();throw error;}
 const loop=startWorkerLoop(service.worker,{onError:code=>console.error(code)});
 let closing=false;
 async function stop(){if(closing)return;closing=true;await new Promise(resolve=>server.close(resolve));await loop.stop();await pool.end();}
 process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
 console.log('Puente Club iniciado. Sin cambios automáticos en el esquema.');
}
start().catch(()=>{console.error('No se pudo iniciar Club. Revisa la configuración privada y el esquema del servidor.');process.exitCode=1;});
