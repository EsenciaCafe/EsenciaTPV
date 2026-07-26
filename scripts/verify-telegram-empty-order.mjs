import { readFileSync } from 'node:fs';

// Manual end-to-end verifier. Run with the authorized Telegram user ID.

function envValue(contents, name) {
  const line = contents.split(/\r?\n/).filter(value => value.startsWith(`${name}=`)).at(-1);
  return line
    ? line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    : '';
}

async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.description || `HTTP ${response.status}`);
  return payload.result;
}

const localEnv = readFileSync('.env.local', 'utf8');
const token = envValue(localEnv, 'TELEGRAM_BOT_TOKEN');
const anonKey = envValue(localEnv, 'VITE_SUPABASE_ANON_KEY');
const supabaseUrl = envValue(localEnv, 'VITE_SUPABASE_URL');
const chatId = Number(process.argv[2]);
if (!token || !anonKey || !supabaseUrl || !chatId) {
  throw new Error('Faltan token, configuración de Supabase o el ID de Telegram.');
}

const beforeChat = await telegram(token, 'getChat', { chat_id: chatId });
const beforePinned = beforeChat.pinned_message
  ? {
      messageId: beforeChat.pinned_message.message_id,
      text: beforeChat.pinned_message.text || ''
    }
  : null;
const eventId = `EMPTY-INTEGRATION-${Date.now()}`;

let notificationMessageIds = [];
try {
  const response = await fetch(`${supabaseUrl}/functions/v1/telegram-sales-bot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify({
      type: 'ticket_cleared',
      eventId,
      occurredAt: new Date().toISOString(),
      orderName: 'PRUEBA AUTOMÁTICA',
      orderType: 'test',
      staffName: 'Codex',
      total: 3.5,
      items: [{ name: 'Artículo de prueba', quantity: 1, total: 3.5 }]
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  notificationMessageIds = payload.notificationMessageIds || [];
  console.log('Notificación de vaciado recibida por Telegram.');
} finally {
  const afterChat = await telegram(token, 'getChat', { chat_id: chatId });
  const afterPinned = afterChat.pinned_message;
  if (beforePinned?.messageId && afterPinned?.message_id === beforePinned.messageId) {
    await telegram(token, 'editMessageText', {
      chat_id: chatId,
      message_id: beforePinned.messageId,
      text: beforePinned.text
    });
  } else if (afterPinned?.text?.includes('TPV_VOID_LEDGER_V1:')) {
    await telegram(token, 'deleteMessage', {
      chat_id: chatId,
      message_id: afterPinned.message_id
    });
  }
  for (const message of notificationMessageIds) {
    if (!message.messageId) continue;
    await telegram(token, 'deleteMessage', {
      chat_id: message.chatId,
      message_id: message.messageId
    });
  }
}

console.log('Prueba retirada: no altera el historial de vaciados.');
