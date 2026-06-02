# EDIS OpenRouter Approval Gate Enforcement Report

Date: 2026-06-02
Issue: EDI-121 — Implement OpenRouter Approval Gate Enforcement

## Architecture Summary

Phase 4 enforcement is implemented at the Paperclip adapter registry boundary, before adapter execution begins.

The enforcement path is:

1. Heartbeat resolves an adapter and calls `adapter.execute()` with the effective runtime config.
2. `server/src/adapters/registry.ts` wraps built-in and external adapters with `withModelRoutePolicy()`.
3. The wrapper builds a `ModelRouteCandidate` from the run context, agent identity, issue scope, provider/model/base URL/env-key signals, usage category, requested model profile, and optional approval metadata.
4. The wrapper calls `evaluateModelRoutePolicy()` from `packages/shared/src/governance/model-route-policy.ts`.
5. If the decision is denied, Paperclip emits a `model-route-policy:denied` adapter meta event and throws before invoking the underlying adapter.
6. If the route is approved and normalized to OpenRouter, Paperclip emits a `model-route-policy:approved` adapter meta event and then calls the adapter.
7. Existing heartbeat meta handling persists those events as `adapter.invoke` run events, preserving traceability without adding a new database table.

This keeps enforcement close to the actual execution boundary and covers built-in adapters, external adapter plugins, and external `hermes_local` overrides loaded through the adapter manager.

## Governance Review

Existing implementation reviewed:

- Policy data: `packages/shared/src/governance/model-route-policy.ts`
- Policy tests: `packages/shared/src/governance/model-route-policy.test.ts`
- Report-only audit integration: `server/src/routes/agents.ts` and `server/src/routes/issues.ts`
- Runtime adapter invocation path: `server/src/services/heartbeat.ts`
- Adapter registry and plugin wrapping: `server/src/adapters/registry.ts`
- Adapter registry validation tests: `server/src/__tests__/adapter-registry.test.ts`

Remaining enforcement gap closed:

- Previous phases could identify and report OpenRouter route violations, but runtime adapter execution was still possible if an effective config selected OpenRouter.
- The new wrapper prevents execution before a paid OpenRouter adapter invocation can start.

## Approval Decision Flow

Approved local/default route:

- Provider is not OpenRouter.
- `provider:auto` is not present.
- Result: allowed without approval.
- Example: `openai-codex` + `gpt-5.5` primary route.

Denied automatic routing:

- Provider is `auto` or `provider:auto`.
- Result: denied with `policy_provider_auto_disallowed`.
- Reason: automatic provider selection can silently drift into paid cloud providers.

Denied OpenRouter dynamic/router model:

- Provider/base URL/env signals indicate OpenRouter and model is `auto`, `provider:auto`, includes `/auto`, or includes router-style dynamic selection.
- Result: denied with `policy_openrouter_router_disallowed`.

Denied non-allowlisted OpenRouter model:

- Provider/base URL/env signals indicate OpenRouter, but model is not in the EDIS allowlist.
- Result: denied with `policy_model_not_allowlisted`.
- This explicitly blocks the previous uncontrolled `openrouter` + `openai/gpt-5.5` spending path.

Denied allowlisted OpenRouter model without approval:

- Model is allowlisted, but no valid `modelRouteApproval` is present.
- Result: denied with `policy_openrouter_approval_required`.

Approved OpenRouter route:

- Model is allowlisted.
- Approval provider, model, usage category, scope kind, scope id, and expiration match the candidate.
- Approval has not expired.
- Result: allowed and recorded with the approval id.

## Runtime Enforcement Behavior

Runtime enforcement now applies to:

- Built-in adapters registered by `registerBuiltInAdapters()`.
- External adapters registered through `registerServerAdapter()`.
- External plugin adapters normalized through `resolveExternalAdapterRegistration()`.
- Built-in and external `hermes_local` adapters, while preserving the existing Paperclip local JWT injection wrapper.

Denial behavior:

- Emits `model-route-policy:denied` metadata with:
  - event: `denied`
  - allowed: `false`
  - violation code
  - denial reason
  - redacted route signals
  - run id
  - candidate route context
- Throws `decision.reason` before calling the underlying adapter.
- Prevents silent fallback to paid OpenRouter providers.

Approval behavior:

- Emits `model-route-policy:approved` metadata with:
  - event: `approved`
  - allowed: `true`
  - approval id
  - normalized provider/model
  - run id
  - candidate route context
- Calls the underlying adapter only after the policy decision is allowed.

Hermes local runtime behavior:

- Existing `PAPERCLIP_API_KEY` injection remains in place for `hermes_local`.
- `PAPERCLIP_RUN_ID` injection remains in place.
- Existing explicit `PAPERCLIP_API_KEY` values are preserved.
- The auth guard prompt is only prepended when a custom prompt template already exists, preserving Hermes' built-in task prompt otherwise.

## Validation Results

Commands run:

```sh
pnpm vitest run packages/shared/src/governance/model-route-policy.test.ts server/src/__tests__/adapter-registry.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Result:

- 2 test files passed.
- 38 tests passed.
- Covered shared policy decisions and adapter registry runtime enforcement.

```sh
pnpm -r --filter @paperclipai/shared --filter @paperclipai/server typecheck
```

Result:

- `@paperclipai/shared` typecheck passed.
- `@paperclipai/server` typecheck passed.

Important validation cases:

- Non-OpenRouter primary Codex route is allowed.
- `provider:auto` is denied.
- OpenRouter router/dynamic model ids are denied.
- Non-allowlisted OpenRouter models are denied.
- `openrouter` + `openai/gpt-5.5` is denied.
- Allowlisted OpenRouter model without approval is denied before adapter execution.
- Allowlisted OpenRouter model with matching approval is allowed and records approval metadata.
- Built-in and external `hermes_local` auth injection behavior remains intact.

## Operational Guidance

To request an approved OpenRouter execution path, an adapter config must include explicit route metadata:

```json
{
  "provider": "openrouter",
  "model": "openai/gpt-4.1-mini",
  "modelRouteUsageCategory": "coding_fallback",
  "modelRouteApproval": {
    "id": "approval-id",
    "provider": "openrouter",
    "model": "openai/gpt-4.1-mini",
    "usageCategory": "coding_fallback",
    "scopeKind": "issue",
    "scopeId": "issue-id",
    "expiresAt": "2999-01-01T00:00:00.000Z"
  }
}
```

Approval must match the actual run scope. For issue execution, scope should normally be:

- `scopeKind`: `issue`
- `scopeId`: the Paperclip issue id

If approval state is missing, malformed, expired, scoped to the wrong issue/agent, or mismatched on provider/model/usage category, the run fails closed before paid provider execution.

## Remaining Future Enhancements

Recommended next enhancements:

1. Add a first-class board approval workflow for model-route approvals instead of relying on config-carried approval metadata.
2. Add UI surfaces for pending/approved/denied model-route decisions.
3. Add optional company policy settings for approval TTL, allowed usage categories, and allowed model tiers.
4. Add budget-usage snapshots to `evaluateModelRoutePolicy()` so `policy_openrouter_budget_exceeded` is enforced from live budget state.
5. Add issue-thread interaction cards for model-route approval requests.
6. Add documentation for external adapter authors describing the `modelRouteApproval` contract.

## Conclusion

Phase 4 enforcement is now active at the adapter execution boundary. Paid OpenRouter routes cannot execute unless they are allowlisted and carry matching approval metadata. Denials and approved executions are auditable through adapter meta events, existing local/Codex routes continue operating normally, and the previous uncontrolled OpenRouter GPT-5.5 spending path is explicitly denied.
