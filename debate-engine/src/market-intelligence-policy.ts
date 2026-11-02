/** Market Intelligence V2.1 policy defaults selected by the product owner. */
export type MarketGeographyPolicy = 'city' | 'country' | 'regional';
export type MissingMarketDataPolicy = 'ask' | 'regional' | 'estimate';

export interface MarketIntelligencePolicy {
  geography: MarketGeographyPolicy;
  maxAgeDays: number;
  missingData: MissingMarketDataPolicy;
}

export const MARKET_INTELLIGENCE_POLICY: Readonly<MarketIntelligencePolicy> = Object.freeze({
  geography: 'city',
  maxAgeDays: 30,
  missingData: 'ask'
});

export interface MarketGeographyRequest {
  city: string;
  region?: string;
  country: string;
}

export interface MarketDataGap { field: string; reason: string; }

/** City-first search plan: widen only within the same country and label every fallback. */
export function marketGeographySearchOrder(request: MarketGeographyRequest): Array<{ level: 'city' | 'region' | 'country'; location: string }> {
  const order: Array<{ level: 'city' | 'region' | 'country'; location: string }> = [];
  if (request.city.trim()) order.push({ level: 'city', location: request.city + ', ' + request.country });
  if (request.region?.trim()) order.push({ level: 'region', location: request.region + ', ' + request.country });
  order.push({ level: 'country', location: request.country });
  return order;
}

export function isMarketObservationFresh(ageDays: number | null, policy = MARKET_INTELLIGENCE_POLICY): boolean {
  return ageDays !== null && Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= policy.maxAgeDays;
}

export function marketDataGapInstructions(gaps: MarketDataGap[], policy = MARKET_INTELLIGENCE_POLICY): string[] {
  if (!gaps.length) return [];
  if (policy.missingData === 'ask') return [
    'Données manquantes : ' + gaps.map(g => g.field).join(', ') + '.',
    'Suspendre le calcul qui dépend de ces données et demander à l’utilisateur de les fournir ou de confirmer une source.',
    'Ne pas inventer de valeur, ne pas produire d’estimation automatique et ne pas remplacer par des données d’un pays voisin.'
  ];
  if (policy.missingData === 'regional') return ['Proposer une recherche régionale en signalant explicitement l’écart géographique.'];
  return ['Toute estimation doit être étiquetée comme estimation, datée et séparée des prix observés.'];
}