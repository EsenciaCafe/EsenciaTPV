import { supabase } from './supabase.js';

export async function notifyTelegramCashClosure(closure) {
  const { data, error } = await supabase.functions.invoke('telegram-sales-bot', {
    body: {
      type: 'cash_closed',
      closureId: closure.id,
      businessDate: closure.businessDate,
      shiftNumber: closure.shiftNumber,
      closedAt: closure.closedAt,
      staffName: closure.staff?.name || '',
      countedCash: closure.countedCash,
      cashDifference: closure.cashDifference,
      bbvaTotal: closure.bbvaTotal,
      cardDifference: closure.cardDifference,
      notes: closure.notes || ''
    }
  });

  if (error) throw new Error(error.message || 'No se pudo enviar el resumen del cierre.');
  if (!data?.ok) throw new Error(data?.error || 'No se pudo enviar el resumen del cierre.');
  return true;
}
