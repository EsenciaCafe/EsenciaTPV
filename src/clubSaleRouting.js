// A normal sale must never depend on the Club server's availability.
// Once Club is involved, failures must not bypass its atomic fiscal write.
export function saleNeedsClubServer(transaction){
 return transaction?.loyaltyCustomer?.provider==='club-esencia'||!!transaction?.clubPromotions?.length||!!transaction?.items?.some(item=>item.clubPromotion);
}
