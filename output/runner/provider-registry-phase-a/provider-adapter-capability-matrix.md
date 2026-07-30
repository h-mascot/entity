# PR-A-06 — Provider Adapter & Capability Matrix

**Issue:** THE-738 / PR-A-06  
**Proof type:** Adapter matrix  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## Scope note

Two different “provider” concepts exist in Entity:

1. **Inference / Task Master LLM providers** (`packages/server/src/agent/settings.ts`) — in scope for Provider Registry.
2. **Swarm execution providers** (`packages/server/src/swarm/providers/*`: eforge, codex, symphony, flywheel, ccp, acp) — **out of scope** for this packet (execution-engine registry deferred).

## Inference adapter matrix (Task Master / Doc Intelligence)

| Provider id | Current model IDs (`TASK_AGENT_PROVIDERS`) | SDK factory | Chat `generateText` | Provider-native tool-calling used by Task Agent? | Base URL | Env keys (names only) |
| --- | --- | --- | --- | --- | --- | --- |
| `google` | `gemini-3-flash-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash` | `@ai-sdk/google` | Yes | No | No | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `openai` | `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex` | `@ai-sdk/openai` | Yes | No | Optional | `OPENAI_API_KEY` |
| `openai-compatible` | `gpt-4o`, `gpt-4.1`, `gpt-4o-mini` (also accepts custom/Azure deployment ids) | `createOpenAI` + `api-key` header | Yes | No | Required for Azure/custom | `AZURE_OPENAI_API_KEY`, `OPENAI_API_KEY` |
| `anthropic` | `claude-opus-4.6`, `claude-sonnet-4.5`, `claude-haiku-4.5` | `@ai-sdk/anthropic` | Yes | No | No | `ANTHROPIC_API_KEY` |
| `xai` | `grok-4.3`, `grok-4.3-fast`, `grok-4.2` | `@ai-sdk/xai` | Yes | No | No | `XAI_API_KEY` |
| `vercel-gateway` | `openai/gpt-5.5`, `openai/gpt-5.4`, `anthropic/claude-opus-4.6`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-pro`, `xai/grok-4.3` | `@ai-sdk/gateway` | Yes | No | Gateway-managed | `AI_GATEWAY_API_KEY`, `VERCEL_AI_GATEWAY_API_KEY` |

Note: `TaskAgentTools` are **application-side** helpers (DB/task mutations), not model tool-calls. Source: `packages/server/src/agent/settings.ts` `TASK_AGENT_PROVIDERS` @ `a87a6fd`.

## Packet-listed provider-kind support classifications (SuperSpec §13.1 / OQ-006)

This table is the Phase A support classification for every packet-listed inference provider kind. It is intentionally stricter than the current implementation table above: unsupported or partially-supported kinds must not be presented as operational in Admin until the listed adapter/health strategy exists.

| Provider kind | Storable status in registry | Adapter availability at `a87a6fd` | Task Master compatibility | Docs compatibility | Health-test strategy | Phase B/C classification |
| --- | --- | --- | --- | --- | --- | --- |
| `google` | Storable via profile + env/secret ref | Existing `@ai-sdk/google` factory in `TASK_AGENT_PROVIDERS` | Supported for chat | Supported through inherited Task Agent binding | Lightweight `generateText` smoke against configured model; redacted errors | Operational after profile/binding migration |
| `openai` | Storable via profile + env/secret ref | Existing `@ai-sdk/openai` factory | Supported for chat | Supported through inherited Task Agent binding | Lightweight `generateText` smoke; redacted errors | Operational after profile/binding migration |
| `azure-openai` | Storable only with endpoint/deployment/base URL fields | No distinct adapter; currently collapsed into OpenAI-compatible/custom base URL behavior | Audit-only / partial until explicit Azure adapter DTO exists | Audit-only / partial | Azure-specific endpoint/deployment validation + smoke; redacted errors | Do not expose as fully operational until explicit adapter + tests exist |
| `openai-compatible` | Storable with custom base URL + model ids | Existing `createOpenAI` path can support generic compatible endpoints | Supported with SSRF/base-URL constraints | Supported through inherited Task Agent binding | URL allowlist/SSRF checks + chat smoke | Operational only after SSRF policy + redacted error envelope |
| `anthropic` | Storable via profile + env/secret ref | Existing `@ai-sdk/anthropic` factory | Supported for chat | Supported through inherited Task Agent binding | Lightweight `generateText` smoke; redacted errors | Operational after profile/binding migration |
| `xai` | Storable via profile + env/secret ref | Existing `@ai-sdk/xai` factory | Supported for chat | Supported through inherited Task Agent binding | Lightweight `generateText` smoke; redacted errors | Operational after profile/binding migration |
| `vercel-gateway` | Storable via gateway token + model ids | Existing `@ai-sdk/gateway` factory | Supported for chat | Supported through inherited Task Agent binding | Gateway model-list or chat smoke; redacted errors | Operational after profile/binding migration |
| `local-openai-compatible` | Storable with local endpoint + model ids | No distinct local adapter; can reuse OpenAI-compatible only after local-network policy | Audit-only / partial | Audit-only / partial | Local endpoint reachability + chat smoke; explicit localhost/private-IP exception | Do not expose as operational until local endpoint policy + adapter tests exist |

Required Admin behavior: show unsupported/partial kinds as unavailable, experimental, or blocked with an audit reason; never silently treat Azure/local endpoints as generic `openai-compatible` without their endpoint validation and health-test policy.

## Consumer capability needs (audit)

| Consumer | Actual usage | Declared / required capability for registry |
| --- | --- | --- |
| Task Master (`TaskAgent.invokeModel`) | `generateText` **without** AI SDK `tools` option; app-side `TaskAgentTools` are deterministic helpers outside the model request | **`chat` only** (text generation). Do **not** require provider-native tool-calling capability. |
| Task comment `@mention` responder (`agent/comment-responder.ts`) | `generateText` via `getTaskAgentLanguageModel()` | **`chat`** |
| Document comment responder (`agent/document-comment-responder.ts`) | `generateText` via `getTaskAgentLanguageModel()` | **`chat`** |
| Doc Intelligence ask | `generateText` only | **`chat`** |
| Embeddings / rerank | Not via Task Agent settings | N/A |

## Gaps vs unified Provider Registry (SuperSpec)

| Gap | Current state |
| --- | --- |
| Profile entity | Missing — single global settings blob |
| Capability allowlists per profile | Missing |
| Health-test persistence | Missing for the current canonical inference-provider settings path, but sandbox lineage already contains `provider_health_samples` and `provider_recovery_receipts` with recorded samples. Phase B must decide whether to reuse/migrate those tables or keep them explicitly separate; do not create a competing provider-health history by accident. |
| Adapter registry abstraction | Inline `if/else` in `getTaskAgentLanguageModel` |
| Secret reference types | Raw DB string or env only |
| SSRF policy for custom base URL | Scheme-only (`http`/`https`) |
| Separate Docs binding | Missing — inherits Task Master |

## Swarm providers (explicitly not Phase A implement)

Health endpoints exist under `/api/swarm/providers/:name/health` etc. Do not conflate with inference registry Admin UI.

## Acceptance

- [x] Adapter matrix produced
- [x] Capability gaps recorded for OQ-006/007/008

## Usage / health update seam

`getTaskAgentLanguageModel()` is a resolver/factory, not the actual model invocation boundary. Registry usage (`last_used_at`, success/failure, latency, provider error class) should be recorded around the actual `generateText` calls in each consumer or via a shared wrapper used by those consumers. Required consumers: Task Master, task comment responder, document comment responder, and Doc Intelligence ask. This prevents both over-counting resolution and missing provider failures.
