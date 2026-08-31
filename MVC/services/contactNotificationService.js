const settingService = require('./settingService');

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function parseAddressList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(/[;,]+/g)
    .map((item) => cleanString(item, { max: 320, allowEmpty: true }))
    .filter(Boolean);
}

function getContactNotifyRecipients() {
  const fromSettings = parseAddressList(settingService.getValue('contact', 'notifyRecipients'));
  if (fromSettings.length) return fromSettings;

  const legacyEnv = parseAddressList(
    process.env.RESEND_CONTACT_TO
    || process.env.CONTACT_NOTIFY_TO
    || process.env.ADMIN_NOTIFY_EMAILS
  );
  return legacyEnv;
}

const contactNotificationService = {
  getContactNotifyRecipients,
  parseAddressList
};

module.exports = contactNotificationService;
