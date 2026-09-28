import {createClubDialog as dialog} from './clubDialog.js';
import {clubServerEnabled} from './clubServerTransport.js';
import { showCustomerPromotions } from './clubPromotionUi.js';
import { clubTicketOptions } from './clubTicket.js';
import { clubRequestId } from './clubIntegration.js';
import { clubActor, clubClient, clubIntegration, clubLogin, clubLogout, clubQueue, clubPinEnabled, clubPinBridge, clubStaff } from './clubRuntime.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localDemo=import.meta.env.VITE_CLUB_LOCAL_DEMO==='true';
const demoQr='esencia-club:v1:00000000-0000-4000-8000-000000000004';
export function showClubPanel() {
  const modal = dialog('Club Esencia · Equipo');
  const body = modal.querySelector('[data-body]');
  let busy = false;
  async function draw(message = '') {
    if (!modal.isConnected) return;
    let actor, operations = [];
    try { actor = await clubActor(); operations = await clubQueue?.list() || []; }
    catch (e) { message = e.message; }
    if (!modal.isConnected) return;
    body.innerHTML = `<p>${clubPinEnabled ? 'Acceso con el PIN del TPV. Los pendientes se conservan al cambiar de empleado.' : 'Acceso independiente del PIN del TPV. Los pendientes se conservan al cerrar sesión.'}</p>
      ${!clubClient ? '<p>Club Esencia no está configurado en esta instalación.</p>' : clubPinEnabled ? `<p>${actor ? 'Fidelidad preparada para el empleado actual.' : 'Para activar Club, sal del TPV y vuelve a entrar con tu PIN habitual. No necesitas otra contraseña.'}</p>${clubServerEnabled ? '<p>Este dispositivo se configura automáticamente al iniciar sesión con tu PIN.</p>' : ''}` : actor ? `<p>Sesión del equipo activa.</p><button data-logout>Cerrar sesión de Club</button>` : `
      <form data-login><label>Correo del equipo<input name="email" type="email" autocomplete="username" required></label>
      <label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button>Acceder a Club</button></form>`}
      <p role="status">${escape(message)}</p><h4>Asignaciones de puntos</h4>${clubPinEnabled ? '<button data-courtesy>Puntos de cortesía</button>' : ''}
      <button data-refresh>Actualizar y reintentar pendientes</button>
      <div class="club-operations">${operations.length ? operations.map(op => `<article><strong>${escape(op.member.name)} · ${escape(op.total)} €</strong><small>${escape(op.transactionId)}</small><p>${escape({pending:'Pendiente',confirmed:'Confirmado',review:'Revisión necesaria',prepared:'Vaciado pendiente de comprobar'}[op.status])}${op.actorId !== actor && op.status === 'pending' ? ' · Accede con la cuenta de Club que registró la venta' : ''}</p>${op.error ? `<small>${escape(op.error)}</small>` : ''}</article>`).join('') : '<p>No hay asignaciones pendientes en este dispositivo.</p>'}</div>
      <p>Las devoluciones de ventas requieren revisar sus puntos; no se descuentan automáticamente. El reintento nunca vuelve a cobrar.</p>
      <a href="https://esencia-club.pages.dev" target="_blank" rel="noopener noreferrer">Abrir la app Club Esencia</a>`;
    const run = fn => async event => {
      event.preventDefault(); if (busy) return; busy = true;
      const button = event.submitter || event.currentTarget;
      button.disabled = true;
      try { await fn(event); await draw('Operación completada.'); }
      catch(e) { await draw(e.message); }
      finally { busy = false; }
    };
    body.querySelector('[data-courtesy]')?.addEventListener('click', showClubCourtesy);
    body.querySelector('[data-login]')?.addEventListener('submit', run(async event => {
      const form = new FormData(event.currentTarget);
      await clubLogin(String(form.get('email')).trim(), String(form.get('password')));
    }));
    body.querySelector('[data-logout]')?.addEventListener('click', run(clubLogout));
    body.querySelector('[data-refresh]').addEventListener('click', run(async () => { await clubQueue?.flush(); }));
  }
  void draw();
}

