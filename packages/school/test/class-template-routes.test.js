const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const classTemplateController = require('../MVC/controllers/school/classTemplateController');

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
  assert.match(routeSource, /create-from-template\/bootstrap/);
  assert.match(routeSource, /create-from-template/);
  assert.match(routeSource, /preview-template-title/);
});

test('class template routes expose copy template api', () => {
  const routeSource = read('MVC/routes/classTemplateRoutes.js');
  assert.match(routeSource, /\/api\/template\/:id/);
  assert.match(routeSource, /getDefinitionTemplateCopyPayload/);
});

test('buildDefinitionTemplateCopyPayload suggests unique code and copy name', () => {
  const payload = classTemplateController.buildDefinitionTemplateCopyPayload(
    {
      id: 'CLT-A',
      code: 'EAL-STD',
      name: 'Standard',
      titlePattern: 'EAL-{{period}}',
      snapshot: { registrationMode: 'term_based', status: 'active' }
    },
    { usedCodes: new Set(['EAL-STD-COPY']) }
  );
  assert.equal(payload.code, 'EAL-STD-COPY2');
  assert.match(payload.name, /\(Copy\)/);
  assert.equal(payload.templateStatus, 'draft');
  assert.equal(payload.title, 'EAL-{{period}}');
});

test('class template list includes copy action', () => {
  const listView = read('MVC/views/school/class/classTemplateList.ejs');
  assert.match(listView, /copyFrom=/);
  assert.match(listView, />\s*Copy\s*</i);
});

test('class template form exposes copy from template control', () => {
  const formView = fs.readFileSync(path.join(root, 'MVC/views/school/class/classForm.ejs'), 'utf8');
  assert.match(formView, /btnCopyFromTemplate/);
  assert.match(formView, /Copy from Template/);
  assert.match(formView, /class-templates\/api\/template/);
  assert.match(formView, /classDefinitionTemplateRecordId = <%- JSON\.stringify/);
});

test('class list opens create from template modal', () => {
  const listView = read('MVC/views/school/class/classes.ejs');
  assert.match(listView, /btnOpenCreateClassFromTemplate/);
  assert.match(listView, /classCreateFromTemplateModal/);
  assert.match(listView, /classCreateFromTemplateModal\.js/);
  assert.match(listView, /Create from Template/i);
  assert.doesNotMatch(listView, /href="\/school\/classes\/new-from-template"/);
});

test('create from template modal script uses student count and editable title', () => {
  const script = fs.readFileSync(path.join(root, '../../public/scripts/classCreateFromTemplateModal.js'), 'utf8');
  assert.match(script, /studentCount/);
  assert.match(script, /cft_title/);
  assert.match(script, /create-from-template\/bootstrap/);
  assert.match(script, /showMessageModal/);
  assert.doesNotMatch(script, /classCreateFromTemplateEmpty/);
});
