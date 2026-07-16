import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const validateOnly = args.includes('validate-only');
const listExisting = args.includes('list-existing');
const inputArg = args.find(arg => !['validate-only', 'list-existing'].includes(arg)) || '-';

function parseEnv(content) {
  return String(content || '').split(/\r?\n/).reduce((env, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return env;
    const separator = trimmed.indexOf('=');
    if (separator < 1) return env;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
    return env;
  }, {});
}

async function loadEnvironment() {
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await readFile('.env.local', 'utf8'));
  } catch {
    // CI and automations may provide environment variables directly.
  }

  const url = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.');
  return { url, key };
}

async function readInput() {
  const raw = inputArg === '-'
    ? await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      })
    : await readFile(inputArg, 'utf8');

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.invoices;
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function normalizeInvoiceNumber(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function finiteNumber(value, fallback = 0) {
  const number = typeof value === 'string'
    ? Number(value.replace(/\s/g, '').replace(',', '.'))
    : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = finiteNumber(value, Number.NaN);
  return Number.isFinite(number) ? number : null;
}

function deterministicId(sourceId) {
  return `ai-${createHash('sha256').update(sourceId).digest('hex').slice(0, 24)}`;
}

function normalizeInvoice(invoice, index) {
  const source = ['drive', 'gmail'].includes(invoice.source) ? invoice.source : 'drive';
  const sourceId = String(invoice.sourceId || invoice.source_id || '').trim();
  const supplierName = String(invoice.supplierName || invoice.proveedor || '').trim();
  const invoiceDate = String(invoice.invoiceDate || invoice.fecha || '').slice(0, 10);
  if (!sourceId) throw new Error(`Factura ${index + 1}: falta sourceId.`);
  if (!supplierName) throw new Error(`Factura ${index + 1}: falta supplierName.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
    throw new Error(`Factura ${index + 1}: invoiceDate debe usar YYYY-MM-DD.`);
  }

  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  return {
    id: deterministicId(sourceId),
    source,
    sourceId,
    supplierName,
    invoiceNumber: String(invoice.invoiceNumber || invoice.factura || '').trim(),
    invoiceDate,
    category: String(invoice.category || invoice.categoria || '').trim(),
    baseAmount: finiteNumber(invoice.baseAmount ?? invoice.base_amount),
    taxRate: finiteNumber(invoice.taxRate ?? invoice.tax_rate),
    taxAmount: finiteNumber(invoice.taxAmount ?? invoice.tax_amount),
    totalAmount: finiteNumber(invoice.totalAmount ?? invoice.total_amount),
    deductible: invoice.deductible !== false,
    senderEmail: String(invoice.senderEmail || invoice.sender_email || '').trim().toLowerCase(),
    fileName: String(invoice.fileName || invoice.file_name || '').trim(),
    fileUrl: String(invoice.fileUrl || invoice.file_url || '').trim(),
    notes: String(invoice.notes || '').trim(),
    lines: lines.map((line, lineIndex) => ({
      id: `${deterministicId(sourceId)}-line-${String(lineIndex + 1).padStart(3, '0')}`,
      supplier_name: supplierName,
      invoice_date: invoiceDate,
      description: String(line.description || line.articulo_normalizado || line.articulo_original || '').trim(),
      quantity: optionalNumber(line.quantity ?? line.cantidad),
      unit_price: optionalNumber(line.unitPrice ?? line.precio_unitario),
      total_amount: optionalNumber(line.totalAmount ?? line.importe),
      tax_rate: optionalNumber(line.taxRate ?? line.tax_rate),
      raw_payload: line
    })).filter(line => line.description)
  };
}

function exactInvoiceKey(invoice) {
  const number = normalizeInvoiceNumber(invoice.invoiceNumber || invoice.invoice_number);
  if (!number) return '';
  return `${normalizeText(invoice.supplierName || invoice.supplier_name)}:${number}`;
}

async function main() {
  const { url, key } = await loadEnvironment();
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: existing, error: existingError } = await supabase
    .from('supplier_invoices')
    .select('id,source_id,supplier_name,invoice_number,invoice_date,total_amount');
  if (existingError) throw existingError;

  if (listExisting) {
    console.log(JSON.stringify({
      sourceIds: (existing || []).map(row => row.source_id).filter(Boolean),
      invoices: (existing || []).map(row => ({
        supplierName: row.supplier_name,
        invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date
      }))
    }, null, 2));
    return;
  }

  const rawInvoices = await readInput();
  if (!Array.isArray(rawInvoices)) throw new Error('El JSON debe contener un array invoices.');
  const invoices = rawInvoices.map(normalizeInvoice);

  const existingSourceIds = new Set((existing || []).map(row => row.source_id).filter(Boolean));
  const existingInvoiceKeys = new Set((existing || []).map(exactInvoiceKey).filter(Boolean));
  const incomingSourceIds = new Set();
  const incomingInvoiceKeys = new Set();
  const summary = { received: invoices.length, importable: 0, imported: 0, duplicates: 0, errors: [], validateOnly };

  for (const invoice of invoices) {
    const invoiceKey = exactInvoiceKey(invoice);
    const duplicate = existingSourceIds.has(invoice.sourceId) ||
      incomingSourceIds.has(invoice.sourceId) ||
      (invoiceKey && (existingInvoiceKeys.has(invoiceKey) || incomingInvoiceKeys.has(invoiceKey)));

    if (duplicate) {
      summary.duplicates += 1;
      continue;
    }

    incomingSourceIds.add(invoice.sourceId);
    if (invoiceKey) incomingInvoiceKeys.add(invoiceKey);
    summary.importable += 1;
    if (validateOnly) {
      continue;
    }

    const row = {
      id: invoice.id,
      supplier_name: invoice.supplierName,
      invoice_number: invoice.invoiceNumber || null,
      invoice_date: invoice.invoiceDate,
      category: invoice.category || null,
      base_amount: invoice.baseAmount,
      tax_rate: invoice.taxRate,
      tax_amount: invoice.taxAmount,
      total_amount: invoice.totalAmount,
      deductible: invoice.deductible,
      status: 'pending_review',
      source: invoice.source,
      source_id: invoice.sourceId,
      sender_email: invoice.senderEmail || null,
      file_name: invoice.fileName || null,
      file_url: invoice.fileUrl || null,
      notes: invoice.notes || 'Importada automaticamente por Codex. Pendiente de revision.',
      updated_at: new Date().toISOString()
    };

    const { error: invoiceError } = await supabase.from('supplier_invoices').insert(row);
    if (invoiceError) {
      summary.errors.push({ sourceId: invoice.sourceId, message: invoiceError.message });
      continue;
    }

    if (invoice.lines.length) {
      const lineRows = invoice.lines.map(line => ({ ...line, invoice_id: invoice.id }));
      const { error: linesError } = await supabase.from('supplier_invoice_lines').insert(lineRows);
      if (linesError) {
        await supabase.from('supplier_invoices').delete().eq('id', invoice.id);
        summary.errors.push({ sourceId: invoice.sourceId, message: linesError.message });
        continue;
      }
    }

    summary.imported += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
