const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const packageSectionSyncService = require('../MVC/services/packageSectionSyncService');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMemorySectionRepository(initialRows = []) {
  const rows = clone(initialRows);
  return {
    list: async () => clone(rows),
    getByName: async (name) => clone(rows.find((row) => row.name === name) || null),
    create: async (payload = {}) => {
      const row = clone(payload);
      if (!row.id) row.id = `SEC${rows.length + 1}`;
      rows.push(row);
      return clone(row);
    },
    update: async (id, payload = {}) => {
      const index = rows.findIndex((row) => String(row.id) === String(id));
      if (index < 0) throw new Error(`Row not found: ${id}`);
      rows[index] = clone({ ...rows[index], ...payload, id: rows[index].id });
      return clone(rows[index]);
    },
    getRows: () => clone(rows)
  };
}

const manifest = {
  id: 'school',
  name: 'School',
  version: '1.0.0',
  mountPath: '/school',
  sections: [{
    id: '445571',
    name: 'ZZZ_TEST_SECTION_SYNC',
    category: 'SCHOOL',
    description: 'Reports',
    active: true,
    trackState: false,
    minimumAccessRequirement: 5,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection: true,
    homeURL: '/school/reports',
    inactiveMessage: '',
    message: '',
    operations: [],
    subsections: [{ id: '446101' }],
    related: [],
    adoptExisting: true
  }]
};

const runtimeSection = {
  id: '445571',
  name: 'ZZZ_TEST_SECTION_SYNC',
  category: 'SCHOOL',
  description: 'Reports',
  active: true,
  trackState: false,
  minimumAccessRequirement: 5,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: true,
  homeURL: '',
  inactiveMessage: '',
  message: '',
  operations: [],
  subsections: [{ id: '446101' }],
  related: [],
  packageId: 'school',
  packageName: 'SCHOOL'
};

test('buildSectionSyncPreview detects homeURL drift', async () => {
  const sectionRepository = createMemorySectionRepository([runtimeSection]);
  const service = packageSectionSyncService.createService({ sectionRepository });
  const preview = await service.buildSectionSyncPreview({
    packageId: 'school',
    packageName: 'School',
    manifest
  });
  const row = preview.packageSections.find((entry) => entry.name === 'ZZZ_TEST_SECTION_SYNC');
  assert.ok(row);
  assert.equal(row.status, 'drift');
  assert.ok(row.driftedFields.includes('homeURL'));
  assert.equal(preview.sections.length, preview.packageSections.length);
});

test('buildSectionSyncPreview omits app-only sections from listed package sections', async () => {
  const sectionRepository = createMemorySectionRepository([
    runtimeSection,
    {
      id: '999001',
      name: 'APP_ONLY_SECTION',
      category: 'SCHOOL',
      active: true,
      homeURL: '/school/orphan',
      packageId: 'school'
    }
  ]);
  const service = packageSectionSyncService.createService({ sectionRepository });
  const preview = await service.buildSectionSyncPreview({
    packageId: 'school',
    packageName: 'School',
    manifest
  });
  assert.equal(preview.summary.runtimeOnlyHidden, 1);
  assert.equal(preview.packageSections.some((entry) => entry.name === 'APP_ONLY_SECTION'), false);
  assert.equal(preview.packageSections.some((entry) => entry.name === 'ZZZ_TEST_SECTION_SYNC'), true);
});

test('applySectionsFromManifest updates runtime section fields', async () => {
  const sectionRepository = createMemorySectionRepository([runtimeSection]);
  const service = packageSectionSyncService.createService({ sectionRepository });
  const result = await service.applySectionsFromManifest(
    { packageId: 'school', packageName: 'School', manifest },
    ['ZZZ_TEST_SECTION_SYNC'],
    { includeTopology: true }
  );
  assert.equal(result.updated, 1);
  const updated = sectionRepository.getRows().find((row) => row.name === 'ZZZ_TEST_SECTION_SYNC');
  assert.equal(updated.homeURL, '/school/reports');
});

test('applySectionsToManifest writes runtime values into manifest file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-section-sync-'));
  const manifestPath = path.join(tempDir, 'package.manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const sectionRepository = createMemorySectionRepository([runtimeSection]);
  const service = packageSectionSyncService.createService({ sectionRepository });
  const result = await service.applySectionsToManifest(
    {
      packageId: 'school',
      packageName: 'School',
      manifest,
      manifestPath
    },
    ['ZZZ_TEST_SECTION_SYNC'],
    { includeTopology: true }
  );
  assert.equal(result.updated, 1);
  const saved = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const row = saved.sections.find((entry) => entry.name === 'ZZZ_TEST_SECTION_SYNC');
  assert.equal(row.homeURL, '');
});

test('applySectionsToManifest rejects missing writable manifest path', async () => {
  const sectionRepository = createMemorySectionRepository([runtimeSection]);
  const service = packageSectionSyncService.createService({ sectionRepository });
  await assert.rejects(
    () => service.applySectionsToManifest(
      {
        packageId: 'school',
        packageName: 'School',
        manifest,
        manifestPath: ''
      },
      ['ZZZ_TEST_SECTION_SYNC']
    ),
    /Manifest path is not configured/
  );
});

test('buildSectionSyncBackup exports manifest and runtime sections', async () => {
  const sectionRepository = createMemorySectionRepository([runtimeSection]);
  const service = packageSectionSyncService.createService({ sectionRepository });
  const backup = await service.buildSectionSyncBackup({
    packageId: 'school',
    packageName: 'School',
    manifest
  });
  assert.equal(backup.format, packageSectionSyncService.SECTION_SYNC_BACKUP_FORMAT);
  assert.equal(backup.packageId, 'school');
  assert.equal(backup.manifestSections.length, 1);
  assert.equal(backup.runtimeSections.length, 1);
  assert.equal(backup.runtimeSections[0].homeURL, '');
});

test('restoreSectionSyncBackup rolls back runtime and manifest sections', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-section-sync-restore-'));
  const manifestPath = path.join(tempDir, 'package.manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const sectionRepository = createMemorySectionRepository([{
    ...runtimeSection,
    homeURL: '/school/wrong'
  }]);
  const service = packageSectionSyncService.createService({ sectionRepository });
  const backup = await service.buildSectionSyncBackup({
    packageId: 'school',
    packageName: 'School',
    manifest,
    manifestPath
  });
  backup.runtimeSections[0].homeURL = '';
  backup.manifestSections[0].homeURL = '/school/reports';
  const result = await service.restoreSectionSyncBackup(
    {
      packageId: 'school',
      packageName: 'School',
      manifest,
      manifestPath
    },
    backup,
    { includeTopology: true }
  );
  assert.equal(result.runtimeUpdated, 1);
  const restoredRuntime = sectionRepository.getRows().find((row) => row.name === 'ZZZ_TEST_SECTION_SYNC');
  assert.equal(restoredRuntime.homeURL, '');
  const savedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const restoredManifestRow = savedManifest.sections.find((entry) => entry.name === 'ZZZ_TEST_SECTION_SYNC');
  assert.equal(restoredManifestRow.homeURL, '/school/reports');
});
