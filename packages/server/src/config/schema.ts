import { z } from 'zod';

const NullableString = z.string().nullable();
const StringArray = z.array(z.string());

export const AgentSettingsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().default('general'),
  avatar: NullableString.default(null),
  emoji: NullableString.default(null),
  enabled: z.boolean().default(true),
  fileSources: StringArray.default([]),
  gateway: z.object({
    type: z.string().default('none'),
    url: NullableString.default(null),
    tokenRef: NullableString.default(null),
  }).default({ type: 'none', url: null, tokenRef: null }),
});

export const EntityConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  profile: z.object({
    displayName: z.string().default('Entity Workspace'),
    ownerName: z.string().default('Local User'),
  }).default({ displayName: 'Entity Workspace', ownerName: 'Local User' }),
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().positive().max(65535).default(3000),
    workspaceRoot: z.string().default('./workspace'),
    publicBaseUrl: z.string().default('http://localhost:3000'),
    apiBaseUrl: z.string().default('http://localhost:3000'),
    wsBaseUrl: z.string().default('ws://localhost:3000'),
    databasePath: z.string().default('./data/entity.sqlite'),
    logPath: z.string().default('./logs/entity.log'),
  }).default({
    host: '127.0.0.1',
    port: 3000,
    workspaceRoot: './workspace',
    publicBaseUrl: 'http://localhost:3000',
    apiBaseUrl: 'http://localhost:3000',
    wsBaseUrl: 'ws://localhost:3000',
    databasePath: './data/entity.sqlite',
    logPath: './logs/entity.log',
  }),
  docs: z.object({
    allowedExtensions: StringArray.default(['md', 'markdown', 'txt', 'log', 'json', 'jsonl', 'yaml', 'yml', 'csv', 'tsv']),
  }).default({ allowedExtensions: ['md', 'markdown', 'txt', 'log', 'json', 'jsonl', 'yaml', 'yml', 'csv', 'tsv'] }),
  agents: z.array(AgentSettingsSchema).default([
    { id: 'assistant', name: 'Assistant', role: 'general', avatar: null, emoji: '🤖', enabled: true, fileSources: [], gateway: { type: 'none', url: null, tokenRef: null } },
  ]),
  fileSources: z.array(z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    type: z.string().default('local'),
    basePath: NullableString.default(null),
    baseUrl: NullableString.default(null),
    enabled: z.boolean().default(true),
    icon: NullableString.default(null),
    agentBindings: StringArray.default([]),
  })).default([]),
  tasks: z.object({
    columns: StringArray.default(['todo', 'doing', 'review', 'done']),
    priorities: StringArray.default(['P1', 'P2', 'P3', 'P4']),
    defaultAssignee: z.string().default('assistant'),
    assigneesFromAgents: z.boolean().default(true),
    projects: StringArray.default(['General']),
  }).default({ columns: ['todo', 'doing', 'review', 'done'], priorities: ['P1', 'P2', 'P3', 'P4'], defaultAssignee: 'assistant', assigneesFromAgents: true, projects: ['General'] }),
  services: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string(),
    healthUrl: z.string().nullable().default(null),
    enabled: z.boolean().default(false),
  })).default([]),
  providers: z.record(z.string(), z.unknown()).default({}),
  plugins: z.record(z.string(), z.unknown()).default({}),
  voice: z.record(z.string(), z.unknown()).default({ defaultProvider: 'browser', providers: {} }),
  deploy: z.record(z.string(), z.unknown()).default({ mode: 'local', preserveDatabase: true, dryRunByDefault: true }),
  terminal: z.object({ targets: z.array(z.unknown()).default([]) }).default({ targets: [] }),
  // ── External service discovery ────────────────────────────────────────────
  discovery: z.object({
    mac: z.object({
      enabled: z.boolean().default(true),
      /** SSH target in user@host form, e.g. 'user@192.168.1.100' */
      sshTarget: NullableString.default(null),
      /** HTTP base of the Mac's local Ollama server */
      ollamaUrl: NullableString.default(null),
      /** HTTP base of the Entity app running on Mac */
      entityUrl: NullableString.default(null),
    }).optional().default({ enabled: true, sshTarget: null, ollamaUrl: null, entityUrl: null }),
    ollama: z.object({
      baseUrl: NullableString.default(null),
    }).optional().default({ baseUrl: null }),
    geordiSwarm: z.object({
      /** Hostname or IP of the Mac running Codex for dispatch */
      codexHost: NullableString.default(null),
      /** Path to the local home directory on the Mac (for tilde expansion) */
      macHomePath: NullableString.default(null),
    }).optional().default({ codexHost: null, macHomePath: null }),
  }).optional().default({
    mac: { enabled: true, sshTarget: null, ollamaUrl: null, entityUrl: null },
    ollama: { baseUrl: null },
    geordiSwarm: { codexHost: null, macHomePath: null },
  }),
});

export type EntityConfig = z.infer<typeof EntityConfigSchema>;
export type ConfigSource = 'default' | 'profile' | 'config' | 'database' | 'env';

export const OnboardingStateSchema = z.object({
  completed: z.boolean().default(false),
  skipped: z.boolean().default(false),
  completedAt: z.string().nullable().default(null),
  mode: z.enum(['quick', 'agent', 'manual']).default('quick'),
  currentStep: z.number().int().min(1).max(7).default(1),
  workspaceMode: z.enum(['private', 'team', 'open-source']).default('private'),
  selectedTheme: z.enum(['dark', 'light', 'kitz', 'nebula', 'aurora', 'paper']).default('aurora'),
  defaultAiProvider: z.string().default('codex'),
  defaultAiModel: z.string().default('GPT-5.5'),
  starterPreset: z.enum(['solo', 'crew', 'open-source']).default('crew'),
  firstAgentMode: z.enum(['assistant', 'invite', 'manual', 'skip']).default('assistant'),
  firstSourceMode: z.enum(['current-folder', 'github', 'skip']).default('current-folder'),
});

const DEFAULT_ONBOARDING_STATE = OnboardingStateSchema.parse({});

export const OnboardingAgentSessionSchema = z.object({
  token: z.string().min(8),
  createdAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(['created', 'opened', 'installing', 'configured', 'verified', 'expired']).default('created'),
  state: OnboardingStateSchema.default(DEFAULT_ONBOARDING_STATE),
  progress: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['pending', 'running', 'done', 'error']),
    message: z.string().optional(),
    updatedAt: z.string(),
  })).default([]),
});

export type OnboardingState = z.infer<typeof OnboardingStateSchema>;
export type OnboardingAgentSession = z.infer<typeof OnboardingAgentSessionSchema>;

export interface SourceMetadata {
  source: ConfigSource;
  editableInUi: boolean;
  secret: boolean;
  sensitive: boolean;
  adminOnly: boolean;
  advanced: boolean;
  requiresRestart: boolean;
  overriddenBy: ConfigSource | null;
}

export const SECRET_KEY_PATTERN = /(token|password|secret|api[_-]?key|credential)/i;

export const BUILTIN_DEFAULT_CONFIG: EntityConfig = EntityConfigSchema.parse({});

export function isSecretPath(path: string): boolean {
  return SECRET_KEY_PATTERN.test(path);
}
