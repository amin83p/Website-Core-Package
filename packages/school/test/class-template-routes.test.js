const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('classTemplateRoutes uses SCHOOL_CLASS_TEMPLATES section', () => {
  const routeSource = read('MVC/routes/classTemplateRoutes.js');
  assert.match(routeSource, /const SECTION_ID = SECTIONS\.SCHOOL_CLASS_TEMPLATES/);
  assert.match(routeSource, /requireAccess\(SECTION_ID,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTION_ID,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTION_ID,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTION_ID,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listClassTemplates/);
});

test('manifest defines SCHOOL_CLASS_TEMPLATES section and menu', () => {
  const manifest = read('package.manifest.json');
  assert.match(manifest, /"name": "SCHOOL_CLASS_TEMPLATES"/);
  assert.match(manifest, /"homeURL": "\/school\/class-templates"/);
  assert.match(manifest, /school-menu-class-templates/);
});

test('class routes expose create-from-template endpoints', () => {
  const routeSource = read('MVC/routes/classRoutes.js');
  assert.match(routeSource, /new-from-template/);
  assert.match(routeSource, /create-from-template/);
  assert.match(routeSource, /preview-template-title/);
});

test('class list includes create from template action', () => {
  const listView = read('MVC/views/school/class/classes.ejs');
  assert.match(listView, /new-from-template/);
  assert.match(listView, /Create from Template/i);
});
