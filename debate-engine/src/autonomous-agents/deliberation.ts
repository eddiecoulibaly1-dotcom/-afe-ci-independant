import { randomUUID } from "node:crypto";
export type ContributionKind="position"|"objection"|"rebuttal"|"evidence_review"|"revision";
export type DeliberationStatus="open"|"arbitrating"|"completed"|"cancelled";
export type Contribution={id:string;round:number;agentId:string;kind:ContributionKind;body:string;evidenceIds:string[];respondsTo?:string;createdAt:string};
export type Deliberation={id:string;workspaceId:string;missionId:string;status:DeliberationStatus;round:number;maxRounds:number;maxContributions:number;contributions:Contribution[];createdAt:string;updatedAt:string};
export function createDeliberation(input:{workspaceId:string;missionId:string;maxRounds?:number;maxContributions?:number},now=new Date()):Deliberation{
 if(!input.workspaceId||!input.missionId)throw new Error("Workspace and mission are required.");
 return{id:randomUUID(),workspaceId:input.workspaceId,missionId:input.missionId,status:"open",round:1,maxRounds:Math.max(1,Math.min(8,input.maxRounds??5)),maxContributions:Math.max(2,Math.min(64,input.maxContributions??24)),contributions:[],createdAt:now.toISOString(),updatedAt:now.toISOString()};
}
export function addContribution(d:Deliberation,input:{agentId:string;kind:ContributionKind;body:string;evidenceIds?:string[];respondsTo?:string},now=new Date()):Deliberation{
 if(d.status!=="open")throw new Error("Deliberation is not open.");
 if(d.contributions.length>=d.maxContributions)throw new Error("Contribution budget exhausted.");
 if(!input.agentId||input.body.trim().length<10)throw new Error("Agent and substantive contribution are required.");
 if(input.respondsTo&&!d.contributions.some(c=>c.id===input.respondsTo))throw new Error("Referenced contribution does not exist.");
 const c:Contribution={id:randomUUID(),round:d.round,agentId:input.agentId,kind:input.kind,body:input.body.trim(),evidenceIds:[...new Set(input.evidenceIds??[])],respondsTo:input.respondsTo,createdAt:now.toISOString()};
 return{...d,contributions:[...d.contributions,c],updatedAt:now.toISOString()};
}
export function advanceRound(d:Deliberation,now=new Date()):Deliberation{
 if(d.status!=="open")throw new Error("Deliberation is not open.");
 if(d.round>=d.maxRounds) return {...d,status:"arbitrating",updatedAt:now.toISOString()};
 if(d.contributions.filter(c=>c.round===d.round).length===0)throw new Error("Cannot advance an empty round.");
 return{...d,round:d.round+1,updatedAt:now.toISOString()};
}
export function beginArbitration(d:Deliberation,now=new Date()):Deliberation{
 if(d.status!=="open")throw new Error("Deliberation is not open.");
 return{...d,status:"arbitrating",updatedAt:now.toISOString()};
}
export function completeDeliberation(d:Deliberation):Deliberation{
 if(d.status!=="arbitrating")throw new Error("Arbitration has not started.");
 return{...d,status:"completed",updatedAt:new Date().toISOString()};
}
