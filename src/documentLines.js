export const IGIC_RATES = [0, 3, 5, 7, 9.5, 15];

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function emptyDocumentLine(direction = 'purchase') {
  return {
    id: '',
    supplier_item_code: '',
    description: '',
    quantity: 1,
    unit_price: 0,
    taxable_base: 0,
    tax_scope: 'taxable',
    tax_rate: 7,
    tax_amount: 0,
    withholding_rate: 0,
    withholding_amount: 0,
    account_code: direction === 'sale' ? '700' : '600'
  };
}

export function calculateDocumentLine(line = {}) {
  const quantity = Number(line.quantity || 0);
  const unitPrice = Number(line.unit_price || 0);
  const taxScope = line.tax_scope || 'taxable';
  const taxRate = taxScope === 'taxable' ? Number(line.tax_rate || 0) : 0;
  const withholdingRate = Number(line.withholding_rate || 0);
  const taxableBase = roundMoney(quantity * unitPrice);
  return {
    ...line,
    quantity,
    unit_price: unitPrice,
    taxable_base: taxableBase,
    tax_scope: taxScope,
    tax_rate: taxRate,
    tax_amount: taxScope === 'taxable' ? roundMoney(taxableBase * taxRate / 100) : 0,
    withholding_rate: withholdingRate,
    withholding_amount: roundMoney(taxableBase * withholdingRate / 100)
  };
}

export function calculateDocumentTotals(lines = []) {
  const calculatedLines = lines.map(calculateDocumentLine);
  const subtotal = roundMoney(calculatedLines.reduce((sum, line) => sum + line.taxable_base, 0));
  const taxAmount = roundMoney(calculatedLines.reduce((sum, line) => sum + line.tax_amount, 0));
  const withholdingAmount = roundMoney(calculatedLines.reduce((sum, line) => sum + line.withholding_amount, 0));
  return {
    lines: calculatedLines,
    subtotal,
    taxAmount,
    withholdingAmount,
    totalAmount: roundMoney(subtotal + taxAmount - withholdingAmount)
  };
}

export function calculatePriceVariation(currentPrice, previousPrice) {
  const current = Number(currentPrice);
  const previous = Number(previousPrice);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return {
    amount: roundMoney(current - previous),
    percent: roundMoney((current - previous) * 100 / previous)
  };
}
