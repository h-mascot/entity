import { useEffect, useRef, useState, useCallback } from 'react';
import { MAKING_SOFTWARE_THEME } from './makingSoftwareTheme';

interface HtmlOutputRendererProps {
  content: string;
  className?: string;
}

export function HtmlOutputRenderer({ content, className }: HtmlOutputRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(300);

  const needsTheme = !content.includes('<style') && !content.includes('<link');

  const heightScript = `<script>
(function() {
  function sendHeight() {
    window.parent.postMessage({ type: 'entity-html-height', height: document.documentElement.scrollHeight }, '*');
  }
  sendHeight();
  new MutationObserver(sendHeight).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', sendHeight);
  setTimeout(sendHeight, 500);
})();
</script>`;

  const htmlContent = needsTheme
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${MAKING_SOFTWARE_THEME}</style></head><body>${content}</body>${heightScript}</html>`
    : (content.includes('</html>')
        ? content
        : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${content}</body>${heightScript}</html>`);

  const handleMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === 'entity-html-height' && typeof e.data.height === 'number') {
      setHeight(Math.max(100, e.data.height));
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={htmlContent}
      className={className}
      style={{ width: '100%', height: `${height}px`, border: 'none', borderRadius: '8px' }}
      sandbox="allow-scripts"
      title="HTML Output"
    />
  );
}
