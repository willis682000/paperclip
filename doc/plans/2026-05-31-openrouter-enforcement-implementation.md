# OpenRouter Enforcement Implementation Plan

Issue: EDI-96 — Create OpenRouter Enforcement Implementation Plan
Generated: 2026-05-31

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task. This plan is intentionally implementation-focused and does not change live provider, Hermes, Paperclip, OpenRouter, EDIE/OpenClaw, n8n, systemd, or credential configuration.

Goal: Convert the EDI-94 OpenRouter allowlist policy and EDI-95 enforcement design into a controlled, phased Paperclip/Hermes implementation roadmap.

Architecture: Implement enforcement in layers. Paperclip is the primary policy decision and audit point for persistent autonomous configuration, issue overrides, and runtime launch. Shared TypeScript policy code classifies provider/model routes and evaluates approvals. Hermes and adapter/runtime checks provide defense-in-depth before any provider call or local adapter execution can reach OpenRouter.

Tech Stack: TypeScript, Express, Drizzle/PostgreSQL, React/Vite, Vitest, Paperclip adapter APIs, Hermes Agent configuration/runtime validation.

Source inputs reviewed:
- `doc/edis-openrouter-allowlist-cost-control-policy.md`
- `doc/edis-openrouter-allowlist-enforcement-design.md`
- `doc/GOAL.md`
- `doc/PRODUCT.md`
- `doc/SPEC-implementation.md`
- `doc/DEVELOPING.md`
- `doc/DATABASE.md`
- `server/src/routes/agents.ts`
- `server/src/routes/issues.ts`
- `server/src/services/heartbeat.ts`
- `packages/adapter-utils/src/billing.ts`
- `packages/db/src/schema/agents.ts`
- `packages/db/src/schema/issues.ts`
- `packages/db/src/schema/approvals.ts`
- `packages/shared/src/validators/issue.ts`

Implementation recommendation: Multiple phases, not one release. Phases 1-3 may ship together behind report-only or deny-only switches if tests pass, but approval records, budget counters, UI, Hermes defense-in-depth, and n8n/EDIE controls should be separate follow-up releases. This avoids introducing broad execution-path risk while still closing the highest-risk bypasses first.

## Current Status After Phase 3

Verified: 2026-05-31 21:30 UTC

Restoration source:
- Restored this plan from `stash@{1}^3:doc/plans/2026-05-31-openrouter-enforcement-implementation.md`.
- The restored file path is `doc/plans/2026-05-31-openrouter-enforcement-implementation.md`.

Completed implementation checkpoints:
- Phase 1 is complete in commit `e48cc2a6` (`Add OpenRouter model route policy data`).
- Phase 2 is complete in commit `e52c90c1` (`Implement OpenRouter route policy evaluator`) and checkpoint tag `edis-openrouter-phase2-complete`.
- Phase 3 is complete in commit `029d3a8f` (`Integrate OpenRouter route audit reporting`) and checkpoint tag `edis-openrouter-phase3-complete`.

Current code evidence for Phase 3:
- `packages/shared/src/governance/model-route-policy.ts` exports `auditModelRouteCandidateReportOnly()`.
- `server/src/routes/agents.ts` records report-only model-route audit findings on agent create/update without blocking saves.
- `server/src/routes/issues.ts` records report-only model-route audit findings on issue assignee adapter override updates without blocking saves.
- Tests cover report-only warnings in `server/src/__tests__/agent-adapter-validation-routes.test.ts` and `server/src/__tests__/issue-activity-events-routes.test.ts`.

Phase 4 classification:
- Phase 4 is an approval-gate / hard-denial phase for persistent agent create/update saves.
- It is not report-only and not merely warning-only.
- It should reject structurally prohibited routes such as `provider:auto` or OpenRouter router selectors with `422` and reject unapproved OpenRouter routes with `403`.
- It does not implement runtime launch hard-stop enforcement; that is Phase 6.

Phase 4 readiness recommendation:
- Phase 4 is safe to plan next, but should not proceed until the operator explicitly approves moving from report-only audit to save-time enforcement.
- Implement Phase 4 narrowly against `server/src/routes/agents.ts` first, with targeted tests proving normal `codex_local` / `openai-codex` saves still work and denied payloads do not leak secrets.
- Do not change Hermes runtime configuration, add OpenRouter credentials, restart services, or implement runtime launch gates as part of Phase 4.

---

## Phase 0 — Baseline and Scope Freeze

Objective: Establish the current compliant baseline and prevent implementation drift before code changes begin.

