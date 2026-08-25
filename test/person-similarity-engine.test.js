'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../MVC/services/person/personSimilarityEngineService');

function person(first, last, extra = {}) {
  return {
    id: extra.id || `P_${first}_${last}`,
    name: { first, last },
    contact: { email: extra.email || `${first}.${last}@example.com` },
    demographics: { dateOfBirth: extra.dateOfBirth || '' }
  };
}

test('normalizeNamePart trims, collapses spaces, and lowercases', () => {
  assert.equal(engine.normalizeNamePart('  Ana   Maria '), 'ana maria');
  assert.equal(engine.normalizeNamePart('ALVARENGA'), 'alvarenga');
});

test('isExactNameMatch detects normalized first and last equality', () => {
  assert.equal(engine.isExactNameMatch(
    { firstName: 'Maria', lastName: 'Alvarenga' },
    { firstName: 'maria', lastName: 'ALVARENGA' }
  ), true);
});

test('scorePersonSimilarity returns exact tier for identical names', () => {
  const scored = engine.scorePersonSimilarity(
    { firstName: 'John', lastName: 'Smith' },
    person('John', 'Smith', { id: 'P1' })
  );
  assert.equal(scored.matchType, 'exact');
  assert.equal(scored.score, engine.EXACT_MATCH_SCORE);
});

test('scorePersonSimilarity detects one-letter last name differences as similar', () => {
  const scored = engine.scorePersonSimilarity(
    { firstName: 'Maria', lastName: 'Alvarenga' },
    person('Maria', 'Alvarenaga', { id: 'P2' })
  );
  assert.equal(scored.matchType, 'similar');
  assert.ok(scored.score >= 90);
});

test('scorePersonSimilarity stays below threshold for clearly different names', () => {
  const scored = engine.scorePersonSimilarity(
    { firstName: 'John', lastName: 'Smith' },
    person('Jane', 'Doe', { id: 'P3' })
  );
  assert.ok(scored.score < engine.DEFAULT_MIN_SCORE);
});

test('rankSimilarPersons returns exact matches before similar matches', () => {
  const ranked = engine.rankSimilarPersons(
    { firstName: 'Maria', lastName: 'Alvarenga' },
    [
      person('Maria', 'Alvarenaga', { id: 'P_similar' }),
      person('Maria', 'Alvarenga', { id: 'P_exact' })
    ],
    { minScore: 60, limit: 10 }
  );
  assert.equal(ranked[0].personId, 'P_exact');
  assert.equal(ranked[0].matchType, 'exact');
  assert.equal(ranked[1].matchType, 'similar');
});

test('collectExactNameMatches remains compatible with duplicate service usage', () => {
  const matches = engine.collectExactNameMatches(
    [person('Maria', 'Alvarenga', { id: 'P1' }), person('Maria', 'Alvarez', { id: 'P2' })],
    'Maria',
    'Alvarenga'
  );
  assert.deepEqual(matches.map((row) => row.personId), ['P1']);
});

test('person routes expose similar-matches API', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/personRoutes.js'), 'utf8');
  assert.match(routes, /\/api\/similar-matches/);
  assert.match(routes, /personSimilarityCtrl\.listSimilarMatches/);
});

test('student import preview returns similarMatches', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/controllers/school/studentImportController.js'),
    'utf8'
  );
  assert.match(source, /findSimilarPersonMatches/);
  assert.match(source, /similarMatches/);
});

test('student import modal renders similar match warnings', () => {
  const modal = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/student/modal_StudentImport.ejs'),
    'utf8'
  );
  assert.match(modal, /buildMatchStatusHtml/);
  assert.match(modal, /similar-warning-high/);
  assert.match(modal, /match-role-chip/);
});

test('school name-matches APIs return exact and similar payloads', () => {
  const controllers = [
    '../packages/school/MVC/controllers/school/studentController.js',
    '../packages/school/MVC/controllers/school/teacherController.js',
    '../packages/school/MVC/controllers/school/staffController.js',
    '../packages/school/MVC/controllers/school/funderController.js'
  ];
  controllers.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.match(source, /buildNameMatchApiPayload/);
  });
});
