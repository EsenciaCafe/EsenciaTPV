import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {invoiceCustomer,invoiceSource,validSpanishTaxId} from '../src/customerInvoice.js';
import {getCustomerInvoice,issueCustomerInvoice,invoiceHash} from '../integrations/club/server/customer-invoices.mjs';
import {createTpvBridge} from '../integrations/club/server/service.mjs';

const customer={name:'Cliente de prueba',taxId:'12345678Z',address:'Calle de prueba 1',postalCode:'35001',city:'Las Palmas de Gran Canaria',province:'Las Palmas'};
const sale={id:'sale-invoice',type:'sale',total_amount:15.70,closed_at:'2026-11-13T10:00:00Z',has_refund:false};
const items=[{name:'Café con Leche',qty:1,price:1.5,total:1.7,selectedOptions:[{name:'Leche Almendras',qty:1,price:0.2}]},
  {name:'Té Frío',qty:1,price:2.5,total:2.5},
  {name:'Tostas',qty:1,price:1.5,total:6,selectedOptions:[{name:'Serrano QCrema',qty:1,price:4.5}]},
  {name:'Tostas',qty:1,price:1.5,total:5.5,selectedOptions:[{name:'Aguacate',qty:1,price:4}]}];
const fiscal={id:'fiscal-test',sale_id:sale.id,status:'issued',document_type:'simplified_invoice',fiscal_number:'S2026-PRUEBA',hash:'original-hash',issued_at:sale.closed_at,
  legal_data:{companyName:'Emisor de prueba',nif:'12345678Z',address:'Dirección de prueba'},
  tax_name:'IGIC',tax_rate:7,taxable_base:14.67,tax_amount:1.03,total_amount:15.70,payload:{items,tipAmount:3,totalCharged:18.7}};

test('customer validation requires real structured data and valid Spanish tax checksums',()=>{
  assert.equal(invoiceCustomer({...customer,taxId:'12.345.678-z'}).taxId,'12345678Z');
  assert.equal(validSpanishTaxId('B12345674'),true);
  assert.equal(validSpanishTaxId('X1234567L'),true);
  for(const taxId of ['12345678A','B12345670','123','',null]) assert.throws(()=>invoiceCustomer({...customer,taxId}));
  for(const key of ['name','address','postalCode','city','province']) assert.throws(()=>invoiceCustomer({...customer,[key]:''}));
});

test('source uses original fiscal amounts, modifiers and discounts, never tips or current menu',()=>{
  const snapshot=invoiceSource(sale,fiscal);
  assert.equal(snapshot.total,15.7);assert.equal(snapshot.base,14.67);assert.equal(snapshot.tax,1.03);
  assert.equal(Math.round((snapshot.lines.reduce((sum,l)=>sum+l.base,0)+snapshot.roundingBase)*100),1467);
  assert.equal(snapshot.lines[1].base,2.34);
  assert.equal(snapshot.roundingBase,-0.01);
  assert.match(snapshot.lines[0].options[0],/Almendras/);
  assert.equal(snapshot.lines[0].unitNet,1.5888);
  const discounted=structuredClone(fiscal);
  discounted.payload.items[0].price=2;
  assert.equal(invoiceSource(sale,discounted).lines[0].discountNet,0.47);
  for(const changed of [{...fiscal,status:'cancelled'},{...fiscal,hash:''},{...fiscal,tax_amount:0},{...fiscal,payload:{items:[]}},
    {...fiscal,payload:{items:items.slice(1)}},{...fiscal,legal_data:{}}])assert.throws(()=>invoiceSource(sale,changed));
  assert.throws(()=>invoiceSource({...sale,has_refund:true},fiscal));
  assert.throws(()=>invoiceSource({...sale,type:'refund'},fiscal));
});

