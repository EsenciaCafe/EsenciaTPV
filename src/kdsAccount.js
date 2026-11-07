const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
})[char]);

// Amounts and ordering come from the same Store helpers used by checkout.
export function renderKdsAccount({ tableName, lines, total, grossTotal, discountTotal }) {
  return `<section class="kds-account" aria-label="Cuenta de ${escape(tableName)}">
    <header class="kds-account-header"><div class="kds-account-width">
      <h1>Cuenta · ${escape(tableName)}</h1>
      <button type="button" class="btn btn-secondary" id="kds-checkout-return">Volver al KDS</button>
    </div></header>
    <div class="kds-account-main" tabindex="0" aria-label="Artículos de la cuenta"><div class="kds-account-width">
      <ol class="kds-account-lines">${lines.map(line => `<li class="kds-account-line">
        <div class="kds-account-line-top">
          <h2><span class="kds-account-qty">${escape(line.qty)} ×</span> ${escape(line.name)}</h2>
          <div class="kds-account-line-price">${line.discount > 0 ? `<s>${euro.format(line.gross)}</s>` : ''}<strong>${euro.format(line.total)}</strong></div>
        </div>
        ${line.selectedOptions?.length ? `<ul class="kds-account-options">${line.selectedOptions.filter(option => Number(option.qty) > 0).map(option => `<li>${escape(option.qty)} × ${escape(option.name)}${Number(option.price) > 0 ? ` <span>+${euro.format(Number(option.price))}/ud.</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${line.note ? `<p class="kds-account-note">${escape(line.note)}</p>` : ''}
        ${line.discount > 0 ? `<p class="kds-account-discount">${escape(line.discountReason || (line.total === 0 ? 'Invitación' : 'Descuento'))} · −${euro.format(line.discount)}</p>` : ''}
      </li>`).join('')}</ol>
      <dl class="kds-account-totals">
        ${discountTotal > 0 ? `<div><dt>Antes de descuentos</dt><dd>${euro.format(grossTotal)}</dd></div><div><dt>Descuentos / invitaciones</dt><dd>−${euro.format(discountTotal)}</dd></div>` : ''}
        <div class="kds-account-total"><dt>Total</dt><dd>${euro.format(total)}</dd></div>
      </dl>
    </div></div>
    <footer class="kds-account-footer"><div class="kds-account-width">
      <p id="kds-checkout-status" role="status" aria-live="polite"></p>
      <button type="button" class="btn btn-primary" id="kds-account-pay">${total === 0 ? 'Cerrar invitación' : 'Cobrar'} · ${euro.format(total)}</button>
    </div></footer>
  </section>`;
}
