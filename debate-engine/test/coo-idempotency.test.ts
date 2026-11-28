import test from "node:test";
import assert from "node:assert/strict";
import { cooIdempotencyKey, validateUniqueCooTaskResults, assertCooPublicationFence } from "../src/coo-idempotency.js";

test("E13.4 stable logical idempotency key is deterministic",()=>{
 const a=cooIdempotencyKey({workspaceId:"w1",missionId:"m1",operation:"deliverables.submit"});
 const b=cooIdempotencyKey({workspaceId:"w1",missionId:"m1",operation:"deliverables.submit"});
 assert.equal(a,b);
});

test("E13.4 operation identity isolates workspaces, missions and operations",()=>{
 const base={workspaceId:"w1",missionId:"m1",operation:"event.review"};
 assert.notEqual(cooIdempotencyKey(base),cooIdempotencyKey({...base,workspaceId:"w2"}));
 assert.notEqual(cooIdempotencyKey(base),cooIdempotencyKey({...base,missionId:"m2"}));
 assert.notEqual(cooIdempotencyKey(base),cooIdempotencyKey({...base,operation:"event.submit"}));
});

test("E13.4 lease-scoped idempotency keys isolate claim attempts",()=>{
 const base={workspaceId:"w1",missionId:"m1",operation:"publish.result"};
 assert.notEqual(cooIdempotencyKey({...base,leaseToken:"lease-a"}),cooIdempotencyKey({...base,leaseToken:"lease-b"}));
});

test("E13.4 duplicate task result IDs are rejected, not silently Map-collapsed",()=>{
 assert.throws(()=>validateUniqueCooTaskResults([{taskId:"t1"},{taskId:"t1"}]),/Duplicate COO task result/);
});

test("E13.4 empty task result IDs are rejected",()=>{
 assert.throws(()=>validateUniqueCooTaskResults([{taskId:""}]),/empty taskId/);
});

test("E13.4 valid task result IDs are preserved",()=>{
 assert.deepEqual(validateUniqueCooTaskResults([{taskId:"t1"},{taskId:"t2"}]),["t1","t2"]);
});

test("E13.4 publication fence rejects stale or foreign claims",()=>{
 const claim={mission_id:"m1",workspace_id:"w1",lease_token:"lease-current"};
 assert.doesNotThrow(()=>assertCooPublicationFence(claim,{missionId:"m1",workspaceId:"w1",leaseToken:"lease-current"}));
 assert.throws(()=>assertCooPublicationFence(claim,{missionId:"m1",workspaceId:"w1",leaseToken:"lease-old"}),/fence mismatch/);
 assert.throws(()=>assertCooPublicationFence(claim,{missionId:"m1",workspaceId:"w2",leaseToken:"lease-current"}),/fence mismatch/);
});