function scanClubQr(onValue,onManual=()=>{}) {
  const modal = dialog('Escanear QR de Club Esencia');
  const body = modal.querySelector('[data-body]');
  body.innerHTML = '<p>Apunta al QR del socio.</p><video muted playsinline></video><p role="status">Activando cámara…</p><button type="button" data-manual>Continuar sin cámara</button>'+(localDemo?'<section class="club-demo-help"><strong>Prueba local · Solo datos ficticios</strong><p>Los socios de la web no están en esta prueba. Puedes continuar con Ana sin cámara ni QR.</p><button type="button" data-demo-member>Usar Ana de prueba</button></section>':'');
  let stream, controls, closed = false;
  const close = () => {
    closed = true;
    controls?.stop(); stream?.getTracks().forEach(track => track.stop());
    document.removeEventListener('visibilitychange', hidden);
    if (modal.open) modal.close();
  };
  const hidden = () => { if (document.hidden) close(); };
  body.querySelector('[data-manual]').onclick=()=>{close();onManual();};
  body.querySelector('[data-demo-member]')?.addEventListener('click',()=>{close();onValue(demoQr);});
  modal.addEventListener('close', close, {once:true});
  document.addEventListener('visibilitychange', hidden);
  void (async () => {
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      if (closed) return;
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if (closed) { stream.getTracks().forEach(track => track.stop()); return; }
      controls = await new BrowserQRCodeReader().decodeFromStream(stream, body.querySelector('video'), result => {
        if (!closed && result) { const value = result.getText(); close(); onValue(value); }
      });
      if (closed) controls.stop();
      else body.querySelector('[role=status]').textContent = 'Buscando QR…';
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (!closed) body.querySelector('[role=status]').textContent = 'No se pudo abrir la cámara. Puedes pegar el código del QR o usar un lector USB.';
    }
  })();
  return close;
}

async function showMemberRedemptions(member, onChange) {
  const modal = dialog(`Canjes · ${member.name}`);
  const body = modal.querySelector('[data-body]');
  body.textContent = 'Cargando canjes…';
  const actor = await clubActor();
  async function draw() {
    try {
      if (await clubActor() !== actor) throw new Error('La sesión ha cambiado. Vuelve a identificar al socio.');
      const rows = await clubIntegration.pendingRedemptions(member.id);
      if (!modal.isConnected) return;
      if(clubServerEnabled){body.innerHTML='<p>Aplica los canjes desde «Promociones disponibles» en la cuenta. Así el artículo queda registrado y el canje se confirma al cobrar.</p>'+rows.map(row=>`<article><strong>${escape(row.title)}</strong><p>${Number(row.cost)/100} puntos · ${row.reserved?'Aplicado a una cuenta':'Pendiente de aplicar'}</p></article>`).join('');return;}
      body.innerHTML = rows.length ? rows.map(row => `<article><strong>${escape(row.title)}</strong><p>${Number(row.cost)/100} puntos · Pendiente</p><button data-id="${escape(row.id)}" data-status="used">Confirmar entrega</button><button data-id="${escape(row.id)}" data-status="cancelled">Cancelar y devolver puntos</button></article>`).join('') : '<p>No hay recompensas pendientes.</p>';
      body.querySelectorAll('[data-id]').forEach(button => button.onclick = async () => {
        if (!window.confirm(button.dataset.status === 'used' ? '¿Confirmas que has entregado esta recompensa?' : '¿Cancelar el canje y devolver sus puntos?')) return;
        body.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          if (await clubActor() !== actor) throw new Error('La sesión ha cambiado.');
          await clubIntegration.resolveRedemption(button.dataset.id, button.dataset.status, actor);
          await onChange();
          await draw();
        } catch(e) { body.textContent = `${e.message} Cierra y vuelve a consultar antes de reintentar.`; }
      });
    } catch(e) { if (modal.isConnected) body.textContent = e.message; }
  }
  void draw();
}

