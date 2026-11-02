'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const analyzerJsPath = path.join(__dirname, '../public/scripts/logArchiveAnalyzer.js');
const routesPath = path.join(__dirname, '../MVC/routes/logArchiveRoutes.js');

test('logArchiveAnalyzer client script does not upload archive data', () => {
  const src = fs.readFileSync(analyzerJsPath, 'utf8');
  const forbidden = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bsendBeacon\s*\(/,
    /\baxios\b/,
    /\/logs\/archive\/(export|upload)/
  ];
  forbidden.forEach((pattern) => {
    assert.equal(pattern.test(src), false, `Forbidden pattern in logArchiveAnalyzer.js: ${pattern}`);
  });
});

test('log archive routes expose no analyze upload endpoint', () => {
  const routes = fs.readFileSync(routesPath, 'utf8');
  assert.match(routes, /router\.get\('\/analyze'/);
  assert.doesNotMatch(routes, /router\.post\('\/analyze'/);
});

test('browser range module mirrors export zip filename pattern', () => {
  const rangeSrc = fs.readFileSync(
    path.join(__dirname, '../public/scripts/logArchiveAnalyzerRange.js'),
    'utf8'
  );
  assert.match(rangeSrc, /activity-archive_/);
  const { parseArchiveZipFileName } = require('../MVC/services/logArchive/logArchiveRangeUtils');
  const parsed = parseArchiveZipFileName('activity-archive_2026-04-29_2026-11-01_EXP-x.zip');
  assert.equal(parsed.startDate, '2026-04-29');
});
