import { describe, expect, it } from "vitest";
import {
  EDIS_OPENROUTER_MODEL_ROUTE_POLICY,
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
});
