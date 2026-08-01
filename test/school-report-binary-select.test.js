const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const reportSelectField = require(path.join(ROOT_DIR, 'public/scripts/reportSelectField.js'));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('shouldUseBinarySelect is true only for select fields with exactly two options', () => {
  assert.equal(reportSelectField.shouldUseBinarySelect({ type: 'select', options: [{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }] }), true);
  assert.equal(reportSelectField.shouldUseBinarySelect({ type: 'select', options: [{ value: 'a' }] }), false);
  assert.equal(reportSelectField.shouldUseBinarySelect({ type: 'select', options: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] }), false);
  assert.equal(reportSelectField.shouldUseBinarySelect({ type: 'text', options: [{ value: 'a' }, { value: 'b' }] }), false);
});

test('buildReportSelectFieldHtml renders btn-check radios for two-option selects', () => {
  const html = reportSelectField.buildReportSelectFieldHtml({
    field: {
      id: 'attendance_flag',
      label: 'Attendance Flag',
      type: 'select',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' }
      ]
    },
    value: 'yes',
    name: 'field__attendance_flag',
    inputClass: 'js-report-field'
  });

  assert.ok(html.includes('btn-group'));
  assert.ok(html.includes('type="radio"'));
  assert.ok(html.includes('class="btn-check js-report-field"'));
  assert.ok(html.includes('name="field__attendance_flag"'));
  assert.ok(html.includes('value="yes"'));
  assert.ok(html.includes('checked'));
  assert.ok(html.includes('value="no"'));
  assert.ok(html.includes('>Yes</label>'));
  assert.ok(html.includes('>No</label>'));
  assert.equal(html.includes('<select'), false);
});

test('buildReportSelectFieldHtml renders dropdown for three or more options', () => {
  const html = reportSelectField.buildReportSelectFieldHtml({
    field: {
      id: 'level',
      type: 'select',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' }
      ]
    },
    value: 'b',
    inputClass: 'js-report-field'
  });

  assert.ok(html.includes('<select'));
  assert.ok(html.includes('form-select'));
  assert.ok(html.includes('value="b" selected'));
  assert.equal(html.includes('btn-check'), false);
});

test('buildReportSelectFieldHtml marks disabled and small size variants', () => {
  const html = reportSelectField.buildReportSelectFieldHtml({
    field: {
      id: 'choice',
      type: 'select',
      options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }]
    },
    disabled: true,
    size: 'sm',
    inputClass: 'js-matrix-row-field'
  });

  assert.ok(html.includes('btn-group-sm'));
  assert.ok(html.includes(' disabled'));
  assert.ok(html.includes('js-matrix-row-field'));
});

test('report views include shared binary select partial and helper wiring', () => {
  const templateForm = read('packages/school/MVC/views/school/report/templateForm.ejs');
  const instanceEditor = read('packages/school/MVC/views/school/report/instanceEditor.ejs');
  const matrixView = read('packages/school/MVC/views/school/report/instanceMatrix.ejs');
  const partial = read('packages/school/MVC/views/school/report/partials/reportSelectField.ejs');

  assert.match(templateForm, /reportSelectField\.js/);
  assert.match(templateForm, /ReportSelectField\?\.buildReportSelectFieldHtml/);
  assert.match(instanceEditor, /include\('partials\/reportSelectField'/);
  assert.match(matrixView, /include\('partials\/reportSelectField'/);
  assert.match(matrixView, /processedRadioFields/);
  assert.match(instanceEditor, /input\[0\]\?\.type === 'radio'/);
  assert.match(partial, /btn-check/);
  assert.match(partial, /selectOptions\.length === 2/);
});
