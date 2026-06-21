const MOJIBAKE_REPLACEMENTS = {
  'PlÃ¡tano': 'Plátano',
  'plÃ¡tano': 'plátano',
  'RÃºcula': 'Rúcula',
  'rÃºcula': 'rúcula',
  'CafÃ©': 'Café',
  'cafÃ©': 'café',
  'SalmÃ³n': 'Salmón',
  'salmÃ³n': 'salmón',
  'JamÃ³n': 'Jamón',
  'jamÃ³n': 'jamón',
  'LimÃ³n': 'Limón',
  'limÃ³n': 'limón',
  'AzÃºcar': 'Azúcar',
  'azÃºcar': 'azúcar',
  'Â·': '·',
  'â‚¬': '€',
  'â€“': '-',
  'â€”': '-',
  'Âº': 'º'
};

const DEFAULT_ARTICLE_DICTIONARY = {
  'aceite oliva': 'Aceite de oliva',
  aguacate: 'Aguacate',
  almogrote: 'Almogrote',
  aranda: 'Tarrina Aranda',
  azucar: 'Azúcar',
  batata: 'Batata',
  bolsa: 'Bolsa',
  cafe: 'Café',
  croissant: 'Croissant',
  fresa: 'Fresa',
  freson: 'Fresa',
  harina: 'Harina',
  huevo: 'Huevos',
  jamon: 'Jamón',
  kiwi: 'Kiwi',
  lavavajilla: 'Lavavajilla',
  leche: 'Leche',
  limon: 'Limón',
  manzana: 'Manzana',
  mantequilla: 'Mantequilla',
  matcha: 'Matcha',
  nata: 'Nata',
  naranja: 'Naranja',
  nutella: 'Nutella',
  pan: 'Pan',
  platano: 'Plátano',
  queso: 'Queso',
  sal: 'Sal',
  salmon: 'Salmón',
  rucula: 'Rúcula',
  sirope: 'Sirope',
  smoothie: 'Smoothie',
  tomate: 'Tomate'
};

const CATEGORY_KEYWORDS = [
  { category: 'Fruta y verdura', keywords: ['aguacate', 'batata', 'fresa', 'freson', 'kiwi', 'manzana', 'naranja', 'platano', 'limon', 'tomate', 'rucula', 'lechuga', 'cebolla', 'fruta'] },
  { category: 'Cafe y bebidas', keywords: ['cafe', 'campanini', 'matcha', 'te ', 'leche', 'zumo', 'bebida', 'agua', 'smoothie', 'mango', 'lambda'] },
  { category: 'Panaderia', keywords: ['pan', 'payes', 'croissant', 'harina', 'masa', 'bolleria'] },
  { category: 'Proteina y lacteos', keywords: ['almogrote', 'huevo', 'jamon', 'nata', 'salmon', 'pollo', 'atun', 'queso'] },
  { category: 'Dulces y toppings', keywords: ['azucar', 'lotus', 'nutella', 'sirope'] },
  { category: 'Suministros y limpieza', keywords: ['servilleta', 'vaso', 'tapa', 'bolsa', 'limpieza', 'papel', 'fregona', 'lavavajilla', 'vileda', 'cristales'] },
  { category: 'Otros', keywords: [] }
];

const MONTHS = {
  jan: '01',
  january: '01',
  ene: '01',
  enero: '01',
  feb: '02',
  february: '02',
  febrero: '02',
  mar: '03',
  march: '03',
  marzo: '03',
  apr: '04',
  april: '04',
  abr: '04',
  abril: '04',
  may: '05',
  mayo: '05',
  jun: '06',
  june: '06',
  junio: '06',
  jul: '07',
  july: '07',
  julio: '07',
  aug: '08',
  august: '08',
  ago: '08',
  agosto: '08',
  sep: '09',
  sept: '09',
  september: '09',
  septiembre: '09',
  oct: '10',
  october: '10',
  octubre: '10',
  nov: '11',
  november: '11',
  noviembre: '11',
  dec: '12',
  december: '12',
  dic: '12',
  diciembre: '12'
};

