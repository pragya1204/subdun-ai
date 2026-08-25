import { GoogleGenAI } from "@google/genai";
import {
  AgentProposalSchema,
  OPERATIONS,
  TIMING_STRATEGIES,
  type AgentContext,
  type AgentProposal,
} from "@recovery/shared";
import { SYSTEM_INSTRUCTIONS } from "./systemInstructions.js";

const AGENT_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    operation: { type: "string", enum: OPERATIONS as unknown as string[] },
    timing_strategy: { type: "string", enum: TIMING_STRATEGIES as unknown as string[], nullable: true },
    reason: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["operation", "reason", "confidence"],
} as const;

const AGENT_TIMEOUT_MS = 30_000;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Exactly one bounded decision per call. No loop, no tools, no memory,
 * no direct writes. Output is untrusted input to Policy.
 */
export async function proposeNextOperation(ctx: AgentContext): Promise<AgentProposal> {
  const ai = getClient();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: JSON.stringify(ctx),
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS,
        responseMimeType: "application/json",
        responseSchema: AGENT_PROPOSAL_JSON_SCHEMA as unknown as Record<string, unknown>,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const text = response.text;
    if (!text) throw new Error("Empty Agent response");
    const raw = JSON.parse(text);
    return AgentProposalSchema.parse(raw);
  } finally {
    clearTimeout(timeout);
  }
}

/** Deterministic safe default used when the Agent errors, times out, or returns invalid output. */
export function fallbackProposal(ctx: AgentContext): AgentProposal {
  const hasTime =
    new Date(ctx.timing_context.now).getTime() < new Date(ctx.recovery_state.deadline).getTime();
  const canWait = hasTime && ctx.allowed_primitives.includes("WAIT") && ctx.allowed_timing_strategies.length > 0;
  if (canWait) {
    const timing = ctx.allowed_timing_strategies.includes("WAIT_24H")
      ? "WAIT_24H"
      : ctx.allowed_timing_strategies[0];
    return {
      operation: "WAIT",
      timing_strategy: timing,
      reason: "Deterministic fallback: waiting before re-evaluating.",
      confidence: 0,
    };
  }
  return {
    operation: "STOP",
    reason: "Deterministic fallback: no time/budget remaining or Agent unavailable.",
    confidence: 0,
  };
}
