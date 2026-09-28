// Server-only, staging candidate. Never import from src/ or expose a signing key to Vite.
import {createHash,createPrivateKey,randomUUID,sign} from 'node:crypto';
import {validate} from './contract.mjs';
import {Buffer} from 'node:buffer';
export function createBridgeClient({endpoint,allowedOrigin,sourceProject,issuer,audience,kid,privateKey,fetchImpl=fetch,timeoutMs=8000}){
 const url=new URL(endpoint);
 if(url.origin!==allowedOrigin||!['/v1/club','/functions/v1/tpv-club-bridge'].includes(url.pathname)||url.search||url.hash||url.username||url.password)throw Error('INVALID_BRIDGE_ENDPOINT');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)))throw Error('HTTPS_REQUIRED');
 if(!sourceProject||!issuer||!audience||!kid)throw Error('MISSING_SERVER_CONFIGURATION');
 const key=typeof privateKey==='string'||Buffer.isBuffer(privateKey)?createPrivateKey(privateKey):privateKey;
 if(key?.type!=='private'||key.asymmetricKeyType!=='ed25519')throw Error('ED25519_REQUIRED');
 return async raw=>{
  const envelope=validate(JSON.parse(raw));
  if(envelope.source_project!==sourceProject)throw Error('SOURCE_MISMATCH');
  const body=Buffer.from(raw,'utf8');if(body.length>32768)throw Error('BODY_TOO_LARGE');
  const now=Math.floor(Date.now()/1000);
  const claims={iss:issuer,aud:audience,sub:envelope.employee_id,iat:now,exp:now+60,jti:randomUUID(),body_sha256:createHash('sha256').update(body).digest('hex')};
  const data=[{alg:'EdDSA',typ:'JWT',kid},claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  const assertion=data+'.'+sign(null,Buffer.from(data),key).toString('base64url');
  const response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-club-assertion':assertion},body,signal:AbortSignal.timeout(timeoutMs)});
  // The body is read under the same timeout. Never log requests, signatures or member data.
  return {status:response.status,body:await response.json()};
 };
}
