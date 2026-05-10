/**
 * Search Pipeline
 * Tiered search: local → Groq → OpenRouter
 * 
 * Flow:
 *  1. Try local keyword match (instant, free)
 *  2. If no match OR user wants AI-enhanced, try Groq (free tier)
 *  3. If Groq fails/unavailable, try OpenRouter (budget-capped)
 *  4. If all fail, return best-effort estimate from partial matches
 */

import * as groq from './groq.js';
import * as openrouter from './openrouter.js';

export const PROVIDERS = {
  local: 'local',
  groq: 'groq',
  openrouter: 'openrouter'
};

/**
 * Main search function
 * 
 * @param {string} query - User's natural language query
 * @param {string} zip - ZIP code for regional pricing
 * @param {object} options
 * @param {boolean} options.forceLLM - Skip local match, go straight to Groq
 * @param {string} options.providerPreference - 'groq' | 'openrouter' | 'auto'
 * @param {object} catalog - Service catalog (from services.js)
 * @param {object} regionalData - Regional multiplier data
 * 
 * @returns {Promise<object>} Search result with pricing and metadata
 */
export async function search(query, zip, { forceLLM = false, providerPreference = 'auto', catalog, regionalData } = {}) {
  const startTime = Date.now();
  const zipData = regionalData(zip);

  // ─── Step 1: Local keyword match ───────────────────────────────────────
  if (!forceLLM) {
    const localResult = localSearch(query, catalog, zipData);
    if (localResult.found) {
      return {
        ...localResult,
        provider: PROVIDERS.local,
        queryTime: Date.now() - startTime,
        llmEnhanced: false
      };
    }
  }

  // ─── Step 2: Groq (free) ────────────────────────────────────────────────
  if (providerPreference === 'auto' || providerPreference === 'groq') {
    if (groq.isConfigured()) {
      try {
        const groqResult = await groqSearch(query, catalog, zipData);
        if (groqResult.found) {
          return {
            ...groqResult,
            provider: PROVIDERS.groq,
            queryTime: Date.now() - startTime,
            llmEnhanced: true
          };
        }
      } catch (err) {
        console.warn('Groq search failed:', err.message);
        // Fall through to OpenRouter
      }
    }
  }

  // ─── Step 3: OpenRouter (budget-capped) ────────────────────────────────
  if (providerPreference === 'openrouter' || providerPreference === 'auto') {
    if (openrouter.isConfigured()) {
      try {
        const orResult = await openrouterSearch(query, catalog, zipData);
        if (orResult.found) {
          return {
            ...orResult,
            provider: PROVIDERS.openrouter,
            queryTime: Date.now() - startTime,
            llmEnhanced: true
          };
        }
      } catch (err) {
        console.warn('OpenRouter search failed:', err.message);
      }
    }
  }

  // ─── Step 4: Best effort fallback ──────────────────────────────────────
  const partial = partialLocalSearch(query, catalog);
  return {
    found: false,
    query,
    zip,
    region: `${zipData.city}, ${zipData.state}`,
    partialMatches: partial,
    error: 'No LLM providers configured. Enable Groq and/or OpenRouter for full functionality.',
    provider: null,
    queryTime: Date.now() - startTime,
    llmEnhanced: false
  };
}

/**
 * Local keyword-based search
 */
function localSearch(query, catalog, zipData) {
  // Use the parser from services.js
  const tokens = tokenize(query);
  let bestMatch = null;
  let bestScore = 0;

  for (const [tradeKey, trade] of Object.entries(catalog)) {
    for (const service of trade.services) {
      const score = scoreMatch(tokens, service, trade);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { trade: tradeKey, tradeData: trade, service };
      }
    }
  }

  if (bestScore < 5) {
    return { found: false };
  }

  // Build price range with regional adjustment
  const pricing = buildPriceRange(bestMatch.service, zipData, extractParams(query));

  return {
    found: true,
    query,
    match: {
      trade: bestMatch.trade,
      tradeName: bestMatch.tradeData.name,
      tradeIcon: bestMatch.tradeData.icon,
      tradeColor: bestMatch.tradeData.color,
      serviceName: bestMatch.service.name,
      serviceDesc: bestMatch.service.desc,
      confidence: bestScoreToConfidence(bestScore),
      matchScore: bestScore,
      matchedKeywords: extractMatchedKeywords(tokens, bestMatch.service)
    },
    pricing,
    analogies: [] // No analogies for local match
  };
}

/**
 * Partial local search for fallback
 */
