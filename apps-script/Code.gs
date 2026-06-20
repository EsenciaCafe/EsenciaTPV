const SCRIPT_CONFIG = {
  driveRootFolderName: 'Esencia Cafe',
  pendingFolderName: 'PENDIENTE DE CONTABILIZAR',
  invoicesFolderName: 'FACTURAS',
  cashCloseFolderName: 'CIERRE',
  defaultGmailQuery: 'newer_than:45d has:attachment (factura OR invoice OR recibo OR ticket)',
  maxGmailThreads: 50
};

function runDailyInvoiceImport() {
  const ignoredSenders = getIgnoredSenders_();
  const results = {
    driveImported: 0,
    gmailImported: 0,
    skipped: 0,
    errors: []
  };

  try {
    results.driveImported = scanDriveInvoices_(results);
  } catch (error) {
    results.errors.push(`Drive: ${error.message}`);
  }

  try {
    results.gmailImported = scanGmailInvoices_(ignoredSenders, results);
  } catch (error) {
    results.errors.push(`Gmail: ${error.message}`);
  }

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

function createDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'runDailyInvoiceImport')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('runDailyInvoiceImport')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}

function scanDriveInvoices_(results) {
  const root = getDriveRootFolder_();
  let imported = 0;
  const yearFolders = root.getFolders();

  while (yearFolders.hasNext()) {
    const yearFolder = yearFolders.next();
    const pendingFolder = findChildFolder_(yearFolder, SCRIPT_CONFIG.pendingFolderName);
    if (!pendingFolder) continue;

    const monthFolders = pendingFolder.getFolders();
    while (monthFolders.hasNext()) {
      const monthFolder = monthFolders.next();
      imported += processDriveFolderFiles_(monthFolder, {
        source: 'drive',
        category: monthFolder.getName()
      }, false, results);

      const childFolders = monthFolder.getFolders();
      while (childFolders.hasNext()) {
        const child = childFolders.next();
        const childName = normalizeName_(child.getName());
        if (childName === normalizeName_(SCRIPT_CONFIG.cashCloseFolderName)) continue;
        if (childName === normalizeName_(SCRIPT_CONFIG.invoicesFolderName)) {
          imported += processDriveFolderFiles_(child, {
            source: 'drive',
            category: monthFolder.getName()
          }, true, results);
        }
      }
    }
  }

  return imported;
}

function processDriveFolderFiles_(folder, context, includeChildren, results) {
  let imported = 0;
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const sourceId = `drive:${file.getId()}`;
    if (invoiceExists_(sourceId)) {
      results.skipped += 1;
      continue;
    }

    try {
      const invoice = parseInvoiceFromDriveFile_(file);
      upsertInvoice_({
        ...invoice,
        id: makeInvoiceId_(sourceId),
        source: context.source,
        sourceId,
        category: invoice.category || context.category || '',
        fileName: file.getName(),
        fileUrl: file.getUrl(),
        status: 'pending_review'
      });
      imported += 1;
    } catch (error) {
      results.errors.push(`${file.getName()}: ${error.message}`);
    }
  }

  if (includeChildren) {
    const folders = folder.getFolders();
    while (folders.hasNext()) {
      const child = folders.next();
      if (normalizeName_(child.getName()) !== normalizeName_(SCRIPT_CONFIG.cashCloseFolderName)) {
        imported += processDriveFolderFiles_(child, context, true, results);
      }
    }
  }

  return imported;
}

function scanGmailInvoices_(ignoredSenders, results) {
  const query = getProperty_('GMAIL_QUERY') || SCRIPT_CONFIG.defaultGmailQuery;
  const threads = GmailApp.search(query, 0, SCRIPT_CONFIG.maxGmailThreads);
  let imported = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const senderEmail = extractEmail_(message.getFrom());
      if (senderEmail && ignoredSenders[senderEmail]) {
        results.skipped += 1;
        return;
      }

      message.getAttachments({ includeInlineImages: false, includeAttachments: true }).forEach(attachment => {
        const name = attachment.getName() || 'adjunto';
        if (!looksLikeInvoiceFile_(name, attachment.getContentType())) return;

        const sourceId = `gmail:${message.getId()}:${name}`;
        if (invoiceExists_(sourceId)) {
          results.skipped += 1;
          return;
        }

        try {
          const invoice = parseInvoiceFromBlob_(attachment.copyBlob(), name);
          upsertInvoice_({
            ...invoice,
            id: makeInvoiceId_(sourceId),
            source: 'gmail',
            sourceId,
            senderEmail,
            fileName: name,
            fileUrl: `https://mail.google.com/mail/u/0/#all/${message.getId()}`,
            notes: `Remitente: ${message.getFrom()}`,
            status: 'pending_review'
          });
          imported += 1;
        } catch (error) {
          results.errors.push(`${name}: ${error.message}`);
        }
      });
    });
  });

  return imported;
}

