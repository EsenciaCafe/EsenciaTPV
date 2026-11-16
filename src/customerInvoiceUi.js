import {invoiceCustomer} from './customerInvoice.js';
import {createCustomerInvoicePdf,prepareCustomerInvoicePdf} from './customerInvoicePdf.js';
import './customerInvoice.css';

const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money = value => `${Number(value).toFixed(2)} €`;
const date = value => new Date(value).toLocaleDateString('es-ES',{timeZone:'Atlantic/Canary'});
const fields = [['name','Nombre o razón social',160],['taxId','NIF/CIF/NIE español',20],['address','Domicilio fiscal',240],['postalCode','Código postal',5],['city','Municipio',100],['province','Provincia',100]];

export function openCustomerInvoice({saleId,call}) {
  const modal = document.createElement('div');
  modal.className='modal-backdrop';modal.id='customer-invoice-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','customer-invoice-title');
  modal.innerHTML=`<section class="modal-dialog customer-invoice-dialog">
    <header class="modal-header"><h3 id="customer-invoice-title">Factura del cliente</h3><button class="modal-close-btn" type="button" aria-label="Cerrar">×</button></header>
    <div class="modal-body customer-invoice-body"><p role="status" data-status>Consultando el ticket…</p><div data-content></div><p role="alert" data-error></p></div>
    <footer class="modal-footer"><button class="btn btn-secondary" type="button" data-back>Cancelar</button><button class="btn btn-primary" type="button" data-primary disabled>Continuar</button></footer>
  </section>`;
  const content=modal.querySelector('[data-content]'),error=modal.querySelector('[data-error]'),status=modal.querySelector('[data-status]'),primary=modal.querySelector('[data-primary]'),back=modal.querySelector('[data-back]');
  let busy=false,stage='loading',source,sourceHash,customer,invoice;
  const close=()=>{if(!busy)modal.remove();};
  const lock=value=>{busy=value;modal.querySelectorAll('button,input').forEach(el=>el.disabled=value);};
  modal.querySelector('.modal-close-btn').onclick=close;
  modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
  back.onclick=()=>{if(stage==='review'){showForm();}else close();};
  const summary = data => `<div class="customer-invoice-summary"><span>${escape(data.original.number)} · ${date(data.operationDate)}</span><strong>${money(data.total)}</strong></div>`;
  const lines = data => `<div class="customer-invoice-lines">${data.lines.map(line=>`<div><span><strong>${escape(line.description)} ×${line.qty}</strong>${line.options.map(o=>`<small>${escape(o)}</small>`).join('')}</span><strong>${money(line.total)}</strong></div>`).join('')}</div><div class="customer-invoice-totals"><span>Base imponible</span><strong>${money(data.base)}</strong><span>${escape(data.taxName)} ${data.taxRate}%</span><strong>${money(data.tax)}</strong><span>Total factura</span><strong>${money(data.total)}</strong></div>`;
  const recipient = c => `<address><strong>${escape(c.name)}</strong><br>${escape(c.taxId)}<br>${escape(c.address)}<br>${escape(c.postalCode)} ${escape(c.city)}<br>${escape(c.province)} · España</address>`;
  function showForm() {
    stage='form';error.textContent='';status.textContent='';back.textContent='Cancelar';primary.textContent='Revisar factura';primary.disabled=false;
    content.innerHTML=summary(source)+`<form class="customer-invoice-form">${fields.map(([key,label,max])=>`<label>${label}<input class="editor-form-input" name="${key}" required maxlength="${max}" autocomplete="off" ${key==='postalCode'?'inputmode="numeric" pattern="[0-9]{5}"':''} value="${escape(customer?.[key]||'')}"></label>`).join('')}<button type="submit" hidden>Revisar</button></form>`;
    content.querySelector('form').onsubmit=event=>{event.preventDefault();primary.click();};
  }
  function showInvoice() {
    stage='issued';status.textContent='Factura emitida';back.textContent='Cerrar';primary.textContent='Descargar PDF';primary.disabled=false;
    content.innerHTML=`<h4>${escape(invoice.fiscalNumber)}</h4><p>Emisión: ${date(invoice.issuedAt)}</p>${summary(invoice)}${recipient(invoice.customer)}${lines(invoice)}`;
  }
  async function load() {
    lock(true);status.textContent='Consultando el ticket…';error.textContent='';
    try {
      const result=await call('invoice_get',{saleId});
      if(!modal.isConnected)return;
      invoice=result.invoice;source=result.source;sourceHash=result.sourceHash;
      if(invoice)showInvoice();else showForm();
    }catch(err){error.textContent=err.message;status.textContent='';stage='failed';primary.textContent='Reintentar';}
    finally{lock(false);}
  }
  primary.onclick=async()=>{
    if(busy)return;
    error.textContent='';
    try {
      if(stage==='failed'){await load();return;}
      if(stage==='form') {
        const form=content.querySelector('form');if(!form.reportValidity())return;
        customer=invoiceCustomer(Object.fromEntries(new FormData(form)));
        stage='review';back.textContent='Editar datos';primary.textContent='Emitir factura';
        content.innerHTML=`${summary(source)}<h4>Cliente</h4>${recipient(customer)}${lines(source)}`;
        return;
      }
      if(stage==='review') {
        lock(true);status.textContent='Confirmando emisión…';
        await prepareCustomerInvoicePdf();
        invoice=await call('invoice_issue',{saleId,customer,sourceHash});
        showInvoice();
      }else if(stage==='issued'){
        lock(true);
        (await createCustomerInvoicePdf(invoice)).save(`${invoice.fiscalNumber}.pdf`);
      }
    }catch(err){error.textContent=err.message;status.textContent=stage==='review'?'Emisión sin confirmar. Reintenta: no se emitirá otra factura para esta venta.':'';}
    finally{lock(false);}
  };
  document.body.append(modal);void load();
  return modal;
}
