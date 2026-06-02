#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKFLOW_NAME = "EDIS Notification Bus";
const DEFAULT_OUTPUT_DIR = "doc/edis-exports/n8n-workflows";
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

export function normalizeN8nApiBase(raw) {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "[object Object]") throw new Error("N8N_API_URL is missing or malformed");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

export function requireRuntimeN8nCredentials(env = process.env) {
  const apiUrl = String(env.N8N_API_URL ?? "").trim();
  const apiKey = String(env.N8N_API_KEY ?? "").trim();
  if (!apiUrl || apiUrl === "[object Object]") throw new Error("N8N_API_URL is required from runtime environment");
  if (!apiKey || apiKey === "[object Object]") throw new Error("N8N_API_KEY is required from runtime environment");
  return { apiBase: normalizeN8nApiBase(apiUrl), apiKey };
}

async function n8nGet(path, env = process.env) {
  const { apiBase, apiKey } = requireRuntimeN8nCredentials(env);
  const res = await fetch(`${apiBase}${path}`, {
    method: "GET",
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Accept": "application/json",
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
    throw new Error(`n8n GET ${path} failed: HTTP ${res.status} ${message}`);
  }
  return parsed;
}

export async function fetchWorkflowInventory(env = process.env) {
  const result = await n8nGet("/workflows", env);
  const workflows = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
  return workflows;
}

export async function fetchWorkflowById(id, env = process.env) {
  if (!id) throw new Error("workflow id is required");
  return await n8nGet(`/workflows/${encodeURIComponent(id)}`, env);
}

export function selectWorkflowByName(workflows, name) {
  const target = String(name ?? "").trim();
  if (!target) throw new Error("workflow name is required");
  const matches = workflows.filter((workflow) => workflow?.name === target);
  if (matches.length === 0) throw new Error(`workflow not found by exact name: ${target}`);
  if (matches.length > 1) throw new Error(`multiple workflows matched exact name: ${target}`);
  return matches[0];
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

export function stableWorkflowJson(value) {
  return JSON.stringify(sortObject(value), null, 2);
}

export function workflowChecksum(workflow) {
  return createHash("sha256").update(stableWorkflowJson(workflow)).digest("hex");
}

export function redactSensitiveValues(value, keyPath = []) {
  if (Array.isArray(value)) return value.map((entry, index) => redactSensitiveValues(entry, [...keyPath, String(index)]));
  if (!value || typeof value !== "object") return value;

  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "credentials" || SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redactSensitiveValues(entry, [...keyPath, key]);
    }
  }
  return redacted;
}

export function workflowExportPayload(workflow) {
  const redacted = redactSensitiveValues(workflow);
  return {
    id: redacted.id,
    name: redacted.name,
    active: redacted.active,
    nodes: Array.isArray(redacted.nodes) ? redacted.nodes : [],
    connections: redacted.connections && typeof redacted.connections === "object" ? redacted.connections : {},
    settings: redacted.settings && typeof redacted.settings === "object" ? redacted.settings : {},
    staticData: redacted.staticData ?? null,
    tags: redacted.tags ?? [],
    meta: redacted.meta ?? redacted.metadata ?? null,
    createdAt: redacted.createdAt ?? null,
    updatedAt: redacted.updatedAt ?? null,
    versionId: redacted.versionId ?? null,
    triggerCount: redacted.triggerCount ?? null,
  };
}

export function writeWorkflowExport(workflow, options = {}) {
  const outputDir = resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true });
  const payload = workflowExportPayload(workflow);
  const safeName = sanitizeFilename(payload.name);
  const id = sanitizeFilename(payload.id ?? "unknown");
  const path = join(outputDir, `${safeName}-${id}.json`);
  const content = `${stableWorkflowJson(payload)}\n`;
  writeFileSync(path, content, { encoding: "utf8", flag: "w" });
  return { path, sha256: workflowChecksum(payload), workflow: payload };
}

function nodesByName(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  return new Map(nodes.map((node) => [String(node?.name ?? node?.id ?? ""), redactSensitiveValues(node)]));
}

function stableEqual(a, b) {
  return stableWorkflowJson(redactSensitiveValues(a)) === stableWorkflowJson(redactSensitiveValues(b));
}

