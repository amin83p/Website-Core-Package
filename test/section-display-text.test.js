const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSectionDisplayTitle } = require('../MVC/utils/sectionDisplay');
const { buildSectionFromBody } = require('../MVC/controllers/sectionController');

function formatLabel(name) {
  return String(name || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

test('resolveSectionDisplayTitle returns displayText verbatim when set', () => {
  assert.equal(
    resolveSectionDisplayTitle({ name: 'SCHOOL_IELTS', displayText: 'School ielts' }, formatLabel),
    'School ielts'
  );
  assert.equal(
    resolveSectionDisplayTitle({ name: 'PTE', displayText: 'ALL CAPS' }, formatLabel),
    'ALL CAPS'
  );
  assert.equal(
    resolveSectionDisplayTitle({ name: 'PTE', displayText: '  my Custom Label  ' }, formatLabel),
    'my Custom Label'
  );
});

test('resolveSectionDisplayTitle falls back to formatted name when displayText is empty', () => {
  assert.equal(
    resolveSectionDisplayTitle({ name: 'SCHOOL_IELTS' }, formatLabel),
    'School Ielts'
  );
  assert.equal(
    resolveSectionDisplayTitle({ name: 'SCHOOL_IELTS', displayText: '' }, formatLabel),
    'School Ielts'
  );
  assert.equal(
    resolveSectionDisplayTitle({ name: 'SCHOOL_IELTS', displayText: '   ' }, formatLabel),
    'School Ielts'
  );
});

test('resolveSectionDisplayTitle uses id when name is missing', () => {
  assert.equal(
    resolveSectionDisplayTitle({ id: '12345' }, formatLabel),
    '12345'
  );
});

test('buildSectionFromBody includes displayText without mutating case', () => {
  const section = buildSectionFromBody({
    name: 'TEST_SECTION',
    displayText: 'my Custom Label',
    category: 'GENERAL',
    description: 'Test description',
    active: 'true',
    minimumAccessRequirement: '5',
    selectedOperations: '[]',
    subsections: '[]',
    related: '[]'
  }, 'user-1');

  assert.equal(section.displayText, 'my Custom Label');
  assert.equal(section.name, 'TEST_SECTION');
});

test('buildSectionFromBody trims displayText whitespace', () => {
  const section = buildSectionFromBody({
    name: 'TEST_SECTION',
    displayText: '  trimmed label  ',
    category: 'GENERAL',
    description: 'Test description',
    active: 'true',
    minimumAccessRequirement: '5',
    selectedOperations: '[]',
    subsections: '[]',
    related: '[]'
  }, 'user-1');

  assert.equal(section.displayText, 'trimmed label');
});
