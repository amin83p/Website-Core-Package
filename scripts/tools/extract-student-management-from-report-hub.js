'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const reportHubPath = path.join(ROOT, 'packages/school/MVC/views/school/reportHub.ejs');
const lines = fs.readFileSync(reportHubPath, 'utf8').split(/\r?\n/);

let css = lines.slice(262, 956).join('\n');
css = css.replace(/\.school-master-hub /g, '.school-student-management-root ');

let js = lines.slice(11920, 12636).join('\n');
js = js.replace(/schoolReportHubStudentsRecent/g, 'schoolStudentManagementRecent');
js = js.replace(/\/school\/report-hub\/api\/students/g, "' + API_BASE + '/students");
js = js.replace(
  /String\(workspaceState\.currentSection \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'students'/g,
  'false'
);

js = js.replace(
  /function renderStudentsWorkspace\(payload\) \{[\s\S]*?sourceUrl: '\/school\/students'\s*\};\s*els\.workspace\.innerHTML = \[/,
  `function mountStudentManagementWorkspace() {
    const workspace = document.getElementById('schoolStudentManagementWorkspace');
    if (!workspace) return;
    workspace.innerHTML = [`
);

js = js.replace(
  /<div><div class="text-uppercase text-muted small fw-bold">Report Hub Section<\/div>/,
  '<div><div class="text-uppercase text-muted small fw-bold">Workspace</div>'
);

const header = `'use strict';
(function (global) {
  const API_BASE = '/school/student-management/api';
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function formatHubDateKey(dateValue, options) {
    options = options || {};
    const raw = String(dateValue || '').trim();
    if (!raw) return '-';
    if (global.AppOrgDateTime && typeof global.AppOrgDateTime.formatDateKey === 'function') {
      return global.AppOrgDateTime.formatDateKey(raw, options);
    }
    return raw;
  }
`;

const footer = `
  function bootStudentManagementPage() {
    mountStudentManagementWorkspace();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootStudentManagementPage);
  } else {
    bootStudentManagementPage();
  }
})(window);
`;

const outJs = path.join(ROOT, 'packages/school/public/scripts/schoolStudentManagement.js');
const outCss = path.join(ROOT, 'packages/school/MVC/views/school/partials/studentManagementStyles.ejs');
fs.mkdirSync(path.dirname(outJs), { recursive: true });
fs.writeFileSync(outJs, header + '\n' + js + '\n' + footer, 'utf8');
fs.writeFileSync(outCss, '<style>\n' + css + '\n</style>\n', 'utf8');

if (js.includes('renderStudentsWorkspace') || js.includes('els.workspace')) {
  console.error('Extraction incomplete: still references renderStudentsWorkspace or els.workspace');
  process.exit(1);
}
console.log('Wrote', outJs);
console.log('Wrote', outCss);