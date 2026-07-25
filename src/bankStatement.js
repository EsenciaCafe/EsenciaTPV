import { unzipSync, strFromU8 } from 'fflate';

const HEADER_ALIASES = {
  date: [
    'fecha', 'fecha_operacion', 'fecha_de_operacion', 'f_operacion',
    'fecha_contable', 'fecha_movimiento', 'fecha_apunte', 'date', 'booking_date'
  ],
  valueDate: ['fecha_valor', 'fecha_de_valor', 'f_valor', 'value_date'],
  description: ['concepto', 'descripcion', 'detalle', 'description', 'concept'],
  reference: ['movimiento', 'referencia', 'reference', 'observaciones', 'observacion'],
  amount: [
    'importe', 'importe_eur', 'importe_euros', 'importe_del_movimiento',
    'cantidad', 'amount'
  ],
  debit: ['debe', 'cargo', 'cargos', 'debit'],
  credit: ['haber', 'abono', 'abonos', 'credit'],
  balance: ['saldo', 'saldo_disponible', 'disponible', 'balance']
};

export function normalizeHeader(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function columnIndex(headers, aliases) {
  for (const alias of aliases) {
    const exact = headers.indexOf(alias);
    if (exact >= 0) return exact;
  }
  return -1;
}

function getColumnIndexes(row) {
  const headers = row.map(normalizeHeader);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, columnIndex(headers, aliases)])
  );
}

function isRecognizedHeader(indexes) {
  return indexes.date >= 0
    && (indexes.amount >= 0 || indexes.debit >= 0 || indexes.credit >= 0);
}

function headerScore(indexes) {
  let score = 0;
  if (indexes.date >= 0) score += 4;
  if (indexes.amount >= 0) score += 4;
  if (indexes.debit >= 0 || indexes.credit >= 0) score += 3;
  if (indexes.valueDate >= 0) score += 1;
  if (indexes.description >= 0) score += 2;
  if (indexes.reference >= 0) score += 1;
  if (indexes.balance >= 0) score += 1;
  return score;
}

function locateHeader(rows) {
  let best = null;
  rows.slice(0, 50).forEach((row, rowIndex) => {
    const indexes = getColumnIndexes(row);
    if (!isRecognizedHeader(indexes)) return;
    const score = headerScore(indexes);
    if (!best || score > best.score) best = { rowIndex, indexes, score };
  });
  return best;
}

export function parseCsv(text) {
  const sampleLines = text.split(/\r?\n/).slice(0, 20);
  const delimiter = sampleLines.reduce((best, line) => {
    const candidates = [';', ',', '\t'].map(value => ({
      value,
      count: line.split(value).length - 1
    }));
    const lineBest = candidates.sort((a, b) => b.count - a.count)[0];
    return lineBest.count > best.count ? lineBest : best;
  }, { value: ';', count: -1 }).value;

  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row);
  return rows;
}

export function parseXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const sharedXml = files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '';
  const shared = sharedXml
    ? [...new DOMParser().parseFromString(sharedXml, 'text/xml').querySelectorAll('si')]
      .map(item => item.textContent || '')
    : [];
  const sheetName = Object.keys(files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!sheetName) throw new Error('El XLSX no contiene hojas reconocibles.');

  const xml = new DOMParser().parseFromString(strFromU8(files[sheetName]), 'text/xml');
  return [...xml.querySelectorAll('row')].map(row => {
    const values = [];
    row.querySelectorAll('c').forEach(cell => {
      const ref = cell.getAttribute('r') || 'A1';
      const letters = ref.replace(/\d/g, '');
      let index = 0;
      for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
      const raw = cell.querySelector('v')?.textContent || cell.querySelector('is')?.textContent || '';
      values[index - 1] = cell.getAttribute('t') === 's' ? shared[Number(raw)] || '' : raw;
    });
    return values.map(value => value ?? '');
  });
}

export function parseSpanishNumber(value) {
  if (typeof value === 'number') return value;
  const clean = String(value ?? '')
    .replace(/[€\s]/g, '')
    .replace(/[−–—]/g, '-');
  if (!clean) return null;

  let normalized = clean;
  if (clean.includes(',') && clean.includes('.')) {
    normalized = clean.lastIndexOf(',') > clean.lastIndexOf('.')
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, '');
  } else if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function excelDate(value) {
  if (/^\d{5}(\.\d+)?$/.test(String(value))) {
    return new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000).toISOString().slice(0, 10);
  }
  const match = String(value).match(/(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})/);
  if (match) {
    const yearFirst = match[1].length === 4;
    const year = yearFirst ? match[1] : match[3];
    const month = String(match[2]).padStart(2, '0');
    const day = String(yearFirst ? match[3] : match[1]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function mapBankRows(rows) {
  if (rows.length < 2) throw new Error('El extracto está vacío.');
  const header = locateHeader(rows);
  if (!header) throw new Error('No se reconocen las columnas de fecha e importe.');

  const { indexes } = header;
  const mapped = rows.slice(header.rowIndex + 1).map(row => {
    const amount = indexes.amount >= 0
      ? parseSpanishNumber(row[indexes.amount])
      : (parseSpanishNumber(row[indexes.credit]) || 0) - (parseSpanishNumber(row[indexes.debit]) || 0);
    return {
      booked_on: excelDate(row[indexes.date]),
      value_on: indexes.valueDate >= 0 ? excelDate(row[indexes.valueDate]) : null,
      description: indexes.description >= 0 ? String(row[indexes.description] || '').trim() : '',
      reference: indexes.reference >= 0 ? String(row[indexes.reference] || '').trim() : '',
      amount,
      balance: indexes.balance >= 0 ? parseSpanishNumber(row[indexes.balance]) : null
    };
  }).filter(row => row.booked_on && row.amount != null);

  if (!mapped.length) {
    throw new Error('Se reconocieron las columnas, pero no hay movimientos válidos para importar.');
  }
  return mapped;
}
