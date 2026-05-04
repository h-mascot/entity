# Entity TTS Multi-Provider PRD
**Status**: In Progress (Phase 1 complete - admin panel expanded)
**Date**: 2026-04-26
**Updated**: 2026-04-27
**Owner**: Entity team

---

## Problem

1. **Limited provider options** - TTS only showed 3 providers in admin (browser, kokoro, openai) despite full backend support for 6
2. **TTS only works in docs view** - No global TTS control accessible from all app views
3. **Kokoro 404 on server** - Local Kokoro service not reachable through server proxy
4. **No voice selection UI** - Users can't pick voices for edge/deepgram/elevenlabs

---

## Goals

1. **Multi-provider support** - All 6 providers: browser, kokoro, edge, openai, deepgram, elevenlabs
2. **Voice selection per provider** - Dropdown or input for each provider's voice
3. **Playback speed control** - 0.5x to 2x
4. **Admin-configurable defaults** - Provider/voice defaults via admin panel
5. **Global TTS bar** - Always-visible TTS control at top of page, works from any view
6. **Graceful fallback** - If provider fails, user can switch

---

## Current State (as of 2026-04-27)

### Backend: `/api/tts/generate` and `/api/tts/voices`
- ✅ All 6 providers wired in `packages/server/src/routes/tts.ts`
- ✅ Voices catalog defined for all providers
- ⚠️ Server runs on port 3001 (not 3000); app's `runtime.apiBase` is empty so calls go to port 3000
- ⚠️ Kokoro service (127.0.0.1:8000) IS reachable from local Mac but 404 through server

### Frontend: MarkdownAudioControls component
- ✅ All 6 providers supported in `MarkdownAudioControls.tsx`
- ✅ Provider selector, voice selector, speed selector
- ✅ Compact and full modes
- ⚠️ Only works inside docs viewer (`/docs/*` route)

### Admin Panel
- ✅ Type `DocsTtsProvider` updated to all 6 providers
- ✅ Admin UI expanded: 6 provider buttons + voice inputs for all + playback speed
- ✅ Settings persisted in `localStorage` key `entity.docs.tts.settings.v1`

### Global TTS Bar
- ❌ Not implemented - TTS only accessible in docs view

---

## Architecture

### Provider Details

| Provider | API Type | Auth | Voice Source | Status |
|----------|----------|------|-------------|--------|
| browser | Web Speech API | None | Built-in | ✅ Working |
| kokoro | REST | None | Local at `localhost:8000` | ⚠️ 404 through server |
| edge | REST | None | Microsoft Edge TTS | ✅ Ready |
| openai | OpenAI API | `OPENAI_API_KEY` | OpenAI voices | ✅ Ready |
| deepgram | Deepgram API | `DEEPGRAM_API_KEY` | Deepgram aura voices | ✅ Ready |
| elevenlabs | ElevenLabs API | `ELEVENLABS_API_KEY` | ElevenLabs voice library | ✅ Ready |

### Voice Catalogs

**Kokoro** (10 voices):
- bf_alice, bf_emma, bf_isabelle, bf_nicole, bf_sky (F)
- bm_daniel, bm_federico, bm_george, bm_lewis, bm_matilda (M)

**Edge TTS** (7 voices):
- en-GB-SoniaNeural, en-GB-RyanNeural
- en-US-JennyNeural, en-US-GuyNeural, en-US-AriaNeural
- en-AU-NatashaNeural, en-NZ-MollyNeural

**OpenAI** (6 voices):
- alloy, echo, fable, onyx, nova, shimmer

**Deepgram** (8 aura voices):
- aura-angus-en, aura-asteria-en, aura-luna-en, aura-mances-*

**ElevenLabs** (library voices):
- Custom voice IDs from user's voice library

### Environment Variables

