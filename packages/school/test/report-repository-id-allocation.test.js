const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoIndexSource() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'MVC', 'repositories', 'school', 'index.js'),
    'utf8'
  );
}

test('report repositories use resolveReportCreateId for mongo create ids', () => {
  const source = readRepoIndexSource();
  assert.match(source, /resolveReportCreateId/);
  assert.match(source, /reportInstanceIdService\.allocateUniqueReportInstanceId/);
  assert.match(source, /reportInstanceIdService\.allocateUniqueOverallReportInstanceId/);
  assert.match(source, /reportInstanceIdService\.allocateUniqueOverallReportManagementSessionId/);
  assert.match(
    source,
    /reportInstances:[\s\S]*?generateMongoCreateId:[\s\S]*?resolveReportCreateId/
  );
  assert.match(
    source,
    /overallReportManagementSessions:[\s\S]*?generateMongoCreateId:[\s\S]*?resolveReportCreateId/
  );
});

test('report template mongo create does not fall back to generateUniqueStringId for requested id', () => {
  const source = readRepoIndexSource();
  const reportTemplatesBlock = source.slice(
    source.indexOf('reportTemplates: createSchoolRepository'),
    source.indexOf('reportAssignments: createSchoolRepository')
  );
  assert.doesNotMatch(reportTemplatesBlock, /generateUniqueStringId\(collection, requested\)/);
});
