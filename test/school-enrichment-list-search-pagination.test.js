const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function extractHandlerBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} not found`);
  const nextExport = source.indexOf('\nexports.', start + marker.length);
  const nextAsyncFn = source.indexOf('\nasync function ', start + marker.length);
  const nextFn = source.indexOf('\nfunction ', start + marker.length);
  const candidates = [nextExport, nextAsyncFn, nextFn].filter((idx) => idx > start);
  const end = candidates.length ? Math.min(...candidates) : -1;
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

function assertEnrichmentSearchStripsPagination(source, marker, label = marker) {
  const block = extractHandlerBlock(source, marker);

  assert.match(block, /delete\s+\w+\.q\b/, `${label} must delete q`);
  assert.match(block, /delete\s+\w+\.page\b/, `${label} must delete page`);
  assert.match(block, /delete\s+\w+\.limit\b/, `${label} must delete limit`);

  const pageIdx = block.search(/delete\s+\w+\.page\b/);
  const limitIdx = block.search(/delete\s+\w+\.limit\b/);
  const fetchIdx = block.search(/fetchData\s*\(/);
  assert.ok(fetchIdx > pageIdx && fetchIdx > limitIdx, `${label} must delete page/limit before fetchData`);
}

test('student/teacher/staff enrichment list handlers strip page/limit before fetchData', () => {
  const student = read('packages/school/MVC/controllers/school/studentController.js');
  const teacher = read('packages/school/MVC/controllers/school/teacherController.js');
  const staff = read('packages/school/MVC/controllers/school/staffController.js');

  assertEnrichmentSearchStripsPagination(student, 'exports.listStudents');
  assertEnrichmentSearchStripsPagination(teacher, 'exports.listTeachers');
  assertEnrichmentSearchStripsPagination(teacher, 'exports.listArchivedTeachers');
  assertEnrichmentSearchStripsPagination(staff, 'exports.listStaff');
  assertEnrichmentSearchStripsPagination(staff, 'exports.listArchivedStaff');
});

test('account list and academia hub people panel strip page/limit before fetchData', () => {
  const accounts = read('packages/school/MVC/controllers/school/schoolAccountController.js');
  const hub = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');

  assertEnrichmentSearchStripsPagination(accounts, 'exports.listAccounts');
  assertEnrichmentSearchStripsPagination(hub, 'async function getPeoplePanelRows');
});
