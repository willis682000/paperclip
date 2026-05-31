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
