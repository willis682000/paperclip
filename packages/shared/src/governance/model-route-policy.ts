export type ModelRouteActorKind = "agent" | "user" | "workflow" | "cron" | "system";

export type ModelRouteScopeKind =
  | "agent"
  | "issue"
  | "project"
  | "workflow"
  | "cron"
  | "manual"
  | "runtime";

export type ModelRouteUsageCategory =
  | "primary"
  | "cheap_docs"
  | "emergency_backup"
  | "coding_fallback"
  | "premium_manual"
  | "unknown";

export interface ModelRouteCandidate {
  companyId: string;
  actorKind: ModelRouteActorKind;
  actorId?: string | null;
  scopeKind: ModelRouteScopeKind;
  scopeId?: string | null;
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  envKeysPresent?: string[];
  adapterType?: string | null;
  adapterConfigPath?: string | null;
  usageCategory?: ModelRouteUsageCategory | null;
  requestedModelProfile?: string | null;
  approvalId?: string | null;
}

export type ModelRouteViolationCode =
  | "policy_provider_auto_disallowed"
  | "policy_openrouter_approval_required"
  | "policy_model_not_allowlisted"
  | "policy_openrouter_router_disallowed"
  | "policy_openrouter_budget_exceeded"
  | "policy_openrouter_approval_expired"
  | "policy_openrouter_scope_mismatch";

export type ModelRoutePolicyDecision =
  | {
      allowed: true;
      normalizedProvider: string;
      normalizedModel: string | null;
      approvalId?: string | null;
      warnings?: string[];
    }
  | {
      allowed: false;
      violationCode: ModelRouteViolationCode;
      reason: string;
      requiredApprovalFields?: string[];
      redactedSignals?: string[];
    };

export type OpenRouterModelRouteTier = "tier1" | "tier2" | "tier3" | "tier4";

export interface OpenRouterAllowedModelRoute {
  provider: "openrouter";
  modelId: string;
  tier: OpenRouterModelRouteTier;
  usageCategories: ModelRouteUsageCategory[];
  maxInputUsdPerMillion: number;
  maxOutputUsdPerMillion: number;
  maxContextTokens: number;
  standingApproval: boolean;
  requiresApproval: boolean;
  notes: string;
}

export interface OpenRouterRoutePolicy {
  defaultAllowed: boolean;
  blockedPatterns: readonly string[];
  allowedModels: readonly OpenRouterAllowedModelRoute[];
}

export interface ModelRoutePolicy {
  version: 1;
  name: string;
  defaultProvider: "openai-codex";
  defaultModel: "gpt-5.5";
  providerAutoAllowed: false;
  openRouter: OpenRouterRoutePolicy;
}

export const EDIS_OPENROUTER_BLOCKED_PATTERNS = ["auto", "router", "provider:auto"] as const;

export const EDIS_OPENROUTER_ALLOWED_MODELS = [
  {
    provider: "openrouter",
    modelId: "google/gemini-2.5-flash-lite",
    tier: "tier1",
    usageCategories: ["cheap_docs"],
    maxInputUsdPerMillion: 0.1,
    maxOutputUsdPerMillion: 0.4,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Cheap documentation and summarization candidate; web search add-ons require separate approval.",
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-4.1-nano",
    tier: "tier1",
    usageCategories: ["cheap_docs"],
    maxInputUsdPerMillion: 0.1,
    maxOutputUsdPerMillion: 0.4,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Cheap documentation and summarization only; not a coding fallback by default.",
  },
  {
    provider: "openrouter",
    modelId: "qwen/qwen3-30b-a3b",
    tier: "tier1",
    usageCategories: ["cheap_docs"],
    maxInputUsdPerMillion: 0.09,
    maxOutputUsdPerMillion: 0.45,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Cheap documentation and summarization candidate pending quality validation.",
  },
  {
    provider: "openrouter",
    modelId: "mistralai/mistral-small-3.2-24b-instruct",
    tier: "tier1",
    usageCategories: ["cheap_docs"],
    maxInputUsdPerMillion: 0.075,
    maxOutputUsdPerMillion: 0.2,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Low-cost documentation and summarization candidate pending quality validation.",
  },
  {
    provider: "openrouter",
    modelId: "meta-llama/llama-3.3-70b-instruct",
    tier: "tier1",
    usageCategories: ["cheap_docs"],
    maxInputUsdPerMillion: 0.1,
    maxOutputUsdPerMillion: 0.32,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Cheap open-model documentation and summarization candidate.",
  },
  {
    provider: "openrouter",
    modelId: "google/gemini-2.5-flash",
    tier: "tier2",
    usageCategories: ["emergency_backup", "coding_fallback"],
    maxInputUsdPerMillion: 0.3,
    maxOutputUsdPerMillion: 2.5,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Emergency backup and general reasoning route only with explicit approval; no automatic Gemini/OpenRouter drift.",
  },
  {
    provider: "openrouter",
    modelId: "deepseek/deepseek-chat-v3-0324",
    tier: "tier2",
    usageCategories: ["emergency_backup", "coding_fallback"],
    maxInputUsdPerMillion: 0.2,
    maxOutputUsdPerMillion: 0.77,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Emergency backup and debugging/planning candidate pending provider reliability validation.",
  },
  {
    provider: "openrouter",
    modelId: "qwen/qwen3-235b-a22b",
    tier: "tier2",
    usageCategories: ["emergency_backup", "coding_fallback"],
    maxInputUsdPerMillion: 0.455,
    maxOutputUsdPerMillion: 1.82,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Emergency backup and broad reasoning candidate.",
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-4.1-mini",
    tier: "tier2",
    usageCategories: ["emergency_backup", "coding_fallback"],
    maxInputUsdPerMillion: 0.4,
    maxOutputUsdPerMillion: 1.6,
    maxContextTokens: 64_000,
    standingApproval: false,
    requiresApproval: true,
    notes: "Preferred initial coding/debugging fallback when OpenAI through OpenRouter is explicitly approved.",
  },
] as const satisfies readonly OpenRouterAllowedModelRoute[];

