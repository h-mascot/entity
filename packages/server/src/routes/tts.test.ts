import { describe, expect, it } from 'vitest';
import { buildEdgeTtsArgs, resolveEdgeTtsCommand } from './tts';

describe('buildEdgeTtsArgs', () => {
  it('passes text as a subprocess argument instead of shell-escaping it', () => {
    const text = 'Hello "Ada"; rm -rf / && echo done';
    const args = buildEdgeTtsArgs({
      voice: 'en-GB-SoniaNeural',
      text,
      outputFile: '/tmp/entity-edge.mp3',
    });

    expect(args).toEqual([
      '--voice',
      'en-GB-SoniaNeural',
      '--text',
      text,
      '--write-media',
      '/tmp/entity-edge.mp3',
    ]);
  });
});

describe('resolveEdgeTtsCommand', () => {
  it('uses the repo-local virtualenv command when it exists', () => {
    expect(resolveEdgeTtsCommand('/repo', (path) => path === '/repo/.venv/bin/edge-tts')).toBe(
      '/repo/.venv/bin/edge-tts',
    );
  });

  it('finds the repo-local virtualenv command from a workspace package cwd', () => {
    expect(resolveEdgeTtsCommand('/repo/packages/server', (path) => path === '/repo/.venv/bin/edge-tts')).toBe(
      '/repo/.venv/bin/edge-tts',
    );
  });

  it('falls back to PATH when no repo-local command exists', () => {
    expect(resolveEdgeTtsCommand('/repo', () => false)).toBe('edge-tts');
  });
});
