'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { requireCoreModule } = require('../MVC/services/school/schoolCoreContracts');
const { registerSchoolUploadCategoryResolvers } = require('../MVC/services/school/schoolUploadCategoryRegistration');
const uploadCategoryResolverService = requireCoreModule('MVC/services/uploadCategoryResolverService');
const wordOfDayService = require('../MVC/services/school/wordOfDayService');

const ROOT = path.resolve(__dirname, '../../..');
const WOD_ROUTES = path.join(ROOT, 'packages/school/MVC/routes/wordOfDayRoutes.js');
const WOD_SERVICE = path.join(ROOT, 'packages/school/MVC/services/school/wordOfDayService.js');

test('school.wordOfDay upload category resolver is registered', () => {
  uploadCategoryResolverService.resetUploadCategoryResolvers();
  registerSchoolUploadCategoryResolvers();
  assert.equal(uploadCategoryResolverService.hasUploadCategoryResolver('school.wordofday'), true);
});

test('word of day routes use dedicated media upload middleware', () => {
  const source = fs.readFileSync(WOD_ROUTES, 'utf8');
  assert.match(source, /uploadWordOfDayMedia/);
  assert.match(source, /requireWordOfDayMediaUploadAccess/);
  assert.doesNotMatch(source, /requireAccess\(SECTION, OPERATIONS\.UPDATE\),\s*\n\s*upload\(SCHOOL_UPLOAD_FOLDERS\.WORD_OF_DAY/);
});

test('wordOfDay service deletes superseded media on update', () => {
  const source = fs.readFileSync(WOD_SERVICE, 'utf8');
  assert.match(source, /deleteSupersededMediaKinds/);
  assert.match(source, /deleteEntryMediaFiles/);
});

test('enrichMediaRef maps storagePath to url', () => {
  const enriched = wordOfDayService.enrichMediaRef({
    storagePath: '/uploads/ORG_1/school/word-of-day/WOD_1/photo/sample.jpg',
    fileName: 'sample.jpg',
    mimeType: 'image/jpeg'
  });
  assert.equal(enriched.url, '/uploads/ORG_1/school/word-of-day/WOD_1/photo/sample.jpg');
  assert.equal(enriched.fileName, 'sample.jpg');
});

test('shouldDeleteSupersededMedia when url changes or clears', () => {
  const prev = { url: '/uploads/ORG_1/a.jpg' };
  const next = { url: '/uploads/ORG_1/b.jpg' };
  const cleared = {};
  assert.equal(wordOfDayService.shouldDeleteSupersededMedia(prev, next), true);
  assert.equal(wordOfDayService.shouldDeleteSupersededMedia(prev, prev), false);
  assert.equal(wordOfDayService.shouldDeleteSupersededMedia(prev, cleared), true);
  assert.equal(wordOfDayService.shouldDeleteSupersededMedia(cleared, prev), false);
});