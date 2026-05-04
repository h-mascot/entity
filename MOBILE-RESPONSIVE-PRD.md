# Entity Mobile Responsive PRD

## Overview
Make Entity fully responsive for mobile (iPhone/iPad). Currently the app renders desktop layout on mobile with significant usability issues across all views.

## Current Issues (agent-browser audit @ 390x844 viewport)

### Global Issues
1. **No mobile navigation pattern** - Top nav tabs (Entity/Files/Agents/Tasks/Admin) are tiny touch targets
2. **Sidebar always visible** - Takes 256px on mobile, leaving almost no content area
3. **Keyboard shortcuts shown on mobile** - "⌘P quick switch" and "⌘E edit/preview" are irrelevant on touch devices
4. **No safe area handling** - Content overlaps with iOS status bar and home indicator
5. **Activity Stream toggle too small** - "Show"/"Hide" button barely visible at bottom
6. **Context bar (Editing/Interact Mode/Edit) shows on mobile** - Too many tiny buttons, not touch-friendly

### Files Tab
1. **Empty state wastes screen** - Full black screen with small centered icon
2. **File tree sidebar visible but takes too much width** - Should be full-screen overlay on mobile
3. **Editor controls (Editing dropdown, Interact Mode, Edit) crammed into tiny space**
4. **No file browser CTA** - No obvious way to browse/select files on mobile
5. **"No file selected" text barely visible**

### Tasks Tab (Kanban)
1. **4 columns forced into mobile width** - Columns ~25% each, content unreadable
2. **Cards severely truncated** - Titles cut off, descriptions illegible
3. **Filter dropdowns cramped** - Assignee/Priority/Search all on one line
4. **Task pills (Ada, P2, dates) under 44px touch target**
5. **Horizontal scroll required** - Poor mobile UX
6. **"Active Tasks" sidebar panel still shows** - Wastes space on mobile
7. **Ops/Strategic/Insights tabs too small for touch**

### Agents Tab
1. **"Currently editing" text wraps poorly on small screens**
2. **Agent dashboard cards not optimized for mobile stacking**
3. **Agent lane grid should be single column on mobile**
4. **Sidebar with agent list overlaps with main content**

### Admin Tab
1. **Duplicate navigation** - Both sidebar buttons AND top tabs for same sections
2. **Settings layout not mobile-optimized** - Could use full-width toggles
3. **Theme selector buttons too small**

## User Stories

### Story M1: Mobile Navigation Shell
**Priority: P0**

Replace top tab bar with mobile-friendly navigation on screens < 768px.

**Requirements:**
- Bottom tab bar with icons: 📁 Files, 🤖 Agents, ✅ Tasks, ⚙️ Admin
- Active tab highlighted with accent color
- Each tab icon minimum 44x44px touch target
- Current "Entity" title stays at top, simplified
- Hide desktop context bar (Editing/Interact Mode/Edit) on mobile
- Add hamburger menu (☰) for overflow actions

**Acceptance Criteria:**
- [ ] Bottom tab bar visible on mobile
- [ ] All tabs reachable with one tap
- [ ] Touch targets >= 44x44px
- [ ] Smooth tab switching animation
- [ ] Active tab visually distinct

### Story M2: Mobile Sidebar as Overlay
**Priority: P0**

Convert left sidebar from persistent panel to full-screen overlay on mobile.

**Requirements:**
- Sidebar hidden by default on mobile (< 768px)
- Hamburger button (☰) or swipe-right gesture opens sidebar as full-screen overlay
- Semi-transparent backdrop behind sidebar
- Tap backdrop or swipe-left to close
- File tree, agent list, active tasks all accessible in overlay
- Sidebar takes full width on mobile (not 256px)

**Acceptance Criteria:**
- [ ] Sidebar hidden by default on mobile
- [ ] Opens as full-screen overlay
- [ ] Close on backdrop tap
- [ ] Swipe to open/close
- [ ] Full-width on mobile

### Story M3: Mobile Kanban Board
**Priority: P0**

Redesign kanban board for mobile viewing.

**Requirements:**
- Single column view by default (stacked columns, not side-by-side)
- Column selector at top: Backlog | Todo | Doing | Review | Done
- Swipe left/right to switch columns
- Task cards full-width with readable text
- Pull-to-refresh for task reload
- Filter bar collapses to single filter icon (opens filter sheet)
- Search bar full-width
- "New task" button as floating action button (FAB) bottom-right
- Long-press card to drag-drop (or use move action in detail)

**Acceptance Criteria:**
- [ ] Single column view on mobile
- [ ] Column tabs/swipe navigation
- [ ] Cards readable (full title, description preview)
- [ ] Filter icon opens filter sheet
- [ ] FAB for new task
- [ ] Touch-friendly card interactions

### Story M4: Mobile Task Detail
**Priority: P1**

Full-screen task detail on mobile (not 2/3 overlay).

**Requirements:**
- Task detail opens as full-screen view (not side panel)
- Back button to return to board
- All fields editable with mobile-friendly inputs
- Activity log scrollable
- Comments section with mobile keyboard support
- Move task via dropdown (not drag-drop on mobile)
- Swipe between tasks

