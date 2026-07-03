import { supabase } from './supabase.js';

const currencyFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR'
});

export function normalizeSquareGiftCardCode(value = '') {
  return String(value)
    .trim()
    .replace(/^sqgc:\/\//i, '')
    .replace(/[\s-]/g, '');
}

function assertGiftCardCode(value) {
  const gan = normalizeSquareGiftCardCode(value);
  if (!gan) throw new Error('Introduce o escanea el codigo de la tarjeta regalo.');
  return gan;
}

async function invokeSquareGiftCards(body) {
  const { data, error } = await supabase.functions.invoke('square-gift-cards', {
    body
  });

  if (error) {
    throw new Error(error.message || 'No se pudo conectar con Square.');
  }

  if (data?.error) {
    throw new Error(data.error);
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
