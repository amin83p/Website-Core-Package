'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.join(__dirname, '..', '..');

function readPackageFile(relPath) {
  return fs.readFileSync(path.join(packageRoot, relPath), 'utf8');
}

function readMasterScheduleViewerJs() {
  return [
    readPackageFile('public/scripts/masterScheduleViewer.js'),
    readPackageFile('public/scripts/masterScheduleViewerStaging.js')
  ].join('\n');
}

function readPersonScheduleAdminView() {
  return readPackageFile('MVC/views/school/schedule/personScheduleAdmin.ejs');
}

function readPersonScheduleSelfView() {
  return readPackageFile('MVC/views/school/schedule/personScheduleSelf.ejs');
}

function readPersonScheduleAdminBundle() {
  return [
    readPersonScheduleAdminView(),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleCalendarShell.ejs'),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleSharedModals.ejs'),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleSessionContextMenuAdmin.ejs'),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleAdminStagingModals.ejs'),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleScriptsCore.ejs'),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleScriptsAdmin.ejs')
  ].join('\n');
}

function readPersonScheduleSelfBundle() {
  return [
    readPersonScheduleSelfView(),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleSharedModals.ejs'),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleSessionContextMenuSelf.ejs'),
    readPackageFile('MVC/views/school/schedule/partials/personScheduleScriptsCore.ejs')
  ].join('\n');
}

function readPersonScheduleView() {
  return `${readPersonScheduleAdminBundle()}\n${readPersonScheduleSelfBundle()}`;
}

module.exports = {
  readMasterScheduleViewerJs,
  readPersonScheduleAdminView,
  readPersonScheduleSelfView,
  readPersonScheduleAdminBundle,
  readPersonScheduleSelfBundle,
  readPersonScheduleView,
  readPackageFile
};
