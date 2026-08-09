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

test('schoolAutosave client uses visibility-aware scheduling when available', () => {
  const source = read('public/scripts/schoolAutosave.js');
  assert.match(source, /createVisibilityInterval/);
  assert.match(source, /visibilityPoller/);
});

test('session manager wires partial autosave payload and dirty section flags', () => {
  const view = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(view, /\/scripts\/visibilityInterval\.js/);
  assert.match(view, /sessionAutosaveDirty/);
  assert.match(view, /function buildSessionAutosavePayload/);
  assert.match(view, /trigger:\s*'autosave'/);
  assert.match(view, /usePartialPayload:\s*true/);
  assert.match(view, /markSessionAutosaveRosterDirty/);
  assert.match(view, /markSessionAutosaveInstructionalDirty/);
  assert.match(view, /markSessionAutosaveMetadataDirty/);
});

test('saveSession skips index rebuild on autosave trigger', () => {
  const controller = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(controller, /isAutosaveRequest/);
  assert.match(controller, /trigger.*autosave/);
  assert.match(controller, /if \(!isAutosaveRequest\)/);
  assert.match(controller, /rebuildIndexesForClass\(classId\)/);
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

test('saveSession autosave trigger skips rebuildIndexesForClass but manual save still rebuilds', async () => {
  const classController = require('../packages/school/MVC/controllers/school/classController');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const idempotencyGuardService = require('../packages/school/MVC/services/school/idempotencyGuardService');
  const schoolIndexService = require('../packages/school/MVC/services/school/schoolIndexService');
  const classEnrollmentSessionApplicabilityService = require('../packages/school/MVC/services/school/classEnrollmentSessionApplicabilityService');

  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    saveClassSessions: schoolDataService.saveClassSessions,
    createGuardKey: idempotencyGuardService.createGuardKey,
    beginGuard: idempotencyGuardService.beginGuard,
    completeGuard: idempotencyGuardService.completeGuard,
    failGuard: idempotencyGuardService.failGuard,
    rebuildIndexesForClass: schoolIndexService.rebuildIndexesForClass,
    recompute: classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass
  };

  let rebuildCount = 0;
  idempotencyGuardService.createGuardKey = () => 'guard-key';
  idempotencyGuardService.beginGuard = () => ({ status: 'acquired', key: 'guard-key' });
  idempotencyGuardService.completeGuard = () => {};
  idempotencyGuardService.failGuard = () => {};
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-07-10', startTime: '09:00', endTime: '11:00', status: 'scheduled', roster: [] }
  ]);
  schoolDataService.saveClassSessions = async () => {};
  schoolIndexService.rebuildIndexesForClass = async () => {
    rebuildCount += 1;
  };
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = async () => {};

  const createReq = (body) => ({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body,
    headers: { 'x-ajax-request': true },
    xhr: true,
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: false },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    }
  });
  const createRes = () => ({
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  });

  try {
    rebuildCount = 0;
    const autosaveRes = createRes();
    await classController.saveSession(createReq({
      status: 'scheduled',
      notes: 'autosaved note',
      room: '101',
      trigger: 'autosave'
    }), autosaveRes);
    assert.equal(autosaveRes.statusCode, 200);
    assert.equal(autosaveRes.payload.status, 'success');
    assert.equal(rebuildCount, 0);

    rebuildCount = 0;
    const manualRes = createRes();
    await classController.saveSession(createReq({
      status: 'scheduled',
      notes: 'manual note',
      room: '102'
    }), manualRes);
    assert.equal(manualRes.statusCode, 200);
    assert.equal(manualRes.payload.status, 'success');
    assert.equal(rebuildCount, 1);
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.saveClassSessions = originals.saveClassSessions;
    idempotencyGuardService.createGuardKey = originals.createGuardKey;
    idempotencyGuardService.beginGuard = originals.beginGuard;
    idempotencyGuardService.completeGuard = originals.completeGuard;
    idempotencyGuardService.failGuard = originals.failGuard;
    schoolIndexService.rebuildIndexesForClass = originals.rebuildIndexesForClass;
    classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = originals.recompute;
  }
});
