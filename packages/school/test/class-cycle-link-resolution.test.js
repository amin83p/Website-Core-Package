const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const schoolDataService = require('../MVC/services/school/schoolDataService');
const classCycleLinkResolutionService = require('../MVC/services/school/classCycleLinkResolutionService');
const {
  SECTION_HREFS,
  samplesFromRows
} = require('../MVC/services/school/schoolDeletionRuleRegistry');

const TARGET_ID = 'CLASS/CYCLE-2';
const PREVIOUS_ID = 'CLASS/CYCLE-1';
const NEXT_ID = 'CLASS/CYCLE-3';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

test('buildResolverHref includes target, focus, and returnTo', () => {
  const href = classCycleLinkResolutionService.buildResolverHref(TARGET_ID, PREVIOUS_ID, 'delete');
  assert.match(href, /\/school\/classes\/CLASS%2FCYCLE-2\/delete-preparation\?/);
  assert.match(href, /returnTo=delete/);
  assert.match(href, /focus=CLASS%2FCYCLE-1/);
});

test('collectCycleLinkBlockers returns inbound previous and next cycle links', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalFetch = schoolDataService.fetchData;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType !== 'classes' || id !== TARGET_ID) return null;
    return {
      id: TARGET_ID,
      orgId: ORG_ID,
      title: 'EAL Cycle 2',
      cycleNo: 2,
      previousClassId: PREVIOUS_ID,
      nextClassId: NEXT_ID
    };
  };

  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType !== 'classes') return [];
    if (query.nextClassId__eq === TARGET_ID) {
      return [{
        id: PREVIOUS_ID,
        orgId: ORG_ID,
        title: 'EAL Cycle 1',
        cycleNo: 1,
        nextClassId: TARGET_ID
      }];
    }
    if (query.previousClassId__eq === TARGET_ID) {
      return [{
        id: NEXT_ID,
        orgId: ORG_ID,
        title: 'EAL Cycle 3',
        cycleNo: 3,
        previousClassId: TARGET_ID
      }];
    }
    return [];
  };

  try {
    const snapshot = await classCycleLinkResolutionService.collectCycleLinkBlockers(TARGET_ID, REQ_USER);
    assert.equal(snapshot.blockerCount, 2);
    assert.equal(snapshot.previousCycles.length, 1);
    assert.equal(snapshot.nextCycles.length, 1);
    assert.equal(snapshot.previousCycles[0].linkType, 'incoming_next');
    assert.equal(snapshot.nextCycles[0].linkType, 'incoming_previous');
    assert.equal(snapshot.previousCycles[0].fieldToClear, 'nextClassId');
    assert.equal(snapshot.nextCycles[0].fieldToClear, 'previousClassId');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetch;
  }
});

test('unlinkCycleReference clears inbound nextClassId on previous cycle', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalFetch = schoolDataService.fetchData;
  const originalUpdate = schoolDataService.updateData;

  const classes = new Map([
    [TARGET_ID, { id: TARGET_ID, orgId: ORG_ID, title: 'Cycle 2', previousClassId: PREVIOUS_ID, nextClassId: '' }],
    [PREVIOUS_ID, { id: PREVIOUS_ID, orgId: ORG_ID, title: 'Cycle 1', cycleNo: 1, nextClassId: TARGET_ID }]
  ]);

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType !== 'classes') return null;
    return classes.get(id) || null;
  };
  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType !== 'classes') return [];
    if (query.nextClassId__eq === TARGET_ID) {
      const row = classes.get(PREVIOUS_ID);
      return row && String(row.nextClassId || '') === TARGET_ID ? [row] : [];
    }
    if (query.previousClassId__eq === TARGET_ID) {
      const row = classes.get(NEXT_ID);
      return row && String(row.previousClassId || '') === TARGET_ID ? [row] : [];
    }
    return [];
  };
  schoolDataService.updateData = async (entityType, id, patch) => {
    if (entityType !== 'classes') return null;
    const existing = classes.get(id) || {};
    const updated = { ...existing, ...patch };
    classes.set(id, updated);
    return updated;
  };

  try {
    const result = await classCycleLinkResolutionService.unlinkCycleReference({
      targetClassId: TARGET_ID,
      referencingClassId: PREVIOUS_ID,
      linkType: 'incoming_next',
      reqUser: REQ_USER
    });
    assert.equal(classes.get(PREVIOUS_ID).nextClassId, '');
    assert.equal(classes.get(TARGET_ID).previousClassId, '');
    assert.equal(result.blockerCount, 0);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetch;
    schoolDataService.updateData = originalUpdate;
  }
});