export const EDIS_OPENROUTER_MODEL_ROUTE_POLICY = {
  version: 1,
  name: "EDIS OpenRouter allowlist and cost-control policy",
  defaultProvider: "openai-codex",
  defaultModel: "gpt-5.5",
  providerAutoAllowed: false,
  openRouter: {
    defaultAllowed: false,
    blockedPatterns: EDIS_OPENROUTER_BLOCKED_PATTERNS,
    allowedModels: EDIS_OPENROUTER_ALLOWED_MODELS,
  },
} as const satisfies ModelRoutePolicy;

export interface ModelRouteSignals {
  normalizedProvider: string | null;
  normalizedModel: string | null;
  normalizedBaseUrl: string | null;
  isProviderAuto: boolean;
  isOpenRouterRoute: boolean;
  isOpenRouterRouterModel: boolean;
  redactedSignals: string[];
}

export interface ModelRouteApproval {
  id: string;
  provider: string;
  model: string;
  usageCategory: ModelRouteUsageCategory;
  scopeKind: ModelRouteScopeKind;
  scopeId?: string | null;
  expiresAt: string;
}

export interface EvaluateModelRoutePolicyOptions {
  policy?: ModelRoutePolicy;
  approval?: ModelRouteApproval | null;
  now?: Date;
}

const OPENROUTER_HOST_RE = /(^|\.)openrouter\.ai$/i;
const OPENROUTER_ENV_KEY = "OPENROUTER_API_KEY";
const REQUIRED_APPROVAL_FIELDS = [
  "approvalId",
  "provider",
  "model",
  "usageCategory",
  "scopeKind",
  "scopeId",
  "expiresAt",
];

export function normalizeModelRouteText(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function normalizeModelRouteBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return normalizeModelRouteText(trimmed);
  }
}

export function collectRouteSignals(candidate: ModelRouteCandidate): ModelRouteSignals {
  const normalizedProvider = normalizeModelRouteText(candidate.provider);
  const normalizedModel = normalizeModelRouteText(candidate.model);
  const normalizedBaseUrl = normalizeModelRouteBaseUrl(candidate.baseUrl);
  const redactedSignals: string[] = [];

  const isProviderAuto = normalizedProvider === "auto" || normalizedProvider === "provider:auto";
  if (isProviderAuto) {
    redactedSignals.push("provider:auto");
  } else if (normalizedProvider === "openrouter") {
    redactedSignals.push("provider:openrouter");
  }

  const hasOpenRouterBaseUrl = normalizedBaseUrl ? OPENROUTER_HOST_RE.test(normalizedBaseUrl) : false;
  if (hasOpenRouterBaseUrl) {
    redactedSignals.push("baseUrl:openrouter.ai");
  }

  const hasOpenRouterEnvKey = candidate.envKeysPresent?.some(
    (key) => key.trim().toUpperCase() === OPENROUTER_ENV_KEY,
  ) ?? false;
  if (hasOpenRouterEnvKey) {
    redactedSignals.push("env:OPENROUTER_API_KEY_PRESENT");
  }

  const isOpenRouterRoute = normalizedProvider === "openrouter" || hasOpenRouterBaseUrl || hasOpenRouterEnvKey;
  const isOpenRouterRouterModel = Boolean(
    normalizedModel &&
      (normalizedModel === "auto" ||
        normalizedModel === "provider:auto" ||
        normalizedModel.includes("/auto") ||
        normalizedModel.includes("router") ||
        normalizedModel.includes("provider:auto")),
  );
  if (isOpenRouterRoute && isOpenRouterRouterModel && normalizedModel) {
    redactedSignals.push(`model:${normalizedModel}`);
  }

  return {
    normalizedProvider,
    normalizedModel,
    normalizedBaseUrl,
    isProviderAuto,
    isOpenRouterRoute,
    isOpenRouterRouterModel,
    redactedSignals,
  };
}

