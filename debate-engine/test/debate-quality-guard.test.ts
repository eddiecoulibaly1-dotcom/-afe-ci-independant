import test from "node:test";
import assert from "node:assert/strict";
import { createDeliberation, addContribution } from "../src/autonomous-agents/deliberation.js";
import { contributionQualityIssue } from "../src/autonomous-agents/orchestration.js";

test("later rounds must respond to another agent",()=>{
 const d=createDeliberation({workspaceId:"w",missionId:"m"});
 assert.match(contributionQualityIssue(d,"agent-b",2,"objection","Je conteste le raisonnement précédent avec un argument précis.",[] )??"",/répondre à une contribution/);
});
test("first round requires independent positions",()=>{
 const d=createDeliberation({workspaceId:"w",missionId:"m"});
 assert.match(contributionQualityIssue(d,"agent-a",1,"objection","Je conteste le raisonnement précédent avec un argument précis.",[])??"",/positions indépendantes/);
});
test("near-identical arguments without new evidence are rejected",()=>{
 let d=createDeliberation({workspaceId:"w",missionId:"m"});
 d=addContribution(d,{agentId:"agent-a",kind:"position",body:"Le contrôle de sécurité présente une faiblesse importante dans le processus étudié."});
 const issue=contributionQualityIssue(d,"agent-b",2,"objection","Le contrôle de sécurité présente une faiblesse importante dans le processus étudié.",[],d.contributions[0].id);
 assert.match(issue??"",/répétitive/);
});
test("a distinct targeted objection is accepted",()=>{
 let d=createDeliberation({workspaceId:"w",missionId:"m"});
 d=addContribution(d,{agentId:"agent-a",kind:"position",body:"Le contrôle de sécurité présente une faiblesse importante dans le processus étudié."});
 const issue=contributionQualityIssue(d,"agent-b",2,"objection","Je conteste cette conclusion car le contrôle compensatoire est documenté et testé dans le scénario de reprise.",[],d.contributions[0].id);
 assert.equal(issue,null);
});