**Acceptance Criteria:**
- [ ] Full-screen task detail
- [ ] Back button navigation
- [ ] All fields editable
- [ ] Mobile-friendly form inputs
- [ ] Smooth transitions

### Story M5: Mobile File Editor
**Priority: P1**

Optimize file editing for mobile screens.

**Requirements:**
- File opens full-screen (no sidebar)
- Toolbar simplified: Save, Undo, Close
- CodeMirror touch-friendly (already supports touch)
- File path breadcrumb at top
- Hide keyboard shortcuts from empty state
- Replace "⌘P quick switch" with search icon
- Preview mode for markdown files (read-only, formatted)

**Acceptance Criteria:**
- [ ] Full-screen editor
- [ ] Simplified toolbar
- [ ] Touch-friendly editing
- [ ] Hide desktop shortcuts
- [ ] Markdown preview works

### Story M6: Mobile Agent Dashboard
**Priority: P1**

Stack agent lanes vertically and optimize for mobile.

**Requirements:**
- Agent lanes stack vertically (single column)
- Each agent card: avatar, name, status, current file (one line)
- Tap agent card to expand details (activity log)
- "Currently editing" shows truncated filename with full path on tap
- Pulsing green dot still visible
- Agent sidebar list uses horizontal scroll chips instead of vertical list

**Acceptance Criteria:**
- [ ] Vertical stacking of agent lanes
- [ ] Compact agent cards
- [ ] Tap to expand
- [ ] Readable on small screens

### Story M7: Mobile Activity Stream
**Priority: P1**

Optimize Activity Stream panel for mobile.

**Requirements:**
- Activity Stream as swipe-up sheet from bottom (not fixed panel)
- Drag handle at top of sheet
- Full-screen when fully expanded
- Compact entries (icon + agent + action on one line)
- Time stamps abbreviated (2m, 1h, etc.)
- Tap entry to see full details
- Pull-down to collapse

**Acceptance Criteria:**
- [ ] Bottom sheet pattern
- [ ] Drag to expand/collapse
- [ ] Compact entry format
- [ ] Readable on mobile

### Story M8: Mobile Notifications
**Priority: P2**

Optimize notification toasts and history for mobile.

**Requirements:**
- Toasts full-width on mobile (not fixed 22rem)
- Notification history panel as full-screen sheet
- Bell icon in top bar still visible
- Swipe to dismiss toasts
- Toast appears at top of screen (not bottom-right)

**Acceptance Criteria:**
- [ ] Full-width toasts
- [ ] Full-screen notification history
- [ ] Swipe to dismiss
- [ ] Top placement on mobile

### Story M9: Mobile Admin Panel
**Priority: P2**

Simplify admin panel for mobile.

**Requirements:**
- Remove duplicate sidebar navigation (use only top tabs)
- Settings use full-width toggles
- Theme selector as horizontal scroll
- Single-column layout for all settings
- Touch-friendly form elements (larger toggles, dropdowns)

**Acceptance Criteria:**
- [ ] No duplicate navigation
- [ ] Full-width controls
- [ ] Touch-friendly forms
- [ ] Single column layout

### Story M10: Safe Areas & PWA Support
**Priority: P2**

Handle iOS safe areas and add PWA manifest.

**Requirements:**
- `viewport-fit=cover` meta tag
- CSS `env(safe-area-inset-*)` for top/bottom padding
- PWA manifest.json with icons
- `apple-mobile-web-app-capable` meta tag
- Theme color matches app background
- Splash screen

**Acceptance Criteria:**
- [ ] No content behind notch/home indicator
- [ ] Installable as PWA
- [ ] Proper splash screen
- [ ] Theme color set

## Technical Approach

### CSS Breakpoints
```css
/* Mobile first */
@media (min-width: 768px) { /* Tablet */ }
@media (min-width: 1024px) { /* Desktop */ }
```

### Key Tailwind Classes
- `md:hidden` / `md:flex` for show/hide at breakpoints
- `touch-manipulation` for faster tap response
- `min-h-[44px] min-w-[44px]` for touch targets

### Existing Mobile Support
- `useIsMobile()` hook already exists
- Some `lg:flex` / `lg:hidden` classes already in place
- Mobile tab state (`mobileTab`) exists but needs expansion

### Files to Modify
- `packages/app/src/App.tsx` - Main layout, navigation
- `packages/app/src/index.css` - Responsive styles
- `packages/app/src/components/mission-control/MCOpsView.tsx` - Kanban
- `packages/app/src/components/mission-control/MCTaskCard.tsx` - Task detail
- `packages/app/src/components/ActivityStream.tsx` - Bottom sheet
- `packages/app/src/components/Toast.tsx` - Mobile toasts
- `packages/app/src/components/AgentsSidebarTab.tsx` - Agent cards
- `packages/app/index.html` - Meta tags, PWA manifest

## Priority Order
1. **M1 + M2** (P0) - Navigation + Sidebar → app becomes usable
2. **M3 + M4** (P0/P1) - Kanban + Task Detail → core workflow works
3. **M5 + M6 + M7** (P1) - Editor + Agents + Activity → full experience
4. **M8 + M9 + M10** (P2) - Polish → production-ready mobile
