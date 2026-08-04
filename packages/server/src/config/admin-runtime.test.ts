import { describe, expect, it } from 'vitest';
import { assertEngineeringImportExecuteAllowed } from './admin-runtime';

describe('admin runtime helpers', () => {
  it('blocks engineering import execute while dry-run is required', () => {
    expect(() => assertEngineeringImportExecuteAllowed(true, true)).toThrow(/importDryRunRequired/i);
    expect(() => assertEngineeringImportExecuteAllowed(true, false)).not.toThrow();
    expect(() => assertEngineeringImportExecuteAllowed(false, true)).not.toThrow();
  });
});