Files:
- Read: `doc/edis-openrouter-allowlist-cost-control-policy.md`
- Read: `doc/edis-openrouter-allowlist-enforcement-design.md`
- Read: `/home/mwillis/.hermes/config.yaml` during local EDIS validation only
- No code changes

Steps:
1. Confirm Hermes baseline remains:
   - `model.provider: openai-codex`
   - `model.name` / `model.default: gpt-5.5`
   - `fallback_providers: []`
   - no OpenRouter auxiliary provider
2. Confirm Paperclip EDI agent config has no `OPENROUTER_API_KEY`, OpenRouter base URL, or `provider:auto` marker.
3. Confirm the initial implementation does not add OpenRouter credentials or provider overrides.
4. Freeze the initial allowlist from EDI-94 as policy data, but mark all OpenRouter entries as approval-required until Matthew records standing approval.

Verification:
- Read-only audit output shows current EDIS route is compliant.
- No config, credential, service, or database mutation occurs in this phase.

Rollback:
- Not applicable; phase is read-only.

Acceptance criteria:
- Baseline documented.
- No OpenRouter route is enabled by the implementation work itself.

---

## Phase 1 — Shared Policy Types and Static Policy Data

Objective: Add deterministic shared types and policy data without enforcing anything yet.

Files:
- Create: `packages/shared/src/governance/model-route-policy.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/governance/model-route-policy.test.ts`

Implementation outline:

1. Define route candidate and decision types:

```ts
export type ModelRouteActorKind = "agent" | "user" | "workflow" | "cron" | "system";
export type ModelRouteScopeKind = "agent" | "issue" | "project" | "workflow" | "cron" | "manual" | "runtime";
export type ModelRouteUsageCategory =
  | "primary"
  | "cheap_docs"
  | "emergency_backup"
  | "coding_fallback"
  | "premium_manual"
  | "unknown";

export interface ModelRouteCandidate {
  companyId: string;
  actorKind: ModelRouteActorKind;
  actorId?: string | null;
  scopeKind: ModelRouteScopeKind;
  scopeId?: string | null;
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  envKeysPresent?: string[];
  adapterType?: string | null;
  adapterConfigPath?: string | null;
  usageCategory?: ModelRouteUsageCategory | null;
  requestedModelProfile?: string | null;
  approvalId?: string | null;
}

export type ModelRouteViolationCode =
  | "policy_provider_auto_disallowed"
  | "policy_openrouter_approval_required"
  | "policy_model_not_allowlisted"
  | "policy_openrouter_router_disallowed"
  | "policy_openrouter_budget_exceeded"
  | "policy_openrouter_approval_expired"
  | "policy_openrouter_scope_mismatch";

export type ModelRoutePolicyDecision =
  | {
      allowed: true;
      normalizedProvider: string;
      normalizedModel: string | null;
      approvalId?: string | null;
      warnings?: string[];
    }
  | {
      allowed: false;
      violationCode: ModelRouteViolationCode;
      reason: string;
      requiredApprovalFields?: string[];
      redactedSignals?: string[];
    };
```

2. Encode the initial policy constants from EDI-94:
   - default provider: `openai-codex`
   - default model: `gpt-5.5`
   - `providerAutoAllowed: false`
   - OpenRouter default: denied unless approval exists
   - blocked patterns: `auto`, `router`, `provider:auto`
   - initial allowed model records:
     - `google/gemini-2.5-flash-lite`
     - `openai/gpt-4.1-nano`
     - `qwen/qwen3-30b-a3b`
     - `mistralai/mistral-small-3.2-24b-instruct`
     - `meta-llama/llama-3.3-70b-instruct`
     - `google/gemini-2.5-flash`
     - `deepseek/deepseek-chat-v3-0324`
     - `qwen/qwen3-235b-a22b`
     - `openai/gpt-4.1-mini`
   - keep `standingApproval: false` for each model until the operator approves otherwise.

3. Export from `packages/shared/src/index.ts`.

Tests:
- Static policy includes exact model IDs only.
- Policy has no `provider:auto` allowance.
- Policy marks OpenRouter default as denied.
- No policy constant contains a secret-like value.

Commands:
- `pnpm --filter @paperclipai/shared test -- model-route-policy`
- If no package-local test script exists, run: `pnpm test:run -- --run packages/shared/src/governance/model-route-policy.test.ts`

Rollback:
- Remove `packages/shared/src/governance/model-route-policy.ts`.
- Remove its export from `packages/shared/src/index.ts`.
- Remove the test file.

