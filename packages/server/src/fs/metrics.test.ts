import { describe, it, expect, beforeEach } from 'vitest';
import { recordFsOperation, getFsMetricsSnapshot } from './metrics';

describe('metrics', () => {
  beforeEach(() => {
    // Reset metrics between tests
    // Note: In a real app we'd need to export a reset function
    // For now we rely on fresh module import
  });

  describe('recordFsOperation', () => {
    it('should record successful operation', () => {
      recordFsOperation({
        operation: 'read',
        durationMs: 100,
        success: true,
      });

      const snapshot = getFsMetricsSnapshot();
      expect(snapshot.operations.read).toBeDefined();
      expect(snapshot.operations.read.count).toBe(1);
      expect(snapshot.operations.read.success).toBe(1);
      expect(snapshot.operations.read.error).toBe(0);
    });

    it('should record failed operation', () => {
      recordFsOperation({
        operation: 'write',
        durationMs: 50,
        success: false,
        error: 'Permission denied',
      });

      const snapshot = getFsMetricsSnapshot();
      expect(snapshot.operations.write.count).toBe(1);
      expect(snapshot.operations.write.success).toBe(0);
      expect(snapshot.operations.write.error).toBe(1);
    });

    it('should calculate average duration', () => {
      recordFsOperation({ operation: 'avg-test', durationMs: 100, success: true });
      recordFsOperation({ operation: 'avg-test', durationMs: 200, success: true });
      recordFsOperation({ operation: 'avg-test', durationMs: 300, success: true });

      const snapshot = getFsMetricsSnapshot();
      expect(snapshot.operations['avg-test'].avgDurationMs).toBe(200);
    });

    it('should track per-source metrics', () => {
      recordFsOperation({
        operation: 'read',
        sourceId: 'source-1',
        durationMs: 100,
        success: true,
      });

      recordFsOperation({
        operation: 'read',
        sourceId: 'source-2',
        durationMs: 200,
        success: true,
      });

      const snapshot = getFsMetricsSnapshot();
      expect(snapshot.sources).toHaveLength(2);
      
      const source1 = snapshot.sources.find(s => s.sourceId === 'source-1');
      expect(source1?.operations.read.count).toBe(1);
    });

    it('should track last error per source', () => {
      recordFsOperation({
        operation: 'write',
        sourceId: 'problematic-source',
        durationMs: 10,
        success: false,
        error: 'File not found',
      });

      const snapshot = getFsMetricsSnapshot();
      const source = snapshot.sources.find(s => s.sourceId === 'problematic-source');
      expect(source?.lastError).toBe('File not found');
      expect(source?.lastErrorAt).toBeDefined();
    });
  });

  describe('error rate calculation', () => {
    it('should calculate error rate correctly', () => {
      recordFsOperation({ operation: 'error-rate', durationMs: 10, success: true });
      recordFsOperation({ operation: 'error-rate', durationMs: 10, success: true });
      recordFsOperation({ operation: 'error-rate', durationMs: 10, success: false });
      recordFsOperation({ operation: 'error-rate', durationMs: 10, success: false });

      const snapshot = getFsMetricsSnapshot();
      expect(snapshot.operations['error-rate'].errorRate).toBe(50); // 50%
    });
  });
});
