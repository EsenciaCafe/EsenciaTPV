import {createHash,randomUUID} from 'node:crypto';
import {invoiceCustomer,invoiceSource} from '../../../src/customerInvoice.js';

const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const invoiceHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const saleId = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error('Venta no válida.');
  return value;
};
async function source(db,id,lock=false) {
  const sale = (await db.query(`select * from public.sales where id=$1${lock?' for update':''}`,[id])).rows[0];
  const fiscal = (await db.query('select * from public.fiscal_documents where sale_id=$1',[id])).rows[0];
  const refunds = (await db.query("select 1 from public.sales where parent_sale_id=$1 and type='refund' limit 1",[id])).rows;
  if (refunds.length) throw Error('La venta tiene una devolución. Requiere revisión antes de facturar.');
  return invoiceSource(sale,fiscal);
}
export async function getCustomerInvoice(db,id) {
  id = saleId(id);
  const row = (await db.query('select document from tpv_bridge_private.customer_invoices where sale_id=$1',[id])).rows[0];
  if (row) return {invoice:row.document};
  const snapshot = await source(db,id);
  return {invoice:null,source:snapshot,sourceHash:invoiceHash(snapshot)};
}
export async function issueCustomerInvoice(db,context,input) {
  const id = saleId(input.saleId), customer = invoiceCustomer(input.customer);
  return db.transaction(async tx => {
    // One lock covers numbering, immutable hash linkage and same-sale retries across terminals.
    await tx.query("select pg_advisory_xact_lock(hashtext('esencia-customer-invoices'))");
    const existing = (await tx.query('select document from tpv_bridge_private.customer_invoices where sale_id=$1',[id])).rows[0]?.document;
    if (existing) {
      if (JSON.stringify(invoiceCustomer(existing.customer)) !== JSON.stringify(customer)) throw Error('Esta venta ya tiene una factura con otros datos. No se ha emitido otra.');
      return existing;
    }
    const snapshot = await source(tx,id,true);
    if (input.sourceHash !== invoiceHash(snapshot)) throw Error('El ticket ha cambiado desde la revisión. Cierra y vuelve a abrir la factura.');
    const {issued_at,invoice_year} = (await tx.query("select issued_at, to_char(issued_at at time zone 'Atlantic/Canary','YYYY') as invoice_year from (select clock_timestamp() as issued_at) t")).rows[0];
    const series = `F${invoice_year}`;
    const {number} = (await tx.query(`insert into tpv_bridge_private.customer_invoice_counters(series,next_number) values($1,2)
      on conflict(series) do update set next_number=tpv_bridge_private.customer_invoice_counters.next_number+1 returning next_number-1 number`,[series])).rows[0];
    const previousHash = (await tx.query('select hash from tpv_bridge_private.customer_invoices order by ordinal desc limit 1')).rows[0]?.hash || null;
    const document = {...snapshot,id:randomUUID(),schema:'customer-invoice/v1',documentType:'replacement_invoice',
      fiscalNumber:`${series}-${String(number).padStart(6,'0')}`,issuedAt:new Date(issued_at).toISOString(),customer,
      createdBy:{staffId:context.employeeId,terminalId:context.terminalId},previousHash,addsRevenue:false};
    const hash = invoiceHash(document);
    document.hash = hash;
    await tx.query(`insert into tpv_bridge_private.customer_invoices(id,sale_id,original_document_id,series,number,hash,document)
      values($1,$2,$3,$4,$5,$6,$7::jsonb)`,[document.id,id,snapshot.original.id,series,number,hash,JSON.stringify(document)]);
    return document;
  });
}
