import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);
const blueprintUrl = new URL("../../docs/organization/ORGANIZATION_BLUEPRINT_V1.md", import.meta.url);
const charterUrl = new URL("../../docs/organization/CHARTER.md", import.meta.url);

test("organization catalogue includes executive, operational, control and independent functions", async () => {
  const source = await readFile(platformUrl, "utf8");
  for (const slug of [
    "direction-generale","direction-operations","strategie-developpement",
    "finance-investissements","risques-controle","gouvernance-conformite",
    "evidence-intelligence","secretariat-general","operations-missions",
    "audit-qualite","documentation-reporting","infrastructure-securite",
    "audit-interne","arbitrage-independant","validation-humaine"
  ]) assert.ok(source.includes('slug: "' + slug + '"'), "Missing department " + slug);
});

test("the human executive authority and final human validation cannot be assigned to an AI director", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /slug: "direction-generale"[\s\S]*?humanOnly: true/);
  assert.match(source, /slug: "validation-humaine"[\s\S]*?humanOnly: true/);
  assert.match(source, /slug: "audit-interne"[\s\S]*?independent: true/);
  assert.match(source, /slug: "arbitrage-independant"[\s\S]*?independent: true/);
});

test("active AFE-CI department agent slugs are mapped to the institutional catalogue", async () => {
  const source = await readFile(platformUrl, "utf8");
  for (const slug of [
    "afe-ci-coo","afe-ci-strategie","afe-ci-finance-investissements",
    "directeur-risques-controle","directeur-gouvernance-conformite",
    "directeur-evidence-intelligence","directeur-secretariat-general",
    "directeur-operations-missions","directeur-audit-qualite",
    "directeur-documentation-reporting","directeur-technologie-innovation",
    "directeur-audit-interne","arbitre-independant-afe-ci"
  ]) assert.ok(source.includes('"' + slug + '"'), "Missing agent mapping " + slug);
});

test("the institutional blueprint states COO AI limits and reserved human decisions", async () => {
  const blueprint = await readFile(blueprintUrl, "utf8");
  const charter = await readFile(charterUrl, "utf8");
  assert.match(blueprint, /COO IA/);
  assert.match(blueprint, /Autorité de validation humaine/);
  assert.match(blueprint, /Audit interne indépendant/);
  assert.match(blueprint, /Arbitrage indépendant/);
  assert.match(blueprint, /Niveau initial des agents créés dans ce lot reste 1/);
  assert.match(charter, /Addendum 1\.1 — Nature du COO et lignes de rattachement/);
});
