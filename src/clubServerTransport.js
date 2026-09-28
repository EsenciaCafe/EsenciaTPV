// Same-origin browser client. Only a terminal credential and short staff session;
// signing keys and the Fidelidad server credential never enter this module.
export const clubServerEnabled=typeof window!=='undefined'&&import.meta.env.VITE_LOYALTY_PROVIDER==='club'&&import.meta.env.VITE_CLUB_SERVER_BRIDGE==='true';
const endpoint=import.meta.env?.VITE_CLUB_BRIDGE_URL||'/api/tpv/club';
export async function serverClubCall(input){
 const url=new URL(endpoint,location.origin);
 if(url.username||url.password||url.hash||url.search||!['/api/tpv/club','/functions/v1/club-tpv'].includes(url.pathname)||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw Error('Dirección del puente Club no válida.');
 const response=await fetch(url,{method:'POST',redirect:'error',credentials:'omit',headers:{'content-type':'application/json','x-tpv-request':'1'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok||data.error)throw Object.assign(Error(data.error||'No se pudo contactar con el servidor del TPV.'),{code:data.code});return data;
}
export const serverClubRaw={rpc:async(_name,input)=>{try{return {data:await serverClubCall(input),error:null};}catch(error){return {data:null,error};}}};
export async function serverClubAction(action,payload){
 const session=JSON.parse(sessionStorage.getItem('esencia-club-pin-session-v1')||'null');
 return serverClubCall({p_device:localStorage.getItem('esencia-club-terminal-v1')||'',p_session:session?.token,p_action:action,p_payload:{...payload,_expectedActor:session?.actorId}});
}
