const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('Teacher and Staff attachment routes use file permissions and secure token fallback', () => {
  for (const [label, fileName, section, category] of [
    ['Teacher', 'teacherRoutes.js', 'SCHOOL_TEACHERS', 'school-teachers'],
    ['Staff', 'staffRoutes.js', 'SCHOOL_STAFF', 'school-staff']
  ]) {
    const source = read('packages/school/MVC/routes/' + fileName);
    const deleteStart = source.indexOf("router.delete('/:id/attachments/:attId'");
    const deleteEnd = source.indexOf('ctrl.deleteAttachment);', deleteStart);
    const deleteRoute = source.slice(deleteStart, deleteEnd + 'ctrl.deleteAttachment);'.length);
    const downloadStart = source.indexOf("router.get('/:id/attachments/:attId/download'");
    const downloadEnd = source.indexOf('ctrl.downloadAttachment);', downloadStart);
    const downloadRoute = source.slice(downloadStart, downloadEnd + 'ctrl.downloadAttachment);'.length);

    assert.ok(deleteStart >= 0, label + ' delete route is missing.');
    assert.ok(downloadStart >= 0, label + ' download route is missing.');
    assert.ok(deleteRoute.includes('requireAccess(SECTIONS.' + section + ', OPERATIONS.DELETE_FILE)'));
    assert.ok(deleteRoute.includes('trackActionState(SECTIONS.' + section + ', OPERATIONS.DELETE_FILE'));
    assert.ok(deleteRoute.includes('requireToken: true'));
    assert.ok(deleteRoute.includes('allowOperationTokenFallback: true'));
    assert.ok(!deleteRoute.includes('allowSectionTokenFallback: true'));
    assert.ok(!deleteRoute.includes('allowInactiveTokenFallback: true'));
    assert.ok(downloadRoute.includes('requireAccess(SECTIONS.' + section + ', OPERATIONS.DOWNLOAD_FILE)'));
    assert.ok(source.includes("upload('" + category + "', true).array('files', 5)"));
  }
});

test('Teacher and Staff forms submit editable attachment state and files as multipart data', () => {
  for (const [label, formPath, modelPath, routeBase] of [
    ['Teacher', 'school/teacher/teacherForm.ejs', 'school/teacherModel.js', '/school/teachers'],
    ['Staff', 'school/staff/staffForm.ejs', 'school/staffModel.js', '/school/staff']
  ]) {
    const form = read('packages/school/MVC/views/' + formPath);
    const model = read('packages/school/MVC/models/' + modelPath);

    assert.ok(form.includes('enctype="multipart/form-data"'), label + ' form must be multipart.');
    assert.ok(form.includes('name="attachments" id="hid_attachments"'));
    assert.ok(form.includes("include('../partials/personAttachments'"));
    assert.ok(form.includes('new FormData()'));
    assert.ok(form.includes("data.append('files', file)"));
    assert.ok(form.includes("attachmentRouteBase: '" + routeBase + "'"));
    assert.ok(model.includes('attachments: cleanAttachments(input.attachments)'));
  }

  const partial = read('packages/school/MVC/views/school/partials/personAttachments.ejs');
  assert.ok(partial.includes("method: 'DELETE'"));
  assert.ok(partial.includes('choice === true'));
  assert.ok(partial.includes("toLowerCase() === 'delete'"));
  assert.ok(partial.includes('/download'));
});

test('School package declares Teacher and Staff file permissions and storage folders', () => {
  const manifest = JSON.parse(read('packages/school/package.manifest.json'));
  const folders = new Map((manifest.uploadFolders || []).map((row) => [row.key, row]));

  assert.equal(folders.get('school.teachers')?.defaultTemplate, 'teachers/{personId}');
  assert.equal(folders.get('school.staff')?.defaultTemplate, 'staff/{personId}');

  for (const sectionName of ['SCHOOL_TEACHERS', 'SCHOOL_STAFF']) {
    const section = manifest.sections.find((row) => row.name === sectionName);
    const operations = new Set((section?.operations || []).map((row) => String(row.id || '')));
    assert.ok(operations.has('OP1023'), sectionName + ' must include DOWNLOAD_FILE.');
    assert.ok(operations.has('355444'), sectionName + ' must include DELETE_FILE.');
  }
});

test('Teacher and Staff upload categories resolve to their package-owned folders', () => {
  const registration = read('packages/school/MVC/services/school/schoolUploadCategoryRegistration.js');
  const paths = read('packages/school/MVC/utils/schoolUploadPathUtils.js');

  assert.ok(registration.includes("registerUploadCategoryResolver('school-teachers'"));
  assert.ok(registration.includes("registerUploadCategoryResolver('school-staff'"));
  assert.ok(paths.includes("resolveUploadFolder('school.teachers'"));
  assert.ok(paths.includes("resolveUploadFolder('school.staff'"));
});

test('shared name Sync button preserves its real label across confirmation and completion', () => {
  const source = read('packages/school/MVC/views/school/partials/syncDenormalizedNamesManage.ejs');
  const clickIndex = source.indexOf("btn.addEventListener('click'");
  const originalIndex = source.indexOf('const original = btn.innerHTML;', clickIndex);
  const confirmationIndex = source.indexOf('await window.showMessageModal({', clickIndex);

  assert.ok(source.includes("btn.dataset.noWait = 'true'"));
  assert.ok(source.includes('event.stopPropagation()'));
  assert.ok(source.includes('window.appWaiting.clear(btn)'));
  assert.ok(source.includes('restoreSyncButton(original);'));
  assert.ok(originalIndex > clickIndex, 'Sync must capture its label when the click starts.');
  assert.ok(confirmationIndex > originalIndex, 'Sync must capture its label before awaiting confirmation.');

  for (const listPath of [
    'packages/school/MVC/views/school/student/studentList.ejs',
    'packages/school/MVC/views/school/teacher/teacherList.ejs',
    'packages/school/MVC/views/school/staff/staffList.ejs'
  ]) {
    assert.ok(read(listPath).includes("include('school/partials/syncDenormalizedNamesManage'"));
  }
});
