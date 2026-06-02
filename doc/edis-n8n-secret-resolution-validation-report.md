# EDIS n8n Secret Resolution Validation Report

## Scope

Issue: EDI-126, Validate n8n Secret Resolution And Runtime Bindings.

Validation was read-only with respect to n8n workflows. No workflows were created, updated, activated, deactivated, or deleted. Secret values were not printed.

## Summary

The n8n company secrets themselves are usable through Paperclip's secret service. The malformed runtime values are caused by Hermes adapter environment injection receiving unresolved secret-reference objects from `agent.adapterConfig.env` and passing those objects into the Hermes child process environment. Node process environment coercion turns those objects into the string `[object Object]`.

Observed current Hermes runtime bindings:

| Binding | Present in Hermes runtime | Runtime type | Safe observed shape |
| --- | --- | --- | --- |
| `n8n_api_url` | No | n/a | not injected as lowercase env |
| `n8n_api_key` | No | n/a | not injected as lowercase env |
| `N8N_API_URL` | Yes | string | malformed object string, length 15 |
| `N8N_API_KEY` | Yes | string | malformed object string, length 15 |
| `PAPERCLIP_API_URL` | Yes | string | malformed object string, length 15 |
| `EDI_PAPERCLIP_API_URL` | Yes | string | malformed object string, length 15 |

The string length 15 corresponds to `[object Object]`. Values were not printed.

## Secret Source

The EDI agent adapter configuration contains env entries for the n8n bindings as Paperclip secret references, not literal strings:

- `env.N8N_API_URL`: object with `type`, `secretId`, and `version`
- `env.N8N_API_KEY`: object with `type`, `secretId`, and `version`

The same object-reference pattern is present for `PAPERCLIP_API_URL` and `EDI_PAPERCLIP_API_URL`.

This confirms the configured source is Paperclip-managed secret references, not raw inline secrets. The agent-authenticated API did not expose secret values, and the board-only secrets listing endpoint was not used for writes or bypasses.

## Runtime Type

Within the active Hermes runtime process environment:

- Environment variables are strings, as expected for a process environment.
- The n8n uppercase bindings are present but contain the coerced object string, not usable n8n credentials.
- Lowercase Paperclip secret keys are not injected as environment variables.

## Injection Path

The current path is:

1. Paperclip stores EDI adapter config with `env` entries that can contain secret reference objects.
2. `server/src/adapters/registry.ts` wraps the Hermes adapter in `withHermesLocalRuntimeAuth()`.
3. The wrapper reads `existingConfig.env` and casts it as `Record<string, string>`.
4. It spreads `existingEnv` into `patchedConfig.env` without resolving secret-reference objects.
5. It injects `PAPERCLIP_API_KEY` from `ctx.authToken` and `PAPERCLIP_RUN_ID` as strings.
6. The Hermes adapter launches a child runtime with the patched env.
7. Non-string env object entries are coerced by the process environment layer into `[object Object]`.

Relevant code location:

- `/home/mwillis/paperclip/server/src/adapters/registry.ts`
- Function: `withHermesLocalRuntimeAuth()`
- Current behavior: object env values survive the spread into `patchedConfig.env`.

## Failure Analysis

Root cause:

`withHermesLocalRuntimeAuth()` preserves unresolved object-valued env entries from `agent.adapterConfig.env` when building the Hermes runtime env. The wrapper only ensures Paperclip API auth injection; it does not resolve or filter Paperclip secret reference objects before passing env to Hermes.

Impact:

- `N8N_API_URL` is unusable directly in Hermes because it is `[object Object]` rather than an HTTP URL.
- `N8N_API_KEY` is unusable directly in Hermes because it is `[object Object]` rather than an API key.
- Scripts that defensively detect `[object Object]` and resolve Paperclip secrets directly still work.
- Scripts or tools that trust `N8N_API_URL` / `N8N_API_KEY` from the runtime environment will fail or misroute.

Confirmed safe workaround:

`/home/mwillis/paperclip/scripts/manage-n8n-workflows.ts` handles this failure mode by detecting missing or `[object Object]` env values and resolving `n8n_api_url` and `n8n_api_key` through Paperclip's secret service. Its read-only `inventory` command succeeded and returned five workflows, proving that Paperclip secret storage and direct secret-service resolution are usable.

## Verification Evidence

Read-only runtime binding inspection:

- `N8N_API_URL`: present, type string, malformed object string, not HTTP-like.
- `N8N_API_KEY`: present, type string, malformed object string.
- `n8n_api_url`: not present in env.
- `n8n_api_key`: not present in env.

Read-only n8n API validation through checked-in script:

Command:

```sh
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts inventory
```

Result:

- Exit code: 0
- Workflow count: 5
- No workflow modifications performed.

This confirms the underlying Paperclip-managed n8n secrets resolve to usable strings when resolved through `secretService.resolveSecretValue()` rather than through the unresolved Hermes env injection path.

## Remediation Recommendation

Preferred fix:

Update the Hermes runtime env construction path so only string env values are passed to the child runtime. For object-valued Paperclip secret references, resolve them server-side before adapter execution or omit them fail-closed with a clear diagnostic.

Concrete options:

1. Server-side resolution before Hermes execution
   - Detect secret-reference objects in `agent.adapterConfig.env`.
   - Resolve them with Paperclip `secretService.resolveSecretValue()` under the current company, agent, issue, and run context.
   - Pass only resolved strings into `patchedConfig.env`.
   - Preserve the current explicit `PAPERCLIP_API_KEY` injection from `ctx.authToken`.

2. Fail-closed env sanitization
   - If server-side resolution is not available in the adapter registry layer, filter non-string env values before launching Hermes.
   - Emit a redacted diagnostic listing affected env keys.
   - This avoids `[object Object]` poisoning but would still require scripts to resolve secrets directly.

3. Keep script-level fallback as defense in depth
   - Preserve the current `manage-n8n-workflows.ts` fallback that detects `[object Object]` and resolves `n8n_api_url` / `n8n_api_key` directly.
   - This protects n8n automation until the adapter env path is corrected.

Recommended priority:

- Fix adapter env resolution for Hermes first, because the same issue affects non-n8n env refs such as `PAPERCLIP_API_URL` and `EDI_PAPERCLIP_API_URL`.
- Add regression coverage asserting object-valued secret refs are not passed through to Hermes as `[object Object]`.

## Disposition

EDI-126 validation is complete. The root cause is identified, runtime binding path is documented, malformed resolution is confirmed, and remediation is recommended. No n8n workflow modifications were performed.
