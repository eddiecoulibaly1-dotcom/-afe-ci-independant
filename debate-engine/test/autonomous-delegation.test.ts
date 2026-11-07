import test from "node:test";
import assert from "node:assert/strict";
import { canAddChildToCoordinator, canClaimCoordinator, summarizeDelegation } from "../src/autonomous-agents/delegation.js";

test("child creation is allowed only while a live coordinator delegation window is open",()=>{
 assert.equal(canAddChildToCoordinator({orchestrationMode:"coordinator",delegationState:"open",status:"queued"}),true);
 assert.equal(canAddChildToCoordinator({orchestrationMode:"coordinator",delegationState:"closed",status:"queued"}),false);
 assert.equal(canAddChildToCoordinator({orchestrationMode:"coordinator",delegationState:"open",status:"running"}),false);
 assert.equal(canAddChildToCoordinator({orchestrationMode:"leaf",delegationState:"open",status:"queued"}),false);
});

test("coordinator claim requires closed delegation and terminal children",()=>{
 assert.equal(canClaimCoordinator({orchestrationMode:"coordinator",delegationState:"open",children:[]}),false);
 assert.equal(canClaimCoordinator({orchestrationMode:"coordinator",delegationState:"closed",children:[{status:"completed"},{status:"failed"},{status:"cancelled"}]}),true);
 assert.equal(canClaimCoordinator({orchestrationMode:"coordinator",delegationState:"closed",children:[{status:"running"}]}),false);
 assert.equal(canClaimCoordinator({orchestrationMode:"leaf",delegationState:"open",children:[{status:"running"}]}),true);
});

test("delegation summary reports pending work without hiding terminal failures",()=>{
 assert.deepEqual(summarizeDelegation([{status:"completed"},{status:"failed"},{status:"cancelled"},{status:"running"}]),{
  total:4,completed:1,failed:1,cancelled:1,pending:1,readyForCoordinator:false
 });
 assert.equal(summarizeDelegation([]).readyForCoordinator,true);
});
