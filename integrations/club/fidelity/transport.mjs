import {createHash,verify,createPublicKey} from 'node:crypto';
import {validate} from './contract.mjs';
import {Buffer} from 'node:buffer';
export class TransportError extends Error { constructor(code,status=401){super(code);this.status=status;} }
// Ed25519 compact JWS. Signature binds the exact UTF-8 request bytes, not reserialized JSON.
export function verifyRequest(raw,assertion,keys,audience,now=Math.floor(Date.now()/1000)) {
  if(!Buffer.isBuffer(raw)||raw.length>32768)throw new TransportError('BODY_TOO_LARGE',413);
  try {
    const parts=assertion.split('.'); if(parts.length!==3)throw Error();
    const header=JSON.parse(Buffer.from(parts[0],'base64url'));
    if(header.alg!=='EdDSA'||header.typ!=='JWT'||typeof header.kid!=='string'||Object.keys(header).some(k=>!['alg','typ','kid'].includes(k)))throw Error();
    const key=keys[header.kid]; if(!key||!key.enabled)throw Error();
    const publicKey=createPublicKey(key.publicKey);
    if(publicKey.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw Error();
    const c=JSON.parse(Buffer.from(parts[1],'base64url'));
    if(c.iss!==key.issuer||c.aud!==audience||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.exp<=now||c.iat>now+5||c.iat<now-65||c.exp-c.iat>60||c.exp<=c.iat||typeof c.jti!=='string'||!/^[0-9a-f-]{36}$/.test(c.jti))throw Error();
    if(c.body_sha256!==createHash('sha256').update(raw).digest('hex'))throw Error();
    const envelope=validate(JSON.parse(raw));
    if(envelope.source_project!==key.sourceProject||c.sub!==envelope.employee_id)throw Error();
    return {envelope,nonce:c.jti,expiresAt:new Date(c.exp*1000).toISOString()};
  }catch{throw new TransportError('INVALID_ASSERTION');}
}

export function createHandler({keys,audience,dispatch}) {
  return async (req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    if(req.method!=='POST'||req.url!=='/v1/club')return send(404,{code:'NOT_FOUND',retryable:false});
    try {
      if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new TransportError('CONTENT_TYPE',415);
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)throw new TransportError('BODY_TOO_LARGE',413);chunks.push(chunk);}
      const input=verifyRequest(Buffer.concat(chunks),req.headers['x-club-assertion']||'',keys,audience);
      const result=await dispatch(input);
      send(200,result);
    } catch(error) {
      if(error instanceof TransportError)return send(error.status,{code:error.message,retryable:false});
      // Never expose database errors, payloads, tokens, or assert that a timed-out write failed.
      send(503,{code:'RESULT_UNKNOWN',message:'Consulta o reintenta la misma operación.',retryable:true});
    }
  };
}
