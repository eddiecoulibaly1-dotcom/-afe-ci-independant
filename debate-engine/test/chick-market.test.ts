import test from "node:test";
import assert from "node:assert/strict";
import { CHICK_PRICE_SUPPLIERS, CHICK_QUOTATION_FIELDS } from "../src/chick-market-catalog.js";
import { parseMarketCsv, validateMarketObservation } from "../src/market-sources.js";

const base = {
  id: "supplier-quote-2026-11-02",
  product: "Poussin de chair d'un jour",
  normalizedProduct: "poussin chair jour",
  kind: "input_purchase",
  value: 650,
  currency: "XOF",
  unit: "FCFA/sujet",
  country: "Côte d'Ivoire",
  city: "Abidjan",
  sourceName: "Ivoire Poussins",
  sourceUrl: "https://groupeavos.ci/",
  sourceClass: "official_supplier",
  observedAt: "2026-11-02T08:00:00Z",
  retrievedAt: "2026-11-02T08:05:00Z",
  productCategory: "chick",
  strain: "Cobb 500",
  vaccinationStatus: "Marek",
  minimumQuantity: 50,
  packSize: 50,
  deliveryFee: 5000,
  availabilityDate: "2026-11-10"
};

test("registers the three priority suppliers without inventing their tariffs", () => {
  assert.deepEqual(CHICK_PRICE_SUPPLIERS.map(s => s.id), [
    "ivoire-poussins", "ivograin", "koudijs-poussin-dor"
  ]);
  assert.ok(CHICK_PRICE_SUPPLIERS.every(s => s.notes.includes("tarif") || s.notes.includes("Vérifier")));
  assert.ok(CHICK_QUOTATION_FIELDS.includes("vaccinationStatus"));
});

test("validates chick-specific quote metadata", () => {
  const quote = validateMarketObservation(base);
  assert.equal(quote.productCategory, "chick");
  assert.equal(quote.strain, "Cobb 500");
  assert.equal(quote.minimumQuantity, 50);
  assert.equal(quote.deliveryFee, 5000);
});

test("rejects invalid minimum quantities and delivery fees", () => {
  assert.throws(() => validateMarketObservation({ ...base, minimumQuantity: 0 }), /Quantité invalide/);
  assert.throws(() => validateMarketObservation({ ...base, deliveryFee: -1 }), /Frais de livraison/);
});

test("parses chick supplier quotations from CSV", () => {
  const headers = "id,product,normalizedProduct,kind,value,currency,unit,country,city,sourceName,sourceUrl,sourceClass,observedAt,retrievedAt,productCategory,strain,vaccinationStatus,minimumQuantity,packSize,deliveryFee,availabilityDate";
  const row = "quote-1,Poussin chair,poussin chair,input_purchase,650,XOF,FCFA/sujet,Côte d'Ivoire,Abidjan,Ivoire Poussins,https://groupeavos.ci/,official_supplier,2026-11-02T08:00:00Z,2026-11-02T08:05:00Z,chick,Cobb 500,Marek,50,50,5000,2026-11-10";
  const parsed = parseMarketCsv(headers + "\n" + row);
  assert.equal(parsed[0].strain, "Cobb 500");
  assert.equal(parsed[0].minimumQuantity, 50);
});
