export function normalizeContactTaxId(value = '') {
  return String(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function normalizeContactName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findMatchingContact(contacts = [], candidate = {}) {
  const taxId = normalizeContactTaxId(candidate.tax_id);
  if (taxId) {
    const taxMatch = contacts.find(contact => normalizeContactTaxId(contact.tax_id) === taxId);
    if (taxMatch) return taxMatch;
  }
  const name = normalizeContactName(candidate.name || candidate.legal_name);
  if (!name) return null;
  return contacts.find(contact => (
    (!taxId || !normalizeContactTaxId(contact.tax_id))
    && (
      normalizeContactName(contact.name) === name
      || normalizeContactName(contact.legal_name) === name
    )
  )) || null;
}

export function mergeContactKind(currentKind, requestedKind) {
  if (currentKind === 'both' || currentKind === requestedKind) return currentKind;
  if (['supplier', 'customer'].includes(currentKind) && ['supplier', 'customer'].includes(requestedKind)) {
    return 'both';
  }
  return requestedKind;
}
