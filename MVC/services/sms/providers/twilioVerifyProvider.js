const { maskPhone } = require('../../../utils/phoneUtils');

function cleanText(value) {
  return String(value || '').trim();
}

function getTwilioVerifyConfig() {
  return {
    accountSid: cleanText(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanText(process.env.TWILIO_AUTH_TOKEN),
    serviceSid: cleanText(process.env.TWILIO_VERIFY_SERVICE_SID),
    baseUrl: 'https://verify.twilio.com/v2'
  };
}

function isConfigured(config = null) {
  const cfg = config || getTwilioVerifyConfig();
  return Boolean(cfg.accountSid && cfg.authToken && cfg.serviceSid);
}

function buildAuthHeader(accountSid = '', authToken = '') {
  const credential = Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64');
  return `Basic ${credential}`;
}

function classifyTwilioVerifyError({ statusCode = 0, message = '', code = 0 } = {}) {
  const text = String(message || '').toLowerCase();
  const twilioCode = Number(code || 0) || 0;

  if (
    twilioCode === 60200
    || twilioCode === 60202
    || twilioCode === 60212
    || text.includes('invalid parameter')
    || text.includes('code is incorrect')
    || text.includes('verification code is incorrect')
    || text.includes('max check attempts')
  ) {
    return 'invalid';
  }

  if (
    twilioCode === 20404
    || twilioCode === 60203
    || text.includes('expired')
    || text.includes('not found')
    || text.includes('not pending')
  ) {
    return 'expired';
  }

  if (statusCode === 429 || text.includes('rate limit') || text.includes('too many requests')) {
    return 'rate_limited';
  }

  return 'provider_error';
}

async function postTwilioVerify({ path, params, config }) {
  const cfg = config || getTwilioVerifyConfig();
  if (!isConfigured(cfg)) {
    const error = new Error('Twilio Verify is not fully configured.');
    error.code = 'TWILIO_VERIFY_NOT_CONFIGURED';
    throw error;
  }

  const body = new URLSearchParams();
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      body.append(key, String(value));
    }
  });

  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(cfg.accountSid, cfg.authToken),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  let parsed = {};
  try {
    parsed = await response.json();
  } catch (_) {
    parsed = {};
  }

  return {
    ok: response.ok,
    statusCode: Number(response.status || 0) || 0,
    body: parsed
  };
}

async function startVerification({ phoneE164 = '' } = {}) {
  const cfg = getTwilioVerifyConfig();
  if (!isConfigured(cfg)) {
    const error = new Error('Twilio Verify is not configured.');
    error.code = 'TWILIO_VERIFY_NOT_CONFIGURED';
    throw error;
  }

  const result = await postTwilioVerify({
    path: `/Services/${encodeURIComponent(cfg.serviceSid)}/Verifications`,
    params: {
      To: phoneE164,
      Channel: 'sms'
    },
    config: cfg
  });

  if (!result.ok) {
    const apiMessage = cleanText(result.body?.message || result.body?.detail || '');
    const error = new Error(apiMessage || 'Twilio Verify request failed.');
    error.code = 'TWILIO_VERIFY_START_FAILED';
    error.statusCode = result.statusCode;
    error.providerCode = Number(result.body?.code || 0) || 0;
    throw error;
  }

  return {
    ok: true,
    provider: 'twilio_verify',
    phoneE164,
    maskedPhone: maskPhone(phoneE164),
    status: cleanText(result.body?.status || 'pending') || 'pending',
    sid: cleanText(result.body?.sid || ''),
    valid: cleanText(result.body?.valid || ''),
    raw: result.body
  };
}

async function checkVerification({ phoneE164 = '', code = '' } = {}) {
  const cfg = getTwilioVerifyConfig();
  if (!isConfigured(cfg)) {
    const error = new Error('Twilio Verify is not configured.');
    error.code = 'TWILIO_VERIFY_NOT_CONFIGURED';
    throw error;
  }

  const result = await postTwilioVerify({
    path: `/Services/${encodeURIComponent(cfg.serviceSid)}/VerificationCheck`,
    params: {
      To: phoneE164,
      Code: cleanText(code)
    },
    config: cfg
  });

  if (!result.ok) {
    const reason = classifyTwilioVerifyError({
      statusCode: result.statusCode,
      message: result.body?.message || '',
      code: result.body?.code || 0
    });
    if (reason === 'invalid' || reason === 'expired' || reason === 'rate_limited') {
      return {
        ok: false,
        provider: 'twilio_verify',
        reason,
        status: cleanText(result.body?.status || ''),
        statusCode: result.statusCode,
        providerCode: Number(result.body?.code || 0) || 0,
        message: cleanText(result.body?.message || '')
      };
    }
    const error = new Error(cleanText(result.body?.message || '') || 'Twilio Verify check failed.');
    error.code = 'TWILIO_VERIFY_CHECK_FAILED';
    error.statusCode = result.statusCode;
    error.providerCode = Number(result.body?.code || 0) || 0;
    throw error;
  }

  const status = cleanText(result.body?.status || '').toLowerCase();
  const approved = status === 'approved' || result.body?.valid === true;
  return {
    ok: approved,
    provider: 'twilio_verify',
    reason: approved ? 'approved' : 'invalid',
    status,
    statusCode: result.statusCode,
    sid: cleanText(result.body?.sid || ''),
    to: cleanText(result.body?.to || ''),
    raw: result.body
  };
}

module.exports = {
  getConfig: getTwilioVerifyConfig,
  isConfigured,
  startVerification,
  checkVerification
};
