# Entity: Add /docs/* route for serving external markdown files

## Goal
Add a `/docs/*` URL route to Entity so that links like `http://100.106.69.9:3000/docs/output/crons/daily-brief/2026-02-14.md` open and render markdown files inside Entity's UI using the existing MarkdownPreview component.

## What to build

### 1. Server-side: Add `/api/docs/*` endpoint in `packages/server/src/index.ts`

Add a new route BEFORE the SPA catch-all (before line ~1667):

```typescript
// Serve external docs from configurable root paths
const DOCS_ROOTS: Record<string, string> = {
  'output': process.env.DOCS_OUTPUT_ROOT || '/home/henrymascot/clawd/output',
  'memory': process.env.DOCS_MEMORY_ROOT || '/home/henrymascot/clawd/memory',
};

app.get('/api/docs/*', async (req, res) => {
  const docPath = req.params[0]; // e.g. "output/crons/daily-brief/2026-02-14.md"
  
  // Security: prevent path traversal
  const normalized = path.normalize(docPath).replace(/^(\.\.[\/\\])+/, '');
  if (normalized.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  
  // Find which root this belongs to
  const firstSegment = normalized.split('/')[0];
  const root = DOCS_ROOTS[firstSegment];
  
  if (!root) {
    return res.status(404).json({ error: 'Unknown docs root' });
  }
  
  const restPath = normalized.slice(firstSegment.length + 1);
  const fullPath = path.join(root, restPath);
  
  // Ensure the resolved path is still within the root
  if (!fullPath.startsWith(root)) {
    return res.status(403).json({ error: 'Path traversal blocked' });
  }
  
  try {
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    res.json({ content, path: docPath, filename: path.basename(fullPath) });
  } catch (err) {
    res.status(404).json({ error: 'File not found' });
  }
});
```

### 2. Frontend: Add `/docs/*` route handler in `packages/app/src/App.tsx`

Add a new state and effect to detect when the URL starts with `/docs/`:

- Parse `window.location.pathname` for `/docs/*`
- If it matches, fetch `/api/docs/*` for the content
- Render the content in MarkdownPreview in a full-width clean reader view
- Add a header bar with: file name, back button (to Entity home), and the breadcrumb path
- Links within the rendered markdown that point to other Entity docs URLs should navigate within the docs viewer (not reload the page)

### 3. Make links within markdown open in docs viewer

In MarkdownPreview.tsx, add a custom `a` component to ReactMarkdown:
- If href starts with `/docs/` or matches the Entity host, navigate within the SPA
- Otherwise open in new tab (`target="_blank"`)

## Files to modify
- `packages/server/src/index.ts` - Add /api/docs/* route before SPA catch-all
- `packages/app/src/App.tsx` - Add docs viewer mode
- `packages/app/src/components/MarkdownPreview.tsx` - Add custom link handler

## Environment
- Entity repo: ~/Code/entity
- Server runs on port 3000
- Frontend is React + Vite SPA
- Already uses ReactMarkdown with remark-gfm

## Testing
After building:
1. `cd ~/Code/entity && npm run build`
2. Restart server
3. Navigate to http://localhost:3000/docs/output/crons/daily-brief/2026-02-14.md
4. Should see the markdown rendered in Entity's reader
