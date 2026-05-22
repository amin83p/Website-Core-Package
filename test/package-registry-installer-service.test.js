const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const packageRegistryInstallerService = require('../MVC/services/packageRegistryInstallerService');
const packageManifestService = require('../MVC/services/packageManifestService');
const packageRouteService = require('../MVC/services/packageRouteService');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeComparable(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function matchesEqQuery(row = {}, query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  return Object.entries(source).every(([key, expected]) => {
    if (!key.endsWith('__eq')) return true;
    const field = key.slice(0, -4);
    return normalizeComparable(row?.[field]) === normalizeComparable(expected);
  });
}

function createMemoryRepository(initialRows = [], options = {}) {
  const rows = clone(initialRows);
  let seq = 1;
  const idPrefix = String(options.idPrefix || 'ROW');

  return {
    list: async (params = {}) => {
      const query = params?.query || {};
      const filtered = rows.filter((row) => matchesEqQuery(row, query));
      const limit = Number.isInteger(query.limit) ? query.limit : 0;
      const out = limit > 0 ? filtered.slice(0, limit) : filtered;
      return clone(out);
    },
    create: async (payload = {}) => {
      const row = clone(payload);
      if (!row.id) {
        row.id = `${idPrefix}${seq++}`;
      }
      rows.push(row);
      return clone(row);
    },
    update: async (id, payload = {}) => {
      const index = rows.findIndex((row) => String(row?.id || '') === String(id || ''));
      if (index < 0) throw new Error(`Row not found: ${id}`);
      const next = clone(payload);
      if (!next.id) next.id = rows[index].id;
      rows[index] = next;
      return clone(next);
    },
    getRows: () => clone(rows)
  };
}

function createRoleRepository(initialRows = []) {
  const base = createMemoryRepository(initialRows, { idPrefix: 'ROL' });
  return {
    ...base,
    getByKey: async (key) => {
      const token = String(key || '').trim().toLowerCase();
      const rows = base.getRows();
      return rows.find((row) => String(row?.key || '').trim().toLowerCase() === token) || null;
    }
  };
}

function createOperationRepository(initialRows = []) {
  const base = createMemoryRepository(initialRows, { idPrefix: 'OP' });
  return {
    ...base,
    getByName: async (name) => {
      const token = String(name || '').trim().toUpperCase();
      const rows = base.getRows();
      return rows.find((row) => String(row?.name || '').trim().toUpperCase() === token) || null;
    }
  };
}

function createSectionRepository(initialRows = []) {
  const base = createMemoryRepository(initialRows, { idPrefix: 'SEC' });
  return {
    ...base,
    getByName: async (name) => {
      const token = String(name || '').trim().toUpperCase();
      const rows = base.getRows();
      return rows.find((row) => String(row?.name || '').trim().toUpperCase() === token) || null;
    }
  };
}

function createUploadFolderMocks(initialDefinitions = [], initialSettings = {}) {
  const definitionMap = new Map();
  initialDefinitions.forEach((row) => {
    definitionMap.set(row.key, { ...row });
  });

  const state = {
    settings: {
      app: {
        uploadFolders: { ...(initialSettings || {}) }
      }
    },
    updates: 0,
    refreshes: 0
  };

  return {
    state,
    uploadFolderSettingsService: {
      getUploadFolderDefinitions: () => Array.from(definitionMap.values()).map((row) => ({ ...row })),
      registerUploadFolderDefinitions: (rows = []) => {
        const list = Array.isArray(rows) ? rows : [rows];
        list.forEach((row) => {
          if (definitionMap.has(row.key)) throw new Error(`Duplicate definition: ${row.key}`);
          definitionMap.set(row.key, {
            key: row.key,
            packageName: row.packageName || 'CORE',
            group: row.group || 'Core Uploads',
            label: row.label || row.key,
            defaultTemplate: row.defaultTemplate || 'misc',
            placeholders: Array.isArray(row.placeholders) ? [...row.placeholders] : []
          });
        });
      },
      sanitizeUploadFolderSettingsPatch: (patch = {}) => {
        const source = patch && typeof patch === 'object' ? patch : {};
        const out = {};
        Object.keys(source).forEach((key) => {
          if (!definitionMap.has(key)) throw new Error(`Unknown upload folder setting: ${key}`);
          out[key] = String(source[key] || '').trim();
        });
        return out;
      },
      mergeUploadFolderSettings: (...items) => {
        const merged = {};
        items.forEach((item) => {
          if (!item || typeof item !== 'object') return;
          Object.assign(merged, item);
        });
        return merged;
      }
    },
    systemSettingsRepository: {
      getSettings: async () => clone(state.settings),
      updateSettings: async (patch = {}) => {
        const next = {
          ...state.settings,
          ...patch,
          app: {
            ...(state.settings.app || {}),
            ...(patch.app || {}),
            uploadFolders: {
              ...((state.settings.app || {}).uploadFolders || {}),
              ...((patch.app || {}).uploadFolders || {})
            }
          }
        };
        state.settings = next;
        state.updates += 1;
        return clone(state.settings);
      }
    },
    settingService: {
      refresh: async () => {
        state.refreshes += 1;
      }
    }
  };
}

function createInstallerDeps(overrides = {}) {
  const uploadMocks = createUploadFolderMocks(
    [
      {
        key: 'core.fileManager',
        packageName: 'CORE',
        group: 'Core Uploads',
        label: 'File Manager',
        defaultTemplate: 'misc',
        placeholders: []
      }
    ],
    {}
  );
  const roleRepo = createRoleRepository(overrides.roles || []);
  const sectionRepo = createSectionRepository(overrides.sections || []);
  const symbolRepo = createMemoryRepository(overrides.symbols || [], { idPrefix: 'SYM' });
  const accessRepo = createMemoryRepository(overrides.accesses || [], { idPrefix: 'ACC' });
  const opRepo = createOperationRepository(overrides.operations || []);
  return {
    uploadMocks,
    deps: {
      logger: { info() {}, warn() {}, success() {}, error() {} },
      roleRepository: roleRepo,
      sectionRepository: sectionRepo,
      symbolRepository: symbolRepo,
      accessRepository: accessRepo,
      operationRepository: opRepo,
      systemSettingsRepository: uploadMocks.systemSettingsRepository,
      uploadFolderSettingsService: uploadMocks.uploadFolderSettingsService,
      settingService: uploadMocks.settingService
    },
    repos: {
      roleRepo,
      sectionRepo,
      symbolRepo,
      accessRepo,
      opRepo
    }
  };
}

test('installer creates package registry declarations and applies upload folder defaults', async () => {
  const { deps, repos, uploadMocks } = createInstallerDeps();
  const summary = await packageRegistryInstallerService.installPackageRegistryDeclarations({
    backendMode: 'json',
    packageId: 'pte',
    manifest: {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      operations: [
        { name: 'PTE_AI_SCORE', description: 'AI scoring operation', active: true }
      ],
      roles: [
        { key: 'pte_examiner', label: 'PTE Examiner', description: 'Examiner role', system: true }
      ],
      sections: [
        {
          name: 'PTE_AI_SCORING',
          category: 'SYSTEM',
          description: 'PTE AI scoring section',
          operations: [{ id: 'OP1002', sessionAttempts: 5, sessionTime: 10, active: true }]
        }
      ],
      symbols: [
        { name: 'PTE_AI_SCORING', orgId: 'SYSTEM', type: 'class', value: 'bi bi-cpu' }
      ],
      accesses: [
        { name: 'PTE_EXAMINER', orgId: null, sections: [] }
      ],
      uploadFolders: [
        { key: 'core.fileManager', template: 'misc/public-pages' },
        {
          key: 'pte.aiScoringArtifacts',
          packageName: 'PTE',
          group: 'PTE Uploads',
          label: 'PTE AI Scoring Artifacts',
          defaultTemplate: 'PTE/AI_Scoring',
          placeholders: [],
          applyDefault: true
        }
      ]
    }
  }, deps);

  assert.equal(summary.entities.operations.created, 1);
  assert.equal(summary.entities.roles.created, 1);
  assert.equal(summary.entities.sections.created, 1);
  assert.equal(summary.entities.symbols.created, 1);
  assert.equal(summary.entities.accesses.created, 1);
  assert.equal(summary.uploadFolders.definitionsRegistered, 1);
  assert.equal(summary.uploadFolders.valuesApplied, 2);
  assert.equal(summary.uploadFolders.settingsUpdated, true);

  assert.equal(repos.opRepo.getRows().length, 1);
  assert.equal(repos.roleRepo.getRows().length, 1);
  assert.equal(repos.sectionRepo.getRows().length, 1);
  assert.equal(repos.symbolRepo.getRows().length, 1);
  assert.equal(repos.accessRepo.getRows().length, 1);
  assert.equal(uploadMocks.state.settings.app.uploadFolders['core.fileManager'], 'misc/public-pages');
  assert.equal(uploadMocks.state.settings.app.uploadFolders['pte.aiScoringArtifacts'], 'PTE/AI_Scoring');
  assert.equal(uploadMocks.state.updates, 1);
  assert.equal(uploadMocks.state.refreshes, 1);
});

test('installer is idempotent for already-owned declarations', async () => {
  const { deps } = createInstallerDeps();
  const baseContext = {
    backendMode: 'json',
    packageId: 'pte',
    manifest: {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      operations: [{ name: 'PTE_RUNNER', description: 'Runner op' }],
      roles: [{ key: 'pte_runner', label: 'PTE Runner', description: 'Runner role' }],
      sections: [{ name: 'PTE_RUNNER', category: 'SYSTEM', description: 'Runner section', operations: [] }],
      symbols: [{ name: 'PTE_RUNNER', orgId: 'SYSTEM', type: 'class', value: 'bi bi-play' }],
      accesses: [{ name: 'PTE_RUNNER', orgId: null, sections: [] }]
    }
  };

  const first = await packageRegistryInstallerService.installPackageRegistryDeclarations(baseContext, deps);
  const second = await packageRegistryInstallerService.installPackageRegistryDeclarations(baseContext, deps);

  assert.equal(first.entities.operations.created, 1);
  assert.equal(second.entities.operations.created, 0);
  assert.equal(second.entities.operations.updated + second.entities.operations.skipped, 1);
  assert.equal(second.entities.roles.updated + second.entities.roles.skipped, 1);
  assert.equal(second.entities.sections.updated + second.entities.sections.skipped, 1);
  assert.equal(second.entities.symbols.updated + second.entities.symbols.skipped, 1);
  assert.equal(second.entities.accesses.updated + second.entities.accesses.skipped, 1);
});

test('installer protects ownership boundaries and supports explicit adoption', async () => {
  const { deps, repos } = createInstallerDeps({
    operations: [{ id: 'OP1001', name: 'READ', packageId: 'core', packageName: 'CORE', active: true }],
    roles: [{ id: 'ROL1001', key: 'pte_teacher', label: 'PTE Teacher', packageName: 'PTE', domain: 'pte', active: true, system: false, aliases: [] }]
  });

  const summary = await packageRegistryInstallerService.installPackageRegistryDeclarations({
    backendMode: 'json',
    packageId: 'school',
    manifest: {
      id: 'school',
      name: 'School',
      version: '1.0.0',
      mountPath: '/school',
      operations: [
        { name: 'READ', description: 'Should skip because owned by CORE' }
      ],
      roles: [
        { key: 'pte_teacher', label: 'Owned manually, should skip unmanaged by default' },
        { key: 'school_teacher', label: 'School Teacher', adoptExisting: true }
      ]
    }
  }, deps);

  assert.equal(summary.entities.operations.skipped, 1);
  assert.equal(summary.entities.roles.skipped >= 1, true);

  // Add explicit adoption attempt on existing unmanaged role.
  const adoptSummary = await packageRegistryInstallerService.installPackageRegistryDeclarations({
    backendMode: 'json',
    packageId: 'school',
    manifest: {
      id: 'school',
      name: 'School',
      version: '1.0.0',
      mountPath: '/school',
      roles: [
        { key: 'pte_teacher', label: 'Adopted', adoptExisting: true }
      ]
    }
  }, deps);

  assert.equal(adoptSummary.entities.roles.updated, 1);
  const adopted = repos.roleRepo.getRows().find((row) => row.key === 'pte_teacher');
  assert.equal(adopted.packageId, 'school');
});

test('real PTE manifest validates and exercises installer declarations + default-path install', async () => {
  const { deps, uploadMocks } = createInstallerDeps();
  const manifestPath = path.resolve(__dirname, '../packages/pte/package.manifest.json');
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const manifest = packageManifestService.validatePackageManifest(raw, { knownIds: [] });

  const summary = await packageRegistryInstallerService.installPackageRegistryDeclarations({
    backendMode: 'json',
    packageId: 'pte',
    manifest
  }, deps);

  assert.equal(manifest.id, 'pte');
  assert.equal(summary.entities.operations.requested > 0, true);
  assert.equal(summary.entities.roles.requested > 0, true);
  assert.equal(summary.entities.sections.requested > 0, true);
  assert.equal(summary.entities.symbols.requested > 0, true);
  assert.equal(summary.entities.accesses.requested > 0, true);
  assert.equal(summary.uploadFolders.requested > 0, true);
  assert.equal(summary.uploadFolders.definitionsRegistered >= 1, true);
  assert.equal(summary.uploadFolders.valuesApplied >= 1, true);
  assert.equal(uploadMocks.state.settings.app.uploadFolders['pte.packageAssets'], 'PTE/Package_Assets');
});

test('loader hooks include route registration and keep metadata-only routes non-mounted', async () => {
  packageRouteService.resetMountedRoutes();
  const hooks = packageRegistryInstallerService.createLoaderHooks({
    logger: { info() {}, warn() {}, success() {}, error() {} }
  });

  const app = {
    calls: [],
    use(...args) {
      this.calls.push(args);
    }
  };

  const summary = await hooks.registerRoutes({
    app,
    packageId: 'pte',
    manifest: {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [
        {
          method: 'USE',
          path: '/pte',
          router: 'MVC/routes/pte/pteMainRoute.js',
          metadataOnly: true
        },
        {
          method: 'GET',
          path: '/pte/test-info',
          controller: 'MVC/controllers/pte/infoController.showPteTestInfo',
          metadataOnly: true
        }
      ]
    }
  });

  assert.equal(summary.packageId, 'pte');
  assert.equal(summary.requested, 2);
  assert.equal(summary.prepared, 2);
  assert.equal(summary.mounted, 0);
  assert.equal(summary.failed, 0);
  assert.equal(app.calls.length, 0);
});
