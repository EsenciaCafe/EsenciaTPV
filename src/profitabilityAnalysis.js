import { isAccountedDocument, periodBounds } from './accountingDashboard.js';

export const PROFITABILITY_CATEGORIES = [
  { value: 'merchandise', label: 'Mercancía y materia prima', behavior: 'variable' },
  { value: 'packaging', label: 'Envases y consumibles', behavior: 'variable' },
  { value: 'staff', label: 'Personal y Seguridad Social', behavior: 'fixed' },
  { value: 'rent', label: 'Alquiler', behavior: 'fixed' },
  { value: 'utilities', label: 'Luz, agua, internet y suministros', behavior: 'fixed' },
  { value: 'bank_fees', label: 'Comisiones bancarias y plataformas', behavior: 'variable' },
  { value: 'professional_services', label: 'Gestoría, software y servicios', behavior: 'fixed' },
  { value: 'maintenance', label: 'Reparaciones y mantenimiento', behavior: 'fixed' },
  { value: 'taxes', label: 'Tributos y tasas', behavior: 'fixed' },
  { value: 'insurance', label: 'Seguros', behavior: 'fixed' },
  { value: 'marketing', label: 'Marketing y publicidad', behavior: 'fixed' },
  { value: 'investment', label: 'Equipamiento e inversión', behavior: 'investment' },
  { value: 'other', label: 'Otros gastos', behavior: 'fixed' },
  { value: 'unclassified', label: 'Sin clasificar', behavior: 'unclassified' }
];

const CATEGORY_BY_VALUE = new Map(PROFITABILITY_CATEGORIES.map(category => [category.value, category]));

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

