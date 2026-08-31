'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const SCHOOL_SETTINGS_VIEW_ROOTS = [
  path.join(ROOT_DIR, 'MVC/views'),
  path.join(ROOT_DIR, 'packages/school/MVC/views')
];

function renderSchoolSettingsView(locals = {}) {
  const templatePath = path.join(
    ROOT_DIR,
    'packages/school/MVC/views/school/settings/index.ejs'
  );
  return ejs.renderFile(templatePath, locals, {
    views: SCHOOL_SETTINGS_VIEW_ROOTS,
    filename: templatePath
  });
}

test('School Settings section and symbol are registered without automatic role grants', () => {
  const sections = readJson('data/sections.json');
  const symbols = readJson('data/symbols.json');
  const manifest = readJson('packages/school/package.manifest.json');

  const section = sections.find((row) => row.id === '446106');
  assert.equal(section?.name, 'SCHOOL_SETTINGS');
  assert.equal(section?.homeURL, '/school/settings');
  assert.equal(section?.trackState, true);
  assert.deepEqual(section?.operations.map((row) => row.id), ['OP1003', 'OP1005']);
  assert.ok(
    sections.find((row) => row.id === '122740')?.subsections.some((row) => row.id === '446106'),
    'SCHOOL_SETTINGS must be a direct child of SCHOOL'
  );

  const symbol = symbols.find((row) => row.id === 'SYM_SYSTEM_131');
  assert.equal(symbol?.name, 'SCHOOL_SETTINGS');
  assert.equal(symbol?.value, 'bi bi-gear-wide-connected');
  assert.deepEqual(symbol?.tags, ['SCHOOL_SETTINGS', '446106']);

  const manifestSection = manifest.sections.find((row) => row.id === '446106');
  assert.equal(manifestSection?.name, 'SCHOOL_SETTINGS');
  assert.deepEqual(manifestSection?.operations.map((row) => row.id), ['OP1003', 'OP1005']);
  assert.ok(
    manifest.sections.find((row) => row.id === '122740')?.subsections.some((row) => row.id === '446106')
  );
  assert.equal(manifest.symbols.find((row) => row.id === 'SYM_SYSTEM_131')?.value, 'bi bi-gear-wide-connected');
  const grantedSettingsSections = manifest.accesses.flatMap((access) => (
    Array.isArray(access?.sections) ? access.sections : []
  )).filter((row) => row.sectionId === '446106');
  assert.deepEqual(grantedSettingsSections, []);
});

