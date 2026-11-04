import test from "node:test";
import assert from "node:assert/strict";
import { auditClaims } from "../src/evidence.js";

test("une référence déclarée mais non vérifiée reste en attente",()=>{
 const audit=auditClaims([{id:"C1",statement:"Une affirmation factuelle",type:"fact",confidence:0.95,evidenceRequired:true,evidenceRefs:["https://example.org/source"]}]);
 assert.equal(audit.records[0].status,"pending_verification");
 assert.equal(audit.records[0].confidence,0);
 assert.equal(audit.blocking,true);
 assert.deepEqual(audit.pendingVerificationClaims,["C1"]);
});
test("une affirmation factuelle sans référence est non étayée",()=>{
 const audit=auditClaims([{id:"C2",statement:"Une autre affirmation",type:"fact",confidence:0.9,evidenceRequired:true,evidenceRefs:[]}]);
 assert.equal(audit.records[0].status,"unsupported");
 assert.equal(audit.blocking,true);
});