Acceptance criteria:
- Shared package compiles.
- Static policy is available to server code.
- No runtime enforcement exists yet.

---

## Phase 2 — Route Classifier and Evaluator

Objective: Add the deny-by-default evaluator that recognizes OpenRouter and `provider:auto` route signals.

Files:
- Modify: `packages/shared/src/governance/model-route-policy.ts`
- Test: `packages/shared/src/governance/model-route-policy.test.ts`
- Consider later extraction if server-only details grow: `server/src/services/model-route-policy.ts`

Implementation outline:

1. Add normalization helpers:

```ts
export function normalizeProvider(value: unknown): string | null;
export function normalizeModel(value: unknown): string | null;
export function isProviderAuto(value: unknown): boolean;
export function isOpenRouterBaseUrl(value: unknown): boolean;
export function isOpenRouterModelRouter(model: string | null): boolean;
export function collectRouteSignals(input: unknown, path?: string): ModelRouteCandidate[];
```

2. Classify OpenRouter-like signals from:
   - `provider: "openrouter"`
   - `provider: "auto"` or `provider:auto`
   - `model` values containing router/auto selectors
   - `baseUrl`, `apiBase`, `apiBaseUrl`, `openaiBaseUrl`, `OPENAI_BASE_URL`, `OPENAI_API_BASE`, or `OPENAI_API_BASE_URL` pointing to `openrouter.ai`
   - `OPENROUTER_API_KEY` key presence in `env`, secret refs, or env bindings
   - nested adapter config fields including `extraArgs`, `modelName`, `model`, `provider`, and `env`

3. Add evaluator:

```ts
export function evaluateModelRoutePolicy(input: {
  candidate: ModelRouteCandidate;
  policy?: ModelRoutePolicy;
  approval?: ModelRouteApproval | null;
  usage?: ModelRouteUsageSnapshot | null;
}): ModelRoutePolicyDecision;
```

4. Deny rules:
   - deny `provider:auto` always for autonomous scopes
   - deny OpenRouter routers/dynamic selectors always
   - deny OpenRouter if no exact model is present
   - deny OpenRouter model not in allowlist
   - deny allowlisted OpenRouter model without valid approval
   - deny expired, revoked, scope-mismatched, or budget-exhausted approval
   - allow non-OpenRouter/non-auto routes with a warning only if classification is unknown but no OpenRouter-like marker is present

Tests:
- Detect `OPENROUTER_API_KEY` without exposing value.
- Detect OpenRouter through `OPENAI_BASE_URL=https://openrouter.ai/api/v1`.
- Detect nested `runtimeConfig.modelProfiles.cheap.adapterConfig.env.OPENROUTER_API_KEY`.
- Reject `provider:auto`.
- Reject model strings containing `auto` or router-like names.
- Reject allowlisted OpenRouter model with no approval.
- Reject unknown OpenRouter model with approval.
- Accept default `openai-codex` / `gpt-5.5` route.
- Accept allowlisted OpenRouter model only with valid matching approval.

Commands:
- `pnpm test:run -- --run packages/shared/src/governance/model-route-policy.test.ts`
- `pnpm -r typecheck`

Rollback:
- Revert changes to policy file and tests.

Acceptance criteria:
- Evaluator is deterministic, pure, test-covered, and secret-safe.
- No server route uses it for denial yet.

---

## Phase 3 — Read-Only Audit Script and Server Audit Service

Objective: Create visibility before enforcement so the operator can see all possible OpenRouter routes.

Files:
- Create: `server/src/services/model-route-audit.ts`
- Create: `server/src/__tests__/model-route-audit.test.ts`
- Create: `scripts/audit-model-routes.ts`
- Modify: `package.json` scripts if a stable command is desired, for example `audit:model-routes`

Implementation outline:

1. Audit Paperclip persisted surfaces:
   - `agents.adapterConfig`
   - `agents.runtimeConfig.modelProfiles.*.adapterConfig`
   - `issues.assigneeAdapterOverrides`
   - `issues.executionPolicy`
   - `heartbeat_runs.contextSnapshot` model profile/provider metadata where available
   - `projects.env`
   - `routines.env`
   - company secrets metadata names/refs only, never values

2. Use the shared classifier to emit findings:

```ts
export interface ModelRouteAuditFinding {
  companyId: string;
  entityType: "agent" | "issue" | "project" | "routine" | "heartbeat_run" | "secret";
  entityId: string;
  path: string;
  severity: "info" | "warning" | "high" | "critical";
  violationCode?: ModelRouteViolationCode;
  message: string;
  redactedSignals: string[];
}
```

