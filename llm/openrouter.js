/**
 * OpenRouter LLM integration
 * $10 cap budget, fallback from Groq
 * API: https://openrouter.ai/keys
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

let apiKey = null;
let monthlyCap = 10.00; // Budget cap in dollars

export function setApiKey(key) {
  apiKey = key;
}

export function isConfigured() {
  return !!apiKey;
}

export function setCap(amount) {
  monthlyCap = amount;
}

export function getCap() {
  return monthlyCap;
}

const MODELS = {
  fast: 'meta-llama/llama-3.3-8b-instruct',    // Fast, cheap
  strong: 'meta-llama/llama-3.3-70b-instruct'  // Stronger reasoning
};

/**
 * Get current usage from OpenRouter
 */
export async function getUsage() {
  if (!apiKey) return null;

  const response = await fetch(`${OPENROUTER_BASE}/auth/keys`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!response.ok) return null;

  const data = await response.json();
  return data;
}

/**
 * Make a chat completion request to OpenRouter
 */
export async function chat(messages, { model = MODELS.fast, temperature = 0.3, max_tokens = 1024 } = {}) {
  if (!apiKey) throw new Error('OpenRouter API key not configured');

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ratecheck.app',
      'X-Title': 'RateCheck'
    },
    body: JSON.dumps({
      model,
      messages,
      temperature,
      max_tokens
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Find analogous services using OpenRouter
 */
export async function findAnalogousServices(query, catalog) {
  const catalogSummary = Object.entries(catalog).map(([trade, data]) =>
    `${trade}: ${data.services.map(s => s.name).join(', ')}`
  ).join('\n');

  const systemPrompt = `You are a service pricing expert. Given a user description of work they need or want to provide, identify which existing services from a catalog are structurally analogous (similar labor type, complexity, time, tools, and skill level).

Return a JSON array of the 3-5 most analogous services, ranked by similarity. Each entry should include:
- "trade": the trade category
- "serviceName": the exact service name
- "similarity": 0.0-1.0 score of how analogous this service is to the user's query
- "reasoning": brief explanation of why this service is analogous

Respond ONLY with valid JSON, no markdown, no explanation outside the JSON.`;

  const userPrompt = `User query: "${query}"

Available services:
${catalogSummary}

Identify the most analogous services from the catalog above.`;

  const result = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { model: MODELS.fast, temperature: 0.2 });

  try {
    let cleanResult = result.trim();
    if (cleanResult.startsWith('```')) {
      cleanResult = cleanResult.replace(/```(?:json)?\n?/g, '').trim();
    }
    return JSON.parse(cleanResult);
  } catch {
    return [];
  }
}

/**
 * Generate price estimate using OpenRouter
 */
export async function generateEstimate(query, analogousServices, zipData) {
  const serviceLines = analogousServices.map(s =>
    `- ${s.trade} > ${s.serviceName}: similarity=${s.similarity.toFixed(2)}`
  ).join('\n');

  const systemPrompt = `You are a service pricing expert. Generate realistic price estimates for a service that has no direct market data.

Based on the analogous services provided, generate a price range estimate.
Respond ONLY with valid JSON (no markdown):
{
  "low": number (minimum price in dollars),
  "high": number (maximum price in dollars),
  "average": number (typical middle price),
  "unit": "per job" or "per hour" or "per sqft" etc,
  "confidence": "high" | "medium" | "low",
  "reasoning": "2-3 sentence explanation of how you derived this estimate",
  "analogies": ["list of 2-3 specific comparisons that informed the estimate"]
}`;

  const userPrompt = `Service to price: "${query}"

Analogous services from catalog:
${serviceLines}

Regional context: ${zipData.city}, ${zipData.state} (cost index: ${zipData.costIndex}/100)

Generate a realistic price range based on the analogous services. Consider:
- Similarity scores (higher similarity = closer to that service's price)
- Regional cost differences (cost index above 100 = more expensive area)
- Any specific details in the query that might adjust the estimate up or down`;

  const result = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { model: MODELS.fast, temperature: 0.3, max_tokens: 512 });

  try {
    let cleanResult = result.trim();
    if (cleanResult.startsWith('```')) {
      cleanResult = cleanResult.replace(/```(?:json)?\n?/g, '').trim();
    }
    return JSON.parse(cleanResult);
  } catch {
    return null;
  }
}

export const MODELS_LIST = MODELS;