const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

test('School manifest preserves attachment operations for Staff, Students, and Teachers', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(ROOT_DIR, 'packages/school/package.manifest.json'),
    'utf8'
  ));

  for (const sectionName of ['SCHOOL_STAFF', 'SCHOOL_STUDENTS', 'SCHOOL_TEACHERS']) {
    const section = manifest.sections.find((candidate) => candidate.name === sectionName);
    const operationIds = new Set(
      (section?.operations || []).map((operation) => String(operation.id || ''))
    );

    assert.ok(section, `${sectionName} manifest declaration was not found.`);
    assert.ok(operationIds.has('OP1023'), `DOWNLOAD_FILE must remain enabled for ${sectionName}.`);
    assert.ok(operationIds.has('355444'), `DELETE_FILE must remain enabled for ${sectionName}.`);
  }
});

test('student attachment deletion exchanges the edit-form token for DELETE_FILE state', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'packages/school/MVC/routes/studentRoutes.js'),
    'utf8'
  );
  const route = source.match(
    /router\.delete\('\/:id\/attachments\/:attId',[\s\S]*?ctrl\.deleteAttachment\);/
  )?.[0] || '';

  assert.ok(route, 'Student attachment delete route was not found.');
  assert.match(
    route,
    /requireAccess\(SECTIONS\.SCHOOL_STUDENTS,\s*OPERATIONS\.DELETE_FILE\)/
  );
  assert.match(
    route,
    /trackActionState\(SECTIONS\.SCHOOL_STUDENTS,\s*OPERATIONS\.DELETE_FILE,\s*\{[\s\S]*requireToken:\s*true[\s\S]*allowOperationTokenFallback:\s*true[\s\S]*\}\)/
  );
  assert.doesNotMatch(route, /allowSectionTokenFallback:\s*true/);
  assert.doesNotMatch(route, /allowInactiveTokenFallback:\s*true/);
});
