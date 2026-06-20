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
      const text = extractTextFromDriveFile_(file);
      const invoice = parseInvoiceText_(text, file.getName());
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
          const text = extractTextFromBlob_(attachment.copyBlob(), name);
          const invoice = parseInvoiceText_(text, name);
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

function extractTextFromDriveFile_(file) {
  const mimeType = file.getMimeType();
  if (mimeType === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(file.getId()).getBody().getText();
  }
  return extractTextFromBlob_(file.getBlob(), file.getName());
}

function extractTextFromBlob_(blob, name) {
  let tempFileId = '';
  try {
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