3. Script behavior:
   - default read-only
   - require `--company-id` for targeted audit, or support `--all-companies`
   - never print secret values
   - exit `0` for no findings, `2` for policy findings, `1` for script/runtime errors

4. Optional server route in a later step, not required for first CLI audit:
   - `GET /api/companies/:companyId/model-route-audit`
   - board-only/config-read permission

Commands:
- `pnpm exec tsx scripts/audit-model-routes.ts --company-id 3c35da5a-58fd-4f95-9a4e-789d924c247b`
- `pnpm test:run -- --run server/src/__tests__/model-route-audit.test.ts`

Rollback:
- Remove audit script and audit service.
- Remove script entry from `package.json` if added.

Acceptance criteria:
- Current EDIS baseline audits clean or reports only known documented non-enforcing references.
- Findings redact secret values.
- Audit can be run before enforcement gates are enabled.

---

## Phase 4 — Paperclip Agent Save Gates

Objective: Stop persistent agent-level provider drift at create/update time.

Files:
- Modify: `server/src/routes/agents.ts`
  - Around `normalizeMediatedAdapterConfigForPersistence()` lines 918-935.
  - Around `normalizeRuntimeConfigAdapterConfigsForPersistence()` lines 938-971.
  - Around agent create/update route handlers later in the same file.
- Create or extend tests: `server/src/__tests__/agent-model-route-policy.test.ts`
- Shared validators/types if API request/response shapes need policy details:
  - `packages/shared/src/validators/agent.ts`
  - `packages/shared/src/types/agent.ts`

Implementation outline:

1. Add a helper near existing adapter-config normalization:

```ts
async function assertAgentModelRoutePolicyAllowed(input: {
  req: Request;
  companyId: string;
  agentId?: string | null;
  adapterType: string | null | undefined;
  adapterConfig: Record<string, unknown>;
  path: string;
  usageCategory?: ModelRouteUsageCategory;
}) { /* classify, evaluate, throw 422/403 */ }
```

2. Apply it to:
   - primary `adapterConfig`
   - `adapterConfig.env`
   - `runtimeConfig.modelProfiles.*.adapterConfig`
   - adapter type changes where provider route semantics may change

3. HTTP behavior:
   - `422` for structurally prohibited routes such as `provider:auto` or router selectors
   - `403` for OpenRouter routes requiring approval
   - error body includes `violationCode`, `path`, and redacted signals only

4. Activity logging:
   - log denied attempts through existing activity log service with action such as `agent.model_route_policy_denied`
   - redact adapter config using existing `redactEventPayload()` patterns

Tests:
- Agent create rejects `adapterConfig.provider = "auto"`.
- Agent create rejects `adapterConfig.provider = "openrouter"` with no approval.
- Agent update rejects `adapterConfig.env.OPENROUTER_API_KEY` with no approval.
- Runtime profile update rejects `runtimeConfig.modelProfiles.cheap.adapterConfig.baseUrl = "https://openrouter.ai/api/v1"`.
- Error response does not include secret values.
- Normal `codex_local` / `openai-codex` configuration still saves.

Commands:
- `pnpm test:run -- --run server/src/__tests__/agent-model-route-policy.test.ts`
- `pnpm -r typecheck`

Rollback:
- Revert the gate helper and route calls.
- Leave shared evaluator and read-only audit in place if they are stable; they are non-invasive.

Acceptance criteria:
- Persistent agent config cannot introduce OpenRouter or `provider:auto` without a valid approval path.
- Existing non-OpenRouter agents remain editable.

---

## Phase 5 — Paperclip Issue Override Gates

Objective: Prevent issue-level overrides, child issue creation, monitor recovery, and recovery issue generation from broadening provider permissions.

Files:
- Modify: `server/src/routes/issues.ts`
  - Around `requestsCheapIssueAssigneeModelProfile()` lines 1462-1468.
  - Around `assertCheapRecoveryIssueAssigneeProfileAllowed()` lines 1488-1509.
  - Issue create and patch handlers in the same file.
  - Child/recovery/monitor issue creation paths that set `assigneeAdapterOverrides`.
- Modify if needed: `server/src/services/recovery/model-profile-hint.ts`
- Test: `server/src/__tests__/issue-model-route-policy.test.ts`
- Test: `server/src/__tests__/issue-monitor-scheduler.test.ts`

Implementation outline:

1. Add helper:

