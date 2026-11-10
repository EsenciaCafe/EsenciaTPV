import {buildPaymentCorrection, correctionPayments, createPaymentCorrectionDraft} from './paymentCorrection.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'})[char]);
const money = value => `${Number(value).toFixed(2)} €`;

export function openPaymentCorrection({transaction, save, onSaved}) {
  const original = structuredClone(transaction);
  const payments = correctionPayments(original);
  const draft = createPaymentCorrectionDraft(original);
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'payment-correction-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'payment-correction-title');
  let busy = false;
  let requestKey;
  let requestId;
  modal.innerHTML = `
    <div class="modal-dialog payment-correction-dialog">
      <div class="modal-header payment-correction-header">
        <div><span class="payment-correction-eyebrow">${escape(original.fiscalData?.fiscalNumber || original.id)}</span><h3 id="payment-correction-title">Corregir cobro</h3></div>
        <button type="button" class="modal-close-btn" id="payment-correction-close-btn" aria-label="Cerrar">×</button>
      </div>
      <div class="modal-body payment-correction-body">
        <div class="payment-correction-summary"><span>Total de la venta (sin propina)</span><strong>${money(original.total)}</strong></div>
        <div class="payment-correction-list">${payments.map((payment, index) => `
          <section class="payment-correction-row" data-payment-row="${index}">
            <div class="payment-correction-row-heading"><span>Pago ${index + 1} · Parte de la venta</span><strong>${money(payment.saleAmount)}</strong></div>
            <div class="payment-correction-options" role="group" aria-label="Método del pago ${index + 1}">
              ${['Efectivo','Tarjeta'].map(method => `<button type="button" class="payment-correction-choice" data-payment-method="${method}" data-payment-index="${index}">${method}</button>`).join('')}
            </div>
            <label class="payment-correction-charge" for="correction-charge-${index}">Total cobrado en tarjeta</label>
            <input id="correction-charge-${index}" class="editor-form-input payment-correction-amount" type="text" inputmode="decimal" autocomplete="off" value="${escape(draft[index].charged)}" placeholder="${payment.saleAmount.toFixed(2)}" aria-describedby="correction-tip-${index}">
            <div class="payment-correction-tip" id="correction-tip-${index}">Propina <strong data-tip>0.00 €</strong></div>
          </section>`).join('')}</div>
        <div class="payment-correction-total"><span>Propina retirada del efectivo</span><strong id="correction-tip-total"></strong></div>
        <div class="payment-correction-total"><span>Total cobrado</span><strong id="correction-charged-total"></strong></div>
        <p class="payment-correction-error" id="payment-correction-error" role="alert"></p>
      </div>
      <div class="modal-footer payment-correction-footer">
        <button type="button" class="btn btn-secondary" id="payment-correction-cancel-btn">Cancelar</button>
        <button type="button" class="btn btn-primary" id="payment-correction-save-btn">Guardar corrección</button>
      </div>
    </div>`;
  const error = modal.querySelector('#payment-correction-error');
  const saveButton = modal.querySelector('#payment-correction-save-btn');
  const update = () => {
    let patch;
    error.textContent = '';
    try { patch = buildPaymentCorrection(original, draft); } catch (err) { error.textContent = err.message; }
    draft.forEach((edit, index) => {
      const row = modal.querySelector(`[data-payment-row="${index}"]`);
      row.querySelectorAll('[data-payment-method]').forEach(button => {
        const active = button.dataset.paymentMethod === edit.method;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      row.querySelector('.payment-correction-charge').textContent = edit.method === 'Tarjeta' ? 'Total cobrado en tarjeta' : 'Total cobrado en efectivo';
      row.querySelector('input').readOnly = edit.method !== 'Tarjeta';
      row.querySelector('[data-tip]').textContent = patch ? money(patch.payments[index].tipAmount) : '—';
    });
    modal.querySelector('#correction-tip-total').textContent = patch ? money(patch.tipAmount) : '—';
    modal.querySelector('#correction-charged-total').textContent = patch ? money(patch.totalCharged) : '—';
    saveButton.disabled = busy || !patch;
  };
  const close = () => { if (!busy) modal.remove(); };
  modal.querySelector('#payment-correction-close-btn').onclick = close;
  modal.querySelector('#payment-correction-cancel-btn').onclick = close;
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.querySelectorAll('[data-payment-method]').forEach(button => {
    button.onclick = () => {
      if (busy) return;
      const index = Number(button.dataset.paymentIndex);
      draft[index].method = button.dataset.paymentMethod;
      if (draft[index].method === 'Efectivo') {
        draft[index].charged = payments[index].saleAmount.toFixed(2);
        modal.querySelector(`#correction-charge-${index}`).value = draft[index].charged;
      }
      update();
    };
  });
  modal.querySelectorAll('input').forEach((input, index) => {
    input.oninput = () => { draft[index].charged = input.value; update(); };
  });
  saveButton.onclick = async () => {
    if (busy) return;
    try {
      const patch = buildPaymentCorrection(original, draft);
      const key = JSON.stringify(patch.payments);
      if (key !== requestKey) { requestKey = key; requestId = crypto.randomUUID(); }
      busy = true;
      modal.querySelectorAll('button,input').forEach(control => {control.disabled = true;});
      saveButton.textContent = 'Guardando...';
      error.textContent = '';
      const updated = await save(original.id, draft, {expectedTransaction:original, requestId});
      if (!updated) throw new Error('No se pudo confirmar la corrección. Vuelve a intentarlo.');
      modal.remove();
      onSaved(updated);
    } catch (err) {
      busy = false;
      modal.querySelectorAll('button,input').forEach(control => {control.disabled = false;});
      saveButton.textContent = 'Guardar corrección';
      update();
      error.textContent = err.message;
    }
  };
  update();
  document.body.appendChild(modal);
  return modal;
}
