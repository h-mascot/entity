#!/usr/bin/env python3
import sys

# Read the file
with open('packages/app/src/App.tsx', 'r') as f:
    lines = f.readlines()

# Find the line with "const reviewPollRunIdRef = useRef"
insert_index = None
for i, line in enumerate(lines):
    if 'const reviewPollRunIdRef = useRef<string | null>(null);' in line:
        insert_index = i + 1  # Insert after this line
        break

if insert_index is None:
    print("ERROR: Could not find insertion point")
    sys.exit(1)

# The code to insert
code_to_insert = '''  // Docs viewer state
  const [docsView, setDocsView] = useState<{ root: string; path: string } | null>(null);
  const [docsContent, setDocsContent] = useState<string>('');
  const [docsLoading, setDocsLoading] = useState(false);

  // Parse docs URL on mount
  useEffect(() => {
    const path = window.location.pathname;
    const docsMatch = path.match(/^\\/docs\\/([^/]+)\\/(.+)$/);
    if (docsMatch) {
      const [, root, filePath] = docsMatch;
      setDocsView({ root, path: filePath });
    }
  }, []);

  // Fetch docs content when docsView changes
  useEffect(() => {
    if (!docsView) return;
    setDocsLoading(true);
    fetch(`${runtime.apiBase}/docs/${docsView.root}/${docsView.path}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load');
        return r.text();
      })
      .then(content => {
        setDocsContent(content);
        setDocsLoading(false);
      })
      .catch(() => {
        setDocsContent('# Error\\nFailed to load document.');
        setDocsLoading(false);
      });
  }, [docsView]);

'''

# Insert the code
lines.insert(insert_index, code_to_insert)

# Find the main return statement
return_insert_index = None
for i, line in enumerate(lines):
    if 'return (' in line and i > 3000:  # Main return is at the end
        return_insert_index = i + 1  # Insert after 'return ('
        break

if return_insert_index is None:
    print("ERROR: Could not find return statement")
    sys.exit(1)

# The UI code to insert
ui_code = '''      {/* Docs Viewer Overlay */}
      {docsView && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-secondary)]">📄</span>
              <span className="text-[var(--text-primary)] font-medium">{docsView.path}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{docsView.root}</span>
            </div>
            <button
              onClick={() => { setDocsView(null); window.history.pushState({}, '', '/'); }}
              className="p-2 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto p-6">
            {docsLoading ? (
              <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">Loading...</div>
            ) : (
              <div className="max-w-4xl mx-auto">
                <MarkdownPreview content={docsContent} loading={false} />
              </div>
            )}
          </div>
        </div>
      )}
'''

# Insert the UI code (after the opening div of main return)
lines.insert(return_insert_index, ui_code)

# Write back
with open('packages/app/src/App.tsx', 'w') as f:
    f.writelines(lines)

print("SUCCESS: Code inserted successfully")
