# PRD: Docs Viewer Voice/TTS Settings

Status: Draft PRD  
Owner: Entity / Docs Viewer  
Date: 2026-04-26  
Source request: Henry — voice feature in docs viewer is failing; use Kokoro on Enterprise; add Admin settings for provider, voice, and speed.

## 1. Problem

The docs viewer has a visible **Listen** feature, but it currently fails in the UI.

Verified failure:
- Route tested in browser: `/docs/output/ideas/2026-04-25-physical-ai-runtime-market-map-prd-lite.md`
- Clicking **Listen** shows: `Failed to generate TTS for document. fetch failed`
- Browser/API trace: `/api/docs/output/ideas/2026-04-25-physical-ai-runtime-market-map-prd-lite.md/tts` returns `500`
- Response body: `{"error":"Failed to generate TTS for document.","detail":"fetch failed"}`

Current implementation:
- Frontend: `packages/app/src/components/MarkdownAudioControls.tsx`
- Server: `packages/server/src/routes/docs.ts`
- Server hardcodes:
  - base URL: `KOKORO_TTS_BASE_URL || http://127.0.0.1:8000`
  - voice: `KOKORO_TTS_DEFAULT_VOICE || bf_alice`
  - route: `POST ${baseUrl}/tts/generate` with `{ text, voice }`
- UI has only one button and no provider, voice, or speed control.

Operational finding:
- Enterprise has a Kokoro LaunchAgent: `com.kokoro-voice-server`
- It is currently unhealthy/exited (`launchctl list` shows status `78`)
- Enterprise port `8000` accepts a connection but resets on `/`, so it is not a working Kokoro API surface right now
- LaunchAgent points to `/Users/enterprise/Services/kokoro-voice-server/start_server.sh`; another service copy exists at `/Users/enterprise/Enterprise Home/Services/kokoro-voice-server`

## 2. Goal

Make docs viewer voice reliable and configurable:
1. Kokoro should work as the default local provider on Enterprise.
2. Admin can choose the active TTS provider.
3. Admin can choose the voice for that provider.
4. Docs viewer can adjust playback speed.
5. UI failure states should say what failed and where, not just `fetch failed`.

## 3. Non-goals for v1

- No full audio library/history.
- No per-document saved voice yet.
- No billing dashboard.
- No multi-speaker narration.
- No automatic language detection beyond provider defaults.
- No client-side storage of paid-provider API keys unless explicitly marked local-only and unsafe-for-shared-browsers.

## 4. Users / Jobs

### Henry / operator
- Wants to open any generated doc and listen while working.
- Wants to switch between local/free and premium TTS providers without code edits.
- Wants speed control for faster review.

### Agent/operator admin
- Needs one place in Admin to verify provider health, select provider, select voice, and test voice.
- Needs safe defaults so the feature works after deploy without secret hunting.

## 5. UX Requirements

### 5.1 Docs viewer controls
Add a compact voice control strip above the document body:
- Primary button: `Listen` / `Generating...` / `Regenerate`
- Provider chip: e.g. `Kokoro · bf_alice`
- Voice select, if provider supports voice selection
- Speed select:
  - `0.75x`, `1x`, `1.25x`, `1.5x`, `1.75x`, `2x`
- Existing `<audio controls>` remains for generated audio providers.
- For browser-native speech, show pause/stop controls instead of audio element if no audio URL exists.

Error UX:
- Show provider-specific error:
  - `Kokoro unavailable at http://127.0.0.1:8000`
  - `OpenAI TTS key missing`
  - `Deepgram returned 401`
- Include a link/button: `Open TTS settings`.

### 5.2 Admin settings
Add Admin → **Voice / TTS** settings.

Minimum fields:
- Provider select:
  - `local-kokoro`
  - `edge-tts`
  - `browser`
  - `openai`
  - `deepgram`
  - `elevenlabs`
- Base URL for local providers:
  - Kokoro default: `http://127.0.0.1:8000` from server perspective, configurable
- Voice select per provider
- Default speed
- Max characters per request
- Test text input
- `Test voice` button
- Provider health indicator

Admin should persist settings server-side, not only localStorage, because Entity is an operator/admin surface and the docs server needs provider credentials/base URLs.

## 6. Provider Requirements

### 6.1 Local Kokoro
Default provider.

Expected normalized contract:
```http
POST /api/tts/generate
{
  "provider": "local-kokoro",
  "text": "...",
  "voice": "bf_alice",
  "speed": 1.0
}
```

Entity server then calls Kokoro.

Support both likely Kokoro API shapes during integration:
1. Existing current assumption: `POST {baseUrl}/tts/generate` → `{ audio_url }`
2. OpenAI-compatible Kokoro style: `POST {baseUrl}/v1/audio/speech` → binary audio

