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
  const canvasPadding = dense ? 'px-2 py-3 sm:px-4 sm:py-5' : 'px-4 py-6 sm:px-6 lg:px-8 lg:py-10';
  const pagePadding = dense ? 'px-5 py-6 sm:px-7 sm:py-8' : 'px-6 py-8 sm:px-10 sm:py-12 lg:px-12 lg:py-14';
  const pageRadius = dense ? 'rounded-lg sm:rounded-xl' : 'rounded-xl';
  const pageWidth = dense ? 'max-w-3xl' : 'max-w-[820px]';

  return (
    <div
      className={`entity-doc-canvas w-full ${canvasPadding} ${animate ? 'mc-file-switch-anim' : ''} ${className ?? ''}`.trim()}
    >
      <article className={`entity-doc-page mx-auto w-full ${pageWidth} ${pageRadius} ${pagePadding}`}>
        {tts === 'full' ? (
          <MarkdownAudioControls
            docsPath={docsPath}
            content={content}
            settings={ttsSettings}
            onSettingsChange={onTtsSettingsChange}
            onToast={onToast}
          />
        ) : null}
        <MarkdownPreview
          content={content}
          loading={loading}
          onDocsLinkNavigate={onDocsLinkNavigate}
          hasDocumentLinkBase={Boolean(docsPath)}
        />
      </article>
    </div>
  );
}
