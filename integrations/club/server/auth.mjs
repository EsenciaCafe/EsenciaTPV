import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {Buffer} from 'node:buffer';
const scrypt=promisify(scryptCallback),hash=s=>createHash('sha256').update(s).digest('hex');
const derive=async(pin,salt)=>Buffer.from(await scrypt(pin,salt,32)).toString('hex');
const match=(a,b)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const cashierPermissions=['lookup','pending','promo_available','promo_reserve','promo_validate','promo_release','promo_cart','promo_clear','finalize_sale','purchase','assignment','assign_sale','prepare_clear','clear_ticket','clear_award'];
export const managerPermissions=[...cashierPermissions,'promo_catalogue','promo_save','promo_holds','gift_points','withdraw_sale'];
// Provision from a trusted backend/admin session ONLY, never a public HTTP method.
export async function provisionEmployee(db,staffId,permissions){
 const {rows}=await db.query('select pin_code from public.staff_profiles where id=$1 and active',[staffId]);
 if(!rows[0]||!/^\d{4,8}$/.test(rows[0].pin_code))throw Error('INVALID_STAFF');
 const salt=randomBytes(16).toString('hex'),pinHash=await derive(rows[0].pin_code,salt);
 await db.query(`insert into tpv_bridge_private.employees(staff_id,salt,pin_hash,permissions) values($1,$2,$3,$4)
 on conflict(staff_id) do update set salt=excluded.salt,pin_hash=excluded.pin_hash,permissions=excluded.permissions,version=tpv_bridge_private.employees.version+1`,[staffId,salt,pinHash,permissions]);
}
export async function provisionTerminal(db,id){
 const secret=randomBytes(32).toString('base64url');
 await db.query('insert into tpv_bridge_private.terminals(id,secret_hash) values($1,$2)',[id,hash(secret)]);return secret;
}
export function createPinAuth({db,sourceProject,sessionMs=12*60*60*1000}){
 if(!Number.isInteger(sessionMs)||sessionMs<60000||sessionMs>12*60*60*1000)throw Error('INVALID_SESSION_DURATION');
 return {
  async login(device,pin,staffId){
   let enrolledDevice;
   const result=await db.transaction(async tx=>{
    let terminal=(await tx.query('select * from tpv_bridge_private.terminals where secret_hash=$1 for update',[hash(String(device||''))])).rows[0];
    if(terminal&&!terminal.active)return {error:'Este terminal está desactivado. Requiere revisión del administrador.',code:'TERMINAL_DISABLED'};
    if(!terminal){
     if(device)return {error:'La configuración anterior del terminal ya no es válida.',code:'TERMINAL_UNKNOWN'};
     // The first login registers this browser only after verifying the staff PIN.
     // The shared bucket prevents bypassing the attempt limit with new devices.
     const bucket=(await tx.query("select * from tpv_bridge_private.login_limit where id=true for update")).rows[0];
     if(!bucket)return {error:'Acceso no preparado.'};
     if(Date.now()-new Date(bucket.window_start).getTime()>300000){bucket.attempts=0;await tx.query('update tpv_bridge_private.login_limit set attempts=0,window_start=now() where id=true');}
     if(bucket.attempts>=10)return {error:'Demasiados intentos. Espera cinco minutos.'};
     await tx.query('update tpv_bridge_private.login_limit set attempts=attempts+1 where id=true');
    }
    if(terminal&&Date.now()-new Date(terminal.window_start).getTime()>300000){terminal.attempts=0;await tx.query('update tpv_bridge_private.terminals set attempts=0,window_start=now() where id=$1',[terminal.id]);}
    if(terminal?.attempts>=10)return {error:'Demasiados intentos. Espera cinco minutos.'};
    const {rows}=await tx.query(`select e.*,s.display_name,s.role,s.pin_code from tpv_bridge_private.employees e join public.staff_profiles s on s.id=e.staff_id where e.active and s.active and ($1::text is null or s.id=$1)`,[staffId||null]);
    let employee;
    if(typeof pin==='string'&&/^\d{4,8}$/.test(pin))for(const row of rows){
     if(pin===row.pin_code){
      if(!match(await derive(pin,row.salt),row.pin_hash)){await provisionEmployee(tx,row.staff_id,row.permissions);row.version++;}
      employee=row;break;
     }
    }
    if(!employee){if(terminal)await tx.query('update tpv_bridge_private.terminals set attempts=attempts+1 where id=$1',[terminal.id]);return {error:'PIN no válido o empleado sin acceso.'};}
    if(!terminal){const id='web-'+randomBytes(16).toString('hex');enrolledDevice=await provisionTerminal(tx,id);terminal={id};await tx.query('update tpv_bridge_private.login_limit set attempts=0 where id=true');}
    const token=randomBytes(32).toString('base64url'),expiresAt=Date.now()+sessionMs;
    await tx.query('delete from tpv_bridge_private.sessions where terminal_id=$1 or expires_at<now()',[terminal.id]);
    await tx.query('insert into tpv_bridge_private.sessions values($1,$2,$3,$4,$5)',[hash(token),terminal.id,employee.staff_id,employee.version,new Date(expiresAt).toISOString()]);
    return {token,expiresAt,staffId:employee.staff_id,actorId:employee.actor_id,...(enrolledDevice?{device:enrolledDevice}:{}),profile:{id:employee.staff_id,display_name:employee.display_name,role:employee.role,active:true}};
   });
   if(result.error)throw Object.assign(Error(result.error),{code:result.code});return result;
  },
  async authorize(device,token,action,expectedActor){
   const row=(await db.query(`select s.*,e.permissions,e.actor_id,e.salt,e.pin_hash,p.pin_code,p.role,p.display_name
    from tpv_bridge_private.sessions s join tpv_bridge_private.terminals t on t.id=s.terminal_id
    join tpv_bridge_private.employees e on e.staff_id=s.staff_id
    join public.staff_profiles p on p.id=e.staff_id
    where s.token_hash=$1 and t.secret_hash=$2 and t.active and e.active and p.active and s.expires_at>now() and s.credential_version=e.version`,[hash(String(token||'')),hash(String(device||''))])).rows[0];
   if(!row||!match(await derive(row.pin_code,row.salt),row.pin_hash))throw Error('Introduce tu PIN para acceder a Fidelidad.');
   if(expectedActor&&expectedActor!==row.actor_id)throw Error('El empleado ha cambiado.');
   if(!['status','logout'].includes(action)&&!row.permissions.includes(action))throw Error('No tienes permiso para esta operación.');
   if(['promo_catalogue','promo_save','promo_holds','gift_points','withdraw_sale'].includes(action)&&row.role!=='admin')throw Error('Esta operación requiere encargado.');
   return {sourceProject,terminalId:row.terminal_id,employeeId:row.staff_id,actorId:row.actor_id,role:row.role,name:row.display_name};
  },
  async logout(token){await db.query('delete from tpv_bridge_private.sessions where token_hash=$1',[hash(String(token||''))]);},
 };
}
