# Report Synthesis Outline

## Executive Thesis

Entity's redesign should sharpen the product into a local operational command surface: fast to scan, explicit about health and provenance, and clear about the next safe action. The final report should reject marketing-dashboard polish in favor of dense, accountable workflows for files, agents, tasks, services, chat, docs, and admin surfaces.

## Highest-Signal Recommendations

### 1. Standardize The Shell Before Refining Individual Views

- Treat the global shell as the primary consistency problem: first-level routes need identical nav placement, active states, right-side status cluster, and context-bar behavior.
- Remove duplicate navigation and action surfaces. Several reviews call out repeated admin/plugin actions, mixed sidebars, and route-specific controls competing with global utilities.
- Make `Add to Dock` a clearly global utility or demote it. It currently competes with content in Files, Services, and other empty/low-data states.
- Define one pattern each for left rail, route context bar, detail panel, bottom utility drawer, and modal/external-route actions.

### 2. Make Operational State Visible And Prioritized

- Every view should answer within seconds: what is selected, what is healthy or broken, what changed recently, and what action is safe next.
- Use severity ordering consistently across Agents, Services, Tasks, Admin, and detail views: Offline/Blocked/Failed should outrank Degraded/Unknown, while Operational/Healthy should be quieter.
- Replace ambiguous zero-data screens with explicit loading, empty, failed, and populated states. This is a repeated issue in Services, Chat, Files, Task Detail, Agent Detail, and Admin.
- Status indicators need icon + label + color, not color-only chips or numeric counters without visible backing rows.

### 3. Preserve Density While Improving Scan Hierarchy

- The redesign should not become card-heavy or hero-like. Keep operational density, but improve grouping, spacing, alignment, and contrast so active work and failures are faster to identify.
- Prefer row/table/list patterns for repeated operational objects: files, services, agents, tasks, outputs, and activity entries.
- Use cards sparingly for individual repeated items or detail modules, not as nested containers or page-section wrappers.
- Put high-frequency controls near the objects they affect; demote low-frequency editor/admin controls until an object is selected or the user enters an admin workflow.

### 4. Build Provenance And Auditability Into Core Objects

- Every operational object should expose source, actor, timestamp, related evidence, and open/copy affordances where relevant.
- Task output and docs links need first-class treatment: normalized docs URLs, local path handling, empty output states, previews/labels, and open/copy actions.
- Agent output should be auditable back to tasks, docs, or files; activity timelines should distinguish routine events from failures, handoffs, and operator actions.
- Files and docs should preserve breadcrumbs, source scope, modified dates, and clear return paths.

### 5. Separate View Ownership From Cross-View Context

- Files owns file discovery, source filtering, and document actions.
- Agents owns fleet health, selected-agent detail, queue/output/activity, and runtime diagnostics.
- Tasks owns board state, priorities, dependencies, outputs, comments, and task detail editing.
- Services owns service discovery, health, host/URL, diagnostics, and plugin registry state.
- Chat owns channel/thread hierarchy, composer, delivery state, and local/cloud/offline cues.
- Admin owns system-level controls and must not leak into normal route toolbars except as clearly secondary actions.

### 6. Require Real State Coverage In Generated Artifacts

- The final report should call out artifact gaps, not just design preferences. Services generated comps are missing, Chat actual capture is only a loading state, and generated set coverage is incomplete or not fully evidenced.
- Each target view needs comparable actual, Set 1, and Set 2 artifacts with the same baseline framing.
- Generated artifacts should include loaded, empty, loading, and failed states where those states materially affect layout.
- Prompt and metadata evidence should include source screenshot, prompt file, request ID, prompt hash, source hash, output hash, and validated output path.

## View-Specific Report Points

### Files

- Keep the improved row scan pattern, file-type icons, visible source tabs, dates, and row actions.
- Reduce persistent editor controls until a file is selected.
- Ensure search, primary source scope, advanced filters, row states, and bottom utility behavior are fully specified.

### Agents

- Organize around fleet overview first, selected-agent detail second, activity/output third.
- Keep the left rail as scan/select/filter navigation rather than a second dashboard.
- Show health, heartbeat freshness, runtime/host, active task, queue, recent warnings/errors, and output provenance.

### Tasks And Task Detail

- Improve board density and hierarchy for active, blocked, and completed work.
- Keep filters/search distinguishable with a clear reset path.
- Make task cards explicit enough for tags, output, and detail navigation without repeated button clutter.
- Reframe task detail from a long form into an execution view: state, evidence, output/docs links, logs, comments, dependencies, and edits should be grouped by workflow.

### Services

- Add missing generated artifacts for Services before treating the design pass as complete.
- Clarify health counters, severity colors, discovery source, last checked time, and empty/error states.
- Collapse duplicate plugin/admin entry points into one canonical registry pattern.
- Make service rows actionable: host, URL, status, details/logs, open/copy.

### Chat

- Treat the actual screenshot as a loading-state reference only.
- Require loaded channel/thread/composer states before making final visual conclusions.
- Keep route/status visible in the composer area and expose delivery, queued, failed, retry, local/cloud, and offline states accessibly.

### Admin

- Fix the semantic mismatch where metadata reports `Login` while the visible UI is the Admin control surface.
- Align admin controls with Services and Files conventions: source labels, enabled/disabled state, plugin health, action menus, and confirmation affordances.
- Keep dangerous or high-impact actions visibly distinct from routine refresh/configuration actions.

### Docs View

- Preserve the readable document column and strong contrast.
- Add long-document navigation: outline, heading anchors, deep-link support, or equivalent.
- Ensure breadcrumbs, share/audio/back controls, markdown stress cases, and code/table rendering are covered.

## Cross-View Acceptance Bar

- A user can identify the active route, selected object, health state, provenance, and next safe action within five seconds.
- Loading, empty, failed, and populated states are visually distinct for every route.
- Global shell, left rail, context bar, detail panel, and bottom drawer behave consistently across first-level routes.
- Icon-only controls have labels, hover states, focus states, and keyboard access.
- Links and actions indicate whether they open an internal route, external surface, diagnostics panel, copy action, or modal.
- Responsive layouts preserve status, source, timestamp, and primary action without hiding critical operational context.
- Visual validation covers actual, Set 1, and Set 2 artifacts, and fails on missing files, blank images, mismatched metadata paths, or duplicated/misrouted outputs.

## Suggested Final Report Structure

1. Product posture: local operational command surface.
2. Current artifact health and gaps.
3. Cross-view system recommendations.
4. View-by-view recommendations.
5. Required state matrix and acceptance checks.
6. Visual QA and prompt/API evidence requirements.
7. Priority implementation sequence.

## Priority Implementation Sequence

1. Lock the shell/navigation/context-bar system.
2. Define shared state/status/provenance components.
3. Repair artifact coverage gaps, especially Services and loaded Chat.
4. Apply view-specific density and hierarchy changes.
5. Run visual validation across actual, Set 1, and Set 2 with metadata integrity checks.
