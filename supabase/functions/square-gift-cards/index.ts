const SQUARE_VERSION = Deno.env.get('SQUARE_API_VERSION') || '2026-05-20';
const SQUARE_ENVIRONMENT = (Deno.env.get('SQUARE_ENVIRONMENT') || 'production').toLowerCase();
const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') || '';
const SQUARE_LOCATION_ID = Deno.env.get('SQUARE_LOCATION_ID') || '';

const SQUARE_BASE_URL = SQUARE_ENVIRONMENT === 'sandbox'
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const body = await request.json().catch(() => ({})) as RequestBody;
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
