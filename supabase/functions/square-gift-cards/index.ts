const SQUARE_VERSION = Deno.env.get('SQUARE_API_VERSION') || '2026-05-20';
const SQUARE_ENVIRONMENT = (Deno.env.get('SQUARE_ENVIRONMENT') || 'production').toLowerCase();
const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') || '';
const SQUARE_LOCATION_ID = Deno.env.get('SQUARE_LOCATION_ID') || '';
const SQUARE_WEBHOOK_SIGNATURE_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') || '';
const SQUARE_WEBHOOK_NOTIFICATION_URL = Deno.env.get('SQUARE_WEBHOOK_NOTIFICATION_URL') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const SQUARE_BASE_URL = SQUARE_ENVIRONMENT === 'sandbox'
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-square-hmacsha256-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type RequestBody = {
  action?: 'lookup' | 'redeem';
  gan?: string;
  amount?: number;
  referenceId?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function normalizeGan(value = '') {
  const text = String(value).trim();
  const squareBalanceUrlMatch = text.match(/squareup\.com\/gift\/balance\/([A-Za-z0-9_-]+)/i);
  if (squareBalanceUrlMatch) return `gftc:${squareBalanceUrlMatch[1]}`;

  const giftCardIdMatch = text.match(/gftc:[A-Za-z0-9_-]+/i);
  if (giftCardIdMatch) return giftCardIdMatch[0];

  const sqgcMatch = text.match(/sqgc:\/\/([A-Za-z0-9-]+)/i);
  if (sqgcMatch) return sqgcMatch[1].trim().replace(/[\s-]/g, '');

  const numericMatches = text.match(/(?:\d[\s-]?){8,255}/g) || [];
  const longestNumeric = numericMatches
    .map(match => match.replace(/[\s-]/g, ''))
    .filter(match => match.length >= 8)
    .sort((a, b) => b.length - a.length)[0];
  const rawCode = longestNumeric || text;
  return rawCode.trim().replace(/^sqgc:\/\//i, '').replace(/[\s-]/g, '');
}

function euroToCents(value: number) {
  return Math.round(Number(value || 0) * 100);
}

function centsToEuro(value: number) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function timingSafeEqualText(a = '', b = '') {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifySquareWebhookSignature(rawBody: string, signature: string | null) {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY || !SQUARE_WEBHOOK_NOTIFICATION_URL) {
    throw new Error('Faltan SQUARE_WEBHOOK_SIGNATURE_KEY o SQUARE_WEBHOOK_NOTIFICATION_URL en Supabase.');
  }
  if (!signature) throw new Error('Falta la firma del webhook de Square.');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${SQUARE_WEBHOOK_NOTIFICATION_URL}${rawBody}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  if (!timingSafeEqualText(expected, signature)) {
    throw new Error('Firma del webhook de Square no valida.');
  }
}

function getActivityDetails(activity: any) {
  if (!activity?.type) return {};
  const key = `${String(activity.type).toLowerCase()}_activity_details`;
  return activity[key] || {};
}

function getMoneyFromWebhookObject(squareEventType: string, object: any) {
  const activity = object?.gift_card_activity || object?.giftCardActivity || null;
  if (activity) {
    const details = getActivityDetails(activity);
    return details.amount_money ||
      details.adjusted_amount_money ||
      details.balance_money ||
      activity.amount_money ||
      null;
  }

  if (squareEventType === 'gift_card.created') {
    return object?.gift_card?.balance_money || object?.giftCard?.balanceMoney || null;
  }

  return null;
}

function mapSquareWebhookEvent(body: any) {
  const squareEventType = body?.type || '';
  const object = body?.data?.object || {};
  const activity = object?.gift_card_activity || object?.giftCardActivity || null;
  const giftCard = object?.gift_card || object?.giftCard || null;
  const activityType = String(activity?.type || squareEventType || '').toUpperCase();
  const details = getActivityDetails(activity);
  const money = getMoneyFromWebhookObject(squareEventType, object) || {};
  const cents = Number(money.amount || 0);
  const eventType = ['ACTIVATE', 'LOAD'].includes(activityType)
    ? 'activate'
    : activityType === 'REDEEM' ? 'redeem'
      : activityType === 'REFUND' ? 'refund'
        : 'lookup';
  const createdAt = activity?.created_at || body?.created_at || new Date().toISOString();
  const squareActivityId = activity?.id || body?.event_id || crypto.randomUUID();
  const gan = activity?.gift_card_gan || giftCard?.gan || '';

  return {
    sale_id: null,
    event_type: eventType,
    gift_card_id: activity?.gift_card_id || giftCard?.id || null,
    gift_card_gan_last4: gan ? String(gan).slice(-4) : null,
    square_activity_id: squareActivityId,
    reference_id: details?.reference_id || body?.event_id || squareActivityId,
    amount: centsToEuro(cents),
    currency: money.currency || 'EUR',
    raw_payload: body,
    created_at: createdAt
  };
}

async function insertSquareGiftCardEvent(row: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Supabase.');
  }

  const activityId = String(row.square_activity_id || '');
  if (activityId) {
    const lookupUrl = `${SUPABASE_URL}/rest/v1/square_gift_card_events?square_activity_id=eq.${encodeURIComponent(activityId)}&select=id&limit=1`;
    const existing = await fetch(lookupUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const existingRows = await existing.json().catch(() => []);
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return { inserted: false, duplicate: true, id: existingRows[0]?.id };
    }
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/square_gift_card_events`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || 'No se pudo guardar el evento de tarjeta regalo Square.');
  }
  return { inserted: true, duplicate: false, id: data?.[0]?.id || null };
}

async function handleSquareWebhook(request: Request, rawBody: string, body: any) {
  await verifySquareWebhookSignature(rawBody, request.headers.get('x-square-hmacsha256-signature'));

  if (!['gift_card.created', 'gift_card.activity.created', 'gift_card.activity.updated'].includes(body?.type)) {
    return jsonResponse({ ok: true, ignored: true, type: body?.type || '' });
  }

  const row = mapSquareWebhookEvent(body);
  const result = await insertSquareGiftCardEvent(row);
  return jsonResponse({ ok: true, ...result });
}

function requireSquareConfig() {
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    throw new Error('Faltan SQUARE_ACCESS_TOKEN o SQUARE_LOCATION_ID en Supabase.');
  }
}

async function squareFetch(path: string, init: RequestInit = {}) {
  requireSquareConfig();

  const response = await fetch(`${SQUARE_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || 'Square rechazo la operacion.';
    throw new Error(message);
  }
  return data;
}

async function retrieveGiftCardByGan(gan: string) {
  const data = await squareFetch('/v2/gift-cards/from-gan', {
    method: 'POST',
    body: JSON.stringify({ gan })
  });
  return data.gift_card;
}

async function retrieveGiftCardByNonce(nonce: string) {
  const data = await squareFetch('/v2/gift-cards/from-nonce', {
    method: 'POST',
    body: JSON.stringify({ nonce })
  });
  return data.gift_card;
}

async function retrieveGiftCardById(id: string) {
  const data = await squareFetch(`/v2/gift-cards/${encodeURIComponent(id)}`, {
    method: 'GET'
  });
  return data.gift_card;
}

async function retrieveGiftCardByInput(value: string) {
  const input = normalizeGan(value);
  const attempts: Array<() => Promise<any>> = [];

  if (/^gftc:/i.test(input)) {
    attempts.push(() => retrieveGiftCardById(input));
  } else if (/^\d+$/.test(input) || /^sqgc:\/\//i.test(value)) {
    attempts.push(() => retrieveGiftCardByGan(input));
  } else {
    attempts.push(() => retrieveGiftCardByNonce(input));
    if (!input.startsWith('cnon:')) {
      attempts.push(() => retrieveGiftCardByNonce(`cnon:${input}`));
    }
    attempts.push(() => retrieveGiftCardByGan(input));
  }

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const card = await attempt();
      if (card) return card;
    } catch (error) {
      lastError = error;
    }
  }

  if (!/^\d+$/.test(input)) {
    throw new Error('El QR de Square no contiene el numero canjeable. Cambia a la pestana "Codigo de barras" de Square o usa el numero visible de 16 digitos.');
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('No se pudo encontrar la tarjeta regalo.');
}

function mapGiftCard(card: any) {
  const balance = card?.balance_money || {};
  return {
    id: card?.id || null,
    gan: card?.gan || null,
    last4: card?.gan ? String(card.gan).slice(-4) : null,
    state: card?.state || '',
    balance: centsToEuro(balance.amount || 0),
    currency: balance.currency || 'EUR'
  };
}

async function handleLookup(gan: string) {
  const card = await retrieveGiftCardByInput(gan);
  return {
    giftCard: mapGiftCard(card)
  };
}

async function handleRedeem(gan: string, amount: number, referenceId?: string) {
  const amountCents = euroToCents(amount);
  if (amountCents <= 0) throw new Error('El importe a canjear no es valido.');

  const card = await retrieveGiftCardByInput(gan);
  const mapped = mapGiftCard(card);
  const balanceCents = euroToCents(mapped.balance);

  if (mapped.state !== 'ACTIVE') {
    throw new Error('La tarjeta regalo no esta activa.');
  }
  if (balanceCents < amountCents) {
    throw new Error(`Saldo insuficiente. Saldo disponible: ${mapped.balance.toFixed(2)} EUR.`);
  }

  const idempotencyKey = `tpv-gift-redeem-${referenceId || crypto.randomUUID()}`;
  const data = await squareFetch('/v2/gift-cards/activities', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      gift_card_activity: {
        type: 'REDEEM',
        location_id: SQUARE_LOCATION_ID,
        ...(mapped.id ? { gift_card_id: mapped.id } : { gift_card_gan: mapped.gan || gan }),
        redeem_activity_details: {
          amount_money: {
            amount: amountCents,
            currency: mapped.currency || 'EUR'
          },
          reference_id: referenceId || idempotencyKey
        }
      }
    })
  });

  const updatedCard = mapped.id
    ? await retrieveGiftCardById(mapped.id).catch(() => null)
    : await retrieveGiftCardByInput(gan).catch(() => null);

  return {
    giftCard: updatedCard ? mapGiftCard(updatedCard) : mapped,
    activityId: data?.gift_card_activity?.id || null,
    amountRedeemed: centsToEuro(amountCents),
    referenceId: referenceId || idempotencyKey
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405);
  }

  try {
    const rawBody = await request.text();
    const body = JSON.parse(rawBody || '{}') as RequestBody & Record<string, unknown>;

    if (request.headers.has('x-square-hmacsha256-signature') || String(body.type || '').startsWith('gift_card.')) {
      return await handleSquareWebhook(request, rawBody, body);
    }

    const action = body.action || 'lookup';
    const gan = normalizeGan(body.gan);
    if (!gan) throw new Error('Falta el codigo de la tarjeta regalo.');

    if (action === 'lookup') {
      return jsonResponse(await handleLookup(gan));
    }

    if (action === 'redeem') {
      return jsonResponse(await handleRedeem(gan, Number(body.amount || 0), body.referenceId));
    }

    return jsonResponse({ error: 'Accion no soportada.' }, 400);
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Error procesando la tarjeta regalo.'
    }, 400);
  }
});