export function createClubPayment({ amount, canUse, initial = null, onSelection = () => {}, promotionStore = null, onPromotion = () => {} }) {
  let member = initial, actor = (clubServerEnabled&&initial?clubPinBridge?.actor():initial?.actorId) || null, input = initial?.qr || '', status = '', root, closed = false, generation = 0, stopCamera, closePromotions;
  const openPromotions=()=>{if(member&&promotionStore){closePromotions?.();closePromotions=showCustomerPromotions({store:promotionStore,member,onApplied:onPromotion});}};
  const reset = () => { if(onSelection(null)===false){status='Retira las promociones antes de quitar al cliente.';render();return;} generation++; member = null; actor = null; input = ''; status = ''; render(); };
  window.addEventListener('club-session-changed', reset);
  function render() {
    if (closed || !root) return;
    root.innerHTML = `<details class="club-payment" ${member ? 'open' : ''}><summary>Club Esencia${member ? ` · ${escape(member.name)} · +${Math.floor(amount)} pts` : ' · Asignar cliente'}</summary>
      ${canUse() ? `
      ${member ? `<section class="club-member-card"><span class="club-member-avatar">${escape(member.name?.slice(0,1))}</span><div class="club-member-name"><strong>${escape(member.name)}</strong><small>Esta cuenta suma ${Math.floor(amount)} puntos</small></div><div class="club-member-points">${member.points}<small>puntos</small></div></section><div class="club-member-actions"><button type="button" data-clear>Quitar cliente</button>${promotionStore?'<button type="button" data-rewards>Ver promociones</button>':''}</div>` : `
      <button type="button" data-camera>Identificar cliente · Escanear QR</button>${localDemo?'<section class="club-demo-help"><strong>Prueba local · Solo datos ficticios</strong><p>Los números de socios reales no funcionan aquí.</p><button type="button" data-demo-member>Usar Ana de prueba</button></section>':''}<details data-manual-entry><summary>Usar lector o introducir código</summary><label>QR del socio<input data-qr autocomplete="off" placeholder="esencia-club:v1:…" value="${escape(input)}"></label><p class="club-input-help">Pega el contenido completo del QR. Un número de socio como E-00003 no es un QR.</p><button type="button" data-identify>Identificar socio</button></details>`}
      <p role="status">${escape(status)}</p>` : '<p>No disponible durante la emergencia. La venta puede continuar sin puntos.</p>'}</details>`;
    root.querySelector('[data-session]')?.addEventListener('click', showClubPanel);
    root.querySelector('[data-clear]')?.addEventListener('click', reset);
    root.querySelector('[data-rewards]')?.addEventListener('click', openPromotions);
    root.querySelector('[data-qr]')?.addEventListener('input', e => { generation++; member = null; input = e.target.value; });
    root.querySelector('[data-qr]')?.addEventListener('keydown', e => { if(e.key === 'Enter') { e.preventDefault(); void identify(); } });
    root.querySelector('[data-identify]')?.addEventListener('click', identify);
    root.querySelector('[data-demo-member]')?.addEventListener('click',()=>{input=demoQr;void identify();});
    root.querySelector('[data-camera]')?.addEventListener('click', () => { reset(); root.querySelector('.club-payment').open=true; stopCamera = scanClubQr(value => { input = value; void identify(); },()=>{root.querySelector('.club-payment').open=true;root.querySelector('[data-manual-entry]').open=true;root.querySelector('[data-qr]').focus();}); });
    root.querySelector('.club-payment > summary')?.addEventListener('click',event=>{if(!member&&canUse()){event.preventDefault();root.querySelector('.club-payment').open=true;root.querySelector('[data-camera]')?.click();}});
    const identity=root.closest('.club-identity');if(identity){const footer=identity.querySelector('[data-footer]');footer.replaceChildren();if(member){for(const button of root.querySelectorAll('[data-clear],[data-rewards]')){button.className=button.hasAttribute('data-rewards')?'btn btn-primary':'btn btn-secondary';footer.append(button);}}else{const cancel=document.createElement('button');cancel.className='btn btn-secondary';cancel.textContent='Cancelar';cancel.onclick=()=>identity.close();footer.append(cancel);}}
  }
  async function identify() {
    const token = ++generation;
    member = null; onSelection(null); status = 'Buscando socio…'; render();
    try {
      if (!canUse()) throw new Error('Club no está disponible durante la emergencia.');
      if(/^E-\d+$/i.test(input.trim()))throw new Error('Has introducido un número de socio, no un QR. '+(localDemo?'Esta prueba no contiene socios reales. Pulsa «Usar Ana de prueba».':'La búsqueda por número aún no está disponible en la integración. Usa el QR del cliente.'));
      if (!clubIntegration || !(actor = await clubActor())) throw new Error(clubPinEnabled?'Club aún no tiene tu sesión. Sal del TPV y vuelve a entrar con tu PIN; no necesitas otra contraseña.':'Accede primero con una cuenta del equipo de Club Esencia.');
      const found = await clubIntegration.identify(input.trim());
      if (closed || token !== generation || await clubActor() !== actor) return;
      if(onSelection({...found,actorId:actor,qr:input.trim()})===false)throw new Error('Retira las promociones antes de cambiar de cliente.');member = found;status = '';
    } catch(e) { if (token === generation) { member = null; status = e.message; } }
    render();
    root?.querySelector('details')?.setAttribute('open', '');
    if(!member&&status)root?.querySelector('[data-manual-entry]')?.setAttribute('open','');
    if(member&&!closed&&token===generation)openPromotions();
  }
  return {
    clear: reset,
    scan() {if(!member)root?.querySelector('[data-camera]')?.click();},
    mount(element) { root = element;if(clubServerEnabled&&member&&actor)onSelection({...member,actorId:actor}); render(); },
    async selection() {
      if (!member || !canUse()) return null;
      const selected = member, selectedActor = actor, token = generation;
      const currentActor = await clubActor();
      if (closed || token !== generation || !currentActor || currentActor !== selectedActor) { reset(); return null; }
      return { ...selected, actorId: selectedActor };
    },
    dispose() { closed = true; generation++; stopCamera?.(); closePromotions?.(); window.removeEventListener('club-session-changed', reset); },
  };
}