test('School Settings routes use standard access and action-state protection', () => {
  const routes = read('packages/school/MVC/routes/schoolSettingsRoutes.js');
  const mainRoute = read('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(mainRoute, /router\.use\('\/settings',\s*require\('\.\/schoolSettingsRoutes'\)\)/);
  assert.match(
    routes,
    /router\.get\('\/'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.READ_ALL\)/
  );
  assert.match(
    routes,
    /router\.post\('\/conduct-rating-scale'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE\)[\s\S]*?trackActionState\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE/
  );
  assert.match(
    routes,
    /router\.post\('\/attendance-matrix'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE\)[\s\S]*?trackActionState\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE/
  );
  assert.match(
    routes,
    /router\.post\('\/autosave'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE\)[\s\S]*?trackActionState\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE/
  );
  assert.match(
    routes,
    /router\.post\('\/session-access'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE\)[\s\S]*?trackActionState\(SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.UPDATE/
  );
  assert.match(
    routes,
    /router\.get\('\/session-access\/email-template-check'[\s\S]*?checkSessionNotificationEmailTemplate/
  );
  assert.doesNotMatch(routes, /AdminMiddleware|adminAuthority|schoolAdminAccessService/);
});

test('School dashboard registers and infers the settings card with READ_ALL visibility', () => {
  const dashboard = read('packages/school/MVC/controllers/school/schoolDashboardController.js');
  assert.match(dashboard, /\/\^\\\/school\\\/settings/);
  assert.match(dashboard, /sectionId:\s*SECTIONS\.SCHOOL_SETTINGS/);
  assert.match(dashboard, /title:\s*'School Settings'/);
  assert.match(dashboard, /href:\s*'\/school\/settings'/);
  assert.match(
    dashboard,
    /sectionId === SECTIONS\.SCHOOL_SETTINGS[\s\S]*?\[OPERATIONS\.READ_ALL\]/
  );
});

test('legacy settings routes redirect or save through the centralized controller', () => {
  const classRoutes = read('packages/school/MVC/routes/classRoutes.js');
  const attendanceRoutes = read('packages/school/MVC/routes/attendanceRoutes.js');
  const controller = read('packages/school/MVC/controllers/school/schoolSettingsController.js');

  assert.match(classRoutes, /\/conduct-rating-scale\/settings'[\s\S]*?SECTIONS\.SCHOOL_SETTINGS/);
  assert.match(classRoutes, /settingsCtrl\.redirectLegacyConductSettings/);
  assert.match(classRoutes, /settingsCtrl\.saveConductRatingScale/);
  assert.match(attendanceRoutes, /\/settings'[\s\S]*?SECTIONS\.SCHOOL_SETTINGS/);
  assert.match(attendanceRoutes, /settingsCtrl\.redirectLegacyAttendanceSettings/);
  assert.match(attendanceRoutes, /settingsCtrl\.saveAttendanceMatrix/);
  assert.match(controller, /res\.redirect\('\/school\/settings#conduct-rating-scale'\)/);
  assert.match(controller, /res\.redirect\('\/school\/settings#attendance-matrix'\)/);
  assert.match(controller, /res\.redirect\('\/school\/settings#attendance-rollup'\)/);
});

test('settings page supports read-only rendering, independent AJAX saves, and modal-first feedback', () => {
  const view = read('packages/school/MVC/views/school/settings/index.ejs');
  const catalog = require('../packages/school/MVC/config/schoolSettingsCatalog');
  assert.deepEqual(
    catalog.listSchoolSettingsGroups().map((row) => row.key),
    ['conduct-rating-scale', 'attendance-matrix', 'attendance-marks', 'attendance-rollup', 'autosave', 'session-access', 'student-attendance-report']
  );
  const rollupGroup = catalog.listSchoolSettingsGroups().find((row) => row.key === 'attendance-rollup');
  assert.equal(rollupGroup?.href, undefined);
  assert.match(view, /activeOrgName/);
  assert.match(view, /read-only access/);
  assert.match(view, /canUpdateFlag/);
  assert.match(view, /id="conduct-rating-scale"/);
  assert.match(view, /id="attendance-matrix"/);
  assert.match(view, /id="student-attendance-report"/);
  assert.match(view, /id="sarReportTemplateId"/);
  assert.match(view, /includeGenericPicker/);
  assert.match(view, /modal_GenericPicker/);
  assert.match(view, /\/school\/settings\/student-attendance-report/);
  assert.match(view, /id="attendance-rollup"/);
  assert.match(view, /id="includeUnmarkedSessions"/);
  assert.match(view, /id="attendanceThresholdsEnabled"/);
  assert.match(view, /role="switch"/);
  assert.match(view, /thresholdsEnabled/);
  assert.match(view, /\/school\/settings\/conduct-rating-scale/);
  assert.match(view, /\/school\/settings\/attendance-matrix/);
  assert.match(view, /\/school\/settings\/attendance-rollup/);
  assert.match(view, /#attendance-rollup/);
  assert.doesNotMatch(view, /rollupUnmarkedTreatment/);
  assert.match(view, /id="autosave"/);
  assert.match(view, /\/school\/settings\/autosave/);
  assert.match(view, /id="session-access"/);
  assert.match(view, /\/school\/settings\/session-access/);
  assert.match(view, /sessionNotificationEmailBody/);
  assert.match(view, /sessionNotificationEmailBodyEditBtn/);
  assert.match(view, /templateKind__eq=general/);
  assert.match(view, /sessionNotificationEmailBodyModal/);
  assert.match(view, /sessionNotificationEmailWrapperMappings/);
  assert.match(view, /school\/settings\/partials\/sessionNotificationEmailBodyModal/);
  assert.match(view, /custom wrapper mappings/);
  assert.match(view, /sessionNotificationEmailBodyModal\.js/);
  assert.match(view, /sessionNotificationTestEmailModal/);
  assert.match(view, /school\/settings\/partials\/sessionNotificationTestEmailModal/);
  assert.match(view, /test-notification\/preview/);
  assert.match(view, /confirmSessionNotificationTestEmailSend/);
  assert.match(view, /stored on their device only/);
  assert.match(view, /window\.showMessageModal/);
  assert.match(view, /window\.alert/);
  assert.match(view, /actionStateId/);
});

test('settings page uses a collapsible left sidebar and displays one selected editor', () => {
  const view = read('packages/school/MVC/views/school/settings/index.ejs');
  assert.match(view, /id="schoolSettingsWorkspace"/);
  assert.match(view, /id="schoolSettingsSidebar"/);
  assert.match(view, /id="btnToggleSettingsSidebar"/);
  assert.match(view, /data-settings-target="<%= group\.key %>"/);
  assert.match(view, /class="school-settings-panel active[^"]*" id="conduct-rating-scale"/);
  assert.match(view, /id="attendance-matrix"[^>]*hidden/);
  assert.match(view, /id="attendance-rollup"[^>]*hidden/);
  assert.match(view, /id="student-attendance-report"[^>]*hidden/);
  assert.match(view, /function setActiveSettingsPanel/);
  assert.match(view, /function setSettingsSidebarCollapsed/);
  assert.match(view, /schoolSettingsSidebarCollapsed/);
  assert.match(view, /window\.addEventListener\('hashchange'/);
  assert.match(view, /ArrowDown/);
  assert.doesNotMatch(view, /id="schoolSettingsAccordion"/);
});

test('settings page renders in editable and read-only modes with valid client JavaScript', async () => {
  const baseLocals = {
    activeOrgId: 'ORG-1',
    activeOrgName: 'Example School',
    includeGenericPicker: true,
    user: { id: 'USR-1' },
    groups: require('../packages/school/MVC/config/schoolSettingsCatalog').listSchoolSettingsGroups(),
    conductPolicy: {
      levels: [
        { code: 'S', label: 'Superior', displayCode: 'S', minPercent: 85, maxPercent: 100, defaultPercent: 92.5 },
        { code: 'Sat', label: 'Satisfactory', displayCode: 'Sat', minPercent: 60, maxPercent: 84, defaultPercent: 72 },
        { code: 'NI', label: 'Needs Improvement', displayCode: 'NI', minPercent: 50, maxPercent: 59, defaultPercent: 54.5 },
        { code: 'U', label: 'Unsatisfactory', displayCode: 'U', minPercent: 0, maxPercent: 49, defaultPercent: 24.5 }
      ]
    },
    attendanceItems: [{
      id: 'amp-1',
      scheduledMinutes: 180,
      disqualifyLateMinutes: 30,
      disqualifyEarlyLeaveMinutes: 30,
      disqualifyCombinedMissedMinutes: null,
      isDefault: true
    }],
    attendanceThresholdsEnabled: false,
    attendanceMarkAppearancePolicy: {
      marks: []
    },
    attendanceMarkCuratedIcons: ['bi-check-circle', 'bi-x-circle'],
    rollupFormula: {
      includeUnmarkedSessions: false,
      countUnmarkedAsAbsent: false,
      includeLateGrace: true,
      includeEarlyGrace: true,
      includeLateExcusedRule: true,
      includeEarlyExcusedRule: true,
      lateExcusedTreatment: 'reduce_credit',
      earlyExcusedTreatment: 'reduce_credit'
    },
    studentAttendanceReportPolicy: {
      reportTemplateId: '',
      overallReportTemplateId: ''
    },
    studentAttendanceReportTemplateLabel: '',
    studentAttendanceReportOverallLabel: '',
    autosavePolicy: {
      defaultMinutes: 5,
      sections: {
        'manage-session': { enabledByDefault: true, defaultMinutes: null }
      }
    },
    sessionAccessPolicy: {
      uncompletedSessionNotification: {
        enabled: false,
        sendWhen: 'same_day',
        sendAtTime: '18:00',
        channels: {
          email: { enabled: true, fromEmail: '', subjectTemplate: 'Reminder', bodyTemplate: 'Body' },
          sms: { enabled: false, bodyTemplate: 'SMS' }
        }
      },
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'timesheet_period',
        daysAfterSession: null
      }
    },
    autosaveSections: require('../packages/school/MVC/config/autosaveSectionCatalog').listAutosaveSections(),
    sessionNotificationEmailTokens: require('../packages/school/MVC/services/school/sessionAccessPolicyService').TEMPLATE_TOKENS,
    sessionNotificationEmailWrapperTokens: require('../packages/school/MVC/services/school/sessionNotificationEmailWrapperPlaceholders').WRAPPER_PLACEHOLDER_DEFINITIONS,
    sessionNotificationEmailDefaultBody: require('../packages/school/MVC/services/school/sessionAccessPolicyService').DEFAULT_POLICY
      .uncompletedSessionNotification.channels.email.bodyTemplate,
    actionStateId: 'state-1',
    schoolSectionDashboardHref: '/dashboard/section-nav/SCHOOL'
  };
  const editableHtml = await renderSchoolSettingsView({ ...baseLocals, canUpdate: true });
  assert.match(editableHtml, /Save Conduct Scale/);
  assert.match(editableHtml, /Save Attendance Thresholds/);
  assert.match(editableHtml, /Save Rollup Formula/);
  assert.match(editableHtml, /id="attendance-rollup"[^>]*hidden/);
  assert.match(editableHtml, /id="attendanceThresholdsEnabledLabel">Off/);
  assert.match(editableHtml, /When Off, late and early-leaving students receive full attendance credit/);
  assert.match(editableHtml, /Fixed non-percentage option/);
  assert.match(editableHtml, /id="schoolSettingsSidebar"/);
  assert.match(editableHtml, /data-settings-target="conduct-rating-scale"/);
  assert.match(editableHtml, /id="attendance-matrix"[^>]*hidden/);
  assert.match(editableHtml, /id="sarOverallTemplatesTable"/);
  assert.match(editableHtml, /id="sarOverallTemplateIds"/);
  assert.match(editableHtml, /Add Overall Template/);
  assert.match(editableHtml, /js-sar-overall-up/);
  assert.match(editableHtml, /overallReportTemplateIds/);
  const script = editableHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  assert.doesNotThrow(() => new Function(script));

  const readOnlyHtml = await renderSchoolSettingsView({ ...baseLocals, canUpdate: false });
  assert.match(readOnlyHtml, /read-only access/);
  assert.doesNotMatch(readOnlyHtml, /id="btnSaveConductSettings"/);
  assert.doesNotMatch(readOnlyHtml, /id="btnSaveAttendanceSettings"/);
});

test('operational attendance pages do not embed or link to centralized settings controls', () => {
  const sessionView = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  const attendanceView = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.doesNotMatch(sessionView, /\/school\/settings#/);
  assert.doesNotMatch(sessionView, /id="conductScaleSettingsModal"/);
  assert.doesNotMatch(sessionView, /btnSaveConductScaleSettings/);
  assert.doesNotMatch(sessionView, /attendanceMatrixThresholdHint/);
  assert.match(sessionView, /isAbsentLikeAttendanceStatus/);
  assert.doesNotMatch(attendanceView, /\/school\/settings#/);
  assert.doesNotMatch(attendanceView, /Matrix Thresholds/);
  assert.doesNotMatch(attendanceView, /CAN_VIEW_SCHOOL_SETTINGS/);
});

test('School Settings Mongo seed is idempotent and links the SCHOOL parent', () => {
  const seed = read('scripts/seed-school-settings-section.js');
  const packageJson = readJson('package.json');
  assert.match(seed, /id: '446106'/);
  assert.match(seed, /symbolId: 'SYM_SYSTEM_131'/);
  assert.match(seed, /PARENT = \{ id: '122740', name: 'SCHOOL' \}/);
  assert.match(seed, /updateOne\(\{ _id: existing\._id \}/);
  assert.match(seed, /deleteMany/);
  assert.match(seed, /subsectionIds\.add\(DEFINITION\.id\)/);
  assert.equal(
    packageJson.scripts['school:settings:seed'],
    'node scripts/seed-school-settings-section.js --db app'
  );
});

test('settings policy persistence remains organization-keyed for JSON and Mongo', () => {
  const controller = read('packages/school/MVC/controllers/school/schoolSettingsController.js');
  const conductModel = read('packages/school/MVC/models/school/conductRatingScalePolicyModel.js');
  const attendanceModel = read('packages/school/MVC/models/school/attendanceMatrixPolicyModel.js');
  const studentAttendanceReportModel = read('packages/school/MVC/models/school/studentAttendanceReportPolicyModel.js');
  assert.match(controller, /String\(user\?\.activeOrgId \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(controller, /primaryOrgId/);
  [conductModel, attendanceModel].forEach((source) => {
    assert.match(source, /runByRepositoryBackend/);
    assert.match(source, /byOrgId\[(?:orgKey\(activeOrgId\)|key)\]/);
    assert.match(source, /json:/);
    assert.match(source, /mongo:/);
  });
  assert.match(attendanceModel, /thresholdsEnabled/);
  assert.match(attendanceModel, /getPolicyCatalogForOrg/);
  assert.match(studentAttendanceReportModel, /overallReportTemplateIds/);
});

test('attendance settings reject empty, invalid, and ambiguous default rows', () => {
  const { validateAttendanceItemsInput } = require(
    '../packages/school/MVC/controllers/school/schoolSettingsController'
  );
  assert.throws(() => validateAttendanceItemsInput([]), /at least one/i);
  assert.throws(() => validateAttendanceItemsInput([
    {
      scheduledMinutes: 60,
      disqualifyLateMinutes: 10,
      disqualifyEarlyLeaveMinutes: 10,
      isDefault: false
    }
  ]), /exactly one default/i);
  assert.throws(() => validateAttendanceItemsInput([
    {
      scheduledMinutes: 0,
      disqualifyLateMinutes: 10,
      disqualifyEarlyLeaveMinutes: 10,
      isDefault: true
    }
  ]), /duration/i);
  assert.doesNotThrow(() => validateAttendanceItemsInput([
    {
      scheduledMinutes: 60,
      disqualifyLateMinutes: 10,
      disqualifyEarlyLeaveMinutes: 10,
      disqualifyCombinedMissedMinutes: null,
      isDefault: true
    },
    {
      scheduledMinutes: 120,
      disqualifyLateMinutes: 20,
      disqualifyEarlyLeaveMinutes: 20,
      disqualifyCombinedMissedMinutes: 30,
      isDefault: false
    }
  ]));
});

test('conduct settings preserve the fixed codes and reject forged code sets', () => {
  const { validateConductLevelsInput } = require(
    '../packages/school/MVC/controllers/school/schoolSettingsController'
  );
  const validLevels = [
    { code: 'S' },
    { code: 'Sat' },
    { code: 'NI' },
    { code: 'U' }
  ];
  assert.doesNotThrow(() => validateConductLevelsInput({ levels: JSON.stringify(validLevels) }));
  assert.throws(() => validateConductLevelsInput({ levels: '[]' }), /fixed codes/i);
  assert.throws(() => validateConductLevelsInput({
    levels: JSON.stringify([
      { code: 'S' },
      { code: 'Sat' },
      { code: 'NI' },
      { code: 'CUSTOM' }
    ])
  }), /codes are fixed/i);
});
