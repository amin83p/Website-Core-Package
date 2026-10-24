'use strict';

/**
 * Registry of environment keys the app reads via integrationVariableService.
 * Register new keys here when wiring a feature to Integration Variables.
 */

const REGISTRY_ENTRIES = [
  {
    key: 'CANADA_POST_ADDRESS_API_KEY',
    group: 'Canada Post AddressComplete',
    description: 'API key for address autocomplete (not Google Places).',
    consumers: ['MVC/services/canadaPostAddressCompleteService.js'],
    secretRecommended: true
  },
  {
    key: 'CANADA_POST_ADDRESS_COUNTRY',
    group: 'Canada Post AddressComplete',
    description: 'Country code filter for suggestions (e.g. CAN).',
    consumers: ['MVC/services/canadaPostAddressCompleteService.js'],
    secretRecommended: false
  },
  {
    key: 'CANADA_POST_ADDRESS_MAX_SUGGESTIONS',
    group: 'Canada Post AddressComplete',
    description: 'Maximum number of address suggestions returned.',
    consumers: ['MVC/services/canadaPostAddressCompleteService.js'],
    secretRecommended: false
  },
  {
    key: 'MICROSOFT_AUTH_ENABLED',
    group: 'Microsoft OAuth',
    description: 'Enable Microsoft sign-in (true/yes/1/on).',
    consumers: ['MVC/services/microsoftAuthService.js'],
    secretRecommended: false,
    microsoftAuth: true
  },
  {
    key: 'MICROSOFT_CLIENT_ID',
    group: 'Microsoft OAuth',
    description: 'Azure app registration client ID.',
    consumers: ['MVC/services/microsoftAuthService.js'],
    secretRecommended: false,
    microsoftAuth: true
  },
  {
    key: 'MICROSOFT_CLIENT_SECRET',
    group: 'Microsoft OAuth',
    description: 'Azure app registration client secret.',
    consumers: ['MVC/services/microsoftAuthService.js'],
    secretRecommended: true,
    microsoftAuth: true
  },
  {
    key: 'MICROSOFT_TENANT_ID',
    group: 'Microsoft OAuth',
    description: 'Azure tenant ID (optional; used with authority).',
    consumers: ['MVC/services/microsoftAuthService.js'],
    secretRecommended: false,
    microsoftAuth: true,
    optional: true
  },
  {
    key: 'MICROSOFT_AUTHORITY_TENANT',
    group: 'Microsoft OAuth',
    description: 'Authority tenant segment (e.g. organizations, common, or tenant GUID).',
    consumers: ['MVC/services/microsoftAuthService.js'],
    secretRecommended: false,
    microsoftAuth: true,
    optional: true
  },
  {
    key: 'MICROSOFT_REDIRECT_URIS',
    group: 'Microsoft OAuth',
    description: 'Comma-separated OAuth callback URLs, one per public domain.',
    consumers: ['MVC/services/microsoftAuthService.js', 'config/microsoftAuth.js'],
    secretRecommended: false,
    microsoftAuth: true,
    aliases: ['MICROSOFT_REDIRECT_URI']
  },
  {
    key: 'MICROSOFT_REDIRECT_URI',
    group: 'Microsoft OAuth',
    description: 'Single OAuth callback URL fallback when MICROSOFT_REDIRECT_URIS is unset.',
    consumers: ['MVC/services/microsoftAuthService.js', 'config/microsoftAuth.js'],
    secretRecommended: false,
    microsoftAuth: true,
    aliases: []
  },
  {
    key: 'MICROSOFT_ALLOWED_DOMAIN',
    group: 'Microsoft OAuth',
    description: 'Email domain allowed to sign in (e.g. equilibrium.ab.ca).',
    consumers: ['MVC/services/microsoftAuthService.js'],
    secretRecommended: false,
    microsoftAuth: true
  },
  {
    key: 'MICROSOFT_ENFORCE_TENANT',
    group: 'Microsoft OAuth',
    description: 'When true, restrict sign-in to MICROSOFT_TENANT_ID.',
    consumers: ['MVC/services/microsoftAuthService.js'],
    secretRecommended: false,
    microsoftAuth: true,
    optional: true
  },
  {
    key: 'PUBLIC_APP_URL',
    group: 'Microsoft OAuth',
    description: 'Public site URL; also derives /auth/microsoft/callback when redirect URIs are built.',
    consumers: ['config/microsoftAuth.js'],
    secretRecommended: false,
    microsoftAuth: true
  },
  {
    key: 'WEBSITE_BASE_URL',
    group: 'Microsoft OAuth',
    description: 'Alternate public base URL for implicit Microsoft callback derivation.',
    consumers: ['config/microsoftAuth.js'],
    secretRecommended: false,
    microsoftAuth: true
  },
  {
    key: 'APP_URL',
    group: 'Microsoft OAuth',
    description: 'Alternate public base URL for implicit Microsoft callback derivation.',
    consumers: ['config/microsoftAuth.js'],
    secretRecommended: false,
    microsoftAuth: true
  },
  {
    key: 'BASE_URL',
    group: 'Microsoft OAuth',
    description: 'Alternate public base URL for implicit Microsoft callback derivation.',
    consumers: ['config/microsoftAuth.js'],
    secretRecommended: false,
    microsoftAuth: true
  }
];

function normalizeKey(value = '') {
  return String(value || '').trim().toUpperCase();
}

function entryMatchesKey(entry, normalizedKey) {
  if (!entry || !normalizedKey) return false;
  if (normalizeKey(entry.key) === normalizedKey) return true;
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  return aliases.some((alias) => normalizeKey(alias) === normalizedKey);
}

function findRegistryEntriesByKey(key = '') {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return [];
  return REGISTRY_ENTRIES.filter((entry) => entryMatchesKey(entry, normalizedKey));
}

function listAllRegisteredKeys() {
  const keys = new Set();
  REGISTRY_ENTRIES.forEach((entry) => {
    keys.add(normalizeKey(entry.key));
    (Array.isArray(entry.aliases) ? entry.aliases : []).forEach((alias) => {
      keys.add(normalizeKey(alias));
    });
  });
  return [...keys].sort();
}

function getMicrosoftAuthEnvKeys() {
  const keys = new Set();
  REGISTRY_ENTRIES.forEach((entry) => {
    if (!entry.microsoftAuth) return;
    keys.add(normalizeKey(entry.key));
    (Array.isArray(entry.aliases) ? entry.aliases : []).forEach((alias) => {
      keys.add(normalizeKey(alias));
    });
  });
  return [...keys];
}

function isMicrosoftAuthRegistryKey(key = '') {
  return findRegistryEntriesByKey(key).some((entry) => entry.microsoftAuth);
}

module.exports = {
  REGISTRY_ENTRIES,
  findRegistryEntriesByKey,
  listAllRegisteredKeys,
  getMicrosoftAuthEnvKeys,
  isMicrosoftAuthRegistryKey,
  normalizeRegistryKey: normalizeKey
};
