import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  appendLifecycleAuditRecord,
  buildLifecycleDiff,
  ensureLifecycleApproval,
  isProtectedWorkflow,
  validateWorkflowDefinition,
  writeLifecycleBackup,
} from "./n8n-workflow-lifecycle.mjs";

const issueContext = {
  companyId: "company-1",
  issueId: "issue-130",
  runId: "run-1",
  actorAgentId: "agent-edi",
};

const baselineWorkflow = {
  id: "wf-1",
  name: "EDI Validation Workflow",
  active: false,
  nodes: [
    {
      id: "manual-trigger",
      name: "Manual Trigger",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [260, 300],
      credentials: { apiKey: { id: "cred-1", name: "Sensitive" } },
      parameters: { password: "do-not-leak", safeValue: "visible" },
    },
  ],
  connections: {},
  settings: { executionOrder: "v1" },
};

function approval(overrides = {}) {
  return {
    status: "approved",
    approvedBy: "Matthew",
    approvedAt: "2026-06-02T19:30:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    reason: "EDI-130 validation",
    issueId: "issue-130",
    runId: "run-1",
    operation: "update",
    workflowId: "wf-1",
    allowProtected: false,
    ...overrides,
  };
}

test("ensureLifecycleApproval fails closed when approval is missing, pending, expired, revoked, or context-mismatched", () => {
  assert.throws(() => ensureLifecycleApproval({ issueContext, operation: "update", workflow: baselineWorkflow }), /approval is required/);
  assert.throws(() => ensureLifecycleApproval({ issueContext, operation: "update", workflow: baselineWorkflow, approval: approval({ status: "pending" }) }), /not approved/);
  assert.throws(() => ensureLifecycleApproval({ issueContext, operation: "update", workflow: baselineWorkflow, approval: approval({ status: "revoked" }) }), /not approved/);
  assert.throws(() => ensureLifecycleApproval({ issueContext, operation: "update", workflow: baselineWorkflow, approval: approval({ expiresAt: "2000-01-01T00:00:00.000Z" }) }), /expired/);
  assert.throws(() => ensureLifecycleApproval({ issueContext, operation: "activate", workflow: baselineWorkflow, approval: approval({ operation: "update" }) }), /operation mismatch/);
  assert.throws(() => ensureLifecycleApproval({ issueContext, operation: "update", workflow: baselineWorkflow, approval: approval({ issueId: "other-issue" }) }), /issue mismatch/);
});

test("ensureLifecycleApproval accepts exact approved context and blocks protected workflows without explicit protected approval", () => {
  const accepted = ensureLifecycleApproval({ issueContext, operation: "update", workflow: baselineWorkflow, approval: approval() });
  assert.equal(accepted.approvedBy, "Matthew");

  const protectedWorkflow = { ...baselineWorkflow, name: "EDIS Notification Bus" };
  assert.equal(isProtectedWorkflow(protectedWorkflow), true);
  assert.throws(() => ensureLifecycleApproval({ issueContext, operation: "update", workflow: protectedWorkflow, approval: approval({ workflowId: "wf-1" }) }), /protected workflow/);
  assert.equal(ensureLifecycleApproval({ issueContext, operation: "update", workflow: protectedWorkflow, approval: approval({ allowProtected: true }) }).allowProtected, true);
});

test("validateWorkflowDefinition fails closed for invalid definitions and duplicate nodes", () => {
  assert.equal(validateWorkflowDefinition(baselineWorkflow).valid, true);
  const invalid = { name: "", nodes: [{ id: "dup", name: "Node", type: "" }, { id: "dup", name: "Node", type: "n8n-nodes-base.set" }], connections: [] };
  const result = validateWorkflowDefinition(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /workflow.name/);
  assert.match(result.errors.join("\n"), /duplicate node id/);
  assert.match(result.errors.join("\n"), /workflow.connections/);
});

test("writeLifecycleBackup redacts credentials and writes checksum metadata before mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "n8n-lifecycle-backup-"));
  const result = writeLifecycleBackup(baselineWorkflow, { outputDir: dir, issueContext, operation: "update" });
  const exported = JSON.parse(readFileSync(result.path, "utf8"));

  assert.match(result.path, /EDI_Validation_Workflow-wf-1-update/);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(exported.nodes[0].credentials, "[REDACTED]");
  assert.equal(exported.nodes[0].parameters.password, "[REDACTED]");
  assert.equal(exported.nodes[0].parameters.safeValue, "visible");
  assert.equal(result.metadata.issueId, "issue-130");
});

test("buildLifecycleDiff reports sanitized workflow changes", () => {
  const candidate = structuredClone(baselineWorkflow);
  candidate.nodes[0].parameters.password = "new-secret";
  candidate.nodes.push({ id: "set", name: "Set", type: "n8n-nodes-base.set", position: [500, 300], parameters: { token: "no-leak" } });
  const diff = buildLifecycleDiff(baselineWorkflow, candidate);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.addedNodes, ["Set"]);
  assert.equal(JSON.stringify(diff).includes("new-secret"), false);
  assert.equal(JSON.stringify(diff).includes("no-leak"), false);
});

test("appendLifecycleAuditRecord writes sanitized governance records", () => {
  const dir = mkdtempSync(join(tmpdir(), "n8n-lifecycle-audit-"));
  const auditPath = join(dir, "audit.jsonl");
  const record = appendLifecycleAuditRecord({
    auditPath,
    issueContext,
    operation: "update",
    workflow: baselineWorkflow,
    approval: approval(),
    backupPath: "/tmp/backup.json",
    diff: { changed: true, changedNodes: ["Manual Trigger"], secret: "not-sensitive-key-name" },
    result: { ok: true, credential: "should-redact" },
  });
  const line = readFileSync(auditPath, "utf8").trim();
  const parsed = JSON.parse(line);

  assert.equal(record.operation, "update");
  assert.equal(parsed.issueId, "issue-130");
  assert.equal(parsed.workflow.id, "wf-1");
  assert.equal(JSON.stringify(parsed).includes("should-redact"), false);
  assert.equal(JSON.stringify(parsed).includes("do-not-leak"), false);
});
