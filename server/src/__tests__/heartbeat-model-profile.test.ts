import { describe, expect, it } from "vitest";
import {
  listAdapterModelProfiles,
  type AdapterModelProfileDefinition,
} from "../adapters/index.js";
import {
  approvalRecordToAuthoritativeModelRouteApproval,
  assertRequestedModelProfileApplied,
  costTierRouteMetadata,
  mergeModelProfileAdapterConfig,
  normalizeModelProfileWakeContext,
  resolveModelProfileApplication,
} from "../services/heartbeat.ts";

const cheapProfile: AdapterModelProfileDefinition = {
  key: "cheap",
  label: "Cheap",
  adapterConfig: {
    model: "adapter-cheap",
    modelReasoningEffort: "low",
  },
  source: "adapter_default",
};

describe("heartbeat model profile application", () => {
  it("uses the Codex local adapter cheap default when the agent has no runtime override", async () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: await listAdapterModelProfiles("codex_local"),
      agentRuntimeConfig: {},
      issueModelProfile: "cheap",
      contextSnapshot: {},
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "issue_override",
      applied: "cheap",
      configSource: "adapter_default",
      fallbackReason: null,
      adapterConfig: {
        model: "gpt-5.3-codex-spark",
        modelReasoningEffort: "high",
      },
    });
  });

  it("applies cheap profile patches before explicit issue adapter config overrides", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {},
      issueModelProfile: "cheap",
      contextSnapshot: {},
    });

    const merged = mergeModelProfileAdapterConfig({
      baseConfig: {
        model: "primary",
        modelReasoningEffort: "high",
        approvalPolicy: "strict",
      },
      modelProfile,
      issueAdapterConfig: {
        model: "issue-explicit",
      },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "issue_override",
      applied: "cheap",
      configSource: "adapter_default",
      fallbackReason: null,
    });
    expect(merged).toEqual({
      model: "issue-explicit",
      modelReasoningEffort: "low",
      approvalPolicy: "strict",
    });
    expect(costTierRouteMetadata({
      modelProfile,
      provider: "openai-codex",
      model: "adapter-cheap",
    })).toMatchObject({
      costTier: "cheap",
      provider: "openai-codex",
      model: "adapter-cheap",
      routeReason: "cheap_model_profile_applied",
      fallbackUsed: false,
      failClosed: false,
    });
  });

  it("lets agent runtime profile config customize adapter defaults", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {
              model: "agent-cheap",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "wake_context",
      applied: "cheap",
      configSource: "agent_runtime",
      adapterConfig: {
        model: "agent-cheap",
        modelReasoningEffort: "low",
      },
    });
  });

  it("fails closed instead of falling back to the primary config when the requested profile is unsupported", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {
              model: "agent-cheap",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      applied: null,
      fallbackReason: "adapter_profile_not_supported",
      adapterConfig: null,
    });
    expect(() => assertRequestedModelProfileApplied(modelProfile)).toThrow(
      /refusing to fall back to the primary model/,
    );
    expect(costTierRouteMetadata({ modelProfile })).toMatchObject({
      costTier: "primary",
      routeReason: "cheap_model_profile_requested_but_not_applied",
      fallbackUsed: true,
      failClosed: true,
    });
  });

  it("does not request cheap for status-only recovery when the adapter lacks a cheap profile", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [],
      agentRuntimeConfig: {},
      issueModelProfile: null,
      contextSnapshot: {
        recoveryIntent: "status_only",
        allowDeliverableWork: false,
        allowDocumentUpdates: false,
        resumeRequiresNormalModel: true,
        modelProfile: "cheap",
      },
    });

    expect(modelProfile).toMatchObject({
      requested: null,
      requestedBy: null,
      applied: null,
      fallbackReason: null,
      adapterConfig: null,
    });
    expect(() => assertRequestedModelProfileApplied(modelProfile)).not.toThrow();
    expect(costTierRouteMetadata({ modelProfile })).toMatchObject({
      costTier: "primary",
      routeReason: "primary_model_work",
      fallbackUsed: false,
      failClosed: false,
    });
  });

  it("normalizes a wake payload model profile into run context", () => {
    const contextSnapshot = normalizeModelProfileWakeContext({
      contextSnapshot: {},
      payload: { modelProfile: "cheap" },
    });

    expect(contextSnapshot).toMatchObject({ modelProfile: "cheap" });
  });

  it("accepts only authoritative approved model-route records matching the run context", () => {
    const candidate = {
      companyId: "company-1",
      actorKind: "agent" as const,
      actorId: "agent-1",
      scopeKind: "issue" as const,
      scopeId: "issue-1",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      usageCategory: "coding_fallback" as const,
      runId: "run-1",
      approvalId: "approval-1",
    };
    const approvedRecord = {
      id: "approval-1",
      companyId: "company-1",
      type: "model_route",
      status: "approved",
      decidedByUserId: "operator-1",
      decidedAt: new Date("2026-01-01T00:00:00.000Z"),
      payload: {
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        usageCategory: "coding_fallback",
        scopeKind: "issue",
        scopeId: "issue-1",
        actorKind: "agent",
        actorId: "agent-1",
        runId: "run-1",
        expiresAt: "2999-01-01T00:00:00.000Z",
      },
    };

    expect(approvalRecordToAuthoritativeModelRouteApproval(candidate, approvedRecord)).toEqual({
      id: "approval-1",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      usageCategory: "coding_fallback",
      scopeKind: "issue",
      scopeId: "issue-1",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    for (const status of ["pending", "rejected", "revoked", "cancelled"]) {
      expect(approvalRecordToAuthoritativeModelRouteApproval(candidate, {
        ...approvedRecord,
        status,
      })).toBeNull();
    }

    expect(approvalRecordToAuthoritativeModelRouteApproval(candidate, {
      ...approvedRecord,
      payload: { ...approvedRecord.payload, runId: "other-run" },
    })).toBeNull();
    expect(approvalRecordToAuthoritativeModelRouteApproval(candidate, {
      ...approvedRecord,
      payload: { ...approvedRecord.payload, actorId: "other-agent" },
    })).toBeNull();
    expect(approvalRecordToAuthoritativeModelRouteApproval(candidate, {
      ...approvedRecord,
      payload: { ...approvedRecord.payload, scopeId: "other-issue" },
    })).toBeNull();
  });
});
