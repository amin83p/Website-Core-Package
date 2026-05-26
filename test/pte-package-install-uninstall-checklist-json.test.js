const test = require('node:test');
const assert = require('node:assert/strict');

const { createService } = require('../MVC/services/systemSettingsPackageManagerService');

function createDirent(name) {
  return {
    name,
    isDirectory: () => true
  };
}

function createPteManifest(overrides = {}) {
  return {
    id: 'pte',
    name: 'PTE',
    version: '1.0.0',
    mountPath: '/pte',
    routes: [],
    queryExecutors: [],
    views: {},
    assets: {},
    operations: [{ name: 'PTE_TEST' }],
    roles: [{ key: 'pte_student', label: 'PTE Student' }],
    sections: [{ name: 'PTE', category: 'PTE', operations: [] }],
    symbols: [{ name: 'PTE', type: 'class', value: 'bi bi-box' }],
    accesses: [{ name: 'PTE_APPLICANT', sections: [] }],
    uploadFolders: [
      { key: 'pte.questionBank', defaultTemplate: 'PTE/Question_Bank', applyDefault: true },
      { key: 'pte.students', defaultTemplate: 'PTE/Students', applyDefault: true },
      { key: 'pte.practiceAttempt', defaultTemplate: 'PTE/Practice_By_Skills/{userId}/{practiceName}/{sessionId}/{itemId}', applyDefault: true },
      { key: 'pte.mockExamAttempt', defaultTemplate: 'PTE/Mock_Exams/{userId}/{testName}/{sessionId}/{itemId}', applyDefault: true },
      { key: 'pte.packageAssets', defaultTemplate: 'PTE/Package_Assets', applyDefault: true }
    ],
    quotaDefinitions: [],
    settings: [],
    menuEntries: [],
    dashboardEntries: [],
    seeders: [],
    migrations: [],
    dependencies: [],
    ...overrides
  };
}

