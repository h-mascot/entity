# PRD: DocHub Smart File Preview

## Problem
The Unified File Dashboard renders ALL files as text, including binary files (PNG, JPG, GIF). This shows raw binary gibberish for images. Additionally, clicking any file shows an "Enter" button that opens a text view regardless of file type.

## Solution
Detect file types by extension and render appropriately:

### File Type Rendering

| Extension | List Preview | Full View (on click) |
|-----------|-------------|---------------------|
| `.md` | First 2 lines rendered as text | Rendered markdown |
| `.ts/.tsx/.js/.jsx/.vue/.py/.sh/.json/.yaml/.css` | First 2 lines as code (monospace) | Syntax-highlighted code |
| `.png/.jpg/.jpeg/.gif/.svg/.webp` | Thumbnail (max 80px height) | Full image `<img>` tag, fit to container |
| `.pdf` | Icon + filename + file size | Embedded PDF viewer or download link |
| `.db/.wasm/.lock/.bin` + other binary | Icon + filename + file size | "Binary file - download" message |

### Changes Required

#### 1. File type detection utility
**File:** `packages/app/src/utils/fileType.ts` (new)

```typescript
export type FileCategory = 'markdown' | 'code' | 'image' | 'pdf' | 'binary' | 'text';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.sh', '.bash', '.json', '.yaml', '.yml', '.css', '.scss', '.html', '.sql', '.toml', '.env'];
const BINARY_EXTS = ['.db', '.sqlite', '.wasm', '.lock', '.bin', '.zip', '.tar', '.gz', '.node', '.so', '.dylib'];

export function categorizeFile(path: string): FileCategory {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  if (ext === '.md') return 'markdown';
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (CODE_EXTS.includes(ext)) return 'code';
  if (BINARY_EXTS.includes(ext)) return 'binary';
  return 'text';
}
```

#### 2. Update search results / file list rendering
**File:** Wherever the DocHub list renders file cards (likely `packages/app/src/components/FileSearch.tsx` or similar)

**Current:** Shows raw text content for ALL files
**New behavior:**
- For `image` files: Show `<img src="{apiBase}/api/fs/sources/{sourceId}/raw/{path}" style="max-height: 80px" />` thumbnail
- For `binary` files: Show file icon + size, NO content preview
- For `code` files: Show first 2 lines in `<pre><code>` block
- For `markdown` files: Show first 2 lines as plain text (strip markdown syntax)

#### 3. Update file viewer (click handler)
**Current:** Opens text view for everything
**New behavior:**
- `image`: Render `<img>` tag, max-width 100%, centered
- `code`: Syntax-highlighted view (use existing syntax highlighting if available)
- `markdown`: Rendered markdown
- `binary`: Show "Binary file" message with file size
- `pdf`: `<iframe>` or download link

#### 4. Raw file endpoint (if not existing)
**File:** `packages/server/src/fs/` routes

Need a raw file serving endpoint that returns the actual file bytes with correct Content-Type:
```
GET /api/fs/sources/:sourceId/raw/*path
```
- Images: `Content-Type: image/png` etc.
- This enables `<img src="...">` to work in the frontend

#### 5. Indexer: Skip binary content
**File:** `packages/server/src/fs/index-runner.ts`

Don't store raw content for image/binary files in the search index. Store only:
- filename
- path
- file size
- mime type
- last modified

This prevents the gibberish in search results and reduces index size.

## Priority
P1 - Affects usability of the entire DocHub feature.

## Effort
~2-3 hours for Geordi/Codex

## Success Criteria
- Images render as thumbnails in list, full images in viewer
- No binary gibberish anywhere in the UI
- Code files show syntax highlighting
- Binary files show clean icon + metadata
- Clicking opens the right viewer for the file type
