import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { checkoutSnapshot, sameCheckoutItems, openCheckoutTables, checkoutUrl, checkoutTableId, fetchCheckoutTable, giftCardOrderReference } from '../src/kdsCheckout.js';

const items = [{ ticketItemId: 'line-a', id: 'coffee', name: 'Cafe', qty: 2, price: 3, discountPercent: 0, selectedOptions: [] }];
const table = { id: 'mesa-1', name: 'Mesa 1', status: 'occupied', items };
const sale = (id, kds = true) => ({ id, type: 'sale', table: 'Mesa 1', total: 6, itemsCount: 2, items,
  paymentMethod: 'Mixto', payments: [{ method: 'Tarjeta', amount: 3 }, { method: 'Efectivo', amount: 3 }],
  ...(kds ? { kdsCheckout: { tableId: table.id, snapshot: checkoutSnapshot(items) } } : {}) });

test('KDS selects open accounts even if kitchen is ready and never accepts a return URL', () => {
  assert.deepEqual(openCheckoutTables([{ ...table, status: 'ready' }, { id: 2, items: [] }]).map(t => t.id), ['mesa-1']);
  assert.equal(checkoutTableId('?kdsCheckout=mesa-1'), 'mesa-1');
  assert.equal(checkoutUrl('mesa-1', 'https://example.com/EsenciaTPV/kds.html'), 'https://example.com/EsenciaTPV/index.html?kdsCheckout=mesa-1');
  assert.equal(sameCheckoutItems(items, structuredClone(items)), true);
  for (const change of [{ price: 4 }, { qty: 1 }, { discountPercent: 100 }, { selectedOptions: [{ name: 'Leche', qty: 1, price: 1 }] }]) {
    assert.equal(sameCheckoutItems(items, [{ ...items[0], ...change }]), false);
  }
});

test('KDS fails closed without the migration or connection', async () => {
  await assert.rejects(fetchCheckoutTable({ rpc: async () => ({ error: { code: 'PGRST202' } }) }, table.id), /Supabase/);
  await assert.rejects(fetchCheckoutTable({ rpc: async () => ({ error: { message: 'Sin conexion' } }) }, table.id), /Sin conexion/);
  assert.deepEqual(await fetchCheckoutTable({ rpc: async () => ({ data: table }) }, table.id), table);
});

test('Square redemption has one idempotency key per order across TPV/KDS, retries and item ordering', async () => {
  const order = [...items, { ...items[0], ticketItemId: 'line-b' }];
  const key = await giftCardOrderReference(order);
  assert.equal(key, await giftCardOrderReference([...order].reverse()));
  assert.equal(key, await giftCardOrderReference(order.map(item => ({ ...item, qty: item.qty + 1 }))));
  assert.notEqual(key, await giftCardOrderReference([{ ...items[0], ticketItemId: 'new-order' }]));
  await assert.rejects(giftCardOrderReference([{ qty: 1 }]), /identificadores/);
});

test('real SQL finalizer: atomic KDS closure, duplicate protection, retries, rollback and unrelated orders', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema extensions;
      create table tpv_state (id text primary key, tables jsonb, updated_at timestamptz);
      create table sales (id text primary key, type text, parent_sale_id text, table_name text,
        total_amount numeric, payment_method text, items_count int, receipt_token text,
        staff_id text, staff_name text, closed_at timestamptz, created_at timestamptz,
        legal_data jsonb, loyalty_data jsonb, refund_amount numeric, refund_reason text, has_refund boolean, payload jsonb);
      create table sale_lines (id text primary key, sale_id text, item_id text, ticket_item_id text,
        name text, quantity numeric, unit_price numeric, total_amount numeric, selected_options jsonb, raw_payload jsonb);
      create table sale_payments (id text primary key, sale_id text, method text, amount numeric,
        provider text, external_ref text, raw_payload jsonb);
      create table fiscal_documents (id serial primary key, sale_id text unique, fiscal_number text);
      create function create_fiscal_document(p_id text, p_type text) returns fiscal_documents language plpgsql as $$
      declare doc fiscal_documents; begin
        if p_id = 'fail-fiscal' then raise exception 'Fiscal unavailable'; end if;
        insert into fiscal_documents(sale_id,fiscal_number) values(p_id, 'S-' || p_id) returning * into doc;
        return doc;
      end; $$;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260810182033_finalize_online_sales_atomically.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20260801171815_guard_table_state_revisions.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261106210317_guard_kds_checkout.sql', import.meta.url), 'utf8'));
    const reset = async (rows = [table, { id: 'other', items: [{ ticketItemId: 'other-line', qty: 1 }] }]) => {
      await db.exec('truncate sales, sale_lines, sale_payments, fiscal_documents, tpv_state');
      await db.query("insert into tpv_state values ('global', $1, now())", [JSON.stringify(rows)]);
    };
    const finalize = async tx => (await db.query('select * from finalize_tpv_sale($1)', [JSON.stringify(tx)])).rows[0];
    const currentTables = async () => (await db.query('select tables from tpv_state')).rows[0].tables;
    await reset();
    const snapshot = (await db.query('select kds_checkout_snapshot($1) snapshot', [JSON.stringify(items)])).rows[0].snapshot;
    assert.deepEqual(snapshot, checkoutSnapshot(items));
    const first = await finalize(sale('first'));
    assert.equal(first.fiscal_number, 'S-first');
    assert.deepEqual((await currentTables())[0].items, []);
    assert.equal((await currentTables())[0].syncRevision, 1);
    assert.equal((await currentTables())[1].items.length, 1);
    assert.equal((await finalize(sale('first'))).id, first.id, 'lost response retries the same fiscal document');
    assert.equal((await db.query('select count(*)::int n from sales')).rows[0].n, 1);
    assert.equal((await db.query('select sum(amount)::int n from sale_payments')).rows[0].n, 6);
    await assert.rejects(finalize(sale('second-device')), /ya se ha cobrado/);
    await assert.rejects(finalize(sale('normal-tpv', false)), /ya se ha cobrado/);
    // A subsequent order on the same table must survive edits to the previous sale.
    const next = [{ ...(await currentTables())[0], items: [{ ...items[0], ticketItemId: 'next' }] }, (await currentTables())[1]];
    await db.query('update tpv_state set tables=$1', [JSON.stringify(next)]);
    const savedNext = await currentTables();
    await db.exec("update sales set has_refund=true where id='first'");
    await db.query("insert into sales(id,type,payload) values('first','sale',$1) on conflict(id) do update set payment_method='Efectivo'", [JSON.stringify(sale('first'))]);
    assert.deepEqual(await currentTables(), savedNext);
    await finalize({ ...sale('refund', false), type: 'refund', total: -6 });

    await reset();
    await finalize(sale('normal-first', false));
    await assert.rejects(finalize(sale('kds-second')), /ya se ha cobrado/);
    await reset([{ ...table, items: [{ ...items[0], price: 4 }] }]);
    await assert.rejects(finalize(sale('changed')), /mesa ha cambiado/);
    assert.equal((await db.query('select count(*)::int n from sales')).rows[0].n, 0);
    await reset();
    await assert.rejects(finalize(sale('fail-fiscal')), /Fiscal unavailable/);
    assert.deepEqual((await currentTables())[0].items, items, 'fiscal failure rolls back table closure');
    assert.equal((await db.query('select count(*)::int n from sale_lines')).rows[0].n, 0);
    const attempts = await Promise.allSettled([finalize(sale('concurrent-a')), finalize(sale('concurrent-b'))]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await db.query('select count(*)::int n from fiscal_documents')).rows[0].n, 1);
  } finally { await db.close(); }
});