function fixMojibake(text) {
  let fixed = String(text || '');
  Object.entries(MOJIBAKE_REPLACEMENTS).forEach(([bad, good]) => {
    fixed = fixed.replaceAll(bad, good);
  });
  return fixed.normalize('NFC');
}

function normalizeSpaces(text) {
  return fixMojibake(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeKey(text) {
  return normalizeSpaces(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeInvoiceNumber(value) {
  return normalizeSpaces(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseNumber(value) {
  const raw = normalizeSpaces(value)
    .replace(/[€$]/g, '')
    .replace(/[^\d,.-]/g, '');
  if (!raw) return null;

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  let normalized = raw;

  if (hasComma && hasDot) {
    normalized = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (hasComma) {
    normalized = raw.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLastNumber(value) {
  const matches = normalizeSpaces(value).match(/\d+(?:[.,]\d+)?/g);
  if (!matches?.length) return null;
  return parseNumber(matches[matches.length - 1]);
}

function parseQuantity(value) {
  const clean = normalizeSpaces(value).replace(',', '.');
  const match = clean.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ./]*)?/);
  return {
    cantidad: match ? Number.parseFloat(match[1]) : null,
    unidad: match?.[2]?.replace(/^\//, '').toLowerCase() || ''
  };
}

function parseUnitPrice(value) {
  const clean = normalizeSpaces(value);
  const price = parseNumber(clean);
  const match = clean.match(/\/\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)/);
  return {
    precio_unitario: price,
    unidad_precio: match?.[1]?.toLowerCase() || ''
  };
}

function splitLine(line) {
  const clean = fixMojibake(line)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/^\||\|$/g, '');
  if (!clean || /^[-|: ]+$/.test(clean)) return [];
  if (clean.includes('|')) return clean.split('|').map(normalizeSpaces);
  if (clean.includes('\t')) return clean.split('\t').map(normalizeSpaces);
  if (clean.includes(';')) return clean.split(';').map(normalizeSpaces);
  if ((clean.match(/,\s+/g) || []).length >= 6) return clean.split(/,\s+/).map(normalizeSpaces);
  return clean.split(/\s{2,}/).map(normalizeSpaces);
}

function looksLikeHeader(parts) {
  const joined = normalizeKey(parts.join(' '));
  return joined.includes('proveedor') && joined.includes('fecha') && joined.includes('factura');
}

function normalizeDate(value) {
  const clean = normalizeSpaces(value).replace(',', '');
  const iso = clean.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const es = clean.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (es) {
    const year = es[3].length === 2 ? `20${es[3]}` : es[3];
    return `${year}-${es[2].padStart(2, '0')}-${es[1].padStart(2, '0')}`;
  }

  const named = clean.match(/^([a-zA-ZáéíóúÁÉÍÓÚñÑ.]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (named) {
    const monthKey = normalizeKey(named[1].replace('.', ''));
    const month = MONTHS[monthKey];
    if (month) return `${named[3]}-${month}-${named[2].padStart(2, '0')}`;
  }

  return clean;
}

function extractSmoothieCode(article) {
  const clean = normalizeSpaces(article).toUpperCase();
  const match = clean.match(/\b([A-Z]\d{1,3})\b/);
  return match?.[1] || '';
}

function titleCaseArticle(article) {
  return normalizeSpaces(article)
    .toLowerCase()
    .replace(/\b\p{L}/gu, char => char.toUpperCase());
}

function preserveDescriptiveBakeryName(article) {
  const clean = normalizeSpaces(article);
  const key = normalizeKey(clean);
  const isSpecificCroissant = key.includes('croissant') && key !== 'croissant';
  const isSpecificPayes = key.includes('payes') || key.includes('rebanada pan');
  if (!isSpecificCroissant && !isSpecificPayes) return '';
  return titleCaseArticle(clean);
}

function normalizeArticleName(article, dictionary) {
  const key = normalizeKey(article);
  const bakeryName = preserveDescriptiveBakeryName(article);
  if (bakeryName) return bakeryName;

  const match = Object.entries(dictionary)
    .map(([needle, label]) => ({ needle, label, normalizedNeedle: normalizeKey(needle) }))
    .sort((a, b) => b.normalizedNeedle.length - a.normalizedNeedle.length)
    .find(item => key.includes(item.normalizedNeedle));
  if (match) {
    if (normalizeKey(match.label) === 'smoothie') {
      const code = extractSmoothieCode(article);
      return code ? `Smoothie ${code}` : match.label;
    }
    return match.label;
  }
  return titleCaseArticle(article);
}

function detectCategory(article) {
  const key = normalizeKey(article);
  const match = CATEGORY_KEYWORDS.find(group => group.keywords.some(keyword => key.includes(normalizeKey(keyword))));
  return match?.category || 'Otros';
}

function rowFromParts(parts, dictionary, index) {
  if (parts.length < 7 || looksLikeHeader(parts)) return null;

  const proveedor = parts[0];
  const fecha = normalizeDate(parts[1]);
  const factura = parts[2];
  const cantidadPart = parts[parts.length - 3];
  const pricePart = parts[parts.length - 2];
  const amountPart = parts[parts.length - 1];
  const articuloOriginal = parts.slice(3, -3).join(' ');
  const quantity = parseQuantity(cantidadPart);
  const price = parseUnitPrice(pricePart);
  const importe = parseNumber(amountPart);
  const calculated = quantity.cantidad !== null && price.precio_unitario !== null
    ? Number((quantity.cantidad * price.precio_unitario).toFixed(2))
    : null;
  const importeRounded = importe !== null ? Number(importe.toFixed(2)) : null;
  const mismatch = calculated !== null && importeRounded !== null
    ? Math.abs(calculated - importeRounded) > 0.05
    : true;
  const articuloNormalizado = normalizeArticleName(articuloOriginal, dictionary);

  return {
    id: `parsed-${index}`,
    proveedor: normalizeSpaces(proveedor),
    fecha,
    factura: normalizeSpaces(factura),
    articulo_original: normalizeSpaces(articuloOriginal),
    articulo_normalizado: articuloNormalizado,
    cantidad: quantity.cantidad,
    unidad: quantity.unidad,
    precio_unitario: price.precio_unitario,
    unidad_precio: price.unidad_precio || quantity.unidad,
    importe,
    categoria: detectCategory(articuloNormalizado),
    importe_calculado: calculated,
    revision_necesaria: !proveedor || !fecha || !factura || !articuloOriginal || mismatch,
    motivo_revision: mismatch ? 'Cantidad x precio no coincide con importe o faltan datos' : ''
  };
}

function addMoney(map, key, amount) {
  const cleanKey = key || 'Sin identificar';
  map.set(cleanKey, Number(((map.get(cleanKey) || 0) + Number(amount || 0)).toFixed(2)));
}

function summarizeRows(rows) {
  const providerMap = new Map();
  const articleMap = new Map();
  const articleStats = new Map();
  const latestByArticle = new Map();

  rows.forEach(row => {
    addMoney(providerMap, row.proveedor, row.importe);
    addMoney(articleMap, row.articulo_normalizado, row.importe);

    const current = articleStats.get(row.articulo_normalizado) || { total: 0, qty: 0, count: 0 };
    current.total += Number(row.importe || 0);
    current.qty += Number(row.cantidad || 0);
    current.count += 1;
    articleStats.set(row.articulo_normalizado, current);

    const latest = latestByArticle.get(row.articulo_normalizado);
    if (!latest || String(row.fecha || '').localeCompare(String(latest.fecha || '')) >= 0) {
      latestByArticle.set(row.articulo_normalizado, {
        articulo: row.articulo_normalizado,
        proveedor: row.proveedor,
        fecha: row.fecha,
        precio_unitario: row.precio_unitario,
        unidad_precio: row.unidad_precio
      });
    }
  });

  return {
    gasto_por_proveedor: Array.from(providerMap, ([proveedor, total]) => ({ proveedor, total })),
    gasto_por_articulo: Array.from(articleMap, ([articulo, total]) => ({ articulo, total })),
    precio_medio_por_articulo: Array.from(articleStats, ([articulo, stats]) => ({
      articulo,
      precio_medio: stats.qty > 0 ? Number((stats.total / stats.qty).toFixed(4)) : null,
      lineas: stats.count
    })),
    ultimo_precio_por_articulo: Array.from(latestByArticle.values())
  };
}

function extractInvoiceTotals(rawText) {
  const result = {};
  String(rawText || '')
    .split(/\n+/)
    .map(normalizeSpaces)
    .filter(Boolean)
    .forEach(line => {
      const key = normalizeKey(line);
      const amount = parseLastNumber(line);
      if (amount === null) return;
      if (key.includes('total factura') || key === 'total') result.totalAmount = amount;
      if (key.includes('base imponible')) result.baseAmount = amount;
      if (key.includes('igic') && !key.includes('base')) result.taxAmount = amount;
    });
  return result;
}

function groupInvoices(rows, taxRate = 7, invoiceTotals = null) {
  const map = new Map();
  rows.forEach(row => {
    const key = `${row.proveedor}__${row.fecha}__${row.factura}`;
    const current = map.get(key) || {
      supplierName: row.proveedor,
      invoiceNumber: row.factura,
      invoiceDate: row.fecha,
      category: row.categoria,
      totalAmount: 0,
      lines: []
    };
    current.totalAmount += Number(row.importe || 0);
    current.lines.push(row);
    map.set(key, current);
  });

  const invoices = Array.from(map.values());
  const shouldApplyTotals = invoices.length === 1 && invoiceTotals?.totalAmount;

  return invoices.map(invoice => {
    const lineTotal = Number(invoice.totalAmount.toFixed(2));
    const totalAmount = shouldApplyTotals ? Number(invoiceTotals.totalAmount.toFixed(2)) : lineTotal;
    const baseAmount = shouldApplyTotals
      ? Number((invoiceTotals.baseAmount ?? lineTotal).toFixed(2))
      : Number((totalAmount / (1 + (taxRate / 100))).toFixed(2));
    const taxAmount = shouldApplyTotals
      ? Number((invoiceTotals.taxAmount ?? Math.max(0, totalAmount - baseAmount)).toFixed(2))
      : Number((totalAmount - baseAmount).toFixed(2));
    const effectiveTaxRate = baseAmount > 0
      ? Number(((taxAmount / baseAmount) * 100).toFixed(2))
      : taxRate;
    return {
      ...invoice,
      totalAmount,
      baseAmount,
      taxRate: effectiveTaxRate,
      taxAmount,
      deductible: true,
      status: 'pending_review',
      source: 'drive',
      notes: `Importado desde resumen de Gemini. Lineas: ${invoice.lines.length}.`
    };
  });
}

function applyDuplicateDetection(result, existingInvoices = []) {
  const existingByExactKey = new Map();
  const existingByNumber = new Map();
  const incomingByExactKey = new Map();
  const incomingByNumber = new Map();

  existingInvoices.forEach(invoice => {
    const numberKey = normalizeInvoiceNumber(invoice.invoiceNumber);
    if (!numberKey) return;
    const supplierKey = normalizeKey(invoice.supplierName || '');
    const exactKey = `${supplierKey}__${numberKey}`;
    existingByExactKey.set(exactKey, invoice);
    if (!existingByNumber.has(numberKey)) existingByNumber.set(numberKey, []);
    existingByNumber.get(numberKey).push(invoice);
  });

  result.invoices.forEach(invoice => {
    const numberKey = normalizeInvoiceNumber(invoice.invoiceNumber);
    const supplierKey = normalizeKey(invoice.supplierName || '');
    const exactKey = `${supplierKey}__${numberKey}`;
    if (!numberKey) return;
    if (!incomingByExactKey.has(exactKey)) incomingByExactKey.set(exactKey, []);
    incomingByExactKey.get(exactKey).push(invoice);
    if (!incomingByNumber.has(numberKey)) incomingByNumber.set(numberKey, []);
    incomingByNumber.get(numberKey).push(invoice);
  });

  result.invoices = result.invoices.map(invoice => {
    const numberKey = normalizeInvoiceNumber(invoice.invoiceNumber);
    const supplierKey = normalizeKey(invoice.supplierName || '');
    const exactKey = `${supplierKey}__${numberKey}`;
    const duplicateReasons = [];
    const exactExisting = existingByExactKey.get(exactKey);
    const numberExisting = existingByNumber.get(numberKey) || [];
    const exactIncoming = incomingByExactKey.get(exactKey) || [];
    const numberIncoming = incomingByNumber.get(numberKey) || [];

    if (exactExisting) {
      duplicateReasons.push(`Ya existe una factura con este proveedor y numero (${exactExisting.supplierName || 'proveedor guardado'}).`);
    } else if (numberExisting.length > 0) {
      duplicateReasons.push(`El numero ya existe con otro proveedor: ${numberExisting.map(item => item.supplierName || 'sin proveedor').join(', ')}.`);
    }

    if (exactIncoming.length > 1) {
      duplicateReasons.push('Este proveedor y numero aparece repetido en el texto pegado.');
    } else if (numberIncoming.length > 1) {
      const suppliers = [...new Set(numberIncoming.map(item => item.supplierName || 'sin proveedor'))];
      duplicateReasons.push(`El mismo numero aparece en el texto con proveedores distintos: ${suppliers.join(', ')}.`);
    }

    const isDuplicate = duplicateReasons.length > 0;
    const nextInvoice = {
      ...invoice,
      duplicate: isDuplicate,
      duplicateReasons,
      importable: !isDuplicate
    };

    nextInvoice.lines = invoice.lines.map(line => ({
      ...line,
      revision_necesaria: line.revision_necesaria || isDuplicate,
      motivo_revision: isDuplicate
        ? [...new Set([line.motivo_revision, ...duplicateReasons].filter(Boolean))].join(' ')
        : line.motivo_revision
    }));

    return nextInvoice;
  });

  result.rows = result.invoices.flatMap(invoice => invoice.lines);
  result.totals = {
    ...result.totals,
    importableInvoices: result.invoices.filter(invoice => invoice.importable !== false).length,
    duplicateInvoices: result.invoices.filter(invoice => invoice.duplicate).length,
    reviewRows: result.rows.filter(row => row.revision_necesaria).length
  };

  return result;
}

export function parseGeminiInvoiceText(rawText, options = {}) {
  const dictionary = { ...DEFAULT_ARTICLE_DICTIONARY, ...(options.dictionary || {}) };
  const taxRate = Number(options.taxRate ?? 7);
  const cleanText = normalizeSpaces(rawText).replace(/\r/g, '\n');
  const lines = cleanText
    .split('\n')
    .map(normalizeSpaces)
    .filter(Boolean);

  const rows = lines
    .map((line, index) => rowFromParts(splitLine(line), dictionary, index))
    .filter(Boolean);
  const invoiceTotals = extractInvoiceTotals(cleanText);

  const result = {
    rows,
    invoices: groupInvoices(rows, taxRate, invoiceTotals),
    summaries: summarizeRows(rows),
    totals: {
      rows: rows.length,
      invoices: new Set(rows.map(row => `${row.proveedor}__${row.fecha}__${row.factura}`)).size,
      totalAmount: Number(rows.reduce((sum, row) => sum + Number(row.importe || 0), 0).toFixed(2)),
      reviewRows: rows.filter(row => row.revision_necesaria).length
    }
  };

  return applyDuplicateDetection(result, options.existingInvoices || []);
}
