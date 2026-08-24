export interface CuracelAgentImportRow {
  id: string;
  externalId: string;
  existingAgentId: string;
  name: string;
  slug: string;
  emoji: string;
  teamIds: string[];
  moduleIds: string[];
  channelIds: string[];
  reviewRequired: boolean;
  humanGateRequired: boolean;
}

export function buildCuracelSyntheticRows(teamId: string): CuracelAgentImportRow[] {
  return [
    ['atlas', 'Atlas'],
    ['mafa', 'Mafa'],
    ['sabi', 'Sabi'],
    ['kashy', 'Kashy'],
  ].map(([slug, name]) => ({
    id: `curacel-import-${slug}`,
    externalId: `curacel-${slug}`,
    existingAgentId: '',
    name,
    slug,
    emoji: '🤖',
    teamIds: teamId ? [teamId] : [],
    moduleIds: [],
    channelIds: [],
    reviewRequired: true,
    humanGateRequired: true,
  }));
}