export function showClubTicketIdentity(store) {
  const modal=dialog('Cliente de esta cuenta');
  const body=modal.querySelector('[data-body]');
  modal.classList.add('club-identity');body.innerHTML='<div data-selector></div>';
  const selector=createClubPayment({...clubTicketOptions(store),promotionStore:store,onPromotion:()=>modal.close(),amount:store.getActiveTicketTotal(),canUse:()=>store.canUseExternalServices()});
  selector.mount(body.querySelector('[data-selector]'));body.querySelector('details').open=true;
  selector.scan();
  modal.addEventListener('close',()=>selector.dispose(),{once:true});
}

export function showClubAssignment(tx) {
  const modal=dialog('Puntos de esta transacción');const body=modal.querySelector('[data-body]');
  body.innerHTML='<div data-current>Cargando asignación…</div><div data-selector></div><button data-assign disabled>Asignar esta cuenta al socio</button><label>Motivo de retirada<input data-reason maxlength="200" placeholder="Ej.: cliente equivocado"></label><button data-withdraw disabled>Retirar asignación y puntos</button><p data-assignment-message role="status"></p>';
  let version=0,busy=false;
  const selector=createClubPayment({amount:tx.total,canUse:()=>true});selector.mount(body.querySelector('[data-selector]'));body.querySelector('details').open=true;
  modal.addEventListener('close',()=>selector.dispose(),{once:true});
  const message=body.querySelector('[data-assignment-message]');
  async function refresh(){
    body.querySelector('[data-assign]').disabled=true;body.querySelector('[data-withdraw]').disabled=true;
    const state=await clubPinBridge.action('assignment',{sale_id:tx.id});if(!modal.isConnected)return;
    version=state.version;body.querySelector('[data-selector]').hidden=state.active;
    body.querySelector('[data-current]').innerHTML=state.active?`<p>Asignada a <b>${escape(state.name)}</b> · ${state.points} puntos</p>`:'<p>Sin asignación activa. Esta cuenta solo puede sumar puntos a un socio a la vez.</p>';
    if(state.history?.length)body.querySelector('[data-current]').innerHTML+=`<details><summary>Historial de asignaciones</summary>${state.history.map(h=>`<p>${escape({purchase:'Asignación al cobrar',assign_sale:'Asignación posterior',withdraw_sale:'Retirada'}[h.action]||h.action)} · ${escape(h.at)}${h.reason?' · '+escape(h.reason):''}</p>`).join('')}</details>`;
    body.querySelector('[data-assign]').disabled=state.active;
    body.querySelector('[data-withdraw]').disabled=!state.active;
  }
  const run=fn=>async()=>{if(busy)return;busy=true;body.querySelectorAll('button[data-assign],button[data-withdraw]').forEach(b=>b.disabled=true);
    try{await fn();selector.clear();message.textContent='Operación confirmada. El cliente ha quedado deseleccionado.';}catch(e){message.textContent=e.message;}
    finally{busy=false;await refresh().catch(e=>{message.textContent=e.message;});}
  };
  body.querySelector('[data-assign]').onclick=run(async()=>{
    const member=await selector.selection();if(!member)throw new Error('Identifica primero al socio.');
    await clubPinBridge.action('assign_sale',{sale_id:tx.id,member_id:member.id,version,request_id:await clubRequestId(`assign:${tx.id}:${version}:${member.id}`)});
  });
  body.querySelector('[data-withdraw]').onclick=run(async()=>{
    const reason=body.querySelector('[data-reason]').value.trim();if(reason.length<3)throw new Error('Indica el motivo de la retirada.');
    await clubPinBridge.action('withdraw_sale',{sale_id:tx.id,version,reason,request_id:await clubRequestId(`withdraw:${tx.id}:${version}`)});
  });
  void refresh().catch(e=>{message.textContent=e.message;});
}

