const startupLogger = require('../../utils/startupLogger');
const emailLedgerService = require('../emailLedgerService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const { maskPhone, validateSmsPhoneE164 } = require('../../utils/phoneUtils');
const twilioVerifyProvider = require('./providers/twilioVerifyProvider');

function cleanText(value) {
  return String(value || '').trim();
}

function toLower(value) {
  return cleanText(value).toLowerCase();
}

function parseBoolean(value, fallback = false) {
  const token = toLower(value);
  if (!token) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  return fallback;
}

function resolveProviderId() {
  const token = toLower(process.env.SMS_PROVIDER);
  if (!token) return '';
  if (token === 'twilio_verify' || token === 'twilio' || token === 'twilio-verify') return 'twilio_verify';
  return token;
}

function resolveProvider() {
  const providerId = resolveProviderId();
  if (providerId === 'twilio_verify') return twilioVerifyProvider;
  return null;
}

function isProviderEnabled() {
  const providerId = resolveProviderId();
  if (!providerId) return false;
  const explicit = cleanText(process.env.SMS_PROVIDER_ENABLED);
  return explicit ? parseBoolean(explicit, true) : true;
}

function getReadiness() {
  const providerId = resolveProviderId();
  const provider = resolveProvider();
  const configured = Boolean(provider && typeof provider.isConfigured === 'function' && provider.isConfigured());
  const enabled = isProviderEnabled();
  return {
    providerId,
    enabled,
    configured,
    active: Boolean(providerId && enabled && configured)
  };
}

async function recordSmsLedger({
  status = 'accepted',
  phoneE164 = '',
  purpose = '',
  orgId = '',
  userId = '',
  providerId = '',
  eventKey = '',
  providerMessageId = '',
  providerStatusCode = 0,
  errorMessage = '',
  meta = {}
} = {}) {
  const maskedPhone = maskPhone(phoneE164);
  const safePurpose = cleanText(purpose || 'security_verification') || 'security_verification';
  const ledgerMeta = meta && typeof meta === 'object' ? { ...meta } : {};
  ledgerMeta.channel = 'sms';
  ledgerMeta.purpose = safePurpose;
  ledgerMeta.maskedPhone = maskedPhone;

  await emailLedgerService.recordOutboundEmail({
    dateTime: new Date().toISOString(),
    provider: cleanText(providerId || 'sms'),
    orgId: cleanText(orgId),
    sectionId: cleanText(SECTIONS.USERS),
    operationId: cleanText(OPERATIONS.UPDATE),
    eventKey: cleanText(eventKey || 'AUTH_PASSWORD_RESET_SMS'),
    from: cleanText(providerId || 'sms'),
    to: phoneE164 ? [phoneE164] : [],
    replyTo: '',
    subject: `SMS ${safePurpose}`.slice(0, 250),
    text: maskedPhone ? `SMS verification to ${maskedPhone}` : 'SMS verification event.',
    html: '',
    actor: {
      userId: cleanText(userId),
      username: '',
      displayName: ''
    },
    meta: ledgerMeta,
    status: cleanText(status || 'accepted').toLowerCase() || 'accepted',
    errorMessage: cleanText(errorMessage || ''),
    providerStatusCode: Number(providerStatusCode || 0) || 0,
    providerMessageId: cleanText(providerMessageId || ''),
    providerRaw: {}
  });
}

async function startVerification({
  phoneE164 = '',
  purpose = 'password_reset',
  orgId = '',
  userId = '',
  requestId = '',
  ip = ''
} = {}) {
  const readiness = getReadiness();
  if (!readiness.active) {
    const error = new Error('SMS provider is not configured.');
    error.code = 'SMS_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const provider = resolveProvider();
  const phoneValidation = validateSmsPhoneE164(phoneE164);
  if (!phoneValidation.ok) {
    const error = new Error('A valid phone number is required for SMS verification.');
    error.code = 'SMS_PHONE_INVALID';
    throw error;
  }
  const normalizedPhone = phoneValidation.phoneE164;

  startupLogger.info('SMS', 'VERIFY_START', 'Starting SMS verification.', {
    provider: readiness.providerId,
    purpose: cleanText(purpose),
    phone: maskPhone(normalizedPhone),
    requestId: cleanText(requestId),
    ip: cleanText(ip)
  });

  try {
    const result = await provider.startVerification({ phoneE164: normalizedPhone });
    await recordSmsLedger({
      status: 'accepted',
      phoneE164: normalizedPhone,
      purpose,
      orgId,
      userId,
      providerId: readiness.providerId,
      eventKey: 'AUTH_PASSWORD_RESET_SMS_START',
      providerMessageId: cleanText(result?.sid || ''),
      providerStatusCode: 200,
      meta: {
        requestId: cleanText(requestId),
        providerStatus: cleanText(result?.status || ''),
        channel: 'sms'
      }
    });

    startupLogger.success('SMS', 'VERIFY_START', 'SMS verification started.', {
      provider: readiness.providerId,
      phone: maskPhone(normalizedPhone),
      providerSid: cleanText(result?.sid || '')
    });
    return result;
  } catch (error) {
    const errorText = cleanText(error?.message || String(error));
    if (/invalid parameter\s*`?to`?/i.test(errorText)) {
      error.code = 'SMS_PHONE_INVALID';
    }
    await recordSmsLedger({
      status: 'failed',
      phoneE164: normalizedPhone,
      purpose,
      orgId,
      userId,
      providerId: readiness.providerId,
      eventKey: 'AUTH_PASSWORD_RESET_SMS_START',
      providerMessageId: '',
      providerStatusCode: Number(error?.statusCode || 0) || 0,
      errorMessage: errorText,
      meta: {
        requestId: cleanText(requestId),
        providerCode: Number(error?.providerCode || 0) || 0,
        channel: 'sms'
      }
    });
    throw error;
  }
}

async function checkVerification({
  phoneE164 = '',
  code = '',
  purpose = 'password_reset',
  orgId = '',
  userId = '',
  requestId = '',
  ip = ''
} = {}) {
  const readiness = getReadiness();
  if (!readiness.active) {
    const error = new Error('SMS provider is not configured.');
    error.code = 'SMS_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const provider = resolveProvider();
  const phoneValidation = validateSmsPhoneE164(phoneE164);
  if (!phoneValidation.ok) {
    return { ok: false, reason: 'invalid' };
  }
  const normalizedPhone = phoneValidation.phoneE164;

  startupLogger.info('SMS', 'VERIFY_CHECK', 'Checking SMS verification code.', {
    provider: readiness.providerId,
    purpose: cleanText(purpose),
    phone: maskPhone(normalizedPhone),
    hasCode: Boolean(cleanText(code)),
    requestId: cleanText(requestId),
    ip: cleanText(ip)
  });

  try {
    const result = await provider.checkVerification({
      phoneE164: normalizedPhone,
      code: cleanText(code)
    });

    await recordSmsLedger({
      status: result?.ok ? 'accepted' : 'failed',
      phoneE164: normalizedPhone,
      purpose,
      orgId,
      userId,
      providerId: readiness.providerId,
      eventKey: 'AUTH_PASSWORD_RESET_SMS_CHECK',
      providerMessageId: cleanText(result?.sid || ''),
      providerStatusCode: Number(result?.statusCode || 0) || 0,
      errorMessage: result?.ok ? '' : cleanText(result?.message || result?.reason || ''),
      meta: {
        requestId: cleanText(requestId),
        providerReason: cleanText(result?.reason || ''),
        providerStatus: cleanText(result?.status || ''),
        providerCode: Number(result?.providerCode || 0) || 0,
        channel: 'sms'
      }
    });

    return result;
  } catch (error) {
    await recordSmsLedger({
      status: 'failed',
      phoneE164: normalizedPhone,
      purpose,
      orgId,
      userId,
      providerId: readiness.providerId,
      eventKey: 'AUTH_PASSWORD_RESET_SMS_CHECK',
      providerMessageId: '',
      providerStatusCode: Number(error?.statusCode || 0) || 0,
      errorMessage: cleanText(error?.message || String(error)),
      meta: {
        requestId: cleanText(requestId),
        providerCode: Number(error?.providerCode || 0) || 0,
        channel: 'sms'
      }
    });
    throw error;
  }
}

function logStartupDiagnostics() {
  const readiness = getReadiness();
  startupLogger.info('SMS', 'PROVIDER_STATUS', 'SMS provider readiness snapshot.', {
    provider: readiness.providerId || 'none',
    enabled: readiness.enabled,
    configured: readiness.configured,
    active: readiness.active
  });
}

module.exports = {
  getReadiness,
  isConfigured: () => getReadiness().active,
  startVerification,
  checkVerification,
  logStartupDiagnostics
};
