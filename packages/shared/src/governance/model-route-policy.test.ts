import { describe, expect, it } from "vitest";
import {
  collectRouteSignals,
  EDIS_OPENROUTER_MODEL_ROUTE_POLICY,
  evaluateModelRoutePolicy,
  type ModelRouteCandidate,
  type ModelRoutePolicyDecision,
  type ModelRouteViolationCode,
} from "./model-route-policy.js";

describe("EDIS OpenRouter model route policy", () => {
  it("defines the primary EDI route and disallows provider:auto", () => {
    expect(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.defaultProvider).toBe("openai-codex");
    expect(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.defaultModel).toBe("gpt-5.5");
    expect(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.providerAutoAllowed).toBe(false);
    expect(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.blockedPatterns).toContain("provider:auto");
  });

  it("keeps OpenRouter denied by default and approval-required for every allowlisted model", () => {
    expect(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.defaultAllowed).toBe(false);
    expect(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.allowedModels).toHaveLength(9);

    for (const model of EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.allowedModels) {
      expect(model.provider).toBe("openrouter");
      expect(model.modelId).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
      expect(model.standingApproval).toBe(false);
      expect(model.requiresApproval).toBe(true);
    }
  });

  it("contains the exact initial allowlist from EDI-94", () => {
    expect(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.allowedModels.map((model) => model.modelId)).toEqual([
      "google/gemini-2.5-flash-lite",
      "openai/gpt-4.1-nano",
      "qwen/qwen3-30b-a3b",
      "mistralai/mistral-small-3.2-24b-instruct",
      "meta-llama/llama-3.3-70b-instruct",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat-v3-0324",
      "qwen/qwen3-235b-a22b",
      "openai/gpt-4.1-mini",
    ]);
  });

  it("uses the intended usage categories and cost tier ceilings", () => {
    const byId = new Map(
      EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.allowedModels.map((model) => [model.modelId, model]),
    );

    expect(byId.get("google/gemini-2.5-flash-lite")?.usageCategories).toEqual(["cheap_docs"]);
    expect(byId.get("openai/gpt-4.1-mini")?.usageCategories).toEqual([
      "emergency_backup",
      "coding_fallback",
    ]);

    for (const model of EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.allowedModels) {
      if (model.tier === "tier1") {
        expect(model.maxInputUsdPerMillion).toBeLessThanOrEqual(0.15);
        expect(model.maxOutputUsdPerMillion).toBeLessThanOrEqual(0.6);
      }
      if (model.tier === "tier2") {
        expect(model.maxInputUsdPerMillion).toBeLessThanOrEqual(0.75);
        expect(model.maxOutputUsdPerMillion).toBeLessThanOrEqual(3);
      }
    }
  });

  it("exports type shapes for future route policy evaluation without adding enforcement", () => {
    const candidate: ModelRouteCandidate = {
      companyId: "company-1",
      actorKind: "agent",
      actorId: "agent-1",
      scopeKind: "issue",
      scopeId: "issue-1",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      usageCategory: "coding_fallback",
      envKeysPresent: ["OPENROUTER_API_KEY"],
    };

    const denial: ModelRoutePolicyDecision = {
      allowed: false,
      violationCode: "policy_openrouter_approval_required",
      reason: "OpenRouter routes require recorded approval before use.",
      requiredApprovalFields: ["provider", "model", "usageCategory", "scopeKind", "scopeId", "expiresAt"],
      redactedSignals: candidate.envKeysPresent,
    };

    const violationCode: ModelRouteViolationCode = denial.violationCode;

    expect(candidate.provider).toBe("openrouter");
    expect(violationCode).toBe("policy_openrouter_approval_required");
  });

  it("does not contain secret-like policy constant values", () => {
    const stringValues = JSON.stringify(Object.values(EDIS_OPENROUTER_MODEL_ROUTE_POLICY.openRouter.allowedModels));

    expect(stringValues).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(stringValues).not.toMatch(/api[_-]?key/i);
    expect(stringValues).not.toMatch(/secret/i);
    expect(stringValues).not.toMatch(/bearer/i);
  });

  it("allows the non-OpenRouter primary Codex route", () => {
    const decision = evaluateModelRoutePolicy({
      companyId: "company-1",
      actorKind: "agent",
      scopeKind: "issue",
      provider: "OpenAI-Codex",
      model: " GPT-5.5 ",
      usageCategory: "primary",
    });

    expect(decision).toEqual({
      allowed: true,
      normalizedProvider: "openai-codex",
      normalizedModel: "gpt-5.5",
      approvalId: null,
      warnings: [],
    });
  });

  it("denies provider:auto before any OpenRouter model checks", () => {
    const decision = evaluateModelRoutePolicy({
      companyId: "company-1",
      actorKind: "agent",
      scopeKind: "issue",
      provider: "auto",
      model: "google/gemini-2.5-flash",
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.violationCode).toBe("policy_provider_auto_disallowed");
      expect(decision.redactedSignals).toContain("provider:auto");
    }
  });

  it("collects OpenRouter route signals from provider, base URL, and env key presence without leaking secrets", () => {
    const signals = collectRouteSignals({
      companyId: "company-1",
      actorKind: "agent",
      scopeKind: "issue",
      provider: "OpenRouter",
      model: "google/gemini-2.5-flash",
      baseUrl: "https://openrouter.ai/api/v1",
      envKeysPresent: ["OPENROUTER_API_KEY", "OPENAI_API_KEY"],
    });

    expect(signals.normalizedProvider).toBe("openrouter");
    expect(signals.normalizedModel).toBe("google/gemini-2.5-flash");
    expect(signals.isOpenRouterRoute).toBe(true);
    expect(signals.redactedSignals).toEqual([
      "provider:openrouter",
      "baseUrl:openrouter.ai",
      "env:OPENROUTER_API_KEY_PRESENT",
    ]);
    expect(JSON.stringify(signals.redactedSignals)).not.toContain("sk-");
  });

  it("denies OpenRouter router or dynamic selector model IDs", () => {
    const decision = evaluateModelRoutePolicy({
      companyId: "company-1",
      actorKind: "agent",
      scopeKind: "issue",
      provider: "openrouter",
      model: "openrouter/auto",
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.violationCode).toBe("policy_openrouter_router_disallowed");
      expect(decision.redactedSignals).toContain("model:openrouter/auto");
    }
  });

  it("denies non-allowlisted OpenRouter models", () => {
    const decision = evaluateModelRoutePolicy({
      companyId: "company-1",
      actorKind: "agent",
      scopeKind: "issue",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.violationCode).toBe("policy_model_not_allowlisted");
    }
  });

  it("requires valid approval data for exact allowlisted OpenRouter model IDs", () => {
    const candidate: ModelRouteCandidate = {
      companyId: "company-1",
      actorKind: "agent",
      actorId: "agent-1",
      scopeKind: "issue",
      scopeId: "issue-1",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      usageCategory: "coding_fallback",
    };

    const denied = evaluateModelRoutePolicy(candidate);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.violationCode).toBe("policy_openrouter_approval_required");
      expect(denied.requiredApprovalFields).toEqual([
        "approvalId",
        "provider",
        "model",
        "usageCategory",
        "scopeKind",
        "scopeId",
        "expiresAt",
      ]);
    }

    const approved = evaluateModelRoutePolicy(candidate, {
      approval: {
        id: "approval-1",
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        usageCategory: "coding_fallback",
        scopeKind: "issue",
        scopeId: "issue-1",
        expiresAt: "2999-01-01T00:00:00.000Z",
      },
    });

    expect(approved).toEqual({
      allowed: true,
      normalizedProvider: "openrouter",
      normalizedModel: "openai/gpt-4.1-mini",
      approvalId: "approval-1",
      warnings: [],
    });
  });
});