The adapter should detect/configure the mode instead of hardcoding one forever.

### 6.2 Browser
Uses `window.speechSynthesis` directly.
- No server call.
- Voice list comes from `speechSynthesis.getVoices()`.
- Speed maps to `SpeechSynthesisUtterance.rate`.
- Good fallback when servers are down.

### 6.3 Edge TTS
Two possible implementation paths:
- Server-side adapter using `edge-tts` package/CLI and returning generated audio URL.
- Browser/native speech where Edge-specific voices are only available if present in browser voice list.

PRD recommendation: implement Edge TTS server-side only if we have a maintained package path in the Entity runtime. Otherwise treat it as a later adapter and use browser voices for v1 fallback.

### 6.4 OpenAI
Server-side adapter.
- Credentials must remain server-side.
- Config fields:
  - API key secret reference / env var name, not raw key in UI by default
  - model: default `gpt-4o-mini-tts` or configured current audio model
  - voice
- Returns binary audio stored under Entity generated-audio path or streamed to client.

### 6.5 Deepgram
Server-side adapter.
- Credentials server-side.
- Voice/model selection from configured known list.
- Return generated audio URL.

### 6.6 ElevenLabs
Server-side adapter.
- Credentials server-side.
- Voice ID support, not just voice display names.
- Optional voice list fetch if API key present.

## 7. Backend Design

### 7.1 New settings model
Create persistent TTS settings, preferably in plugin settings or a small `app_settings` table.

Recommended shape:
```json
{
  "provider": "local-kokoro",
  "defaultSpeed": 1.0,
  "maxChars": 3800,
  "providers": {
    "local-kokoro": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:8000",
      "apiMode": "auto",
      "voice": "bf_alice"
    },
    "browser": { "enabled": true, "voice": "system-default" },
    "edge-tts": { "enabled": false, "voice": "en-US-AriaNeural" },
    "openai": { "enabled": false, "apiKeyEnv": "OPENAI_API_KEY", "model": "gpt-4o-mini-tts", "voice": "alloy" },
    "deepgram": { "enabled": false, "apiKeyEnv": "DEEPGRAM_API_KEY", "voice": "aura-2-luna-en" },
    "elevenlabs": { "enabled": false, "apiKeyEnv": "ELEVENLABS_API_KEY", "voiceId": "" }
  }
}
```

Do not store raw paid-provider keys in plain frontend localStorage.

### 7.2 API endpoints
Add a dedicated TTS route module instead of growing `routes/docs.ts` forever.

Required endpoints:
- `GET /api/tts/settings`
- `PATCH /api/tts/settings`
- `GET /api/tts/providers`
- `GET /api/tts/providers/:provider/voices`
- `POST /api/tts/test`
- `POST /api/docs/:root/*/tts`

Docs route request parameters:
```json
{
  "provider": "optional override",
  "voice": "optional override",
  "speed": 1.25
}
```

Response for generated-audio providers:
```json
{
  "status": "ok",
  "provider": "local-kokoro",
  "voice": "bf_alice",
  "speed": 1.25,
  "audioUrl": "/generated-audio/abc.wav",
  "chars": 2500,
  "truncated": false
}
```

Response for browser provider:
```json
{
  "status": "client_speech",
  "provider": "browser",
  "text": "sanitized text...",
  "voice": "system-default",
  "speed": 1.25,
  "chars": 2500,
  "truncated": false
}
```

### 7.3 Generated audio storage
Use an Entity-owned generated audio directory and serve static files safely.

Requirements:
- deterministic or UUID filenames
- extension whitelist: `.mp3`, `.wav`, `.ogg`, `.m4a`
- cleanup policy later; v1 can leave files but should isolate path

## 8. Frontend Design

### 8.1 Component changes
`MarkdownAudioControls.tsx` should:
- Load TTS settings once.
- Allow local override for provider/voice/speed on the doc page.
- Send provider/voice/speed to server for generated-audio providers.
- Use `speechSynthesis` for browser mode.
- Set `audioRef.current.playbackRate = speed` for `<audio>` playback.
- Preserve the selected speed in localStorage as a user preference.

### 8.2 Admin UI
Add a `Voice / TTS` admin section or card under Integrations.

The settings UI should include:
- active provider select
- provider-specific config fields
- voice selector
- default speed selector
- health/test panel
- warning when paid provider is selected but secret is missing

## 9. Kokoro Enterprise Fix Requirements

Before feature work is marked complete:
- Identify the real Kokoro service path.
- Fix LaunchAgent path drift if needed.
- Confirm Kokoro responds to its expected API from the same network namespace as Entity server.
- Set Entity TTS base URL accordingly.
- Browser-test Listen end-to-end.

