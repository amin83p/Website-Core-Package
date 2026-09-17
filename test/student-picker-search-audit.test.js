'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const {
  CANONICAL_STUDENT_PICKER_SEARCH_FIELDS: CONFIG_CANONICAL,
  LEGACY_STUDENT_PICKER_SEARCH_FIELDS: CONFIG_LEGACY
} = require('../packages/school/config/studentPickerSearchFields');

const {
  CANONICAL_STUDENT_PICKER_SEARCH_FIELDS: SERVICE_CANONICAL
} = require('../packages/school/MVC/services/school/studentListSearchService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function listFilesRecursive(dir, extensions, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      listFilesRecursive(full, extensions, out);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function normalizeSearchFieldsToken(searchFields) {
  return String(searchFields || '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .join(',');
}

function extractPresetCanonicalConstant(source) {
  const match = source.match(
    /const CANONICAL_STUDENT_PICKER_SEARCH_FIELDS = '([^']+)'/
  );
  return match ? match[1] : '';
}

function findStudentPresetCallSites(source, filePath) {
  const sites = [];
  const re = /GenericPickerPresets\.student\s*\(\s*\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const start = match.index;
    let depth = 0;
    let i = source.indexOf('{', start);
    let end = -1;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const block = end > start ? source.slice(start, end) : source.slice(start, start + 400);
    sites.push({ filePath, block });
  }
  return sites;
}

function isLegacyStudentSearchFieldsInBlock(block) {
  const fieldMatch = block.match(/searchFields\s*:\s*['"]([^'"]+)['"]/);
  if (!fieldMatch) return false;
  const normalized = normalizeSearchFieldsToken(fieldMatch[1]);
  if (normalized === normalizeSearchFieldsToken(CONFIG_LEGACY)) return true;
  const tokens = normalized.split(',').filter(Boolean);
  return tokens.length > 0 && !tokens.includes('customstudentid');
}

test('studentListSearchService uses config canonical search fields', () => {
  assert.equal(SERVICE_CANONICAL, CONFIG_CANONICAL);
});

test('genericPickerPresets CANONICAL string matches packages/school/config/studentPickerSearchFields.js', () => {
  const presetSource = read('public/scripts/genericPickerPresets.js');
  const presetCanonical = extractPresetCanonicalConstant(presetSource);
  assert.equal(
    normalizeSearchFieldsToken(presetCanonical),
    normalizeSearchFieldsToken(CONFIG_CANONICAL),
    'Update public/scripts/genericPickerPresets.js to match studentPickerSearchFields.js'
  );
});

test('canonical picker fields include name, customStudentId, and claim paths', () => {
  const tokens = normalizeSearchFieldsToken(CONFIG_CANONICAL).split(',');
  assert.equal(tokens.includes('name'), true);
  assert.equal(tokens.includes('customstudentid'), true);
  assert.equal(tokens.includes('claimnumbers.number'), true);
  assert.equal(tokens.includes('claimnumbers.label'), true);
});

test('no GenericPickerPresets.student call site overrides searchFields with legacy field list', () => {
  const scanRoots = [
    path.join(ROOT_DIR, 'packages'),
    path.join(ROOT_DIR, 'public', 'scripts'),
    path.join(ROOT_DIR, 'MVC', 'views')
  ];
  const files = scanRoots.flatMap((dir) => listFilesRecursive(dir, ['.js', '.ejs']));
  const violations = [];
  files.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    if (!source.includes('GenericPickerPresets.student')) return;
    findStudentPresetCallSites(source, path.relative(ROOT_DIR, filePath)).forEach(({ filePath: rel, block }) => {
      if (isLegacyStudentSearchFieldsInBlock(block)) {
        violations.push(rel);
      }
    });
  });
  assert.deepEqual(
    violations,
    [],
    `Legacy student picker searchFields override in: ${violations.join(', ')}`
  );
});

test('no raw GenericPicker.open uses /school/students without student preset or normalizeConfig', () => {
  const scanRoots = [
    path.join(ROOT_DIR, 'packages'),
    path.join(ROOT_DIR, 'public', 'scripts'),
    path.join(ROOT_DIR, 'MVC', 'views')
  ];
  const files = scanRoots.flatMap((dir) => listFilesRecursive(dir, ['.js', '.ejs']));
  const violations = [];
  const directEndpoint = /GenericPicker\.open\s*\(\s*\{[\s\S]{0,800}?apiEndpoint\s*:\s*['"]\/school\/students['"]/;
  files.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    if (!directEndpoint.test(source)) return;
    if (source.includes('GenericPickerPresets.student(')) return;
    if (source.includes("GenericPickerPresets.normalizeConfig(")) return;
    if (source.includes('preset: \'student\'') || source.includes('preset: "student"')) return;
    violations.push(path.relative(ROOT_DIR, filePath));
  });
  assert.deepEqual(violations, [], `Direct /school/students picker without preset: ${violations.join(', ')}`);
});

test('inventory lists GenericPickerPresets.student and SchoolEntityPicker.open call sites', () => {
  const scanRoots = [
    path.join(ROOT_DIR, 'packages'),
    path.join(ROOT_DIR, 'public', 'scripts')
  ];
  const files = scanRoots.flatMap((dir) => listFilesRecursive(dir, ['.js', '.ejs']));
  const studentPresetFiles = new Set();
  const entityPickerFiles = new Set();
  files.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(ROOT_DIR, filePath);
    if (/GenericPickerPresets\.student\s*\(/.test(source)) studentPresetFiles.add(rel);
    if (/SchoolEntityPicker\.open\s*\(/.test(source)) entityPickerFiles.add(rel);
  });
  assert.ok(studentPresetFiles.size >= 10, 'expected multiple GenericPickerPresets.student call sites');
  assert.ok(entityPickerFiles.size >= 1, 'expected SchoolEntityPicker.open call sites');
});

test('schoolEntityPickerService builds student searchText via studentListSearchHaystack', () => {
  const source = read('packages/school/MVC/services/school/schoolEntityPickerService.js');
  assert.match(source, /buildStudentListSearchHaystack/);
});
