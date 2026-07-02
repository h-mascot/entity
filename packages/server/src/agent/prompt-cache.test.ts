import { describe, expect, it } from 'vitest';
import { buildCachedPromptMessages } from './prompt-cache';

describe('buildCachedPromptMessages', () => {
  it('adds Anthropic cache-control provider options to cached system context', () => {
    const messages = buildCachedPromptMessages({
      provider: 'anthropic',
      cachedSystemContent: 'Large stable task context',
      userContent: 'Agent-specific instruction',
    });

    expect(messages).toEqual([
      {
        role: 'system',
        content: 'Large stable task context',
        providerOptions: {
          anthropic: {
            cacheControl: {
              type: 'ephemeral',
              ttl: '5m',
            },
          },
        },
      },
      {
        role: 'user',
        content: 'Agent-specific instruction',
      },
    ]);
  });

  it('leaves non-Anthropic providers without cache-control options', () => {
    expect(buildCachedPromptMessages({
      provider: 'openai',
      cachedSystemContent: 'Context',
      userContent: 'Instruction',
    })[0]).toEqual({
      role: 'system',
      content: 'Context',
    });
  });
});
