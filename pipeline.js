/**
 * RateCheck Search Pipeline
 * Cascading lookup: keyword → Groq → OpenRouter
 * Returns structured price estimates with full reasoning
 */

import { findAnalogousServices as groqFind, generateEstimate as groqEstimate, isConfigured as groqConfigured } from './llm/groq.js';
import { findAnalogousServices as orFind, generateEstimate as orEstimate, isConfigured as orConfigured } from './llm/openrouter.js';

/**
 * Regional cost adjustment (simplified, no DB needed for now)
 */
function regionalAdjust(price, costIndex) {
  return price * (costIndex / 100);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

/**
 * Tier 1: Fast local keyword match
 */
function localMatch(query, catalog, params) {
  // Import parser locally to avoid circular
  const tokens = tokenize(query);
  const results = [];

  for (const [tradeKey, trade] of Object.entries(catalog)) {
    for (const service of trade.services) {
      const score = scoreMatch(tokens, service, trade);
      if (score > 0) {
        results.push({ trade: tradeKey, tradeName: trade.name, tradeIcon: trade.icon, tradeColor: trade.color, service, score });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);

  if (results.length === 0) return null;

  const top = results[0];
  const { low, high, average, unit } = top.service.pricing;

  const adjLow = regionalAdjust(low, params.costIndex || 100);
  const adjHigh = regionalAdjust(high, params.costIndex || 100);
  const adjAvg = (adjLow + adjHigh) / 2;

  return {
    tier: 1,
    matchType: 'direct',
    confidence: top.score >= 25 ? 'high' : top.score >= 12 ? 'medium' : 'low',
    trade: top.trade,
    tradeName: top.tradeName,
    tradeIcon: top.tradeIcon,
    tradeColor: top.tradeColor,
    serviceName: top.service.name,
    serviceDesc: top.service.desc,
    pricing: {
      low: Math.round(adjLow),
      high: Math.round(adjHigh),
      average: Math.round(adjAvg),
      formattedLow: formatCurrency(Math.round(adjLow)),
      formattedHigh: formatCurrency(Math.round(adjHigh)),
      formattedAvg: formatCurrency(Math.round(adjAvg)),
      unit: unit || 'per job',
      region: params.location || 'National Average',
      costIndex: params.costIndex || 100
    },
    reasoning: [`Direct match found in ${top.tradeName} catalog`, `Regional adjustment applied for ${params.zip || 'unknown ZIP'}`],
    dataSources: ['RateCheck Service Catalog', 'Regional cost index'],
    analogies: []
  };
}

// Minimal tokenizer for local matching
function tokenize(text) {
  const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'i', 'my', 'me', 'how', 'much', 'should', 'it', 'cost', 'does']);
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(' ')
    .filter(t => t.length > 2 && !STOP.has(t));
}

function scoreMatch(tokens, service, trade) {
  const nameWords = service.name.toLowerCase().split(/[\s,]+/);
  const keywordWords = (service.keywords || []).join(' ').toLowerCase().split(/[\s,]+/);
  const tradeWords = (trade.keywords || []).join(' ').toLowerCase().split(/[\s,]+/);

  let score = 0;
  for (const token of tokens) {
    if (nameWords.some(w => w.includes(token) || token.includes(w))) score += 10;
    else if (keywordWords.some(w => w.includes(token) || token.includes(w))) score += 3;
    else if (tradeWords.some(w => w.includes(token) || token.includes(w))) score += 1;
  }
  return score;
}

/**
 * Tier 2: Groq LLM lookup
 */
async function groqLookup(query, catalog, params) {
  if (!groqConfigured()) return null;

  try {
    const analogous = await groqFind(query, catalog);
    if (!analogous || analogous.length === 0) return null;

    const estimate = await groqEstimate(query, analogous, params);
    if (!estimate) return null;

    return {
      tier: 2,
      matchType: 'analogous',
      confidence: estimate.confidence || 'medium',
      trade: analogous[0].trade || 'general',
      tradeName: analogous[0].trade || 'General',
      tradeIcon: '🔍',
      tradeColor: '#6366f1',
      serviceName: query,
      serviceDesc: 'Estimated using analogous service reasoning',
      pricing: {
        low: Math.round(estimate.low),
        high: Math.round(estimate.high),
        average: Math.round(estimate.average),
        formattedLow: formatCurrency(estimate.low),
        formattedHigh: formatCurrency(estimate.high),
        formattedAvg: formatCurrency(estimate.average),
        unit: estimate.unit || 'per job',
        region: params.location || 'National Average',
        costIndex: params.costIndex || 100
      },
      reasoning: [estimate.reasoning],
      dataSources: ['Groq LLM reasoning', 'RateCheck Service Catalog analogies'],
      analogies: estimate.analogies || []
    };
  } catch (err) {
    console.error('Groq lookup failed:', err.message);
    return null;
  }
}

/**
 * Tier 3: OpenRouter LLM lookup (final fallback)
 */
async function openrouterLookup(query, catalog, params) {
  if (!orConfigured()) return null;

  try {
    const analogous = await orFind(query, catalog);
    if (!analogous || analogous.length === 0) return null;

    const estimate = await orEstimate(query, analogous, params);
    if (!estimate) return null;

    return {
      tier: 3,
      matchType: 'reasoned',
      confidence: estimate.confidence || 'low',
      trade: analogous[0].trade || 'general',
      tradeName: analogous[0].trade || 'General',
      tradeIcon: '💡',
      tradeColor: '#f59e0b',
      serviceName: query,
      serviceDesc: 'Estimated using LLM first-principles reasoning',
      pricing: {
        low: Math.round(estimate.low),
        high: Math.round(estimate.high),
        average: Math.round(estimate.average),
        formattedLow: formatCurrency(estimate.low),
        formattedHigh: formatCurrency(estimate.high),
        formattedAvg: formatCurrency(estimate.average),
        unit: estimate.unit || 'per job',
        region: params.location || 'National Average',
        costIndex: params.costIndex || 100
      },
      reasoning: [estimate.reasoning],
      dataSources: ['OpenRouter LLM reasoning', 'Catalog analogies'],
      analogies: estimate.analogies || []
    };
  } catch (err) {
    console.error('OpenRouter lookup failed:', err.message);
    return null;
  }
}

/**
 * Main search function — cascading lookup
 */
export async function search(query, { zip, catalog, groqKey, openrouterKey, costIndex = 100, location = 'National Average' } = {}) {
  const params = { zip, costIndex, location };

  // Tier 1: Local keyword match
  const local = localMatch(query, catalog, params);
  if (local && local.confidence === 'high') {
    return { ...local, pipeline: 'local' };
  }

  // Tier 2: Groq
  if (groqKey || groqConfigured()) {
    const groqResult = await groqLookup(query, catalog, params);
    if (groqResult) return { ...groqResult, pipeline: groqResult.tier === 2 ? 'groq' : 'openrouter' };
  }

  // Tier 3: OpenRouter
  if (openrouterKey || orConfigured()) {
    const orResult = await openrouterLookup(query, catalog, params);
    if (orResult) return { ...orResult, pipeline: 'openrouter' };
  }

  // Fallback: local match even if low confidence
  if (local) return { ...local, pipeline: 'local-fallback' };

  // Total failure — return generic fallback
  return {
    tier: 0,
    matchType: 'unknown',
    confidence: 'low',
    trade: 'general',
    tradeName: 'General',
    tradeIcon: '❓',
    tradeColor: '#64748b',
    serviceName: query,
    serviceDesc: 'Unable to find close matches — estimate based on general market rates',
    pricing: {
      low: 100,
      high: 500,
      average: 275,
      formattedLow: '$100',
      formattedHigh: '$500',
      formattedAvg: '$275',
      unit: 'per job',
      region: location,
      costIndex
    },
    reasoning: ['No direct or analogous service found in catalog', 'Estimate based on general market range for similar complexity work'],
    dataSources: ['General market estimates'],
    analogies: [],
    pipeline: 'none',
    warning: 'Low confidence — consider being more specific or consulting a local professional'
  };
}