function createChecklistDeps() {
  const registry = new Map();
  const transactions = [];
  const previewMap = new Map();
  const manifest = createPteManifest();
  let txCounter = 1;

  return {
    deps: {
      fs: {
        async readdir() { return [createDirent('pte')]; },
        async access() {},
        async readFile() { return JSON.stringify(manifest); }
      },
      packageManifestService: {
        validatePackageManifest(raw) { return raw; }
      },
      packageRegistryService: {
        async listPackageRegistry() {
          return [...registry.values()].map((row) => ({ ...row }));
        },
        async getPackageRegistryById(packageId) {
          return registry.get(String(packageId || '').toLowerCase()) || null;
        },
        async upsertPackageRegistry(input = {}) {
          const row = {
            id: input.packageId,
            packageId: input.packageId,
            version: input.version || '',
            enabled: input.enabled === true,
            installStatus: input.installStatus || (input.enabled ? 'enabled' : 'disabled'),
            metadata: input.metadata || {},
            updatedAt: new Date().toISOString()
          };
          registry.set(row.packageId, row);
          return { ...row };
        },
        async setPackageEnabled(packageId, enabled) {
          const key = String(packageId || '').toLowerCase();
          const current = registry.get(key) || { packageId: key, id: key, version: '', metadata: {} };
          const next = {
            ...current,
            enabled: enabled === true,
            installStatus: enabled ? 'enabled' : 'disabled',
            updatedAt: new Date().toISOString()
          };
          registry.set(key, next);
          return { ...next };
        },
        async removePackageRegistry(packageId) {
          const key = String(packageId || '').toLowerCase();
          const existed = registry.has(key);
          registry.delete(key);
          return existed;
        }
      },
      packageRegistryInstallerService: {
        async installPackageRegistryDeclarations(context = {}) {
          return {
            packageId: context.packageId,
            entities: {
              operations: { requested: 1, created: 1, updated: 0, deactivated: 0, removed: 0, skipped: 0, failed: 0 },
              roles: { requested: 1, created: 1, updated: 0, deactivated: 0, removed: 0, skipped: 0, failed: 0 },
              sections: { requested: 1, created: 1, updated: 0, deactivated: 0, removed: 0, skipped: 0, failed: 0 },
              symbols: { requested: 1, created: 1, updated: 0, deactivated: 0, removed: 0, skipped: 0, failed: 0 },
              accesses: { requested: 1, created: 1, updated: 0, deactivated: 0, removed: 0, skipped: 0, failed: 0 }
            },
            uploadFolders: {
              requested: 5,
              definitionsRegistered: 5,
              definitionsRemoved: 0,
              valuesApplied: 5,
              valuesCleared: 0,
              skipped: 0,
              failed: 0,
              settingsUpdated: true
            },
            results: []
          };
        },
        async removePackageRegistryDeclarations(context = {}, options = {}) {
          const isRemove = String(options?.action || '').toLowerCase() === 'remove';
          return {
            packageId: context.packageId,
            entities: {},
            uploadFolders: {
              requested: 5,
              definitionsRegistered: 0,
              definitionsRemoved: isRemove ? 5 : 0,
              valuesApplied: 0,
              valuesCleared: 5,
              skipped: 0,
              failed: 0,
              settingsUpdated: true
            },
            results: []
          };
        },
        createLoaderHooks() {
          return {
            async registerRoutes() { return { requested: 0, mounted: 0, failed: 0 }; },
            async registerViews() { return { requested: 0, registered: 0, failed: 0 }; },
            async registerAssets() { return { requested: 0, mounted: 0, failed: 0 }; },
            async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
          };
        }
      },
      packageLoaderService: {
        async resolveManifestPath(packageId) { return `packages/${packageId}/package.manifest.json`; },
        async readManifestFile() { return manifest; }
      },
      packageNavigationService: {
        async refreshNavigationRegistry() {
          return { packages: [...registry.values()] };
        }
      },
      packageDataLifecycleService: {
        async runPackageDataInstallLifecycle() {
          return {
            dataSummary: {
              migrations: { applied: 0, skipped: 0, failed: 0 },
              seeders: { applied: 0, skipped: 0, failed: 0 }
            },
            appliedSteps: [],
            skippedSteps: [],
            failedStep: null,
            rollbackApplied: false,
            warnings: []
          };
        },
        async runPackageDataUpgradeLifecycle() {
          return {
            dataSummary: {
              migrations: { applied: 0, skipped: 0, failed: 0 },
              seeders: { applied: 0, skipped: 0, failed: 0 }
            },
            appliedSteps: [],
            skippedSteps: [],
            failedStep: null,
            rollbackApplied: false,
            warnings: []
          };
        },
        async previewPackageDataUninstallImpact(context = {}) {
          return previewMap.get(context.packageId) || {
            blocked: false,
            blockedReasons: [],
            modifiedRecords: [],
            dataImpact: { ownershipCount: 0, modifiedCount: 0 },
            warnings: []
          };
        },
        async runPackageDataUninstallLifecycle(_context = {}, options = {}) {
          const force = options.force === true;
          return {
            dataSummary: {
              migrations: { applied: force ? 0 : 0, skipped: force ? 0 : 1, failed: 0 },
              seeders: { applied: 0, skipped: force ? 0 : 0, failed: 0 }
            },
            appliedSteps: [],
            skippedSteps: force ? [] : [{ stepId: 'data-uninstall', stepType: 'migration', direction: 'down', status: 'skipped', reason: 'safe_mode_keep_data' }],
            failedStep: null,
            rollbackApplied: false,
            dataImpact: { ownershipCount: 0, modifiedCount: 0 },
            warnings: force ? [] : ['Safe uninstall mode keeps package business data.']
          };
        }
      },
      packageLifecycleTransactionService: {
        hashPayload(value) {
          return JSON.stringify(value === undefined ? null : value);
        },
        summarizeEntityOperations(entityOperations = []) {
          const summary = {};
          entityOperations.forEach((row) => {
            const entityType = String(row?.entityType || 'other').toLowerCase();
            const operation = String(row?.operation || 'recorded').toLowerCase();
            summary[entityType] = summary[entityType] || {};
            summary[entityType][operation] = Number(summary[entityType][operation] || 0) + 1;
          });
          return summary;
        },
        async startTransaction(input = {}) {
          const id = input.transactionId || `TXN_${txCounter++}`;
          const row = {
            id,
            packageId: String(input.packageId || '').toLowerCase(),
            action: input.action || 'unknown',
            status: 'running',
            artifacts: input.artifacts || {},
            metadata: input.metadata || {},
            entityOperations: [],
            summaryByEntity: {},
            startedAt: new Date().toISOString()
          };
          transactions.push(row);
          return row;
        },
        async markPhase(transactionId, phaseName, status, details = {}) {
          const row = transactions.find((item) => item.id === transactionId);
          if (row) {
            row.phase = String(phaseName || '');
            row.phaseStatus = String(status || '');
            row.phaseDetails = details;
          }
          return row || null;
        },
        async appendEntityOperations(transactionId, rows = []) {
          const row = transactions.find((item) => item.id === transactionId);
          if (row) {
            row.entityOperations = [...(row.entityOperations || []), ...rows];
            row.summaryByEntity = this.summarizeEntityOperations(row.entityOperations);
          }
          return row || null;
        },
        async completeTransaction(transactionId, patch = {}) {
          const row = transactions.find((item) => item.id === transactionId);
          if (!row) return null;
          row.status = patch.status || row.status;
          row.phase = patch.phase || row.phase;
          row.warnings = patch.warnings || [];
          row.blockedReasons = patch.blockedReasons || [];
          row.modifiedRecords = patch.modifiedRecords || [];
          row.artifacts = { ...(row.artifacts || {}), ...(patch.artifacts || {}) };
          row.summaryByEntity = patch.summaryByEntity || row.summaryByEntity || {};
          row.finishedAt = new Date().toISOString();
          return row;
        },
        async listPackageTransactions(packageId) {
          const token = String(packageId || '').toLowerCase();
          return transactions.filter((row) => row.packageId === token).map((row) => ({ ...row }));
        },
        async getTransactionById(transactionId) {
          const row = transactions.find((item) => item.id === transactionId);
          return row ? { ...row } : null;
        }
      },
      operationRepository: { async getByName() { return null; } },
      roleRepository: { async getByKey() { return null; } },
      sectionRepository: { async getByName() { return null; } },
      symbolRepository: { async list() { return []; } },
      accessRepository: { async list() { return []; } },
      systemSettingsRepository: {
        async getSettings() { return { app: { uploadFolders: {} } }; }
      },
      uploadFolderSettingsService: {
        getUploadFolderDefinitions() { return []; }
      }
    },
    previewMap
  };
}

