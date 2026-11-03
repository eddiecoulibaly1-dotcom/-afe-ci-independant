import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_INTELLIGENCE_POLICY, isMarketObservationFresh, marketGeographySearchOrder, marketDataGapInstructions } from '../src/market-intelligence-policy.js';

test('uses city-first geography, 30-day freshness and ask fallback by default', () => {
  assert.deepEqual(MARKET_INTELLIGENCE_POLICY, { geography: 'city', maxAgeDays: 30, missingData: 'ask' });
});

test('orders geography from city to region to country without crossing borders', () => {
  assert.deepEqual(marketGeographySearchOrder({ city: 'Grand-Bassam', region: 'Sud-Comoé', country: 'Côte d’Ivoire' }), [
    { level: 'city', location: 'Grand-Bassam, Côte d’Ivoire' },
    { level: 'region', location: 'Sud-Comoé, Côte d’Ivoire' },
    { level: 'country', location: 'Côte d’Ivoire' }
  ]);
});

test('rejects observations older than 30 days as current prices', () => {
  assert.equal(isMarketObservationFresh(30), true);
  assert.equal(isMarketObservationFresh(30.1), false);
  assert.equal(isMarketObservationFresh(null), false);
});

test('asks the user instead of estimating or using neighboring-country data', () => {
  const instructions = marketDataGapInstructions([{ field: 'prix du sac d’aliment', reason: 'aucune source récente' }]);
  assert.ok(instructions.some(x => x.includes('demander')));
  assert.ok(instructions.some(x => x.includes('Ne pas inventer')));
  assert.ok(instructions.some(x => x.includes('pays voisin')));
});