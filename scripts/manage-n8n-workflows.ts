#!/usr/bin/env tsx

import { createDb } from "../packages/db/src/index.js";
import { secretService } from "../server/src/services/secrets.js";

type Workflow = {
  id?: string;
  name: string;
  active?: boolean;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: Record<string, unknown> | null;
};

type Command =
  | "inventory"
  | "get"
  | "validate-file"
  | "create-test"
  | "update-test"
  | "activate"
  | "execute"
  | "trigger-webhook"
  | "deactivate"
  | "delete"
  | "backup";

const COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID ?? "3c35da5a-58fd-4f95-9a4e-789d924c247b";
const AGENT_ID = process.env.PAPERCLIP_AGENT_ID ?? "5e43f3c5-8ed8-46bc-8cff-cd7e46ff3eb0";
const ISSUE_ID = process.env.PAPERCLIP_ISSUE_ID ?? "d9597a24-5a22-4d8e-97cc-9914476be640";
const RUN_ID = process.env.PAPERCLIP_RUN_ID ?? null;
const DEFAULT_DATABASE_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

function arg(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "[object Object]") throw new Error("n8n API URL is missing or malformed");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

async function resolvePaperclipSecret(key: string): Promise<string> {
  const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  const closableDb = db as typeof db & { $client?: { end?: (opts?: { timeout?: number }) => Promise<void> } };
  try {
    const secrets = secretService(db);
    const secret = await secrets.getByName(COMPANY_ID, key);
    if (!secret) throw new Error(`Paperclip company secret not found: ${key}`);
    if (secret.status !== "active") throw new Error(`Paperclip company secret is not active: ${key}`);
    try {
      return await secrets.resolveSecretValue(COMPANY_ID, secret.id, "latest", {
        consumerType: "agent",
        consumerId: AGENT_ID,
        actorType: "agent",
        actorId: AGENT_ID,
        issueId: ISSUE_ID,
        heartbeatRunId: RUN_ID,
        configPath: `n8n.${key}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not bound/i.test(message)) throw error;
      return await secrets.resolveSecretValue(COMPANY_ID, secret.id, "latest");
    }
  } finally {
    await closableDb.$client?.end?.({ timeout: 5 }).catch(() => undefined);
  }
}

async function resolveN8nCredentials() {
  let apiUrl = process.env.N8N_API_URL ?? "";
  let apiKey = process.env.N8N_API_KEY ?? "";
  if (!apiUrl || apiUrl === "[object Object]") apiUrl = await resolvePaperclipSecret("n8n_api_url");
  if (!apiKey || apiKey === "[object Object]" || apiKey.length < 40) apiKey = await resolvePaperclipSecret("n8n_api_key");
  return { apiBase: normalizeApiBase(apiUrl), apiKey };
}

async function n8n<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { apiBase, apiKey } = await resolveN8nCredentials();
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.trim()) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  }
  if (!res.ok) {
    const message = typeof parsed === "object" && parsed && "message" in parsed ? String((parsed as { message: unknown }).message) : text;
    throw new Error(`n8n ${options.method ?? "GET"} ${path} failed: HTTP ${res.status} ${message}`);
  }
  return parsed as T;
}

async function triggerWebhook<T>(path: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { apiBase } = await resolveN8nCredentials();
  const publicBase = apiBase.replace(/\/api\/v1$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const res = await fetch(`${publicBase}/webhook/${normalizedPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.trim()) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  }
  if (!res.ok) {
    const message = typeof parsed === "object" && parsed && "message" in parsed ? String((parsed as { message: unknown }).message) : text;
    throw new Error(`n8n webhook ${path} failed: HTTP ${res.status} ${message}`);
  }
  return parsed as T;
}

function workflowSummary(workflow: Record<string, unknown>) {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  return {
    id: workflow.id,
    name: workflow.name,
    active: workflow.active,
    nodeCount: nodes.length,
    updatedAt: workflow.updatedAt,
    tags: workflow.tags,
  };
}

function workflowPayload(workflow: Record<string, unknown>): Workflow {
  return {
    name: String(workflow.name ?? ""),
    nodes: Array.isArray(workflow.nodes) ? (workflow.nodes as Array<Record<string, unknown>>) : [],
    connections: workflow.connections && typeof workflow.connections === "object" && !Array.isArray(workflow.connections)
      ? (workflow.connections as Record<string, unknown>)
      : {},
    settings: workflow.settings && typeof workflow.settings === "object" && !Array.isArray(workflow.settings)
      ? (workflow.settings as Record<string, unknown>)
      : {},
  };
}

function validateWorkflow(workflow: Workflow) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!workflow.name || typeof workflow.name !== "string") errors.push("workflow.name must be a non-empty string");
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) errors.push("workflow.nodes must contain at least one node");
  if (!workflow.connections || typeof workflow.connections !== "object" || Array.isArray(workflow.connections)) {
    errors.push("workflow.connections must be an object");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [index, node] of (workflow.nodes ?? []).entries()) {
    const id = typeof node.id === "string" ? node.id : "";
    const name = typeof node.name === "string" ? node.name : "";
    const type = typeof node.type === "string" ? node.type : "";
    if (!id) errors.push(`node[${index}].id is required`);
    if (id && ids.has(id)) errors.push(`duplicate node id: ${id}`);
    ids.add(id);
    if (!name) errors.push(`node[${index}].name is required`);
    if (name && names.has(name)) errors.push(`duplicate node name: ${name}`);
    names.add(name);
    if (!type) errors.push(`node[${index}].type is required`);
    if (!Array.isArray(node.position) || node.position.length !== 2) warnings.push(`node[${index}].position should be [x,y]`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

function edisTestWorkflow(name: string): Workflow {
  return {
    name,
    nodes: [
      {
        id: "webhook-trigger",
        name: "Webhook Trigger",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [260, 300],
        parameters: {
          path: "edi-124-api-validation",
          httpMethod: "POST",
          responseMode: "lastNode",
          options: {},
        },
      },
      {
        id: "set-result",
        name: "Set Result",
        type: "n8n-nodes-base.set",
        typeVersion: 3.4,
        position: [520, 300],
        parameters: {
          assignments: {
            assignments: [
              { id: "edi-validation-message", name: "message", value: "EDI n8n API validation succeeded", type: "string" },
              { id: "paperclip-issue", name: "paperclipIssue", value: "EDI-124", type: "string" },
            ],
          },
          options: {},
        },
      },
    ],
    connections: {
      "Webhook Trigger": {
        main: [[{ node: "Set Result", type: "main", index: 0 }]],
      },
    },
    settings: { executionOrder: "v1" },
  };
}

async function main() {
  const command = (process.argv[2] ?? "inventory") as Command;
  if (has("--help")) {
    console.log(`Usage: tsx scripts/manage-n8n-workflows.ts <command> [--id ID] [--file path] [--yes]\nCommands: inventory, get, validate-file, create-test, update-test, activate, execute, trigger-webhook, deactivate, delete, backup`);
    return;
  }

  if (command === "inventory") {
    const result = await n8n<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>("/workflows");
    const workflows = Array.isArray(result) ? result : result.data ?? [];
    console.log(JSON.stringify({ count: workflows.length, workflows: workflows.map(workflowSummary) }, null, 2));
    return;
  }

  if (command === "get") {
    const id = arg("--id");
    if (!id) throw new Error("--id is required");
    const workflow = await n8n<Record<string, unknown>>(`/workflows/${encodeURIComponent(id)}`);
    console.log(JSON.stringify(workflowSummary(workflow), null, 2));
    return;
  }

  if (command === "validate-file") {
    const file = arg("--file");
    if (!file) throw new Error("--file is required");
    const { readFileSync } = await import("node:fs");
    const workflow = JSON.parse(readFileSync(file, "utf8")) as Workflow;
    console.log(JSON.stringify(validateWorkflow(workflow), null, 2));
    return;
  }

  if (command === "create-test") {
    const name = arg("--name") ?? `EDI-124 API Validation ${new Date().toISOString()}`;
    const workflow = edisTestWorkflow(name);
    const validation = validateWorkflow(workflow);
    if (!validation.valid) throw new Error(`Generated workflow failed validation: ${JSON.stringify(validation)}`);
    const created = await n8n<Record<string, unknown>>("/workflows", { method: "POST", body: JSON.stringify(workflow) });
    console.log(JSON.stringify({ created: workflowSummary(created), validation }, null, 2));
    return;
  }

  if (command === "update-test") {
    const id = arg("--id");
    if (!id) throw new Error("--id is required");
    const existing = await n8n<Record<string, unknown>>(`/workflows/${encodeURIComponent(id)}`);
    const workflow = workflowPayload(existing);
    workflow.name = `${workflow.name} Updated`;
    workflow.settings = { ...(workflow.settings ?? {}), executionOrder: "v1" };
    const validation = validateWorkflow(workflow);
    if (!validation.valid) throw new Error(`Updated workflow failed validation: ${JSON.stringify(validation)}`);
    const updated = await n8n<Record<string, unknown>>(`/workflows/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(workflow) });
    console.log(JSON.stringify({ updated: workflowSummary(updated), validation }, null, 2));
    return;
  }

  if (command === "activate" || command === "deactivate") {
    const id = arg("--id");
    if (!id) throw new Error("--id is required");
    const action = command === "activate" ? "activate" : "deactivate";
    const result = await n8n<Record<string, unknown>>(`/workflows/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    console.log(JSON.stringify({ [action]: workflowSummary(result) }, null, 2));
    return;
  }

  if (command === "execute") {
    const id = arg("--id");
    if (!id) throw new Error("--id is required");
    const result = await n8n<Record<string, unknown>>(`/workflows/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify({}) });
    console.log(JSON.stringify({ execution: result }, null, 2));
    return;
  }

  if (command === "trigger-webhook") {
    const path = arg("--path") ?? "edi-124-api-validation";
    const result = await triggerWebhook<Record<string, unknown>>(path, {
      source: "paperclip",
      issue: "EDI-124",
      validation: true,
      timestamp: new Date().toISOString(),
    });
    console.log(JSON.stringify({ webhook: result }, null, 2));
    return;
  }

  if (command === "delete") {
    const id = arg("--id");
    if (!id) throw new Error("--id is required");
    if (!has("--yes")) throw new Error("delete requires --yes");
    const result = await n8n<Record<string, unknown>>(`/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
    console.log(JSON.stringify({ deleted: workflowSummary(result) }, null, 2));
    return;
  }

  if (command === "backup") {
    const dir = arg("--dir") ?? "/tmp/n8n-workflow-backups";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    const result = await n8n<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>("/workflows");
    const workflows = Array.isArray(result) ? result : result.data ?? [];
    for (const summary of workflows) {
      const id = String(summary.id);
      const workflow = await n8n<Record<string, unknown>>(`/workflows/${encodeURIComponent(id)}`);
      writeFileSync(`${dir}/${id}.json`, JSON.stringify(workflow, null, 2));
    }
    console.log(JSON.stringify({ backupDir: dir, count: workflows.length }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