function parseInvoiceFromDriveFile_(file) {
  const mimeType = file.getMimeType();
  if (!isGoogleWorkspaceMime_(mimeType)) {
    const documentAiInvoice = extractInvoiceWithDocumentAi_(file.getBlob(), file.getName());
    if (documentAiInvoice) return documentAiInvoice;
  }

  const text = extractTextFromDriveFile_(file);
  return parseInvoiceText_(text, file.getName());
}

function parseInvoiceFromBlob_(blob, name) {
  const documentAiInvoice = extractInvoiceWithDocumentAi_(blob, name);
  if (documentAiInvoice) return documentAiInvoice;

  const text = extractTextFromBlob_(blob, name);
  return parseInvoiceText_(text, name);
}

function extractInvoiceWithDocumentAi_(blob, name) {
  const processorName = getProperty_('DOCUMENT_AI_PROCESSOR_NAME');
  if (!processorName) return null;

  try {
    const location = extractDocumentAiLocation_(processorName);
    const endpoint = `https://${location}-documentai.googleapis.com/v1/${processorName}:process`;
    const contentType = guessDocumentMimeType_(blob, name);
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        rawDocument: {
          content: Utilities.base64Encode(blob.getBytes()),
          mimeType: contentType
        }
      }),
      headers: {
        Authorization: `Bearer ${ScriptApp.getOAuthToken()}`
      }
    });

    const code = response.getResponseCode();
    const body = response.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error(`Document AI ${code}: ${body}`);
    }

    return parseDocumentAiInvoice_(JSON.parse(body).document || {}, name);
  } catch (error) {
    Logger.log(`Document AI no pudo procesar ${name}: ${error.message}`);
    return null;
  }
}

function parseDocumentAiInvoice_(document, fallbackName) {
  const entities = document.entities || [];
  const supplierName = pickEntityValue_(entities, ['supplier_name', 'vendor_name', 'supplier', 'remit_to_name']) || String(fallbackName || 'Proveedor pendiente').replace(/\.[^.]+$/, '');
  const invoiceNumber = pickEntityValue_(entities, ['invoice_id', 'invoice_number', 'invoice_num']);
  const invoiceDate = normalizeDocumentAiDate_(pickEntityValue_(entities, ['invoice_date', 'date']));
  const totalAmount = pickEntityMoney_(entities, ['total_amount', 'invoice_total', 'amount_due', 'total']);
  const baseAmount = pickEntityMoney_(entities, ['net_amount', 'subtotal_amount', 'subtotal', 'total_net_amount']);
  const taxAmount = pickEntityMoney_(entities, ['total_tax_amount', 'tax_amount', 'vat', 'igic']);
  const taxRate = pickEntityNumber_(entities, ['tax_rate', 'vat_rate', 'igic_rate']);
  const computedTax = taxAmount || (baseAmount && totalAmount ? round2_(totalAmount - baseAmount) : 0);
  const computedBase = baseAmount || (totalAmount && computedTax ? round2_(totalAmount - computedTax) : totalAmount || 0);
  const computedRate = taxRate || (computedBase && computedTax ? round2_(computedTax / computedBase * 100) : 0);

  return {
    supplierName,
    invoiceNumber,
    invoiceDate: invoiceDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    baseAmount: computedBase || 0,
    taxRate: computedRate || 0,
    taxAmount: computedTax || 0,
    totalAmount: totalAmount || round2_((computedBase || 0) + (computedTax || 0)),
    deductible: true,
    lines: extractDocumentAiLines_(entities, supplierName, invoiceDate),
    notes: 'Importado con Google Document AI. Revisar antes de confirmar.'
  };
}

