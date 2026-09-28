async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4322');
 if(await page.locator('[data-demo-toolbar],[data-demo-pin]').count())throw Error('Demo overlays still present');
 await page.locator('#staff-pin-input').fill('5678');await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.locator('.article-card').click();await page.getByRole('button',{name:'Añadir 1 · 4.60€',exact:true}).click();await page.getByRole('button',{name:'Cobrar',exact:true}).click();
 await page.getByRole('button',{name:'Confirmar 4.60€',exact:true}).click();await page.locator('#payment-modal').waitFor({state:'detached'});
 await page.waitForFunction(()=>window.clubDemo.store.getActiveItems().length===0);
 const normal=await page.evaluate(()=>window.clubDemo.store.state.transactions[0]);if(normal.total!==4.6||normal.loyaltyCustomer)throw Error('Normal sale altered');
 await page.locator('.article-card').click();await page.getByRole('button',{name:'Añadir 1 · 4.60€',exact:true}).click();await page.getByRole('button',{name:'Cobrar',exact:true}).click();
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Test denied','NotAllowedError');};});await page.locator('.club-payment > summary').click();
 const camera=page.getByRole('dialog').filter({hasText:'Escanear QR de Club Esencia'});await camera.getByText('No se pudo abrir la cámara. Puedes pegar el código del QR o usar un lector USB.').waitFor();await camera.getByRole('button',{name:'Cerrar',exact:true}).click();
 await page.getByText('Usar lector o introducir código',{exact:true}).click();await page.getByLabel('QR del socio').fill('esencia-club:v1:00000000-0000-4000-8000-000000000004');await page.getByRole('button',{name:'Identificar socio',exact:true}).click();
 await page.getByRole('dialog',{name:'Promociones de Ana de prueba',exact:true}).getByRole('button',{name:'Descuento 2 € · 1 puntos',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'Descuento 2 €',exact:true});await confirm.getByRole('button',{name:'Aplicar descuento',exact:true}).click();
 await page.getByRole('button',{name:'Confirmar 2.60€',exact:true}).click();await page.locator('#payment-modal').waitFor({state:'detached'});await page.waitForFunction(()=>window.clubDemo.store.getActiveItems().length===0);
 const discounted=await page.evaluate(()=>window.clubDemo.store.state.transactions[0]);if(discounted.total!==2.6||discounted.itemsCount!==1||discounted.discountTotal!==2)throw Error('Loyalty sale incorrect');
 if(errors.length)throw Error(errors.join('\n'));await page.screenshot({path:'output/playwright/tpv-integrated-interface.png'});
 return {normalPin:true,normalProductPicker:true,noDemoOverlays:true,normalSale:normal.total,clubSale:discounted.total,errors};
}

