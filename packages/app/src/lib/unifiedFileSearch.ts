export interface UnifiedFileSearchIdentityOptions {
  query: string;
  orgId?: string;
  sourceId: string;
  type: string;
  origin: string;
  agent: string;
  refreshNonce: number;
}

export function buildUnifiedFileSearchIdentity(options: UnifiedFileSearchIdentityOptions): string {
  return JSON.stringify([
    options.query,
    options.orgId ?? '',
    options.sourceId,
    options.type,
    options.origin,
    options.agent,
    options.refreshNonce,
  ]);
}

export function isUnifiedFileSearchCurrent(
  requestId: number,
  currentRequestId: number,
  requestIdentity: string,
  currentIdentity: string,
): boolean {
  return requestId === currentRequestId && requestIdentity === currentIdentity;
}
