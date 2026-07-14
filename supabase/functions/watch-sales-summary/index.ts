const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const WATCH_SUMMARY_TOKEN_HASH = Deno.env.get('WATCH_SUMMARY_TOKEN_HASH') || '';
const BUSINESS_TIME_ZONE = 'Atlantic/Canary';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function localDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function paymentBucket(method = '') {
  const normalized = String(method).toLowerCase();
  if (normalized.includes('efectivo')) return 'cash';
  if (normalized.includes('regalo') || normalized.includes('gift')) return 'gift';
  return 'card';
}

function salePayments(sale: Record<string, unknown>) {
  const payload = (sale.payload || {}) as Record<string, unknown>;
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  if (payments.length > 0) return payments as Array<Record<string, unknown>>;
  return [{
    method: sale.payment_method || payload.paymentMethod || '',
    saleAmount: sale.total_amount || payload.total || 0
  }];
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET') return jsonResponse({ error: 'Metodo no permitido.' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WATCH_SUMMARY_TOKEN_HASH) {
    return jsonResponse({ error: 'El resumen del reloj no esta configurado.' }, 503);
  }

  const url = new URL(request.url);
  const tokenHash = await sha256(url.searchParams.get('token') || '');
  if (!timingSafeEqual(tokenHash, WATCH_SUMMARY_TOKEN_HASH)) {
    return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  }

  const today = localDateKey(new Date());
  const since = new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString();
  const query = new URL(`${SUPABASE_URL}/rest/v1/sales`);
  query.searchParams.set('select', 'id,type,total_amount,payment_method,closed_at,created_at,payload');
  query.searchParams.set('closed_at', `gte.${since}`);
  query.searchParams.set('order', 'closed_at.desc');
  query.searchParams.set('limit', '2000');

  try {
    const response = await fetch(query, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!response.ok) {
      console.error('[watch-sales-summary] Supabase error', response.status, await response.text());
      return jsonResponse({ error: 'No se pudo consultar el resumen.' }, 502);
    }

    const rows = (await response.json()) as Array<Record<string, unknown>>;
    const sales = rows.filter(row => {
      const payload = (row.payload || {}) as Record<string, unknown>;
      const occurredAt = String(payload.createdAt || row.closed_at || row.created_at || '');
      return payload.voided !== true && occurredAt && localDateKey(occurredAt) === today;
    });

    const summary = sales.reduce((result, sale) => {
      const type = String(sale.type || 'sale').toLowerCase();
      const total = Number(sale.total_amount || 0);
      if (type === 'refund') {
        result.refunds += Math.abs(total);
        result.net += total > 0 ? -total : total;
        return result;
      }

      result.tickets += 1;
      result.gross += total;
      result.net += total;
      salePayments(sale).forEach(payment => {
        const amount = Number(payment.saleAmount ?? payment.amount ?? 0);
        result.payments[paymentBucket(String(payment.method || ''))] += amount;
      });
      return result;
    }, {
      tickets: 0,
      gross: 0,
      refunds: 0,
      net: 0,
      payments: { cash: 0, card: 0, gift: 0 }
    });

    const net = roundMoney(summary.net);
    const formatter = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    });

    return jsonResponse({
      title: 'Ventas hoy',
      value: formatter.format(net),
      shortValue: `${Math.round(net)} EUR`,
      subtitle: `${summary.tickets} ${summary.tickets === 1 ? 'ticket' : 'tickets'}`,
      date: today,
      amount: net,
      tickets: summary.tickets,
      grossSales: roundMoney(summary.gross),
      refunds: roundMoney(summary.refunds),
      payments: {
        cash: roundMoney(summary.payments.cash),
        card: roundMoney(summary.payments.card),
        gift: roundMoney(summary.payments.gift)
      },
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[watch-sales-summary] Unexpected error', error);
    return jsonResponse({ error: 'No se pudo generar el resumen.' }, 500);
  }
});
