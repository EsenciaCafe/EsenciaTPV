const currencyFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR'
});

const viteEnv = import.meta.env || {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY;

export function normalizeSquareGiftCardCode(value = '') {
  const text = String(value).trim();
  const giftCardIdMatch = text.match(/gftc:[A-Za-z0-9_-]+/i);
  if (giftCardIdMatch) return giftCardIdMatch[0];

  const sqgcMatch = text.match(/sqgc:\/\/([A-Za-z0-9-]+)/i);
  if (sqgcMatch) {
    return sqgcMatch[1].trim().replace(/[\s-]/g, '');
  }

  const numericMatches = text.match(/(?:\d[\s-]?){8,255}/g) || [];
  const longestNumeric = numericMatches
    .map(match => match.replace(/[\s-]/g, ''))
    .filter(match => match.length >= 8)
    .sort((a, b) => b.length - a.length)[0];
  const rawCode = longestNumeric || text;

  return rawCode
    .trim()
    .replace(/^sqgc:\/\//i, '')
    .replace(/[\s-]/g, '');
}

export function validateSquareGiftCardCode(value = '') {
  const code = normalizeSquareGiftCardCode(value);
  if (!code) {
    return 'Introduce o escanea el codigo de la tarjeta regalo.';
  }
  if (!/^[A-Za-z0-9:._-]{8,255}$/.test(code)) {
    return 'El codigo leido no parece una tarjeta regalo Square valida.';
  }
  return '';
}

function assertGiftCardCode(value) {
  const gan = normalizeSquareGiftCardCode(value);
  const validationError = validateSquareGiftCardCode(gan);
  if (validationError) throw new Error(validationError);
  return gan;
}

async function invokeSquareGiftCards(body) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Falta configurar Supabase para consultar tarjetas regalo.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/square-gift-cards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Square respondio con error ${response.status}.`);
  }

  return data;
}

export async function lookupSquareGiftCard(code) {
  const gan = assertGiftCardCode(code);
  return invokeSquareGiftCards({
    action: 'lookup',
    gan
  });
}

export async function redeemSquareGiftCard({ code, amount, referenceId }) {
  const gan = assertGiftCardCode(code);
  const numericAmount = Number(amount || 0);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('El importe a canjear no es valido.');
  }

  return invokeSquareGiftCards({
    action: 'redeem',
    gan,
    amount: Number(numericAmount.toFixed(2)),
    referenceId
  });
}

export function formatGiftCardBalance(amount) {
  return currencyFormatter.format(Number(amount || 0));
}
