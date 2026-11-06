import { createHash } from "node:crypto";

export type EvidenceSourceKind = "github_file" | "github_commit" | "migration" | "test_result" | "ci_run";
export type Verification = "verified" | "partial" | "unverified";
export type EvidenceArtifact = {
  id: string; workspaceId: string; sourceKind: EvidenceSourceKind; sourceUri: string;
  repository: string; ref: string; commitSha: string; path?: string;
  lineStart?: number; lineEnd?: number; contentSha256: string; collectedAt: string;
  collectorVersion: "1.0.0"; accessMode: "read_only"; verification: Verification;
  excerpt?: string; metadata: Record<string,string|number|boolean|null>;
};
export type EvidenceRequest = {
  workspaceId: string; repository: string; ref: string; commitSha: string;
  path: string; startLine?: number; endLine?: number;
};
export type EvidencePolicy = {
  allowedRepositories: ReadonlySet<string>; allowedRefs: ReadonlySet<string>;
  allowedPathPrefixes: readonly string[]; maxBytes: number; maxExcerptChars: number;
};
export type ReadOnlyGitProvider = {
  resolveCommit(repository: string, ref: string): Promise<string>;
  readFile(repository: string, commitSha: string, path: string): Promise<string>;
};
const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g,
  /((?:api[_-]?key|secret|password|token)\s*[:=]\s*)["']?[^\s"'&,;]{8,}/gi,
];
export function redactEvidence(input: string): string {
  return secretPatterns.reduce((s,p)=>s.replace(p, "[REDACTED]"), input);
}
export function sha256(input: string): string { return createHash("sha256").update(input,"utf8").digest("hex"); }
function safePath(path: string): boolean {
  return !!path && !path.startsWith("/") && !path.includes("\\") &&
    path.split("/").every(part => part && part !== "." && part !== "..") &&
    !/(^|\/)(\.env(?:\.|$)|secrets?)(\/|$)/i.test(path);
}
export async function collectGitEvidence(
  request: EvidenceRequest, policy: EvidencePolicy, provider: ReadOnlyGitProvider,
  now = new Date()
): Promise<EvidenceArtifact> {
  if (!policy.allowedRepositories.has(request.repository)) throw new Error("Repository outside evidence allow-list.");
  if (!policy.allowedRefs.has(request.ref)) throw new Error("Ref outside evidence allow-list.");
  if (!safePath(request.path) || !policy.allowedPathPrefixes.some(p=>request.path.startsWith(p))) throw new Error("Path outside evidence allow-list.");
  const resolved = await provider.resolveCommit(request.repository, request.ref);
  if (resolved !== request.commitSha) throw new Error("Commit changed; evidence request must be refreshed.");
  const raw = await provider.readFile(request.repository, resolved, request.path);
  if (Buffer.byteLength(raw,"utf8") > policy.maxBytes) throw new Error("Evidence file exceeds size limit.");
  const clean = redactEvidence(raw);
  const lines = clean.split(/\r?\n/);
  const start = Math.max(1, request.startLine ?? 1);
  const end = Math.min(lines.length, request.endLine ?? lines.length);
  if (end < start) throw new Error("Invalid evidence line range.");
  const excerpt = lines.slice(start-1,end).join("\n").slice(0,policy.maxExcerptChars);
  const canonical = [request.repository,resolved,request.path,String(start),String(end),excerpt].join("\n");
  return {
    id: "ev_"+sha256(canonical).slice(0,32), workspaceId: request.workspaceId,
    sourceKind: request.path.endsWith(".sql") ? "migration" : "github_file",
    sourceUri: "https://github.com/"+request.repository+"/blob/"+resolved+"/"+request.path,
    repository: request.repository, ref: request.ref, commitSha: resolved, path: request.path,
    lineStart:start,lineEnd:end,contentSha256:sha256(canonical),collectedAt:now.toISOString(),
    collectorVersion:"1.0.0",accessMode:"read_only",verification:"verified",
    excerpt,metadata:{redacted:excerpt.includes("[REDACTED]"),totalLines:lines.length}
  };
}
export type AuditFinding = {
  id:string; title:string; statement:string; severity:"critical"|"high"|"medium"|"low"|"info";
  likelihood:1|2|3|4|5; impact:1|2|3|4|5; rationale:string;
  evidenceIds:string[]; verification:"verified"|"partially_verified"|"unverified"|"out_of_scope";
  limitations:string[]; counterArguments:string[]; recommendation:string; closureCriteria:string[];
};
export function validateFinding(f:AuditFinding, evidence:ReadonlyMap<string,EvidenceArtifact>): AuditFinding {
  if (!f.id || !f.title || !f.statement || !f.rationale || !f.recommendation) throw new Error("Finding is missing required explanation.");
  if (f.likelihood<1 || f.likelihood>5 || f.impact<1 || f.impact>5) throw new Error("Risk scores must be between 1 and 5.");
  const found=f.evidenceIds.map(id=>evidence.get(id)).filter((x):x is EvidenceArtifact=>!!x);
  if (f.verification==="verified" && found.length===0) throw new Error("Verified finding requires at least one resolvable evidence artifact.");
  if (f.evidenceIds.some(id=>!evidence.has(id))) throw new Error("Finding references unknown evidence.");
  if (f.verification==="verified" && found.some(x=>x.verification!=="verified")) throw new Error("Verified finding cannot rely on unverified evidence.");
  return f;
}
export class EvidenceRegistry {
  private readonly artifacts = new Map<string,EvidenceArtifact>();
  add(artifact:EvidenceArtifact):EvidenceArtifact {
    const prior=this.artifacts.get(artifact.id);
    if(prior && prior.contentSha256!==artifact.contentSha256) throw new Error("Evidence id collision.");
    if(!prior)this.artifacts.set(artifact.id,Object.freeze({...artifact,metadata:{...artifact.metadata}}));
    return this.artifacts.get(artifact.id)!;
  }
  get(id:string,workspaceId:string):EvidenceArtifact|undefined {
    const item=this.artifacts.get(id); return item?.workspaceId===workspaceId?item:undefined;
  }
  list(workspaceId:string):EvidenceArtifact[]{return [...this.artifacts.values()].filter(x=>x.workspaceId===workspaceId);}
}
