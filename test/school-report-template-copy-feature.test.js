const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('report template copy route uses create access and copy controller', () => {
  const source = read('packages/school/MVC/routes/reportRoutes.js');
  assert.match(source, /router\.get\('\/templates\/copy\/:id'/);
  assert.match(source, /requireAccess\(REPORT_TEMPLATE_SECTION, OPERATIONS\.CREATE\)[\s\S]*ctrl\.showTemplateCopyForm/);
  assert.match(source, /trackActionState\(REPORT_TEMPLATE_SECTION, OPERATIONS\.CREATE\)[\s\S]*ctrl\.showTemplateCopyForm/);
});

test('report template create post accepts copy token target fallback', () => {
  const source = read('packages/school/MVC/routes/reportRoutes.js');
  assert.match(source, /const reportTemplateCreateActionState = \{\s*requireToken: true,\s*allowOperationTokenFallback: true\s*\}/);
  assert.match(source, /router\.post\('\/templates\/new'[\s\S]*trackActionState\(REPORT_TEMPLATE_SECTION, OPERATIONS\.CREATE, reportTemplateCreateActionState\)[\s\S]*ctrl\.saveTemplate/);
});
test('report template list exposes copy action in row menu', () => {
  const source = read('packages/school/MVC/views/school/report/templateList.ejs');
  assert.match(source, /\/school\/reports\/templates\/copy\/<%= row\.id %>/);
  assert.match(source, />Copy<\/a>/);
  assert.match(source, /bi-files/);
});

test('report template copy form posts to create flow and carries source id safely', () => {
  const source = read('packages/school/MVC/views/school/report/templateForm.ejs');
  assert.match(source, /const isEdit = !!\(template && template\.id\)/);
  assert.match(source, /typeof copySourceTemplate !== 'undefined'/);
  assert.match(source, /name="copySourceTemplateId"/);
  assert.match(source, /isEdit \? \('\/school\/reports\/templates\/edit\/'.*\) : '\/school\/reports\/templates\/new'/);
});

test('report template copy controller creates a draft copy without mutating source', () => {
  const source = read('packages/school/MVC/controllers/school/reportController.js');
  assert.match(source, /async function showTemplateCopyForm/);
  assert.match(source, /buildCopiedTemplateDraft\(sourceTemplate, allTemplates, activeOrgId\)/);
  assert.match(source, /title: `Copy of \$\{originalTitle\}`\.slice\(0, 180\)/);
  assert.match(source, /status: 'draft'/);
  assert.match(source, /resolveNextTemplateVersion\(templates, sourceTemplate/);
  assert.match(source, /copySourceTemplateId/);
  assert.match(source, /payload\.docxTemplate = clonePlainValue\(copySourceTemplate\.docxTemplate, null\)/);
  assert.doesNotMatch(source, /updateData\('reportTemplates',[\s\S]*copySourceTemplateId/);
});