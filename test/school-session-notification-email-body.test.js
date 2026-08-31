const test = require('node:test');
const assert = require('node:assert/strict');

const sessionAccessPolicyService = require('../packages/school/MVC/services/school/sessionAccessPolicyService');
const { mapNotificationContextToEmailPlaceholders } = require('../packages/school/MVC/services/school/sessionNotificationEmailContextAdapter');
const {
  normalizeCustomMappings,
  resolveWrapperPlaceholderValues
} = require('../packages/school/MVC/services/school/sessionNotificationEmailPlaceholderMappingService');

const TEST_EMAIL_TEMPLATE_ID = 'EMTPL_SCHOOL_TEST';

test('mapNotificationContextToEmailPlaceholders renders school bodyTemplate into BODY_CONTENT', () => {
  const context = {
    teacherName: 'Ada Lovelace',
    orgName: 'Example School',
    sessionCount: '2',
    sessionList: '- Math 101\n- Science 201',
    className: 'Math 101'
  };
  const emailChannel = {
    bodyTemplate: '<p>Hi {{teacherName}},</p>{{sessionList}}<p>{{orgName}}</p>'
  };

  const placeholders = mapNotificationContextToEmailPlaceholders(context, { emailChannel });

  assert.equal(placeholders.BODY_CONTENT, '<p>Hi Ada Lovelace,</p>- Math 101\n- Science 201<p>Example School</p>');
  assert.equal(placeholders.SESSION_LIST, '- Math 101\n- Science 201');
  assert.equal(placeholders.TEACHER_NAME, 'Ada Lovelace');
});

test('mapNotificationContextToEmailPlaceholders honors explicit bodyContent override', () => {
  const placeholders = mapNotificationContextToEmailPlaceholders(
    { sessionList: 'ignored', teacherName: 'Ada' },
    { bodyContent: '<p>Custom body</p>' }
  );

  assert.equal(placeholders.BODY_CONTENT, '<p>Custom body</p>');
  assert.equal(placeholders.SESSION_LIST, 'ignored');
});

test('validatePolicyInput validates email bodyTemplate tokens when managed template is used', () => {
  assert.throws(
    () => sessionAccessPolicyService.validatePolicyInput({
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
            bodyTemplate: 'Bad {{unknownToken}}'
          },
          sms: { enabled: false, bodyTemplate: 'SMS ok {{sessionCount}}' }
        }
      },
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'timesheet_period',
        daysAfterSession: null
      }
    }),
    /Unknown template placeholder/
  );
});

test('validatePolicyInput accepts large HTML email bodyTemplate values', () => {
  const htmlBody = `<p>${'x'.repeat(12000)} {{teacherName}} {{sessionList}}</p>`;
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: {
          enabled: true,
          emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
          bodyTemplate: htmlBody
        },
        sms: { enabled: false, bodyTemplate: 'SMS {{sessionCount}}' }
      }
    },
    completedSessionAttendanceEdit: {
      enabled: true,
      windowType: 'timesheet_period',
      daysAfterSession: null
    }
  });

  assert.equal(normalized.uncompletedSessionNotification.channels.email.bodyTemplate, htmlBody);
});

test('default email body template renders structured HTML with session list cards', () => {
  const sessionUncompletedNotificationService = require('../packages/school/MVC/services/school/sessionUncompletedNotificationService');
  const entries = [
    {
      classData: { id: 'CLS-1', title: 'Math 101' },
      session: { sessionId: 'SES-1', date: '2026-01-15', startTime: '09:00', endTime: '10:00' }
    }
  ];
  const context = sessionUncompletedNotificationService.buildDigestContext({
    teacher: { displayName: 'Ada Lovelace' },
    sessions: entries,
    orgName: 'Example School',
    baseUrl: 'https://example.test'
  });
  const rendered = sessionAccessPolicyService.buildSchoolEmailBodyContent(
    sessionAccessPolicyService.DEFAULT_POLICY.uncompletedSessionNotification.channels.email,
    context
  );

  assert.match(rendered, /Hi Ada Lovelace/);
  assert.match(rendered, /<strong>1<\/strong>/);
  assert.match(rendered, /Math 101/);
  assert.match(rendered, /Open session manager/);
  assert.match(rendered, /Thank you,<br>Example School/);
});

