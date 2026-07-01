import MarkdownPreview from './MarkdownPreview';
import MarkdownAudioControls, { type DocsTtsSettings } from './MarkdownAudioControls';

type DocumentToastType = 'success' | 'error' | 'info' | 'warning';

interface DocumentReadingViewProps {
  content: string;
  /** Path used for TTS synthesis + document identity. */
  docsPath: string;
  loading?: boolean;
  ttsSettings: DocsTtsSettings;
  onTtsSettingsChange?: (settings: DocsTtsSettings) => void;
  onToast: (message: string, type: DocumentToastType) => void;
  onDocsLinkNavigate?: (href: string) => boolean;
  /** 'full' shows the Listen/TTS bar above the document; 'none' hides it. */
  tts?: 'full' | 'none';
  /** Tighter padding for narrow viewports (mobile). */
  dense?: boolean;
  animate?: boolean;
  className?: string;
}

/**
 * Single source of truth for the "read a document" experience.
 *
 * Used by the Files tab preview, the split pane, the standalone `/docs/*` route,
 * and (indirectly) task output links so that viewing a document looks identical
 * regardless of where it was opened from. Surrounding chrome (Files context bar,
 * docs-route header + back button) lives at the call site; the reading column
 * itself — width, TTS placement, and markdown rendering — is owned here.
 */
export default function DocumentReadingView({
  content,
  docsPath,
  loading,
  ttsSettings,
  onTtsSettingsChange,
  onToast,
  onDocsLinkNavigate,
  tts = 'full',
  dense = false,
  animate = false,
  className,
}: DocumentReadingViewProps) {
  const padding = dense ? 'px-4 py-5' : 'px-6 py-8';
  return (
    <div
      className={`mx-auto w-full max-w-4xl ${padding} ${animate ? 'mc-file-switch-anim' : ''} ${className ?? ''}`.trim()}
    >
      {tts === 'full' ? (
        <MarkdownAudioControls
          docsPath={docsPath}
          content={content}
          settings={ttsSettings}
          onSettingsChange={onTtsSettingsChange}
          onToast={onToast}
        />
      ) : null}
      <MarkdownPreview content={content} loading={loading} onDocsLinkNavigate={onDocsLinkNavigate} />
    </div>
  );
}
