import { useMemo, useState } from 'react';
import { withApiToken } from '../../lib/http';

const TARGET_TYPES = [
  { value: 'daily-review', label: 'Daily review' },
  { value: 'business-review', label: 'Business review' },
  { value: 'blog', label: 'Blog' },
  { value: 'prd', label: 'PRD' },
  { value: 'project-doc', label: 'Project doc' },
  { value: 'script', label: 'Script' },
  { value: 'one-off', label: 'One-off' },
] as const;

export interface DocumentConvertDialogProps {
  open: boolean;
  sourceId: string | null;
  sourcePath: string | null;
  readOnly?: boolean;
  apiBase?: string;
  onClose: () => void;
  onConverted?: (result: { targetPath: string; targetType: string }) => void;
  pushToast?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void;
}

export default function DocumentConvertDialog({
  open,
  sourceId,
  sourcePath,
  readOnly = false,
  apiBase = '',
  onClose,
  onConverted,
  pushToast,
}: DocumentConvertDialogProps) {
  const [targetType, setTargetType] = useState<(typeof TARGET_TYPES)[number]['value']>('prd');
  const [targetName, setTargetName] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabledReason = useMemo(() => {
    if (!open) return 'closed';
    if (!sourceId || !sourcePath) return 'Open a writable document to convert.';
    if (readOnly) return 'This document source is read-only.';
    return null;
  }, [open, readOnly, sourceId, sourcePath]);

  if (!open) return null;

  const runPreview = async () => {
    if (disabledReason || !sourceId || !sourcePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/fs/documents/convert`, withApiToken({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          path: sourcePath,
          targetType,
          targetName: targetName.trim() || undefined,
          dryRun: true,
        }),
      }));
      const body = await res.json() as { preview?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Preview failed (${res.status})`);
      setPreview(body.preview ?? 'Preview unavailable.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed.');
    } finally {
      setLoading(false);
    }
  };

  const runConvert = async () => {
    if (disabledReason || !sourceId || !sourcePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/fs/documents/convert`, withApiToken({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          path: sourcePath,
          targetType,
          targetName: targetName.trim() || undefined,
        }),
      }));
      const body = await res.json() as { targetPath?: string; targetType?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Convert failed (${res.status})`);
      pushToast?.(`Created ${body.targetPath}`, 'success');
      onConverted?.({ targetPath: body.targetPath ?? '', targetType: body.targetType ?? targetType });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Convert failed.';
      setError(message);
      pushToast?.(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Convert document">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Convert document</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Creates a new document and preserves source provenance.</p>
          </div>
          <button type="button" className="mc-shell-btn px-2 py-1 text-xs" onClick={onClose}>Close</button>
        </div>

        {disabledReason && disabledReason !== 'closed' ? (
          <div className="text-sm text-[var(--error)]">{disabledReason}</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-muted)]">
              Source: <span className="text-[var(--text-primary)]">{sourcePath}</span>
            </div>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Target type</span>
              <select value={targetType} onChange={(event) => setTargetType(event.target.value as typeof targetType)} className="mc-shell-input px-2 py-2 text-sm">
                {TARGET_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Target name</span>
              <input value={targetName} onChange={(event) => setTargetName(event.target.value)} className="mc-shell-input px-2 py-2 text-sm" placeholder="Optional title override" />
            </label>
            {preview && (
              <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{preview}</pre>
            )}
            {error && <div className="text-xs text-[var(--error)]" role="alert">{error}</div>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="mc-shell-btn px-3 py-1.5 text-xs" disabled={loading} onClick={() => void runPreview()}>Preview</button>
              <button type="button" className="mc-shell-btn mc-shell-btn-active px-3 py-1.5 text-xs" disabled={loading} onClick={() => void runConvert()}>Convert</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
