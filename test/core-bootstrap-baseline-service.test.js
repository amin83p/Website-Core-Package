const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const coreBootstrapBaselineService = require('../MVC/services/coreBootstrapBaselineService');
const dataService = require('../MVC/services/dataService');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const coreFilesService = require('../MVC/services/coreFilesService');

function withTempRunPath() {
  const original = process.env.CORE_BOOTSTRAP_RUN_DATA_PATH;
  const tempPath = path.join(os.tmpdir(), `core-bootstrap-runs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  process.env.CORE_BOOTSTRAP_RUN_DATA_PATH = tempPath;
  return () => {
    if (original === undefined) delete process.env.CORE_BOOTSTRAP_RUN_DATA_PATH;
    else process.env.CORE_BOOTSTRAP_RUN_DATA_PATH = original;
    try { fs.unlinkSync(tempPath); } catch (_) {}
  };
}

async function createTempBaselineRoot(config = {}) {
  const root = path.join(os.tmpdir(), `core-bootstrap-baseline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fsp.mkdir(path.join(root, 'assets'), { recursive: true });

  const entityFiles = [
    'sections.json',
    'operations.json',
    'roles.json',
    'scopes.json',
    'symbols.json',
    'accesses.json',
    'accessPolicies.json'
  ];

  for (const file of entityFiles) {
    await fsp.writeFile(path.join(root, file), '[]');
  }
  await fsp.writeFile(path.join(root, 'systemSettings.defaults.json'), '{}');

  const manifest = {
    id: 'test-baseline',
    version: '1.0.0',
    entities: [
      { entityType: 'sections', file: 'sections.json', identityFields: ['id', 'name'] },
      { entityType: 'operations', file: 'operations.json', identityFields: ['id', 'name'] },
      { entityType: 'roles', file: 'roles.json', identityFields: ['id', 'key'] },
      { entityType: 'scopes', file: 'scopes.json', identityFields: ['id', 'name'] },
      { entityType: 'symbols', file: 'symbols.json', identityFields: ['id', 'name', 'orgId'] },
      { entityType: 'accesses', file: 'accesses.json', identityFields: ['id', 'name', 'orgId'] },
      { entityType: 'accessPolicies', file: 'accessPolicies.json', identityFields: ['id', 'userId', 'orgId', 'sectionId', 'operationId'] }
    ],
    systemSettingsDefaults: { file: 'systemSettings.defaults.json' },
    assets: Array.isArray(config.assets) ? config.assets : []
  };
  await fsp.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));

  if (Array.isArray(config.files)) {
    for (const file of config.files) {
      const target = path.join(root, 'assets', file.relativePath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, file.content || '');
    }
  }

  return root;
}

async function removeDirSafe(dirPath = '') {
  if (!dirPath) return;
  await fsp.rm(dirPath, { recursive: true, force: true });
}

test('core bootstrap baseline bundle loads with expected security entities', async () => {
  const bundle = await coreBootstrapBaselineService.loadBaselineBundle();
  assert.equal(bundle.baselineId.length > 0, true);
  const entities = bundle.entities.map((row) => row.entityType);
  assert.deepEqual(entities, [
    'sections',
    'operations',
    'roles',
    'scopes',
    'symbols',
    'accesses',
    'accessPolicies'
  ]);
  assert.equal(typeof bundle.systemSettingsDefaults.payload, 'object');
});

test('preflight reports planned creates when target entities are empty', async () => {
  const restoreRunPath = withTempRunPath();
  const originalFetchData = dataService.fetchData;

  dataService.fetchData = async () => [];

  try {
    const report = await coreBootstrapBaselineService.preflight({ backendMode: 'json', actor: { id: 'TEST_USER' } });
    assert.equal(report.action, 'preflight');
    assert.equal(report.summary.baselineRows > 0, true);
    assert.equal(report.summary.plannedCreates, report.summary.baselineRows);
    assert.equal(report.summary.conflicts, 0);
    assert.equal(Boolean(report.run?.id), true);
  } finally {
    dataService.fetchData = originalFetchData;
    restoreRunPath();
  }
});

test('apply dry-run returns structured report without mutating repositories', async () => {
  const restoreRunPath = withTempRunPath();
  const originalFetchData = dataService.fetchData;
  const originalAddData = dataService.addData;
  const originalUpdateSettings = systemSettingsRepository.updateSettings;

  let addCalls = 0;
  let updateSettingsCalls = 0;

  dataService.fetchData = async () => [];
  dataService.addData = async () => {
    addCalls += 1;
    return {};
  };
  systemSettingsRepository.updateSettings = async () => {
    updateSettingsCalls += 1;
    return {};
  };

  try {
    const report = await coreBootstrapBaselineService.apply({ backendMode: 'json', actor: { id: 'TEST_USER' }, dryRun: true });
    assert.equal(report.action, 'apply-dry-run');
    assert.equal(report.summary.created > 0, true);
    assert.equal(report.summary.failed, 0);
    assert.equal(addCalls, 0);
    assert.equal(updateSettingsCalls, 0);
    assert.equal(Boolean(report.run?.id), true);
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.addData = originalAddData;
    systemSettingsRepository.updateSettings = originalUpdateSettings;
    restoreRunPath();
  }
});

