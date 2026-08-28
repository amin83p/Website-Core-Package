const test = require('node:test');
const assert = require('node:assert/strict');

const emailManagementTemplateModel = require('../MVC/models/emailManagementTemplateModel');
const emailManagementService = require('../MVC/services/emailManagementService');
const { registerSchoolEmailEvents } = require('../packages/school/MVC/services/school/schoolEmailEventRegistration');

const ORG_ID = 'ORG_EMAIL_RESOLVE_TEST';
const TEMPLATE_ID = 'EMTPL_RESOLVE_BY_ID_TEST';

test('resolveTemplateById renders managed school template with injected runtime placeholders', async () => {
  registerSchoolEmailEvents();

  const existing = await emailManagementTemplateModel.getTemplateById(TEMPLATE_ID);
  if (!existing) {
    await emailManagementTemplateModel.addTemplate({
      id: TEMPLATE_ID,
      orgId: ORG_ID,
      packageName: 'SCHOOL',
      sectionId: 'SCHOOL_SESSION_ACCESS',
      operationId: 'NOTIFY',
      senderTemplate: 'school@example.com',
      recipientTemplate: '{{TEACHER_NAME}} <teacher@example.com>',
      subjectTemplate: 'Reminder: {{SESSION_COUNT}} session(s)',
      bodyTemplate: 'Hi {{TEACHER_NAME}},\n\n{{BODY_CONTENT}}\n\n{{ORG_NAME}}',
      isActive: true
    });
  }

  const rendered = await emailManagementService.resolveTemplateById({
    templateId: TEMPLATE_ID,
    orgId: ORG_ID,
    to: 'teacher@example.com',
    injectedValues: {
      TEACHER_NAME: 'Ada Lovelace',
      ORG_NAME: 'Example School',
      SESSION_COUNT: '2',
      SESSION_LIST: '- Math 101\n- Science 201',
      BODY_CONTENT: '- Math 101\n- Science 201'
    }
  });

  assert.equal(rendered.templateId, TEMPLATE_ID);
  assert.equal(rendered.packageName, 'SCHOOL');
  assert.equal(rendered.eventKey, 'SCHOOL_UNCOMPLETED_SESSION_EMAIL');
  assert.equal(rendered.to[0], 'teacher@example.com');
  assert.match(rendered.subject, /2 session/);
  assert.match(rendered.text, /Ada Lovelace/);
  assert.match(rendered.text, /Math 101/);
  assert.match(rendered.text, /Example School/);
});

test('resolveTemplateById rejects templates outside the requested organization', async () => {
  registerSchoolEmailEvents();
  const existing = await emailManagementTemplateModel.getTemplateById(TEMPLATE_ID);
  assert.ok(existing);

  await assert.rejects(
    () => emailManagementService.resolveTemplateById({
      templateId: TEMPLATE_ID,
      orgId: 'ORG_OTHER',
      to: 'teacher@example.com',
      injectedValues: {
        TEACHER_NAME: 'Ada Lovelace',
        SESSION_COUNT: '1',
        BODY_CONTENT: 'One session'
      }
    }),
    /does not belong to this organization/i
  );
});
