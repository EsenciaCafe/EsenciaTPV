// Restricted Club RPC bridge. No Supabase user password or service key is stored.
export function createClubPinBridge(rawClient, { storage = sessionStorage, devices = localStorage, changed = () => {} } = {}) {
  const deviceKey='esencia-club-terminal-v1', sessionKey='esencia-club-pin-session-v1';
  let current=null, generation=0;
  try { current=JSON.parse(storage.getItem(sessionKey)||'null'); } catch { /* fail closed */ }
  const emit=()=>changed();
  function save(value){const previous=JSON.stringify(current);current=value;try{value?storage.setItem(sessionKey,JSON.stringify(value)):storage.removeItem(sessionKey);}catch{/* session remains memory-only */}if(previous!==JSON.stringify(current))emit();}
  async function call(action,payload={},session=current){
    if (session && action !== 'logout' && (current?.token !== session.token || current?.actorId !== session.actorId)) throw new Error('El empleado ha cambiado.');
    if (session?.actorId && ['purchase','resolve','lookup','pending','assignment','assign_sale','withdraw_sale','clear_award','gift_points','promo_catalogue','promo_save','promo_available','promo_reserve','promo_validate','promo_complete','promo_release','promo_clear','promo_cart','promo_holds'].includes(action)) payload={...payload,_expectedActor:session.actorId};
    const request=rawClient.rpc('club_tpv',{p_device:devices.getItem(deviceKey)||'',p_session:session?.token||'',p_action:action,p_payload:payload});
    const {data,error}=await (request.abortSignal?request.abortSignal(AbortSignal.timeout(8000)):request);
    if(error||data?.error)throw new Error(data?.error||error.message);
    return data;
  }
  const bridge={
    awards: true,
    action: (action, payload) => call(action, payload),
    withSession(){const scoped=current;return {awards:true,rpc:(name,args)=>bridge.rpc(name,args,scoped),from:name=>bridge.from(name,scoped)};},
    currentStaff:()=>current?.staffId||null,
    profile:()=>current?.profile||null,
    configured:()=>!!devices.getItem(deviceKey),
    async configure(device){await bridge.logout().catch(() => {});devices.setItem(deviceKey,device.trim());},
    async login(pin,staffId){
      const attempt=++generation, previous=current;save(null);
      if(previous)void call('logout',{},previous).catch(()=>{});
      let session;
      try{
        session=await call('login',{pin,staffId},null);
        if((staffId&&session?.staffId!==staffId)||!session.token||session.expiresAt<=Date.now())throw new Error('Sesión no válida.');
        if(attempt!==generation){void call('logout',{},session).catch(()=>{});return false;}
        if(session.device){devices.setItem(deviceKey,session.device);delete session.device;}
        save(session);
        // An unlinked administrator can still manage bindings.
        await bridge.refresh().catch(()=>{});return true;
      }catch{if(attempt===generation)save(null);return false;}
    },
    async refresh(){
      const session=current;if(!session) return null;
      const result=await call('status',{},session);
      if(current===session){save({...session,actorId:result.actorId});}
      return result;
    },
    actor(){return current?.expiresAt>Date.now()?current.actorId||null:null;},
    async logout(){++generation;const old=current;save(null);if(old)await call('logout',{},old);},
    async binding(staffId){return call('binding',{staffId});},
    async bind(staffId,email){const r=await call('bind',{staffId,email});await bridge.refresh().catch(()=>{});return r;},
    async rpc(name,args, scoped=current){
      try{
        let data;
        if(name==='es_admin'){const status=await call('status',{},scoped);if(status.actorId!==scoped?.actorId)throw new Error('La vinculación ha cambiado. Vuelve a entrar con tu PIN.');data=true;}
        else if(name==='club_lookup_qr')data=await call('lookup',{qr:args.p_qr},scoped);
        else if(name==='club_action'&&['purchase','resolve','assignment','assign_sale','withdraw_sale','clear_award','gift_points','promo_catalogue','promo_save','promo_available','promo_reserve','promo_validate','promo_complete','promo_release','promo_clear','promo_cart','promo_holds'].includes(args.p_action))data=await call(args.p_action,args.p_payload,scoped);
        else throw new Error('Operación no permitida.');
        return {data,error:null};
      }catch(error){return {data:null,error};}
    },
    from(name,scoped=current){
      const filters={};const query={select(){return query;},eq(k,v){filters[k]=v;return query;},limit(){return query;},
        async then(resolve,reject){try{if(name!=='club_redemptions'||filters.status!=='pending')throw new Error('Consulta no permitida.');return resolve({data:await call('pending',{memberId:filters.member_id},scoped),error:null});}catch(error){return resolve({data:null,error});}}};return query;
    },
    auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},async getSession(){return {data:{session:bridge.actor()?{user:{id:bridge.actor()}}:null},error:null};}},
  };
  return bridge;
}






