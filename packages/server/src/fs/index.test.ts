import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFileSystemRoutes } from './index';

const mocks = vi.hoisted(() => {
  const runOnce = vi.fn().mockResolvedValue(undefined);
  return {
    runOnce,
    fileIndexRunner: vi.fn(function FileIndexRunner() {
      return { runOnce };
    }),
  };
});

vi.mock('./routes-sources', () => ({
  registerSourceRoutes: vi.fn(),
}));

vi.mock('./routes-files', () => ({
  registerFileRoutes: vi.fn(),
}));

vi.mock('./routes-search', () => ({
  registerSearchRoutes: vi.fn(),
}));

vi.mock('./index-runner', () => ({
  FileIndexRunner: mocks.fileIndexRunner,
}));

vi.mock('../../../db/src/file-sources', () => ({
  createFileSourceRepository: vi.fn(() => ({
    listSources: vi.fn(() => []),
    createSource: vi.fn(),
  })),
}));

vi.mock('../../../db/src/file-index', () => ({
  createFileIndexRepository: vi.fn(() => ({
    getLatestSyncRun: vi.fn(() => null),
  })),
}));

describe('registerFileSystemRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runOnce.mockResolvedValue(undefined);
    mocks.fileIndexRunner.mockImplementation(function FileIndexRunner() {
      return { runOnce: mocks.runOnce };
    });
  });

  it('registers one file index runner and starts one immediate index run', async () => {
    const app = express();

    registerFileSystemRoutes(app, {
      enabled: true,
      workspaceRoot: '/path/that/does/not/exist',
      indexerEnabled: true,
      indexIntervalMs: 60_000,
    });
    await Promise.resolve();

    expect(mocks.fileIndexRunner).toHaveBeenCalledTimes(1);
    expect(mocks.runOnce).toHaveBeenCalledTimes(1);
  });
});
