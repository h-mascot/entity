const EXPLICIT_OPT_IN_VALUES = new Set(['1', 'true', 'on', 'yes']);

export function isExplicitSeedOptIn(rawValue: string | undefined): boolean {
  return EXPLICIT_OPT_IN_VALUES.has(rawValue?.trim().toLowerCase() ?? '');
}