test('checklist current-state precondition: PTE manifest has no migrations or seeders', async () => {
  const { deps } = createChecklistDeps();
  const service = createService(deps);
  const snapshot = await service.listPackageSnapshot({ backendMode: 'json' });
  const pteLocal = snapshot.localManifests.find((row) => row.packageId === 'pte');
  assert.ok(pteLocal, 'pte local manifest should be discoverable');
  assert.equal(pteLocal.valid, true);
  assert.equal(snapshot.installedPackages.length, 0);
});

test('checklist scenario install returns expected current-state lifecycle fields', async () => {
  const { deps } = createChecklistDeps();
  const service = createService(deps);
  const report = await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });

  assert.equal(report.packageId, 'pte');
  assert.equal(report.registry.enabled, true);
  assert.equal(report.registry.installStatus, 'enabled');
  assert.equal(typeof report.declarationSummary, 'object');
  assert.equal(report.dataSummary.migrations.applied, 0);
  assert.equal(report.dataSummary.migrations.skipped, 0);
  assert.equal(report.dataSummary.migrations.failed, 0);
  assert.equal(report.dataSummary.seeders.applied, 0);
  assert.equal(report.dataSummary.seeders.skipped, 0);
  assert.equal(report.dataSummary.seeders.failed, 0);
  assert.deepEqual(report.appliedSteps, []);
  assert.deepEqual(report.skippedSteps, []);
  assert.equal(report.failedStep, null);
  assert.equal(report.rollbackApplied, false);
  assert.ok(report.transactionId);
});

