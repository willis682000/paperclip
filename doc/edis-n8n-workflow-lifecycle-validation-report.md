# EDIS n8n Workflow Lifecycle Validation Report

Issue: EDI-131
Date: 2026-06-02

## Summary

Performed the approved end-to-end lifecycle validation for the n8n workflow lifecycle management capability implemented under EDI-130.

A temporary workflow was created, exported, backed up, diffed, modified, activated, deactivated, deleted, and verified removed. Production workflows were checked before and after and were unchanged.

## Operator Approval Scope

EDI-131 records Matthew Willis approval for creation, modification, activation, deactivation, export, backup, diff, and deletion of a temporary validation workflow created solely for lifecycle testing.

Restrictions observed:

- Did not modify EDIS Notification Bus.
- Did not modify production workflows.
- Used only a temporary validation workflow.
- Preserved backups and audit records.

## Workflow Under Test

- Workflow name: `EDI-131 Lifecycle Validation Temporary Workflow`
- Workflow ID: `DjaqG2dYqhf89Ypd`
- Initial active state: `false`
- Activated during validation: `true`
- Final active state before deletion: `false`
- Final cleanup: deleted; subsequent GET returned HTTP 404 Not Found

## Lifecycle Actions Performed

1. Created temporary workflow using `scripts/n8n-workflow-lifecycle.mjs create`.
2. Exported workflow using `scripts/n8n-readonly-workflow-export.mjs export`.
3. Backed up workflow using `scripts/n8n-workflow-lifecycle.mjs backup`.
4. Generated baseline self-diff against the exported workflow.
5. Modified workflow by changing the Set node output and adding `lifecyclePhase` output.
6. Generated change diff before update.
7. Updated workflow using `scripts/n8n-workflow-lifecycle.mjs update`.
8. Activated workflow using `scripts/n8n-workflow-lifecycle.mjs activate`.
9. Deactivated workflow using `scripts/n8n-workflow-lifecycle.mjs deactivate`.
10. Deleted workflow using the n8n API directly because `scripts/n8n-workflow-lifecycle.mjs` does not currently expose a `delete` command.
11. Confirmed cleanup by inventory comparison and direct GET returning HTTP 404.

## Backup and Export Locations

Export:

- `/tmp/edi-131-exports/EDI-131_Lifecycle_Validation_Temporary_Workflow-DjaqG2dYqhf89Ypd.json`
- SHA-256: `cd08cad174dbd29947e876cbc0140032e1216bd7a9076ea184b8f12e6c4a4064`

Backups preserved:

- `/home/mwillis/paperclip/doc/edis-exports/n8n-workflow-backups/EDI-131_Lifecycle_Validation_Temporary_Workflow-DjaqG2dYqhf89Ypd-backup-2026-06-02T19-36-03-496Z.json`
  - SHA-256: `35a10a82ff60da8ace0ecbc176a23679aee980141730acbb67add62a23f562bb`
- `/home/mwillis/paperclip/doc/edis-exports/n8n-workflow-backups/EDI-131_Lifecycle_Validation_Temporary_Workflow-DjaqG2dYqhf89Ypd-update-2026-06-02T19-36-41-435Z.json`
  - SHA-256: `d3d1b7a5a3d4d11371013131ba5308832f299af3cb1ed2fab4b6286c1fe3a8b3`
- `/home/mwillis/paperclip/doc/edis-exports/n8n-workflow-backups/EDI-131_Lifecycle_Validation_Temporary_Workflow-DjaqG2dYqhf89Ypd-activate-2026-06-02T19-36-48-008Z.json`
  - SHA-256: `73abe5f382dd3d7c358f38e8d152325b716a1b827cbb13674d339dc1f91dc761`
- `/home/mwillis/paperclip/doc/edis-exports/n8n-workflow-backups/EDI-131_Lifecycle_Validation_Temporary_Workflow-DjaqG2dYqhf89Ypd-deactivate-2026-06-02T19-36-54-239Z.json`
  - SHA-256: `0559f62360ef16502244f1146af77c1238cdb7de0dfa29deb44b33f08868cc97`

## Diff Results

Baseline self-diff:

- Changed: `false`
- Changed nodes: none
- Added nodes: none
- Removed nodes: none
- Connections changed: `false`
- Settings changed: `false`
- Metadata changed: `false`

Change diff before update:

- Changed: `true`
- Changed nodes: `Set Result`, `Webhook Trigger`
- Added nodes: none
- Removed nodes: none
- Connections changed: `false`
- Settings changed: `false`
- Metadata changed: `true`

The `Webhook Trigger` and metadata differences are expected because n8n enriches stored workflows with runtime metadata such as webhook IDs and version fields.

## Audit Verification

Audit path:

- `/home/mwillis/paperclip/doc/edis-audit/n8n-workflow-lifecycle.jsonl`

Confirmed six EDI-131 audit records for workflow `DjaqG2dYqhf89Ypd`:

- `create`
- `backup`
- `update`
- `activate`
- `deactivate`
- `delete`

Note: `delete` was appended as an audit record after direct n8n API deletion because the EDI-130 lifecycle script currently has no built-in `delete` command.

## Production Workflow Safety Check

Inventory before validation:

- Workflow count: 5
- `EDIS Notification Bus` active: `true`, updatedAt `2026-05-29T00:57:55.343Z`
- Other existing workflows unchanged during validation.

Inventory after cleanup:

- Workflow count: 5
- `EDIS Notification Bus` active: `true`, updatedAt `2026-05-29T00:57:55.343Z`
- Existing workflow IDs and names matched the pre-validation inventory.
- Temporary workflow `DjaqG2dYqhf89Ypd` was absent.

Cleanup verification:

- Direct GET `/workflows/DjaqG2dYqhf89Ypd` returned HTTP 404 with message `Not Found`.

## Result

Success criteria satisfied:

- Full lifecycle validation completed.
- Temporary workflow removed.
- Production workflows unchanged.
- Audit trail confirmed.
- Backup and rollback artifacts preserved.

Operational observation:

- The lifecycle utility supports create/update/restore/activate/deactivate/backup/diff, but not delete. Deletion required direct n8n API use under the explicit EDI-131 approval. A follow-up improvement should add approval-gated `delete` support to `scripts/n8n-workflow-lifecycle.mjs` so future validations do not need a separate deletion path.