test('buildSchoolEmailBodyContent renders school placeholders', () => {
  const rendered = sessionAccessPolicyService.buildSchoolEmailBodyContent(
    { bodyTemplate: 'Hello {{teacherName}}' },
    { teacherName: 'Javad' }
  );
  assert.equal(rendered, 'Hello Javad');
});

test('mapNotificationContextToEmailPlaceholders supplies TEACHER_EMAIL and USER_EMAIL alias', () => {
  const placeholders = mapNotificationContextToEmailPlaceholders({
    teacherName: 'Ada Lovelace',
    teacherEmail: 'ada@example.com',
    orgName: 'Example School'
  }, {
    emailChannel: { bodyTemplate: 'Hi {{teacherName}}' }
  });

  assert.equal(placeholders.TEACHER_EMAIL, 'ada@example.com');
  assert.equal(placeholders.USER_EMAIL, 'ada@example.com');
});

test('resolveWrapperPlaceholderValues applies custom literal and template mappings', () => {
  const customMappings = normalizeCustomMappings([
    {
      token: 'SITE_CONTACT',
      valueKind: 'literal',
      literalValue: 'admin@school.com'
    },
    {
      token: 'SITE_LINE',
      valueKind: 'template',
      templateValue: '{{teacherName}} at {{orgName}}'
    }
  ]);

  const placeholders = resolveWrapperPlaceholderValues({
    context: {
      teacherName: 'Ada',
      orgName: 'Example School',
      sessionList: '- Math'
    },
    emailChannel: { bodyTemplate: 'Body {{sessionList}}' },
    customMappings
  });

  assert.equal(placeholders.SITE_CONTACT, 'admin@school.com');
  assert.equal(placeholders.SITE_LINE, 'Ada at Example School');
  assert.match(placeholders.BODY_CONTENT, /Body - Math/);
});

test('validatePolicyInput normalizes custom wrapper placeholder mappings', () => {
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: {
          enabled: true,
          emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
          bodyTemplate: 'Hello {{teacherName}}',
          wrapperPlaceholderMappings: [
            {
              token: 'site_contact',
              valueKind: 'literal',
              literalValue: 'admin@school.com'
            }
          ]
        },
        sms: { enabled: false, bodyTemplate: 'SMS {{sessionCount}}' }
      }
    },
    completedSessionAttendanceEdit: {
      enabled: true,
      windowType: 'timesheet_period',
      daysAfterSession: null
    }
  });

  assert.deepEqual(normalized.uncompletedSessionNotification.channels.email.wrapperPlaceholderMappings, [
    {
      token: 'SITE_CONTACT',
      label: '',
      valueKind: 'literal',
      sourceKey: '',
      literalValue: 'admin@school.com',
      templateValue: ''
    }
  ]);
});

