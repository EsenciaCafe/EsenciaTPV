// The TPV delivers vouchers already bought on the Club web; it never sells rewards.
export function pendingOffers(offers) {
  return (offers.pending || []).filter(v => v.status === 'pending' && !v.reserved).flatMap(v => {
    const reward = (offers.rewards || []).find(r => r.id === v.reward_id && r.rule);
    return reward ? [{...reward, redemption_id: v.id, cost: v.cost, pending: true}] : [];
  });
}
