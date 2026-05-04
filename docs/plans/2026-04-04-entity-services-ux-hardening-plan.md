# 2026-04-04 Entity Services UX Hardening Plan

## Goal
Improve the Entity Services surface with (1) alternate list/card views, (2) better naming/introspection for generic node services, and (3) refresh/state persistence so users stay anchored on the Services page.

## Steps
- [ ] Inspect current frontend routing/state handling for plugin pages
- [ ] Inspect backend entity-services discovery metadata and enrich service identification
- [ ] Add UI view toggle and persist preference
- [ ] Preserve page/view/filters across refresh/reload/navigation
- [ ] Build and verify locally on Mac
- [ ] Push and deploy
- [ ] Verify live behavior

## Notes
- Prefer low-risk additive changes.
- Preserve current table view as default unless list/card view is clearer.
- Improve generic `node :port` naming by probing headers/body/title when safe.
