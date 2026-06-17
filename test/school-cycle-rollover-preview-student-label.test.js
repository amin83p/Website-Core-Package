const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('cycle rollover preview enriches and displays carry-forward student labels', () => {
  const controller = read('packages/school/MVC/controllers/school/classController.js');
  const view = read('packages/school/MVC/views/school/class/cycleRolloverWizard.ejs');

  assert.match(controller, /async function enrichCycleRolloverPreviewStudentLabels/);
  assert.match(controller, /studentLabel:\s*studentLabelMap\.get\(studentId\)\s*\|\|\s*studentId/);
  assert.match(controller, /const enrichedPreview = await enrichCycleRolloverPreviewStudentLabels\(preview, req\.user\)/);
  assert.match(controller, /data:\s*enrichedPreview/);

  assert.match(view, /row\.studentLabel\s*\|\|\s*row\.studentName\s*\|\|\s*row\.studentId/);
  assert.match(view, /x-small text-muted font-monospace/);
});
