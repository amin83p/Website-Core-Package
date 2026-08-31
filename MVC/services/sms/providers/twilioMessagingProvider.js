const { maskPhone } = require('../../../utils/phoneUtils');

function cleanText(value) {
  return String(value || '').trim();
}

function getTwilioMessagingConfig() {
  return {
    accountSid: cleanText(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanText(process.env.TWILIO_AUTH_TOKEN),
    fromNumber: cleanText(process.env.TWILIO_MESSAGING_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER),
    baseUrl: 'https://api.twilio.com/2010-04-01'
  };
}

function isConfigured(config = null) {
  const cfg = config || getTwilioMessagingConfig();
  return Boolean(cfg.accountSid && cfg.authToken && cfg.fromNumber);
}

function buildAuthHeader(accountSid = '', authToken = '') {
  const credential = Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64');
  return `Basic ${credential}`;
}

async function sendMessage({ to = '', body = '' } = {}) {
  const cfg = getTwilioMessagingConfig();
  if (!isConfigured(cfg)) {
    const error = new Error('Twilio Messaging is not configured.');
    error.code = 'TWILIO_MESSAGING_NOT_CONFIGURED';
    throw error;
  }

  const params = new URLSearchParams({
    To: cleanText(to),
    From: cfg.fromNumber,
    Body: cleanText(body).slice(0, 320)
  });

  const response = await fetch(
    `${cfg.baseUrl}/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(cfg.accountSid, cfg.authToken),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    }
  );

  let parsed = {};
  try {
    parsed = await response.json();
  } catch (_) {
    parsed = {};
  }

  if (!response.ok) {
    const error = new Error(cleanText(parsed?.message || '') || 'Twilio Messaging request failed.');
    error.code = 'TWILIO_MESSAGING_SEND_FAILED';
    error.statusCode = Number(response.status || 0) || 0;
    error.providerCode = Number(parsed?.code || 0) || 0;
    throw error;
  }

  return {
    ok: true,
    provider: 'twilio_messaging',
    to: cleanText(to),
    maskedPhone: maskPhone(to),
    sid: cleanText(parsed?.sid || ''),
    status: cleanText(parsed?.status || 'queued') || 'queued',
    raw: parsed
  };
}

module.exports = {
  getConfig: getTwilioMessagingConfig,
  isConfigured,
  sendMessage
};
