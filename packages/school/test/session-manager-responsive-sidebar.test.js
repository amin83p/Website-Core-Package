const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewPath = path.join(__dirname, '..', 'MVC', 'views', 'school', 'class', 'sessionManager.ejs');
const source = fs.readFileSync(viewPath, 'utf8');

test('session manager does not stack sidebar above main below 992px', () => {
  assert.doesNotMatch(
    source,
    /@media\s*\(\s*max-width:\s*991\.98px\s*\)[\s\S]*session-manager-shell[\s\S]*flex-direction:\s*column/
  );
});

test('session manager defines tablet compact sidebar media query', () => {
  assert.match(source, /@media\s*\(\s*min-width:\s*576px\s*\)\s*and\s*\(\s*max-width:\s*991\.98px\s*\)/);
  assert.match(
    source,
    /@media\s*\(\s*min-width:\s*576px\s*\)\s*and\s*\(\s*max-width:\s*991\.98px\s*\)[\s\S]*\.session-manager-page[\s\S]*--session-sidebar-w:\s*200px/
  );
  assert.match(
    source,
    /@media\s*\(\s*min-width:\s*576px\s*\)\s*and\s*\(\s*max-width:\s*991\.98px\s*\)[\s\S]*\.session-manager-page[\s\S]*padding:\s*0\.4rem\s+0\.25rem/
  );
});

test('session manager defines mobile icon-only sidebar media query', () => {
  assert.match(source, /@media\s*\(\s*max-width:\s*575\.98px\s*\)/);
  assert.match(
    source,
    /@media\s*\(\s*max-width:\s*575\.98px\s*\)[\s\S]*\.session-manager-page[\s\S]*\.session-manager-nav-label[\s\S]*display:\s*none/
  );
});

test('session manager tightens page margins and compact form controls on mobile', () => {
  assert.match(
    source,
    /@media\s*\(\s*max-width:\s*575\.98px\s*\)[\s\S]*\.session-manager-page[\s\S]*padding:\s*0\.15rem\s+0\.1rem/
  );
  assert.match(
    source,
    /@media\s*\(\s*max-width:\s*575\.98px\s*\)[\s\S]*\.session-manager-page[\s\S]*\.form-control[\s\S]*font-size:\s*0\.78rem/
  );
});

test('session manager compacts tables and attendance controls on mobile', () => {
  assert.match(
    source,
    /@media\s*\(\s*max-width:\s*575\.98px\s*\)[\s\S]*#attendanceTable[\s\S]*min-width:\s*0\s*!important/
  );
  assert.match(
    source,
    /@media\s*\(\s*max-width:\s*575\.98px\s*\)[\s\S]*#attendanceTable[\s\S]*\.att-label[\s\S]*font-size:\s*0\.58rem/
  );
});

test('session manager page heading uses fluid clamp sizing', () => {
  assert.match(
    source,
    /\.session-manager-page \.page-heading[\s\S]*font-size:\s*clamp\(/
  );
  assert.match(
    source,
    /\.session-manager-page \.page-heading\.size-md[\s\S]*font-size:\s*clamp\(/
  );
});
