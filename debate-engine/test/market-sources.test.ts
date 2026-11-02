import test from "node:test";
import assert from "node:assert/strict";
import { fetchConfiguredMarketFeed, parseMarketCsv, validateMarketObservation } from "../src/market-sources.js";

const observation = {
  id: "simagri-mais-001",
  product: "maïs jaune",
  normalizedProduct: "mais jaune",
  kind: "raw_material",
  value: 215,
  currency: "XOF",
  unit: "FCFA/kg",
  country: "Côte d'Ivoire",
  region: "Gbêkê",
  city: "Bouaké",
  sourceName: "SIMAgri",
  sourceUrl: "https://simagri-ci.info/product-detail/mais-jaune",
  sourceClass: "public_market_system",
  publishedAt: "2026-10-28T00:00:00Z",
  retrievedAt: "2026-10-29T00:00:00Z"
};

test("validates a traceable market observation", () => {
  const result = validateMarketObservation(observation);
  assert.equal(result.value, 215);
  assert.equal(result.sourceName, "SIMAgri");
});

test("rejects insecure source URLs and invalid values", () => {
  assert.throws(() => validateMarketObservation({ ...observation, sourceUrl: "http://example.com" }), /HTTPS/);
  assert.throws(() => validateMarketObservation({ ...observation, value: -1 }), /valeur numérique/);
});

test("parses CSV exports with quoted commas", () => {
  const headers = "id,product,normalizedProduct,kind,value,currency,unit,country,region,city,sourceName,sourceUrl,sourceClass,publishedAt,retrievedAt";
  const row = 'simagri-1,"maïs jaune","mais jaune",raw_material,215,XOF,FCFA/kg,"Côte d\'Ivoire",Gbêkê,Bouaké,SIMAgri,https://simagri-ci.info/product-detail/mais-jaune,public_market_system,2026-10-28T00:00:00Z,2026-10-29T00:00:00Z';
  const result = parseMarketCsv(headers + "\n" + row);
  assert.equal(result.length, 1);
  assert.equal(result[0].city, "Bouaké");
});

test("requires an explicitly configured HTTPS feed", async () => {
  await assert.rejects(
    () => fetchConfiguredMarketFeed(async () => { throw new Error("must not fetch"); }, {}),
    /MARKET_PRICE_FEED_URL/
  );
});

test("loads and validates a configured JSON feed", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    source: "SIMAgri export",
    observations: [observation]
  }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await fetchConfiguredMarketFeed(fakeFetch, {
    MARKET_PRICE_FEED_URL: "https://feeds.example.ci/market-prices"
  });
  assert.equal(result.observations.length, 1);
  assert.equal(result.source, "SIMAgri export");
});
