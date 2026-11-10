import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildPaymentCorrection, createPaymentCorrectionDraft, paymentCorrectionSnapshot} from '../src/paymentCorrection.js';
import {buildSalesReport, REPORT_PAYMENT_METHODS} from '../src/salesReporting.js';
import {getTransactionChargedAmount} from '../src/transactionReporting.js';
import {reconcileTransactionPayments} from '../src/paymentAccounting.js';

const sale = {id:'sale-a', type:'sale', total:20, createdAt:'2026-11-07T10:00:00Z',
  items:[{name:'Latte',qty:4,price:5}], fiscalData:{fiscalNumber:'S2026-000001',hash:'unchanged'},
  payments:[{id:'sale-a-payment-001',method:'Tarjeta',saleAmount:20,amount:20,tipAmount:0,provider:'BBVA'}]};

test('forgotten card tip updates settlement, daily/monthly reports and drawer without changing the sale', () => {
  const original = structuredClone(sale);
  const draft = createPaymentCorrectionDraft(sale);
  draft[0].charged = '22,50';
  const tx = {...sale,...buildPaymentCorrection(sale,draft)};
  assert.equal(tx.tipAmount,2.5);
  assert.equal(tx.totalCharged,22.5);
  assert.equal(tx.total,20);
  assert.deepEqual(tx.fiscalData,sale.fiscalData);
  assert.deepEqual(tx.items,sale.items);
  assert.equal(getTransactionChargedAmount(tx,tx.payments,REPORT_PAYMENT_METHODS.CARD),22.5);
  const report = buildSalesReport([tx]);
  assert.equal(report.netSales,20);
  assert.equal(report.paymentMethods[REPORT_PAYMENT_METHODS.CARD],22.5);
  assert.equal(report.paymentMethods[REPORT_PAYMENT_METHODS.CASH],-2.5);
  assert.equal(report.days[0].paymentMethods[REPORT_PAYMENT_METHODS.CASH],-2.5);
  assert.equal(report.days[0].tips,2.5);
  assert.equal(reconcileTransactionPayments([tx]).isBalanced,true);
  assert.deepEqual(sale,original);
});

test('split corrections retain each sale allocation and allow tip removal or a cash/card correction', () => {
  const split = {...sale,payments:[{...sale.payments[0],amount:10,saleAmount:10},
    {id:'sale-a-payment-002',method:'Efectivo',saleAmount:10,amount:10}]};
  const draft = createPaymentCorrectionDraft(split);
  draft[0].charged = '12';
  let tx = {...split,...buildPaymentCorrection(split,draft)};
  assert.equal(tx.totalCharged,22);
  assert.equal(tx.payments[1].amount,10);
  const remove = createPaymentCorrectionDraft(tx);
  remove[0].charged = '';
  tx = {...tx,...buildPaymentCorrection(tx,remove)};
  assert.equal(tx.tipAmount,0);
  remove[0].method = 'Efectivo';
  assert.equal(buildPaymentCorrection(tx,remove).paymentMethod,'Efectivo');
});

test('invalid amounts, changed allocations, refunds and gift cards fail closed', () => {
  for (const charged of ['19.99','-1','NaN','Infinity','22.001','1e2','1000000']) {
    const draft = createPaymentCorrectionDraft(sale); draft[0].charged = charged;
    assert.throws(() => buildPaymentCorrection(sale,draft));
  }
  const cashTip = createPaymentCorrectionDraft(sale); cashTip[0].method = 'Efectivo'; cashTip[0].charged = '22';
  assert.throws(() => buildPaymentCorrection(sale,cashTip));
  for (const bad of [{...sale,total:21},{...sale,hasRefund:true},{...sale,type:'refund'},
    {...sale,payments:[{...sale.payments[0],provider:'Square'}]}]) {
    assert.throws(() => buildPaymentCorrection(bad,createPaymentCorrectionDraft(bad)));
  }
  assert.throws(() => buildPaymentCorrection(sale,[]));
});

