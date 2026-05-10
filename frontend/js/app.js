/**
 * RateCheck API - Frontend Application
 * Calls the backend API with optional Groq/OpenRouter keys
 */

// ============================================
// STATE
// ============================================

const state = {
  query: '',
  zip: '',
  groqKey: localStorage.getItem('groq_key') || '',
  openrouterKey: localStorage.getItem('openrouter_key') || '',
  results: null,
  loading: false,
  error: null
};

// ============================================
// DOM
// ============================================

const $ = id => document.getElementById(id);

// ============================================
// INIT
// ============================================

function init() {
  // Example searches
  const examples = [
    'commissions for a personalized family portrait',
    'organize and declutter a single car garage',
    'DJ for a 4 hour wedding reception',
    'custom welded steel table for restaurant',
    'professional headshots for small business team',
    'deep clean for 3 bedroom 2 bath house',
    'personal chef for dinner party of 12',
    'custom built-in bookshelf for home office'
  ];

  const chipsEl = $('example-chips');
  chipsEl.innerHTML = examples.map(q =>
    `<button class="example-chip" onclick="fillExample('${q.replace(/'/g, "\\'")}')">${q}</button>`
  ).join('');

  // Form
  $('search-form')?.addEventListener('submit', handleSearch);

  // ZIP formatting
  $('zip-input')?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '').substring(0, 5);
  });

  // Settings modal
  $('open-settings')?.addEventListener('click', openSettings);
  $('close-settings')?.addEventListener('click', closeSettings);
  $('save-settings')?.addEventListener('click', saveSettings);
  $('modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Keyboard shortcut to open settings
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      openSettings();
    }
  });

  // Pre-load saved keys into modal
  $('groq-key-input').value = state.groqKey;
  $('or-key-input').value = state.openrouterKey;

  updateApiBadges();

  // URL params
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) $('query-input').value = params.get('q');
  if (params.get('zip')) $('zip-input').value = params.get('zip');
}

function fillExample(query) {
  $('query-input').value = query;
  $('query-input').focus();
}

function openSettings() {
  $('modal-overlay').classList.add('open');
  $('groq-key-input').focus();
}

function closeSettings() {
  $('modal-overlay').classList.remove('open');
}

function saveSettings() {
  state.groqKey = $('groq-key-input').value.trim();
  state.openrouterKey = $('or-key-input').value.trim();

  if (state.groqKey) localStorage.setItem('groq_key', state.groqKey);
  else localStorage.removeItem('groq_key');

  if (state.openrouterKey) localStorage.setItem('openrouter_key', state.openrouterKey);
  else localStorage.removeItem('openrouter_key');

  updateApiBadges();
  closeSettings();
}

function updateApiBadges() {
  const groqBadge = $('groq-badge');
  const orBadge = $('or-badge');

  if (groqBadge) {
    groqBadge.textContent = state.groqKey ? 'Groq Active' : 'Groq Off';
    groqBadge.className = `api-badge ${state.groqKey ? 'active' : 'inactive'}`;
  }

  if (orBadge) {
    orBadge.textContent = state.openrouterKey ? 'OpenRouter Active' : 'OpenRouter Off';
    orBadge.className = `api-badge ${state.openrouterKey ? 'active' : 'inactive'}`;
  }
}

// ============================================
// SEARCH
// ============================================

async function handleSearch(e) {
  if (e) e.preventDefault();

  const query = $('query-input')?.value?.trim();
  const zip = $('zip-input')?.value?.trim().replace(/[^0-9]/g, '').substring(0, 5);

  if (!query || query.length < 3) {
    showToast('Please describe the service in at least 3 characters', 'error');
    return;
  }

  state.query = query;
  state.zip = zip;
  state.loading = true;
  state.error = null;
  render();

  try {
    const params = new URLSearchParams();
    params.set('q', query);
    if (zip) params.set('zip', zip);
    if (state.groqKey) params.set('groq_key', state.groqKey);
    if (state.openrouterKey) params.set('openrouter_key', state.openrouterKey);

    const API_BASE = window.location.hostname === 'localhost'
      ? 'http://localhost:3001'
      : '';

    const resp = await fetch(`${API_BASE}/api/search?${params.toString()}`);

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.message || `Server error ${resp.status}`);
    }

    state.results = await resp.json();
    state.error = null;

  } catch (err) {
    console.error('Search failed:', err);
    state.error = err.message;
    state.results = null;
  }

  state.loading = false;
  render();
  scrollToResults();
}

