import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {assignmentDetails} from '../assignment-details.mjs';

test('assignment receipt follows withdrawal/reassignment and the TPV employee, not the shared Club actor', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema tpv_bridge_private;
      create table staff_profiles(id text, display_name text);
      create table tpv_bridge_private.outbox(id uuid, source text, body text);
      create table tpv_bridge_private.completed_sales(award_operation uuid, context jsonb);
      create table tpv_bridge_private.member_labels(id text, name text);
      insert into staff_profiles values ('cashier','Isabel nueva'),('manager','Joel');
      insert into tpv_bridge_private.member_labels values ('a','Ana'),('b','Bea');
      insert into tpv_bridge_private.outbox values
        ('00000000-0000-4000-8000-000000000001','tpv','{"employee_id":"cashier"}'),
        ('00000000-0000-4000-8000-000000000002','tpv','{"employee_id":"manager"}'),
        ('00000000-0000-4000-8000-000000000003','tpv','{"employee_id":"manager"}');
      insert into tpv_bridge_private.completed_sales values
        ('00000000-0000-4000-8000-000000000001','{"name":"Isabel al cobrar"}');
    `);
    const history = [1,2,3].map(version => ({version, operation_id: `00000000-0000-4000-8000-00000000000${version}`, actor:'shared-club-account', reason:version===2?'Error de cliente':'assign'}));
    const state = (version, active, member_id) => ({version, assignment:{version,active,member_id,delta:400},history:history.slice(0,version)});
    const first = await assignmentDetails(db, 'tpv', state(1,true,'a'));
    assert.equal(first.name,'Ana');
    assert.deepEqual(first.assignedBy,{id:'cashier',name:'Isabel al cobrar'});
    const withdrawn = await assignmentDetails(db,'tpv',state(2,false,'a'));
    assert.equal(withdrawn.name,'');
    assert.equal(withdrawn.assignedBy,null);
    const reassigned = await assignmentDetails(db,'tpv',state(3,true,'b'));
    assert.equal(reassigned.name,'Bea');
    assert.deepEqual(reassigned.assignedBy,{id:'manager',name:'Joel'});
    assert.equal(reassigned.history[0].employee.name,'Isabel al cobrar');
    assert.equal((await assignmentDetails(db,'other-origin',state(3,true,'b'))).assignedBy,null);
    assert.equal((await assignmentDetails(db,'tpv',{version:0,assignment:null,history:[]})).active,false);
  } finally { await db.close(); }
});
