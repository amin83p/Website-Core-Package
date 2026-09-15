const integrationVariableService = require('./integrationVariableService');

const FIND_URL = 'https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Find/v2.10/json3.ws';
const RETRIEVE_URL = 'https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Retrieve/v2.11/json3.ws';
const DEFAULT_COUNTRY = 'CAN';
const DEFAULT_MAX_SUGGESTIONS = 7;
const MAX_SUGGESTIONS = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;

const findCache = new Map();

function normalizePostalCode(value = '') {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 6) return String(value || '').trim();
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function readConfig() {
  const apiKey = integrationVariableService.getIntegrationVariable('CANADA_POST_ADDRESS_API_KEY');
  const country = (
    integrationVariableService.getIntegrationVariable('CANADA_POST_ADDRESS_COUNTRY')
    || DEFAULT_COUNTRY
  ).trim().toUpperCase() || DEFAULT_COUNTRY;
  const maxSuggestionsRaw = Number.parseInt(
    integrationVariableService.getIntegrationVariable('CANADA_POST_ADDRESS_MAX_SUGGESTIONS')
      || String(DEFAULT_MAX_SUGGESTIONS),
    10
  );
  const maxSuggestions = Number.isFinite(maxSuggestionsRaw)
    ? Math.max(1, Math.min(MAX_SUGGESTIONS, maxSuggestionsRaw))
    : DEFAULT_MAX_SUGGESTIONS;
  return { apiKey, country, maxSuggestions };
}

function assertConfigured(config = {}) {
  if (!config.apiKey) {
    const error = new Error(
      'Address autocomplete is not configured. Add CANADA_POST_ADDRESS_API_KEY in Application Defaults → Integration Variables.'
    );
    error.code = 'configuration_error';
    throw error;
  }
}

function extractItems(payload = {}) {
  if (Array.isArray(payload?.Items)) return payload.Items;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractRetrieveRow(payload = {}) {
  const items = extractItems(payload);
  return items[0] && typeof items[0] === 'object' ? items[0] : null;
}

function mapFindItem(item = {}) {
  const id = String(item.Id || item.id || '').trim();
  const text = String(item.Text || item.text || '').trim();
  const description = String(item.Description || item.description || '').trim();
  const next = String(item.Next || item.next || 'Retrieve').trim();
  const label = [text, description].filter(Boolean).join(' — ');
  return {
    id,
    label: label || text || description,
    description,
    next: next === 'Find' ? 'Find' : 'Retrieve',
    address: null
  };
}

function mapRetrieveRow(row = {}) {
  const line1 = [String(row.Line1 || '').trim(), String(row.Line2 || '').trim()]
    .filter(Boolean)
    .join(', ');
  const streetFallback = [String(row.BuildingNumber || '').trim(), String(row.Street || '').trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  return {
    line1: line1 || streetFallback,
    city: String(row.City || '').trim(),
    province: String(row.ProvinceCode || row.Province || '').trim(),
    postalCode: normalizePostalCode(row.PostalCode || '')
  };
}

function getFindCacheKey(searchTerm, lastId, country, maxSuggestions) {
  return [
    country,
    maxSuggestions,
    String(lastId || '').trim(),
    String(searchTerm || '').trim().toLowerCase()
  ].join('|');
}

async function callCanadaPost(url, params = {}) {
  const requestUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      requestUrl.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(requestUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    const error = new Error(`Address search failed (${response.status}).`);
    error.code = 'upstream_error';
    throw error;
  }
  const payload = await response.json();
  const errorItem = extractItems(payload).find((row) => Number(row?.Error) > 0);
  if (errorItem) {
    const error = new Error(String(errorItem.Description || errorItem.Cause || 'Canada Post address lookup failed.'));
    error.code = 'upstream_error';
    throw error;
  }
  return payload;
}

async function findAddresses({ query, lastId, country, maxSuggestions } = {}) {
  const searchTerm = String(query || '').trim();
  if (searchTerm.length < 3) {
    throw new Error('Search query must be at least 3 characters.');
  }

  const config = readConfig();
  assertConfigured(config);

  const resolvedCountry = String(country || config.country || DEFAULT_COUNTRY).trim().toUpperCase() || DEFAULT_COUNTRY;
  const resolvedMaxSuggestions = Number.isFinite(Number(maxSuggestions))
    ? Math.max(1, Math.min(MAX_SUGGESTIONS, Number(maxSuggestions)))
    : config.maxSuggestions;
  const resolvedLastId = String(lastId || '').trim();

  const cacheKey = getFindCacheKey(searchTerm, resolvedLastId, resolvedCountry, resolvedMaxSuggestions);
  const cached = findCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    return cached.payload;
  }

  const payload = await callCanadaPost(FIND_URL, {
    Key: config.apiKey,
    SearchTerm: searchTerm,
    Country: resolvedCountry,
    MaxSuggestions: resolvedMaxSuggestions,
    LastId: resolvedLastId
  });

  const suggestions = extractItems(payload)
    .map((item) => mapFindItem(item))
    .filter((row) => row.id && row.label);

  const result = {
    suggestions,
    query: searchTerm,
    lastId: resolvedLastId || ''
  };
  findCache.set(cacheKey, { at: Date.now(), payload: result });
  return result;
}

async function retrieveAddress({ id } = {}) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) throw new Error('Address id is required.');

  const config = readConfig();
  assertConfigured(config);

  const payload = await callCanadaPost(RETRIEVE_URL, {
    Key: config.apiKey,
    Id: normalizedId
  });

  const row = extractRetrieveRow(payload);
  if (!row) throw new Error('Canada Post did not return address details for the selected item.');

  return {
    id: normalizedId,
    address: mapRetrieveRow(row)
  };
}

module.exports = {
  normalizePostalCode,
  mapFindItem,
  mapRetrieveRow,
  findAddresses,
  retrieveAddress
};