```ts
async function assertIssueAssigneeModelRoutePolicyAllowed(input: {
  req: Request;
  res: Response;
  issueId?: string | null;
  companyId: string;
  assigneeAgentId?: string | null;
  assigneeAdapterOverrides?: unknown;
  path: string;
}) { /* load agent base config, classify override, ensure it cannot broaden */ }
```

2. Enforce that issue overrides may:
   - select an already-approved bounded model profile
   - narrow or remove provider options
   - never add OpenRouter provider/base URL/env/model/router markers unless a valid approval exists and the agent profile is already authorized

3. Apply gate before persistence in:
   - issue create
   - issue patch
   - child issue creation
   - monitor/recovery issue creation
   - issue follow-up/resume paths if they write overrides

4. Preserve existing cheap status-only recovery guard and extend it rather than replacing it.

Tests:
- Issue create rejects `assigneeAdapterOverrides.adapterConfig.provider = "openrouter"`.
- Issue patch rejects `assigneeAdapterOverrides.adapterConfig.env.OPENROUTER_API_KEY`.
- Issue create rejects `assigneeAdapterOverrides.modelProfile = "cheap"` if the agent profile maps to OpenRouter without valid approval.
- Cheap status-only recovery still cannot assign downstream deliverable work to `cheap`.
- Child/recovery issue generation cannot inject a broader route than the source agent allows.

Commands:
- `pnpm test:run -- --run server/src/__tests__/issue-model-route-policy.test.ts`
- `pnpm test:run -- --run server/src/__tests__/issue-monitor-scheduler.test.ts`

Rollback:
- Revert the issue route gate and tests.
- Existing persisted issues remain unchanged; use read-only audit to find any problematic overrides.

Acceptance criteria:
- Issue overrides cannot bypass agent-level route policy.
- Recovery logic remains functional and clear when blocked by policy.

---

## Phase 6 — Runtime Launch Gate

Objective: Block disallowed routes immediately before adapter execution, after all config layers have been merged.

Files:
- Modify: `server/src/services/heartbeat.ts`
  - Route merge/config resolution area before line 7927 where `adapterEnv` is derived.
  - Immediate pre-invocation area before `getServerAdapter(agent.adapterType)` at line 7995 and `adapter.execute()` at lines 8032-8058.
- Create: `server/src/services/model-route-runtime.ts`
- Test: `server/src/__tests__/heartbeat-model-route-policy.test.ts`
- Possibly modify shared run/error types:
  - `packages/shared/src/types/heartbeat.ts`
  - `packages/shared/src/validators/heartbeat.ts`

Implementation outline:

1. Compute effective candidate from:
   - persisted agent adapter config
   - selected runtime model profile
   - issue `assigneeAdapterOverrides`
   - resolved secret/env key names
   - project/routine env overlays
   - execution workspace config
   - adapter metadata and `runtimeForAdapter`

2. Evaluate immediately before `adapter.execute()`.

3. If denied:
   - do not call `adapter.execute()`
   - append a run event such as `policy.model_route_denied`
   - mark run failed or blocked with a specific error code rather than generic `adapter_failed`
   - if an issue is attached, move it to `blocked` / needs-attention only where existing execution semantics allow
   - include `violationCode` and path, not secret values

4. Recommended error codes:
   - `policy_provider_disallowed`
   - `policy_model_not_allowlisted`
   - `policy_provider_auto_disallowed`
   - `policy_openrouter_approval_required`
   - `policy_openrouter_budget_exceeded`
   - `policy_openrouter_approval_expired`

Tests:
- Runtime launch does not invoke adapter when effective env contains `OPENROUTER_API_KEY` with no approval.
- Runtime launch does not invoke adapter when base URL points to OpenRouter.
- Runtime launch blocks `provider:auto` before adapter execution.
- Runtime launch records a policy event and non-secret diagnostic payload.
- Normal EDI route still invokes adapter.

Commands:
- `pnpm test:run -- --run server/src/__tests__/heartbeat-model-route-policy.test.ts`
- `pnpm test:run -- --run server/src/__tests__/environment-runtime.test.ts`

Rollback:
- Disable runtime gate with a temporary internal feature flag if needed.
- Revert `server/src/services/heartbeat.ts` changes if the gate incorrectly blocks non-OpenRouter routes.

Acceptance criteria:
- No disallowed OpenRouter route can start an adapter process.
- Policy failures are auditable and not mislabeled as adapter runtime crashes.

---

## Phase 7 — Durable Approval Records and Budget Counters

Objective: Replace comment-only approval with enforceable Paperclip state.

