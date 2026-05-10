# RateCheck API

**AI-powered service pricing intelligence.** Enter any service description — from tree removal to wedding DJing — get an educated high/low/average estimate based on analogous market data and LLM reasoning.

---

## How It Works

```
You: "de-clutter and organize a single car garage with no car, 
      filled with junk like a storage unit"

└─ Tier 1: Local keyword match (instant, free)
   → No direct match for "garage organizing"

└─ Tier 2: Groq LLM (free tier, 30 req/min)
   → Finds analogous: move-in service + storage unit rate + decluttering premium
   → Scales known prices → estimate

└─ Output: $450 - $950 (low-end organizing) to $1,200 - $2,500 (full cleanout)

└─ "Based on: boxing/packout service (similar labor), 
    storage unit organization (same end state), 
    junk removal (volume-based pricing)"
```

---

## Stack

- **Express** API server
- **Groq** (free tier, Llama 3.1 8B) — primary LLM
- **OpenRouter** (~$0.001/query cap) — fallback
- **Local keyword matching** — instant, no API needed

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure API keys (optional but recommended)

Get free Groq key at [console.groq.com](https://console.groq.com)

The API key is passed per-request via the frontend settings modal.
Or set as environment variable:

```bash
export GROQ_API_KEY=gsk_your_key_here
export OPENROUTER_API_KEY=sk-or-your_key_here
```

### 3. Start the server

```bash
# Development
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3001`

---

## API

### `GET /api/search`

**Parameters:**
| Param | Description |
|-------|-------------|
| `q` | Service description (required) |
| `zip` | ZIP code for regional adjustment (optional) |
| `groq_key` | Groq API key (optional — or use env var) |
| `openrouter_key` | OpenRouter API key (optional — or use env var) |

**Example:**
```bash
curl "http://localhost:3001/api/search?q=organize%20single%20car%20garage&zip=77062"
```

**Response:**
```json
{
  "query": "organize single car garage",
  "zip": "77062",
  "tier": 2,
  "matchType": "analogous",
  "confidence": "medium",
  "serviceName": "organize single car garage",
  "pricing": {
    "low": 450,
    "high": 1200,
    "average": 750,
    "formattedLow": "$450",
    "formattedHigh": "$1,200",
    "formattedAvg": "$750",
    "unit": "per job"
  },
  "reasoning": ["Based on analogous services: move-in service, storage unit rate..."],
  "analogies": ["Similar labor structure to move-in/boxing service", "Volume-based like junk removal"],
  "dataSources": ["Groq LLM reasoning", "RateCheck Service Catalog"],
  "pipeline": "groq",
  "region": { "city": "Houston", "state": "TX", "costIndex": 97 }
}
```

---

## Local-Only Version

The standalone frontend (no API server) is available at:
https://github.com/Texmexdex/ratecheck

This version uses local keyword matching only — no API keys needed, runs entirely in browser.

---

## Deployment

### Run locally
```bash
node server.js
```

### Deploy to Fly.io (free)
```bash
fly launch
fly deploy
```

---

## Cost

| Method | Cost |
|--------|------|
| Local keyword match | Free |
| Groq (free tier) | Free (30 req/min) |
| OpenRouter Llama 3.3 8B | ~$0.001/query |
| OpenRouter Llama 3.3 70B | ~$0.01/query |

$10 OpenRouter budget = ~7,000–10,000 queries.

---

## Next Steps

- [ ] Add more regional cost data (expand ZIP coverage)
- [ ] User accounts and search history
- [ ] Affiliate links for service providers
- [ ] FieldForge integration (→ generate actual quotes from estimates)
- [ ] Mobile app (React Native or PWA)