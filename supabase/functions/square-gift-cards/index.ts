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
  const sqgcMatch = text.match(/sqgc:\/\/([A-Za-z0-9-]+)/i);
  const rawCode = sqgcMatch ? sqgcMatch[1] : text;
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
  const card = await retrieveGiftCardByGan(gan);
  return {
    giftCard: mapGiftCard(card)
  };
}

async function handleRedeem(gan: string, amount: number, referenceId?: string) {
  const amountCents = euroToCents(amount);
  if (amountCents <= 0) throw new Error('El importe a canjear no es valido.');

  const card = await retrieveGiftCardByGan(gan);
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
        gift_card_gan: gan,
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

  const updatedCard = await retrieveGiftCardByGan(gan).catch(() => null);

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
