# EDIS OpenRouter Approval Gate Remediation Report

Date: 2026-06-02
Issue: EDI-123
Repository: /home/mwillis/paperclip

## Result

Implemented and verified authoritative server-side approval verification for OpenRouter model routes.

The adapter execution boundary no longer trusts caller-supplied `ctx.config.modelRouteApproval`. OpenRouter execution is allowed only when Paperclip resolves a matching approved approval record through the server-side resolver before adapter execution.

## Root Cause

EDI-122 found that the OpenRouter route policy wrapper validated approval shape and matching route fields, but it read approval data from runtime adapter config. A caller able to influence adapter config could supply a syntactically valid `modelRouteApproval` object and bypass the intended recorded-operator-approval gate.

## Enforcement Change

The adapter registry now builds a normalized `ModelRouteCandidate` from execution context and adapter config, including company, actor, scope, run, route, usage category, requested profile, and optional `modelRouteApprovalId`.

Before adapter execution:

1. The registry calls an authoritative model-route approval resolver.
2. The resolver returns a `ModelRouteApproval` only when a trusted Paperclip approval record exists and matches the candidate.
3. `evaluateModelRoutePolicy()` receives only the server-resolved approval decision.
4. Caller-supplied `ctx.config.modelRouteApproval` is ignored by the adapter registry path.
5. Denials and approved OpenRouter routes still emit `model-route-policy:denied` / `model-route-policy:approved` metadata.

## Approval Source of Truth

The source of truth is the Paperclip `approvals` table, queried from `heartbeatService()` through `resolveAuthoritativeModelRouteApprovalRecord()`.

The accepted approval record must satisfy:

- same company ID as the execution candidate
- `type === "model_route"`
- `status === "approved"`
- non-empty `decidedByUserId`
- present `decidedAt`
- payload provider `openrouter`
- payload model, usage category, scope kind, and scope ID matching the candidate
- optional payload run ID matching the current run when present
- optional payload actor kind and actor ID matching the executing actor when present
- usable expiration timestamp, still enforced by the shared route-policy evaluator

## Fail-Closed Behavior

The route fails closed when:

- no approval resolver is installed
- no `modelRouteApprovalId` is provided
- approval lookup throws or the approval store is unavailable
- no matching approval record exists
- the approval has wrong company, type, status, operator decision metadata, provider, model, usage category, scope, run, or actor constraints
- the shared evaluator sees an expired or mismatched approval
- the route is provider:auto or an OpenRouter router/dynamic selector route

Pending, rejected, revoked, and cancelled approval records are rejected by the authoritative conversion path.

## Test Coverage

Added/verified coverage for:

- spoofed `ctx.config.modelRouteApproval` is blocked before adapter execution
- valid authoritative approval resolver allows OpenRouter execution
- unavailable approval resolver/lookup fails closed
- authoritative approval record conversion accepts only matching approved operator records
- pending, rejected, revoked, and cancelled approval records fail closed
- run ID, actor ID, and scope mismatches fail closed
- expired and mismatched approval fields fail closed in shared policy tests
- existing unapproved OpenRouter denial behavior remains intact
- existing local/Codex model profile behavior remains intact

## Validation Results

Command:

```sh
pnpm vitest run packages/shared/src/governance/model-route-policy.test.ts server/src/__tests__/adapter-registry.test.ts server/src/__tests__/heartbeat-model-profile.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Result:

```text
Test Files  3 passed (3)
Tests       49 passed (49)
```

Command:

```sh
pnpm -r --filter @paperclipai/shared --filter @paperclipai/server typecheck
```

Result:

```text
packages/shared typecheck: Done
server typecheck: Done
```

Note: the first typecheck attempt failed because a stale `node_modules/.cache/paperclip-plugin-build-deps.lock` directory caused `ensure-plugin-build-deps.mjs` to time out. No active build dependency process was found; removing the empty stale lock directory allowed the requested typecheck to pass.

## Remaining Risks

- Approval creation and UI/API flows for model-route approvals should continue to ensure only authorized board operators can approve records.
- External adapters with hidden nested route configuration still rely on normalized provider/model/base URL/env signal extraction unless they expose equivalent top-level fields.
- This remediation secures adapter execution authorization; it does not by itself create a full approval request lifecycle for every possible paid-provider route.
