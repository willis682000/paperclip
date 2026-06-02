# EDIS n8n Programmatic Control Implementation Report

Issue: EDI-124
Date: 2026-06-02

## Summary

EDI now has a checked-in n8n workflow management utility for controlled, programmatic workflow lifecycle operations without using the n8n UI.

Implementation artifact:

- `scripts/manage-n8n-workflows.ts`

The utility resolves n8n connection details from Paperclip-managed company secrets when direct environment variables are not provided. It does not print secret values.

## Current Integration Architecture

EDIS responsibility split:

- Paperclip: governance, issue context, audit trail, and secret custody.
- EDI: workflow engineering, validation, and operational decision-making.
- n8n: deterministic workflow execution.
- Wiki.js: published operational documentation.

Credential flow:

1. EDI runs the checked-in management script from the Paperclip repository.
2. The script reads `n8n_api_url` and `n8n_api_key` from Paperclip company secrets when `N8N_API_URL` and `N8N_API_KEY` are not present.
3. Secret resolution is scoped with company, agent, issue, run, and config-path context where available.
4. n8n API requests use `X-N8N-API-KEY` internally and do not expose the key in output.

## Workflow Inventory Verified

The n8n inventory command returned five workflows:

| Workflow ID | Name | Active | Nodes |
| --- | --- | --- | --- |
| `N4kELXVP6flOzk3B` | EDIS Notification Bus | true | 5 |
| `a9CUxuT8vm58B758` | My workflow 2 | false | 2 |
| `jI5jUfHf4G2N7ccs` | My workflow | false | 2 |
| `ozSAdw5Yc4N8GyEu` | EDI-124 API Validation 2026-06-02 Updated | false | 2 |
| `x8XQrVKDmelxnXpp` | EDI-124 API Validation Webhook 2026-06-02 | false | 2 |

Existing Notification Bus status remained active during validation.

## Implemented Management Capabilities

The management script supports:

- `inventory`: list workflow summaries.
- `get --id ID`: read a workflow summary.
- `validate-file --file PATH`: validate a local workflow definition before deployment.
- `create-test --name NAME`: create a safe EDIS validation workflow.
- `update-test --id ID`: update an existing validation workflow.
- `activate --id ID`: activate a workflow.
- `deactivate --id ID`: deactivate a workflow.
- `execute --id ID`: attempt n8n API execution endpoint execution where supported by the n8n API.
- `trigger-webhook --path PATH`: execute an active webhook workflow by calling its production webhook path.
- `backup --dir DIR`: export all workflow definitions to local JSON backups.
- `delete --id ID --yes`: delete a workflow only when explicitly confirmed by command flag.

## Validation Model

The local validator checks:

- Non-empty workflow name.
- At least one node.
- Connections object presence.
- Required node id, name, and type.
- Duplicate node ids.
- Duplicate node names.
- Node position warnings.

This is not a complete replacement for n8n's own validation, but it catches common malformed definitions before deployment.

## Validation Results

Commands executed from `/home/mwillis/paperclip`:

```sh
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts inventory
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts create-test --name "EDI-124 API Validation Webhook 2026-06-02"
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts activate --id x8XQrVKDmelxnXpp
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts trigger-webhook --path edi-124-api-validation
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts deactivate --id x8XQrVKDmelxnXpp
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts backup --dir /tmp/n8n-workflow-backups-edi-124
```

Observed validation output:

- Created workflow: `x8XQrVKDmelxnXpp`
- Created workflow validation: `valid: true`, no errors, no warnings.
- Activated workflow successfully.
- Triggered production webhook successfully.
- Webhook response:

```json
{
  "message": "EDI n8n API validation succeeded",
  "paperclipIssue": "EDI-124"
}
```

- Deactivated workflow successfully.
- Final inventory confirmed the validation workflow is inactive.
- Workflow backup completed to `/tmp/n8n-workflow-backups-edi-124` with 5 workflow exports.

A prior validation workflow using a manual trigger could be created and updated, but n8n correctly refused activation with:

```text
Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.
```

The validation workflow template was corrected to use a webhook trigger for activation/execution testing.

## Governance Controls

Current controls implemented or observed:

- Management is anchored to a Paperclip issue context through script defaults and runtime environment.
- Secret resolution uses Paperclip company secrets instead of local plaintext credentials.
- Delete requires an explicit `--yes` flag.
- Backups can be produced before workflow changes.
- Workflow lifecycle actions can be reported back to the Paperclip issue thread for audit.
- No n8n secrets are emitted in command output.

Recommended governance rule for operational use:

- Any create, update, activate, deactivate, execute, or delete action should be tied to a Paperclip issue and followed by an issue comment containing workflow id, action, result, validation status, and rollback guidance.

## Rollback Procedure

For non-destructive rollback:

1. Deactivate the changed workflow:

```sh
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts deactivate --id WORKFLOW_ID
```

2. Restore from a known-good exported JSON definition if needed.
3. Validate the restore payload before deployment:

```sh
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts validate-file --file PATH_TO_WORKFLOW_JSON
```

4. Record the rollback in the Paperclip issue thread.

Destructive deletion should only be performed after explicit operator authorization:

```sh
node cli/node_modules/tsx/dist/cli.mjs scripts/manage-n8n-workflows.ts delete --id WORKFLOW_ID --yes
```

## Security Controls

- n8n API credentials remain in Paperclip secret management.
- The management script avoids printing API key material.
- The validation report contains workflow identifiers and operational outcomes only.
- Webhook execution validation used a harmless two-node workflow that returns a fixed status payload.
- The validation workflow was deactivated after execution.

## Operational Guidance

Recommended workflow-change sequence:

1. Confirm Paperclip issue context.
2. Inventory current workflows.
3. Backup all workflows.
4. Validate proposed workflow JSON locally.
5. Create or update through the management script.
6. Activate only after validation passes.
7. Execute or trigger a controlled validation path.
8. Deactivate if the workflow is a temporary validation artifact.
9. Post results to the Paperclip issue thread.
10. Publish documentation when the deliverable is complete.

## Future Enhancements

Recommended next improvements:

- Add a non-test `create --file PATH` command for validated workflow deployment from specification files.
- Add a `restore --file PATH` command that validates and updates a named workflow from backup.
- Add workflow diff generation before updates.
- Add explicit Paperclip activity/comment logging from inside the management script using required Paperclip API headers.
- Add credential-reference validation for nodes that require n8n credentials.
- Add drift detection by hashing exported workflow definitions and comparing them against versioned repository specs.
- Add a dedicated managed-workflow registry mapping Paperclip issue identifiers to workflow ids and expected active state.

## Conclusion

EDI can now manage n8n workflows programmatically through a controlled repository utility, using Paperclip-managed secrets, local validation, lifecycle operations, backup/export support, and issue-context governance. The validation workflow was created, activated, executed through its webhook, and deactivated successfully, while the existing EDIS Notification Bus remained active.
