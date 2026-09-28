// Resolve the TPV employee from the persisted operation, not the shared Club actor.
export async function assignmentDetails(db, source, state) {
  const assignment = state.assignment;
  const history = state.history || [];
  const ids = [...new Set(history.map(entry => entry.operation_id).filter(Boolean))];
  const employees = ids.length ? (await db.query(`
    select o.id, o.body::jsonb->>'employee_id' as employee_id,
      coalesce(c.context->>'name', s.display_name) as employee_name
    from tpv_bridge_private.outbox o
    left join public.staff_profiles s on s.id = o.body::jsonb->>'employee_id'
    left join tpv_bridge_private.completed_sales c on c.award_operation = o.id
    where o.source = $1 and o.id = any($2::uuid[])
  `, [source, ids])).rows : [];
  const byOperation = new Map(employees.map(row => [row.id, {id: row.employee_id, name: row.employee_name || ''}]));
  const label = assignment?.active
    ? (await db.query('select name from tpv_bridge_private.member_labels where id=$1', [assignment.member_id])).rows[0]?.name
    : null;
  const current = history.find(entry => entry.version === assignment?.version && entry.reason === 'assign');
  return {
    active: assignment?.active || false,
    memberId: assignment?.active ? assignment.member_id : null,
    name: label || '',
    points: (assignment?.delta || 0) / 100,
    version: state.version,
    assignedBy: assignment?.active ? byOperation.get(current?.operation_id) || null : null,
    history: history.map(entry => ({...entry,
      action: entry.reason === 'assign' ? 'assign_sale' : 'withdraw_sale',
      at: entry.created_at,
      employee: byOperation.get(entry.operation_id) || null,
    })),
  };
}
