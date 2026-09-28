// Another worker may already own the lease. Wait for that same operation;
// never create a second mutation or report a still-running read as a failure.
export async function waitForOperation(db,id,{timeoutMs=9500,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const deadline=Date.now()+timeoutMs;
 let row;
 do{
  row=(await db.query('select * from tpv_bridge_private.outbox where id=$1',[id])).rows[0];
  if(row?.state!=='sending'||Date.now()>=deadline)return row;
  await pause(120);
 }while(true);
}