test('invoice issuance is atomic, immutable, idempotent and leaves sales/fiscal snapshots unchanged',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema tpv_bridge_private;
      create table tpv_bridge_private.employees(staff_id text,permissions text[]);
      insert into tpv_bridge_private.employees values('staff',array['finalize_sale']);
      create table sales(id text primary key,type text,total_amount numeric,closed_at timestamptz,created_at timestamptz,has_refund boolean,refund_amount numeric,parent_sale_id text);
      create table fiscal_documents(id text primary key,sale_id text,status text,document_type text,fiscal_number text,hash text,issued_at timestamptz,legal_data jsonb,tax_name text,tax_rate numeric,taxable_base numeric,tax_amount numeric,total_amount numeric,payload jsonb);`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261116072723_customer_invoices.sql',import.meta.url),'utf8'));
    const adapter={query:(...args)=>db.query(...args),transaction:fn=>db.transaction(tx=>fn({query:(...args)=>tx.query(...args)}))};
    const addSale=async(id='sale-invoice',amount=15.7)=>{
      await db.query("insert into sales(id,type,total_amount,closed_at,has_refund) values($1,'sale',$2,$3,false)",[id,amount,sale.closed_at]);
      await db.query(`insert into fiscal_documents values($1,$2,'issued','simplified_invoice',$3,'original-hash',$4,$5,'IGIC',7,14.67,1.03,15.70,$6)`,
        [id+'-fiscal',id,'S-TEST-'+id,sale.closed_at,JSON.stringify(fiscal.legal_data),JSON.stringify(fiscal.payload)]);
    };
    await addSale();
    const before=(await db.query('select (select jsonb_agg(s) from sales s) sales,(select jsonb_agg(f) from fiscal_documents f) fiscal')).rows;
    const context={employeeId:'staff',terminalId:'terminal'};
    const input={saleId:sale.id,customer};
    const pending=await getCustomerInvoice(adapter,sale.id);assert.equal(pending.invoice,null);
    input.sourceHash=pending.sourceHash;
    assert.equal(pending.source.total,15.7);
    await assert.rejects(issueCustomerInvoice(adapter,context,{...input,customer:{...customer,taxId:'wrong'}}));
    const [a,b]=await Promise.all([issueCustomerInvoice(adapter,context,input),issueCustomerInvoice(adapter,{...context,terminalId:'other'},input)]);
    assert.deepEqual(a,b);assert.match(a.fiscalNumber,/^F\d{4}-000001$/);
    assert.equal(a.addsRevenue,false);assert.equal(a.total,15.7);
    assert.deepEqual((await getCustomerInvoice(adapter,sale.id)).invoice,a);
    const stored=(await getCustomerInvoice(adapter,sale.id)).invoice;
    const {hash,...hashContent}=stored;assert.equal(invoiceHash(hashContent),hash);
    await assert.rejects(issueCustomerInvoice(adapter,context,{...input,customer:{...customer,name:'Otro cliente'}}),/otros datos/);
    assert.deepEqual((await db.query('select (select jsonb_agg(s) from sales s) sales,(select jsonb_agg(f) from fiscal_documents f) fiscal')).rows,before);
    assert.equal((await db.query('select count(*) count from tpv_bridge_private.customer_invoices')).rows[0].count,1);
    await assert.rejects(db.query('update tpv_bridge_private.customer_invoices set document=$1',[JSON.stringify({...a,total:1})]),/inmutable/);
    await assert.rejects(db.query('delete from tpv_bridge_private.customer_invoices'),/inmutable/);
    const permissions=(await db.query('select permissions from tpv_bridge_private.employees')).rows[0].permissions;
    assert.ok(permissions.includes('finalize_sale')&&permissions.includes('invoice_issue'));
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from tpv_bridge_private.customer_invoices'),/permission denied/);
    await db.exec('reset role');
    await addSale('next');
    const nextInput={...input,saleId:'next',sourceHash:(await getCustomerInvoice(adapter,'next')).sourceHash};
    await assert.rejects(issueCustomerInvoice(adapter,context,{...nextInput,sourceHash:'stale'}),/ha cambiado/);
    await db.exec(`create function fail_invoice() returns trigger language plpgsql as $$begin raise exception 'simulated persistence failure';end;$$;
      create trigger fail_invoice before insert on tpv_bridge_private.customer_invoices for each row execute function fail_invoice();`);
    await assert.rejects(issueCustomerInvoice(adapter,context,nextInput),/simulated persistence/);
    assert.equal((await db.query('select next_number from tpv_bridge_private.customer_invoice_counters')).rows[0].next_number,2);
    await db.exec('drop trigger fail_invoice on tpv_bridge_private.customer_invoices');
    const next=await issueCustomerInvoice(adapter,context,nextInput);
    assert.match(next.fiscalNumber,/-000002$/);assert.equal(next.previousHash,a.hash);
    await addSale('refunded');
    await db.query("insert into sales(id,type,parent_sale_id) values('refund','refund','refunded')");
    await assert.rejects(issueCustomerInvoice(adapter,context,{...input,saleId:'refunded'}),/devolución/);
    await addSale('unfiscalized');await db.query("delete from fiscal_documents where sale_id='unfiscalized'");
    await assert.rejects(issueCustomerInvoice(adapter,context,{...input,saleId:'unfiscalized'}),/documento fiscal/);
    // Backend dispatch must authorize before any access to customer PII.
    const queries=[];
    const denied=createTpvBridge({db:{query:async sql=>{queries.push(sql);return {rows:[]};}},send:async()=>{},sourceProject:'test'});
    for(const action of ['invoice_get','invoice_issue'])await assert.rejects(denied.call({p_action:action,p_payload:input}),/PIN/);
    assert.ok(queries.every(sql=>!sql.includes('customer_invoices')));
  }finally{await db.close();}
});
