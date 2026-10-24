'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('activities repository uses entry assignee assignment scope', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/repositories/school/index.js'),
    'utf8'
  );
  assert.match(source, /entityName:\s*'activities'[\s\S]*?assignmentScopeKind:\s*'activityEntryAssignees'/);
  assert.match(source, /kind === 'activityEntryAssignees'/);
  assert.match(source, /entries\.assignees\.personId/);
});