function extractDocumentAiLines_(entities, supplierName, invoiceDate) {
  return (entities || [])
    .filter(entity => normalizeEntityType_(entity.type) === 'line_item')
    .map((entity, index) => {
      const properties = entity.properties || [];
      const description = pickEntityValue_(properties, ['line_item/description', 'description', 'item_description', 'product_name']) || entity.mentionText || '';
      const quantity = pickEntityNumber_(properties, ['line_item/quantity', 'quantity', 'qty']);
      const unitPrice = pickEntityMoney_(properties, ['line_item/unit_price', 'unit_price', 'price']);
      const totalAmount = pickEntityMoney_(properties, ['line_item/amount', 'amount', 'total_amount', 'line_total']);
      const taxRate = pickEntityNumber_(properties, ['line_item/tax_rate', 'tax_rate', 'igic_rate', 'vat_rate']);

      return {
        id: `line-${index + 1}`,
        supplierName,
        invoiceDate,
        description: String(description || '').trim(),
        quantity,
        unitPrice,
        totalAmount,
        taxRate,
        rawPayload: entity
      };
    })
    .filter(line => line.description);
}

function extractTextFromDriveFile_(file) {
  const mimeType = file.getMimeType();
  if (isGoogleWorkspaceMime_(mimeType)) {
    try {
      return DocumentApp.openById(file.getId()).getBody().getText();
    } catch (error) {
      Logger.log(`No se pudo leer como documento de Google ${file.getName()}: ${error.message}`);
      return file.getName();
    }
  }
  return extractTextFromBlob_(file.getBlob(), file.getName());
}

function extractTextFromBlob_(blob, name) {
  let tempFileId = '';
  try {
    const contentType = blob.getContentType();
    if (isGoogleWorkspaceMime_(contentType)) {
      Logger.log(`Se omite OCR de ${name}: Google ya lo entrega como ${contentType}.`);
      return name;
    }

    const resource = {
      title: `OCR temporal TPV - ${name}`,
      mimeType: MimeType.GOOGLE_DOCS
    };
    const tempFile = Drive.Files.insert(resource, blob, {
      ocr: true,
      ocrLanguage: 'es'
    });
    tempFileId = tempFile.id;
    return DocumentApp.openById(tempFileId).getBody().getText();
  } catch (error) {
    Logger.log(`No se pudo extraer texto por OCR de ${name}: ${error.message}`);
    return name;
  } finally {
    if (tempFileId) {
      try {
        DriveApp.getFileById(tempFileId).setTrashed(true);
      } catch (cleanupError) {
        Logger.log(`No se pudo borrar el OCR temporal: ${cleanupError.message}`);
      }
    }
  }
}

function isGoogleWorkspaceMime_(mimeType) {
  return String(mimeType || '').indexOf('application/vnd.google-apps.') === 0;
}

function parseInvoiceText_(text, fallbackName) {
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const supplierName = findSupplierName_(lines, fallbackName);
  const invoiceNumber = findMatch_(cleanText, /(?:factura|invoice|num\.?|numero|nº|n\.?)\s*[:\-]?\s*([A-Z0-9\-\/.]+)/i);
  const invoiceDate = normalizeDate_(findMatch_(cleanText, /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/));
  const taxRate = findNumberNear_(cleanText, /(?:igic|iva)\s*(\d{1,2}(?:[,.]\d{1,2})?)\s*%/i);
  const taxAmount = findMoneyNear_(cleanText, /(igic|iva)[^0-9]{0,30}(\d{1,5}(?:[.,]\d{2}))/i, 2);
  const baseAmount = findMoneyNear_(cleanText, /(base imponible|base)[^0-9]{0,30}(\d{1,6}(?:[.,]\d{2}))/i, 2);
  const totalAmount = findMoneyNear_(cleanText, /(total|importe total|a pagar)[^0-9]{0,40}(\d{1,6}(?:[.,]\d{2}))/i, 2);
  const computedTax = taxAmount || (baseAmount && totalAmount ? round2_(totalAmount - baseAmount) : 0);
  const computedBase = baseAmount || (totalAmount && computedTax ? round2_(totalAmount - computedTax) : totalAmount || 0);
  const computedRate = taxRate || (computedBase && computedTax ? round2_(computedTax / computedBase * 100) : 0);

  return {
    supplierName,
    invoiceNumber,
    invoiceDate: invoiceDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    baseAmount: computedBase || 0,
    taxRate: computedRate || 0,
    taxAmount: computedTax || 0,
    totalAmount: totalAmount || round2_((computedBase || 0) + (computedTax || 0)),
    deductible: true,
    lines: [],
    notes: 'Importado automaticamente. Revisar antes de confirmar.'
  };
}

