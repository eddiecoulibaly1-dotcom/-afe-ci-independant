import test from "node:test";
import assert from "node:assert/strict";
import { authenticateRequest, publicAuthConfig } from "../src/auth.js";

const envKeys = [
  "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"
] as const;

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return run().finally(() => {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("auth fails closed if public and server Supabase keys are not both configured", async () => {
  await withEnv({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "server-secret",
    SUPABASE_PUBLISHABLE_KEY: undefined,
    SUPABASE_ANON_KEY: undefined
  }, async () => {
    assert.equal(publicAuthConfig(), null);
    const result = await authenticateRequest({ headers: { authorization: "Bearer token" } } as never);
    assert.equal(result, null);
  });
});

test("auth validates the caller token using the publishable key, never the server key", async () => {
  await withEnv({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "server-secret",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_ANON_KEY: undefined
  }, async () => {
    const originalFetch = globalThis.fetch;
    let receivedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      receivedHeaders = init?.headers;
      return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", email: "test@example.ci" }), { status: 200 });
    }) as typeof fetch;
    try {
      const user = await authenticateRequest({ headers: { authorization: "Bearer user-access-token" } } as never);
      assert.equal(user?.id, "11111111-1111-4111-8111-111111111111");
      const headers = new Headers(receivedHeaders);
      assert.equal(headers.get("apikey"), "public-key");
      assert.equal(headers.get("authorization"), "Bearer user-access-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("auth rejects missing, oversized and invalid bearer tokens", async () => {
  await withEnv({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "server-secret",
    SUPABASE_PUBLISHABLE_KEY: "public-key"
  }, async () => {
    const missing = await authenticateRequest({ headers: {} } as never);
    const oversized = await authenticateRequest({ headers: { authorization: "Bearer " + "x".repeat(8193) } } as never);
    assert.equal(missing, null);
    assert.equal(oversized, null);
  });
});
