const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('getClassTemplate includes registrationMode and omits instructors from copy payload', () => {
  const controller = read('MVC/controllers/school/classController.js');
  const templateBlock = controller.slice(
    controller.indexOf('async function getClassTemplate'),
    controller.indexOf('async function addClass')
  );
  assert.match(templateBlock, /registrationMode:\s*getClassRegistrationModeKey\(classData\)/);
  assert.doesNotMatch(templateBlock, /instructors:\s*Array\.isArray\(classData\.instructors\)/);
});

test('class form copy apply sets registration mode and refreshes pricing or posting UI', () => {
  const form = read('MVC/views/school/class/classForm.ejs');
  assert.match(form, /function resolveJanFirstOfOrgYear/);
  assert.match(form, /function applyRegistrationModeFromTemplate/);
  assert.match(form, /function clearClassInstructorFields/);
  assert.match(form, /applyRegistrationModeFromTemplate\(source\?\.registrationMode\)/);
  assert.match(form, /clearClassInstructorFields\(\)/);
  assert.doesNotMatch(form, /primaryInstructor/);
  assert.match(form, /renderSubjectWeights\(\)/);
  assert.match(form, /syncPricingHidden\(\)/);
});

test('manual rolling mode selection defaults empty cycle start to Jan 1 of org year', () => {
  const form = read('MVC/views/school/class/classForm.ejs');
  assert.match(form, /rolling && cycleStartDateInput && !String\(cycleStartDateInput\.value/);
  assert.match(form, /cycleStartDateInput\.value = resolveJanFirstOfOrgYear\(\)/);
});