Files:
- Modify: `packages/db/src/schema/approvals.ts` if extending generic approvals is sufficient.
- Or create: `packages/db/src/schema/model_route_approvals.ts`
- Modify: `packages/db/src/schema/index.ts`
- Add migration via `pnpm db:generate`
- Create: `server/src/services/model-route-approvals.ts`
- Create routes: `server/src/routes/model-route-approvals.ts` or add under company governance routes.
- Modify: `server/src/index.ts` to mount new route if separate.
- Shared validators/types:
  - `packages/shared/src/validators/model-route-approval.ts`
  - `packages/shared/src/types/model-route-approval.ts`
- UI later in Phase 8.

Recommended table if not using generic `approvals.payload`:

```ts
model_route_approvals
- id uuid primary key
- company_id uuid not null references companies(id)
- provider text not null default 'openrouter'
- model_id text not null
- usage_category text not null
- scope_kind text not null
- scope_id text null
- reason text not null
- max_input_tokens integer null
- max_output_tokens integer null
- max_usd_cents integer null
- max_calls integer null
- used_input_tokens integer not null default 0
- used_output_tokens integer not null default 0
- used_usd_cents integer not null default 0
- used_calls integer not null default 0
- allowed_data_class text null
- rollback_action text null
- status text not null default 'active'
- created_by_user_id text null
- created_by_agent_id uuid null
- revoked_by_user_id text null
- created_at timestamptz not null
- expires_at timestamptz not null
- revoked_at timestamptz null
- updated_at timestamptz not null
```

Implementation details:
- All records company-scoped.
- Approvals default to expiring; no unbounded approval by default.
- Budget/call counter updates must be atomic.
- If counter update fails, fail closed.
- Approval must match provider, model, usage category, scope, and company.

Tests:
- Valid approval allows exact scoped route.
- Expired approval denies.
- Revoked approval denies.
- Approval scoped to issue A does not authorize issue B.
- Budget-exhausted approval denies.
- Counter update is atomic under concurrent run attempts.

Commands:
- `pnpm db:generate`
- `pnpm test:run -- --run server/src/__tests__/model-route-approvals.test.ts`
- `pnpm -r typecheck`

Rollback:
- Revoke approval records to immediately disable OpenRouter routes.
- If schema shipped and must be rolled back, add a down/compensating migration only after backup.
- Do not delete audit history unless explicitly approved.

Acceptance criteria:
- Enforcement no longer depends on comments alone.
- Approvals expire and budget counters fail closed.

---

## Phase 8 — Board UI and Operator Workflow

Objective: Let the board understand and manage policy decisions without raw JSON editing.

Files:
- Create: `ui/src/pages/ModelRouteGovernancePage.tsx` or integrate into existing company settings/governance page.
- Modify navigation/sidebar route definitions under `ui/src` where company settings/governance routes are registered.
- Create API client methods under existing UI API client files.
- Add component tests if UI test coverage exists for settings pages.

UI requirements:
- Read-only audit findings list.
- Approval creation form requiring:
  - exact model ID
  - usage category
  - scope kind and scope ID
  - reason
  - dollar/token/call caps
  - expiration
  - rollback action
- Approval revoke action.
- Clear warnings for `provider:auto`, router models, broad fallback chains, and OpenRouter base URLs.
- Never display secret values.

Tests:
- Form cannot submit without exact model ID.
- Expiration is required.
- Premium/manual category requires explicit manual approval language.
- Revoke action updates list.
- Secret-like findings are redacted.

Commands:
- `pnpm test:run -- --run ui/src/**/model-route*.test.tsx`
- `pnpm -r typecheck`

Rollback:
- Hide UI route while leaving API enforcement active.
- Operators can revoke approvals via API if UI is unavailable.

Acceptance criteria:
- Operator can approve, inspect, and revoke governed OpenRouter routes without editing raw database rows.

---

## Phase 9 — Adapter-Utils and Local Adapter Defense-in-Depth

Objective: Make OpenAI-compatible adapters enforce biller classification before provider invocation.

Files:
- Modify: `packages/adapter-utils/src/billing.ts`
- Modify: `packages/adapter-utils/src/index.ts`
- Test: `packages/adapter-utils/src/billing.test.ts`
- Modify adapter execute files as applicable:
  - `packages/adapters/codex-local/src/server/execute.ts`
  - `packages/adapters/cursor-local/src/server/execute.ts`
  - `packages/adapters/opencode-local/src/server/execute.ts`
  - any OpenAI-compatible external adapter contract docs

Implementation outline:

1. Extend billing inference into a safe route signal:

