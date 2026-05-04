# 05 Chat Review

## Actual Capture
- Source reviewed: `actual/05-chat.png` plus `metadata/visual-validation-all.json`.
- Capture is valid at 1440x1000, but it only shows the global shell with `Loading chat...`; the loaded chat surface, channel sidebar, thread panel, and composer are not visible.
- Metadata shows the Chat capture has the smallest visual complexity in the actual set: 18,744 bytes, 26 color buckets, luminance range 155. Treat this as a loading-state artifact, not a full UI reference.
- Generated Chat concepts for Set 1 and Set 2 are missing in metadata, so acceptance should verify against the actual app behavior and the final produced concepts.

## Recommendations

### Empty And Loaded States
- Keep the current centered loading text, but make it feel intentional: add a compact skeleton for left channels, message column, and composer so users understand the layout before data arrives.
- Empty channel state should stay quiet and operational: show channel name, description, assigned agents, and one clear first action in the message area. Avoid a large decorative empty-state card.
- Loaded state should prioritize scan density: channel header, grouped messages, timestamp/model badges, thread affordance, typing indicator, and composer should all fit without forcing excessive vertical travel.
- Error state should differentiate unavailable server, no channels, and offline/local-only fallback; those are different recovery paths.

### Channel And Thread Hierarchy
- Preserve the three-level mental model: category -> channel -> thread. The redesign should make that hierarchy visible even when no messages are loaded.
- Channel rows need stable affordances for unread count, assigned agent avatars/initials, and active state. Current right-click management is too hidden for a primary collaboration surface; expose edit/agent controls on hover or via a small menu.
- Thread panel should read as a secondary context pane, not a competing full chat. Keep parent message, reply count, and close action anchored at the top.
- On mobile, sidebar and thread drawer should not stack ambiguously. Only one overlay should be open at a time, with a clear back/close control.

### Input Area
- Composer should remain visually pinned and include: route/status label, agent picker, model picker, multiline draft, and send button.
- The selected delivery path should be readable before send: cloud model, local model, auto-routing, or offline queue. Do not bury this only inside a select option.
- Disabled and sending states need stronger feedback than opacity alone: pending label, queued indicator, and retry affordance for failed sends.
- Thread replies should use the same composer pattern in compact form, with placeholder text that confirms the reply target.

### Local, Cloud, And Offline Cues
- Use consistent status language across composer, messages, and global shell: `Online - Cloud`, `Local - Ollama`, `Offline - Queued`, and `Error`.
- Message badges should distinguish model identity from transport state. Example: `Opus` plus `Cloud`, or `qwen2.5-coder` plus `Local`.
- The current top-right blue dot is too ambiguous for chat reliability. Pair the dot with an accessible label or tooltip, and make offline/local fallback visible inside Chat.
- Queued local/offline messages should be visibly different from sent cloud messages, especially after reconnect when sync is pending.

## Acceptance Checks

### Set 1
- Empty/loading: Chat concept includes a recognizable channel sidebar skeleton or empty channel state, not only centered text.
- Loaded: At least one channel, grouped message history, model/transport badges, typing state, and pinned composer are visible at desktop width.
- Hierarchy: Category, channel, and thread affordances are all visible; opening a thread creates a right-side panel without obscuring the main composer.
- Input: Agent picker, model picker, delivery status, multiline draft, disabled empty-send state, and sending/queued state are represented.
- Local/cloud/offline: Concept shows separate treatments for cloud online, local fallback, and offline queued messages.

### Set 2
- Empty/loading: Uses the same information architecture as Set 1 but can vary visual density; no marketing-style hero or oversized empty-state panel.
- Loaded: Main chat remains scan-first at 1440x1000, with messages, thread count/action, and composer all above the fold.
- Hierarchy: Collapsed sidebar and mobile overlay states have clear active channel and close/back controls.
- Input: Compact thread composer keeps route/status visible and does not collapse agent/model choice into hidden-only controls.
- Local/cloud/offline: Status labels are accessible without relying on color alone; queued and failed messages have clear retry/recovery affordances.
