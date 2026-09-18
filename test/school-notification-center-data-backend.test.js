const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('Notification centre task sync lists orgs via repository backend selector', () => {
  const taskSync = readText('packages/school/MVC/services/school/notificationCenterTaskSyncService.js');
  assert.match(taskSync, /schoolRepositories\.notificationRules\.list/);
  assert.match(taskSync, /canViewAll: true/);
  assert.doesNotMatch(taskSync, /getAllNotificationRules/);
});

test('Notification centre repositories expose mongo id generators for rules and runs', () => {
  const repo = readText('packages/school/MVC/repositories/school/index.js');
  assert.match(repo, /generateMongoCreateId:[\s\S]*notificationRuleModel\.generateRuleId/);
  assert.match(repo, /generateMongoCreateId:[\s\S]*notificationRunModel\.generateRunId/);
});
