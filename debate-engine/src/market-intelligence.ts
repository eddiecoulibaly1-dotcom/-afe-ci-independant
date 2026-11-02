/**
 * Debate Engine V2.1 — Market Intelligence & Price Discovery
 *
 * Source-normalization and valuation layer. This module does not scrape sites
 * itself: adapters/search providers must supply captured observations with
 * their source URL, retrieval time, geography and publication metadata.
 */

import { MARKET_INTELLIGENCE_POLICY, isMarketObservationFresh } from "./market-intelligence-policy.js";

export type SourceClass =
  | "government" | "public_market_system" | "official_supplier"
  | "producer" | "marketplace" | "press" | "technical_publication" | "unknown";

export type PriceKind =
  | "input_purchase" | "feed" | "raw_material" | "sale_price"
  | "transport" | "energy" | "labor" | "health" | "equipment";

export interface MarketObservation {
  id: string;
  product: string;
  normalizedProduct: string;
  kind: PriceKind;
  value: number;
  currency: string;
  unit: string;
  country: string;
  region?: string;
  city?: string;
  sourceName: string;
  sourceUrl: string;
  sourceClass: SourceClass;
  publishedAt?: string;
  retrievedAt: string;
  validUntil?: string;
  notes?: string;
}

export interface MarketQuery {
  product: string;
  kind: PriceKind;
  country: string;
  region?: string;
  city?: string;
  currency: string;
  unit: string;
  asOf?: string;
  maxAgeDays?: number;
}

export interface RankedMarketObservation {
  observation: MarketObservation;
  score: number;
  ageDays: number | null;
  warnings: string[];
}

const SOURCE_WEIGHT: Record<SourceClass, number> = {
  government: 1,
  public_market_system: 0.95,
  official_supplier: 0.9,
  producer: 0.78,
  marketplace: 0.55,
  technical_publication: 0.7,
  press: 0.5,
  unknown: 0.25
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function dayDiff(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (b - a) / 86400000);
}

export function rankMarketObservations(
  query: MarketQuery,
  observations: MarketObservation[]
): RankedMarketObservation[] {
  const asOf = query.asOf ?? new Date().toISOString();
  const maxAge = query.maxAgeDays ?? MARKET_INTELLIGENCE_POLICY.maxAgeDays;
  return observations
    .filter(o => normalize(o.product) === normalize(query.product)
      || normalize(o.normalizedProduct) === normalize(query.product))
    .filter(o => o.kind === query.kind)
    .filter(o => normalize(o.country) === normalize(query.country))
    .filter(o => o.currency === query.currency && normalize(o.unit) === normalize(query.unit))
    .map(observation => {
      const warnings: string[] = [];
      const ageDays = observation.publishedAt
        ? dayDiff(observation.publishedAt, asOf)
        : dayDiff(observation.retrievedAt, asOf);
      let score = SOURCE_WEIGHT[observation.sourceClass] * 50;
      if (query.city && observation.city && normalize(query.city) === normalize(observation.city)) score += 20;
      else if (query.region && observation.region && normalize(query.region) === normalize(observation.region)) score += 12;
      else if (observation.city || observation.region) warnings.push("Localisation différente ou moins précise que la demande.");
      if (!isMarketObservationFresh(ageDays, { ...MARKET_INTELLIGENCE_POLICY, maxAgeDays: maxAge })) {
        warnings.push("Donnée exclue : fraîcheur non vérifiable ou supérieure à " + maxAge + " jours.");
        score = -1;
      } else if (ageDays !== null && ageDays <= 7) score += 25;
      else if (ageDays !== null && ageDays <= 30) score += 18;
      if (!observation.publishedAt) warnings.push("Date de publication absente ; seule la date de collecte est disponible.");
      if (observation.validUntil && Date.parse(observation.validUntil) < Date.parse(asOf)) {
        score -= 40;
        warnings.push("La période de validité annoncée est expirée.");
      }
      if (!/^https:\/\//i.test(observation.sourceUrl)) {
        score -= 50;
        warnings.push("URL source non sécurisée ou invalide.");
      }
      if (observation.sourceClass === "marketplace" || observation.sourceClass === "unknown") {
        warnings.push("Source commerciale/non institutionnelle : confirmer le prix auprès du vendeur.");
      }
      if (query.city && observation.city && normalize(query.city) !== normalize(observation.city)) {
        warnings.push("Donnée hors de la ville demandée : repli géographique à confirmer.");
      }
      return { observation, score: Math.max(0, Math.min(100, score)), ageDays, warnings };
    })
    .filter(item => isMarketObservationFresh(item.ageDays, { ...MARKET_INTELLIGENCE_POLICY, maxAgeDays: maxAge }))
    .sort((a, b) => b.score - a.score);
}

export function summarizeMarketEvidence(ranked: RankedMarketObservation[]) {
  const usable = ranked.filter(r => r.score >= 45 && !r.warnings.some(w => w.includes("période de validité")));
  const values = usable.map(r => r.observation.value).filter(v => Number.isFinite(v) && v >= 0).sort((a,b) => a-b);
  const median = values.length
    ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
    : null;
  return {
    observationCount: ranked.length,
    usableCount: usable.length,
    median,
    minimum: values.length ? values[0] : null,
    maximum: values.length ? values[values.length - 1] : null,
    status: values.length >= 3 ? "corroborated" as const : values.length > 0 ? "indicative" as const : "unavailable" as const,
    warning: values.length < 3
      ? "Moins de trois observations exploitables : le prix est indicatif et doit être confirmé."
      : "Médiane calculée sur les observations exploitables ; consulter les sources et leur fraîcheur."
  };
}

export interface ResearchPlanItem {
  field: string;
  product: string;
  kind: PriceKind;
  preferredSources: string[];
  requiredGeography: string;
  unit: string;
}

export function buildPoultryResearchPlan(country: string, city: string): ResearchPlanItem[] {
  return [
    { field: "prix des jeunes sujets", product: "poussins hybrides locaux améliorés", kind: "input_purchase", preferredSources: ["couvoirs locaux", "fournisseurs avicoles identifiés", "ANADER/MIRAH pour référencement"], requiredGeography: city + ", " + country, unit: "FCFA/sujet" },
    { field: "prix des jeunes sujets", product: "pintadeaux", kind: "input_purchase", preferredSources: ["couvoirs locaux", "fournisseurs avicoles identifiés", "ANADER/MIRAH pour référencement"], requiredGeography: city + ", " + country, unit: "FCFA/sujet" },
    { field: "aliments par phase", product: "aliment démarrage, croissance et finition", kind: "feed", preferredSources: ["fabricants d'aliments", "provenderies et distributeurs locaux"], requiredGeography: city + ", " + country, unit: "FCFA/sac et FCFA/kg" },
    { field: "matières premières", product: "maïs jaune et soja", kind: "raw_material", preferredSources: ["OCPV", "SIMAgri", "systèmes publics de suivi des marchés"], requiredGeography: city + ", " + country, unit: "FCFA/kg" },
    { field: "prix de vente", product: "volaille vivante et carcasse", kind: "sale_price", preferredSources: ["marchés locaux", "acheteurs professionnels", "grossistes et détaillants"], requiredGeography: city + ", " + country, unit: "FCFA/sujet et FCFA/kg" },
    { field: "charges opérationnelles", product: "transport, énergie, santé vétérinaire et main-d'œuvre", kind: "transport", preferredSources: ["prestataires locaux", "services vétérinaires", "tarifs et devis datés"], requiredGeography: city + ", " + country, unit: "FCFA/unité de dépense" }
  ];
}
