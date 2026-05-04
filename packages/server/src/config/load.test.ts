import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { EntityConfigSchema } from './schema';
import { loadFileConfigSources, resolveConfigPath } from './load';

const repoRoot = path.resolve(__dirname, '../../../..');
const examplePath = path.join(repoRoot, 'docs/config/entity.config.example.yaml');

describe('config file onboarding documentation', () => {
  it('keeps the documented entity.config example valid against the runtime schema', () => {
    const raw = fs.readFileSync(examplePath, 'utf8');
    const parsed = EntityConfigSchema.parse(YAML.parse(raw));

    expect(parsed.version).toBe(1);
    expect(parsed.profile.displayName).toBe('Team Workspace');
    expect(parsed.server.workspaceRoot).toBe('./workspace');
    expect(parsed.server.publicBaseUrl).toBe('http://localhost:3000');
    expect(parsed.agents.map((agent) => agent.id)).toContain('assistant');
    expect(parsed.fileSources[0]).toMatchObject({
      id: 'workspace',
      type: 'local',
      basePath: './workspace',
    });
    expect(parsed.tasks.defaultAssignee).toBe('assistant');
  });

  it('loads entity.config.yaml from the documented default working-directory path', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-config-docs-'));
    fs.copyFileSync(examplePath, path.join(cwd, 'entity.config.yaml'));

    const previous = process.env.ENTITY_CONFIG;
    delete process.env.ENTITY_CONFIG;
    try {
      expect(resolveConfigPath(cwd)).toBe(path.join(cwd, 'entity.config.yaml'));
      const loaded = loadFileConfigSources(cwd);
      expect(loaded.configPath).toBe(path.join(cwd, 'entity.config.yaml'));
      expect(loaded.warnings).toEqual([]);
      expect(loaded.config).toMatchObject({
        profile: { displayName: 'Team Workspace' },
        tasks: { defaultAssignee: 'assistant' },
      });
    } finally {
      if (previous === undefined) delete process.env.ENTITY_CONFIG;
      else process.env.ENTITY_CONFIG = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
