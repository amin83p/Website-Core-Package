function clean(value = '') {
  return String(value || '').trim();
}

function enabledFromEnv(value = '') {
  return /^(1|true|yes|on)$/i.test(clean(value));
}

function normalizeDomain(value = '') {
  return clean(value).replace(/^@+/, '').toLowerCase();
}

function normalizeAuthorityTenant(value = '') {
  const token = clean(value);
  return token || 'organizations';
}

function isMultiTenantAuthority(value = '') {
  const token = clean(value).toLowerCase();
  return token === 'common' || token === 'organizations' || token === 'consumers';
}

function getMicrosoftAuthConfig() {
  const tenantId = clean(process.env.MICROSOFT_TENANT_ID);
  const authorityTenant = normalizeAuthorityTenant(process.env.MICROSOFT_AUTHORITY_TENANT || tenantId || 'organizations');
  const clientId = clean(process.env.MICROSOFT_CLIENT_ID);
  const clientSecret = clean(process.env.MICROSOFT_CLIENT_SECRET);
  const redirectUri = clean(process.env.MICROSOFT_REDIRECT_URI);
  const allowedDomain = normalizeDomain(process.env.MICROSOFT_ALLOWED_DOMAIN || 'equilibrium.ab.ca');
  const enabled = enabledFromEnv(process.env.MICROSOFT_AUTH_ENABLED);
  const enforceTenant = enabledFromEnv(process.env.MICROSOFT_ENFORCE_TENANT) && Boolean(tenantId);

  return {
    enabled,
    tenantId,
    authorityTenant,
    enforceTenant,
    multiTenantAuthority: isMultiTenantAuthority(authorityTenant),
    clientId,
    clientSecret,
    redirectUri,
    allowedDomain,
    authority: `https://login.microsoftonline.com/${authorityTenant}`,
    scopes: ['openid', 'profile', 'email']
  };
}

function validateMicrosoftAuthConfig(config = getMicrosoftAuthConfig()) {
  if (!config.enabled) return { ok: false, reason: 'disabled' };

  const missing = [];
  if (!config.clientId) missing.push('MICROSOFT_CLIENT_ID');
  if (!config.clientSecret) missing.push('MICROSOFT_CLIENT_SECRET');
  if (!config.redirectUri) missing.push('MICROSOFT_REDIRECT_URI');
  if (!config.allowedDomain) missing.push('MICROSOFT_ALLOWED_DOMAIN');

  if (missing.length > 0) {
    return { ok: false, reason: 'missing_config', missing };
  }

  return { ok: true };
}

module.exports = {
  getMicrosoftAuthConfig,
  validateMicrosoftAuthConfig
};