test('canOrgSendEmail passes sample injected values for school uncompleted session general templates', async () => {
  const emailOrgCapabilityService = require('../MVC/services/emailOrgCapabilityService');
  const emailProviderProfileService = require('../MVC/services/emailProviderProfileService');
  const emailManagementService = require('../MVC/services/emailManagementService');
  const originalResolveCredentials = emailProviderProfileService.resolveProviderCredentials;
  const originalResolveTemplateForEvent = emailManagementService.resolveTemplateForEvent;

  let capturedInjectedValues = null;
  emailProviderProfileService.resolveProviderCredentials = async () => ({
    provider: 'resend',
    providerProfileId: 'EMPP_TEST',
    apiKey: 're_test_key',
    fromEmail: 'noreply@example.com',
    verifiedDomains: ['example.com'],
    source: 'org_profile'
  });
  emailManagementService.resolveTemplateForEvent = async (options = {}) => {
    capturedInjectedValues = options.injectedValues || {};
    return {
      from: 'noreply@example.com',
      to: ['teacher@example.com'],
      subject: 'Reminder',
      text: 'Body',
      html: '<p>Body</p>',
      templateId: 'EMTPL_TEST',
      providerProfileId: 'EMPP_TEST'
    };
  };

  try {
    const canSend = await emailOrgCapabilityService.canOrgSendEmail('ORG_A', {
      eventKey: 'SCHOOL_UNCOMPLETED_SESSION_EMAIL',
      templateId: 'EMTPL_TEST'
    });
    assert.equal(canSend, true);
    assert.equal(capturedInjectedValues.BODY_CONTENT, '<p>Sample notification body for capability check.</p>');
    assert.equal(capturedInjectedValues.USER_EMAIL, 'capability-check@example.com');
  } finally {
    emailProviderProfileService.resolveProviderCredentials = originalResolveCredentials;
    emailManagementService.resolveTemplateForEvent = originalResolveTemplateForEvent;
  }
});

test('previewDigestEmailNotification returns html preview without sending', async () => {
  const sessionNotificationDeliveryService = require('../packages/school/MVC/services/school/sessionNotificationDeliveryService');
  const emailOrgCapabilityService = require('../MVC/services/emailOrgCapabilityService');
  const emailManagementService = require('../MVC/services/emailManagementService');
  const originalCanSend = emailOrgCapabilityService.canOrgSendEmail;
  const originalResolveById = emailManagementService.resolveTemplateById;
  const originalReadEmail = require('../packages/school/MVC/services/school/schoolPersonAccessService').readPersonEmail;

  emailOrgCapabilityService.canOrgSendEmail = async () => true;
  emailManagementService.resolveTemplateById = async () => ({
    to: ['teacher@example.com'],
    subject: 'Uncompleted Sessions',
    text: 'Plain text body',
    html: '<p><strong>HTML body</strong></p>',
    from: 'noreply@example.com'
  });
  require('../packages/school/MVC/services/school/schoolPersonAccessService').readPersonEmail = () => 'teacher@example.com';

  try {
    const outcome = await sessionNotificationDeliveryService.previewDigestEmailNotification({
      policy: {
        uncompletedSessionNotification: {
          channels: {
            email: {
              enabled: true,
              emailTemplateId: 'EMTPL_TEST',
              bodyTemplate: 'ignored'
            }
          }
        }
      },
      teacher: { email: 'teacher@example.com' },
      context: { teacherName: 'Ada', sessionList: '- Math' },
      orgId: 'ORG_TEST',
      subjectPrefix: '[TEST] '
    });
    assert.equal(outcome.status, 'preview');
    assert.equal(outcome.recipient, 'teacher@example.com');
    assert.match(outcome.subject, /\[TEST\]Uncompleted Sessions/);
    assert.equal(outcome.html, '<p><strong>HTML body</strong></p>');
  } finally {
    emailOrgCapabilityService.canOrgSendEmail = originalCanSend;
    emailManagementService.resolveTemplateById = originalResolveById;
    require('../packages/school/MVC/services/school/schoolPersonAccessService').readPersonEmail = originalReadEmail;
  }
});

test('validatePolicyInput rejects reserved custom wrapper tokens', () => {
  assert.throws(
    () => sessionAccessPolicyService.validatePolicyInput({
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            wrapperPlaceholderMappings: [
              { token: 'USER_EMAIL', valueKind: 'literal', literalValue: 'x@y.com' }
            ]
          },
          sms: { enabled: false, bodyTemplate: '' }
        }
      },
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'timesheet_period',
        daysAfterSession: null
      }
    }),
    /reserved/i
  );
});