test('cycle delete blocker sample href points to delete preparation page', () => {
  const row = { id: PREVIOUS_ID, title: 'EAL Cycle 1' };
  const href = SECTION_HREFS.deletePreparation(TARGET_ID, PREVIOUS_ID);
  const [sample] = samplesFromRows([row], null, () => href);
  assert.match(sample.href, /\/school\/classes\/CLASS%2FCYCLE-2\/delete-preparation\?/);
  assert.match(sample.href, /focus=CLASS%2FCYCLE-1/);
  assert.doesNotMatch(sample.href, /\/classes\/edit\//);
});

test('clearInboundCycleReferencesForClassDelete clears previous cycle nextClassId', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalFetch = schoolDataService.fetchData;
  const originalUpdate = schoolDataService.updateData;

  const classes = new Map([
    [TARGET_ID, { id: TARGET_ID, orgId: ORG_ID, title: 'Cycle 2', previousClassId: PREVIOUS_ID, nextClassId: '' }],
    [PREVIOUS_ID, { id: PREVIOUS_ID, orgId: ORG_ID, title: 'Cycle 1', cycleNo: 1, nextClassId: TARGET_ID }]
  ]);

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType !== 'classes') return null;
    return classes.get(id) || null;
  };
  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType !== 'classes') return [];
    if (query.nextClassId__eq === TARGET_ID) {
      const row = classes.get(PREVIOUS_ID);
      return row && String(row.nextClassId || '') === TARGET_ID ? [row] : [];
    }
    if (query.previousClassId__eq === TARGET_ID) return [];
    return [];
  };
  schoolDataService.updateData = async (entityType, id, patch) => {
    if (entityType !== 'classes') return null;
    const existing = classes.get(id) || {};
    const updated = { ...existing, ...patch };
    classes.set(id, updated);
    return updated;
  };

  try {
    const result = await classCycleLinkResolutionService.clearInboundCycleReferencesForClassDelete(TARGET_ID, REQ_USER);
    assert.equal(result.cleared, 1);
    assert.equal(classes.get(PREVIOUS_ID).nextClassId, '');
    assert.equal(classes.get(TARGET_ID).previousClassId, '');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetch;
    schoolDataService.updateData = originalUpdate;
  }
});

test('class delete registry uses downstream cycle scanner only for cycle links', () => {
  const source = read('MVC/services/school/schoolDeletionRuleRegistry.js');
  assert.match(source, /scanClassDownstreamCycle/);
  assert.match(source, /code: 'CLASS_DOWNSTREAM_CYCLE'/);
  assert.doesNotMatch(source, /code: 'CLASS_NEXT'/);
  assert.doesNotMatch(source, /code: 'CLASS_PREVIOUS'/);
  assert.match(source, /Open delete preparation to remove downstream cycles/);
});

test('delete blocked modal renders cycle resolver action', () => {
  const mainScript = read('../../public/scripts/main.js');
  assert.match(mainScript, /delete-blocked-modal-action/);
  assert.match(mainScript, /Open delete preparation/);
  assert.match(mainScript, /isCycleLinkBlocker/);
});

test('class routes expose resolve cycle links and delete preparation endpoints', () => {
  const routes = read('MVC/routes/classRoutes.js');
  assert.match(routes, /resolve-cycle-links/);
  assert.match(routes, /delete-preparation/);
  assert.match(routes, /cycle-link-blockers\/unlink/);
  assert.match(routes, /cycle-link-blockers\/unlink-all/);
});
