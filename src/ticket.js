import { loadReceiptTicket } from './db.js';

const root = document.getElementById('ticket-root');

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)}€`;
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
          <dd>${tx.paymentMethod || ''}</dd>
        </div>
      </dl>

      <div class="receipt-items">
        ${items.length > 0 ? items.map(item => `
          <article class="receipt-item">
            <div class="receipt-item-row">
              <div>
                <strong>${item.name}</strong>
                <span>${formatMoney(item.price)} x ud. · x${item.qty}</span>
              </div>
              <strong>${formatMoney(item.total)}</strong>
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
  const detailRows = [];

  items.forEach(item => {
    detailRows.push({
      type: 'item',
      left: `${item.name} x${item.qty}`,
      right: formatMoney(item.total)
    });
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
  const height = Math.max(920, 560 + detailRows.length * rowHeight);
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
      const isOption = row.type === 'option';
      drawText(row.left, padding + (isOption ? 22 : 0), y, isOption ? 19 : 23, isOption ? '400' : '700', 'left', isOption ? '#666666' : '#111111');
      drawText(row.right, width - padding, y, isOption ? 19 : 23, isOption ? '400' : '700', 'right', isOption ? '#666666' : '#111111');
      y += isOption ? 32 : rowHeight;
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
