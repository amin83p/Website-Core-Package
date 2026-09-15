(function initCanadianAddressAutocomplete(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attach(options = {}) {
    const inputEl = options.inputEl;
    const suggestionsEl = options.suggestionsEl;
    const onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
    const minChars = Number.isFinite(Number(options.minChars)) ? Number(options.minChars) : 3;
    const debounceMs = Number.isFinite(Number(options.debounceMs)) ? Number(options.debounceMs) : 350;
    const searchUrl = String(options.searchUrl || '/api/address/search').trim() || '/api/address/search';
    const retrieveUrl = String(options.retrieveUrl || '/api/address/retrieve').trim() || '/api/address/retrieve';

    if (!inputEl || !suggestionsEl || !onSelect) return null;

    let debounceTimer = null;
    let activeController = null;

    function hideSuggestions() {
      suggestionsEl.style.display = 'none';
    }

    function showLoading() {
      suggestionsEl.innerHTML = '<div class="list-group-item text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Searching...</div>';
      suggestionsEl.style.display = 'block';
    }

    async function requestJson(url) {
      if (activeController) {
        activeController.abort();
      }
      activeController = new AbortController();
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: activeController.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.message || 'Unable to search addresses.';
        throw new Error(message);
      }
      return payload;
    }

    async function search(query, lastId = '') {
      const params = new URLSearchParams({ q: query });
      if (lastId) params.set('lastId', lastId);
      const payload = await requestJson(`${searchUrl}?${params.toString()}`);
      return Array.isArray(payload?.suggestions) ? payload.suggestions : [];
    }

    async function retrieve(id) {
      const params = new URLSearchParams({ id });
      const payload = await requestJson(`${retrieveUrl}?${params.toString()}`);
      return payload?.address || null;
    }

    function renderSuggestions(rows) {
      suggestionsEl.innerHTML = '';
      if (!rows.length) {
        suggestionsEl.innerHTML = '<div class="list-group-item text-muted">No results found.</div>';
        suggestionsEl.style.display = 'block';
        return;
      }
      rows.forEach((row) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'list-group-item list-group-item-action text-start small';
        const label = String(row.label || '').trim();
        const description = String(row.description || '').trim();
        const detail = description && !label.includes(description)
          ? `<div class="text-muted x-small">${escapeHtml(description)}</div>`
          : '';
        btn.innerHTML = '<i class="bi bi-geo-alt me-2 text-primary"></i>' + escapeHtml(label) + detail;
        btn.addEventListener('click', async () => {
          try {
            showLoading();
            if (row.next === 'Find') {
              const query = String(inputEl.value || '').trim();
              const nested = await search(query, String(row.id || '').trim());
              renderSuggestions(nested);
              return;
            }
            const address = await retrieve(String(row.id || '').trim());
            if (!address) throw new Error('Address details were not returned.');
            onSelect(address);
            inputEl.value = '';
            hideSuggestions();
          } catch (error) {
            if (error?.name === 'AbortError') return;
            suggestionsEl.innerHTML = '<div class="list-group-item text-danger small">' + escapeHtml(error.message || 'Address lookup failed.') + '</div>';
            suggestionsEl.style.display = 'block';
          }
        });
        suggestionsEl.appendChild(btn);
      });
      suggestionsEl.style.display = 'block';
    }

    inputEl.addEventListener('input', () => {
      const query = String(inputEl.value || '').trim();
      clearTimeout(debounceTimer);
      if (query.length < minChars) {
        hideSuggestions();
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          showLoading();
          const rows = await search(query);
          renderSuggestions(rows);
        } catch (error) {
          if (error?.name === 'AbortError') return;
          suggestionsEl.innerHTML = '<div class="list-group-item text-danger small">' + escapeHtml(error.message || 'Address search failed.') + '</div>';
          suggestionsEl.style.display = 'block';
        }
      }, debounceMs);
    });

    document.addEventListener('click', (event) => {
      if (!inputEl.contains(event.target) && !suggestionsEl.contains(event.target)) {
        hideSuggestions();
      }
    });

    return { destroy: hideSuggestions };
  }

  global.CanadianAddressAutocomplete = {
    attach
  };
})(window);
