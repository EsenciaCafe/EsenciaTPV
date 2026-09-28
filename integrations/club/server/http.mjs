export function createTpvHandler({service,origin}){
 return async(req,res)=>{
  if(req.url!=='/api/tpv/club')return false;
  const respond=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','vary':'Origin',...(req.headers.origin===origin?{'access-control-allow-origin':origin}:{})});res.end(JSON.stringify(data));};
  if(req.method==='OPTIONS'){
   if(req.headers.origin!==origin){respond(403,{error:'Origen no autorizado.'});return true;}
   res.writeHead(204,{'access-control-allow-origin':origin,'access-control-allow-methods':'POST','access-control-allow-headers':'content-type,x-tpv-request','vary':'Origin','cache-control':'no-store'});res.end();return true;
  }
  if(req.method!=='POST'||req.headers['x-tpv-request']!=='1'||!String(req.headers['content-type']).startsWith('application/json')){respond(400,{error:'Petición no válida.'});return true;}
  if(req.headers.origin!==origin){respond(403,{error:'Origen no autorizado.'});return true;}
  try{
   let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>262144){respond(413,{error:'Cuenta demasiado grande.'});return true;}chunks.push(chunk);}
   const input=JSON.parse(Buffer.concat(chunks));
   if(!input||typeof input.p_action!=='string'||!input.p_payload||typeof input.p_payload!=='object')throw Error('Petición no válida.');
   respond(200,await service.call(input));
  }catch(error){respond(400,{error:error.code&&/^[0-9A-Z]{5}$/.test(error.code)?'No se pudo guardar la operación. Revisa la cuenta.':error.message||'No se pudo completar la operación.'});}
  return true;
 };
}
