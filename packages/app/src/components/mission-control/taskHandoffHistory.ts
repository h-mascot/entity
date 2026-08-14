export interface HandoffRecord {
  id: string;
  mode: string;
  source_principal_id: string;
  target_principal_id: string;
  note: string;
  created_at: string;
  rollback_capable: boolean;
}

export interface HandoffApiPayload {
  handoffs?: Array<Partial<HandoffRecord> & { id: string }>;
  incoming?: Array<Record<string, unknown> & { id: string }>;
  outgoing?: Array<Record<string, unknown> & { id: string }>;
}

export function mergeHandoffHistory(payload: HandoffApiPayload | null | undefined): HandoffRecord[] {
  const rows = [
    ...(payload?.handoffs ?? []).map((row) => ({ row, rollbackCapable: true })),
    ...(payload?.incoming ?? []).map((row) => ({ row, rollbackCapable: false })),
    ...(payload?.outgoing ?? []).map((row) => ({ row, rollbackCapable: false })),
  ] as Array<{ row: Record<string, unknown> & { id: string }; rollbackCapable: boolean }>;
  const byId = new Map<string, HandoffRecord>();
  for (const { row, rollbackCapable } of rows) {
    if (!row?.id || byId.has(row.id)) continue;
    byId.set(row.id, {
      id: row.id,
      mode: typeof row.mode === 'string' ? row.mode : 'local',
      source_principal_id:
        typeof row.source_principal_id === 'string'
          ? row.source_principal_id
          : typeof row.created_by_principal_id === 'string'
            ? row.created_by_principal_id
            : 'unknown',
      target_principal_id:
        typeof row.target_principal_id === 'string'
          ? row.target_principal_id
          : typeof row.target_agent_id === 'string'
            ? row.target_agent_id
            : 'unknown',
      note:
        typeof row.note === 'string'
          ? row.note
          : typeof row.reason === 'string'
            ? row.reason
            : '',
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
      rollback_capable: rollbackCapable,
    });
  }
  return Array.from(byId.values()).sort((left, right) => right.created_at.localeCompare(left.created_at));
}
