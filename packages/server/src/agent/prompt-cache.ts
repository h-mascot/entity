import type { ModelMessage } from 'ai';
import type { TaskAgentProviderId } from './settings';

const ANTHROPIC_CACHE_OPTIONS = {
  anthropic: {
    cacheControl: {
      type: 'ephemeral',
      ttl: '5m',
    },
  },
} as const;

export function buildCachedPromptMessages(input: {
  provider: TaskAgentProviderId;
  cachedSystemContent: string;
  userContent: string;
}): ModelMessage[] {
  const systemMessage: ModelMessage = {
    role: 'system',
    content: input.cachedSystemContent,
  };

  if (input.provider === 'anthropic') {
    systemMessage.providerOptions = ANTHROPIC_CACHE_OPTIONS as ModelMessage['providerOptions'];
  }

  return [
    systemMessage,
    {
      role: 'user',
      content: input.userContent,
    },
  ];
}
