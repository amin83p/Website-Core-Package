'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('autosave section catalog registers manage-session', () => {
  const catalog = require('../packages/school/MVC/config/autosaveSectionCatalog');
  const keys = catalog.listAutosaveSectionKeys();
  assert.deepEqual(keys, ['manage-session']);
  assert.equal(catalog.getAutosaveSection('manage-session')?.title, 'Manage Session');
});

test('autosave policy service resolves global and section defaults', () => {
  const service = require('../packages/school/MVC/services/school/autosavePolicyService');
  const policy = service.resolvePolicy({
    defaultMinutes: 7,
    sections: {
      'manage-session': { enabledByDefault: false, defaultMinutes: 12 }
    }
  });
  assert.equal(policy.defaultMinutes, 7);
  assert.equal(policy.sections['manage-session'].enabledByDefault, false);
  assert.equal(policy.sections['manage-session'].defaultMinutes, 12);

  const sectionConfig = service.resolveSectionConfig(policy, 'manage-session');
  assert.equal(sectionConfig.enabledByDefault, false);
  assert.equal(sectionConfig.defaultMinutes, 12);

  const fallbackSection = service.resolveSectionConfig(policy, 'unknown-section');
  assert.equal(fallbackSection.enabledByDefault, false);
  assert.equal(fallbackSection.defaultMinutes, 7);
});

test('autosave policy service clamps minutes and rejects unknown section keys on save', () => {
  const service = require('../packages/school/MVC/services/school/autosavePolicyService');
  const normalized = service.validatePolicyInput({
    defaultMinutes: 120,
    sections: {
      'manage-session': { enabledByDefault: true, defaultMinutes: 0 }
    }
  });
  assert.equal(normalized.defaultMinutes, 60);
  assert.equal(normalized.sections['manage-session'].defaultMinutes, 1);

  assert.throws(
    () => service.validatePolicyInput({
      defaultMinutes: 5,
      sections: { 'bad-section': { enabledByDefault: true } }
    }),
    /Unknown autosave section key/
  );
});

test('schoolAutosave client exposes init, storage key, and side-control injection', () => {
  const source = read('public/scripts/schoolAutosave.js');
  assert.match(source, /global\.SchoolAutosave/);
  assert.match(source, /function init\(/);
  assert.match(source, /STORAGE_PREFIX = 'schoolAutosave'/);
  assert.match(source, /function storageKey\(/);
  assert.match(source, /header-side-controls/);
  assert.match(source, /school-autosave-side-control__rings/);
  assert.match(source, /schoolAutosaveSettingsModal/);
  assert.match(source, /data-no-wait/);
  assert.match(source, /modal-md/);
});

test('session manager wires autosave runtime and extracted save helpers', () => {
  const view = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  const controller = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(view, /\/scripts\/schoolAutosave\.js/);
  assert.match(view, /SchoolAutosave\.init/);
  assert.match(view, /sectionKey:\s*'manage-session'/);
  assert.match(view, /function buildSessionSavePayload/);
  assert.match(view, /function runSessionSave/);
  assert.match(view, /function isSessionFormDirty/);
  assert.match(controller, /autosavePolicyResolved/);
  assert.match(controller, /autosavePolicyModel\.getPolicyForOrg/);
});

test('data maintenance catalog includes autosave policy entity', () => {
  const catalog = require('../packages/school/MVC/config/schoolDataMaintenanceCatalog');
  const entry = catalog.getCatalogEntry('autosavePolicy');
  assert.ok(entry);
  assert.equal(entry.policyModel, 'autosave');
  assert.equal(entry.collectionName, 'schoolAutosavePolicy');
});