export function showClubCourtesy() {
  const modal=dialog('Añadir puntos de cortesía');const body=modal.querySelector('[data-body]');
  body.innerHTML='<p>Detalle al cliente, sin registrar una venta. Quedarán guardados el motivo y el empleado.</p><div data-selector></div><label>Puntos de cortesía<input data-points type="number" min="1" max="10000" step="1"></label><label>Motivo<input data-reason maxlength="200" placeholder="Ej.: detalle de cumpleaños"></label><button data-send>Añadir puntos</button><p data-result role="status"></p>';
  const selector=createClubPayment({amount:0,canUse:()=>true});selector.mount(body.querySelector('[data-selector]'));body.querySelector('details').open=true;
  modal.addEventListener('close',()=>selector.dispose(),{once:true});
  let busy=false;
  const message=body.querySelector('[data-result]'),button=body.querySelector('[data-send]');
  button.onclick=async()=>{
    if(busy)return;busy=true;button.disabled=true;
    try{
      const actor=await clubActor();if(!actor)throw new Error('Introduce tu PIN para acceder a Club.');
      const key=`club-courtesy-pending:${actor}`;
      let intent=JSON.parse(localStorage.getItem(key)||'null');
      if(!intent){
        const member=await selector.selection(),points=Number(body.querySelector('[data-points]').value),reason=body.querySelector('[data-reason]').value.trim();
        if(!member)throw new Error('Identifica al socio.');
        if(!Number.isInteger(points)||points<1||points>10000||reason.length<3)throw new Error('Introduce de 1 a 10.000 puntos y un motivo.');
        intent={event_id:crypto.randomUUID(),request_id:crypto.randomUUID(),member_id:member.id,points,reason,version:0,name:member.name};
        localStorage.setItem(key,JSON.stringify(intent));
      }
      const {name,...payload}=intent;
      await clubPinBridge.action('gift_points',payload);
      localStorage.removeItem(key);selector.clear();body.querySelector('[data-selector]').hidden=false;body.querySelector('[data-points]').disabled=false;body.querySelector('[data-reason]').disabled=false;button.textContent='Añadir puntos';body.querySelector('[data-points]').value='';body.querySelector('[data-reason]').value='';
      message.textContent=`Confirmados ${intent.points} puntos para ${name}. Cliente deseleccionado.`;
    }catch(e){message.textContent=`${e.message} Si quedó una petición pendiente, el botón reintentará esa misma operación sin duplicarla.`;}
    finally{busy=false;button.disabled=false;}
  };
  void (async()=>{const actor=await clubActor();const pending=JSON.parse(localStorage.getItem(`club-courtesy-pending:${actor}`)||'null');if(pending){message.textContent=`Pendiente: ${pending.points} puntos para ${pending.name}, motivo: ${pending.reason}. Pulsa para confirmar esta misma operación.`;button.textContent='Reintentar puntos pendientes';body.querySelector('[data-selector]').hidden=true;body.querySelector('[data-points]').disabled=true;body.querySelector('[data-reason]').disabled=true;}})().catch(e=>{message.textContent=e.message;});
}
