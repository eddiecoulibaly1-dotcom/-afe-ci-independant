export const proposalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    position: { type: "string" },
    claims: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "string" }, statement: { type: "string" },
        type: { type: "string", enum: ["fact", "hypothesis", "opinion"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidenceRequired: { type: "boolean" }
      }, required: ["id", "statement", "type", "confidence", "evidenceRequired"]
    }},
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    alternatives: { type: "array", items: { type: "string" } },
    scoreExpected: { type: "number", minimum: 0, maximum: 100 },
    nextTests: { type: "array", items: { type: "string" } }
  },
  required: ["position", "claims", "assumptions", "risks", "alternatives", "scoreExpected", "nextTests"]
} as const;

export const critiqueSchema = {
  type: "object", additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["challenge", "accept", "mixed"] },
    attacks: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: {
        claimId: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        argument: { type: "string" },
        evidenceNeeded: { type: "array", items: { type: "string" } },
        counterproposal: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      }, required: ["claimId", "severity", "argument", "evidenceNeeded", "counterproposal", "confidence"]
    }},
    strongestAlternative: { type: "string" },
    unresolvedQuestions: { type: "array", items: { type: "string" } }
  },
  required: ["verdict", "attacks", "strongestAlternative", "unresolvedQuestions"]
} as const;

export const judgeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["revise", "converged", "unresolved"] },
    winner: { type: "string", enum: ["architect", "red_team", "neither"] },
    architectScore: { type: "number", minimum: 0, maximum: 100 },
    redTeamScore: { type: "number", minimum: 0, maximum: 100 },
    acceptedClaims: { type: "array", items: { type: "string" } },
    rejectedClaims: { type: "array", items: { type: "string" } },
    criticalDisagreements: { type: "array", items: { type: "string" } },
    decision: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    nextRoundObjective: { type: "string" }
  },
  required: ["status", "winner", "architectScore", "redTeamScore", "acceptedClaims", "rejectedClaims", "criticalDisagreements", "decision", "rationale", "nextRoundObjective"]
} as const;
