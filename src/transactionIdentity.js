export function transactionIdentityRows(tx, {status = 'stored', assignment} = {}) {
  const rows = [['Cobrado por', tx.staff?.name || tx.staffName || 'No registrado']];
  if (tx.type === 'refund') rows[0][0] = 'Devolución por';
  if (status === 'ready') {
    rows.push(['Cliente Club', assignment?.active ? assignment.name || 'Nombre no disponible' : 'Sin cliente asociado']);
    if (assignment?.active) rows.push(['Puntos asignados por', assignment.assignedBy?.name || 'No registrado']);
  } else if (status === 'loading') {
    rows.push(['Cliente Club', 'Consultando asignación…']);
  } else if (status === 'error') {
    rows.push(['Cliente Club', 'No se pudo consultar la asignación actual']);
    if (tx.loyaltyCustomer?.name) rows.push(['Cliente al cobrar', tx.loyaltyCustomer.name]);
  } else {
    rows.push(['Cliente', tx.loyaltyCustomer?.name || 'Sin cliente asociado']);
  }
  return rows;
}

// Keep the receipt usable while Club loads or is unavailable. Names are text only.
export function mountTransactionIdentity(container, tx, loadAssignment) {
  let generation = 0;
  function draw(state) {
    container.replaceChildren();
    for (const [label, value] of transactionIdentityRows(tx, state)) {
      const row = document.createElement('div');
      const caption = document.createElement('span');
      const content = document.createElement('strong');
      caption.textContent = label;
      content.textContent = value;
      row.append(caption, content);
      container.append(row);
    }
  }
  function update(assignment) {
    generation++;
    if (container.isConnected) draw({status: 'ready', assignment});
  }
  async function refresh() {
    const attempt = ++generation;
    draw({status: 'loading'});
    try {
      const assignment = await loadAssignment();
      if (attempt === generation && container.isConnected) update(assignment);
    } catch {
      if (attempt !== generation || !container.isConnected) return;
      draw({status: 'error'});
      const retry = document.createElement('button');
      retry.className = 'pay-btn-opt';
      retry.textContent = 'Reintentar consulta de cliente';
      retry.onclick = refresh;
      container.append(retry);
    }
  }
  if (loadAssignment) void refresh();
  else draw({status: 'stored'});
  return {update};
}