```bash
# Server-side (packages/server/.env)
KOKORO_TTS_BASE_URL=http://127.0.0.1:8000
KOKORO_TTS_DEFAULT_VOICE=bf_alice
OPENAI_API_KEY=***
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
EDGE_TTS_VOICE=en-GB-SoniaNeural
DEEPGRAM_API_KEY=***
DEEPGRAM_TTS_VOICE=aura-angus-en
ELEVENLABS_API_KEY=***
ELEVENLABS_TTS_VOICE=EXAVITc4tvU7xuL82wvV
```

### Data Storage

**localStorage** (`entity.docs.tts.settings.v1`):
```typescript
interface DocsTtsSettings {
  provider: 'browser' | 'kokoro' | 'edge' | 'openai' | 'deepgram' | 'elevenlabs';
  kokoroVoice: string;
  edgeVoice: string;
  openaiVoice: string;
  openaiModel: string;
  deepgramVoice: string;
  elevenlabsVoice: string;
  playbackRate: number;
}
```

---

## Implementation Phases

### Phase 1: Admin Panel Expansion (DONE 2026-04-27)
- [x] Update `DocsTtsProvider` type to all 6 providers
- [x] Expand admin TTS section: 6 provider buttons
- [x] Add voice inputs for edge, deepgram, elevenlabs
- [x] Add playback speed selector

### Phase 2: Server API Fix (TODO)
- [ ] Fix server routing: TTS endpoints on port 3001 not reachable from app on port 3000
- [ ] Options:
  - (A) Set `VITE_ENTITY_API_BASE=http://localhost:3001` in app env
  - (B) Merge server onto port 3000
  - (C) Add TTS routes to app's Express server (port 3000)
- [ ] Fix Kokoro 404: ensure `KOKORO_TTS_BASE_URL` is accessible through server proxy

### Phase 3: Global TTS Bar (TODO)
- [ ] Create `GlobalTtsBar` component - always visible at top of shell header
- [ ] Reuse `MarkdownAudioControls` logic but context-aware:
  - When file/doc is selected: use its content
  - When nothing selected: show "Select a file to listen"
- [ ] Place in `renderShellTopRows()` between logo and notifications
- [ ] Compact mode: `[🔊 Listen]` button that expands on click
- [ ] Persist last used provider/speed in settings

### Phase 4: Voice Catalog API (TODO)
- [ ] Frontend should fetch voice list from `GET /api/tts/voices?provider=xxx`
- [ ] Replace hardcoded voice hints with dynamic dropdowns
- [ ] Cache voice list per session

### Phase 5: Testing (TODO)
- [ ] Test each provider generates audio
- [ ] Verify Kokoro works through server proxy
- [ ] Verify Edge TTS (free, no API key needed)
- [ ] Test global bar from files/tasks/chat views

---

## UI Design

### Global TTS Bar (proposed)

```
[🔊 Listen ▼] [Voice: Alice (F) ▼] [Speed: 1x ▼] [▶ Play]
```

- Always visible in header, right of Entity logo
- Compact: single button with dropdown
- Click "Listen" → reads current content
- Click "Play" → replays last audio
- Falls back to browser TTS if server unavailable

### Admin TTS Section (done)

```
┌─────────────────────────────────────────────────────────────┐
│ TTS Provider                                                 │
│ Browser TTS | Kokoro | Edge TTS | OpenAI | Deepgram | ElevenLabs │
│                                                              │
│ Kokoro voice   │ Edge voice       │ OpenAI voice  │ Deepgram │
│ [bf_alice    ] │ [en-GB-Sonia..] │ [alloy      ] │ [aura-...] │
│                                                              │
│ ElevenLabs ID  │ OpenAI model    │ Playback speed            │
│ [EXAVIT...   ] │ [gpt-4o-mini..] │ [1x ▼]                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Backward Compatibility

- Existing `/api/docs/:root/*/tts` endpoints continue to work
- Default provider remains `browser` (Web Speech API)
- Settings stored in localStorage

---

## Out of Scope

- Server-side audio caching
- Custom voice cloning
- Real-time streaming playback
- Video dubbing
- Per-user TTS settings (multi-user)