function findSupplierName_(lines, fallbackName) {
  const ignored = /^(factura|invoice|recibo|fecha|num|numero|nº|total|base|igic|iva)\b/i;
  const candidate = lines.find(line => line.length >= 3 && line.length <= 80 && !ignored.test(line));
  return candidate || String(fallbackName || 'Proveedor pendiente').replace(/\.[^.]+$/, '');
}

function findMatch_(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[1] : '';
}

function findMoneyNear_(text, regex, groupIndex) {
  const match = String(text || '').match(regex);
  return match ? parseMoney_(match[groupIndex || 1]) : 0;
}

function findNumberNear_(text, regex) {
  const match = String(text || '').match(regex);
  return match ? parseMoney_(match[1]) : 0;
}

function parseMoney_(value) {
  if (!value) return 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? round2_(number) : 0;
}

function normalizeDate_(value) {
  if (!value) return '';
  const parts = String(value).split(/[\/\-.]/).map(part => part.padStart(2, '0'));
  if (parts.length !== 3) return '';
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  return `${year}-${parts[1]}-${parts[0]}`;
}

function looksLikeInvoiceFile_(name, mimeType) {
  const fileName = String(name || '').toLowerCase();
  const acceptedName = /\.(pdf|png|jpe?g|webp|tiff?)$/i.test(fileName);
  const acceptedMime = /pdf|image/i.test(String(mimeType || ''));
  return acceptedName || acceptedMime;
}