test('real SQL correction is atomic, idempotent, concurrency-checked and preserves fiscal records, lines and tables', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table sales (id text primary key, type text, parent_sale_id text, total_amount numeric,
        payment_method text, has_refund boolean default false, refund_amount numeric default 0,
        closed_at timestamptz, created_at timestamptz, payload jsonb);
      create table sale_payments (id text primary key, sale_id text, method text, amount numeric,
        provider text, external_ref text, raw_payload jsonb);
      create table sale_lines (id text primary key, sale_id text, raw_payload jsonb, ticket_item_id text);
      create table fiscal_documents (id text primary key, sale_id text, fiscal_number text, hash text);
      create table tpv_state (id text primary key, tables jsonb, updated_at timestamptz);
      create table cash_closures (id text, business_date date, closed_at timestamptz);
      create table receipt_tickets (transaction_id text, payload jsonb);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261106210317_guard_kds_checkout.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261107213808_correct_sale_payments_atomically.sql',import.meta.url),'utf8'));
    await db.query("insert into sales values('sale-a','sale',null,20,'Tarjeta',false,0,'2026-11-07T10:00Z','2026-11-07T10:00Z',$1)",[JSON.stringify(sale)]);
    await db.query("insert into sale_payments values('sale-a-payment-001','sale-a','Tarjeta',20,'BBVA','ref',$1)",[JSON.stringify(sale.payments[0])]);
    await db.query("insert into sale_lines values('line','sale-a',$1,'original-line')",[JSON.stringify(sale.items[0])]);
    await db.exec("insert into fiscal_documents values('fiscal','sale-a','S2026-000001','unchanged'); insert into tpv_state values('global','[{\"id\":1,\"items\":[{\"ticketItemId\":\"other\",\"qty\":2}]}]',now())");
    await db.query("insert into receipt_tickets values('sale-a',$1)",[JSON.stringify(sale)]);
    await db.exec(`update sales set payload = payload || '{"kdsCheckout":{"tableId":"1"}}'::jsonb where id='sale-a'`);
    const immutable = async () => (await db.query(`select (select jsonb_agg(t) from fiscal_documents t) fiscal,
      (select jsonb_agg(t) from sale_lines t) lines, (select jsonb_agg(t) from tpv_state t) tables`)).rows;
    const before = await immutable();
    const snapshot = paymentCorrectionSnapshot(sale);
    const request = [{id:'sale-a-payment-001',method:'Tarjeta',amount:22.5}];
    const id1 = '00000000-0000-4000-8000-000000000001';
    const id2 = '00000000-0000-4000-8000-000000000002';
    const apply = async (expected,payments,id=id1) => (await db.query('select correct_tpv_sale_payments($1,$2,$3,$4) patch',
      [sale.id,JSON.stringify(expected),JSON.stringify(payments),id])).rows[0].patch;
    const first = await apply(snapshot,request);
    assert.equal(first.tipAmount,2.5);
    assert.equal(first.totalCharged,22.5);
    assert.deepEqual(await apply(snapshot,request),first);
    assert.equal(first.paymentCorrections.length,1);
    assert.deepEqual(await immutable(),before);
    assert.equal((await db.query('select payload from receipt_tickets')).rows[0].payload.tipAmount,2.5);
    assert.equal((await db.query('select total_amount from sales')).rows[0].total_amount,'20');
    await assert.rejects(apply(snapshot,[{...request[0],amount:23}],id2),/otro dispositivo/);
    await assert.rejects(apply(snapshot,[{...request[0],amount:23}],id1),/otra correccion/);
    const current = paymentCorrectionSnapshot({...sale,...first});
    for (const edits of [[{...request[0],amount:19}],[{...request[0],method:'Efectivo'}],[],[{...request[0],amount:22.501}]]) {
      await assert.rejects(apply(current,edits,id2));
    }
    // A late failure must roll back both the normalized payment and sales payload.
    await db.exec(`create function fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'receipt failed'; end; $$;
      create trigger fail before update on receipt_tickets for each row execute function fail_receipt();`);
    await assert.rejects(apply(current,[{...request[0],amount:24}],id2),/receipt failed/);
    assert.equal((await db.query('select amount from sale_payments')).rows[0].amount,'22.5');
    await db.exec('drop trigger fail on receipt_tickets');
    await db.exec("insert into cash_closures values('closed','2026-11-07','2026-11-07T20:00Z')");
    await assert.rejects(apply(current,[{...request[0],amount:24}],id2),/cerrado/);
    assert.deepEqual(await apply(snapshot,request),first,'retry after closure is read-only');
    await db.exec('delete from cash_closures');
    await db.exec("update sales set has_refund=true where id='sale-a'");
    await assert.rejects(apply(current,request,id2),/devolucion/);
    await db.exec("update sales set has_refund=false where id='sale-a'");
    const concurrent = await Promise.allSettled([apply(current,[{...request[0],amount:24}],id2),
      apply(current,[{...request[0],amount:25}],'00000000-0000-4000-8000-000000000003')]);
    assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
    assert.deepEqual(await immutable(),before);
  } finally {await db.close();}
});
