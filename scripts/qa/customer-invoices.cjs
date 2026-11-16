async page => {
  // All sales, staff, invoice issuance and database traffic below are simulated.
  const origin='http://localhost:4177';
  const profile={id:'invoice-test-staff',display_name:'Prueba',role:'admin',active:true};
  const customer={name:'Cliente de prueba',taxId:'12345678Z',address:'Calle de prueba 1',postalCode:'35001',city:'Las Palmas de Gran Canaria',province:'Las Palmas'};
  const tx={id:'invoice-test-sale',type:'sale',table:'Venta Directa',total:15.7,totalCharged:17.7,tipAmount:2,itemsCount:4,createdAt:new Date().toISOString(),
    items:[{name:'Latte',id:'latte',ticketItemId:'line',price:3.925,qty:4,total:15.7}],payments:[{id:'payment',method:'Tarjeta',amount:17.7,saleAmount:15.7,tipAmount:2}],
    fiscalData:{fiscalNumber:'S-PRUEBA-1',hash:'original'},legalData:{companyName:'Emisor de prueba',nif:'12345678Z',address:'Dirección de prueba',taxName:'IGIC',taxRate:7}};
  const source={saleId:tx.id,original:{id:'fiscal',number:'S-PRUEBA-1',date:tx.createdAt,hash:'original'},operationDate:tx.createdAt,
    issuer:{name:'Emisor de prueba',taxId:'12345678Z',address:'Dirección de prueba'},currency:'EUR',total:15.7,base:14.67,tax:1.03,taxRate:7,taxName:'IGIC',roundingBase:-0.01,
    lines:[{description:'Café con Leche',options:['Leche Almendras ×1'],qty:1,unitNet:1.5888,discountNet:0,base:1.59,total:1.7,taxRate:7},
      {description:'Té Frío',options:[],qty:1,unitNet:2.3364,discountNet:0,base:2.34,total:2.5,taxRate:7},
      {description:'Tostas',options:['Serrano QCrema ×1'],qty:1,unitNet:5.6075,discountNet:0,base:5.61,total:6,taxRate:7},
      {description:'Tostas',options:['Aguacate ×1'],qty:1,unitNet:5.1402,discountNet:0,base:5.14,total:5.5,taxRate:7}]};
  let invoice=null,failOnce=true,issueRequests=0;
  const writes=[];
  await page.context().routeWebSocket('**',socket=>socket.close());
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/sw.js')return route.abort();
    if(url.origin===origin)return route.continue();
    if(req.method()!=='GET')writes.push(url.pathname);
    let data=[];
    if(url.pathname.endsWith('/club-tpv')) {
      const input=req.postDataJSON();
      if(input.p_action==='status')data={staffId:profile.id,actorId:'test-actor'};
      else if(input.p_action==='invoice_get')data=invoice?{invoice}:{invoice:null,source,sourceHash:'snapshot'};
      else if(input.p_action==='invoice_issue') {
        issueRequests++;
        if(input.p_payload.sourceHash!=='snapshot')throw Error('Missing reviewed source');
        await new Promise(resolve=>setTimeout(resolve,150));
        if(!invoice)invoice={...source,id:'test-only',schema:'customer-invoice/v1',documentType:'replacement_invoice',fiscalNumber:'F-PRUEBA-000001',issuedAt:tx.createdAt,customer:input.p_payload.customer,hash:'test',addsRevenue:false};
        if(failOnce){failOnce=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Respuesta perdida de prueba'})});}
        data=invoice;
      }else data={};
    }else if(url.pathname.endsWith('/staff_profiles'))data=[profile];
    else if(url.pathname.endsWith('/tpv_state'))data={id:'global',tables:[],direct_sale:{items:[]},updated_at:new Date().toISOString()};
    else if(url.pathname.endsWith('/sales'))data=[{id:tx.id,type:'sale',table_name:'Venta Directa',total_amount:15.7,items_count:4,created_at:tx.createdAt,closed_at:tx.createdAt,payload:tx,legal_data:tx.legalData,payment_method:'Tarjeta'}];
    else if(url.pathname.endsWith('/sale_lines'))data=tx.items.map(item=>({id:'line',sale_id:tx.id,raw_payload:item,name:item.name,quantity:4,total_amount:15.7}));
    else if(url.pathname.endsWith('/sale_payments'))data=tx.payments.map(p=>({id:p.id,sale_id:tx.id,method:p.method,amount:p.amount,raw_payload:p}));
    else if(url.pathname.endsWith('/fiscal_documents'))data=[{id:'fiscal',sale_id:tx.id,fiscal_number:'S-PRUEBA-1',hash:'original',document_type:'simplified_invoice'}];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(profile=>{
    localStorage.setItem('tpv-staff-session-v1',JSON.stringify(profile));
    localStorage.setItem('esencia-club-terminal-v1','test-terminal');
    localStorage.setItem('esencia-club-pin-session-v1',JSON.stringify({staffId:profile.id,actorId:'test-actor',token:'test-session',expiresAt:Date.now()+3600000}));
  },profile);
  await page.setViewportSize({width:390,height:844});
  await page.goto(origin);
  await page.locator('#app-loading-overlay').waitFor({state:'detached'});
  await page.locator('[data-tab="transacciones"]').click();
  await page.locator(`[data-transaction-id="${tx.id}"]`).click();
  await page.locator('#tx-customer-invoice-btn').click();
  const modal=page.locator('#customer-invoice-modal');
  await modal.locator('input[name="name"]').waitFor();
  for(const [key,value] of Object.entries(customer))await modal.locator(`input[name="${key}"]`).fill(value);
  const before=await modal.locator('.modal-body').evaluate(el=>el.scrollTop);
  await page.evaluate(async()=>{
    const {store}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/store.js').name);
    store.emitChange({source:'background-fiscal'});store.emitChange({source:'background-fiscal'});
  });
  if(await modal.locator('input[name="province"]').inputValue()!==customer.province||!await modal.locator('input[name="province"]').evaluate(el=>el===document.activeElement)||await modal.locator('.modal-body').evaluate(el=>el.scrollTop)!==before)throw Error('Lost invoice form state');
  await page.screenshot({path:'output/playwright/customer-invoice-mobile.png',animations:'disabled'});
  await modal.locator('[data-primary]').click();
  if(issueRequests)throw Error('Issued without confirmation');
  await page.evaluate(()=>{
    const originalFetch=window.fetch;
    window.invoiceAssetFailure=true;
    window.fetch=(input,options)=>window.invoiceAssetFailure&&String(input).endsWith('/brand/esencia-logo-transparent.png')
      ?Promise.resolve(new Response('Simulated unavailable image',{status:503}))
      :originalFetch(input,options);
  });
  await modal.locator('[data-primary]').evaluate(el=>{el.click();el.click();});
  await modal.getByText('No se pudo cargar el logo o la tipografía de la factura. Reintenta.',{exact:true}).waitFor();
  if(issueRequests!==0)throw Error('Issued without PDF assets');
  await page.evaluate(()=>{window.invoiceAssetFailure=false;});
  await modal.locator('[data-primary]').evaluate(el=>{el.click();el.click();});
  await modal.getByText('Respuesta perdida de prueba',{exact:true}).waitFor();
  if(issueRequests!==1)throw Error('Double click sent two requests');
  await modal.locator('[data-primary]').click();
  await modal.getByText('Factura emitida',{exact:true}).waitFor();
  if(invoice.total!==15.7||invoice.customer.taxId!==customer.taxId)throw Error('Wrong invoice/tip/customer');
  await page.screenshot({path:'output/playwright/customer-invoice-issued-mobile.png',animations:'disabled'});
  await page.waitForFunction(()=>!!window.jspdf?.jsPDF && !!window.jspdf.jsPDF.API.autoTable);
  const downloaded=page.waitForEvent('download');
  await modal.locator('[data-primary]').click();
  await (await downloaded).saveAs('output/playwright/customer-invoice-test.pdf');
  await modal.locator('[data-back]').click();
  await page.locator('#tx-customer-invoice-btn').click();
  await modal.getByText('Factura emitida',{exact:true}).waitFor();
  if(issueRequests!==2)throw Error('Reopening issued another invoice');
  await page.setViewportSize({width:1280,height:800});
  await page.screenshot({path:'output/playwright/customer-invoice-desktop.png',animations:'disabled'});
  const overflow=await modal.evaluate(el=>el.scrollWidth>el.clientWidth);
  if(overflow)throw Error('Horizontal overflow');
  const saleWrites=writes.filter(p=>!p.endsWith('/club-tpv'));
  if(saleWrites.length)throw Error('Unexpected database write '+saleWrites.join(','));
  await page.evaluate(async invoice=>{
    const {createCustomerInvoicePdf}=await import('/src/customerInvoicePdf.js');
    const long={...invoice,lines:Array.from({length:120},(_,i)=>({...invoice.lines[i%4],description:`${i+1}. Artículo de prueba de paginación con descripción larga`} ))};
    long.total=Math.round(long.lines.reduce((sum,line)=>sum+line.total,0)*100)/100;
    long.base=Math.round(long.total/1.07*100)/100;
    long.tax=Math.round((long.total-long.base)*100)/100;
    long.roundingBase=Math.round((long.base-long.lines.reduce((sum,line)=>sum+line.base,0))*100)/100;
    const doc=await createCustomerInvoicePdf(long);
    if(doc.getNumberOfPages()<3)throw Error('No pagination');
    window.invoiceLongPdf=doc;
  },invoice);
  const longDownload=page.waitForEvent('download');
  await page.evaluate(()=>window.invoiceLongPdf.save('paginacion-prueba.pdf'));
  await (await longDownload).saveAs('output/playwright/customer-invoice-pagination-test.pdf');
  return {stableFocusAndScroll:true,assetsRequiredBeforeIssuing:true,doubleClickGuard:true,retriedOnce:true,noSaleWrites:true,privateCustomer:true,pdfDownloaded:true,paginatedPdf:true};
}