function partialLocalSearch(query, catalog) {
  const tokens = tokenize(query);
  const matches = [];

  for (const [tradeKey, trade] of Object.entries(catalog)) {
    for (const service of trade.services) {
      const score = scoreMatch(tokens, service, trade);
      if (score > 0) {
        matches.push({
          trade: tradeKey,
          tradeName: trade.name,
          serviceName: service.name,
          score
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 5);
}

/**
 * Groq-powered search
 */
async function groqSearch(query, catalog, zipData) {
  // Find analogous services
  const analogies = await groq.findAnalogousServices(query, catalog);

  if (!analogies || analogies.length === 0) {
    return { found: false };
  }

  // Generate estimate based on analogies
  const estimate = await groq.generateEstimate(query, analogies, zipData);

  if (!estimate) {
    return { found: false };
  }

  // Find the top analogous service for metadata
  const topAnalogy = analogies[0];
  const tradeData = catalog[topAnalogy.trade] || Object.values(catalog)[0];

  // Apply regional multiplier to LLM estimate
  const adjustedLow = Math.round(estimate.low * zipData.multiplier);
  const adjustedHigh = Math.round(estimate.high * zipData.multiplier);
  const adjustedAvg = Math.round(estimate.average * zipData.multiplier);

  return {
    found: true,
    query,
    match: {
      trade: topAnalogy.trade,
      tradeName: tradeData?.name || topAnalogy.trade,
      tradeIcon: tradeData?.icon || '🔧',
      tradeColor: tradeData?.color || '#6366f1',
      serviceName: query, // Use the original query as the service name
      serviceDesc: `AI-generated estimate based on analogous services`,
      confidence: estimate.confidence || 'medium',
      matchScore: Math.round(topAnalogy.similarity * 100)
    },
    pricing: {
      low: adjustedLow,
      high: adjustedHigh,
      average: adjustedAvg,
      formattedLow: formatCurrency(adjustedLow),
      formattedHigh: formatCurrency(adjustedHigh),
      formattedAvg: formatCurrency(adjustedAvg),
      unit: estimate.unit || 'per job',
      region: `${zipData.city}, ${zipData.state}`,
      costIndex: zipData.costIndex,
      regionalMultiplier: zipData.multiplier,
      confidence: estimate.confidence || 'estimated',
      dataYear: 2024,
      dataSources: ['Groq LLM reasoning from analogous services']
    },
    analogies: analogies.map(a => ({
      trade: a.trade,
      serviceName: a.serviceName,
      similarity: a.similarity,
      reasoning: a.reasoning
    })),
    llmReasoning: estimate.reasoning,
    llmAnalogies: estimate.analogies || []
  };
}

/**
 * OpenRouter-powered search (same logic, different provider)
 */
async function openrouterSearch(query, catalog, zipData) {
  const analogies = await openrouter.findAnalogousServices(query, catalog);

  if (!analogies || analogies.length === 0) {
    return { found: false };
  }

  const estimate = await openrouter.generateEstimate(query, analogies, zipData);

  if (!estimate) {
    return { found: false };
  }

  const topAnalogy = analogies[0];
  const tradeData = catalog[topAnalogy.trade] || Object.values(catalog)[0];

  const adjustedLow = Math.round(estimate.low * zipData.multiplier);
  const adjustedHigh = Math.round(estimate.high * zipData.multiplier);
  const adjustedAvg = Math.round(estimate.average * zipData.multiplier);

  return {
    found: true,
    query,
    match: {
      trade: topAnalogy.trade,
      tradeName: tradeData?.name || topAnalogy.trade,
      tradeIcon: tradeData?.icon || '🔧',
      tradeColor: tradeData?.color || '#6366f1',
      serviceName: query,
      serviceDesc: `AI-generated estimate based on analogous services`,
      confidence: estimate.confidence || 'medium',
      matchScore: Math.round(topAnalogy.similarity * 100)
    },
    pricing: {
      low: adjustedLow,
      high: adjustedHigh,
      average: adjustedAvg,
      formattedLow: formatCurrency(adjustedLow),
      formattedHigh: formatCurrency(adjustedHigh),
      formattedAvg: formatCurrency(adjustedAvg),
      unit: estimate.unit || 'per job',
      region: `${zipData.city}, ${zipData.state}`,
      costIndex: zipData.costIndex,
      regionalMultiplier: zipData.multiplier,
      confidence: estimate.confidence || 'estimated',
      dataYear: 2024,
      dataSources: ['OpenRouter LLM reasoning from analogous services']
    },
    analogies: analogies.map(a => ({
      trade: a.trade,
      serviceName: a.serviceName,
      similarity: a.similarity,
      reasoning: a.reasoning
    })),
    llmReasoning: estimate.reasoning,
    llmAnalogies: estimate.analogies || []
  };
}

// ─── Tokenization & Scoring Utilities ──────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'beneath', 'under',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'this',
  'that', 'these', 'those', 'am', 'let', 'some', 'any', 'every', 'each', 'other',
  'another', 'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very',
  'just', 'also', 'now', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
  'both', 'few', 'more', 'most', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'need', 'needs', 'needed', 'want', 'wants',
  'wanted', 'looking', 'like', 'likes', 'estimate', 'quotes', 'price', 'cost',
  'around', 'please', 'thanks', 'thank', 'maybe', 'perhaps', 'probably', 'don'
]);

function tokenize(text) {
  const normalized = text.toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalized.split(' ').filter(t => t.length > 1);
  const filtered = tokens.filter(t => !STOP_WORDS.has(t) && !/^\d+$/.test(t) && t.length > 1);

  return {
    raw: tokens,
    filtered,
    stemmed: filtered.map(stem),
    original: text
  };
}

const STEMS = {
  'removing': 'remove', 'removal': 'remove', 'removed': 'remove',
  'cutting': 'cut', 'cutdown': 'cut',
  'installing': 'install', 'installed': 'install', 'installation': 'install',
  'replacing': 'replace', 'replaced': 'replace', 'replacement': 'replace',
  'repairing': 'repair', 'repaired': 'repair',
  'fixing': 'fix', 'fixed': 'fix',
  'cleaning': 'clean', 'cleaned': 'clean',
  'painting': 'paint', 'painted': 'paint',
  'building': 'build', 'built': 'build',
  'remodeling': 'remodel', 'remodeled': 'remodel',
  'renovating': 'renovate', 'renovated': 'renovate',
  'trimming': 'trim', 'pruning': 'prune',
  'staining': 'stain', 'sealing': 'seal',
  'grinding': 'grind', 'ground': 'grind'
};

function stem(word) {
  return STEMS[word] || word;
}

function scoreMatch(tokens, service, trade) {
  let score = 0;

  const serviceNameTokens = tokenize(service.name);
  const serviceDescTokens = tokenize(service.desc);

  // Name match (highest weight)
  for (const t of tokens.stemmed) {
    for (const nt of serviceNameTokens.stemmed) {
      if (nt === t || t.includes(nt) || nt.includes(t)) {
        score += 10;
      }
    }
  }

  // Description match
  for (const t of tokens.stemmed) {
    for (const dt of serviceDescTokens.stemmed) {
      if (dt === t || t.includes(dt) || dt.includes(t)) {
        score += 5;
      }
    }
  }

  // Keyword list match
  for (const kw of service.keywords || []) {
    const kwTokens = tokenize(kw);
    for (const t of tokens.stemmed) {
      for (const kt of kwTokens.stemmed) {
        if (kt === t || t.includes(kt) || kt.includes(t)) {
          score += 3;
        }
      }
    }
  }

  // Trade context bonus
  const tradeTokens = tokenize(trade.keywords?.join(' ') || '');
  for (const t of tokens.stemmed) {
    for (const tt of tradeTokens.stemmed) {
      if (tt === t || t.includes(tt)) {
        score += 2;
      }
    }
  }

  return score;
}

function extractMatchedKeywords(tokens, service) {
  const matched = [];
  for (const t of tokens.stemmed) {
    const inName = service.name.toLowerCase().includes(t);
    const inDesc = (service.desc || '').toLowerCase().includes(t);
    const inKeywords = (service.keywords || []).some(kw => kw.toLowerCase().includes(t));
    if (inName || inDesc || inKeywords) matched.push(t);
  }
  return [...new Set(matched)];
}

function bestScoreToConfidence(score) {
  if (score >= 25) return 'high';
  if (score >= 12) return 'medium';
  if (score >= 5) return 'low';
  return 'minimal';
}

function extractParams(text) {
  const params = {};

  const qtyMatch = text.match(/(\d+)\s*(tree|trees|bedroom|bedrooms|bathroom|bathrooms|room|rooms|outlet|outlets|window|windows|door|doors|unit|units|pair|pairs)/i);
  if (qtyMatch) params.quantity = parseInt(qtyMatch[1]);

  const heightMatch = text.match(/(\d+)\s*(?:foot|feet|ft)/i);
  if (heightMatch) params.heightFt = parseInt(heightMatch[1]);

  const sqftMatch = text.match(/(\d+)\s*(?:sq\s*ft|sqft|square\s*feet|square\s*foot)/i);
  if (sqftMatch) params.sqft = parseInt(sqftMatch[1]);

  params.urgent = /\b(emergency|urgent|asap|right now|immediately|today|this week)\b/i.test(text);

  return params;
}

function buildPriceRange(service, zipData, params = {}) {
  let low = service.low;
  let high = service.high;

  if (params.quantity && params.quantity > 1) {
    const discount = params.quantity > 5 ? 0.85 : params.quantity > 2 ? 0.90 : 0.95;
    low *= discount;
    high *= discount;
  }

  if (params.urgent) {
    low *= 1.35;
    high *= 1.50;
  }

  low = Math.round(low * zipData.multiplier);
  high = Math.round(high * zipData.multiplier);
  const avg = Math.round((low + high) / 2);

  return {
    low,
    high,
    average: avg,
    formattedLow: formatCurrency(low),
    formattedHigh: formatCurrency(high),
    formattedAvg: formatCurrency(avg),
    unit: service.unit || 'per job',
    region: `${zipData.city}, ${zipData.state}`,
    costIndex: zipData.costIndex,
    regionalMultiplier: zipData.multiplier,
    confidence: 'good',
    dataYear: 2024,
    dataSources: ['Local service catalog']
  };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

export { groq, openrouter };