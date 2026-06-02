#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareWorkflowDefinitions,
  normalizeN8nApiBase,
  redactSensitiveValues,
  stableWorkflowJson,
  workflowChecksum,
  workflowExportPayload,
} from "./n8n-readonly-workflow-export.mjs";

const DEFAULT_BACKUP_DIR = "doc/edis-exports/n8n-workflow-backups";
const DEFAULT_AUDIT_PATH = "doc/edis-audit/n8n-workflow-lifecycle.jsonl";
const PROTECTED_WORKFLOW_NAMES = new Set([
  "EDIS Notification Bus",
  "Notification Bus",
]);
const SENSITIVE_KEY_PATTERN = /(authorization|bearer|token|secret|password|api[_-]?key|credential|private[_-]?key|access[_-]?key|refresh[_-]?token|client[_-]?secret)/i;

function arg(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

function has(flag) {
  return process.argv.includes(flag);
}

function sanitizeFilename(value) {
  return String(value ?? "workflow")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "workflow";
}

function nowIso() {
  return new Date().toISOString();
}

function parseJsonArg(name) {
  const file = arg(`${name}-file`);
  const raw = arg(name);
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  if (raw) return JSON.parse(raw);
  return null;
}

export function requireRuntimeN8nCredentials(env = process.env) {
  const apiUrl = String(env.N8N_API_URL ?? "").trim();
  const apiKey = String(env.N8N_API_KEY ?? "").trim();
  if (!apiUrl || apiUrl === "[object Object]") throw new Error("N8N_API_URL is required from runtime environment");
  if (!apiKey || apiKey === "[object Object]") throw new Error("N8N_API_KEY is required from runtime environment");
  return { apiBase: normalizeN8nApiBase(apiUrl), apiKey };
}

async function n8nRequest(path, options = {}, env = process.env) {
  const { apiBase, apiKey } = requireRuntimeN8nCredentials(env);
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  if (!res.ok) {
    const message = parsed && typeof parsed === "object" && "message" in parsed ? String(parsed.message) : text;
    throw new Error(`n8n ${options.method ?? "GET"} ${path} failed: HTTP ${res.status} ${message}`);
  }
  return parsed;
}

export async function fetchWorkflowById(id, env = process.env) {
  if (!id) throw new Error("workflow id is required");
  return await n8nRequest(`/workflows/${encodeURIComponent(id)}`, { method: "GET" }, env);
}

export async function createWorkflow(workflow, env = process.env) {
  return await n8nRequest("/workflows", { method: "POST", body: JSON.stringify(workflow) }, env);
}

export async function updateWorkflow(id, workflow, env = process.env) {
  return await n8nRequest(`/workflows/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(workflow) }, env);
}

export async function activateWorkflow(id, env = process.env) {
  return await n8nRequest(`/workflows/${encodeURIComponent(id)}/activate`, { method: "POST" }, env);
}

export async function deactivateWorkflow(id, env = process.env) {
  return await n8nRequest(`/workflows/${encodeURIComponent(id)}/deactivate`, { method: "POST" }, env);
}

export function validateWorkflowDefinition(workflow) {
  const errors = [];
  const warnings = [];
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return { valid: false, errors: ["workflow must be an object"], warnings };
  }
  if (!workflow.name || typeof workflow.name !== "string") errors.push("workflow.name must be a non-empty string");
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) errors.push("workflow.nodes must contain at least one node");
  if (!workflow.connections || typeof workflow.connections !== "object" || Array.isArray(workflow.connections)) {
    errors.push("workflow.connections must be an object");
  }
  const ids = new Set();
  const names = new Set();
  for (const [index, node] of (Array.isArray(workflow.nodes) ? workflow.nodes : []).entries()) {
    const id = typeof node?.id === "string" ? node.id : "";
    const name = typeof node?.name === "string" ? node.name : "";
    const type = typeof node?.type === "string" ? node.type : "";
    if (!id) errors.push(`node[${index}].id is required`);
    if (id && ids.has(id)) errors.push(`duplicate node id: ${id}`);
    if (id) ids.add(id);
    if (!name) errors.push(`node[${index}].name is required`);
    if (name && names.has(name)) errors.push(`duplicate node name: ${name}`);
    if (name) names.add(name);
    if (!type) errors.push(`node[${index}].type is required`);
    if (!Array.isArray(node?.position) || node.position.length !== 2) warnings.push(`node[${index}].position should be [x,y]`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function isProtectedWorkflow(workflow) {
  return PROTECTED_WORKFLOW_NAMES.has(String(workflow?.name ?? ""));
}

export function ensureIssueContext(issueContext = {}) {
  const missing = [];
  for (const field of ["companyId", "issueId", "runId", "actorAgentId"]) {
    if (!String(issueContext[field] ?? "").trim()) missing.push(field);
  }
  if (missing.length) throw new Error(`Paperclip issue context is required; missing ${missing.join(", ")}`);
  return issueContext;
}

export function ensureLifecycleApproval({ issueContext, operation, workflow, approval }) {
  ensureIssueContext(issueContext);
  if (!approval || typeof approval !== "object") throw new Error("approval is required for n8n workflow lifecycle modification");
  if (approval.status !== "approved") throw new Error(`approval is not approved: ${approval.status ?? "missing"}`);
  if (!approval.approvedBy) throw new Error("approval.approvedBy is required");
  if (!approval.reason) throw new Error("approval.reason is required");
  if (approval.issueId && approval.issueId !== issueContext.issueId) throw new Error("approval issue mismatch");
  if (approval.runId && approval.runId !== issueContext.runId) throw new Error("approval run mismatch");
  if (approval.operation && approval.operation !== operation && approval.operation !== "*") throw new Error("approval operation mismatch");
  if (approval.workflowId && workflow?.id && approval.workflowId !== workflow.id) throw new Error("approval workflow id mismatch");
  if (approval.workflowName && workflow?.name && approval.workflowName !== workflow.name) throw new Error("approval workflow name mismatch");
  if (approval.expiresAt) {
    const expiresAt = new Date(approval.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) throw new Error("approval expiresAt is invalid");
    if (expiresAt <= Date.now()) throw new Error("approval expired");
  }
  if (isProtectedWorkflow(workflow) && approval.allowProtected !== true) {
    throw new Error("protected workflow modification requires approval.allowProtected=true");
  }
  return approval;
}

export function buildLifecycleDiff(existing, candidate) {
  return compareWorkflowDefinitions(existing, candidate);
}

export function writeLifecycleBackup(workflow, { outputDir = DEFAULT_BACKUP_DIR, issueContext, operation = "backup" } = {}) {
  ensureIssueContext(issueContext);
  const dir = resolve(outputDir);
  mkdirSync(dir, { recursive: true });
  const payload = workflowExportPayload(workflow);
  const safeName = sanitizeFilename(payload.name);
  const id = sanitizeFilename(payload.id ?? "unknown");
  const stamp = nowIso().replace(/[:.]/g, "-");
  const path = join(dir, `${safeName}-${id}-${operation}-${stamp}.json`);
  const metadata = {
    companyId: issueContext.companyId,
    issueId: issueContext.issueId,
    runId: issueContext.runId,
    actorAgentId: issueContext.actorAgentId,
    operation,
    createdAt: nowIso(),
  };
  const backup = { ...payload, lifecycleBackup: metadata };
  const content = `${stableWorkflowJson(backup)}\n`;
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
  return { path, sha256: createHash("sha256").update(content).digest("hex"), metadata };
}

function sanitizeAuditValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => sanitizeAuditValue(entry));
  if (!value || typeof value !== "object") return value;
  const redacted = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    redacted[childKey] = sanitizeAuditValue(childValue, childKey);
  }
  return redacted;
}

export function appendLifecycleAuditRecord({ auditPath = DEFAULT_AUDIT_PATH, issueContext, operation, workflow, approval, backupPath, diff = null, result = null }) {
  ensureIssueContext(issueContext);
  const path = resolve(auditPath);
  mkdirSync(dirname(path), { recursive: true });
  const record = {
    type: "n8n_workflow_lifecycle",
    createdAt: nowIso(),
    companyId: issueContext.companyId,
    issueId: issueContext.issueId,
    runId: issueContext.runId,
    actorAgentId: issueContext.actorAgentId,
    operation,
    workflow: {
      id: workflow?.id ?? null,
      name: workflow?.name ?? null,
      active: workflow?.active ?? null,
      protected: isProtectedWorkflow(workflow),
    },
    approval: approval ? {
      status: approval.status,
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt ?? null,
      expiresAt: approval.expiresAt ?? null,
      reason: approval.reason,
      allowProtected: approval.allowProtected === true,
    } : null,
    backupPath: backupPath ?? null,
    diff: sanitizeAuditValue(diff),
    result: sanitizeAuditValue(redactSensitiveValues(result)),
  };
  writeFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
  return record;
}

function workflowPayloadForN8n(workflow) {
  return {
    name: String(workflow.name ?? ""),
    nodes: Array.isArray(workflow.nodes) ? workflow.nodes : [],
    connections: workflow.connections && typeof workflow.connections === "object" && !Array.isArray(workflow.connections) ? workflow.connections : {},
    settings: workflow.settings && typeof workflow.settings === "object" && !Array.isArray(workflow.settings) ? workflow.settings : {},
    staticData: workflow.staticData ?? null,
  };
}

function issueContextFromEnv() {
  return {
    companyId: process.env.PAPERCLIP_COMPANY_ID,
    issueId: process.env.PAPERCLIP_ISSUE_ID,
    runId: process.env.PAPERCLIP_RUN_ID,
    actorAgentId: process.env.PAPERCLIP_AGENT_ID,
  };
}

function readWorkflowFile(path) {
  if (!path) throw new Error("workflow file path is required");
  if (!existsSync(path)) throw new Error(`workflow file not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

async function lifecycleModify({ operation, id = null, workflowFile = null }) {
  const issueContext = issueContextFromEnv();
  const approval = parseJsonArg("--approval");
  const backupDir = arg("--backup-dir") ?? DEFAULT_BACKUP_DIR;
  const auditPath = arg("--audit-path") ?? DEFAULT_AUDIT_PATH;

  let existing = null;
  let candidate = null;
  if (id) existing = await fetchWorkflowById(id);
  if (workflowFile) candidate = readWorkflowFile(workflowFile);
  const approvalWorkflow = existing ?? candidate;

  ensureLifecycleApproval({ issueContext, operation, workflow: approvalWorkflow, approval });

  if (candidate) {
    const validation = validateWorkflowDefinition(candidate);
    if (!validation.valid) throw new Error(`candidate workflow failed validation: ${JSON.stringify(validation)}`);
  }

  const backup = existing ? writeLifecycleBackup(existing, { outputDir: backupDir, issueContext, operation }) : null;
  const diff = existing && candidate ? buildLifecycleDiff(existing, candidate) : null;
  let result;
  if (operation === "create") result = await createWorkflow(workflowPayloadForN8n(candidate));
  else if (operation === "update") result = await updateWorkflow(id, workflowPayloadForN8n(candidate));
  else if (operation === "activate") result = await activateWorkflow(id);
  else if (operation === "deactivate") result = await deactivateWorkflow(id);
  else if (operation === "restore") result = await updateWorkflow(id, workflowPayloadForN8n(candidate));
  else throw new Error(`unsupported lifecycle operation: ${operation}`);

  appendLifecycleAuditRecord({ auditPath, issueContext, operation, workflow: result ?? approvalWorkflow, approval, backupPath: backup?.path, diff, result });
  console.log(JSON.stringify({ operation, workflow: { id: result?.id, name: result?.name, active: result?.active }, backup, diff, auditPath: resolve(auditPath) }, null, 2));
}

function usage() {
  return `Usage: node scripts/n8n-workflow-lifecycle.mjs <command> [options]\n\nCommands:\n  validate --file FILE\n  backup --id ID [--backup-dir DIR]\n  diff --existing FILE --candidate FILE\n  create --file FILE --approval-file FILE\n  update --id ID --file FILE --approval-file FILE\n  restore --id ID --file FILE --approval-file FILE\n  activate --id ID --approval-file FILE\n  deactivate --id ID --approval-file FILE\n\nGovernance:\n  Mutating commands require PAPERCLIP_COMPANY_ID, PAPERCLIP_ISSUE_ID, PAPERCLIP_RUN_ID, PAPERCLIP_AGENT_ID.\n  Mutating commands require approval JSON with status=approved, approvedBy, reason, and matching issue/run/operation/workflow constraints.\n  Existing workflows are backed up before update, restore, activate, and deactivate.\n  Diffs are generated for update/restore when a candidate file is supplied.\n  Audit records append to ${DEFAULT_AUDIT_PATH} by default.\n  Protected workflows require approval.allowProtected=true.\n`;
}

async function main() {
  if (has("--help") || has("-h")) {
    console.log(usage());
    return;
  }
  const command = process.argv[2] ?? "validate";
  if (command === "validate") {
    const file = arg("--file");
    const workflow = readWorkflowFile(file);
    console.log(JSON.stringify(validateWorkflowDefinition(workflow), null, 2));
    return;
  }
  if (command === "diff") {
    const existingFile = arg("--existing") ?? arg("--base");
    const candidateFile = arg("--candidate");
    const diff = buildLifecycleDiff(readWorkflowFile(existingFile), readWorkflowFile(candidateFile));
    console.log(JSON.stringify({ existing: basename(existingFile), candidate: basename(candidateFile), diff }, null, 2));
    return;
  }
  if (command === "backup") {
    const issueContext = issueContextFromEnv();
    const id = arg("--id");
    const workflow = await fetchWorkflowById(id);
    const backup = writeLifecycleBackup(workflow, { outputDir: arg("--backup-dir") ?? DEFAULT_BACKUP_DIR, issueContext, operation: "backup" });
    appendLifecycleAuditRecord({ auditPath: arg("--audit-path") ?? DEFAULT_AUDIT_PATH, issueContext, operation: "backup", workflow, backupPath: backup.path });
    console.log(JSON.stringify({ backup }, null, 2));
    return;
  }
  if (["create", "update", "restore", "activate", "deactivate"].includes(command)) {
    await lifecycleModify({ operation: command, id: arg("--id"), workflowFile: arg("--file") });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
