import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyRetryFailure, computeRetryDelaySeconds } from "../src/autonomous-agents/retry-policy.js";

test("E13.3 classifies timeout/network and rate limits as retryable with typed codes", () => {
  assert.equal(classifyRetryFailure(new Error("Supabase 503: unavailable")).retryable, true);
  assert.equal(classifyRetryFailure(new Error("ETIMEDOUT request timed out")).code, "TIMEOUT");
  assert.equal(classifyRetryFailure(new Error("provider rate limit retry-after: 45")).retryAfterSeconds, 45);
  assert.equal(classifyRetryFailure(new Error("Supabase 429: rate limit")).code, "RATE_LIMITED");
});

test("E13.3 rejects permanent 4xx and validation/configuration errors from retry loops", () => {
  assert.equal(classifyRetryFailure(new Error("Supabase 401: Unauthorized")).retryable, false);
  assert.equal(classifyRetryFailure(new Error("Supabase 404: not found")).retryable, false);
  assert.equal(classifyRetryFailure(new Error("Invalid mission schema")).retryable, false);
});

test("E13.3 exponential delay increases by attempt and remains capped", () => {
  const d1=computeRetryDelaySeconds(1),d2=computeRetryDelaySeconds(2),d3=computeRetryDelaySeconds(3);
  assert.ok(d1>=15&&d1<=18); assert.ok(d2>=30&&d2<=36); assert.ok(d3>=60&&d3<=72);
  assert.ok(computeRetryDelaySeconds(20,900)<=900);
});

test("E13.3 retry-after overrides backoff but is clamped to the configured ceiling", () => {
  assert.equal(computeRetryDelaySeconds(2,900,50),50);
  assert.equal(computeRetryDelaySeconds(2,900,2000),900);
  assert.equal(computeRetryDelaySeconds(2,900,0),1);
});


test("E13.3 worker applies classified failures, max-attempt ceilings, and bounded deliberation retries", async () => {
  const worker=await readFile(new URL("../src/autonomous-agents/worker.ts",import.meta.url),"utf8");
  assert.match(worker,/classifyRetryFailure\(error\)/);
  assert.match(worker,/terminal=!classification\.retryable\|\|attempt>=maxAttempts/);
  assert.match(worker,/computeRetryDelaySeconds\(attempt,900,classification\.retryAfterSeconds\)/);
  assert.match(worker,/DELIBERATION_INCOMPLETE/);
  assert.match(worker,/terminal=attempt>=maxAttempts/);
  assert.match(worker,/event_type:terminal\?"mission\.failed":"mission\.deliberation_incomplete"/);
});