export function compareWorkflowDefinitions(existing, candidate) {
  const existingRedacted = redactSensitiveValues(existing);
  const candidateRedacted = redactSensitiveValues(candidate);
  const existingNodes = nodesByName(existingRedacted);
  const candidateNodes = nodesByName(candidateRedacted);
  const changedNodes = [];
  const removedNodes = [];
  const addedNodes = [];

  for (const [name, node] of existingNodes.entries()) {
    if (!candidateNodes.has(name)) {
      removedNodes.push(name);
      continue;
    }
    if (!stableEqual(node, candidateNodes.get(name))) changedNodes.push(name);
  }
  for (const name of candidateNodes.keys()) {
    if (!existingNodes.has(name)) addedNodes.push(name);
  }

  const activationStateChanged = existingRedacted.active !== candidateRedacted.active
    ? { from: existingRedacted.active, to: candidateRedacted.active }
    : null;
  const connectionsChanged = !stableEqual(existingRedacted.connections ?? {}, candidateRedacted.connections ?? {});
  const settingsChanged = !stableEqual(existingRedacted.settings ?? {}, candidateRedacted.settings ?? {});
  const metadataChanged = !stableEqual(
    {
      id: existingRedacted.id,
      name: existingRedacted.name,
      tags: existingRedacted.tags ?? [],
      meta: existingRedacted.meta ?? existingRedacted.metadata ?? null,
      versionId: existingRedacted.versionId ?? null,
    },
    {
      id: candidateRedacted.id,
      name: candidateRedacted.name,
      tags: candidateRedacted.tags ?? [],
      meta: candidateRedacted.meta ?? candidateRedacted.metadata ?? null,
      versionId: candidateRedacted.versionId ?? null,
    },
  );

  const changed = Boolean(
    activationStateChanged ||
    changedNodes.length ||
    removedNodes.length ||
    addedNodes.length ||
    connectionsChanged ||
    settingsChanged ||
    metadataChanged
  );

  return {
    changed,
    activationStateChanged,
    changedNodes: changedNodes.sort(),
    removedNodes: removedNodes.sort(),
    addedNodes: addedNodes.sort(),
    connectionsChanged,
    settingsChanged,
    metadataChanged,
  };
}

function readWorkflowFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function commandInventory() {
  const workflows = await fetchWorkflowInventory();
  console.log(JSON.stringify({ count: workflows.length, workflows: workflows.map((workflow) => ({ id: workflow.id, name: workflow.name, active: workflow.active, updatedAt: workflow.updatedAt })) }, null, 2));
}

async function commandExport() {
  const name = arg("--name") ?? DEFAULT_WORKFLOW_NAME;
  const outputDir = arg("--dir") ?? DEFAULT_OUTPUT_DIR;
  const before = await fetchWorkflowInventory();
  const summary = selectWorkflowByName(before, name);
  const workflow = await fetchWorkflowById(String(summary.id));
  const result = writeWorkflowExport(workflow, { outputDir });
  const after = await fetchWorkflowInventory();

  if (before.length !== after.length) {
    throw new Error(`workflow count changed during read-only export: before=${before.length} after=${after.length}`);
  }

  console.log(JSON.stringify({
    workflow: { id: result.workflow.id, name: result.workflow.name, active: result.workflow.active, nodeCount: result.workflow.nodes.length },
    exportPath: result.path,
    sha256: result.sha256,
    workflowCountBefore: before.length,
    workflowCountAfter: after.length,
    readOnly: true,
  }, null, 2));
}

async function commandDiff() {
  const existingFile = arg("--existing") ?? arg("--base");
  const candidateFile = arg("--candidate");
  if (!existingFile) throw new Error("--existing is required");
  if (!candidateFile) throw new Error("--candidate is required");
  if (!existsSync(existingFile)) throw new Error(`existing workflow file not found: ${existingFile}`);
  if (!existsSync(candidateFile)) throw new Error(`candidate workflow file not found: ${candidateFile}`);

  const existing = readWorkflowFile(existingFile);
  const candidate = readWorkflowFile(candidateFile);
  console.log(JSON.stringify({
    existing: basename(existingFile),
    candidate: basename(candidateFile),
    diff: compareWorkflowDefinitions(existing, candidate),
  }, null, 2));
}

function usage() {
  return `Usage: node scripts/n8n-readonly-workflow-export.mjs <command> [options]\n\nCommands:\n  inventory                         Read workflow inventory only\n  export [--name NAME] [--dir DIR]   Export one workflow by exact name; default: ${DEFAULT_WORKFLOW_NAME}\n  diff --existing FILE --candidate FILE\n                                    Compare two exported workflow JSON files\n\nSafety:\n  Uses runtime N8N_API_URL and N8N_API_KEY only.\n  Uses n8n GET requests only.\n  Never creates, updates, activates, deactivates, executes, or deletes workflows.\n  Redacts credentials and sensitive key names in exported JSON and diff inputs.\n`;
}

async function main() {
  if (has("--help") || has("-h")) {
    console.log(usage());
    return;
  }
  const command = process.argv[2] ?? "inventory";
  if (command === "inventory") return await commandInventory();
  if (command === "export") return await commandExport();
  if (command === "diff") return await commandDiff();
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