```ts
export type OpenAiCompatibleRouteSignal = {
  biller: "openai" | "openrouter" | "unknown";
  signals: string[];
  redactedEnvKeys: string[];
};

export function classifyOpenAiCompatibleRoute(env: NodeJS.ProcessEnv | Record<string, string | undefined>): OpenAiCompatibleRouteSignal;
```

2. In local adapters, emit classification metadata before invocation.
3. If Paperclip runtime passes a policy denial instruction, adapters fail closed.
4. Do not make adapter-utils depend directly on server database state.

Tests:
- Existing `inferOpenAiCompatibleBiller()` behavior remains backward-compatible.
- New classifier detects OpenRouter key and OpenRouter base URL.
- No secret values are included in signals.
- Codex/cursor adapters pass biller metadata to Paperclip events.

Commands:
- `pnpm test:run -- --run packages/adapter-utils/src/billing.test.ts`
- `pnpm test:run -- --run packages/adapters/codex-local/**`

Rollback:
- Keep Paperclip runtime gate active.
- Revert adapter-level enforcement if it blocks legitimate non-OpenRouter adapters.

Acceptance criteria:
- Adapter metadata cannot silently hide OpenRouter biller classification.
- Paperclip remains the main enforcement point.

---

## Phase 10 — Hermes Defense-in-Depth

Objective: Add Hermes-side fail-closed validation before provider calls for EDIS profiles.

Files outside this Paperclip repo, if Hermes source is available:
- Hermes config validation area for `model.provider`, `model.name`, and fallback providers.
- Hermes provider selection / model call path.
- Hermes cron/delegation model override handling.

Paperclip-facing files:
- Document integration contract: `doc/edis-openrouter-enforcement-hermes-contract.md`
- Optional adapter contract metadata in external Hermes adapter package.

Hermes requirements:
- Validate effective route before any provider call.
- Deny `provider:auto` for EDIS autonomous profiles.
- Deny OpenRouter provider/model unless an approval token/context is present and valid.
- Validate `fallback_providers`, auxiliary providers, cron jobs, and subagent model overrides.
- Emit structured error metadata Paperclip can classify as policy-blocked.
- Never print secrets.

Hermes verification commands, adapted to actual Hermes checkout:
- `hermes config check`
- `hermes doctor`
- Targeted Hermes tests for provider selection and config validation.

Rollback:
- Disable Hermes EDIS enforcement feature flag only if Paperclip runtime gate remains active.
- Return Hermes baseline to `openai-codex` / `gpt-5.5` / `fallback_providers: []`.

Acceptance criteria:
- Hermes cannot be tricked into OpenRouter through config drift or model override when running under EDIS policy.

---

## Phase 11 — n8n and EDIE/OpenClaw Governance Boundary

Objective: Prevent adjacent systems from becoming ungoverned OpenRouter routers.

Files:
- Create: `doc/edis-openrouter-external-integration-governance.md`
- Optional future Paperclip plugin route registry files if implemented.

Required controls:
- No unmanaged OpenRouter keys in n8n credentials.
- No unmanaged OpenRouter keys in EDIE/OpenClaw plugins.
- Any workflow or connector that can call OpenRouter must be registered as a governed route.
- Workflows must use fixed model IDs and explicit budget caps.
- Paperclip audit should report n8n/EDIE route references where accessible, but not attempt unsafe credential extraction.

Verification:
- Read-only inventory of n8n credentials/workflows if API credentials are available.
- Read-only inventory of OpenClaw/EDIE plugin configuration if accessible.
- No secret values printed.

Rollback:
- Remove OpenRouter credentials from n8n/EDIE/OpenClaw.
- Disable workflows/connectors that cannot present fixed model/cap/scope metadata.

Acceptance criteria:
- External integration boundary is documented and auditable.
- EDIS has no ungoverned alternate OpenRouter execution path.

---

## Cross-Phase Testing Strategy

Targeted tests first:
- `pnpm test:run -- --run packages/shared/src/governance/model-route-policy.test.ts`
- `pnpm test:run -- --run server/src/__tests__/model-route-audit.test.ts`
- `pnpm test:run -- --run server/src/__tests__/agent-model-route-policy.test.ts`
- `pnpm test:run -- --run server/src/__tests__/issue-model-route-policy.test.ts`
- `pnpm test:run -- --run server/src/__tests__/heartbeat-model-route-policy.test.ts`
- `pnpm test:run -- --run packages/adapter-utils/src/billing.test.ts`

