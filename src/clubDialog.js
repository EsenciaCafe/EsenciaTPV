const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createClubDialog(title){
 const dialog=document.createElement('dialog');dialog.className='club-dialog';dialog.setAttribute('aria-label',title);
 dialog.innerHTML=`<div class="modal-dialog ticket-discount-dialog"><div class="modal-header ticket-discount-header"><div><h3>${escape(title)}</h3></div><button class="modal-close-btn" type="button" data-close aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button></div><div class="ticket-discount-body" data-body></div><div class="ticket-discount-footer club-footer" data-footer></div></div>`;
 document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return dialog;
}
export function placeClubActions(dialog){
 const footer=dialog.querySelector('[data-footer]');
 for(const button of dialog.querySelectorAll('[data-cancel],[data-confirm],[data-done]')){
  button.className=button.hasAttribute('data-confirm')?'btn btn-primary':'btn btn-secondary';footer.append(button);
 }
 const cancel=footer.querySelector('[data-cancel]'),confirm=footer.querySelector('[data-confirm]');if(cancel&&confirm)footer.insertBefore(cancel,confirm);
}
