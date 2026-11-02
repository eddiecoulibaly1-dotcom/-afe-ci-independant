import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPoultryResearchPlan,
  rankMarketObservations,
  summarizeMarketEvidence
} from "../src/market-intelligence.js";

const sample = [
  { id: "gov", product: "maïs jaune", normalizedProduct: "mais jaune", kind: "raw_material" as const, value: 220, currency: "XOF", unit: "FCFA/kg", country: "Côte d'Ivoire", city: "Abidjan", sourceName: "OCPV", sourceUrl: "https://ocpv-ci.com", sourceClass: "government" as const, publishedAt: "2026-10-30T00:00:00Z", retrievedAt: "2026-11-01T00:00:00Z" },
  { id: "supplier", product: "maïs jaune", normalizedProduct: "mais jaune", kind: "raw_material" as const, value: 230, currency: "XOF", unit: "FCFA/kg", country: "Côte d'Ivoire", city: "Abidjan", sourceName: "Supplier", sourceUrl: "https://supplier.ci", sourceClass: "official_supplier" as const, publishedAt: "2026-10-28T00:00:00Z", retrievedAt: "2026-11-01T00:00:00Z" },
  { id: "old", product: "maïs jaune", normalizedProduct: "mais jaune", kind: "raw_material" as const, value: 180, currency: "XOF", unit: "FCFA/kg", country: "Côte d'Ivoire", city: "Bouaké", sourceName: "Old market", sourceUrl: "https://market.ci", sourceClass: "marketplace" as const, publishedAt: "2025-01-01T00:00:00Z", retrievedAt: "2026-11-01T00:00:00Z" }
];

test("ranks matching local observations by authority and freshness", () => {
  const ranked = rankMarketObservations({
    product: "maïs jaune", kind: "raw_material", country: "Côte d'Ivoire",
    city: "Abidjan", currency: "XOF", unit: "FCFA/kg", asOf: "2026-11-02T00:00:00Z"
  }, sample);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].observation.id, "gov");
  assert.ok(!ranked.some(item => item.observation.id === "old"));
});

test("labels a price as indicative when fewer than three usable sources corroborate it", () => {
  const ranked = rankMarketObservations({
    product: "maïs jaune", kind: "raw_material", country: "Côte d'Ivoire",
    city: "Abidjan", currency: "XOF", unit: "FCFA/kg", asOf: "2026-11-02T00:00:00Z"
  }, sample);
  const summary = summarizeMarketEvidence(ranked);
  assert.equal(summary.status, "indicative");
  assert.equal(summary.usableCount, 2);
});

test("creates a localized poultry research plan", () => {
  const plan = buildPoultryResearchPlan("Côte d'Ivoire", "Grand-Bassam");
  assert.ok(plan.some(p => p.product === "pintadeaux" && p.requiredGeography.includes("Grand-Bassam")));
  assert.ok(plan.some(p => p.preferredSources.includes("OCPV")));
});

test("excludes observations older than the 30-day policy", () => {
  const ranked = rankMarketObservations({
    product: "maïs jaune", kind: "raw_material", country: "Côte d'Ivoire",
    city: "Abidjan", currency: "XOF", unit: "FCFA/kg", asOf: "2026-11-02T00:00:00Z"
  }, sample);
  assert.ok(ranked.every(item => item.ageDays !== null && item.ageDays <= 30));
});

test("labels a fresh same-country observation outside the requested city as geographic fallback", () => {
  const outsideCity = {
    ...sample[0], id: "bouake-fresh", city: "Bouaké",
    publishedAt: "2026-11-01T00:00:00Z", retrievedAt: "2026-11-02T00:00:00Z"
  };
  const ranked = rankMarketObservations({
    product: "maïs jaune", kind: "raw_material", country: "Côte d'Ivoire",
    city: "Abidjan", currency: "XOF", unit: "FCFA/kg", asOf: "2026-11-02T00:00:00Z"
  }, [outsideCity]);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].warnings.some(w => w.includes("repli géographique à confirmer")));
});
