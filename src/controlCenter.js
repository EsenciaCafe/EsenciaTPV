const DOCUMENT_REVIEW_STATUSES = new Set(['draft', 'needs_review']);
const DRIVE_PROBLEM_STATUSES = new Set(['needs_correction', 'invalid', 'error']);

function plural(count, singular, pluralValue) {
  return count === 1 ? singular : (pluralValue || `${singular}s`);
}

export function buildControlCenter({
  documents = [],
  recurringItems = [],
  driveItems = [],
  pendingBankTransactions = [],
  reconciliations = [],
  unclassifiedCount = 0,
  recurringConfigured = true,
  bankAccounts = [],
  bankTransactions = [],
  bankQueue = null
} = {}) {
  const tasks = [];
  const driveProblems = driveItems.filter(item => DRIVE_PROBLEM_STATUSES.has(item.reviewStatus));
  const driveDocumentIds = new Set(driveProblems.map(item => item.document_id).filter(Boolean));
  const recurringMissing = recurringItems.filter(item => item.status === 'missing');
  const recurringPending = recurringItems.filter(item => item.status === 'pending');
  const recurringPendingDocumentIds = new Set(recurringPending.map(item => item.document?.id).filter(Boolean));
  const documentReviews = documents.filter(document => (
    document.direction === 'purchase'
    && DOCUMENT_REVIEW_STATUSES.has(document.status)
    && !driveDocumentIds.has(document.id)
    && !recurringPendingDocumentIds.has(document.id)
  ));
  const suggestedReconciliations = reconciliations.filter(item => item.status === 'suggested');
  const hasUnifiedBankQueue = Array.isArray(bankQueue);

  if (hasUnifiedBankQueue && bankQueue.length) {
    const ready = bankQueue.filter(item => ['ready_match', 'possible_document'].includes(item.status)).length;
    const missing = bankQueue.filter(item => item.status === 'missing_document').length;
    const details = [
      ready ? `${ready} con factura posible` : '',
      missing ? `${missing} sin justificante` : ''
    ].filter(Boolean);
    tasks.push({
      key: 'bank-work',
      tone: missing ? 'danger' : 'warning',
      icon: '≋',
      count: bankQueue.length,
      title: `${bankQueue.length} ${plural(bankQueue.length, 'movimiento bancario necesita', 'movimientos bancarios necesitan')} revisión`,
      detail: details.length ? details.join(' · ') : 'Identifica cada entrada o salida desde una única bandeja.',
      action: 'bank-work',
      actionLabel: 'Continuar revisión',
      targetId: bankQueue[0].id
    });
  }

  if (driveProblems.length) tasks.push({
    key: 'drive',
    tone: 'danger',
    icon: '◈',
    count: driveProblems.length,
    title: `${driveProblems.length} ${plural(driveProblems.length, 'factura de Drive necesita', 'facturas de Drive necesitan')} corrección`,
    detail: 'Abre el original y corrige los campos dudosos.',
    action: 'drive',
    actionLabel: 'Corregir ahora',
    targetId: driveProblems[0].id
  });
  if (recurringMissing.length) tasks.push({
    key: 'recurring',
    tone: 'danger',
    icon: '↻',
    count: recurringMissing.length,
    title: `Faltan ${recurringMissing.length} ${plural(recurringMissing.length, 'factura habitual', 'facturas habituales')}`,
    detail: 'Ya pasó la fecha esperada y aún no aparece la factura.',
    action: 'recurring',
    actionLabel: 'Guardar la primera',
    targetId: recurringMissing[0].expense.id,
    periodKey: recurringMissing[0].periodKey
  });
  if (!recurringConfigured) tasks.push({
    key: 'recurring-setup',
    tone: '',
    icon: '↻',
    count: 1,
    title: 'Configura tus gastos habituales',
    detail: 'Añade alquiler, luz, gestoría, préstamos y otros pagos que se repiten.',
    action: 'recurring-setup',
    actionLabel: 'Añadir el primero',
    targetId: ''
  });
  if (documentReviews.length) tasks.push({
    key: 'documents',
    tone: 'warning',
    icon: '↙',
    count: documentReviews.length,
    title: `${documentReviews.length} ${plural(documentReviews.length, 'gasto está', 'gastos están')} pendiente de revisar`,
    detail: 'Todavía no se incluye en el resultado ni en los impuestos.',
    action: 'document',
    actionLabel: 'Revisar ahora',
    targetId: documentReviews[0].id
  });
  if (recurringPending.length) tasks.push({
    key: 'recurring-review',
    tone: 'warning',
    icon: '↻',
    count: recurringPending.length,
    title: `${recurringPending.length} ${plural(recurringPending.length, 'gasto habitual espera', 'gastos habituales esperan')} aprobación`,
    detail: 'La factura existe, pero falta aprobarla para contabilizarla.',
    action: 'document',
    actionLabel: 'Abrir factura',
    targetId: recurringPending[0].document?.id
  });
  if (!hasUnifiedBankQueue && suggestedReconciliations.length) tasks.push({
    key: 'reconciliations',
    tone: 'warning',
    icon: '≈',
    count: suggestedReconciliations.length,
    title: `${suggestedReconciliations.length} ${plural(suggestedReconciliations.length, 'coincidencia bancaria espera', 'coincidencias bancarias esperan')} confirmación`,
    detail: 'Compara banco, documento y factura original en la misma ventana.',
    action: 'reconciliation',
    actionLabel: 'Comparar ahora',
    targetId: suggestedReconciliations[0].id
  });
  if (!hasUnifiedBankQueue && pendingBankTransactions.length) tasks.push({
    key: 'bank',
    tone: 'warning',
    icon: '≋',
    count: pendingBankTransactions.length,
    title: `${pendingBankTransactions.length} ${plural(pendingBankTransactions.length, 'movimiento bancario falta', 'movimientos bancarios faltan')} por clasificar`,
    detail: 'Indica qué es cada cobro o pago para que no quede fuera.',
    action: 'bank',
    actionLabel: 'Clasificar ahora',
    targetId: pendingBankTransactions[0].id
  });
  if (unclassifiedCount > 0) tasks.push({
    key: 'classification',
    tone: '',
    icon: '◎',
    count: unclassifiedCount,
    title: `${unclassifiedCount} ${plural(unclassifiedCount, 'gasto necesita', 'gastos necesitan')} categoría`,
    detail: 'Confirma si es mercancía, coste fijo, inversión u otro gasto.',
    action: 'profitability',
    actionLabel: 'Clasificar',
    targetId: ''
  });
  if (!bankAccounts.length) tasks.push({
    key: 'bank-setup',
    tone: '',
    icon: '+',
    count: 1,
    title: 'Añade tu cuenta bancaria',
    detail: 'Solo se piden un nombre, los últimos cuatro dígitos y el saldo inicial.',
    action: 'bank-account',
    actionLabel: 'Añadir cuenta',
    targetId: ''
  });
  else if (!bankTransactions.length) tasks.push({
    key: 'bank-import',
    tone: '',
    icon: '⇩',
    count: 1,
    title: 'Importa el primer extracto bancario',
    detail: 'Así podremos detectar cobros, pagos y facturas que faltan.',
    action: 'bank-import',
    actionLabel: 'Importar extracto',
    targetId: ''
  });

  const total = tasks.reduce((sum, task) => sum + task.count, 0);
  const areas = [
    { key: 'documents', label: 'Facturas', pending: driveProblems.length + documentReviews.length },
    { key: 'recurring', label: 'Gastos habituales', pending: recurringConfigured ? recurringMissing.length + recurringPending.length : 1 },
    { key: 'bank', label: 'Banco', pending: hasUnifiedBankQueue ? bankQueue.length : suggestedReconciliations.length + pendingBankTransactions.length },
    { key: 'classification', label: 'Rentabilidad', pending: unclassifiedCount }
  ];
  return { tasks, total, areas };
}
