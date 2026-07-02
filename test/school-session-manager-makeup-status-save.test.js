const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('session manager keeps save button available for non-readonly sessions', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /<% if \(!isReadOnly\) { %>\s*<button type="button" class="btn btn-primary btn-md btn-filled btn-save-session shadow-md" id="btnSaveSession">/);
  assert.doesNotMatch(source, /!isReadOnly && !isMakeupRequiredInactive/);
});

test('session manager sends status-only payload when current or selected status requires make-up', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /function isSessionStatusMakeupRequired\(statusCode\)/);
  assert.match(source, /const selectedStatusRequiresMakeup = isSessionStatusMakeupRequired\(status\);/);
  assert.match(source, /const shouldSendInstructionalPayload = !sessionInstructionalInactive && !selectedStatusRequiresMakeup;/);
  assert.match(source, /if \(shouldSendInstructionalPayload\) {\s*payload\.roster = JSON\.stringify\(roster\);[\s\S]*payload\.contentItems = JSON\.stringify\(/);
});

test('saveSession controller skips instructional payload updates for make-up-required sessions', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /const shouldSkipInstructionalPayload = currentMakeupInactive \|\| nextMakeupInactive;/);
  assert.match(source, /if \(!shouldSkipInstructionalPayload && contentItems !== undefined\)/);
  assert.match(source, /if \(!shouldSkipInstructionalPayload && contentOrder !== undefined\)/);
  assert.match(source, /if \(!shouldSkipInstructionalPayload && roster !== undefined\)/);
  assert.doesNotMatch(source, /Change the status from Master Hub first, or create\/open the make-up session\./);
});

test('saveSession controller warns when removing make-up requirement with linked make-up sessions', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /const forceRemoveMakeups = parseBoolean\(req\.body\?\.forceRemoveMakeups,\s*false\);/);
  assert.match(source, /const removingMakeupRequirement = currentMakeupInactive && !nextMakeupInactive;/);
  assert.match(source, /row\?\.makeup\?\.isMakeup === true/);
  assert.match(source, /idsEqual\(row\?\.makeup\?\.originalClassId,\s*classId\)/);
  assert.match(source, /idsEqual\(row\?\.makeup\?\.originalSessionId,\s*sessionId\)/);
  assert.match(source, /code:\s*'MAKEUP_SESSIONS_EXIST'/);
  assert.match(source, /makeupSessions:\s*linkedMakeupRows/);
});

test('saveSession controller removes all linked make-up sessions when forced', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /if \(linkedMakeupRows\.length && forceRemoveMakeups\)/);
  assert.match(source, /sessions\.splice\(idx,\s*1\);/);
  assert.match(source, /removedMakeupCount \+= 1;/);
  assert.match(source, /originalSession\.makeupHistory = originalSession\.makeupHistory\.filter/);
  assert.match(source, /Removed \$\{removedMakeupCount\} linked make-up session\(s\) and saved session data successfully\./);
});

test('session manager handles make-up warning with confirmation and force resubmit', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /result\.status === 'warning' && result\.code === 'MAKEUP_SESSIONS_EXIST'/);
  assert.match(source, /Linked make-up sessions:/);
  assert.match(source, /Remove Make-up Sessions and Continue/);
  assert.match(source, /selected !== 'Remove Make-up Sessions and Continue'/);
  assert.match(source, /submitSessionSave\(\{ \.\.\.payload,\s*forceRemoveMakeups:\s*true \}\)/);
});
