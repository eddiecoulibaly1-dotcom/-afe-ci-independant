import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.VERCEL = "1";
process.env.SUPABASE_URL = "https://auth-test.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (requestUrl === "https://auth-test.invalid/auth/v1/user") {
    return Response.json({ id: "integration-test-user", email: "integration@example.invalid" });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const { default: handler } = await import("../src/server.js");
const server = createServer(handler);

test("Market Intelligence HTTP routes stay hidden unless explicitly enabled", async (t) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/market-prices/chick-catalog`;

  for (const flag of [undefined, "false", "TRUE", "1"]) {
    if (flag === undefined) delete process.env.MARKET_INTELLIGENCE_ENABLED;
    else process.env.MARKET_INTELLIGENCE_ENABLED = flag;

    const response = await originalFetch(endpoint, {
      headers: { authorization: "Bearer integration-test-token" }
    });
    assert.equal(response.status, 404, `expected 404 when MARKET_INTELLIGENCE_ENABLED=${String(flag)}`);
    assert.match((await response.json() as { error: string }).error, /désactivé/i);
  }

  process.env.MARKET_INTELLIGENCE_ENABLED = "true";
  const enabledResponse = await originalFetch(endpoint, {
    headers: { authorization: "Bearer integration-test-token" }
  });
  assert.equal(enabledResponse.status, 200);
  const payload = await enabledResponse.json() as { category: string; currency: string };
  assert.equal(payload.category, "chick");
  assert.equal(payload.currency, "XOF");
});
