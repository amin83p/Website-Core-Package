const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const studentModel = require('../MVC/models/school/studentModel');

const ROOT = path.resolve(__dirname, '..', '..', '..');
function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('student model sanitizes referralLinks with required fields', () => {
  const cleaned = studentModel.cleanReferralLinks([
    {
      id: 'reflink_1',
      referralId: 'REF-100',
      organizationId: 'WORK_SAFE_BC',
      linkDate: '2026-01-15',
      programId: 'PROG-1',
      comment: 'Initial referral'
    },
    {
      referralId: 'REF-200',
      organizationId: 'CBI',
      linkDate: '2026-02-01',
      programId: 'PROG-2'
    }
  ]);
  assert.equal(cleaned.length, 2);
  const byRef = new Map(cleaned.map((row) => [row.referralId, row]));
  assert.equal(byRef.get('REF-100').linkDate, '2026-01-15');
  assert.equal(byRef.get('REF-100').comment, 'Initial referral');
  assert.equal(byRef.get('REF-200').programId, 'PROG-2');
  assert.ok(byRef.get('REF-200').id);
});

test('student model rejects referralLinks without program', () => {
  assert.throws(
    () => studentModel.cleanReferralLinks([{ referralId: 'REF-1', linkDate: '2026-01-01', programId: '' }]),
    /program/i
  );
});

test('student routes expose referral-links API endpoints', () => {
  const routes = read('packages/school/MVC/routes/studentRoutes.js');
  assert.match(routes, /router\.get\('\/api\/referral-link-options'/);
  assert.match(routes, /router\.get\('\/api\/:id\/referral-links'/);
  assert.match(routes, /ctrl\.getStudentReferralLinksApi/);
  assert.match(routes, /router\.put\('\/api\/:id\/referral-links'/);
  assert.match(routes, /ctrl\.putStudentReferralLinksApi/);
});

test('student controller exposes referral link handlers and save parsing', () => {
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(controller, /exports\.getStudentReferralLinkOptionsApi/);
  assert.match(controller, /exports\.getStudentReferralLinksApi/);
  assert.match(controller, /exports\.putStudentReferralLinksApi/);
  assert.match(controller, /parsedReferralLinks/);
  assert.match(controller, /referralLinksForView/);
});

test('student form and management views include referral links UI', () => {
  const studentForm = read('packages/school/MVC/views/school/student/studentForm.ejs');
  const managementModals = read('packages/school/MVC/views/school/partials/studentManagementModals.ejs');
  const manager = read('public/scripts/studentReferralLinksManager.js');
  assert.match(studentForm, /studentReferralLinksModal/);
  assert.match(studentForm, /studentReferralLinksManager\.js/);
  assert.match(studentForm, /btnManageStudentReferralLinks/);
  assert.match(studentForm, /hid_referralLinks/);
  assert.match(managementModals, /studentReferralLinksModal/);
  assert.match(manager, /StudentReferralLinksManager/);
  assert.match(manager, /referral-link-options/);
  assert.match(manager, /btn_rollingRefLinkPickReferral/);
  assert.match(manager, /GenericPickerPresets\.referral/);
  assert.match(manager, /renderProgramSelect/);
  const referralModal = read('packages/school/MVC/views/school/partials/studentReferralLinksModal.ejs');
  assert.match(referralModal, /rollingRefLink_programId.*form-select/);
  assert.doesNotMatch(referralModal, /btn_rollingRefLinkPickProgram/);
  assert.match(manager, /SchoolReferralQuickCreate/);
  const quickModal = read('packages/school/MVC/views/school/partials/referralQuickCreateModal.ejs');
  assert.match(quickModal, /quickReferral_middleName/);
  assert.match(quickModal, /quickReferral_gender/);
  assert.match(quickModal, /quickReferral_dob/);
  assert.match(quickModal, /quickReferral_phone/);
  assert.match(quickModal, /quickReferral_addrLine1/);
  assert.doesNotMatch(quickModal, /quickReferralToggleExisting/);
  assert.match(read('public/scripts/schoolModalStack.js'), /raiseAboveOpenModals/);
  const referralRoutes = read('packages/school/MVC/routes/referralRoutes.js');
  assert.match(referralRoutes, /router\.post\('\/api\/quick-create'/);
  assert.match(read('public/scripts/schoolReferralQuickCreate.js'), /\/school\/referrals\/api\/quick-create/);
});

test('generic picker exposes referral preset', () => {
  const presets = read('public/scripts/genericPickerPresets.js');
  const profiles = read('public/scripts/genericPickerSchoolProfiles.js');
  assert.match(presets, /referral:\s*\{/);
  assert.match(presets, /\/school\/referrals/);
  assert.match(profiles, /registerProfile\(\['referral'/);
});