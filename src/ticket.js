import { loadReceiptTicket } from './db.js';

const root = document.getElementById('ticket-root');

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)}€`;
}

function getPaymentBreakdown(tx = {}) {
  if (Array.isArray(tx.payments) && tx.payments.length > 0) {
    return tx.payments
      .map(payment => ({
        method: payment.method || tx.paymentMethod || 'Pago',
        amount: Number(payment.amount || 0),
        provider: payment.provider || ''
      }))
      .filter(payment => payment.amount > 0 || payment.method);
  }

  return [{
    method: tx.paymentMethod || 'Pago',
    amount: Number(tx.total || 0),
    provider: String(tx.paymentMethod || '').toLowerCase().includes('tarjeta') ? 'BBVA' : ''
  }];
}

function summarizePayments(tx = {}) {
  const payments = getPaymentBreakdown(tx);
  const count = payments.length;
  const grouped = payments.reduce((acc, payment) => {
    const method = payment.method || 'Pago';
    if (!acc[method]) acc[method] = { count: 0, amount: 0 };
    acc[method].count += 1;
    acc[method].amount += Number(payment.amount || 0);
    return acc;
  }, {});
  const parts = Object.entries(grouped).map(([method, info]) =>
    `${info.count} ${method}${info.amount > 0 ? ` (${formatMoney(info.amount)})` : ''}`
  );

  return {
    count,
    summary: count > 1 ? `${count} pagos: ${parts.join(' · ')}` : (payments[0]?.method || tx.paymentMethod || ''),
    rows: payments
  };
}

function renderTicket(tx) {
  const items = Array.isArray(tx.items) ? tx.items : [];
  const total = Number(tx.total || 0);
  const fiscal = tx.fiscalData || null;
  const displayNumber = fiscal?.fiscalNumber || tx.id;
  const legal = tx.legalData || {
    businessName: "Esencia Café",
    companyName: "Esencia Café S.L.",
    nif: "B-87654321",
    address: "Calle del Grano 12, 38001 Santa Cruz de Tenerife",
    taxName: "IGIC",
    taxRate: 7
  };
  const taxRate = Number(legal.taxRate || 0);
  const taxName = legal.taxName || "IGIC";
  const baseImponible = total / (1 + (taxRate / 100));
  const cuotaImpuesto = total - baseImponible;
  const paymentSummary = summarizePayments(tx);

  root.innerHTML = `
    <section class="receipt-card" id="receipt-card">
      <header class="receipt-header">
        <div class="receipt-brand">${legal.businessName || 'Esencia Café'}</div>
        <div class="receipt-subtitle" style="font-size: 1.1rem; font-weight: 700; color: var(--text);">Factura Simplificada</div>
        <div class="receipt-emitter" style="font-size: 0.85rem; color: var(--muted); margin-top: 6px; line-height: 1.4;">
          ${legal.companyName || 'Esencia Café S.L.'}<br>
          NIF: ${legal.nif || 'B-87654321'}<br>
          ${legal.address || 'Calle del Grano 12, 38001 Santa Cruz de Tenerife'}
        </div>
      </header>

      <dl class="receipt-meta">
        <div>
          <dt>Factura Nº</dt>
          <dd>${displayNumber}</dd>
        </div>
        ${fiscal?.hash ? `
          <div>
            <dt>Ref. fiscal</dt>
            <dd>${fiscal.hash.slice(0, 12)}</dd>
          </div>
        ` : ''}
        <div>
          <dt>Fecha</dt>
          <dd>${tx.date || ''}</dd>
        </div>
        <div>
          <dt>Mesa / Pedido</dt>
          <dd>${tx.table || 'Venta Directa'}</dd>
        </div>
        <div>
          <dt>Método de Pago</dt>
          <dd>${paymentSummary.summary}</dd>
        </div>
      </dl>

      <div class="receipt-items">
        ${items.length > 0 ? items.map(item => `
          <article class="receipt-item">
            <div class="receipt-item-row">
              <div>
                <strong>${item.name}</strong>
                <span>${formatMoney(item.price)} x ud. · x${item.qty}</span>
                ${Number(item.discountAmount || 0) > 0 ? `
                  <span style="color:#059669; font-weight:700;">${item.discountReason || 'Descuento'} · -${Number(item.discountPercent || 0)}%</span>
                ` : ''}
              </div>
              <strong>${Number(item.discountAmount || 0) > 0 ? `<span style="text-decoration:line-through; color:var(--muted); margin-right:6px;">${formatMoney(item.grossTotal)}</span>` : ''}${formatMoney(item.total)}</strong>
            </div>
            ${(item.selectedOptions || []).length > 0 ? `
              <div class="receipt-options">
                ${(item.selectedOptions || []).map(opt => `
                  <div>
                    <span>+ ${opt.name} (x${opt.qty})</span>
                    <span>${formatMoney(Number(opt.price || 0) * Number(opt.qty || 1))}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </article>
        `).join('') : '<p class="receipt-muted">Detalle de artículos no disponible.</p>'}
      </div>

      <div class="receipt-tax-breakdown" style="margin-top: 18px; padding-bottom: 14px; border-bottom: 1px dashed var(--border); display: grid; gap: 8px; font-size: 0.9rem; color: var(--muted); font-weight: 600;">
        ${paymentSummary.count > 1 ? `
          <div style="display:grid; gap:6px; padding-bottom: 10px; margin-bottom: 4px; border-bottom: 1px dashed var(--border);">
            ${paymentSummary.rows.map((payment, index) => `
              <div style="display:flex; justify-content:space-between;">
                <span>Pago ${index + 1} · ${payment.method}${payment.provider ? ` · ${payment.provider}` : ''}</span>
                <span>${formatMoney(payment.amount)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${Number(tx.discountTotal || 0) > 0 ? `
          <div style="display:flex; justify-content:space-between;">
            <span>Subtotal antes de descuentos</span>
            <span>${formatMoney(tx.grossTotal)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; color:#059669;">
            <span>Descuentos / invitaciones</span>
            <span>-${formatMoney(tx.discountTotal)}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between;">
          <span>Base Imponible (${taxRate}%)</span>
          <span>${formatMoney(baseImponible)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>${taxName} (${taxRate}% Incluido)</span>
          <span>${formatMoney(cuotaImpuesto)}</span>
        </div>
      </div>

      <footer class="receipt-total">
        <span>Total a Pagar</span>
        <strong>${formatMoney(total)}</strong>
      </footer>
    </section>

    <section class="receipt-actions">
      <button id="download-receipt-btn">Descargar imagen</button>
      <p>Gracias por tu visita.</p>
    </section>
  `;

  document.getElementById('download-receipt-btn').addEventListener('click', () => downloadReceiptImage(tx));
}

function buildReceiptImageCanvas(tx) {
  const items = Array.isArray(tx.items) ? tx.items : [];
  const fiscal = tx.fiscalData || null;
  const displayNumber = fiscal?.fiscalNumber || tx.id;
  const paymentSummary = summarizePayments(tx);
  const detailRows = [];

  items.forEach(item => {
    detailRows.push({
      type: 'item',
      left: `${item.name} x${item.qty}`,
      right: formatMoney(Number(item.discountAmount || 0) > 0 ? item.grossTotal : item.total)
    });
    if (Number(item.discountAmount || 0) > 0) {
      detailRows.push({
        type: 'discount',
        left: `${item.discountReason || 'Descuento'} -${Number(item.discountPercent || 0)}%`,
        right: `-${formatMoney(item.discountAmount)}`
      });
    }
    (item.selectedOptions || []).forEach(opt => {
      detailRows.push({
        type: 'option',
        left: `+ ${opt.name} x${opt.qty}`,
        right: formatMoney(Number(opt.price || 0) * Number(opt.qty || 1))
      });
    });
  });

  const width = 720;
  const padding = 48;
  const rowHeight = 42;
  const paymentExtraHeight = paymentSummary.count > 1 ? 42 + (paymentSummary.rows.length * 32) : 0;
  const height = Math.max(920, 560 + detailRows.length * rowHeight + paymentExtraHeight);
  const scale = Math.max(2, Math.floor(window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'top';

  const drawText = (text, x, y, size = 24, weight = '400', align = 'left', color = '#111111') => {
    ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  };

  const drawRule = (y) => {
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  };

  const legal = tx.legalData || {
    businessName: "Esencia Café",
    companyName: "Esencia Café S.L.",
    nif: "B-87654321",
    address: "Calle del Grano 12, 38001 Santa Cruz de Tenerife",
    taxName: "IGIC",
    taxRate: 7
  };
  const taxRate = Number(legal.taxRate || 0);
  const taxName = legal.taxName || "IGIC";

  drawText(legal.businessName || 'Esencia Café', width / 2, 42, 42, '800', 'center');
  drawText('Factura Simplificada', width / 2, 94, 22, '700', 'center', '#555555');
  drawText(`${legal.companyName || 'Esencia Café S.L.'} · NIF: ${legal.nif || 'B-87654321'}`, width / 2, 126, 18, '500', 'center', '#666666');
  drawText(legal.address || 'Calle del Grano 12, 38001 Santa Cruz de Tenerife', width / 2, 152, 18, '500', 'center', '#666666');
  drawRule(190);

  let y = 220;
  [
    ['Factura Nº', displayNumber],
    ...(fiscal?.hash ? [['Ref. fiscal', fiscal.hash.slice(0, 12)]] : []),
    ['Fecha', tx.date || ''],
    ['Mesa / Pedido', tx.table || 'Venta Directa'],
    ['Método de Pago', tx.paymentMethod || '']
  ].forEach(([label, value]) => {
    drawText(label, padding, y, 22, '700', 'left', '#555555');
    drawText(value, width - padding, y, 22, '700', 'right');
    y += 38;
  });

  y += 20;
  drawRule(y);
  y += 28;
  drawText('Artículos', padding, y, 24, '800');
  y += 42;

  if (detailRows.length > 0) {
    detailRows.forEach(row => {
      const isSecondary = row.type === 'option' || row.type === 'discount';
      const color = row.type === 'discount' ? '#059669' : (isSecondary ? '#666666' : '#111111');
      drawText(row.left, padding + (isSecondary ? 22 : 0), y, isSecondary ? 19 : 23, isSecondary ? '400' : '700', 'left', color);
      drawText(row.right, width - padding, y, isSecondary ? 19 : 23, isSecondary ? '400' : '700', 'right', color);
      y += isSecondary ? 32 : rowHeight;
    });
  } else {
    drawText('Detalle de artículos no disponible', padding, y, 22, '400', 'left', '#666666');
    y += rowHeight;
  }

  const total = Number(tx.total || 0);
  const baseImponible = total / (1 + (taxRate / 100));
  const cuotaImpuesto = total - baseImponible;

  y += 18;
  drawRule(y);
  y += 28;

  if (paymentSummary.count > 1) {
    drawText('Desglose de cobro', padding, y, 20, '700', 'left', '#555555');
    y += 34;
    paymentSummary.rows.forEach((payment, index) => {
      drawText(`Pago ${index + 1} · ${payment.method}${payment.provider ? ` · ${payment.provider}` : ''}`, padding, y, 20, '600', 'left', '#666666');
      drawText(formatMoney(payment.amount), width - padding, y, 20, '600', 'right', '#666666');
      y += 32;
    });
    drawRule(y);
    y += 28;
  }

  if (Number(tx.discountTotal || 0) > 0) {
    drawText('Subtotal antes de descuentos', padding, y, 20, '600', 'left', '#666666');
    drawText(formatMoney(tx.grossTotal), width - padding, y, 20, '600', 'right', '#666666');
    y += 32;
    drawText('Descuentos / invitaciones', padding, y, 20, '700', 'left', '#059669');
    drawText(`-${formatMoney(tx.discountTotal)}`, width - padding, y, 20, '700', 'right', '#059669');
    y += 32;
  }

  drawText(`Base Imponible (${taxRate}%)`, padding, y, 20, '600', 'left', '#666666');
  drawText(formatMoney(baseImponible), width - padding, y, 20, '600', 'right', '#666666');
  y += 32;

  drawText(`${taxName} (${taxRate}% Incluido)`, padding, y, 20, '600', 'left', '#666666');
  drawText(formatMoney(cuotaImpuesto), width - padding, y, 20, '600', 'right', '#666666');
  y += 32;

  drawRule(y);
  y += 32;
  drawText('Total a Pagar', padding, y, 34, '800');
  drawText(formatMoney(tx.total), width - padding, y, 34, '800', 'right');
  y += 72;
  drawText('Gracias por tu visita.', width / 2, y, 24, '600', 'center', '#333333');

  return canvas;
}

function downloadReceiptImage(tx) {
  const canvas = buildReceiptImageCanvas(tx);
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ticket-${tx.id}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png', 0.95);
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');

  if (!token) {
    root.innerHTML = '<div class="ticket-error">Ticket no encontrado.</div>';
    return;
  }

  try {
    const ticket = await loadReceiptTicket(token);
    if (!ticket) {
      root.innerHTML = '<div class="ticket-error">Ticket no disponible.</div>';
      return;
    }
    renderTicket(ticket);
  } catch (err) {
    root.innerHTML = '<div class="ticket-error">No se pudo cargar el ticket.</div>';
  }
}

init();
