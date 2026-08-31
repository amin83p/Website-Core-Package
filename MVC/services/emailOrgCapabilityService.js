const emailManagementService = require('./emailManagementService');
const emailProviderProfileService = require('./emailProviderProfileService');
const { toPublicId } = require('../utils/idAdapter');

const RESET_EVENT_KEY = 'AUTH_PASSWORD_RESET_CODE';

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function resolveSenderAddress(renderedFrom = '', credentials = {}) {
  return cleanString(renderedFrom, { max: 320, allowEmpty: true })
    || cleanString(credentials?.fromEmail, { max: 320, allowEmpty: true })
    || '';
}

function buildSampleContextForEvent(eventKey = '') {
  const token = cleanString(eventKey, { max: 120, allowEmpty: true }).toUpperCase();
  if (token === RESET_EVENT_KEY) {
    return {
      userEmail: 'capability-check@example.com',
      email: 'capability-check@example.com',
      resetCode: '000000',
      resetTtlMinutes: 15,
      appName: 'Application',
      orgName: 'Organization'
    };
  }
  if (token === 'NEWSLETTER_WELCOME') {
    return {
      subscriberEmail: 'capability-check@example.com',
      unsubscribeUrl: 'https://example.com/unsubscribe'
    };
  }
  if (token === 'CONTACT_NOTIFICATION') {
    return {
      contactRefId: 'CAP_CHECK',
      contactName: 'Capability Check',
      contactEmail: 'capability-check@example.com',
      contactType: 'General',
      contactTimeline: 'N/A',
      contactSubject: 'Capability Check',
      contactMessage: 'Capability check message.'
    };
  }
  return {};
}

function buildSampleInjectedValuesForEvent(eventKey = '') {
  const token = cleanString(eventKey, { max: 120, allowEmpty: true }).toUpperCase();
  if (token === 'SCHOOL_UNCOMPLETED_SESSION_EMAIL') {
    return {
      BODY_CONTENT: '<p>Sample notification body for capability check.</p>',
      TEACHER_NAME: 'Sample Teacher',
      TEACHER_EMAIL: 'capability-check@example.com',
      USER_EMAIL: 'capability-check@example.com',
      ORG_NAME: 'Sample Organization',
      SESSION_COUNT: '1',
      SESSION_LIST: '- Sample Class — Sample Session',
      CLASS_NAME: 'Sample Class',
      CLASS_ID: 'CLS_SAMPLE',
      SESSION_NAME: 'Sample Session',
      SESSION_ID: 'SES_SAMPLE',
      SESSION_DATE: '2026-01-01',
      SESSION_TIME: '09:00 - 10:00',
      SESSION_MANAGER_URL: '/school/classes/CLS_SAMPLE/sessions/SES_SAMPLE'
    };
  }
  return {};
}

const emailOrgCapabilityService = {
  async resolveOrgProviderCredentialsOrThrow(orgId = '', profileId = '', options = {}) {
    return emailProviderProfileService.resolveProviderCredentials(orgId, profileId, options);
  },

  async assertOrgEmailCapability(orgId = '', options = {}) {
    const activeOrgId = toPublicId(orgId) || '';
    if (!activeOrgId) {
      throw new Error('Organization id is required for email delivery.');
    }

    const eventKey = cleanString(options?.eventKey, { max: 120, allowEmpty: true }).toUpperCase();
    const providerProfileId = cleanString(options?.providerProfileId, { max: 120, allowEmpty: true });
    const sampleTo = cleanString(options?.sampleTo, { max: 320, allowEmpty: true }) || 'capability-check@example.com';

    const credentials = await emailProviderProfileService.resolveProviderCredentials(
      activeOrgId,
      providerProfileId
    );

    if (!eventKey) {
      if (!credentials?.apiKey) {
        throw new Error('No default email provider profile configured for this organization.');
      }
      return { orgId: activeOrgId, credentials };
    }

    const rendered = await emailManagementService.resolveTemplateForEvent({
      orgId: activeOrgId,
      eventKey,
      to: sampleTo,
      context: buildSampleContextForEvent(eventKey),
      injectedValues: {
        ...buildSampleInjectedValuesForEvent(eventKey),
        ...(options?.injectedValues || {})
      },
      templateId: cleanString(options?.templateId, { max: 120, allowEmpty: true }) || ''
    });

    const resolvedProfileId = providerProfileId
      || cleanString(rendered?.providerProfileId, { max: 120, allowEmpty: true })
      || '';
    const resolvedCredentials = resolvedProfileId && resolvedProfileId !== credentials.providerProfileId
      ? await emailProviderProfileService.resolveProviderCredentials(activeOrgId, resolvedProfileId)
      : credentials;

    const sender = resolveSenderAddress(rendered?.from, resolvedCredentials);
    if (!sender) {
      throw new Error('Sender address is missing. Configure a template sender or provider default from email.');
    }

    emailProviderProfileService.validateSenderDomain(sender, resolvedCredentials.verifiedDomains);

    return {
      orgId: activeOrgId,
      eventKey,
      credentials: resolvedCredentials,
      sender,
      templateId: cleanString(rendered?.templateId, { max: 120, allowEmpty: true }) || ''
    };
  },

  async canOrgSendEmail(orgId = '', options = {}) {
    try {
      await this.assertOrgEmailCapability(orgId, options);
      return true;
    } catch (_) {
      return false;
    }
  }
};

module.exports = emailOrgCapabilityService;
