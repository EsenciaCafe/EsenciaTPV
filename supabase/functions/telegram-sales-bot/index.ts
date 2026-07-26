const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_PUBLISHABLE_KEYS = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || '';
const TELEGRAM_ALLOWED_USER_IDS = new Set(
  (Deno.env.get('TELEGRAM_ALLOWED_USER_IDS') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

const BUSINESS_TIME_ZONE = 'Atlantic/Canary';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const VOID_LEDGER_MARKER = 'TPV_VOID_LEDGER_V1:';

type JsonRecord = Record<string, unknown>;
type Period = 'today' | 'yesterday' | 'month';
type VoidLedger = {
  version: 1;
  days: Record<string, { count: number; amount: number; units: number }>;
  eventIds: string[];
};

const quickKeyboard = {
  inline_keyboard: [
    [
      { text: '📊 Hoy', callback_data: 'summary:today' },
      { text: '💶 Caja', callback_data: 'cash:today' }
    ],
    [
      { text: '🏆 Top hoy', callback_data: 'top:today' },
      { text: '📅 Este mes', callback_data: 'summary:month' }
    ],
    [
      { text: '🗑️ Vaciados hoy', callback_data: 'voids:today' }
    ]
  ]
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-telegram-bot-api-secret-token',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

function normalize(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!,.;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function localParts(value: Date | string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function localDateKey(value: Date | string) {
  const parts = localParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return shifted.toISOString().slice(0, 10);
}

function periodFor(text: string): Period {
  const raw = String(text || '').toLowerCase();
  const normalized = normalize(text);
  if (normalized.includes('ayer') || raw.endsWith(':yesterday')) return 'yesterday';
  if (
    normalized.includes('mes') ||
    normalized.includes('mensual') ||
    raw.endsWith(':month')
  ) return 'month';
  return 'today';
}

function periodLabel(period: Period) {
  if (period === 'yesterday') return 'ayer';
  if (period === 'month') return 'este mes';
  return 'hoy';
}

function belongsToPeriod(value: string, period: Period) {
  const rowKey = localDateKey(value);
  const today = localDateKey(new Date());
  if (period === 'yesterday') return rowKey === shiftDateKey(today, -1);
  if (period === 'month') return rowKey.slice(0, 7) === today.slice(0, 7);
  return rowKey === today;
}

function money(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

function round(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function paymentBucket(method: string) {
  const value = normalize(method);
  if (value.includes('efectivo')) return 'cash';
  if (value.includes('regalo') || value.includes('gift')) return 'gift';
  return 'card';
}

async function rest(path: string, params: Record<string, string>) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) {
    console.error('[telegram-sales-bot] Supabase', response.status, await response.text());
    throw new Error('No se pudieron consultar las ventas.');
  }
  return await response.json() as JsonRecord[];
}

async function loadSales(period: Period) {
  const lookbackDays = period === 'month' ? 35 : 3;
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const rows = await rest('sales', {
    select: 'id,type,total_amount,payment_method,closed_at,created_at,payload',
    closed_at: `gte.${since}`,
    order: 'closed_at.desc',
    limit: '5000'
  });
  return rows.filter(row => {
    const payload = (row.payload || {}) as JsonRecord;
    const occurredAt = String(payload.createdAt || row.closed_at || row.created_at || '');
    return payload.voided !== true && occurredAt && belongsToPeriod(occurredAt, period);
  });
}

async function loadDetails(period: Period) {
  const sales = await loadSales(period);
  const saleIds = sales.map(row => String(row.id)).filter(Boolean);
  if (saleIds.length === 0) return { sales, lines: [], payments: [] };

  const chunks: string[][] = [];
  for (let index = 0; index < saleIds.length; index += 100) {
    chunks.push(saleIds.slice(index, index + 100));
  }

  const results = await Promise.all(chunks.flatMap(ids => {
    const idFilter = `in.(${ids.map(id => `"${id.replaceAll('"', '')}"`).join(',')})`;
    return [
      rest('sale_lines', {
        select: 'sale_id,item_id,name,quantity,total_amount',
        sale_id: idFilter,
        limit: '10000'
      }),
      rest('sale_payments', {
        select: 'sale_id,method,amount',
        sale_id: idFilter,
        limit: '10000'
      })
    ];
  }));

  const lines: JsonRecord[] = [];
  const payments: JsonRecord[] = [];
  results.forEach((rows, index) => (index % 2 === 0 ? lines : payments).push(...rows));
  return { sales, lines, payments };
}

function summarize(sales: JsonRecord[], payments: JsonRecord[] = []) {
  const saleIds = new Set(
    sales.filter(row => String(row.type || 'sale') !== 'refund').map(row => String(row.id))
  );
  const refundRows = sales.filter(row => String(row.type || '') === 'refund');
  const gross = sales
    .filter(row => String(row.type || 'sale') !== 'refund')
    .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const refunds = refundRows.reduce((sum, row) => sum + Math.abs(Number(row.total_amount || 0)), 0);
  const paymentTotals = { cash: 0, card: 0, gift: 0 };

  if (payments.length > 0) {
    payments
      .filter(row => saleIds.has(String(row.sale_id)))
      .forEach(row => {
        paymentTotals[paymentBucket(String(row.method || ''))] += Number(row.amount || 0);
      });
  } else {
    sales.filter(row => saleIds.has(String(row.id))).forEach(row => {
      const payload = (row.payload || {}) as JsonRecord;
      const rowPayments = Array.isArray(payload.payments) ? payload.payments as JsonRecord[] : [];
      if (rowPayments.length > 0) {
        rowPayments.forEach(payment => {
          const amount = Number(payment.amount ?? payment.saleAmount ?? 0);
          paymentTotals[paymentBucket(String(payment.method || ''))] += amount;
        });
      } else {
        paymentTotals[paymentBucket(String(row.payment_method || ''))] += Number(row.total_amount || 0);
      }
    });
  }

  const tickets = saleIds.size;
  const net = gross - refunds;
  return {
    tickets,
    gross: round(gross),
    refunds: round(refunds),
    net: round(net),
    average: tickets ? round(net / tickets) : 0,
    payments: {
      cash: round(paymentTotals.cash),
      card: round(paymentTotals.card),
      gift: round(paymentTotals.gift)
    }
  };
}

function summaryMessage(period: Period, sales: JsonRecord[]) {
  const summary = summarize(sales);
  return [
    `📊 <b>Ventas ${periodLabel(period)}</b>`,
    '',
    `Neto: <b>${money(summary.net)}</b>`,
    `Tickets: <b>${summary.tickets}</b>`,
    `Ticket medio: <b>${money(summary.average)}</b>`,
    summary.refunds ? `Bruto: ${money(summary.gross)} · Devoluciones: ${money(summary.refunds)}` : ''
  ].filter(Boolean).join('\n');
}

function cashMessage(period: Period, sales: JsonRecord[], payments: JsonRecord[]) {
  const summary = summarize(sales, payments);
  return [
    `💶 <b>Cobros ${periodLabel(period)}</b>`,
    '',
    `Efectivo: <b>${money(summary.payments.cash)}</b>`,
    `Tarjeta: <b>${money(summary.payments.card)}</b>`,
    `Tarjeta regalo: <b>${money(summary.payments.gift)}</b>`,
    `Total registrado: <b>${money(
      summary.payments.cash + summary.payments.card + summary.payments.gift
    )}</b>`
  ].join('\n');
}

function productRows(sales: JsonRecord[], lines: JsonRecord[]) {
  const direction = new Map(
    sales.map(row => [String(row.id), String(row.type || 'sale') === 'refund' ? -1 : 1])
  );
  const grouped = new Map<string, { name: string; quantity: number; total: number }>();
  lines.forEach(line => {
    const multiplier = direction.get(String(line.sale_id));
    if (!multiplier) return;
    const key = normalize(String(line.name || 'Artículo'));
    const current = grouped.get(key) || {
      name: String(line.name || 'Artículo'),
      quantity: 0,
      total: 0
    };
    current.quantity += multiplier * Number(line.quantity || 0);
    current.total += multiplier * Number(line.total_amount || 0);
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((a, b) => b.quantity - a.quantity);
}

function topMessage(period: Period, sales: JsonRecord[], lines: JsonRecord[]) {
  const rows = productRows(sales, lines).filter(row => row.quantity !== 0).slice(0, 10);
  if (!rows.length) return `No hay artículos vendidos ${periodLabel(period)}.`;
  return [
    `🏆 <b>Artículos más vendidos ${periodLabel(period)}</b>`,
    '',
    ...rows.map((row, index) =>
      `${index + 1}. <b>${escapeHtml(row.name)}</b> — ${row.quantity.toLocaleString('es-ES')} uds. · ${money(row.total)}`
    )
  ].join('\n');
}

function productMessage(query: string, period: Period, sales: JsonRecord[], lines: JsonRecord[]) {
  const words = normalize(query).split(' ').filter(word => word.length > 1);
  const matches = productRows(sales, lines).filter(row => {
    const name = normalize(row.name);
    return words.every(word => name.includes(word));
  });
  if (!matches.length) {
    return `No encontré ventas de “${escapeHtml(query)}” ${periodLabel(period)}. Prueba con una parte más corta del nombre.`;
  }
  const quantity = matches.reduce((sum, row) => sum + row.quantity, 0);
  const total = matches.reduce((sum, row) => sum + row.total, 0);
  return [
    `🔎 <b>${escapeHtml(query)}</b> · ${periodLabel(period)}`,
    '',
    `Unidades: <b>${quantity.toLocaleString('es-ES')}</b>`,
    `Importe: <b>${money(total)}</b>`,
    matches.length > 1
      ? `Coincidencias: ${matches.slice(0, 5).map(row => escapeHtml(row.name)).join(', ')}`
      : ''
  ].filter(Boolean).join('\n');
}

function helpMessage() {
  return [
    '👋 <b>Bot privado del TPV</b>',
    '',
    'Puedes preguntarme:',
    '• “¿Cuánto hemos vendido hoy?”',
    '• “¿Cuántos minipancakes se vendieron?”',
    '• “Top de productos este mes”',
    '• “Caja de ayer”',
    '',
    '<b>Comandos</b>',
    '/hoy · /ayer · /mes',
    '/caja [hoy|ayer|mes]',
    '/top [hoy|ayer|mes]',
    '/producto nombre [hoy|ayer|mes]',
    '/vaciados [hoy|ayer|mes]'
  ].join('\n');
}

function inferProductQuery(originalText: string) {
  let text = normalize(originalText)
    .replace(/\b(cuantos|cuantas|cuanto|cuanta|que cantidad de|unidades de)\b/g, ' ')
    .replace(/\b(se vendieron|vendimos|hemos vendido|se han vendido|ventas de|venta de)\b/g, ' ')
    .replace(/\b(hoy|ayer|este mes|del mes|en el mes)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.startsWith('/producto')) text = text.slice('/producto'.length).trim();
  return text;
}

function intentFor(text: string) {
  const raw = String(text || '').toLowerCase();
  if (raw.startsWith('summary:')) return 'summary';
  if (raw.startsWith('cash:')) return 'cash';
  if (raw.startsWith('top:')) return 'top';
  if (raw.startsWith('voids:')) return 'voids';
  const normalized = normalize(text);
  if (/^\/?(start|ayuda|help)\b/.test(normalized)) return 'help';
  if (
    normalized.startsWith('/vaciados') ||
    /\b(vaciad[ao]s?|vaciaron|vaciadas|vaciados|pedidos borrados|mesas borradas)\b/.test(normalized)
  ) return 'voids';
  if (normalized.startsWith('/caja') || /\b(efectivo|tarjeta|metodos de pago|cobros|caja)\b/.test(normalized)) return 'cash';
  if (normalized.startsWith('/top') || /\b(mas vendido|mas vendidos|top de|ranking)\b/.test(normalized)) return 'top';
  if (normalized.startsWith('/producto') || /\b(cuantos|cuantas|cantidad|unidades|ventas de)\b/.test(normalized)) return 'product';
  if (/^\/?(hoy|ayer|mes)\b/.test(normalized) || /\b(cuanto hemos vendido|ventas de hoy|resumen|ticket medio|tickets)\b/.test(normalized)) return 'summary';
  return 'unknown';
}

async function telegram(method: string, body: JsonRecord) {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('[telegram-sales-bot] Telegram', response.status, detail);
    throw new Error(`Telegram rechazó ${method}.`);
  }
  const payload = await response.json() as JsonRecord;
  if (payload.ok !== true) throw new Error(`Telegram rechazó ${method}.`);
  return payload.result;
}

async function answer(chatId: number, text: string) {
  await telegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: quickKeyboard
  });
}

function emptyVoidLedger(): VoidLedger {
  return { version: 1, days: {}, eventIds: [] };
}

function encodeLedger(ledger: VoidLedger) {
  return btoa(JSON.stringify(ledger));
}

function decodeLedger(text: string): VoidLedger | null {
  const markerIndex = text.indexOf(VOID_LEDGER_MARKER);
  if (markerIndex < 0) return null;
  try {
    const encoded = text.slice(markerIndex + VOID_LEDGER_MARKER.length).trim();
    const parsed = JSON.parse(atob(encoded)) as VoidLedger;
    if (parsed.version !== 1 || !parsed.days || !Array.isArray(parsed.eventIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function ledgerMessage(ledger: VoidLedger) {
  const recentDays = Object.entries(ledger.days)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7);
  const readable = recentDays.length
    ? recentDays.map(([date, row]) =>
      `${date}: ${row.count} vaciado${row.count === 1 ? '' : 's'} · ${money(row.amount)}`
    ).join('\n')
    : 'Todavía no hay pedidos vaciados.';
  return [
    '📌 Registro privado de vaciados del TPV',
    'No borres ni desfijes este mensaje: el bot lo utiliza para responder consultas.',
    '',
    readable,
    '',
    `${VOID_LEDGER_MARKER}${encodeLedger(ledger)}`
  ].join('\n');
}

async function loadVoidLedger(chatId: number) {
  const chat = await telegram('getChat', { chat_id: chatId }) as JsonRecord;
  const pinned = chat.pinned_message as JsonRecord | undefined;
  const text = String(pinned?.text || '');
  return {
    ledger: decodeLedger(text),
    messageId: Number(pinned?.message_id || 0)
  };
}

async function saveVoidEvent(chatId: number, event: {
  eventId: string;
  occurredAt: string;
  total: number;
  units: number;
}) {
  const current = await loadVoidLedger(chatId);
  const ledger = current.ledger || emptyVoidLedger();
  if (ledger.eventIds.includes(event.eventId)) return false;

  const dateKey = localDateKey(event.occurredAt);
  const day = ledger.days[dateKey] || { count: 0, amount: 0, units: 0 };
  ledger.days[dateKey] = {
    count: day.count + 1,
    amount: round(day.amount + event.total),
    units: round(day.units + event.units)
  };
  ledger.eventIds = [...ledger.eventIds, event.eventId].slice(-120);

  const cutoff = shiftDateKey(localDateKey(new Date()), -92);
  Object.keys(ledger.days).forEach(key => {
    if (key < cutoff) delete ledger.days[key];
  });

  const text = ledgerMessage(ledger);
  if (current.messageId) {
    await telegram('editMessageText', {
      chat_id: chatId,
      message_id: current.messageId,
      text
    });
  } else {
    const message = await telegram('sendMessage', {
      chat_id: chatId,
      text,
      disable_notification: true
    }) as JsonRecord;
    await telegram('pinChatMessage', {
      chat_id: chatId,
      message_id: message.message_id,
      disable_notification: true
    });
  }
  return true;
}

async function voidsMessage(chatId: number, period: Period) {
  const { ledger } = await loadVoidLedger(chatId);
  const today = localDateKey(new Date());
  const keys = period === 'month'
    ? Object.keys(ledger?.days || {}).filter(key => key.slice(0, 7) === today.slice(0, 7))
    : [period === 'yesterday' ? shiftDateKey(today, -1) : today];
  const totals = keys.reduce((result, key) => {
    const day = ledger?.days?.[key];
    if (!day) return result;
    result.count += Number(day.count || 0);
    result.amount += Number(day.amount || 0);
    result.units += Number(day.units || 0);
    return result;
  }, { count: 0, amount: 0, units: 0 });
  return [
    `🗑️ <b>Pedidos vaciados ${periodLabel(period)}</b>`,
    '',
    `Vaciados: <b>${totals.count}</b>`,
    `Importe: <b>${money(totals.amount)}</b>`,
    `Artículos: <b>${totals.units.toLocaleString('es-ES')}</b>`
  ].join('\n');
}

async function isTpvInvocation(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const apiKey = request.headers.get('apikey') || '';
  const allowedKeys = new Set<string>();
  if (SUPABASE_ANON_KEY) allowedKeys.add(SUPABASE_ANON_KEY);
  try {
    const publishableKeys = JSON.parse(SUPABASE_PUBLISHABLE_KEYS) as Record<string, string>;
    Object.values(publishableKeys || {}).filter(Boolean).forEach(key => allowedKeys.add(key));
  } catch {
    // Older projects may not expose the publishable key dictionary.
  }
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (allowedKeys.has(bearer) || allowedKeys.has(apiKey)) return true;

  const candidate = apiKey || bearer;
  if (!candidate || candidate.length > 1000 || (apiKey && bearer && apiKey !== bearer)) return false;
  try {
    const validationUrl = new URL(`${SUPABASE_URL}/rest/v1/sales`);
    validationUrl.searchParams.set('select', 'id');
    validationUrl.searchParams.set('limit', '0');
    const validation = await fetch(validationUrl, {
      headers: {
        apikey: candidate,
        Authorization: `Bearer ${candidate}`
      }
    });
    return validation.ok;
  } catch {
    return false;
  }
}

async function handleTicketCleared(body: JsonRecord) {
  const eventId = String(body.eventId || '');
  const occurredAt = String(body.occurredAt || '');
  const orderName = String(body.orderName || 'Pedido').slice(0, 80);
  const staffName = String(body.staffName || '').slice(0, 80);
  const items = Array.isArray(body.items) ? body.items.slice(0, 100) as JsonRecord[] : [];
  const total = round(Number(body.total || 0));

  if (!/^EMPTY-[A-Za-z0-9-]{8,80}$/.test(eventId) ||
      !occurredAt || Number.isNaN(new Date(occurredAt).getTime()) ||
      !Number.isFinite(total) || total < 0 || total > 100000 ||
      items.length === 0) {
    return jsonResponse({ ok: false, error: 'Evento de vaciado no válido.' }, 400);
  }

  const cleanItems = items.map(item => ({
    name: String(item.name || 'Artículo').slice(0, 120),
    quantity: Math.max(0, Number(item.quantity || 0)),
    total: round(Math.max(0, Number(item.total || 0)))
  })).filter(item => item.quantity > 0);
  if (cleanItems.length === 0) {
    return jsonResponse({ ok: false, error: 'El pedido no contiene artículos válidos.' }, 400);
  }

  const units = cleanItems.reduce((sum, item) => sum + item.quantity, 0);
  const itemLines = cleanItems.slice(0, 40).map(item =>
    `• ${escapeHtml(item.name)} × ${item.quantity.toLocaleString('es-ES')} — ${money(item.total)}`
  );
  if (cleanItems.length > 40) itemLines.push(`• …y ${cleanItems.length - 40} líneas más`);

  const notificationMessageIds: Array<{ chatId: number; messageId: number }> = [];
  for (const userId of TELEGRAM_ALLOWED_USER_IDS) {
    const chatId = Number(userId);
    if (!chatId) continue;
    const isNew = await saveVoidEvent(chatId, { eventId, occurredAt, total, units });
    if (!isNew) continue;
    const notification = await telegram('sendMessage', {
      chat_id: chatId,
      text: [
        '🗑️ <b>Pedido vaciado en el TPV</b>',
        '',
        `<b>${escapeHtml(orderName)}</b> · ${money(total)}`,
        staffName ? `Empleado: ${escapeHtml(staffName)}` : '',
        `Hora: ${new Intl.DateTimeFormat('es-ES', {
          timeZone: BUSINESS_TIME_ZONE,
          dateStyle: 'short',
          timeStyle: 'short'
        }).format(new Date(occurredAt))}`,
        '',
        ...itemLines
      ].filter(Boolean).join('\n'),
      parse_mode: 'HTML'
    }) as JsonRecord;
    notificationMessageIds.push({
      chatId,
      messageId: Number(notification.message_id || 0)
    });
  }
  return jsonResponse({ ok: true, notificationMessageIds });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return jsonResponse({ ok: true });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN ||
      !TELEGRAM_WEBHOOK_SECRET || TELEGRAM_ALLOWED_USER_IDS.size === 0) {
    console.error('[telegram-sales-bot] Faltan secretos obligatorios.');
    return jsonResponse({ error: 'Bot no configurado.' }, 503);
  }

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return jsonResponse({ error: 'JSON no válido.' }, 400);
  }

  if (body.type === 'ticket_cleared') {
    if (!await isTpvInvocation(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    try {
      return await handleTicketCleared(body);
    } catch (error) {
      console.error('[telegram-sales-bot] No se pudo notificar el vaciado', error);
      return jsonResponse({ ok: false, error: 'Telegram no confirmó el vaciado.' }, 502);
    }
  }

  const webhookSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (webhookSecret !== TELEGRAM_WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  }

  try {
    const update = body;
    const callback = update.callback_query as JsonRecord | undefined;
    const message = (callback?.message || update.message) as JsonRecord | undefined;
    const from = (callback?.from || message?.from) as JsonRecord | undefined;
    const userId = String(from?.id || '');
    const chat = message?.chat as JsonRecord | undefined;
    const chatId = Number(chat?.id || 0);
    const isCallback = Boolean(callback?.id);

    if (callback?.id) {
      await telegram('answerCallbackQuery', { callback_query_id: callback.id });
    }
    if (!chatId || !userId) return jsonResponse({ ok: true });
    if (!isCallback && (from?.is_bot === true || !message?.text)) {
      return jsonResponse({ ok: true });
    }
    if (!TELEGRAM_ALLOWED_USER_IDS.has(userId)) {
      console.warn(`[telegram-sales-bot] Usuario no autorizado: ${userId}`);
      await answer(chatId, '⛔ Este usuario no está autorizado para consultar el TPV.');
      return jsonResponse({ ok: true });
    }

    const text = String(callback?.data || message?.text || '');
    const intent = intentFor(text);
    const period = periodFor(text);
    let reply = '';

    if (intent === 'help' || intent === 'unknown') {
      reply = intent === 'help'
        ? helpMessage()
        : `No he entendido esa consulta.\n\n${helpMessage()}`;
    } else if (intent === 'summary') {
      reply = summaryMessage(period, await loadSales(period));
    } else if (intent === 'voids') {
      reply = await voidsMessage(chatId, period);
    } else {
      const { sales, lines, payments } = await loadDetails(period);
      if (intent === 'cash') reply = cashMessage(period, sales, payments);
      if (intent === 'top') reply = topMessage(period, sales, lines);
      if (intent === 'product') {
        const query = inferProductQuery(text);
        reply = query
          ? productMessage(query, period, sales, lines)
          : 'Indica el artículo. Por ejemplo: <code>/producto minipancakes</code>';
      }
    }

    await answer(chatId, reply);
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('[telegram-sales-bot] Error inesperado', error);
    return jsonResponse({ ok: true });
  }
});
