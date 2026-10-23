import type { Claim } from "./types.js";

export type EvidenceStatus = "supported" | "unsupported" | "not_required";
export type ClaimClassification = "fact" | "hypothesis" | "opinion";
export type EvidenceImpact = "low" | "medium" | "high" | "critical";

export interface EvidenceRecord {
  claimId: string;
  classification: ClaimClassification;
  status: EvidenceStatus;
  evidenceRefs: string[];
  rationale: string;
  confidence: number;
  impact: EvidenceImpact;
}

export interface EvidenceAudit {
  records: EvidenceRecord[];
  unsupportedCriticalClaims: string[];
  unsupportedHighImpactClaims: string[];
  confidence: number;
  blocking: boolean;
  nextTests: string[];
}

function impactForClaim(claim: Claim): EvidenceImpact {
  if (claim.type === "fact") return "high";
  if (claim.type === "hypothesis" && claim.confidence >= 0.7) return "high";
  if (claim.type === "hypothesis") return "medium";
  return "low";
}

export function auditClaims(claims: Claim[]): EvidenceAudit {
  const records: EvidenceRecord[] = claims.map((claim) => {
    const refs = claim.evidenceRefs ?? [];
    const impact = impactForClaim(claim);

    if (claim.type === "opinion" || !claim.evidenceRequired) {
      return {
        claimId: claim.id,
        classification: claim.type,
        status: "not_required",
        evidenceRefs: refs,
        rationale: "This claim is an opinion or explicitly does not require external evidence.",
        confidence: claim.confidence,
        impact: "low"
      };
    }

    if (refs.length === 0) {
      return {
        claimId: claim.id,
        classification: claim.type,
        status: "unsupported",
        evidenceRefs: [],
        rationale: "No evidence reference was declared. The claim cannot be treated as established evidence.",
        confidence: 0,
        impact
      };
    }

    return {
      claimId: claim.id,
      classification: claim.type,
      status: "supported",
      evidenceRefs: refs,
      rationale: "The proposal declares evidence references; external verification remains a separate validation step.",
      confidence: claim.confidence,
      impact
    };
  });

  const unsupported = records.filter((record) => record.status === "unsupported");
  const unsupportedCriticalClaims = unsupported.filter((record) => record.impact === "critical").map((record) => record.claimId);
  const unsupportedHighImpactClaims = unsupported.filter((record) => record.impact === "high").map((record) => record.claimId);
  const scored = records.filter((record) => record.status !== "not_required");
  const confidence = scored.length === 0
    ? 1
    : scored.reduce((sum, record) => sum + record.confidence, 0) / scored.length;

  return {
    records,
    unsupportedCriticalClaims: [...new Set(unsupportedCriticalClaims)],
    unsupportedHighImpactClaims: [...new Set(unsupportedHighImpactClaims)],
    confidence,
    blocking: unsupportedCriticalClaims.length > 0 || unsupportedHighImpactClaims.length > 0,
    nextTests: unsupported.map((record) => `Obtain or verify evidence for ${record.claimId}.`)
  };
}