Current likely issue:
- LaunchAgent and service copies exist in both:
  - `/Users/enterprise/Services/kokoro-voice-server`
  - `/Users/enterprise/Enterprise Home/Services/kokoro-voice-server`
- Port `8000` is present through OrbStack but root request resets.
- Current Entity server fetch to `http://127.0.0.1:8000/tts/generate` fails.

## 10. Acceptance Criteria

### MVP acceptance
- Kokoro health is green in Admin.
- A doc page can generate and play audio using Kokoro.
- Voice can be changed from Admin and affects the next generated audio.
- Speed can be changed in docs viewer and affects playback.
- Browser fallback works without server TTS.
- UI error message identifies provider and upstream.
- Agent-browser test covers the real rendered docs page.

### Provider acceptance
- OpenAI, Deepgram, ElevenLabs are implemented as server-side adapters with credentials kept server-side.
- Provider settings can be saved in Admin.
- Voice lists are either fetched live or populated from safe static defaults with manual override.

## 11. Test Plan

Automated:
- Unit tests for markdown text cleanup.
- Unit tests for provider adapter selection.
- Unit tests for missing credentials / provider unavailable errors.
- API tests for `/api/tts/settings`, `/api/tts/test`, `/api/docs/:root/*/tts`.
- Frontend component tests for speed control and provider display.

Manual / browser:
- Open docs viewer in agent browser.
- Click Listen with Kokoro selected.
- Confirm no `Failed to generate` message.
- Confirm audio control appears.
- Change speed to `1.5x`; confirm audio element `playbackRate === 1.5`.
- Switch provider to browser; confirm speech starts without server call.
- Disable/stop Kokoro; confirm error says Kokoro unavailable with base URL.

## 12. Rollout Plan

Phase 1 — repair current Kokoro path:
- Fix Kokoro service and current docs route.
- Improve error message.
- Add speed selector.

Phase 2 — Admin settings:
- Persist active provider, Kokoro URL, voice, speed.
- Add health/test button.

Phase 3 — provider adapters:
- Browser fallback first.
- OpenAI/Deepgram/ElevenLabs server adapters after secret handling is clear.
- Edge TTS only after package/runtime path is confirmed.

## 13. Grill Me

### Critique 1: This can become feature soup.
True. Six providers, voices, speed, Admin, Kokoro repair, and credential handling is too much for one blind implementation pass.

Correction: ship in phases. Phase 1 is Kokoro + speed + better errors. Browser fallback is the only additional provider needed for resilience. Paid providers come after the settings/secret model is clean.

### Critique 2: Storing API keys in Admin UI is risky.
Correct. The earlier idea of localStorage keys is not acceptable for shared/operator machines.

Correction: Admin should reference env var names or server-side secret handles. If raw key entry is ever added, it must be write-only/masked and persisted server-side with explicit risk labeling.

### Critique 3: The PRD assumes Kokoro endpoint shape without proof.
Current code assumes `/tts/generate`, but the service may be OpenAI-compatible or differently wrapped.

Correction: implementation must probe/read the Kokoro service API before final wiring. Adapter should support configured `apiMode`: `legacy-generate`, `openai-compatible`, or `auto`.

### Critique 4: Browser TTS is not the same as Edge TTS.
Correct. Browser `speechSynthesis` voice availability depends on OS/browser and may not expose Edge neural voices.

Correction: separate `browser` from `edge-tts`. Browser is the cheap fallback. Edge TTS should only be marked done if a real server-side Edge TTS adapter is implemented and tested.

### Critique 5: Speed control may not work uniformly.
Correct. `<audio>.playbackRate` works for generated audio, while browser speech uses utterance rate and may clamp differently.

Correction: acceptance should verify both generated audio speed and browser speech speed separately, with provider-specific limits surfaced in UI.

### Critique 6: Admin settings location could be wrong.
Maybe. There is already a Plugin Admin panel, but it mostly shows JSON. There is also an Integrations admin area. TTS is both a media service and docs-viewer feature.

Correction: v1 can place it under Admin → Integrations as `Voice / TTS`, then later promote to plugin settings if Entity plugin admin gets typed forms.

## 14. Recommendation

Do not start with all paid providers.

Recommended build order:
1. Fix Kokoro service and current docs route.
2. Add visible speed control in docs viewer.
3. Add Admin → Voice/TTS for Kokoro URL, voice, speed, test.
4. Add browser fallback.
5. Add provider adapter interface.
6. Add OpenAI, Deepgram, ElevenLabs one by one with server-side secret handling.

This gets Henry working audio fastest without building a tiny AWS console for robot bedtime stories. Useful. Slightly cursed. Manageable.