Integration checks:
- Run the read-only audit against EDIS company `3c35da5a-58fd-4f95-9a4e-789d924c247b`.
- Attempt dry-run or test payloads for agent config with OpenRouter provider and verify 403/422.
- Attempt issue override with OpenRouter base URL and verify 403/422.
- Attempt normal `openai-codex` route and verify no regression.

PR-ready checks:
- `pnpm -r typecheck`
- `pnpm test:run`
- `pnpm build`

Browser suites:
- Run `pnpm test:e2e` only if the approval UI/navigation or release smoke surfaces are modified.

Secret-safety checks:
- Ensure test fixtures use fake keys only.
- Ensure error bodies include key names and redacted signals, never values.
- Ensure activity log payloads use existing redaction helpers.

---

## Rollback Strategy Summary

Immediate operational rollback:
1. Revoke or expire OpenRouter approval records.
2. Remove issue-level `assigneeAdapterOverrides` that reference OpenRouter.
3. Remove `runtimeConfig.modelProfiles.*.adapterConfig` entries that route to OpenRouter.
4. Restore Hermes baseline:

```yaml
model:
  provider: openai-codex
  name: gpt-5.5
  default: gpt-5.5
fallback_providers: []
```

Code rollback by phase:
- Shared evaluator and audit can remain if enforcement causes issues; they are read-only unless wired into gates.
- Agent/issue save gates can be disabled/reverted independently.
- Runtime launch gate should have a temporary internal feature flag during rollout.
- UI can be hidden while API enforcement remains active.
- Hermes defense-in-depth should only be disabled if Paperclip runtime gate remains enabled.

Database rollback:
- Prefer revocation/status changes over deleting approval rows.
- Preserve audit history.
- If a table/schema rollback is required, create a compensating migration after a database backup.

---

## Compatibility and Risk Assessment

Risks:
- False positives may block legitimate OpenAI-compatible adapters if they use ambiguous provider/model fields.
- Runtime gate could convert a working agent path into blocked tasks if effective-route classification is too broad.
- Approval records add schema/API complexity and must stay company-scoped.
- External adapter plugins may not expose enough route metadata initially.
- n8n and EDIE/OpenClaw require separate governance because Paperclip cannot fully inspect them.
- UI approval workflows could accidentally imply standing approval unless expiration is mandatory.

Mitigations:
- Ship read-only audit before denial.
- Test normal Codex/OpenAI-Codex route at every phase.
- Deny only when `provider:auto` or OpenRouter-like markers are present; log unknown non-OpenRouter routes without blocking initially.
- Keep approvals scoped, expiring, and budget-capped.
- Redact all secrets using existing Paperclip redaction helpers.
- Make policy denial errors explicit and separate from `adapter_failed`.

Compatibility notes:
- Existing agents without OpenRouter/provider:auto markers should continue to work.
- Existing `cheap` model profile behavior must remain available only when it does not broaden provider permissions.
- External adapter plugin loading must remain dynamic; do not hardcode Hermes or other external adapter imports into core.
- OpenRouter enforcement must not force OpenRouter into the default Hermes/Paperclip runtime path.

---

## Acceptance Criteria by Phase

Phase 0:
- Baseline is confirmed read-only.

Phase 1:
- Shared policy constants and types compile and are exported.

Phase 2:
- Route classifier/evaluator catches provider:auto, OpenRouter keys, OpenRouter base URLs, routers, missing approvals, expired approvals, and scope mismatches.

Phase 3:
- Read-only audit reports policy findings without printing secrets.

Phase 4:
- Agent create/update cannot persist OpenRouter/provider:auto routes without approval.

Phase 5:
- Issue overrides cannot broaden provider permissions or bypass agent policy.

Phase 6:
- Runtime launch blocks disallowed routes before adapter execution.

Phase 7:
- Approval records are durable, scoped, expiring, and budget/call counted atomically.

Phase 8:
- Board can inspect audit findings and manage approvals through UI/API.

Phase 9:
- Adapter-utils and local adapters emit OpenRouter route signals as defense-in-depth.

Phase 10:
- Hermes validates effective provider/model/fallback/auxiliary/cron/delegation routes before provider calls.

Phase 11:
- n8n and EDIE/OpenClaw routes are governed or explicitly prohibited.

Final done definition:
- Paperclip, Hermes, adapters, and external integration boundaries cannot route autonomous EDIS work to non-allowlisted OpenRouter models, `provider:auto`, router selectors, broad fallback chains, environment-injected OpenRouter keys/base URLs, or expired/unscoped approvals.
- All denials are visible, auditable, company-scoped, and secret-safe.
