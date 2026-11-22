'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../packages/school/MVC/views/school/reportHub.ejs');
let text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);

const keepBeforeCss = lines.slice(0, 262);
const keepAfterCss = lines.slice(956);
let merged = [...keepBeforeCss, ...keepAfterCss];

const jsStart = merged.findIndex((line) => line.trim() === 'const HUB_STUDENTS_MIN_SEARCH = 3;');
const jsEnd = merged.findIndex((line, idx) => idx > jsStart && line.trim() === 'function bindHubAttendanceControls() {');
if (jsStart < 0 || jsEnd < 0) {
  console.error('Could not find student JS block', jsStart, jsEnd);
  process.exit(1);
}
merged = merged.slice(0, jsStart).concat(merged.slice(jsEnd));

text = merged.join('\n');
text = text.replace(
  /const hubReportSectionCount = 6 \+/,
  'const hubReportSectionCount = 5 +'
);
text = text.replace(
  /\s*<button type="button" class="hub-section-segment" data-hub-workspace-section="students">[\s\S]*?<\/button>\s*/,
  '\n'
);
text = text.replace(
  /\s*{\s*key: 'students',[\s\S]*?sourceUrl: '\/school\/report-hub',\s*},\s*/,
  '\n'
);
text = text.replace(
  /\s*if \(key === 'students'\) \{\s*return evaluateModuleAccess[\s\S]*?refreshedAt: new Date\(\)\.toISOString\(\)\s*};\s*\}\s*/,
  '\n'
);
text = text.replace(
  /\s*if \(key === 'students'\) \{\s*renderStudentsWorkspace\(\{[\s\S]*?\}\);\s*return;\s*\}\s*/,
  '\n'
);

fs.writeFileSync(file, text, 'utf8');
console.log('Stripped students workspace from reportHub.ejs');