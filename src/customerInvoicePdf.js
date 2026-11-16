const date = value => new Date(value).toLocaleDateString('es-ES',{timeZone:'Atlantic/Canary'});
const number = (value,digits=2) => Number(value).toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const money = value => `${number(value)} €`;
const taxRate = value => Number(value).toLocaleString('es-ES',{maximumFractionDigits:2});
const INK=[29,33,31], MUTED=[99,107,102], GOLD=[165,136,66], LINE=[223,227,223];
let pendingAssets;

function binaryBase64(bytes) {
  let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}

function script(path) {
  return new Promise((resolve,reject)=>{
    const tag=document.createElement('script');
    tag.src=new URL(path,document.baseURI).href;
    const timeout=setTimeout(()=>{tag.remove();reject(Error('No se pudo cargar el generador PDF. Reintenta con conexión.'));},15000);
    tag.onload=()=>{clearTimeout(timeout);resolve();};
    tag.onerror=()=>{clearTimeout(timeout);tag.remove();reject(Error('No se pudo cargar el generador PDF.'));};
    document.head.append(tag);
  });
}

export async function prepareCustomerInvoicePdf() {
  if(!pendingAssets)pendingAssets=(async()=>{
    if(!globalThis.jspdf?.jsPDF)await script('vendor/jspdf.umd.min.js');
    if(!globalThis.jspdf.jsPDF.API.autoTable)await script('vendor/jspdf.plugin.autotable.min.js');
    const read=async path=>{
      const response=await fetch(new URL(path,document.baseURI),{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('No se pudo cargar el logo o la tipografía de la factura. Reintenta.');
      return new Uint8Array(await response.arrayBuffer());
    };
    const logo=await read('brand/esencia-logo-transparent.png');
    const sans=binaryBase64(await read('fonts/EsenciaSans-Regular.ttf'));
    const bold=binaryBase64(await read('fonts/EsenciaSans-Bold.ttf'));
    const display=binaryBase64(await read('fonts/EsenciaDisplay-Regular.ttf'));
    return {logo,sans,bold,display};
  })().catch(error=>{pendingAssets=null;throw error;});
  return pendingAssets;
}

export async function createCustomerInvoicePdf(invoice) {
  const assets=await prepareCustomerInvoicePdf();
  const doc=new globalThis.jspdf.jsPDF({unit:'mm',format:'a4'});
  for(const [file,data,family,style] of [['sans',assets.sans,'EsenciaSans','normal'],['bold',assets.bold,'EsenciaSans','bold'],['display',assets.display,'EsenciaDisplay','normal']]) {
    doc.addFileToVFS(`${file}.ttf`,data);doc.addFont(`${file}.ttf`,family,style);
  }
  doc.setProperties({title:`Factura ${invoice.fiscalNumber} - Esencia`,author:invoice.issuer.name});
  const text=(value,x,y,{size=9,bold=false,color=INK,align='left',width,font='EsenciaSans'}={})=>{
    doc.setFont(font,bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);
    const lines=width?doc.splitTextToSize(String(value),width):[String(value)];
    doc.text(lines,x,y,{align,lineHeightFactor:1.4});
    return y+lines.length*size*0.3528*1.4;
  };
  const rule=(y,x=20,end=190,color=LINE)=>{doc.setDrawColor(...color);doc.setLineWidth(.2);doc.line(x,y,end,y);};
  const logo=(x,y,w,h)=>{
    // The transparent version removes the background; clip only its empty margins.
    doc.saveGraphicsState();doc.rect(x,y,w,h,null);doc.clip();doc.discardPath();
    doc.addImage(assets.logo,'PNG',x,y-w*.28,w,w,'esencia-logo');doc.restoreGraphicsState();
  };
  const compactHeader=()=>{
    logo(20,10,40,14);text(invoice.fiscalNumber,190,20,{align:'right',size:10,bold:true});rule(29);
  };
  doc.setFillColor(...GOLD);doc.rect(0,0,210,1.2,'F');
  logo(20,18,73,27);
  text('FACTURA',190,24,{size:10,bold:true,align:'right'});
  text(invoice.fiscalNumber,190,33,{size:17,align:'right'});
  text(`Emisión: ${date(invoice.issuedAt)}`,190,41,{color:MUTED,align:'right'});
  rule(49,20,190,GOLD);
  text('EMISOR',20,59,{size:7.5,bold:true,color:GOLD});
  text('CLIENTE',111,59,{size:7.5,bold:true,color:GOLD});
  let left=text(invoice.issuer.name,20,67,{size:10,bold:true,width:80});
  left=text(`NIF ${invoice.issuer.taxId}`,20,left+1,{width:80,color:MUTED});
  left=text(invoice.issuer.address,20,left+1,{width:80,color:MUTED});
  let right=text(invoice.customer.name,111,67,{size:10,bold:true,width:79});
  right=text(`NIF/CIF/NIE ${invoice.customer.taxId}`,111,right+1,{width:79,color:MUTED});
  right=text(invoice.customer.address,111,right+1,{width:79,color:MUTED});
  right=text(`${invoice.customer.postalCode} ${invoice.customer.city}, ${invoice.customer.province}, España`,111,right+1,{width:79,color:MUTED});
  let y=Math.max(95,left+7,right+7);
  doc.setFillColor(245,246,244);doc.rect(20,y,170,19,'F');
  text('FECHA DE OPERACIÓN',24,y+6,{size:7,bold:true,color:MUTED});
  text(date(invoice.operationDate),24,y+13,{bold:true});
  text('TICKET DE ORIGEN',83,y+6,{size:7,bold:true,color:MUTED});
  text(invoice.original.number,83,y+13,{size:8,bold:true,width:100});
  y+=29;
  const discounts=invoice.lines.some(line=>line.discountNet>0);
  const widths=discounts?[66,10,27,24,13,30]:[82,10,32,14,32];
  const headings=discounts?['CONCEPTO','UD.','PRECIO SIN IGIC','DTO. SIN IGIC','IGIC','IMPORTE']:['CONCEPTO','UD.','PRECIO SIN IGIC','IGIC','IMPORTE'];
  const body=invoice.lines.map(line=>[[line.description,...line.options].join('\n'),line.qty,number(line.unitNet,4),...(discounts?[number(line.discountNet)]:[]),`${taxRate(line.taxRate)} %`,money(line.total)]);
  doc.autoTable({startY:y,margin:{left:20,right:20,top:37,bottom:48},theme:'plain',
    styles:{font:'EsenciaSans',fontSize:9,cellPadding:{top:4,bottom:4,left:0,right:2},overflow:'linebreak',textColor:INK},
    headStyles:{fontStyle:'bold',fontSize:7,textColor:MUTED,fillColor:255},
    columnStyles:Object.fromEntries(widths.map((w,i)=>[i,{cellWidth:w,halign:i===0?'left':i===1?'center':'right'}])),
    rowPageBreak:'avoid',head:[headings],body,
    didParseCell:data=>{
      data.cell.styles.halign=data.column.index===0?'left':data.column.index===1?'center':'right';
      if(data.column.index===widths.length-1)data.cell.styles.cellPadding.right=0;
    },
    didDrawCell:data=>{if(data.column.index===widths.length-1)rule(data.cell.y+data.cell.height,20,190,data.section==='head'?INK:LINE);},
    didDrawPage:data=>{if(data.pageNumber>1)compactHeader();}
  });
  y=doc.lastAutoTable.finalY+12;
  if(y>216){doc.addPage();compactHeader();y=45;}
  text('Gracias por elegir Esencia.',20,y+5,{font:'EsenciaDisplay',size:13});
  text('Nos encantará volver a verte.',20,y+12,{size:8.5,color:MUTED});
  text('Base imponible',117,y,{color:MUTED});text(money(invoice.base),190,y,{size:10,align:'right'});
  text(`${invoice.taxName} · ${taxRate(invoice.taxRate)} %`,117,y+8,{color:MUTED});text(money(invoice.tax),190,y+8,{size:10,align:'right'});
  rule(y+14,117,190,GOLD);
  text('TOTAL FACTURA',117,y+25,{size:8,bold:true});
  doc.setFont('EsenciaDisplay','normal');doc.setFontSize(25);
  const totalSize=Math.min(25,25*45/doc.getTextWidth(money(invoice.total)));
  text(money(invoice.total),190,y+27,{font:'EsenciaDisplay',size:totalSize,align:'right'});
  const pages=doc.getNumberOfPages();
  for(let page=1;page<=pages;page++){
    doc.setPage(page);rule(263);
    text(`En sustitución de la factura simplificada ${invoice.original.number}, de ${date(invoice.original.date)}. No representa una nueva venta.`,20,269,{size:7.2,color:MUTED,width:170});
    text('Importes finales con IGIC incluido. Propinas no incluidas en la factura.',20,279,{size:7.2,color:MUTED});
    text(invoice.fiscalNumber,20,288,{size:7,color:GOLD});text(`${page} / ${pages}`,190,288,{size:8,color:MUTED,align:'right'});
  }
  return doc;
}
