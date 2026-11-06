import test from "node:test";
import assert from "node:assert/strict";
import { validateFinding, type EvidenceArtifact, type AuditFinding } from "../src/autonomous-agents/evidence.js";
import { buildArbitration } from "../src/autonomous-agents/arbitration.js";
import { createDeliberation, addContribution, beginArbitration } from "../src/autonomous-agents/deliberation.js";

const artifact:EvidenceArtifact={
 id:"ev-1",workspaceId:"w1",sourceKind:"github_file",sourceUri:"https://github.com/example/repo/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/file.ts",
 repository:"example/repo",ref:"feature/test",commitSha:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 path:"file.ts",lineStart:1,lineEnd:2,contentSha256:"b".repeat(64),collectedAt:"2026-11-06T00:00:00.000Z",
 collectorVersion:"1.0.0",accessMode:"read_only",verification:"verified",excerpt:"export const value = true;",
 metadata:{}
};
const finding=(overrides:Partial<AuditFinding>={}):AuditFinding=>({
 id:"F1",title:"Contrôle d'accès",statement:"Le contrôle d'accès est contournable dans le cas étudié.",
 severity:"high",likelihood:3,impact:4,rationale:"Analyse à vérifier.",
 evidenceIds:["ev-1"],evidenceAssessments:[],verification:"verified",
 limitations:[],counterArguments:[],recommendation:"Corriger le contrôle.",closureCriteria:["Test d'accès négatif."],
 ...overrides
});

test("provenance verified alone does not confirm a finding",()=>{
 assert.throws(()=>validateFinding(finding(),new Map([["ev-1",artifact]])),/supporting evidence assessment/);
});
test("verified finding requires explicit supporting relationship and rationale",()=>{
 const f=finding({evidenceAssessments:[{evidenceId:"ev-1",relation:"supports",rationale:"Le fichier montre le contrôle ciblé et son chemin d'exécution."}]});
 assert.equal(validateFinding(f,new Map([["ev-1",artifact]])).verification,"verified");
});
test("assessment cannot cite evidence outside the finding or omit rationale",()=>{
 const f=finding({evidenceAssessments:[{evidenceId:"unknown",relation:"supports",rationale:"Support"}]});
 assert.throws(()=>validateFinding(f,new Map([["ev-1",artifact]])),/must reference a finding evidence item/);
});
test("partially verified finding needs an explicit support or contradiction assessment",()=>{
 const f=finding({verification:"partially_verified",evidenceAssessments:[]});
 assert.throws(()=>validateFinding(f,new Map([["ev-1",artifact]])),/explicit evidence assessment/);
});
test("arbitration must return exactly one decision per canonical finding",()=>{
 let d=createDeliberation({workspaceId:"w1",missionId:"m1"});
 d=addContribution(d,{agentId:"a1",kind:"position",body:"Constat à examiner avec une justification suffisante."});
 d=beginArbitration(d);
 const f=finding({verification:"unverified",evidenceIds:[]});
 const input={deliberation:d,findings:[f],evidence:new Map(),limitations:[]};
 assert.throws(()=>buildArbitration({...input,decisions:[]}),/missing a decision/);
 assert.throws(()=>buildArbitration({...input,decisions:[
  {findingId:"F1",decision:"unresolved",rationale:"Analyse insuffisante.",evidenceIds:[],dissent:[]},
  {findingId:"F1",decision:"unresolved",rationale:"Deuxième décision.",evidenceIds:[],dissent:[]}
 ]}),/exactly one decision/);
});
