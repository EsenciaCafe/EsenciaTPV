import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {createPinAuth,provisionEmployee,cashierPermissions} from '../auth.mjs';
test('first PIN login registers a terminal, preserves staff identity, revokes changed PIN and limits guesses',async()=>{
 const db=new PGlite();try{
 await db.exec("create schema tpv_bridge_private;create table public.staff_profiles(id text primary key,display_name text,role text,pin_code text,active boolean);insert into staff_profiles values('a','Empleado','staff','5678',true);");
 const schema=await readFile(new URL('../tpv-schema.sql',import.meta.url),'utf8');await db.exec(schema.slice(schema.indexOf('create table tpv_bridge_private.terminals'),schema.indexOf('create table tpv_bridge_private.applications')));
 await db.exec('create table tpv_bridge_private.login_limit(id boolean primary key,attempts integer default 0,window_start timestamptz default now());insert into tpv_bridge_private.login_limit(id) values(true);');
 await provisionEmployee(db,'a',cashierPermissions);const auth=createPinAuth({db,sourceProject:'test'});
 const first=await auth.login('','5678','a');assert.ok(first.device);assert.equal((await auth.authorize(first.device,first.token,'lookup')).employeeId,'a');
 await db.query("update staff_profiles set pin_code='8765' where id='a'");
 await assert.rejects(()=>auth.authorize(first.device,first.token,'lookup'),/PIN/);
 const second=await auth.login(first.device,'8765','a');assert.equal(second.device,undefined);assert.ok(second.token);await assert.rejects(()=>auth.authorize(first.device,first.token,'lookup'),/PIN/);
 for(let n=0;n<10;n++)await assert.rejects(()=>auth.login('','wrong','a'),/PIN/);
 await assert.rejects(()=>auth.login('','8765','a'),/Demasiados/);
 assert.equal((await db.query('select count(*)::integer n from tpv_bridge_private.terminals')).rows[0].n,1);
 }finally{await db.close();}
});
