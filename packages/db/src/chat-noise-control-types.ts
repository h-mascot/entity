export type ChatNoiseReservationState = 'reserved' | 'completed' | 'released' | 'failed';

export interface ChatNoiseCooldownRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  channel_id: string;
  agent_id: string;
  cooldown_seconds: number;
  configured_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatNoiseMuteRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  scope_type: 'channel' | 'category';
  scope_id: string;
  muted_by_user_id: string;
  reason: string;
  cleared_at: string | null;
  cleared_by_user_id: string | null;
  clear_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatNoiseReservationRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  category_id: string;
  channel_id: string;
  agent_id: string;
  state: ChatNoiseReservationState;
  attempted_at: string;
  completed_at: string | null;
  released_at: string | null;
  release_reason: string | null;
  override_actor_user_id: string | null;
  override_reason: string | null;
}

export interface ChatNoiseAuditRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  action: string;
  channel_id: string | null;
  category_id: string | null;
  agent_id: string | null;
  reservation_id: string | null;
  actor_user_id: string;
  reason: string | null;
  created_at: string;
}

export interface ChatNoiseReservationDecision {
  allowed: boolean;
  reason: 'category_muted' | 'channel_muted' | 'reservation_pending' | 'cooldown' | null;
  retry_after_seconds?: number;
  reservation: ChatNoiseReservationRecord | null;
}

export interface ChatNoiseControlRepository {
  configureCooldown: (input: {
    org_id: string;
    team_id?: string | null;
    channel_id: string;
    agent_id: string;
    cooldown_seconds: number;
    configured_by_user_id: string;
  }) => ChatNoiseCooldownRecord;
  clearCooldown: (input: {
    org_id: string;
    channel_id: string;
    agent_id: string;
    cleared_by_user_id: string;
  }) => boolean;
  getCooldown: (orgId: string, channelId: string, agentId: string) => ChatNoiseCooldownRecord | undefined;
  listCooldowns: (filters: { org_id: string; team_id?: string | null }) => ChatNoiseCooldownRecord[];
  setChannelMute: (input: {
    org_id: string;
    team_id?: string | null;
    channel_id: string;
    muted?: boolean;
    muted_by_user_id?: string;
    actor_user_id?: string;
    reason?: string;
  }) => ChatNoiseMuteRecord;
  setCategoryMute: (input: {
    org_id: string;
    team_id?: string | null;
    category_id: string;
    muted?: boolean;
    muted_by_user_id?: string;
    actor_user_id?: string;
    reason?: string;
  }) => ChatNoiseMuteRecord;
  getActiveChannelMute: (orgId: string, channelId: string, teamId?: string | null) => ChatNoiseMuteRecord | undefined;
  getActiveCategoryMute: (orgId: string, categoryId: string, teamId?: string | null) => ChatNoiseMuteRecord | undefined;
  listActiveMutes: (filters: { org_id: string; team_id?: string | null }) => ChatNoiseMuteRecord[];
  clearMute: (input: {
    org_id: string;
    mute_id: string;
    cleared_by_user_id: string;
    reason: string;
  }) => ChatNoiseMuteRecord | undefined;
  reservePost: (input: {
    org_id: string;
    team_id?: string | null;
    category_id: string;
    channel_id: string;
    agent_id: string;
    attempted_at: string;
    operator_override?: { actor_user_id: string; reason: string };
  }) => ChatNoiseReservationDecision;
  completePost: (input: {
    org_id: string;
    reservation_id: string;
    completed_at: string;
  }) => ChatNoiseReservationRecord;
  releasePost: (input: {
    org_id: string;
    reservation_id: string;
    state: 'released' | 'failed';
    released_at: string;
    reason: string;
  }) => ChatNoiseReservationRecord;
  listAuditEvents: (filters: { org_id: string; team_id?: string | null; limit?: number }) => ChatNoiseAuditRecord[];
}
