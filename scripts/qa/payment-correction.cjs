async page => {
  // All database and payment requests are simulated. Never edits a real sale.
  const profile = {id:'fixture-staff',display_name:'Prueba',role:'admin',active:true};
  const tx = {id:'fixture-correction',type:'sale',table:'Venta Directa',total:20,totalCharged:20,tipAmount:0,itemsCount:4,
    createdAt:new Date().toISOString(),items:[{id:'coffee',ticketItemId:'line',name:'Latte',qty:4,price:5,total:20,selectedOptions:[]}],
    legalData:{taxName:'IGIC',taxRate:7},fiscalData:{fiscalNumber:'S-PRUEBA-1'},
    payments:[{id:'fixture-correction-payment-001',method:'Tarjeta',amount:20,saleAmount:20,tipAmount:0,provider:'BBVA'}]};
  const state = {id:'global',tables:[{id:1,name:'Mesa 1',items:[],status:'available'}],direct_sale:{items:[]},updated_at:new Date().toISOString()};
  const writes = [];
  const operations = new Map();
  let fail = false;
  await page.context().routeWebSocket('**', socket => socket.close());
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname === '/sw.js') return route.abort();
    if (url.origin === 'http://localhost:4176') return route.continue();
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({status:200,body:'{}'});
    const path = url.pathname;
    if (req.method() !== 'GET') writes.push({path,body:req.postDataJSON()});
    let data = [];
    if (path.endsWith('/staff_profiles')) data = [profile];
    else if (path.endsWith('/tpv_state')) data = state;
    else if (path.endsWith('/sales')) {
      const row = {id:tx.id,type:tx.type,total_amount:tx.total,payment_method:tx.paymentMethod || 'Tarjeta',items_count:4,
        created_at:tx.createdAt,closed_at:tx.createdAt,legal_data:tx.legalData,payload:tx};
      data = req.headers().accept?.includes('vnd.pgrst.object') ? row : [row];
    } else if (path.endsWith('/sale_lines')) data = tx.items.map(item=>({id:'line',sale_id:tx.id,ticket_item_id:item.ticketItemId,
      item_id:item.id,name:item.name,quantity:item.qty,unit_price:item.price,total_amount:item.total,selected_options:[],raw_payload:item}));
    else if (path.endsWith('/sale_payments')) data = tx.payments.map(p=>({id:p.id,sale_id:tx.id,method:p.method,amount:p.amount,provider:p.provider,raw_payload:p}));
    else if (path.endsWith('/fiscal_documents')) data = [{id:'fiscal',sale_id:tx.id,fiscal_number:'S-PRUEBA-1',total_amount:20,document_type:'simplified_invoice'}];
    else if (path.endsWith('/correct_tpv_sale_payments')) {
      const body = req.postDataJSON();
      await new Promise(resolve=>setTimeout(resolve,300));
      if (!operations.has(body.p_request_id)) {
        const payments = body.p_payments.map(p=>({...tx.payments.find(old=>old.id===p.id),...p,
          tipAmount:p.amount - tx.payments.find(old=>old.id===p.id).saleAmount}));
        const patch = {payments,paymentMethod:payments.length===1?payments[0].method:'Mixto (2 pagos)',
          tipAmount:payments.reduce((s,p)=>s+p.tipAmount,0),totalCharged:payments.reduce((s,p)=>s+p.amount,0)};
        Object.assign(tx,patch); operations.set(body.p_request_id,patch);
      }
      if (fail) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Respuesta no disponible. Reintenta.'})});
      data = operations.get(body.p_request_id);
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(profile=>localStorage.setItem('tpv-staff-session-v1',JSON.stringify(profile)),profile);
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://localhost:4176/');
  await page.locator('#app-loading-overlay').waitFor({state:'detached'});
  await page.locator('[data-tab="transacciones"]').click();
  const open = async () => {
    await page.locator(`[data-transaction-id="${tx.id}"]`).click();
    await page.locator('#tx-payment-correction-btn').click();
  };
  await open();
  await page.locator('#correction-charge-0').fill('22,50');
  if (await page.locator('#correction-tip-total').textContent() !== '2.50 €') throw Error('Wrong tip preview');
  const stable = await page.evaluate(async()=>{
    const {store} = await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname === '/src/store.js').name);
    const input=document.querySelector('#correction-charge-0'), body=document.querySelector('.payment-correction-body');
    input.focus(); body.scrollTop=80; const top=body.scrollTop;
    store.emitChange({source:'realtime'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return document.activeElement===input && input.value==='22,50' && body.scrollTop===top;
  });
  if (!stable) throw Error('Lost correction focus/scroll');
  await page.screenshot({path:'output/playwright/payment-correction-mobile.png',animations:'disabled'});
  await page.locator('#correction-charge-0').fill('19');
  if (!await page.locator('#payment-correction-save-btn').isDisabled()) throw Error('Accepted underpayment');
  await page.locator('#correction-charge-0').fill('22.50');
  const before = writes.length;
  await page.locator('#payment-correction-save-btn').evaluate(el=>{el.click();el.click();});
  await page.locator('#tx-detail-close-btn').waitFor();
  if (writes.slice(before).filter(w=>w.path.endsWith('/correct_tpv_sale_payments')).length !== 1) throw Error('Duplicate correction');
  if (writes.slice(before).some(w=>!w.path.endsWith('/correct_tpv_sale_payments'))) throw Error('Correction republished unrelated state');
  const summary = await page.evaluate(async()=>{
    const {store}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname === '/src/store.js').name);
    const tx=store.state.transactions.find(t=>t.id==='fixture-correction');
    return {summary:store.getCashClosureSummary(store.getTransactionDateKey(tx)),tx};
  });
  if (summary.summary.expectedCard!==22.5 || summary.summary.expectedCash!==-2.5 || summary.summary.totalSales!==20) throw Error('Drawer mismatch');
  if (summary.tx.items.length!==1 || summary.tx.fiscalData.fiscalNumber!=='S-PRUEBA-1') throw Error('Lost detail/fiscal number');
  await page.locator('#tx-detail-close-btn').click();
  await open();
  await page.locator('[data-payment-method="Efectivo"]').click();
  if (await page.locator('#correction-charge-0').inputValue()!=='20.00' || await page.locator('#correction-tip-total').textContent()!=='0.00 €') throw Error('Cash retained card tip');
  await page.locator('[data-payment-method="Tarjeta"]').click();
  await page.locator('#correction-charge-0').fill('23');
  fail = true;
  await page.locator('#payment-correction-save-btn').click();
  await page.getByText('Respuesta no disponible. Reintenta.',{exact:true}).waitFor();
  const count = operations.size;
  fail = false;
  await page.locator('#payment-correction-save-btn').click();
  await page.locator('#tx-detail-close-btn').waitFor();
  if (operations.size!==count) throw Error('Retry used a different operation');
  await page.locator('#tx-detail-close-btn').click();
  await open();
  await page.setViewportSize({width:1024,height:768});
  await page.screenshot({path:'output/playwright/payment-correction-desktop.png',animations:'disabled'});
  await page.locator('#payment-correction-cancel-btn').click();
  if (operations.size!==count) throw Error('Cancel changed the sale');
  tx.payments = [{...tx.payments[0],saleAmount:10,amount:10,tipAmount:0},
    {id:'fixture-correction-payment-002',method:'Efectivo',amount:10,saleAmount:10,tipAmount:0}];
  tx.totalCharged=20; tx.tipAmount=0; tx.paymentMethod='Mixto (2 pagos)';
  await page.reload();
  await page.locator('#app-loading-overlay').waitFor({state:'detached'});
  await page.locator('[data-tab="transacciones"]').click();
  await open();
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('#correction-charge-0').fill('11.50');
  await page.locator('[data-payment-index="1"][data-payment-method="Tarjeta"]').click();
  await page.locator('#correction-charge-1').fill('12');
  if (await page.locator('#correction-tip-total').textContent()!=='3.50 €') throw Error('Split tip preview failed');
  await page.locator('.payment-correction-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const box=await page.locator('#payment-correction-save-btn').boundingBox();
  if (!box || box.y+box.height>844) throw Error('Split footer unreachable');
  await page.screenshot({path:'output/playwright/payment-correction-split-dark.png',animations:'disabled'});
  await page.locator('#payment-correction-save-btn').click();
  await page.locator('#tx-detail-close-btn').waitFor();
  if (tx.tipAmount!==3.5 || tx.totalCharged!==23.5 || tx.payments.some(p=>p.saleAmount!==10)) throw Error('Split sale allocation changed');
  return {correctTip:true,unchangedFiscalAndItems:true,drawerBalanced:true,stableFocus:true,doubleClickGuard:true,
    underpaymentBlocked:true,cashRemovesTip:true,lostResponseIdempotent:true,cancelNoWrite:true,splitTips:true};
}
