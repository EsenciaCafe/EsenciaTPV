import { supabase } from './supabase.js';

export async function notifyTelegramTicketCleared(snapshot) {
  const { data, error } = await supabase.functions.invoke('telegram-sales-bot', {
    body: {
      type: 'ticket_cleared',
      eventId: snapshot.eventId,
      occurredAt: snapshot.occurredAt,
      orderName: snapshot.orderName,
      orderType: snapshot.orderType,
      staffName: snapshot.staffName,
      total: snapshot.total,
      items: snapshot.items
    }
  });

  if (error) throw new Error(error.message || 'Telegram no confirmó el vaciado.');
  if (!data?.ok) throw new Error(data?.error || 'Telegram no confirmó el vaciado.');
  return true;
}
