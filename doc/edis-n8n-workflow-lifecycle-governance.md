# EDIS n8n Workflow Lifecycle Governance Implementation Report

Issue: EDI-130
Date: 2026-06-02

## Summary

EDI-130 adds an approval-gated n8n workflow lifecycle utility on top of the existing read-only export and diff foundation from EDI-129.

Implementation artifacts:

- `scripts/n8n-workflow-lifecycle.mjs`
- `scripts/n8n-workflow-lifecycle.test.mjs`

The lifecycle utility is designed for controlled workflow operations through the n8n API while keeping Paperclip as the governance plane and n8n as the deterministic execution engine.

## Lifecycle Architecture

The lifecycle utility supports these command families:

- `validate --file FILE`
- `backup --id ID`
- `diff --existing FILE --candidate FILE`
- `create --file FILE --approval-file FILE`
- `update --id ID --file FILE --approval-file FILE`
- `restore --id ID --file FILE --approval-file FILE`
- `activate --id ID --approval-file FILE`
- `deactivate --id ID --approval-file FILE`

n8n API calls use runtime `N8N_API_URL` and `N8N_API_KEY` only. The script does not print API key material.

The utility imports the EDI-129 read-only workflow safety primitives for:

- API base normalization
- stable JSON serialization
- credential and sensitive-key redaction
- workflow export payload construction
- workflow checksum generation
- sanitized workflow diff generation

## Governance Flow

Mutating lifecycle operations fail closed unless all governance inputs are present.

Required Paperclip context:

- `PAPERCLIP_COMPANY_ID`
- `PAPERCLIP_ISSUE_ID`
- `PAPERCLIP_RUN_ID`
- `PAPERCLIP_AGENT_ID`

Required approval JSON fields:

- `status: "approved"`
- `approvedBy`
- `reason`

Optional approval constraints are enforced when present:

- `issueId`
- `runId`
- `operation`
- `workflowId`
- `workflowName`
- `expiresAt`
- `allowProtected`

Fail-closed cases covered by tests:

- missing approval
- pending approval
- revoked approval
- expired approval
- operation mismatch
- issue mismatch
- protected workflow modification without `allowProtected: true`

Protected workflows currently include:

- `EDIS Notification Bus`
- `Notification Bus`

This prevents accidental modification of the existing Notification Bus unless an approval explicitly grants protected-workflow authority.

## Backup Strategy

For existing workflow mutations (`update`, `restore`, `activate`, `deactivate`), the utility exports a sanitized backup before applying the change.

Default backup path:

- `doc/edis-exports/n8n-workflow-backups/`

Backup files include:

- redacted workflow definition
- lifecycle backup metadata
- company id
- issue id
- run id
- actor agent id
- operation
- timestamp
- SHA-256 checksum

Credentials and sensitive parameter names are redacted before writing backups.

## Diff Strategy

For candidate workflow changes (`update` and `restore`), the utility generates a sanitized lifecycle diff before applying the n8n mutation.

The diff reports:

- activation state changes
- changed nodes
- removed nodes
- added nodes
- connection changes
- setting changes
- metadata changes

Secrets are redacted before comparison output, so diffs do not expose credential material.

## Audit Records

Lifecycle actions append JSONL governance records to:

- `doc/edis-audit/n8n-workflow-lifecycle.jsonl`

Each record includes:

- event type
- timestamp
- Paperclip company, issue, run, and actor context
- lifecycle operation
- workflow id/name/active/protected summary
- sanitized approval metadata
- backup path
- sanitized diff summary
- sanitized result summary

This creates a repo-local audit trail suitable for Paperclip issue comments or later Wiki.js publication without exposing n8n credentials.

## Rollback Process

Recommended rollback procedure:

1. Identify the workflow id and last good backup file from the audit record.
2. Validate the backup payload:

   ```sh
   node scripts/n8n-workflow-lifecycle.mjs validate --file BACKUP_FILE
   ```

3. Restore with explicit approval:

   ```sh
   node scripts/n8n-workflow-lifecycle.mjs restore --id WORKFLOW_ID --file BACKUP_FILE --approval-file APPROVAL_FILE
   ```

4. If the workflow should not execute during remediation, deactivate it with explicit approval:

   ```sh
   node scripts/n8n-workflow-lifecycle.mjs deactivate --id WORKFLOW_ID --approval-file APPROVAL_FILE
   ```

5. Record the rollback result in the Paperclip issue thread.

## Validation Results

Commands executed from `/home/mwillis/paperclip`:

```sh
node --test scripts/n8n-workflow-lifecycle.test.mjs
node --check scripts/n8n-workflow-lifecycle.mjs
node scripts/n8n-workflow-lifecycle.mjs --help
node --test scripts/n8n-readonly-workflow-export.test.mjs scripts/n8n-workflow-lifecycle.test.mjs
```

Observed test result:

- 13 tests passed
- 0 tests failed

Covered behavior:

- lifecycle approval fail-closed behavior
- exact-context approval acceptance
- protected workflow protection
- workflow definition validation
- backup creation and redaction
- sanitized diff generation
- sanitized audit record generation
- existing EDI-129 export/diff safety behavior

Live n8n mutation validation was not performed in this run because the new lifecycle utility correctly requires explicit operation approval before create/update/activate/deactivate/restore. The implementation has been validated at the governance and safety-control layer without modifying existing n8n workflows.

## Operational Procedure

For future approved workflow changes:

1. Create or identify a Paperclip issue for the requested n8n change.
2. Prepare candidate workflow JSON.
3. Run local validation.
4. Prepare explicit approval JSON scoped to the issue, run, operation, and workflow.
5. Run `diff` against an exported baseline.
6. Execute the lifecycle command.
7. Confirm backup and audit record paths.
8. Post the result back to the Paperclip issue using authenticated Paperclip API headers.

Example approval JSON shape:

```json
{
  "status": "approved",
  "approvedBy": "Matthew",
  "approvedAt": "2026-06-02T19:30:00.000Z",
  "expiresAt": "2026-06-03T19:30:00.000Z",
  "reason": "Approved EDI-130 validation workflow update",
  "issueId": "91e464f7-ccab-481c-a0b0-5ba0f60bb6d7",
  "runId": "PAPERCLIP_RUN_ID",
  "operation": "update",
  "workflowId": "WORKFLOW_ID",
  "allowProtected": false
}
```

## Safety Notes

- The utility does not delete workflows.
- Existing workflows are backed up before mutation.
- Mutations fail closed when approval is absent, invalid, expired, revoked, or mismatched.
- Protected workflows require explicit protected-workflow approval.
- Credentials are redacted from backups, diffs, and audit records.
- n8n API keys are read from runtime environment and are not printed.

## Conclusion

EDI now has a tested, approval-gated n8n lifecycle management utility that provides create, update, activate, deactivate, export/backup, restore, diff, validation, rollback, and audit foundations while preserving EDIS governance boundaries.
