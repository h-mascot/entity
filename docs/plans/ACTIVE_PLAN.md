# ACTIVE PLAN — Doc Hub Intelligence Panel + polish

Branch: cursor/doc-hub-intelligence-panel-1879

## Asks
1. View-mode back button (edit mode has one; view doesn't).
2. Doc Hub opens audio/video files.
3. Right sidebar → tabbed "Intelligence" panel + right-edge icon rail; deduped (one of History/Versions, Ask/Intelligence, Metadata).
4. Global search box: right-aligned, narrower (add compact one wired to QuickSwitcher if none exists).
5. Crisper all-black theme (from 2nd mockup).

## Workstreams (non-overlapping files, parallel)
- A (server): audio/video content-types in file-types.ts + HTTP Range support in legacy-files.ts sendRawFileResponse (+tests).
- B (leaf): CodeMirrorFileViewer.tsx audio/video preview kinds via existing rawFileUrl.
- C (theme): index.css dark-theme tokens crisper/blacker (dark block only).
- D (structure): App.tsx + DocumentEditorView.tsx — view-mode back button, compact right-aligned search (QuickSwitcher), new DocumentIntelligencePanel + right icon rail (tabs: Summary/overview, Related, Tasks, Metadata/Provenance, Comments+Suggestions+Review), dedupe. Honest empty states for AI-only sections.

## Verify
- cd packages/server && npm run build && npx vitest run
- npm --prefix packages/app run build && npm --prefix packages/app run test
- npm run ctrl:gate; browser UI test; autoreview + thermo.