export function evaluateModelRoutePolicy(
  candidate: ModelRouteCandidate,
  options: EvaluateModelRoutePolicyOptions = {},
): ModelRoutePolicyDecision {
  const policy = options.policy ?? EDIS_OPENROUTER_MODEL_ROUTE_POLICY;
  const signals = collectRouteSignals(candidate);
  const normalizedProvider = signals.normalizedProvider ?? policy.defaultProvider;
  const normalizedModel = signals.normalizedModel ?? null;

  if (signals.isProviderAuto) {
    return {
      allowed: false,
      violationCode: "policy_provider_auto_disallowed",
      reason: "provider:auto is not allowed for EDIS model routes.",
      redactedSignals: signals.redactedSignals,
    };
  }

  if (!signals.isOpenRouterRoute) {
    return {
      allowed: true,
      normalizedProvider,
      normalizedModel,
      approvalId: null,
      warnings: [],
    };
  }

  if (signals.isOpenRouterRouterModel) {
    return {
      allowed: false,
      violationCode: "policy_openrouter_router_disallowed",
      reason: "OpenRouter router and dynamic selector model routes are disallowed.",
      redactedSignals: signals.redactedSignals,
    };
  }

  const allowedModel = policy.openRouter.allowedModels.find((model) => model.modelId === normalizedModel);
  if (!allowedModel) {
    return {
      allowed: false,
      violationCode: "policy_model_not_allowlisted",
      reason: "OpenRouter model is not present in the EDIS allowlist.",
      redactedSignals: signals.redactedSignals,
    };
  }

  const approval = options.approval ?? null;
  if (!isValidModelRouteApproval(candidate, allowedModel, approval, options.now ?? new Date())) {
    return {
      allowed: false,
      violationCode: "policy_openrouter_approval_required",
      reason: "OpenRouter routes require recorded approval before use.",
      requiredApprovalFields: [...REQUIRED_APPROVAL_FIELDS],
      redactedSignals: signals.redactedSignals,
    };
  }

  return {
    allowed: true,
    normalizedProvider: "openrouter",
    normalizedModel,
    approvalId: approval.id,
    warnings: [],
  };
}

export interface ModelRouteReportOnlyFinding {
  mode: "report_only";
  severity: "warning";
  path: string;
  message: string;
  candidate: ModelRouteCandidate;
  decision: Extract<ModelRoutePolicyDecision, { allowed: false }>;
}

export interface AuditModelRouteCandidateReportOnlyInput {
  candidate: ModelRouteCandidate;
  path?: string | null;
  options?: EvaluateModelRoutePolicyOptions;
}

export function auditModelRouteCandidateReportOnly(
  input: AuditModelRouteCandidateReportOnlyInput,
): ModelRouteReportOnlyFinding | null {
  const decision = evaluateModelRoutePolicy(input.candidate, input.options);
  if (decision.allowed) return null;

  return {
    mode: "report_only",
    severity: "warning",
    path: input.path ?? input.candidate.adapterConfigPath ?? "modelRoute",
    message: "Model route policy violation detected in report-only mode; runtime behavior was not blocked.",
    candidate: input.candidate,
    decision,
  };
}

function isValidModelRouteApproval(
  candidate: ModelRouteCandidate,
  allowedModel: OpenRouterAllowedModelRoute,
  approval: ModelRouteApproval | null,
  now: Date,
): approval is ModelRouteApproval {
  if (!approval) {
    return false;
  }

  if (normalizeModelRouteText(approval.provider) !== allowedModel.provider) {
    return false;
  }

  if (normalizeModelRouteText(approval.model) !== allowedModel.modelId) {
    return false;
  }

  if (candidate.usageCategory && approval.usageCategory !== candidate.usageCategory) {
    return false;
  }

  if (!allowedModel.usageCategories.includes(approval.usageCategory)) {
    return false;
  }

  if (approval.scopeKind !== candidate.scopeKind) {
    return false;
  }

  if ((approval.scopeId ?? null) !== (candidate.scopeId ?? null)) {
    return false;
  }

  const expiresAt = Date.parse(approval.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}
