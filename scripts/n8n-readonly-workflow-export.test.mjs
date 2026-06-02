import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  compareWorkflowDefinitions,
  normalizeN8nApiBase,
  redactSensitiveValues,
  selectWorkflowByName,
  stableWorkflowJson,
  workflowChecksum,
  writeWorkflowExport,
} from "./n8n-readonly-workflow-export.mjs";

const baselineWorkflow = {
  id: "wf-notification-bus",
  name: "EDIS Notification Bus",
  active: true,
  nodes: [
    {
      id: "webhook",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      parameters: {
        path: "edis-notify",
        password: "super-secret",
      },
      credentials: {
        httpBasicAuth: {
          id: "cred-1",
          name: "Sensitive Credential",
        },
      },
    },
  ],
  connections: {
    Webhook: {
      main: [[]],
    },
  },
  settings: { executionOrder: "v1" },
  staticData: { lastExecution: 123 },
  tags: [{ id: "tag-1", name: "edis" }],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

test("normalizeN8nApiBase fails closed on missing or malformed runtime env", () => {
  assert.equal(normalizeN8nApiBase("http://127.0.0.1:5678"), "http://127.0.0.1:5678/api/v1");
  assert.equal(normalizeN8nApiBase("http://127.0.0.1:5678/api/v1/"), "http://127.0.0.1:5678/api/v1");
  assert.throws(() => normalizeN8nApiBase(""), /missing or malformed/);
  assert.throws(() => normalizeN8nApiBase("[object Object]"), /missing or malformed/);
});

test("selectWorkflowByName requires one exact workflow match", () => {
  const workflow = selectWorkflowByName([
    { id: "other", name: "Other Workflow" },
    { id: "wf-notification-bus", name: "EDIS Notification Bus" },
  ], "EDIS Notification Bus");
  assert.equal(workflow.id, "wf-notification-bus");
  assert.throws(() => selectWorkflowByName([], "EDIS Notification Bus"), /not found/);
  assert.throws(
    () => selectWorkflowByName([
      { id: "one", name: "EDIS Notification Bus" },
      { id: "two", name: "EDIS Notification Bus" },
    ], "EDIS Notification Bus"),
    /multiple workflows/,
  );
});

test("redactSensitiveValues removes credentials and sensitive parameter names", () => {
  const redacted = redactSensitiveValues(baselineWorkflow);
  assert.equal(redacted.nodes[0].credentials, "[REDACTED]");
  assert.equal(redacted.nodes[0].parameters.password, "[REDACTED]");
  assert.equal(redacted.nodes[0].parameters.path, "edis-notify");
});

test("writeWorkflowExport preserves workflow fields while redacting credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "n8n-export-test-"));
  const result = writeWorkflowExport(baselineWorkflow, { outputDir: dir });
  const exported = JSON.parse(readFileSync(result.path, "utf8"));

  assert.match(result.path, /EDIS_Notification_Bus/);
  assert.equal(exported.id, "wf-notification-bus");
  assert.equal(exported.name, "EDIS Notification Bus");
  assert.equal(exported.active, true);
  assert.deepEqual(exported.connections, baselineWorkflow.connections);
  assert.deepEqual(exported.settings, baselineWorkflow.settings);
  assert.equal(exported.nodes[0].credentials, "[REDACTED]");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.sha256, workflowChecksum(exported));
});

test("compareWorkflowDefinitions reports no differences for identical exported definitions", () => {
  const diff = compareWorkflowDefinitions(baselineWorkflow, structuredClone(baselineWorkflow));
  assert.deepEqual(diff, {
    changed: false,
    activationStateChanged: null,
    changedNodes: [],
    removedNodes: [],
    addedNodes: [],
    connectionsChanged: false,
    settingsChanged: false,
    metadataChanged: false,
  });
});

test("compareWorkflowDefinitions reports activation, node, connection, and setting changes without leaking secrets", () => {
  const candidate = structuredClone(baselineWorkflow);
  candidate.active = false;
  candidate.nodes[0].parameters.path = "changed-path";
  candidate.nodes.push({ id: "set", name: "Set", type: "n8n-nodes-base.set", parameters: { token: "candidate-secret" } });
  candidate.connections.Webhook.main = [[{ node: "Set", type: "main", index: 0 }]];
  candidate.settings = { executionOrder: "v1", timezone: "UTC" };

  const diff = compareWorkflowDefinitions(baselineWorkflow, candidate);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.activationStateChanged, { from: true, to: false });
  assert.deepEqual(diff.changedNodes, ["Webhook"]);
  assert.deepEqual(diff.addedNodes, ["Set"]);
  assert.equal(diff.connectionsChanged, true);
  assert.equal(diff.settingsChanged, true);
  assert.equal(JSON.stringify(diff).includes("candidate-secret"), false);
});

test("stableWorkflowJson is deterministic independent of object insertion order", () => {
  const first = { b: 2, a: { d: 4, c: 3 } };
  const second = { a: { c: 3, d: 4 }, b: 2 };
  assert.equal(stableWorkflowJson(first), stableWorkflowJson(second));
});
