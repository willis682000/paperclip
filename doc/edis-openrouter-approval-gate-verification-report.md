# EDIS OpenRouter Approval Gate Enforcement Verification Report

Date: 2026-06-02
Issue: EDI-122
Related implementation issue: EDI-121
Repository: /home/mwillis/paperclip

## Assessment

Result: FAIL — enforcement is present at adapter execution boundaries, but approval trust is not authoritative enough for production readiness.

The implementation does block unapproved OpenRouter routes before adapter execution in the tested adapter path. It also blocks provider:auto and OpenRouter router/dynamic selector models through the shared policy evaluator. However, an approved route can currently be authorized by a `modelRouteApproval` object supplied in adapter runtime config. I did not find evidence that this approval object is loaded from, or verified against, an authoritative Paperclip approval record/table before execution.

That means a config path capable of supplying adapter config can spoof approval metadata and bypass the intended "recorded operator approval" gate. This violates the requirement that paid OpenRouter routes cannot execute without recorded approval and that approval state unavailability fail closed.

## Verification Scope

Reviewed changes in:

- `packages/shared/src/governance/model-route-policy.ts`
- `packages/shared/src/governance/model-route-policy.test.ts`
- `server/src/adapters/registry.ts`
- `server/src/__tests__/adapter-registry.test.ts`
- `server/src/services/heartbeat.ts`
- `server/src/services/recovery/model-profile-hint.ts`
- `server/src/services/recovery/service.ts`
- Related implementation report: `doc/edis-openrouter-approval-gate-enforcement-report.md`

## What Passes

### Runtime boundary enforcement exists

`server/src/adapters/registry.ts` wraps registered built-in and external adapters with `withModelRoutePolicy()`. The wrapper evaluates the model route policy before calling the original adapter `execute()` function.

Evidence:

- `registerBuiltInAdapters()` stores `withModelRoutePolicy(adapter)`.
- `registerServerAdapter()` stores `withModelRoutePolicy(withHermesLocalRuntimeAuth(adapter))`.
- `resolveExternalAdapterRegistration()` returns a policy-wrapped adapter.
- The negative-path test `blocks unapproved OpenRouter adapter routes before adapter execution` asserts the underlying adapter execute function is not called.

### provider:auto is blocked

The shared evaluator treats provider `auto` and `provider:auto` as `policy_provider_auto_disallowed`.

Evidence:

- `collectRouteSignals()` sets `isProviderAuto` for provider `auto` and `provider:auto`.
- `evaluateModelRoutePolicy()` fails closed before non-OpenRouter allow decisions when `isProviderAuto` is true.

### OpenRouter router/dynamic selector routes are blocked

The shared evaluator detects model values containing router/dynamic selector patterns and returns `policy_openrouter_router_disallowed` for OpenRouter routes.

Evidence:

- `collectRouteSignals()` detects `auto`, `provider:auto`, `/auto`, and `router` in normalized model IDs.
- `evaluateModelRoutePolicy()` denies those routes before allowlist/approval checks.

### Unapproved OpenRouter allowlist routes fail closed

OpenRouter models in the allowlist still require approval. Without approval, the adapter wrapper throws before execution.

Evidence:

- `evaluateModelRoutePolicy()` returns `policy_openrouter_approval_required` when approval validation fails.
- Adapter registry test confirms `openrouter/openai/gpt-4.1-mini` without approval throws `OpenRouter routes require recorded approval before use.` and the adapter execute mock is not called.

### Non-OpenRouter routes remain allowed

The shared evaluator allows non-OpenRouter routes with no approval requirement.

Evidence:

- `evaluateModelRoutePolicy()` returns allowed when route signals do not indicate OpenRouter and provider is not auto.

### Audit metadata is emitted

The adapter wrapper emits metadata before both denial and approved OpenRouter execution.

Evidence:

- Denial path emits `command: "model-route-policy:denied"` with violation code, reason, redacted signals, run ID, and candidate.
- Approved OpenRouter path emits `command: "model-route-policy:approved"` with approval ID, normalized provider/model, run ID, and candidate.
- Existing tests assert both metadata events are sent through `onMeta`.

## Findings / Remediation Required

### Finding 1 — Approval can be supplied by adapter config instead of authoritative Paperclip approval state

Severity: High

Current behavior:

- `withModelRoutePolicy()` calls `readModelRouteApproval(ctx.config?.modelRouteApproval)`.
- If that object has matching provider, model, usage category, scope, and a future expiration, `evaluateModelRoutePolicy()` allows the OpenRouter route.
- The approving test case builds this approval object directly inside runtime config.

