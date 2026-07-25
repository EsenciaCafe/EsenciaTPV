export const SUPPLIER_SCHEMA_VERSION = 'supplier-document/v1';
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const SUPPORTED_INVOICE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

const DOCUMENT_TYPES = new Set(['invoice', 'ticket', 'expense', 'payroll', 'asset', 'credit_note']);
const TAX_SCOPES = new Set(['taxable', 'exempt', 'not_subject']);
const TAX_RATES = new Set([0, 3, 5, 7, 9.5, 15]);

export function folderId(value = '') {
  return String(value).match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || String(value).trim();
}

export function driveFolderUrl(id = '') {
  return id ? `https://drive.google.com/drive/folders/${encodeURIComponent(id)}` : '';
}

export function driveFileUrl(id = '') {
  return id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '';
}

export function isSupportedInvoiceFile(file = {}) {
  return SUPPORTED_INVOICE_MIME_TYPES.has(file.mimeType)
    || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function reviewNumber(value, fallback = 0) {
  const number = finiteNumber(value);
  return number == null ? fallback : number;
}

function reviewDate(value, fallback = '') {
  return validIsoDate(value) ? value : fallback;
}

export function reviewableSupplierDocument(payload = {}, fallback = {}) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const extracted = root.extracted && typeof root.extracted === 'object' && !Array.isArray(root.extracted)
    ? root.extracted
    : root;
  const invoice = extracted.invoice && typeof extracted.invoice === 'object' ? extracted.invoice : {};
  const supplier = extracted.supplier && typeof extracted.supplier === 'object' ? extracted.supplier : {};
  const rawLines = Array.isArray(extracted.lines) && extracted.lines.length
    ? extracted.lines
    : [{
        description: 'Revisar los datos de la factura original',
        quantity: 1,
        unit_price: 0,
        taxable_base: 0,
        tax_rate: 0,
        tax_amount: 0,
        tax_scope: 'taxable'
      }];

  const lines = rawLines.map((item, index) => {
    const quantity = reviewNumber(item?.quantity, 1) || 1;
    const taxableBase = reviewNumber(item?.taxable_base, 0);
    const unitPrice = finiteNumber(item?.unit_price)
      ?? (quantity ? taxableBase / quantity : 0);
    const taxScope = TAX_SCOPES.has(item?.tax_scope) ? item.tax_scope : 'taxable';
    const rawRate = reviewNumber(item?.tax_rate, 0);
    return {
      id: '',
      supplier_item_code: String(item?.supplier_item_code || ''),
      description: String(item?.description || `Artículo pendiente ${index + 1}`),
      quantity,
      unit_price: unitPrice,
      taxable_base: taxableBase,
      manual_taxable_base: true,
      tax_scope: taxScope,
      tax_rate: taxScope === 'taxable' ? rawRate : 0,
      tax_amount: reviewNumber(item?.tax_amount, 0),
      manual_tax_amount: true,
      withholding_rate: reviewNumber(item?.withholding_rate, 0),
      withholding_amount: reviewNumber(item?.withholding_amount, 0),
      account_code: String(item?.account_code || extracted.suggestions?.account_code || '600')
    };
  });

  const warnings = [
    ...(Array.isArray(extracted.warnings) ? extracted.warnings : []),
    ...(Array.isArray(root.warnings) && extracted !== root ? root.warnings : [])
  ].map(String);

  return {
    drive_file_id: String(root.drive_file_id || root.source_file_id || fallback.drive_file_id || ''),
    source_url: String(root.source_url || fallback.source_url || ''),
    supplier: {
      name: String(supplier.name || supplier.legal_name || 'Proveedor pendiente'),
      legal_name: String(supplier.legal_name || supplier.name || ''),
      tax_id: String(supplier.tax_id || ''),
      email: String(supplier.email || ''),
      phone: String(supplier.phone || ''),
      address: String(supplier.address || '')
    },
    invoice: {
      number: String(invoice.number || fallback.number || 'PENDIENTE'),
      issue_date: reviewDate(invoice.issue_date, fallback.issue_date || new Date().toISOString().slice(0, 10)),
      document_type: DOCUMENT_TYPES.has(invoice.document_type) ? invoice.document_type : 'invoice',
      payment_method: invoice.payment_method == null ? null : String(invoice.payment_method)
    },
    lines,
    warnings
  };
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateSupplierDocument(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('El resultado no es un objeto JSON.');
  }
  if (payload.schema_version !== SUPPLIER_SCHEMA_VERSION) {
    errors.push(`schema_version debe ser ${SUPPLIER_SCHEMA_VERSION}`);
  }
  if (!String(payload.drive_file_id || '').trim()) errors.push('Falta drive_file_id');
  if (!String(payload.supplier?.name || '').trim()) errors.push('Falta supplier.name');
  if (!validIsoDate(payload.invoice?.issue_date)) errors.push('invoice.issue_date no es una fecha ISO válida');
  if (payload.invoice?.due_date && !validIsoDate(payload.invoice.due_date)) {
    errors.push('invoice.due_date no es una fecha ISO válida');
  }
  if ((payload.invoice?.currency || 'EUR') !== 'EUR') errors.push('La moneda debe ser EUR');
  if (!DOCUMENT_TYPES.has(payload.invoice?.document_type || 'invoice')) {
    errors.push('invoice.document_type no es compatible');
  }
  if (!Array.isArray(payload.lines) || !payload.lines.length) errors.push('Debe existir al menos una línea');
  if (!payload.totals || typeof payload.totals !== 'object') errors.push('Falta totals');
  if (!Array.isArray(payload.warnings)) errors.push('warnings debe ser un array');
  if (!payload.confidence || typeof payload.confidence !== 'object' || Array.isArray(payload.confidence)
    || !Object.keys(payload.confidence).length) {
    errors.push('confidence debe ser un objeto con al menos un campo');
  }

  let base = 0;
  let tax = 0;
  let withholding = 0;
  (payload.lines || []).forEach((line, index) => {
    const label = `lines[${index}]`;
    if (!String(line?.description || '').trim()) errors.push(`${label}.description está vacío`);
    const lineBase = finiteNumber(line?.taxable_base);
    const lineTax = finiteNumber(line?.tax_amount);
    const lineRate = finiteNumber(line?.tax_rate);
    const lineWithholding = finiteNumber(line?.withholding_amount ?? 0);
    if (lineBase == null) errors.push(`${label}.taxable_base no es numérico`);
    if (lineTax == null) errors.push(`${label}.tax_amount no es numérico`);
    if (lineRate == null || !TAX_RATES.has(lineRate)) errors.push(`${label}.tax_rate no es un tipo IGIC admitido`);
    if (lineWithholding == null) errors.push(`${label}.withholding_amount no es numérico`);
    const taxScope = line?.tax_scope || 'taxable';
    if (!TAX_SCOPES.has(taxScope)) errors.push(`${label}.tax_scope no es compatible`);
    if (['exempt', 'not_subject'].includes(taxScope) && (lineRate !== 0 || lineTax !== 0)) {
      errors.push(`${label}: una línea exenta o no sujeta debe tener tipo y cuota cero`);
    }
    if (taxScope === 'taxable' && lineBase != null && lineRate != null && lineTax != null
      && Math.abs(Math.round(lineBase * lineRate) / 100 - lineTax) > 0.02) {
      errors.push(`${label}: la cuota IGIC no coincide con base y tipo`);
    }
    base += lineBase || 0;
    tax += lineTax || 0;
    withholding += lineWithholding || 0;
  });

  const totals = {
    base: finiteNumber(payload.totals?.taxable_base),
    tax: finiteNumber(payload.totals?.tax_amount),
    withholding: finiteNumber(payload.totals?.withholding_amount ?? 0),
    total: finiteNumber(payload.totals?.total)
  };
  Object.entries(totals).forEach(([name, value]) => {
    if (value == null) errors.push(`totals.${name} no es numérico`);
  });
  if (totals.base != null && Math.abs(base - totals.base) > 0.02) errors.push('La suma de bases no coincide');
  if (totals.tax != null && Math.abs(tax - totals.tax) > 0.02) errors.push('La suma de impuestos no coincide');
  if (totals.withholding != null && Math.abs(withholding - totals.withholding) > 0.02) {
    errors.push('La suma de retenciones no coincide');
  }
  if (totals.total != null && totals.base != null && totals.tax != null && totals.withholding != null
    && Math.abs(totals.base + totals.tax - totals.withholding - totals.total) > 0.02) {
    errors.push('El total no cuadra con base, impuestos y retenciones');
  }

  Object.entries(payload.confidence || {}).forEach(([field, value]) => {
    const confidence = finiteNumber(value);
    if (confidence == null || confidence < 0 || confidence > 1) {
      errors.push(`Confianza inválida en ${field}`);
    }
  });

  if (errors.length) {
    const error = new Error(errors.slice(0, 3).join(' · '));
    error.validationErrors = errors;
    throw error;
  }
  return payload;
}

export function driveImportStatus(fileId, imports = []) {
  const matches = imports
    .filter(item => item.drive_file_id === fileId)
    .sort((a, b) => String(b.processed_at || b.created_at).localeCompare(String(a.processed_at || a.created_at)));
  return matches[0]?.status || 'unprocessed';
}
