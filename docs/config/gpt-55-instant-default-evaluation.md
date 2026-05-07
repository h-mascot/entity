# GPT-5.5 Instant default model evaluation

Status: recommended fallback default for Entity OpenClaw cron/builder sessions  
Model ID: `openai-codex/gpt-5.5`  
Display name: GPT-5.5 Instant  
Scope: Entity Ada/Main-style OpenClaw agents when live OpenClaw model policy is unavailable

## Decision

Entity should treat GPT-5.5 Instant (`openai-codex/gpt-5.5`) as the preferred default for cron and builder sessions that route through OpenClaw agent model policy.

## Implementation slice

The non-invasive evaluation slice is a fallback model-policy mapping in `packages/server/src/routes/chat-model-registry.ts`:

- It does **not** write production secrets.
- It does **not** override live OpenClaw config, CLI, or gateway-discovered model policy.
- It only applies when Entity cannot resolve configured models and falls back to its built-in Ada/OpenClaw policy.

## Verification

`packages/server/src/routes/chat-model-registry.test.ts` includes coverage that the fallback default resolves to `openai-codex/gpt-5.5` and is presented as GPT-5.5 Instant.

## Rollback

Move the previous fallback model back to the first entry in `FALLBACK_AGENT_MODELS.ada` or remove the GPT-5.5 Instant entry. No database or secret rollback is required.
