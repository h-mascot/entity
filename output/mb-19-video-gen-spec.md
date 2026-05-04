# MB-19: Video Generation — Veo 3 Integration (Henry/Enterprise Crew)

**Created:** 2026-03-23  
**Owner:** Henry (Soteria / Enterprise Crew)  
**Priority:** P3 (after text + image systems)  
**Primary output path:** `~/clawd/output/videos/`

---

## 1) Mission Summary

Integrate **Veo 3** video generation into Henry’s existing content pipeline so the team can produce:

1. **Soteria demo videos** (product explainers / simulated workflow clips)
2. **Social content** (short narrative clips, hooks, announcement visuals)
3. **Presentation assets** (motion backgrounds, short insert clips)

This is intentionally a **lower-priority enablement layer** behind existing text/image content operations.

---

## 2) Audit First (What already exists)

### Existing video-adjacent capability found

- `~/.agents/skills/sora/SKILL.md`  
- `~/.agents/skills/sora/scripts/sora.py`  
- `~/.agents/skills/sora/references/video-api.md`  

This means there is already a complete **OpenAI Sora** workflow (generate/remix/list/download/delete).

### Existing video analysis capability found

- `~/clawd/output/video-analysis-skill.md`

This provides analysis/transcript-style support, not generation.

### No Veo 3 implementation found in current workspace

Search across `~/clawd`, `~/.openclaw`, memory files, scripts, and crontab showed no production Veo 3 generator script or Veo-specific cron/pipeline job.

---

## 3) Gaps Identified

1. **No Veo 3 API wrapper** in `~/clawd/scripts/`
2. **No credential bootstrap doc** for Google AI Studio Veo key
3. **No bridge** from image generation outputs → Veo image-to-video flows
4. **No standardized naming/metadata** for generated video assets in `~/clawd/output/videos/`

---

## 4) Implementation Added (this task)

### New script

- `~/clawd/scripts/veo3_generate.py`

Capabilities:
- Text-to-video request mode (`--prompt`)
- Optional image input (`--image`) for image-to-video style prompting
- Polls async operation until done
- Saves MP4 into `~/clawd/output/videos/`
- Deterministic timestamped naming
- JSON metadata sidecar (`.json`) per output

### Why this shape

- Mirrors existing “single-script CLI” pattern already used in other skills
- Keeps storage conventions explicit
- Lets content pipeline call it later as a subprocess without redesign

---

## 5) Setup Requirements (Google AI Studio)

Before first run:

1. Enable Veo access in Google AI Studio / Gemini API account
2. Set env var:
   - `GOOGLE_API_KEY` (or `GEMINI_API_KEY`)
3. Install Python package if needed:
   - `pip install google-genai`

---

## 6) Usage

```bash
# Text-to-video
python3 ~/clawd/scripts/veo3_generate.py \
  --prompt "Cinematic shot of an insurance operations team reviewing claims dashboards" \
  --seconds 8

# Image-to-video (seed frame)
python3 ~/clawd/scripts/veo3_generate.py \
  --prompt "Subtle camera push-in, parallax depth, premium enterprise visual style" \
  --image ~/clawd/output/images/soteria-hero.png \
  --seconds 8

# Explicit output basename
python3 ~/clawd/scripts/veo3_generate.py \
  --prompt "Animated product teaser for Soteria" \
  --out soteria-teaser-v1
```

Outputs:
- Video: `~/clawd/output/videos/<name>.mp4`
- Metadata: `~/clawd/output/videos/<name>.json`

---

## 7) Pipeline Integration Plan (next step, not required for P3)

1. Hook from content idea tracker (`08-content-tracker.csv`) to generate “video candidate” rows
2. Route approved row → image generation (if needed) → `veo3_generate.py`
3. Auto-write generated file path and prompt hash back to tracker
4. Optional: add social-specific preset prompts (`social-hook`, `demo-explainer`, `deck-loop`)

---

## 8) Risk / Constraints

- Veo quotas and account access may vary by region/account tier
- API model IDs may change over time; script exposes `--model` override
- Generation latency can be significant (async operation + polling)
- P3 priority retained: do not overinvest until text/image content cadence is stable

---

## 9) Definition of Done for MB-19 (incremental)

- [x] Existing capabilities audited (memory/skills/scripts/crontab/workspace)
- [x] Veo-oriented generation script scaffolded
- [x] Output storage standardized to `~/clawd/output/videos/`
- [x] Usage documented for text + image input flows
- [ ] Add tracker automation bridge
- [ ] Add preset prompt library for Soteria demos/social/deck assets
