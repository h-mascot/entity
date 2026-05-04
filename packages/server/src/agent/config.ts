function normalizeBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (typeof value === 'undefined') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

export const AGENT_CONFIG = {
  model: 'gemini-3-flash-preview',
  provider: 'google',
  scanIntervalMs: 30 * 60 * 1000,
  staleThresholdHours: {
    doing: 24,
    review: 48,
  },
  maxActionsPerScan: 10,
  get enabled(): boolean {
    return normalizeBooleanFlag(process.env.ENTITY_AGENT_ENABLED, false);
  },
} as const;