Risk:

- A config writer can create a syntactically valid `modelRouteApproval` object and authorize paid OpenRouter usage without any separate operator approval record.
- The gate validates shape and matching fields, but not that the approval ID exists in Paperclip, was approved by an authorized operator, has not been revoked, and belongs to the run/company/scope.

Required remediation:

- Do not trust `ctx.config.modelRouteApproval` as the source of authority.
- Resolve approval state server-side from Paperclip approval storage before adapter execution.
- Pass only a server-verified approval decision into the evaluator, or have the registry wrapper call an injected approval verifier.
- Validate at minimum: company ID, approval ID, approval type/category, approved status, approver identity/authorization, provider, model, usage category, scope kind/id, expiration, and revocation/cancellation state.
- If lookup fails or approval state is unavailable, fail closed.

### Finding 2 — OpenRouter detection is strongest for `ctx.config`, weaker for hidden adapter-specific config paths

Severity: Medium

Current behavior:

- Runtime candidate extraction reads provider, model, base URL, and env keys from `ctx.config`.
- In normal heartbeat execution, `ctx.config` appears to be the resolved runtime adapter config, so this is likely sufficient for the primary path.
- However, adapter-specific nested configuration or plugin-defined alternate field names may not be visible unless normalized into these exact keys.

Risk:

- External adapters with custom config schemas could hide an OpenRouter route in nested provider/client settings that are not represented as top-level `provider`, `model`, `baseUrl`, `base_url`, `OPENAI_BASE_URL`, or `env.OPENROUTER_API_KEY`.

Recommended remediation:

- Require external adapters to expose a normalized model-route candidate or static config schema mapping.
- Add an optional `getModelRouteCandidate(config)` hook to `ServerAdapterModule` and use that before falling back to generic extraction.
- Add tests for nested adapter config and OpenRouter API base URL/environment detection.

## Functional Validation Performed

Command:

```sh
pnpm vitest run packages/shared/src/governance/model-route-policy.test.ts server/src/__tests__/adapter-registry.test.ts server/src/__tests__/heartbeat-model-profile.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Result:

```text
Test Files  3 passed (3)
Tests       44 passed (44)
```

Interpretation:

- Existing policy evaluator, adapter registry enforcement, auth propagation, and model-profile tests pass.
- These tests validate the intended deny/allow mechanics.
- They also reveal the approval trust weakness because the approved OpenRouter route test succeeds with approval data supplied in runtime config rather than an authoritative approval lookup.

## Requirement-by-Requirement Status

| Requirement | Status | Notes |
| --- | --- | --- |
| Review all code changes introduced by EDI-121 | Pass | Reviewed relevant shared, server, heartbeat, recovery, and test changes. |
| Confirm runtime enforcement exists at execution boundaries | Pass | Adapter registry wrappers enforce before adapter execute. |
| Confirm provider:auto is blocked when required | Pass | Shared evaluator denies provider:auto. |
| Confirm OpenRouter router/dynamic model routes are blocked | Pass | Shared evaluator denies router/dynamic selector model IDs. |
| Confirm unapproved paid routes fail closed | Pass | Unapproved allowlisted OpenRouter route denied before execution. |
| Confirm approved routes function correctly | Partial | Mechanically yes, but approval source is not authoritative. |
| Confirm audit events are generated | Pass | Denied/approved metadata events are emitted and tested. |
| Confirm no path exists that can bypass enforcement | Fail | Config-supplied approval object can spoof approval unless separately verified before runtime. |

## Production Readiness Decision

Not production-ready as a final governance control.

The policy evaluator and adapter boundary wrapper are a solid foundation and should remain. The missing piece is authoritative approval resolution. Until that is added, OpenRouter paid-route execution is blocked by default but can be enabled by local runtime config without proving that a real operator approval exists.

## Recommended Next Issue

Create a remediation issue:

Title: Enforce Authoritative Paperclip Approval Lookup for OpenRouter Model Routes

Acceptance criteria:

- Adapter runtime cannot approve OpenRouter use by supplying only `modelRouteApproval` config.
- Server resolves approval state from Paperclip approval records or a dedicated model-route-approval table.
- Expired, missing, revoked, mismatched, pending, rejected, or inaccessible approval records fail closed.
- Denial and approval metadata include approval source and verification result.
- Tests cover spoofed approval config, missing approval state, expired approval, scope mismatch, and valid approved operator record.