function scrollToResults() {
  const resultsSection = $('results-section');
  if (resultsSection) {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ============================================
// RENDER
// ============================================

function render() {
  const loadingEl = $('loading-state');
  const resultsEl = $('results-section');
  const errorEl = $('error-state');

  if (state.loading) {
    loadingEl?.classList.add('visible');
    resultsEl?.classList.remove('visible');
    if (errorEl) errorEl.style.display = 'none';
    return;
  }

  loadingEl?.classList.remove('visible');

  if (state.error && !state.results) {
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.querySelector('.error-text').textContent = state.error;
    }
    return;
  }

  if (errorEl) errorEl.style.display = 'none';

  if (state.results) {
    resultsEl?.classList.add('visible');
    renderResults();
  }
}

function renderResults() {
  const container = $('results-container');
  if (!container || !state.results) return;

  const r = state.results;

  // Build analogies HTML
  const analogiesHtml = r.analogies && r.analogies.length > 0 ? `
    <div class="analogies-section">
      <div class="analogies-title">Based on Analogous Services</div>
      <ul class="analogies-list">
        ${r.analogies.map(a => `
          <li class="analogy-item">
            <span class="analogy-icon">↔</span>
            <span class="analogy-text">${a}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  ` : '';

  // Build reasoning HTML
  const reasoningHtml = r.reasoning && r.reasoning.length > 0 ? `
    <div class="reasoning-section">
      <div class="reasoning-title">How This Estimate Was Built</div>
      <div class="reasoning-text">${r.reasoning.join(' ')}</div>
    </div>
  ` : '';

  // Pipeline badge
  const pipelineLabels = {
    'local': { text: 'Catalog Match', cls: 'local' },
    'local-fallback': { text: 'Catalog (low confidence)', cls: 'local-fallback' },
    'groq': { text: 'AI Enhanced (Groq)', cls: 'groq' },
    'openrouter': { text: 'AI Reasoning (OpenRouter)', cls: 'openrouter' },
    'none': { text: 'General Estimate', cls: 'none' }
  };
  const pipe = pipelineLabels[r.pipeline] || pipelineLabels['none'];

  // Confidence icons
  const confIcons = {
    high: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    medium: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    low: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>'
  };

  // Warning if low confidence
  const warningHtml = r.warning ? `
    <div class="result-warning">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      ${r.warning}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="result-card result-card-primary">
      <!-- Header -->
      <div class="result-header">
        <div class="result-trade-badge" style="background: ${r.tradeColor}22; color: ${r.tradeColor};">
          ${r.tradeIcon} ${r.tradeName}
        </div>
        <div class="result-title-group">
          <h2 class="result-service-name">${r.serviceName}</h2>
          <p class="result-match-text">
            Searched: "<strong>${state.query}</strong>"
            &nbsp;·&nbsp; Match type: <strong>${r.matchType}</strong>
          </p>
          <div class="pipeline-badge ${pipe.cls}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            ${pipe.text}
          </div>
        </div>
        <div class="result-confidence ${r.confidence}">
          ${confIcons[r.confidence] || ''}
          ${r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1)} Confidence
        </div>
      </div>

      <!-- Pricing -->
      <div class="pricing-section">
        <div class="pricing-main">
          <div class="pricing-range">
            <div class="pricing-low">${r.pricing.formattedLow} <span>low</span></div>
            <div class="pricing-separator">—</div>
            <div class="pricing-high">${r.pricing.formattedHigh} <span>high</span></div>
          </div>
          <div class="pricing-average">
            Typical: <strong>${r.pricing.formattedAvg}</strong>
          </div>
          <div class="pricing-unit">${r.pricing.unit}</div>
        </div>
        <div class="pricing-region">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:middle">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          ${r.pricing.region}
          ${r.region?.costIndex && r.region.costIndex !== 100 ? ` · Cost index: ${r.region.costIndex}` : ''}
        </div>
      </div>

      ${warningHtml}

      ${reasoningHtml}
      ${analogiesHtml}

      <!-- Data Sources -->
      <div class="data-sources">
        <div class="data-sources-label">Data Sources</div>
        <div class="data-sources-list">${(r.dataSources || []).join(' • ')}</div>
      </div>

      <!-- CTA -->
      <div class="cta-section">
        <a href="https://github.com/Texmexdex/fieldforge-pwa" class="cta-primary" target="_blank">
          <div class="cta-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="9" y1="21" x2="9" y2="9"/>
            </svg>
          </div>
          <div class="cta-content">
            <div class="cta-title">Build Your Quote in FieldForge</div>
            <div class="cta-subtitle">Create professional estimates using these price ranges</div>
          </div>
          <svg class="cta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </a>
        <a href="#" class="cta-secondary" onclick="handleNewSearch(); return false;">
          ← Search another service
        </a>
      </div>
    </div>
  `;
}

function handleNewSearch() {
  state.results = null;
  state.query = '';
  $('query-input').value = '';
  $('results-section')?.classList.remove('visible');
  $('query-input')?.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const bg = type === 'error' ? 'var(--error)' : type === 'success' ? 'var(--success)' : 'var(--accent)';
  toast.style.cssText = `
    position:fixed;top:100px;left:50%;transform:translateX(-50%);
    background:${bg};color:white;padding:12px 20px;border-radius:8px;
    font-size:0.875rem;font-weight:500;z-index:1000;
    animation:fadeIn 0.2s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// START
// ============================================

init();