function extractDocumentAiLocation_(processorName) {
  const match = String(processorName || '').match(/\/locations\/([^/]+)\//);
  if (!match) throw new Error('DOCUMENT_AI_PROCESSOR_NAME debe incluir /locations/{region}/.');
  return match[1];
}

function guessDocumentMimeType_(blob, name) {
  const contentType = blob.getContentType();
  if (contentType && !isGoogleWorkspaceMime_(contentType)) return contentType;
  const fileName = String(name || '').toLowerCase();
  if (fileName.endsWith('.pdf')) return 'application/pdf';
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.tif') || fileName.endsWith('.tiff')) return 'image/tiff';
  return 'application/pdf';
}

function pickEntityValue_(entities, names) {
  const entity = findEntity_(entities, names);
  if (!entity) return '';
  return normalizedEntityText_(entity);
}

function pickEntityMoney_(entities, names) {
  const entity = findEntity_(entities, names);
  if (!entity) return 0;
  return entityToNumber_(entity);
}

function pickEntityNumber_(entities, names) {
  const entity = findEntity_(entities, names);
  if (!entity) return 0;
  return entityToNumber_(entity);
}

function findEntity_(entities, names) {
  const wanted = names.map(normalizeEntityType_);
  return (entities || []).find(entity => wanted.includes(normalizeEntityType_(entity.type)));
}

function normalizeEntityType_(type) {
  return String(type || '').toLowerCase().replace(/^.*\//, '');
}

function normalizedEntityText_(entity) {
  const normalized = entity.normalizedValue || {};
  if (normalized.text) return normalized.text;
  if (normalized.dateValue) return normalizeDocumentAiDate_(normalized.dateValue);
  if (normalized.moneyValue) return String(entityToNumber_(entity) || '');
  return entity.mentionText || '';
}

function entityToNumber_(entity) {
  const normalized = entity.normalizedValue || {};
  if (normalized.moneyValue) {
    const money = normalized.moneyValue;
    const units = Number(money.units || 0);
    const nanos = Number(money.nanos || 0) / 1000000000;
    return round2_(units + nanos);
  }
  if (normalized.text) return parseMoney_(normalized.text);
  return parseMoney_(entity.mentionText);
}

function normalizeDocumentAiDate_(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    const year = value.year;
    const month = String(value.month || '').padStart(2, '0');
    const day = String(value.day || '').padStart(2, '0');
    return year && month && day ? `${year}-${month}-${day}` : '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  return normalizeDate_(value);
}

function getDriveRootFolder_() {
  const configuredId = getProperty_('DRIVE_ROOT_FOLDER_ID');
  if (configuredId) return DriveApp.getFolderById(configuredId);

  const configuredName = getProperty_('DRIVE_ROOT_FOLDER_NAME') || SCRIPT_CONFIG.driveRootFolderName;
  const folders = DriveApp.getFoldersByName(configuredName);
  if (!folders.hasNext()) {
    throw new Error(`No encuentro la carpeta "${configuredName}". Comparte la carpeta con esta cuenta o configura DRIVE_ROOT_FOLDER_ID.`);
  }
  return folders.next();
}

function findChildFolder_(parent, name) {
  const target = normalizeName_(name);
  const folders = parent.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (normalizeName_(folder.getName()) === target) return folder;
  }
  return null;
}

function normalizeName_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function getIgnoredSenders_() {
  let rows = [];
  try {
    rows = supabaseFetch_('/rest/v1/supplier_sender_rules?select=email&ignored=eq.true') || [];
  } catch (error) {
    if (String(error.message || '').includes('supplier_sender_rules')) {
      Logger.log('La tabla supplier_sender_rules aun no existe. Se continua sin remitentes ignorados.');
      return {};
    }
    throw error;
  }

  return rows.reduce((acc, row) => {
    acc[normalizeEmail_(row.email)] = true;
    return acc;
  }, {});
}

function invoiceExists_(sourceId) {
  const encoded = encodeURIComponent(sourceId);
  const rows = supabaseFetch_(`/rest/v1/supplier_invoices?select=id&source_id=eq.${encoded}&limit=1`) || [];
  return rows.length > 0;
}

function upsertInvoice_(invoice) {
  const payload = {
    id: invoice.id,
    supplier_name: invoice.supplierName || 'Proveedor pendiente',
    invoice_number: invoice.invoiceNumber || null,
    invoice_date: invoice.invoiceDate,
    category: invoice.category || null,
    base_amount: invoice.baseAmount || 0,
    tax_rate: invoice.taxRate || 0,
    tax_amount: invoice.taxAmount || 0,
    total_amount: invoice.totalAmount || 0,
    deductible: invoice.deductible !== false,
    status: invoice.status || 'pending_review',
    source: invoice.source,
    source_id: invoice.sourceId,
    sender_email: normalizeEmail_(invoice.senderEmail || ''),
    file_name: invoice.fileName || null,
    file_url: invoice.fileUrl || null,
    notes: invoice.notes || null,
    updated_at: new Date().toISOString()
  };

  supabaseFetch_('/rest/v1/supplier_invoices?on_conflict=id', {
    method: 'post',
    payload: JSON.stringify(payload),
    headers: {
      Prefer: 'resolution=merge-duplicates'
    }
  });

  try {
    upsertInvoiceLines_(payload.id, invoice);
  } catch (error) {
    Logger.log(`No se pudieron guardar las lineas de ${payload.id}: ${error.message}`);
  }
}

function upsertInvoiceLines_(invoiceId, invoice) {
  const lines = invoice.lines || [];
  if (!lines.length) return;

  supabaseFetch_(`/rest/v1/supplier_invoice_lines?invoice_id=eq.${encodeURIComponent(invoiceId)}`, {
    method: 'delete',
    headers: {
      Prefer: 'return=minimal'
    }
  });

  const rows = lines.map((line, index) => ({
    id: `${invoiceId}-line-${index + 1}`,
    invoice_id: invoiceId,
    supplier_name: invoice.supplierName || null,
    invoice_date: invoice.invoiceDate || null,
    description: line.description,
    quantity: line.quantity || null,
    unit_price: line.unitPrice || null,
    total_amount: line.totalAmount || null,
    tax_rate: line.taxRate || null,
    raw_payload: line.rawPayload || {},
    updated_at: new Date().toISOString()
  }));

  supabaseFetch_('/rest/v1/supplier_invoice_lines?on_conflict=id', {
    method: 'post',
    payload: JSON.stringify(rows),
    headers: {
      Prefer: 'resolution=merge-duplicates'
    }
  });
}

function supabaseFetch_(path, options) {
  const url = getProperty_('SUPABASE_URL');
  const anonKey = getProperty_('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en Script Properties.');

  const response = UrlFetchApp.fetch(`${url}${path}`, {
    method: options?.method || 'get',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: options?.payload,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      ...(options?.headers || {})
    }
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`Supabase ${code}: ${body}`);
  }
  return body ? JSON.parse(body) : null;
}

function makeInvoiceId_(sourceId) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sourceId);
  const hex = digest.map(byte => (`0${(byte & 0xff).toString(16)}`).slice(-2)).join('');
  return `auto-${hex.slice(0, 24)}`;
}

function extractEmail_(from) {
  const match = String(from || '').match(/<([^>]+)>/);
  return normalizeEmail_(match ? match[1] : from);
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function round2_(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function getProperty_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}
