import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { BUILTIN_DEFAULT_CONFIG, EntityConfigSchema, type EntityConfig } from './schema';

function readYamlFile(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return null;
  return YAML.parse(text);
}

function resolveCandidateConfigPath(cwd: string): string {
  let current = path.resolve(cwd);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(current, 'entity.config.yaml');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(path.resolve(cwd), 'entity.config.yaml');
}

export function resolveConfigPath(cwd = process.cwd()): string {
  return path.resolve(process.env.ENTITY_CONFIG || resolveCandidateConfigPath(cwd));
}

export function resolveProfilePath(cwd = process.cwd()): string | null {
  const explicit = process.env.ENTITY_PROFILE_PATH;
  if (explicit) return path.resolve(explicit);
  const profile = process.env.ENTITY_PROFILE;
  if (!profile) return null;
  return path.resolve(cwd, 'config', 'profiles', `${profile}.yaml`);
}

export interface LoadedConfigSources {
  defaults: EntityConfig;
  profile: Partial<EntityConfig> | null;
  config: Partial<EntityConfig> | null;
  configPath: string;
  profilePath: string | null;
  warnings: string[];
}

export function loadFileConfigSources(cwd = process.cwd()): LoadedConfigSources {
  const warnings: string[] = [];
  const configPath = resolveConfigPath(cwd);
  const profilePath = resolveProfilePath(cwd);
  let profile: Partial<EntityConfig> | null = null;
  let config: Partial<EntityConfig> | null = null;

  try {
    const raw = profilePath ? readYamlFile(profilePath) : null;
    if (raw) profile = raw as Partial<EntityConfig>;
  } catch (error) {
    warnings.push(`Failed to load profile config: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const raw = readYamlFile(configPath);
    if (raw) config = raw as Partial<EntityConfig>;
  } catch (error) {
    warnings.push(`Failed to load entity config: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    defaults: BUILTIN_DEFAULT_CONFIG,
    profile,
    config,
    configPath,
    profilePath,
    warnings,
  };
}
