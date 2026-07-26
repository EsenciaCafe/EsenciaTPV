import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function envValue(contents, name) {
  const line = contents
    .split(/\r?\n/)
    .filter(value => value.startsWith(`${name}=`))
    .at(-1);
  if (!line) return '';
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
}

async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram rechazó ${method}: ${result.description || response.status}`);
  }
  return result.result;
}

const BOT_COMMANDS = [
  { command: 'hoy', description: 'Resumen de ventas de hoy' },
  { command: 'ayer', description: 'Resumen de ventas de ayer' },
  { command: 'mes', description: 'Resumen del mes actual' },
  { command: 'caja', description: 'Desglose por forma de pago' },
  { command: 'top', description: 'Artículos más vendidos' },
  { command: 'producto', description: 'Consultar un artículo' },
  { command: 'vaciados', description: 'Pedidos vaciados hoy o ayer' },
  { command: 'ayuda', description: 'Ver consultas disponibles' }
];

const localEnv = readFileSync('.env.local', 'utf8');
const token = envValue(localEnv, 'TELEGRAM_BOT_TOKEN');
if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN en .env.local.');

const bot = await telegram(token, 'getMe');
if (process.argv.includes('--commands-only')) {
  await telegram(token, 'setMyCommands', { commands: BOT_COMMANDS });
  console.log(`Comandos de @${bot.username} actualizados.`);
  process.exit(0);
}
const candidates = new Map();
const configuredIds = envValue(localEnv, 'TELEGRAM_ALLOWED_USER_IDS') || process.argv[2] || '';
if (configuredIds) {
  for (const id of configuredIds.split(',').map(value => value.trim()).filter(Boolean)) {
    candidates.set(id, { id, chatId: Number(id), name: 'usuario autorizado' });
  }
} else {
  const updates = await telegram(
    token,
    'getUpdates?limit=50&allowed_updates=%5B%22message%22%5D'
  );
  for (const update of updates) {
    const message = update.message;
    if (message?.chat?.type !== 'private' || !message.from?.id) continue;
    candidates.set(String(message.from.id), {
      id: String(message.from.id),
      chatId: message.chat.id,
      name: message.from.first_name || message.from.username || 'usuario'
    });
  }
}

if (candidates.size === 0) {
  throw new Error(`Envía un mensaje privado a @${bot.username} y vuelve a ejecutar el script.`);
}
if (candidates.size > 1) {
  throw new Error(
    'Hay mensajes de más de un usuario. Define TELEGRAM_ALLOWED_USER_IDS en .env.local para elegirlos.'
  );
}

const selected = [...candidates.values()][0];
const allowedIds = configuredIds || selected.id;
const webhookSecret = randomBytes(32).toString('hex');
const projectRef = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (!projectRef) throw new Error('El proyecto Supabase no está vinculado.');

const supabase = spawnSync(
  process.platform === 'win32' ? 'C:\\Progra~1\\nodejs\\npx.cmd' : 'npx',
  [
    'supabase',
    'secrets',
    'set',
    `TELEGRAM_BOT_TOKEN=${token}`,
    `TELEGRAM_WEBHOOK_SECRET=${webhookSecret}`,
    `TELEGRAM_ALLOWED_USER_IDS=${allowedIds}`
  ],
  {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true
  }
);
if (supabase.status !== 0) {
  const detail = supabase.error?.message || supabase.stderr?.trim() || `código ${supabase.status}`;
  throw new Error(`No se pudieron guardar los secretos en Supabase: ${detail}`);
}

const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/telegram-sales-bot`;
await telegram(token, 'setWebhook', {
  url: webhookUrl,
  secret_token: webhookSecret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true
});
await telegram(token, 'setMyCommands', {
  commands: BOT_COMMANDS
});
await telegram(token, 'sendMessage', {
  chat_id: selected.chatId,
  text: '✅ Bot conectado al TPV. Escribe /hoy para comprobar las ventas.'
});

const testResponse = await fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Telegram-Bot-Api-Secret-Token': webhookSecret
  },
  body: JSON.stringify({
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      date: Math.floor(Date.now() / 1000),
      text: '/hoy',
      from: { id: Number(selected.id), first_name: selected.name, is_bot: false },
      chat: { id: selected.chatId, type: 'private' }
    }
  })
});
if (!testResponse.ok) {
  throw new Error(`La prueba del webhook falló con HTTP ${testResponse.status}.`);
}

const webhook = await telegram(token, 'getWebhookInfo');
console.log(`Bot @${bot.username} configurado.`);
console.log(`Usuario autorizado: ${selected.name} (${selected.id}).`);
console.log(`Webhook activo: ${webhook.url === webhookUrl ? 'sí' : 'no'}.`);
console.log('Consulta /hoy verificada de extremo a extremo.');
