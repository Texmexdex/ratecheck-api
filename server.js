/**
 * RateCheck API Server
 * Express backend with Groq + OpenRouter LLM integration
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import searchRoutes from './routes/search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Routes
app.use('/api', searchRoutes);

// Serve frontend (production build)
const frontendPath = join(__dirname, 'frontend');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(join(frontendPath, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║          RateCheck API Server                ║
╠══════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}              ║
║  Health:  http://localhost:${PORT}/health       ║
║  API:     http://localhost:${PORT}/api/search   ║
╚══════════════════════════════════════════════╝
  `);
});

export default app;