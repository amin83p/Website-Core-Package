'use strict';

const DEFAULT_LOGIN_GREETING_AUDIO = Object.freeze({
  enabled: false,
  audioUrl: '',
  audioMaxSeconds: 12,
  inactivityHours: 3
});

function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function clampAudioMaxSeconds(raw) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LOGIN_GREETING_AUDIO.audioMaxSeconds;
  return Math.max(3, Math.min(60, parsed));
}

function clampInactivityHours(raw) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LOGIN_GREETING_AUDIO.inactivityHours;
  return Math.max(1, Math.min(24, parsed));
}

function sanitizeAudioUrl(raw) {
  const token = String(raw || '').trim();
  if (!token) return '';
  const lower = token.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return '';
  }
  if (/^https?:\/\//i.test(token)) {
    try {
      const parsed = new URL(token);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      if (parsed.pathname && parsed.pathname.toLowerCase().endsWith('.mp3')) {
        return `${parsed.pathname}${parsed.search || ''}`;
      }
      return '';
    } catch (_) {
      return '';
    }
  }
  if (!token.startsWith('/')) return '';
  if (!/\.mp3(\?|$)/i.test(token.split('#')[0])) return '';
  if (/\s/.test(token)) return '';
  return token;
}

function legacyFestiveSource(app) {
  const legacy = app && typeof app.festiveSeason === 'object' ? app.festiveSeason : null;
  if (!legacy) return null;
  return {
    enabled: legacy.enabled,
    audioUrl: legacy.audioUrl,
    audioMaxSeconds: legacy.audioMaxSeconds
  };
}

function rawLoginGreetingSource(app) {
  const appObj = app && typeof app === 'object' ? app : {};
  if (appObj.loginGreetingAudio && typeof appObj.loginGreetingAudio === 'object') {
    return appObj.loginGreetingAudio;
  }
  return legacyFestiveSource(appObj) || {};
}

function normalizeFromStored(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: isEnabledFlag(source.enabled) || source.enabled === true,
    audioUrl: sanitizeAudioUrl(source.audioUrl),
    audioMaxSeconds: clampAudioMaxSeconds(source.audioMaxSeconds),
    inactivityHours: clampInactivityHours(source.inactivityHours)
  };
}

function normalizeFromForm(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  return normalizeFromStored({
    enabled: source.loginGreetingEnabled === 'true',
    audioUrl: source.loginGreetingAudioUrl,
    audioMaxSeconds: source.loginGreetingAudioMaxSeconds,
    inactivityHours: source.loginGreetingInactivityHours
  });
}

function validatePolicyInput(policy = {}) {
  return normalizeFromStored(policy);
}

function enrichForDisplay(raw = {}) {
  return normalizeFromStored(raw);
}

function resolveForClient(appSettings = {}, options = {}) {
  const policy = normalizeFromStored(rawLoginGreetingSource(appSettings));
  const active = policy.enabled === true && Boolean(policy.audioUrl);
  const primaryDashboardHref = String(options.primaryDashboardHref || '/dashboard').trim() || '/dashboard';
  return {
    enabled: policy.enabled === true,
    active,
    audioUrl: policy.audioUrl,
    audioMaxSeconds: policy.audioMaxSeconds,
    inactivityHours: policy.inactivityHours,
    inactivityMs: policy.inactivityHours * 60 * 60 * 1000,
    primaryDashboardHref
  };
}

module.exports = {
  DEFAULT_LOGIN_GREETING_AUDIO,
  normalizeFromStored,
  normalizeFromForm,
  validatePolicyInput,
  enrichForDisplay,
  resolveForClient,
  sanitizeAudioUrl,
  rawLoginGreetingSource
};