const text = (value, label, max) => {
  if (typeof value !== 'string') throw Error(`Falta ${label}.`);
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > max || /[\x00-\x1f\x7f]/.test(clean)) throw Error(`${label}: dato no válido.`);
  return clean;
};

export function validSpanishTaxId(value) {
  if (/^\d{8}[A-Z]$/.test(value)) return 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(value.slice(0,8)) % 23] === value.at(-1);
  if (/^[XYZ]\d{7}[A-Z]$/.test(value)) return validSpanishTaxId(`${'XYZ'.indexOf(value[0])}${value.slice(1)}`);
  if (!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value)) return false;
  let sum = 0;
  [...value.slice(1,8)].forEach((digit, index) => {
    const n = Number(digit) * (index % 2 === 0 ? 2 : 1);
    sum += n > 9 ? n - 9 : n;
  });
  const control = (10 - sum % 10) % 10;
  const allowed = /^[ABEH]/.test(value) ? String(control) : /^[NPQRSW]/.test(value) ? 'JABCDEFGHI'[control] : `${control}${'JABCDEFGHI'[control]}`;
  return allowed.includes(value.at(-1));
}

export function invoiceCustomer(input = {}) {
  const taxId = text(input.taxId, 'NIF/CIF/NIE', 20).replace(/[ .-]/g, '').toUpperCase();
  if (!validSpanishTaxId(taxId)) throw Error('Revisa el NIF/CIF/NIE español del cliente.');
  const postalCode = text(input.postalCode, 'código postal', 5);
  if (!/^\d{5}$/.test(postalCode)) throw Error('El código postal debe tener 5 cifras.');
  return {name:text(input.name,'nombre o razón social',160), taxId,
    address:text(input.address,'domicilio fiscal',240), postalCode,
    city:text(input.city,'municipio',100), province:text(input.province,'provincia',100), country:'ES'};
}

const cents = value => {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw Error('Importes incompletos en el ticket original.');
  return Math.round(n * 100);
};

// Only the persisted fiscal snapshot supplies money and items, never the browser cart.
export function invoiceSource(sale, fiscal) {
  if (!sale || sale.type !== 'sale' || sale.has_refund || Number(sale.refund_amount || 0) > 0) throw Error('La venta no existe o tiene una devolución. Requiere revisión antes de facturar.');
  if (!fiscal || fiscal.document_type !== 'simplified_invoice' || fiscal.status !== 'issued' || !fiscal.fiscal_number || !fiscal.hash) throw Error('El ticket todavía no tiene documento fiscal confirmado. No se puede emitir la factura.');
  const legal = fiscal.legal_data || {};
  const issuer = {name:text(legal.companyName,'razón social del emisor',160), taxId:text(legal.nif,'NIF del emisor',30), address:text(legal.address,'domicilio del emisor',300)};
  const total = cents(fiscal.total_amount), base = cents(fiscal.taxable_base), tax = cents(fiscal.tax_amount);
  const rate = Number(fiscal.tax_rate);
  if (total <= 0 || total !== cents(sale.total_amount) || base + tax !== total || !Number.isFinite(rate) || rate <= 0 || rate > 100 || fiscal.tax_name !== 'IGIC' || Math.round(total / (1 + rate / 100)) !== base) throw Error('El desglose fiscal original requiere revisión.');
  const items = fiscal.payload?.items;
  if (!Array.isArray(items) || !items.length || items.length > 500) throw Error('Falta el detalle fiscal de artículos.');
  let itemTotal = 0, lineBases = 0;
  const lines = items.map(item => {
    const qty = Number(item.qty), amount = cents(item.total);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 10000) throw Error('Cantidad de artículos no válida.');
    const options = item.selectedOptions || [];
    if (!Array.isArray(options)) throw Error('Modificadores no válidos.');
    const unit = cents(item.price) + options.reduce((sum,option) => {
      if (!Number.isInteger(Number(option.qty)) || Number(option.qty) < 1) throw Error('Cantidad de modificadores no válida.');
      return sum + cents(option.price) * Number(option.qty);
    },0);
    const gross = unit * qty;
    if (gross < amount) throw Error('El precio original no coincide con los artículos.');
    itemTotal += amount;
    const lineBase = Math.round(amount / (1 + rate / 100));
    lineBases += lineBase;
    return {description:text(item.name,'nombre del artículo',200), options:options.map(o=>`${text(o.name,'modificador',200)} ×${o.qty}`), qty,
      unitNet:Math.round(unit / 100 / (1 + rate / 100) * 10000) / 10000,
      discountNet:Math.round((gross - amount) / (1 + rate / 100)) / 100,
      base:lineBase / 100, total:amount / 100, taxRate:rate};
  });
  if (itemTotal !== total) throw Error('Los artículos no suman el total del ticket. Requiere revisión.');
  const operationDate = new Date(sale.closed_at || sale.created_at).toISOString();
  return {saleId:sale.id, original:{id:fiscal.id,number:fiscal.fiscal_number,date:new Date(fiscal.issued_at).toISOString(),hash:fiscal.hash},
    operationDate, issuer, lines, roundingBase:(base-lineBases)/100, currency:'EUR', total:total/100, base:base/100, tax:tax/100, taxRate:rate, taxName:'IGIC'};
}
