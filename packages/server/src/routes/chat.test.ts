import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-routes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;
let registerChatRoutes: typeof import('./chat').registerChatRoutes;

beforeAll(async () => {
  ({ registerChatRoutes } = await import('./chat'));

  const app = express();
  app.use(express.json());
  registerChatRoutes({ app });

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      baseUrl = `http://127.0.0.1:${address.port}/api/chat`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;

  if (originalChatAgentRuntime !== undefined) process.env.ENTITY_CHAT_AGENT_RUNTIME = originalChatAgentRuntime;
  else delete process.env.ENTITY_CHAT_AGENT_RUNTIME;

  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(tmpDbPath + suffix);
    } catch {}
  }
});

async function postJson(pathname: string, body: unknown) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('chat routes', () => {
  it('extracts OpenClaw assistant text from JSON metadata instead of rendering raw runtime JSON', async () => {
    const { parseOpenClawAgentOutput } = await import('./chat');
    const raw = JSON.stringify({
      payloads: [],
      meta: {
        finalAssistantVisibleText: 'Zora clean reply',
        finalAssistantRawText: '<final>Zora clean reply</final>',
        sessionId: 'entity-chat-zora-test',
      },
    });

    expect(parseOpenClawAgentOutput(raw)).toBe('Zora clean reply');
  });

  it('does not render OpenClaw JSON metadata when the runtime returns NO_REPLY', async () => {
    const { parseOpenClawAgentOutput } = await import('./chat');
    const raw = JSON.stringify({
      payloads: [],
      meta: {
        finalAssistantVisibleText: 'NO_REPLY',
        finalAssistantRawText: '<final>NO_REPLY</final>',
        sessionFile: '/Users/henrymascot/.openclaw/agents/main/sessions/entity-chat-zora.jsonl',
      },
    });

    expect(parseOpenClawAgentOutput(raw)).toBe('');
  });

  it('extracts batched OpenClaw agent replies from runtime JSON text', async () => {
    const { parseOpenClawAgentReplyMap } = await import('./chat');
    const raw = [
      '[plugins] [byterover] Plugin loaded',
      JSON.stringify({
        payloads: [
          {
            text: [
              '```json',
              JSON.stringify({
                ada: 'Ada runtime reply',
                zora: { content: 'Zora runtime reply' },
                spock: '<final>Spock runtime reply</final>',
              }),
              '```',
            ].join('\n'),
          },
        ],
      }),
    ].join('\n');

    expect(parseOpenClawAgentReplyMap(raw, ['ada', 'zora', 'spock', 'book'])).toEqual(new Map([
      ['ada', 'Ada runtime reply'],
      ['zora', 'Zora runtime reply'],
      ['spock', 'Spock runtime reply'],
    ]));
  });

  it('returns persisted assistant message ids so threads survive refresh', async () => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const guardedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (!url.startsWith(baseUrl)) {
        throw new Error(`unexpected external chat fetch: ${url}`);
      }

      return originalFetch(input, init);
    }) as typeof fetch);

    await postJson('/setup', {});

    try {
      const categoryResponse = await postJson('/categories', { name: 'QA' });
      const categoryPayload = await categoryResponse.json() as { category: { id: string } };

      const channelResponse = await postJson('/channels', {
        categoryId: categoryPayload.category.id,
        name: 'qa-thread-route',
        agents: ['book'],
      });
      const channelPayload = await channelResponse.json() as { channel: { id: string } };

      const sendResponse = await postJson('/send', {
        channelId: channelPayload.channel.id,
        targetAgent: 'book',
        agents: ['book'],
        content: 'hello persisted replies',
        messageId: 'user-message-1',
      });
      const sendPayload = await sendResponse.json() as {
        message: { id: string };
        messages: Array<{ id?: string; channelId?: string; content?: string }>;
      };

      expect(sendResponse.status).toBe(201);
      // THE-931 (R2): the user message id is server-generated; the caller
      // messageId is ignored (no existence oracle).
      expect(sendPayload.message.id).toBeTruthy();
      expect(sendPayload.message.id).not.toBe('user-message-1');
      expect(sendPayload.messages).toHaveLength(1);
      expect(sendPayload.messages[0].id).toBeTruthy();
      expect(sendPayload.messages[0].channelId).toBe(channelPayload.channel.id);

      const replyId = sendPayload.messages[0].id!;
      const threadResponse = await postJson('/threads', {
        channelId: channelPayload.channel.id,
        parentMessageId: replyId,
        title: 'Assistant reply thread',
      });
      const threadPayload = await threadResponse.json() as { thread: { id: string; parentMessageId: string } };
      expect(threadPayload.thread.parentMessageId).toBe(replyId);

      await postJson('/send', {
        channelId: channelPayload.channel.id,
        threadId: threadPayload.thread.id,
        parentMessageId: replyId,
        targetAgent: 'book',
        agents: ['book'],
        content: 'reply in thread',
        messageId: 'thread-user-message-1',
      });

      const threadsResponse = await fetch(`${baseUrl}/channels/${channelPayload.channel.id}/threads`);
      const threadsPayload = await threadsResponse.json() as {
        threads: Array<{ parentMessageId: string; messageCount: number }>;
      };

      expect(threadsPayload.threads).toEqual([
        expect.objectContaining({
          parentMessageId: replyId,
          messageCount: 2,
        }),
      ]);
    } finally {
      guardedFetch.mockRestore();
    }
  });
});
