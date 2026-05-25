const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const routeFile = (relative) => path.join(ROOT_DIR, 'packages/pte/MVC/routes', relative);

function countMatches(source, regex) {
  return (source.match(regex) || []).length;
}

test('Question bank upload middleware usage should be registered as bare context middleware', () => {
  const source = fs.readFileSync(routeFile('questionBankRoutes.js'), 'utf8');

  assert.equal(
    countMatches(source, /pteUploadContext\.setQuestionBankContext,/g),
    3,
    'questionBankRoutes should pass setQuestionBankContext as middleware exactly three times.'
  );
  assert.equal(
    countMatches(source, /pteUploadContext\.setQuestionBankContext\(\)/g),
    0,
    'questionBankRoutes should not invoke setQuestionBankContext directly; it is a middleware function reference.'
  );
});

test('Student upload routes should resolve student upload context with publicApplicant=false', () => {
  const source = fs.readFileSync(routeFile('studentRoutes.js'), 'utf8');

  assert.equal(
    countMatches(source, /setStudentContext\(\{\s*publicApplicant:\s*false\s*\}\)/g),
    3,
    'studentRoutes should set student upload context for private students in each upload path.'
  );
});

test('Public applicant upload routes should resolve student upload context with publicApplicant=true', () => {
  const source = fs.readFileSync(routeFile('publicApplicantRoutes.js'), 'utf8');

  assert.equal(
    countMatches(source, /setStudentContext\(\{\s*publicApplicant:\s*true\s*\}\)/g),
    2,
    'publicApplicantRoutes should mark public applicant upload context where uploads occur.'
  );
});

test('Practice runtime upload routes should set runtime context by mode', () => {
  const source = fs.readFileSync(routeFile('practiceRoutes.js'), 'utf8');

  assert.equal(
    countMatches(source, /setRuntimeAttemptContext\('smart'\)/g),
    1,
    'practiceRoutes should set smart runtime upload context for smart exam uploads.'
  );
  assert.equal(
    countMatches(source, /setRuntimeAttemptContext\('mock'\)/g),
    1,
    'practiceRoutes should set mock runtime upload context for mock exam uploads.'
  );
  assert.equal(
    countMatches(source, /setRuntimeAttemptContext\('skills'\)/g),
    1,
    'practiceRoutes should set skills runtime upload context for skills-mode uploads.'
  );
});
