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

function readPersonScheduleView() {
  return readPackageFile('MVC/views/school/schedule/personSchedule.ejs');
}

module.exports = {
  readMasterScheduleViewerJs,
  readPersonScheduleView,
  readPackageFile
};
