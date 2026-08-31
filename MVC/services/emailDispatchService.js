const emailManagementService = require('./emailManagementService');
const emailProviderProfileService = require('./emailProviderProfileService');
const resendEmailService = require('./resendEmailService');
const { getEmailEventByKey } = require('../../config/emailEventCatalog');
const startupLogger = require('../utils/startupLogger');
const { toPublicId } = require('../utils/idAdapter');

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

function resolveSenderAddress(renderedFrom = '', credentials = {}) {
  return cleanString(renderedFrom, { max: 320, allowEmpty: true })
    || cleanString(credentials.fromEmail, { max: 320, allowEmpty: true })
    || '';
}

const emailDispatchService = {
  async sendByEvent({
    orgId = '',
    eventKey = '',
    to = '',
    context = {},
    injectedValues = {},
    actor = {},
    replyTo = '',
    providerProfileId = '',
    templateId = '',
    meta = {}
  } = {}) {
    const activeOrgId = toPublicId(orgId) || 'SYSTEM';
    const token = cleanString(eventKey, { max: 120, allowEmpty: true }).toUpperCase();
    if (!token) throw new Error('Event key is required.');

    const event = getEmailEventByKey(token, { includeInactive: false });
    if (!event) throw new Error('Selected email event is not supported by backend.');

    const rendered = await emailManagementService.resolveTemplateForEvent({
      orgId: activeOrgId,
      eventKey: token,
      to,
      context,
      injectedValues,
      templateId
    });

    const profileId = cleanString(providerProfileId, { max: 120, allowEmpty: true })
      || cleanString(rendered.providerProfileId, { max: 120, allowEmpty: true })
      || '';
    const credentials = await emailProviderProfileService.resolveProviderCredentials(activeOrgId, profileId);

    const sender = resolveSenderAddress(rendered.from, credentials);
    if (!sender) {
      throw new Error('Sender address is missing. Configure a provider profile default from email or template sender.');
    }

    emailProviderProfileService.validateSenderDomain(sender, credentials.verifiedDomains);

    const recipients = parseAddressList(to).length
      ? parseAddressList(to)
      : (Array.isArray(rendered.to) ? rendered.to : [rendered.to]).filter(Boolean);
    if (!recipients.length) {
      throw new Error('Resolved recipient list is empty.');
    }

    startupLogger.info('EMAIL_DISPATCH', 'SEND_BY_EVENT', 'Dispatching email by event key.', {
      orgId: activeOrgId,
      eventKey: token,
      providerProfileId: credentials.providerProfileId || '',
      credentialSource: credentials.source || '',
      recipientCount: recipients.length,
      templateId: cleanString(rendered.templateId, { max: 120, allowEmpty: true }) || ''
    });

    const sendMeta = {
      ...(meta && typeof meta === 'object' ? meta : {}),
      orgId: activeOrgId,
      eventKey: token,
      sectionId: cleanString(event.sectionId, { max: 120, allowEmpty: true }) || cleanString(rendered.sectionId, { max: 120, allowEmpty: true }) || '',
      operationId: cleanString(event.operationId, { max: 120, allowEmpty: true }) || cleanString(rendered.operationId, { max: 120, allowEmpty: true }) || '',
      templateId: cleanString(rendered.templateId, { max: 120, allowEmpty: true }) || '',
      providerProfileId: credentials.providerProfileId || '',
      usedFallbackTemplate: Boolean(rendered.usedFallback),
      actor: actor && typeof actor === 'object' ? actor : {}
    };

    return resendEmailService.sendEmail({
      from: sender,
      to: recipients,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      replyTo: cleanString(replyTo, { max: 320, allowEmpty: true }) || undefined,
      credentials: {
        apiKey: credentials.apiKey,
        from: credentials.fromEmail || sender
      },
      meta: sendMeta
    });
  }
};

module.exports = emailDispatchService;
