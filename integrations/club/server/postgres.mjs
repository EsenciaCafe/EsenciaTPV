// One checked-out connection for the fiscal write and its durable outbox.
export function postgresAdapter(pool){
 return {
  query:(sql,params)=>pool.query(sql,params),
  async transaction(fn){
   const client=await pool.connect();let started=false,discard=false;
   try{
    await client.query('BEGIN');started=true;
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result=await fn({query:(sql,params)=>client.query(sql,params)});
    await client.query('COMMIT');return result;
   }catch(error){
    if(started)try{await client.query('ROLLBACK');}catch{discard=true;}
    throw error;
   }finally{client.release(discard);}
  },
 };
}
