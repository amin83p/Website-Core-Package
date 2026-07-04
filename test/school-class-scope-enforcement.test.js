const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const controllerPath = 'packages/school/MVC/controllers/school/classController.js';
const source = fs.readFileSync(controllerPath, 'utf8');

test('manageSession applies route access context and session scope assert', () => {
  assert.match(source, /async function manageSession\(req, res\)/);
  assert.match(
    source,
    /manageSession[\s\S]*getClassByIdWithOrgCheck\(classId, req\.user, buildRouteAccessContext\(req\)\)/
  );
  assert.match(
    source,
    /manageSession[\s\S]*assertSessionScopeForRequest\(req, classData, session\)/
  );
});

test('session mutations assert manageSession scope before writes', () => {
  assert.match(
    source,
    /async function saveSession\(req, res\)[\s\S]*assertSessionScopeForRequest\(req, classData, sessions\[sessionIndex\]\)/
  );
  assert.match(
    source,
    /async function saveSessionGradebooks\(req, res\)[\s\S]*assertSessionScopeForRequest\(req, classData, sessions\[sessionIndex\]\)/
  );
  assert.match(
    source,
    /async function assertSessionInstructionalActiveForRequest[\s\S]*assertSessionScopeForRequest\(req, classData, session, 'manageSession'\)/
  );
});

test('makeup session creation uses scoped session assert', () => {
  assert.match(
    source,
    /async function assertCanCreateMakeupSession[\s\S]*assertSessionScopeForRequest\(req, classData, originalSession, 'manageSession'\)/
  );
});

test('class list uses route access context', () => {
  assert.match(
    source,
    /schoolDataService\.fetchData\('classes', query, req\.user, buildRouteAccessContext\(req\)\)/
  );
});
