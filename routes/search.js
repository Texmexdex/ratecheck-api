/**
 * Search API route
 * GET /api/search?q=<query>&zip=<zip>
 */

import { Router } from 'express';
import { search } from '../pipeline.js';
import { setApiKey as setGroqKey, isConfigured as groqReady } from '../llm/groq.js';
import { setApiKey as setOrKey, isConfigured as orReady, setCap } from '../llm/openrouter.js';

const router = Router();

// Regional cost index data (simplified, embedded)
const REGION_DATA = {
  // Texas
  '77062': { city: 'Houston', state: 'TX', costIndex: 97 },
  '77001': { city: 'Houston', state: 'TX', costIndex: 97 },
  '75201': { city: 'Dallas', state: 'TX', costIndex: 99 },
  '78201': { city: 'San Antonio', state: 'TX', costIndex: 91 },
  '73301': { city: 'Austin', state: 'TX', costIndex: 108 },
  // California
  '90001': { city: 'Los Angeles', state: 'CA', costIndex: 142 },
  '94102': { city: 'San Francisco', state: 'CA', costIndex: 165 },
  '92101': { city: 'San Diego', state: 'CA', costIndex: 138 },
  '95814': { city: 'Sacramento', state: 'CA', costIndex: 122 },
  // Florida
  '33101': { city: 'Miami', state: 'FL', costIndex: 115 },
  '32801': { city: 'Orlando', state: 'FL', costIndex: 103 },
  '33601': { city: 'Tampa', state: 'FL', costIndex: 105 },
  // New York
  '10001': { city: 'New York', state: 'NY', costIndex: 155 },
  // etc — will grow
};

function getRegionData(zip) {
  if (!zip) return { city: 'Unknown', state: 'Unknown', costIndex: 100 };

  // Try exact match first
  if (REGION_DATA[zip]) return REGION_DATA[zip];

  // Try ZIP prefix (first 3 digits = regional area)
  const prefix = zip.substring(0, 3);
  const prefixMatches = Object.entries(REGION_DATA).filter(([z]) => z.startsWith(prefix));
  if (prefixMatches.length > 0) {
    return prefixMatches[0][1];
  }

  return { city: 'Unknown', state: 'Unknown', costIndex: 100 };
}