test('apply copies missing bootstrap assets and skips existing on rerun', async () => {
  const restoreRunPath = withTempRunPath();
  const baselineRoot = await createTempBaselineRoot({
    assets: [
      { source: 'logo/test-logo.txt', targetUploadRef: '/uploads/GLOBAL/logo/test-logo.txt', required: true }
    ],
    files: [
      { relativePath: 'logo/test-logo.txt', content: 'hello-logo' }
    ]
  });
  const uploadRoot = path.join(os.tmpdir(), `core-bootstrap-upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fsp.mkdir(uploadRoot, { recursive: true });

  const originalFetchData = dataService.fetchData;
  const originalAddData = dataService.addData;
  const originalUpdateSettings = systemSettingsRepository.updateSettings;
  const originalPathResolver = coreFilesService.fromUploadsUrlToDiskPath;

  dataService.fetchData = async () => [];
  dataService.addData = async () => ({});
  systemSettingsRepository.updateSettings = async () => ({});
  coreFilesService.fromUploadsUrlToDiskPath = (uploadRef = '') => {
    const relative = String(uploadRef || '').replace(/^\/uploads\//i, '');
    return relative ? path.join(uploadRoot, relative) : '';
  };

  try {
    const first = await coreBootstrapBaselineService.apply({
      backendMode: 'json',
      actor: { id: 'TEST_USER' },
      baselineRoot
    });
    assert.equal(first.assetSummary.copied, 1);
    assert.equal(first.assetSummary.skippedExisting, 0);

    const copiedFile = path.join(uploadRoot, 'GLOBAL', 'logo', 'test-logo.txt');
    assert.equal(fs.existsSync(copiedFile), true);

    const second = await coreBootstrapBaselineService.apply({
      backendMode: 'json',
      actor: { id: 'TEST_USER' },
      baselineRoot
    });
    assert.equal(second.assetSummary.copied, 0);
    assert.equal(second.assetSummary.skippedExisting, 1);
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.addData = originalAddData;
    systemSettingsRepository.updateSettings = originalUpdateSettings;
    coreFilesService.fromUploadsUrlToDiskPath = originalPathResolver;
    restoreRunPath();
    await removeDirSafe(baselineRoot);
    await removeDirSafe(uploadRoot);
  }
});

test('apply reports missing source assets without crashing', async () => {
  const restoreRunPath = withTempRunPath();
  const baselineRoot = await createTempBaselineRoot({
    assets: [
      { source: 'logo/missing-file.txt', targetUploadRef: '/uploads/GLOBAL/logo/missing-file.txt', required: true }
    ]
  });
  const uploadRoot = path.join(os.tmpdir(), `core-bootstrap-upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fsp.mkdir(uploadRoot, { recursive: true });

  const originalFetchData = dataService.fetchData;
  const originalAddData = dataService.addData;
  const originalUpdateSettings = systemSettingsRepository.updateSettings;
  const originalPathResolver = coreFilesService.fromUploadsUrlToDiskPath;

  dataService.fetchData = async () => [];
  dataService.addData = async () => ({});
  systemSettingsRepository.updateSettings = async () => ({});
  coreFilesService.fromUploadsUrlToDiskPath = (uploadRef = '') => {
    const relative = String(uploadRef || '').replace(/^\/uploads\//i, '');
    return relative ? path.join(uploadRoot, relative) : '';
  };

  try {
    const report = await coreBootstrapBaselineService.apply({
      backendMode: 'json',
      actor: { id: 'TEST_USER' },
      baselineRoot
    });
    assert.equal(report.assetSummary.missingSource, 1);
    assert.equal(Array.isArray(report.warnings), true);
    assert.equal(report.warnings.length > 0, true);
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.addData = originalAddData;
    systemSettingsRepository.updateSettings = originalUpdateSettings;
    coreFilesService.fromUploadsUrlToDiskPath = originalPathResolver;
    restoreRunPath();
    await removeDirSafe(baselineRoot);
    await removeDirSafe(uploadRoot);
  }
});

test('manifest asset validation rejects traversal source and invalid upload target', async () => {
  const restoreRunPath = withTempRunPath();
  const badSourceRoot = await createTempBaselineRoot({
    assets: [
      { source: '../escape.txt', targetUploadRef: '/uploads/GLOBAL/logo/escape.txt', required: true }
    ]
  });
  const badTargetRoot = await createTempBaselineRoot({
    assets: [
      { source: 'logo/ok.txt', targetUploadRef: '/not-uploads/ok.txt', required: true }
    ],
    files: [
      { relativePath: 'logo/ok.txt', content: 'ok' }
    ]
  });

  try {
    await assert.rejects(
      () => coreBootstrapBaselineService.loadBaselineBundle({ baselineRoot: badSourceRoot }),
      /Invalid baseline asset source path|escapes root/
    );
    await assert.rejects(
      () => coreBootstrapBaselineService.loadBaselineBundle({ baselineRoot: badTargetRoot }),
      /targetUploadRef must be a valid \/uploads path/
    );
  } finally {
    restoreRunPath();
    await removeDirSafe(badSourceRoot);
    await removeDirSafe(badTargetRoot);
  }
});