test('checklist scenario uninstall preview clean-state returns non-blocking report', async () => {
  const { deps } = createChecklistDeps();
  const service = createService(deps);
  await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });

  const report = await service.previewPackageUninstallImpact('pte', { backendMode: 'json' });
  assert.equal(report.packageId, 'pte');
  assert.equal(report.blocked, false);
  assert.deepEqual(report.modifiedRecords, []);
  assert.deepEqual(report.blockedReasons, []);
  assert.ok(report.previewTransactionId);
  assert.equal(typeof report.summaryByEntity, 'object');
  assert.equal(typeof report.dataImpact, 'object');
});

test('checklist scenario default remove is safe and idempotent', async () => {
  const { deps } = createChecklistDeps();
  const service = createService(deps);
  await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });

  const first = await service.removePackage('pte', { backendMode: 'json' });
  assert.equal(first.action, 'remove');
  assert.equal(first.registry.removed, true);
  assert.equal(first.restartRecommended, true);
  assert.equal(typeof first.dataSummary, 'object');
  assert.equal(first.failedStep, null);
  assert.equal(first.rollbackApplied, false);

  const second = await service.removePackage('pte', { backendMode: 'json' });
  assert.equal(second.registry.removed, false);
});

test('checklist scenario reinstall after remove returns install success', async () => {
  const { deps } = createChecklistDeps();
  const service = createService(deps);
  await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });
  await service.removePackage('pte', { backendMode: 'json' });

  const report = await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });

  assert.equal(report.action, 'install');
  assert.equal(report.packageId, 'pte');
  assert.equal(report.dataSummary.migrations.applied, 0);
  assert.equal(report.dataSummary.seeders.applied, 0);
});

test('checklist scenario force-remove requires preview token binding and valid force token', async () => {
  const { deps, previewMap } = createChecklistDeps();
  previewMap.set('pte', {
    blocked: true,
    blockedReasons: ['Detected customized package-owned records modified since install baseline.'],
    modifiedRecords: [{ entityType: 'sections', identityKey: 'name:PTE' }],
    dataImpact: { ownershipCount: 0, modifiedCount: 0 },
    warnings: []
  });
  const service = createService(deps);
  await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });

  await assert.rejects(
    () => service.removePackage('pte', {
      backendMode: 'json',
      force: true,
      forceToken: 'WRONG TOKEN',
      previewTransactionId: 'TXN_PREVIEW_BAD',
      preview: {
        blocked: true,
        blockedReasons: ['customized'],
        modifiedRecords: [{ entityType: 'sections', identityKey: 'name:PTE' }],
        previewTransactionId: 'TXN_PREVIEW_BAD'
      }
    }),
    /token mismatch/i
  );
});

test('checklist scenario transactions list/detail include lifecycle rows', async () => {
  const { deps } = createChecklistDeps();
  const service = createService(deps);
  const install = await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });
  await service.previewPackageUninstallImpact('pte', { backendMode: 'json' });
  await service.removePackage('pte', { backendMode: 'json' });

  const rows = await service.listPackageTransactions('pte', { backendMode: 'json' });
  assert.equal(rows.length > 0, true);
  const detail = await service.getPackageTransactionById(install.transactionId, { backendMode: 'json' });
  assert.ok(detail, 'transaction detail should exist');
});

