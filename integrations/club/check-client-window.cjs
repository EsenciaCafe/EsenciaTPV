async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4322');await page.locator('#staff-pin-input').fill('5678');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('.article-card').click();await page.getByRole('button',{name:'Añadir 1 · 4.60€',exact:true}).click();
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('No camera','NotFoundError');};});
 await page.getByRole('button',{name:'Cliente Club',exact:true}).click();
 const camera=page.getByRole('dialog',{name:'Escanear QR de Club Esencia',exact:true});await camera.waitFor();await camera.getByRole('button',{name:'Continuar sin cámara',exact:true}).click();
 const client=page.getByRole('dialog',{name:'Cliente de esta cuenta',exact:true});
 await page.getByLabel('QR del socio').fill('E-00003');await page.getByRole('button',{name:'Identificar socio',exact:true}).click();await page.getByText('Has introducido un número de socio, no un QR. Esta prueba no contiene socios reales. Pulsa «Usar Ana de prueba».',{exact:true}).waitFor();
 const box=await client.boundingBox(),view=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));if(Math.abs(box.width-view.width)>2||Math.abs(box.height-view.height)>2)throw Error('Club window does not match full-screen TPV modals');
 await page.screenshot({path:'output/playwright/club-client-window-desktop.png'});
 await client.getByRole('button',{name:'Usar Ana de prueba',exact:true}).click();
 const offers=page.getByRole('dialog',{name:'Promociones de Ana de prueba',exact:true});await offers.waitFor();await offers.getByRole('button',{name:'Cerrar sin canjear',exact:true}).click();
 await page.getByRole('button',{name:'Quitar cliente',exact:true}).click();await page.locator('.club-payment > summary').click();await camera.getByRole('button',{name:'Usar Ana de prueba',exact:true}).click();await offers.waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/club-client-window-mobile.png'});
 if(!await offers.evaluate(d=>d.scrollWidth<=d.clientWidth))throw Error('Mobile overflow');
 await offers.getByRole('button',{name:'Café gratis · 1 puntos',exact:true}).click();const confirm=page.getByRole('dialog',{name:'Café gratis',exact:true});if(!await confirm.getByRole('button',{name:'Confirmar regalo',exact:true}).isDisabled())throw Error('Confirmation not required');await confirm.getByRole('button',{name:'No hay ninguno válido · Cancelar',exact:true}).click();
 await page.setViewportSize({width:1280,height:900});if(errors.length)throw Error(errors.join('\n'));
 return {sameFullScreenLayout:true,numberExplained:true,demoWithoutCamera:true,demoFromCamera:true,mobileFits:true,explicitConfirmation:true};
}