function dateFrom(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function inRange(value, start, end) {
  const date = dateFrom(value);
  return Boolean(date && date >= start && date <= end);
}

export function categoryDefinition(value) {
  return CATEGORY_BY_VALUE.get(value) || CATEGORY_BY_VALUE.get('unclassified');
}

export function suggestDocumentClassification(document = {}) {
  if (document.document_type === 'asset') {
    return { category: 'investment', cost_behavior: 'investment' };
  }
  if (document.document_type === 'payroll') {
    return { category: 'staff', cost_behavior: 'fixed' };
  }

  const text = normalizeText([
    document.category,
    document.notes,
    document.accounting_contacts?.name
  ].filter(Boolean).join(' '));
  const rules = [
    [/mercader|aprovision|bebida|alimento|ingrediente|materia prima|compras/, 'merchandise'],
    [/envase|embalaje|packaging|consumible/, 'packaging'],
    [/nomina|personal|seguridad social|salario/, 'staff'],
    [/alquiler|arrendamiento|rent/, 'rent'],
    [/luz|agua|electric|internet|telefono|suministro/, 'utilities'],
    [/comision|banco|stripe|paypal|plataforma de pago|datafono/, 'bank_fees'],
    [/gestoria|asesoria|software|servicio profesional|consultoria/, 'professional_services'],
    [/reparacion|mantenimiento/, 'maintenance'],
    [/tributo|tasa|impuesto/, 'taxes'],
    [/seguro/, 'insurance'],
    [/marketing|publicidad|promocion/, 'marketing'],
    [/equipamiento|inversion|activo|maquinaria|mobiliario/, 'investment']
  ];
  const match = rules.find(([pattern]) => pattern.test(text));
  const category = match?.[1] || 'unclassified';
  return { category, cost_behavior: categoryDefinition(category).behavior };
}

function classificationFor(document, storedAnalysis) {
  const suggested = suggestDocumentClassification(document);
  if (!storedAnalysis) {
    return { ...suggested, source: suggested.category === 'unclassified' ? 'unclassified' : 'suggested' };
  }
  const category = categoryDefinition(storedAnalysis.category).value;
  const validBehaviors = new Set(['variable', 'fixed', 'investment', 'unclassified']);
  return {
    category,
    cost_behavior: validBehaviors.has(storedAnalysis.cost_behavior)
      ? storedAnalysis.cost_behavior
      : categoryDefinition(category).behavior,
    source: 'confirmed'
  };
}

function verdictFor(result, margin, provisional, missingCosts) {
  if (missingCosts) {
    return {
      tone: 'warning',
      label: 'Aún no evaluable',
      explanation: 'Hay ventas, pero todavía no hay gastos aprobados en este periodo.'
    };
  }
  let tone = 'danger';
  let label = 'No rentable';
  let explanation = 'Los gastos superan a las ventas del periodo.';
  if (result > 0 && margin >= 15) {
    tone = 'positive';
    label = 'Rentable';
    explanation = 'Las ventas cubren los gastos y dejan un margen saludable.';
  } else if (result > 0) {
    tone = 'warning';
    label = 'Rentable con margen ajustado';
    explanation = 'Hay beneficio, pero queda poco margen ante una bajada de ventas o una subida de costes.';
  } else if (Math.abs(result) < 0.005) {
    tone = 'warning';
    label = 'En equilibrio';
    explanation = 'Las ventas cubren aproximadamente los gastos, sin dejar margen suficiente.';
  }
  return {
    tone: provisional && tone === 'positive' ? 'warning' : tone,
    label: provisional ? `${label} · provisional` : label,
    explanation
  };
}

export function buildProfitabilityAnalysis({
  documents = [],
  analyses = [],
  period = 'month',
  anchor = new Date()
} = {}) {
  const bounds = periodBounds(period, anchor);
  const analysisByDocument = new Map(analyses.map(analysis => [analysis.document_id, analysis]));
  const accounted = documents.filter(document => (
    isAccountedDocument(document) && inRange(document.issue_date, bounds.start, bounds.end)
  ));
  const salesDocuments = accounted.filter(document => document.direction === 'sale');
  const purchaseDocuments = accounted.filter(document => document.direction === 'purchase');
  const rows = purchaseDocuments.map(document => ({
    document,
    amount: amount(document.subtotal),
    ...classificationFor(document, analysisByDocument.get(document.id))
  }));
  const sales = salesDocuments.reduce((sum, document) => sum + amount(document.subtotal), 0);
  const variableCosts = rows.filter(row => row.cost_behavior === 'variable')
    .reduce((sum, row) => sum + row.amount, 0);
  const fixedCosts = rows.filter(row => row.cost_behavior === 'fixed')
    .reduce((sum, row) => sum + row.amount, 0);
  const investments = rows.filter(row => row.cost_behavior === 'investment')
    .reduce((sum, row) => sum + row.amount, 0);
  const unclassifiedCosts = rows.filter(row => row.cost_behavior === 'unclassified')
    .reduce((sum, row) => sum + row.amount, 0);
  const operatingCosts = variableCosts + fixedCosts + unclassifiedCosts;
  const contribution = sales - variableCosts;
  const contributionMargin = sales ? (contribution / sales) * 100 : null;
  const result = sales - operatingCosts;
  const margin = sales ? (result / sales) * 100 : null;
  const confirmedOperatingAmount = rows
    .filter(row => row.source === 'confirmed' && row.cost_behavior !== 'investment')
    .reduce((sum, row) => sum + row.amount, 0);
  const missingCosts = sales > 0 && rows.length === 0;
  const classificationCoverage = missingCosts
    ? 0
    : operatingCosts
    ? Math.min(100, (confirmedOperatingAmount / operatingCosts) * 100)
    : 100;
  const pendingDocuments = documents.filter(document => (
    document.direction === 'purchase'
    && ['draft', 'needs_review'].includes(document.status)
    && inRange(document.issue_date, bounds.start, bounds.end)
  ));
  const pendingAmount = pendingDocuments.reduce((sum, document) => sum + amount(document.subtotal), 0);
  const needsConfirmation = rows.filter(row => row.source !== 'confirmed');
  const completeClassification = needsConfirmation.length === 0 && unclassifiedCosts < 0.005 && !missingCosts;
  const contributionRatio = sales ? contribution / sales : 0;
  const breakEvenSales = completeClassification && contributionRatio > 0
    ? fixedCosts / contributionRatio
    : null;
  const safetyMargin = breakEvenSales == null ? null : sales - breakEvenSales;
  const provisional = pendingDocuments.length > 0 || !completeClassification;
  const categories = PROFITABILITY_CATEGORIES
    .filter(category => category.value !== 'unclassified')
    .map(category => ({
      ...category,
      amount: rows.filter(row => row.category === category.value).reduce((sum, row) => sum + row.amount, 0)
    }))
    .filter(category => category.amount > 0.005)
    .sort((a, b) => b.amount - a.amount);

  return {
    bounds,
    sales,
    variableCosts,
    fixedCosts,
    unclassifiedCosts,
    operatingCosts,
    investments,
    contribution,
    contributionMargin,
    result,
    margin,
    breakEvenSales,
    safetyMargin,
    classificationCoverage,
    pendingDocuments: pendingDocuments.length,
    pendingAmount,
    needsConfirmation,
    rows,
    categories,
    missingCosts,
    provisional,
    verdict: verdictFor(result, margin, provisional, missingCosts)
  };
}
