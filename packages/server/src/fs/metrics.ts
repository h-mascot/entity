export type OperationBucket = {
  count: number;
  success: number;
  error: number;
  totalDurationMs: number;
  lastDurationMs: number;
  lastAt: string | null;
};

export type SourceMetricBucket = {
  sourceId: string;
  operations: Record<string, OperationBucket>;
  lastError: string | null;
  lastErrorAt: string | null;
};

const operationTotals: Record<string, OperationBucket> = {};
const perSource: Record<string, SourceMetricBucket> = {};

function nowIso(): string {
  return new Date().toISOString();
}

function getOperationBucket(registry: Record<string, OperationBucket>, key: string): OperationBucket {
  if (!registry[key]) {
    registry[key] = {
      count: 0,
      success: 0,
      error: 0,
      totalDurationMs: 0,
      lastDurationMs: 0,
      lastAt: null,
    };
  }

  return registry[key];
}

function getSourceBucket(sourceId: string): SourceMetricBucket {
  if (!perSource[sourceId]) {
    perSource[sourceId] = {
      sourceId,
      operations: {},
      lastError: null,
      lastErrorAt: null,
    };
  }

  return perSource[sourceId];
}

export function recordFsOperation(input: {
  operation: string;
  sourceId?: string;
  durationMs?: number;
  success: boolean;
  error?: string;
}): void {
  const durationMs = typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? input.durationMs : 0;

  const totalBucket = getOperationBucket(operationTotals, input.operation);
  totalBucket.count += 1;
  totalBucket.totalDurationMs += durationMs;
  totalBucket.lastDurationMs = durationMs;
  totalBucket.lastAt = nowIso();
  if (input.success) {
    totalBucket.success += 1;
  } else {
    totalBucket.error += 1;
  }

  if (!input.sourceId) {
    return;
  }

  const sourceBucket = getSourceBucket(input.sourceId);
  const operationBucket = getOperationBucket(sourceBucket.operations, input.operation);
  operationBucket.count += 1;
  operationBucket.totalDurationMs += durationMs;
  operationBucket.lastDurationMs = durationMs;
  operationBucket.lastAt = nowIso();
  if (input.success) {
    operationBucket.success += 1;
  } else {
    operationBucket.error += 1;
    sourceBucket.lastError = input.error ?? 'Unknown error';
    sourceBucket.lastErrorAt = nowIso();
  }
}

function withDerived(bucket: OperationBucket) {
  return {
    ...bucket,
    avgDurationMs: bucket.count > 0 ? Math.round((bucket.totalDurationMs / bucket.count) * 100) / 100 : 0,
    errorRate: bucket.count > 0 ? Math.round((bucket.error / bucket.count) * 10000) / 100 : 0,
  };
}

export function resetFsMetricsForTests(): void {
  for (const key of Object.keys(operationTotals)) {
    delete operationTotals[key];
  }
  for (const key of Object.keys(perSource)) {
    delete perSource[key];
  }
}

export function getFsMetricsSnapshot() {
  const operations: Record<string, ReturnType<typeof withDerived>> = {};
  for (const [key, bucket] of Object.entries(operationTotals)) {
    operations[key] = withDerived(bucket);
  }

  const sources = Object.values(perSource).map((source) => {
    const sourceOperations: Record<string, ReturnType<typeof withDerived>> = {};
    for (const [key, bucket] of Object.entries(source.operations)) {
      sourceOperations[key] = withDerived(bucket);
    }

    return {
      sourceId: source.sourceId,
      operations: sourceOperations,
      lastError: source.lastError,
      lastErrorAt: source.lastErrorAt,
    };
  });

  return {
    generatedAt: nowIso(),
    operations,
    sources,
  };
}

