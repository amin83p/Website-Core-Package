const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const conductRatingScaleService = require('../packages/school/MVC/services/school/conductRatingScaleService');

test('conductRatingScaleService maps default bands and midpoints', () => {
  const policy = conductRatingScaleService.resolvePolicy();
  assert.equal(policy.levels.length, 4);
  assert.equal(conductRatingScaleService.percentToLevel(100, policy).code, 'S');
  assert.equal(conductRatingScaleService.percentToLevel(85, policy).code, 'S');
  assert.equal(conductRatingScaleService.percentToLevel(84, policy).code, 'Sat');
  assert.equal(conductRatingScaleService.percentToLevel(72, policy).code, 'Sat');
  assert.equal(conductRatingScaleService.percentToLevel(50, policy).code, 'NI');
  assert.equal(conductRatingScaleService.percentToLevel(49, policy).code, 'U');
  assert.equal(conductRatingScaleService.levelDefaultPercent('S', policy), 92.5);
  assert.equal(conductRatingScaleService.levelDefaultPercent('Sat', policy), 72);
  assert.equal(conductRatingScaleService.levelDefaultPercent('NI', policy), 54.5);
  assert.equal(conductRatingScaleService.levelDefaultPercent('U', policy), 24.5);
});

test('conductRatingScaleService validates contiguous ranges and rejects overlaps', () => {
  const valid = conductRatingScaleService.validatePolicyLevels(conductRatingScaleService.DEFAULT_LEVELS);
  assert.equal(valid.valid, true);

  const invalid = conductRatingScaleService.validatePolicyLevels([
    { code: 'S', label: 'Superior', emoji: '⭐', minPercent: 85, maxPercent: 100, defaultPercent: 92.5 },
    { code: 'Sat', label: 'Satisfactory', emoji: '👍', minPercent: 60, maxPercent: 90, defaultPercent: 72 }
  ]);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((row) => /overlap/i.test(row)));
});

test('conductRatingScaleService normalizePolicyFromForm throws on invalid ranges', () => {
  assert.throws(() => conductRatingScaleService.normalizePolicyFromForm({
    levels: [{ code: 'S', label: 'Superior', emoji: '⭐', minPercent: 50, maxPercent: 100, defaultPercent: 80 }]
  }), /Lowest level must start at 0%/);
});

test('class routes expose admin conduct rating scale settings endpoint', () => {
  const source = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(source, /requireConductRatingScalePolicyAdmin/);
  assert.match(source, /router\.post\('\/conduct-rating-scale\/settings'/);
  assert.match(source, /classCtrl\.saveConductRatingScaleSettings/);
});

test('manageSession passes conduct rating scale to session manager view', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /conductRatingScalePolicyModel\.getPolicyForOrg/);
  assert.match(source, /conductRatingScaleResolved/);
  assert.match(source, /canManageConductRatingScale: canOverride/);
  assert.match(source, /async function saveConductRatingScaleSettings/);
});

test('session manager renders emoji conduct cells, bulk modal, and admin settings', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /conduct-rating-cell/);
  assert.match(source, /conduct-emoji-btn/);
  assert.match(source, /conduct-percent-input/);
  assert.match(source, /id="btnOpenConductBulkModal"/);
  assert.match(source, /id="conductBulkRatingModal"/);
  assert.match(source, /id="btnConductBulkSetAllSuperior"/);
  assert.match(source, /conduct-bulk-set-all-level/);
  assert.match(source, /conduct-bulk-set-all-level" data-code="<%= level.code %>"/);
  assert.match(source, /code: 'Sat'/);
  assert.match(source, /code: 'NI'/);
  assert.match(source, /code: 'U'/);
  assert.match(source, /conduct-bulk-column-emoji-btn/);
  assert.doesNotMatch(source, /conduct-set-all-level/);
  assert.doesNotMatch(source, /conduct-column-emoji-btn/);
  assert.match(source, /setConductColumnToLevel/);
  assert.match(source, /canManageConductRatingScaleFlag/);
  assert.match(source, /id="btnOpenConductScaleSettingsModal"/);
  assert.match(source, /id="conductScaleSettingsModal"/);
  assert.match(source, /window\.__conductRatingScale/);
  assert.match(source, /classEffortPercent: readConductRating\(conductRow, '\.conduct-class-effort'\)/);
});

test('package manifest registers conductRatingScalePolicy entity', () => {
  const source = read('packages/school/package.manifest.json');
  assert.match(source, /"entityType": "conductRatingScalePolicy"/);
});