// Lazy-load catalog (to avoid huge module at import time)
let catalogCache = null;
function getCatalog() {
  if (!catalogCache) {
    // Import catalog data inline (same structure as ratecheck frontend)
    catalogCache = {
      tree: {
        name: 'Tree Services', icon: '🌳', color: '#22c55e',
        keywords: ['tree', 'arbor', 'wood', 'stump', 'branch', 'limb', 'cut', 'remove'],
        services: [
          { id: 'tree-removal-sm', name: 'Tree Removal - Small (Under 25ft)', desc: 'Remove small trees under 25 feet', keywords: ['small tree removal', 'remove small tree'], pricing: { low: 200, high: 450, average: 325 }, unit: 'per tree', includes: ['Stump grinding optional', 'Haul away debris'] },
          { id: 'tree-removal-md', name: 'Tree Removal - Medium (25-50ft)', desc: 'Remove medium trees 25-50 feet', keywords: ['medium tree removal', 'remove tree'], pricing: { low: 450, high: 1200, average: 800 }, unit: 'per tree', includes: ['Stump grinding optional', 'Haul away debris'] },
          { id: 'tree-removal-lg', name: 'Tree Removal - Large (50-75ft)', desc: 'Remove large trees 50-75 feet', keywords: ['large tree removal', 'big tree removal'], pricing: { low: 1200, high: 2500, average: 1800 }, unit: 'per tree', includes: ['Crane or bucket truck required', 'Haul away debris'] },
          { id: 'stump-grinding', name: 'Stump Grinding', desc: 'Grind tree stump below ground level', keywords: ['stump grinding', 'stump removal', 'remove stump'], pricing: { low: 75, high: 300, average: 175 }, unit: 'per stump', includes: ['Below-ground grinding', 'Wood chips left on site'] },
          { id: 'tree-trimming', name: 'Tree Trimming / Pruning', desc: 'Trim or prune tree branches', keywords: ['tree trimming', 'pruning', 'trim tree', 'prune tree'], pricing: { low: 150, high: 500, average: 300 }, unit: 'per tree', includes: ['Branch removal', 'Shape and clear'] },
        ]
      },
      plumbing: {
        name: 'Plumbing', icon: '🔧', color: '#3b82f6',
        keywords: ['plumb', 'pipe', 'water', 'drain', 'leak', 'sink', 'toilet', 'faucet', 'shower', 'bath'],
        services: [
          { id: 'plumb-repair-leak', name: 'Leak Repair', desc: 'Fix leaking pipe or fixture', keywords: ['fix leak', 'leak repair', 'pipe leak', 'water leak'], pricing: { low: 100, high: 350, average: 200 }, unit: 'per repair', includes: ['Parts and labor', 'Test for leaks'] },
          { id: 'plumb-unclog', name: 'Drain Unclogging', desc: 'Clear clogged drain', keywords: [' unclog drain', 'clear drain', 'drain clog', 'slow drain'], pricing: { low: 100, high: 300, average: 175 }, unit: 'per drain', includes: ['Snake or hydro-jet', 'Test drainage'] },
          { id: 'faucet-install', name: 'Faucet Installation / Replacement', desc: 'Install or replace a faucet', keywords: ['install faucet', 'replace faucet', 'new faucet'], pricing: { low: 120, high: 350, average: 220 }, unit: 'per faucet', includes: ['Old faucet removal', 'New faucet install', 'Seal and test'] },
          { id: 'toilet-install', name: 'Toilet Installation / Replacement', desc: 'Install or replace a toilet', keywords: ['install toilet', 'replace toilet', 'new toilet'], pricing: { low: 150, high: 400, average: 250 }, unit: 'per toilet', includes: ['Old toilet removal', 'New toilet install', 'Wax seal', 'Test'] },
        ]
      },
      hvac: {
        name: 'HVAC', icon: '❄️', color: '#06b6d4',
        keywords: ['hvac', 'ac', 'air', 'heat', 'cool', 'furnace', 'duct', 'vent', 'filter', 'maintenance'],
        services: [
          { id: 'hvac-install-ac', name: 'Central AC Installation', desc: 'Install new central air conditioning', keywords: ['install ac', 'central ac', 'new ac unit', 'air conditioning install'], pricing: { low: 3500, high: 8000, average: 5500 }, unit: 'per unit', includes: ['Unit install', 'Duct connection', 'Refrigerant lines', 'Electrical', 'Testing'] },
          { id: 'hvac-repair', name: 'AC / Furnace Repair', desc: 'Repair heating or cooling system', keywords: ['ac repair', 'furnace repair', 'fix ac', 'hvac repair'], pricing: { low: 80, high: 350, average: 175 }, unit: 'per visit', includes: ['Diagnostic fee', 'Labor', 'Minor parts'] },
          { id: 'hvac-maintenance', name: 'AC Maintenance / Tune-Up', desc: 'Annual maintenance for AC or furnace', keywords: ['ac maintenance', 'tune up', 'ac service', 'preventative maintenance'], pricing: { low: 75, high: 200, average: 125 }, unit: 'per visit', includes: ['Filter replacement', 'Coil cleaning', 'System check'] },
        ]
      },
      painting: {
        name: 'Painting', icon: '🎨', color: '#f97316',
        keywords: ['paint', 'painting', 'wall', 'ceiling', 'trim', 'cabinet', 'stain', 'exterior', 'interior'],
        services: [
          { id: 'paint-interior', name: 'Interior Painting - Per Room', desc: 'Paint interior walls of one room', keywords: ['paint interior', 'paint room', 'interior paint', 'paint walls'], pricing: { low: 300, high: 900, average: 550 }, unit: 'per room', includes: ['Paint and primer', 'Two coats', 'Baseboards masked', 'Tape and prep'] },
          { id: 'paint-exterior', name: 'Exterior Painting - Whole House', desc: 'Paint exterior of house', keywords: ['exterior paint', 'paint outside', 'house paint', 'exterior'], pricing: { low: 2500, high: 8000, average: 5000 }, unit: 'per house', includes: ['Power wash', 'Scraping', 'Primer', 'Two coats', 'Doors and trim'] },
        ]
      },
      electrical: {
        name: 'Electrical', icon: '⚡', color: '#eab308',
        keywords: ['electric', 'outlet', 'wire', 'switch', 'light', 'circuit', 'panel', 'breaker'],
        services: [
          { id: 'elec-outlet', name: 'Outlet / Receptacle Installation', desc: 'Install new electrical outlet', keywords: ['install outlet', 'new outlet', 'electrical outlet', 'receptacle'], pricing: { low: 100, high: 250, average: 160 }, unit: 'per outlet', includes: ['New outlet', 'Wire run', 'Breaker connection', 'Test'] },
          { id: 'elec-switch', name: 'Light Switch Installation', desc: 'Install or replace light switch', keywords: ['install switch', 'light switch', 'replace switch'], pricing: { low: 75, high: 200, average: 125 }, unit: 'per switch', includes: ['Switch install', 'Wire connection', 'Test'] },
        ]
      },
      roofing: {
        name: 'Roofing', icon: '🏠', color: '#64748b',
        keywords: ['roof', 'roofing', 'shingle', 'leak', 'gutter', 'flashing', 'tile', 'metal'],
        services: [
          { id: 'roof-repair', name: 'Roof Repair', desc: 'Repair section of roof', keywords: ['roof repair', 'fix roof', 'leak repair', 'shingle repair'], pricing: { low: 200, high: 1200, average: 500 }, unit: 'per repair', includes: ['Shingle replacement', 'Underlayment patch', 'Sealant'] },
          { id: 'roof-replace', name: 'Roof Replacement - Asphalt Shingle', desc: 'Replace asphalt shingle roof', keywords: ['roof replacement', 'new roof', 'shingle roof', 'reroof'], pricing: { low: 4000, high: 12000, average: 7500 }, unit: 'per roof', includes: ['Tear off old', 'Underlayment', 'New shingles', 'Flashing', 'Vent caps'] },
        ]
      },
      handyman: {
        name: 'Handyman', icon: '🛠️', color: '#8b5cf6',
        keywords: ['handyman', 'general', 'repair', 'fix', 'mount', 'install', 'assemble', 'maintenance'],
        services: [
          { id: 'handyman-hour', name: 'Handyman - Hourly Rate', desc: 'General handyman labor', keywords: ['handyman', 'general repair', 'fix', 'mount', 'assemble'], pricing: { low: 55, high: 95, average: 75 }, unit: 'per hour', includes: ['Labor', 'Basic tools'] },
          { id: 'tv-mount', name: 'TV Mounting', desc: 'Mount TV to wall', keywords: ['mount tv', 'tv mount', 'hang tv', 'wall mount tv'], pricing: { low: 100, high: 250, average: 150 }, unit: 'per tv', includes: ['Mount install', 'Cable management', 'Level adjustment'] },
          { id: 'shelf-install', name: 'Shelf / Fixture Installation', desc: 'Install shelves or wall fixtures', keywords: ['install shelf', 'shelf mount', 'fixture install', 'wall shelf'], pricing: { low: 60, high: 180, average: 100 }, unit: 'per unit', includes: ['Mount install', 'Hardware', 'Level'] },
        ]
      },
      cleaning: {
        name: 'Cleaning', icon: '✨', color: '#ec4899',
        keywords: ['clean', 'cleaning', 'carpet', 'window', 'pressure', 'gutter', 'maid'],
        services: [
          { id: 'clean-house', name: 'House Cleaning - Standard', desc: 'Standard house cleaning', keywords: ['house cleaning', 'clean house', 'maid service', 'regular cleaning'], pricing: { low: 120, high: 350, average: 200 }, unit: 'per visit', includes: ['All rooms', 'Kitchen and bathrooms', 'Floors', 'Dusting'] },
          { id: 'clean-gutter', name: 'Gutter Cleaning', desc: 'Clean gutters and downspouts', keywords: ['gutter cleaning', 'clean gutters', 'gutter unclog'], pricing: { low: 100, high: 300, average: 175 }, unit: 'per house', includes: ['Clear debris', 'Flush downspouts', 'Bag debris'] },
          { id: 'clean-carpet', name: 'Carpet Cleaning', desc: 'Professional carpet deep cleaning', keywords: ['carpet cleaning', 'deep clean carpet', 'steam clean'], pricing: { low: 150, high: 450, average: 275 }, unit: 'per house', includes: ['Pre-treatment', 'Hot water extraction', 'Deodorizing'] },
        ]
      },
      landscaping: {
        name: 'Landscaping', icon: '🌿', color: '#84cc16',
        keywords: ['landscape', 'lawn', 'grass', 'mulch', 'sod', 'garden', 'bed', 'irrigation'],
        services: [
          { id: 'landscape-mow', name: 'Lawn Mowing', desc: 'Regular lawn mowing service', keywords: ['mowing', 'lawn mowing', 'cut grass'], pricing: { low: 35, high: 80, average: 50 }, unit: 'per visit', includes: ['Mow', 'Edge', 'Blow clippings'] },
          { id: 'landscape-mulch', name: 'Mulch Installation', desc: 'Install mulch in landscape beds', keywords: ['mulch', 'mulch install', 'landscape mulch'], pricing: { low: 50, high: 90, average: 70 }, unit: 'per cubic yard', includes: ['Delivery', 'Spread', 'Edge definition'] },
        ]
      }
    };
  }
  return catalogCache;
}

router.get('/search', async (req, res) => {
  const { q, zip, groq_key, openrouter_key } = req.query;

  if (!q || q.trim().length < 3) {
    return res.status(400).json({ error: 'Query too short', hint: 'Please describe the service in at least 3 characters' });
  }

  // Configure LLM keys if provided
  if (groq_key) setGroqKey(groq_key);
  if (openrouter_key) {
    setOrKey(openrouter_key);
    setCap(10.00);
  }

  const regionData = getRegionData(zip);
  const catalog = getCatalog();

  try {
    const result = await search(q, {
      zip,
      catalog,
      groqKey: groq_key,
      openrouterKey: openrouter_key,
      costIndex: regionData.costIndex,
      location: `${regionData.city}, ${regionData.state}`
    });

    res.json({
      query: q,
      zip: zip || null,
      ...result,
      region: {
        city: regionData.city,
        state: regionData.state,
        costIndex: regionData.costIndex
      }
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed', message: err.message });
  }
});

export default router;