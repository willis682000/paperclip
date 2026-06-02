# EDIS Hermes Runtime Secret Reference Resolution Report

## Issue

Paperclip Hermes runtime environment injection could receive unresolved secret-reference objects from `agent.adapterConfig.env`. When those objects reached the child process environment, Node coerced them to the literal string `[object Object]`, breaking integrations such as n8n runtime bindings.

## Root Cause

The affected path is:

1. Paperclip stores agent environment bindings in `agent.adapterConfig.env`.
2. Secret-reference values are represented as objects such as `{ type: "secret_ref", secretId, version }` until resolved.
3. Heartbeat runtime resolution produces a resolved runtime config at `ctx.config.env`.
4. The Hermes auth wrapper in `server/src/adapters/registry.ts` previously built Hermes environment data from the agent adapter config directly.
5. If a secret-reference object remained in `agent.adapterConfig.env`, it could be forwarded into Hermes instead of the resolved runtime value.

## Injection Path Reviewed

Relevant code:

- `server/src/services/heartbeat.ts`
  - `resolveExecutionRunAdapterConfig()` resolves adapter config and env bindings for runtime use.
  - `resolveAdapterConfigForRuntime()` resolves agent adapter config secret refs.
  - `resolveEnvBindings()` resolves project/routine env overlays.
  - Paperclip-owned `PAPERCLIP_*` env values are stripped before user-provided env resolution.

- `server/src/adapters/registry.ts`
  - `withHermesLocalRuntimeAuth()` normalizes Hermes context and injects `PAPERCLIP_API_KEY` and `PAPERCLIP_RUN_ID`.
  - The wrapper now builds the final Hermes env from the already-resolved runtime env first, then only accepts agent env values that are strings and not already present in the resolved runtime env.

## Resolution Logic

Implemented logic in `resolvedHermesRuntimeEnv()`:

- Treats `ctx.config.env` as the authoritative resolved runtime environment.
- Requires every runtime env value to be a string.
- Adds string values from `agent.adapterConfig.env` only when the runtime env did not already provide the same key.
- Fails closed if an unresolved non-string agent env value remains with no resolved runtime value.
- Fails closed if the runtime env itself contains any non-string value.
- Updates both `ctx.config.env` and `ctx.agent.adapterConfig.env` with the same final string-only environment before Hermes execution.

This prevents unresolved secret-reference objects from being reintroduced after heartbeat secret resolution.

## Security Considerations

- Secret values are not logged by the new wrapper.
- Failure messages include only the env key name, not the secret value.
- Existing secret access accounting remains in `secretService` resolution paths.
- Paperclip runtime auth injection still controls `PAPERCLIP_API_KEY` and `PAPERCLIP_RUN_ID`.
- Unresolved or malformed secret refs fail before adapter execution rather than being coerced into child process env strings.

## Validation Results

Targeted validation passed:

```text
pnpm vitest run server/src/__tests__/heartbeat-project-env.test.ts server/src/__tests__/adapter-registry.test.ts --pool=forks --poolOptions.forks.singleFork=true

Test Files  2 passed (2)
Tests       32 passed (32)
```

Specific behaviors covered:

- Hermes auth token and run id injection still works.
- Explicit `PAPERCLIP_API_KEY` preservation still works.
- External `hermes_local` adapter overrides receive Paperclip auth injection.
- Resolved runtime env values for `N8N_API_URL` and `N8N_API_KEY` are forwarded as strings.
- Secret-reference objects in agent env do not overwrite resolved runtime env values.
- `[object Object]` does not appear in the final Hermes runtime env.
- Unresolved non-string Hermes env bindings fail closed before adapter execution.
- Heartbeat project/routine/agent env overlay behavior remains intact.

## Outcome

Hermes runtime integrations can now consume resolved env secrets directly. Downstream tools should no longer need custom fallback logic to repair `[object Object]` secret values when Paperclip has already resolved those secret refs for the run.
