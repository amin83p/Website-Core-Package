const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');

const packageBuilderModule = require('../MVC/services/systemSettingsPackageBuilderService');

function withTempCwd(prefix, fn) {
  const originalCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.chdir(tempRoot);
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      process.chdir(originalCwd);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function createBaseManifest(version = '1.0.0', options = {}) {
  const includeDataEntities = options.includeDataEntities !== false;
  const manifest = {
    id: 'pte',
    name: 'PTE',
    version,
    mountPath: '/pte',
    routes: [],
    operations: [],
    roles: [],
    sections: [],
    symbols: [
      {
        id: 'SYM1',
        name: 'PTE_SYMBOL',
        type: 'path',
        value: '/uploads/ORG_900000/symbols/logo.png'
      }
    ],
    accesses: [],
    uploadFolders: []
  };
  if (includeDataEntities) {
    manifest.dataEntities = [
      { entityType: 'pteApplicants', label: 'PTE Applicants' }
    ];
  }
  return manifest;
}

test('preflightBuild discovers manifest data entities and upload refs', async () => {
  await withTempCwd('pkg-builder-preflight-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest());
    fs.writeFileSync(path.join(tempRoot, 'packages', 'pte', 'README.md'), '# PTE', 'utf8');
    fs.mkdirSync(path.join(tempRoot, 'uploads', 'ORG_900000', 'symbols'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'uploads', 'ORG_900000', 'symbols', 'logo.png'), 'png', 'utf8');

    const service = packageBuilderModule.createService({
      dataService: {
        async fetchData(entityType) {
          if (entityType === 'pteApplicants') {
            return [{ id: 'A1', orgId: 'ORG_900000', orgAlias: 'ORG_900000', avatarUrl: '/uploads/ORG_900000/symbols/logo.png' }];
          }
          return [];
        },
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      },
      packageDataOwnershipService: {
        async listOwnershipByPackage() {
          return [];
        }
      }
    });

    const report = await service.preflightBuild({
      packageId: 'pte',
      originOrgId: 'ORG_900000',
      selectedDataEntities: ['pteApplicants']
    }, {
      backendMode: 'json',
      packageRootDir: path.join(tempRoot, 'packages')
    });

    assert.equal(report.package.packageId, 'pte');
    assert.equal(report.selectedDataEntities.length, 1);
    assert.equal(Array.isArray(report.entityCatalog), true);
    assert.equal(report.entityCatalog.length, 1);
    assert.equal(report.filePlan.detectedFromData.length, 1);
    assert.equal(report.filePlan.detectedFromSymbols.length, 1);
    assert.ok(Number(report.remapImpactPreview?.rewrittenExactOrgTokens || 0) >= 1);
    assert.match(String(report.filePlan.detectedFromData[0]), /\/uploads\/ORG_900000\/symbols\/logo\.png/);
  });
});

test('buildPackage creates signed artifacts and payload markers', async () => {
  await withTempCwd('pkg-builder-build-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest('1.0.0'));
    fs.writeFileSync(path.join(tempRoot, 'packages', 'pte', 'README.md'), '# PTE', 'utf8');
    fs.mkdirSync(path.join(tempRoot, 'uploads', 'ORG_900000', 'symbols'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'uploads', 'ORG_900000', 'symbols', 'logo.png'), 'png', 'utf8');

    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const signingDir = path.join(tempRoot, 'install_packages', 'signing');
    fs.mkdirSync(signingDir, { recursive: true });
    const privatePath = path.join(signingDir, 'package-install-ed25519.private.pem');
    fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8');
    const originalKeyFile = process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE;
    process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE = 'install_packages/signing/package-install-ed25519.private.pem';

    const service = packageBuilderModule.createService({
      dataService: {
        async fetchData(entityType) {
          if (entityType === 'pteApplicants') {
            return [{ id: 'A1', orgId: 'ORG_900000', avatarUrl: '/uploads/ORG_900000/symbols/logo.png' }];
          }
          return [];
        },
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      },
      packageDataOwnershipService: {
        async listOwnershipByPackage() {
          return [];
        }
      }
    });

    try {
      const report = await service.buildPackage({
        packageId: 'pte',
        version: '1.0.1',
        originOrgId: 'ORG_900000',
        selectedDataEntities: ['pteApplicants'],
        selectedFileRefs: []
      }, {
        backendMode: 'json',
        packageRootDir: path.join(tempRoot, 'packages')
      });

      assert.equal(report.status, 'success');
      assert.equal(report.packageId, 'pte');
      assert.equal(report.version, '1.0.1');
      assert.equal(report.orgRemapRequired, true);
      assert.equal(Array.isArray(report.downloadLinks), true);
      assert.equal(fs.existsSync(report.artifacts.zip), true);
      assert.equal(fs.existsSync(report.artifacts.signature), true);
      assert.equal(fs.existsSync(report.artifacts.publicKeyPem), true);
      assert.equal(typeof report.publishedArtifacts?.rootAbsolutePath, 'string');
      assert.equal(Array.isArray(report.publishedArtifacts?.files), true);
      assert.equal(report.publishedArtifacts.files.some((row) => String(row?.fileName || '') === 'build-detail.json'), true);

      const zipBuffer = fs.readFileSync(report.artifacts.zip);
      const zip = new PizZip(zipBuffer);
      const names = Object.keys(zip.files || {});
      assert.equal(names.includes('pte/package.manifest.json'), true);
      assert.equal(names.includes('pte/__builder_payload__/manifest.json'), true);
      assert.equal(names.includes('pte/__builder_payload__/tables/pteApplicants.json'), true);
      const payload = JSON.parse(zip.file('pte/__builder_payload__/manifest.json').asText());
      assert.equal(payload.orgRemapRequired, true);
      assert.equal(payload.packageVersion, '1.0.1');
      assert.equal(Array.isArray(payload.tables), true);
      assert.equal(payload.artifactsRoot, 'artifacts');
      assert.equal(typeof payload.fileFieldSelection, 'object');
      assert.equal(names.includes('pte/__builder_payload__/artifacts/ORG_900000/symbols/logo.png'), true);
    } finally {
      if (originalKeyFile === undefined) delete process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE;
      else process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE = originalKeyFile;
    }
  });
});

test('applyBuilderPayloadIfPresent enforces target org for remap and applies data/files when provided', async () => {
  await withTempCwd('pkg-builder-apply-', async (tempRoot) => {
    const packageDir = path.join(tempRoot, 'packages', 'pte');
    fs.mkdirSync(path.join(packageDir, '__builder_payload__', 'artifacts', 'ORG_900000', 'symbols'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, '__builder_payload__', 'artifacts', 'ORG_900000', 'symbols', 'logo.png'), 'png', 'utf8');
    fs.mkdirSync(path.join(packageDir, '__builder_payload__', 'tables'), { recursive: true });
    writeJson(path.join(packageDir, '__builder_payload__', 'tables', 'pteApplicants.json'), [
      { id: 'A1', orgId: '{{ORG_ID}}', avatarUrl: '/uploads/{{ORG_ID}}/symbols/logo.png' }
    ]);
    writeJson(path.join(packageDir, '__builder_payload__', 'manifest.json'), {
      schema: 'core.package-builder.payload.v2',
      orgRemapRequired: true,
      artifactsRoot: 'artifacts',
      tables: [{ entityType: 'pteApplicants', file: 'tables/pteApplicants.json', rowCount: 1 }]
    });

    const updates = [];
    const creates = [];
    const service = packageBuilderModule.createService({
      dataService: {
        async getDataById(entityType, id) {
          if (entityType === 'pteApplicants' && id === 'A1') return { id: 'A1' };
          return null;
        },
        async updateData(entityType, id, row) {
          updates.push({ entityType, id, row });
          return row;
        },
        async addData(entityType, row) {
          creates.push({ entityType, row });
          return row;
        }
      }
    });

    await assert.rejects(
      () => service.applyBuilderPayloadIfPresent({
        manifestPath: path.join(packageDir, 'package.manifest.json')
      }, {
        backendMode: 'json'
      }),
      /Target organization is required/i
    );

    const report = await service.applyBuilderPayloadIfPresent({
      manifestPath: path.join(packageDir, 'package.manifest.json')
    }, {
      backendMode: 'json',
      targetOrgId: 'ORG_123'
    });

    assert.equal(report.applied, true);
    assert.equal(report.targetOrgId, 'ORG_123');
    assert.equal(report.dataSummary.upserted, 1);
    assert.equal(updates.length, 1);
    assert.equal(creates.length, 0);
    assert.equal(updates[0].row.orgId, 'ORG_123');
    assert.equal(updates[0].row.avatarUrl, '/uploads/ORG_123/symbols/logo.png');
    const copiedPath = path.join(tempRoot, 'uploads', 'ORG_123', 'symbols', 'logo.png');
    assert.equal(await fsp.access(copiedPath).then(() => true).catch(() => false), true);
  });
});

test('discoverLocalPackages falls back to default ./packages when configured storage root misses package files', async () => {
  await withTempCwd('pkg-builder-discovery-fallback-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest('1.2.3'));
    const originalStorageRoot = process.env.PACKAGE_STORAGE_ROOT;
    process.env.PACKAGE_STORAGE_ROOT = path.join(tempRoot, 'uploads', 'packages').replace(/\\/g, '/');
    try {
      const service = packageBuilderModule.createService({
        packageRegistryService: {
          async listPackageRegistry() {
            return [];
          }
        }
      });
      const rows = await service.discoverLocalPackages({ backendMode: 'json' });
      const pte = rows.find((row) => String(row?.packageId || '') === 'pte');
      assert.ok(pte);
      assert.equal(pte.source, 'default_root');
      assert.equal(pte.manifestResolved, true);
      assert.equal(pte.valid, true);
    } finally {
      if (originalStorageRoot === undefined) delete process.env.PACKAGE_STORAGE_ROOT;
      else process.env.PACKAGE_STORAGE_ROOT = originalStorageRoot;
    }
  });
});

test('discoverLocalPackages includes unresolved registry rows as unavailable with warning', async () => {
  await withTempCwd('pkg-builder-discovery-registry-', async (tempRoot) => {
    const packageId = 'ghostpkg';
    const service = packageBuilderModule.createService({
      packageRegistryService: {
        async listPackageRegistry() {
          return [{
            packageId,
            version: '1.0.0',
            metadata: {
              packageName: 'Ghost Package',
              manifestPath: path.join(tempRoot, 'missing', packageId, 'package.manifest.json')
            }
          }];
        }
      }
    });
    const rows = await service.discoverLocalPackages({
      backendMode: 'json',
      packageRootDir: path.join(tempRoot, 'configured-root')
    });
    const pte = rows.find((row) => String(row?.packageId || '') === packageId);
    assert.ok(pte);
    assert.equal(pte.source, 'registry');
    assert.equal(pte.manifestResolved, false);
    assert.equal(pte.valid, false);
    assert.equal(pte.availability, 'missing_manifest');
    assert.match(String(pte.warning || ''), /manifest file was not found/i);
  });
});

test('preflightBuild falls back to package-prefixed data files when manifest and ownership catalog are empty', async () => {
  await withTempCwd('pkg-builder-data-fallback-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest('1.0.0', {
      includeDataEntities: false
    }));
    writeJson(path.join(tempRoot, 'data', 'pteApplicants.json'), []);
    writeJson(path.join(tempRoot, 'data', 'pteCourses.json'), []);
    writeJson(path.join(tempRoot, 'data', 'users.json'), []);

    const service = packageBuilderModule.createService({
      dataService: {
        async fetchData(entityType) {
          if (entityType === 'pteApplicants') return [{ id: 'A1' }];
          if (entityType === 'pteCourses') return [{ id: 'C1' }];
          return [];
        },
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      },
      packageDataOwnershipService: {
        async listOwnershipByPackage() {
          return [];
        }
      }
    });

    const report = await service.preflightBuild({
      packageId: 'pte',
      originOrgId: 'ORG_900000',
      selectedDataEntities: []
    }, {
      backendMode: 'mongo',
      packageRootDir: path.join(tempRoot, 'packages')
    });

    const entityTypes = report.availableDataEntities.map((row) => String(row?.entityType || ''));
    assert.equal(entityTypes.includes('pteApplicants'), true);
    assert.equal(entityTypes.includes('pteCourses'), true);
    assert.equal(entityTypes.includes('users'), false);
  });
});

test('fetchEntityRows falls back to JSON data file when core dataService reports unknown entity type', async () => {
  await withTempCwd('pkg-builder-json-raw-fallback-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest('1.0.0'));
    writeJson(path.join(tempRoot, 'data', 'pteApplicants.json'), [
      { id: 'A1', orgId: 'ORG_900000' },
      { id: 'A2', orgId: 'ORG_777777' },
      { id: 'A3', notes: 'unscoped' }
    ]);

    const service = packageBuilderModule.createService({
      dataService: {
        async fetchData() {
          throw new Error('Unknown entity type: pteApplicants');
        },
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      },
      packageDataOwnershipService: {
        async listOwnershipByPackage() { return []; }
      }
    });

    const report = await service.preflightBuild({
      packageId: 'pte',
      originOrgId: 'ORG_900000',
      selectedDataEntities: ['pteApplicants']
    }, {
      backendMode: 'json',
      packageRootDir: path.join(tempRoot, 'packages')
    });

    const entity = report.entityCatalog.find((row) => row.entityType === 'pteApplicants');
    assert.ok(entity);
    assert.equal(entity.rowCount, 2);
    assert.equal(report.originScopeSummary.excludedOtherOrgRows, 1);
    assert.equal(report.originScopeSummary.includedUnscopedRows, 1);
  });
});

test('fetchEntityRows falls back to Mongo collection when core dataService reports unknown entity type', async () => {
  await withTempCwd('pkg-builder-mongo-raw-fallback-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest('1.0.0'));
    const service = packageBuilderModule.createService({
      dataService: {
        async fetchData() {
          throw new Error('Unknown entity type: pteApplicants');
        },
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      },
      getMongoDbOrNull: () => ({}),
      getMongoCollection: () => ({
        find: () => ({
          toArray: async () => ([
            { _id: 'A1', orgId: 'ORG_900000' },
            { _id: 'A2', orgId: 'ORG_777777' },
            { _id: 'A3', title: 'unscoped' }
          ])
        })
      }),
      packageDataOwnershipService: {
        async listOwnershipByPackage() { return []; }
      }
    });

    const report = await service.preflightBuild({
      packageId: 'pte',
      originOrgId: 'ORG_900000',
      selectedDataEntities: ['pteApplicants']
    }, {
      backendMode: 'mongo',
      packageRootDir: path.join(tempRoot, 'packages')
    });

    const entity = report.entityCatalog.find((row) => row.entityType === 'pteApplicants');
    assert.ok(entity);
    assert.equal(entity.rowCount, 2);
    assert.equal(report.originScopeSummary.excludedOtherOrgRows, 1);
  });
});

test('preflightBuild rejects package selection when manifest is unresolved', async () => {
  await withTempCwd('pkg-builder-unavailable-preflight-', async (tempRoot) => {
    const packageId = 'ghostpkg';
    const service = packageBuilderModule.createService({
      dataService: {
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      },
      packageRegistryService: {
        async listPackageRegistry() {
          return [{ packageId, version: '1.0.0', metadata: { manifestPath: 'packages/ghostpkg/package.manifest.json' } }];
        }
      }
    });
    await assert.rejects(
      () => service.preflightBuild({
        packageId,
        originOrgId: 'ORG_900000'
      }, {
        backendMode: 'json',
        packageRootDir: path.join(tempRoot, 'configured-root')
      }),
      /unavailable for build/i
    );
  });
});

test('preflightBuild requires origin org and scopes rows to selected origin while keeping unscoped rows', async () => {
  await withTempCwd('pkg-builder-origin-scope-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest('1.0.0'));
    const service = packageBuilderModule.createService({
      dataService: {
        async fetchData(entityType) {
          if (entityType !== 'pteApplicants') return [];
          return [
            { id: 'A1', orgId: 'ORG_900000', avatarUrl: '/uploads/ORG_900000/symbols/a.png' },
            { id: 'A2', orgId: 'ORG_777777', avatarUrl: '/uploads/ORG_777777/symbols/b.png' },
            { id: 'A3', title: 'unscoped-row', avatarUrl: '/uploads/GLOBAL/symbols/c.png' },
            { id: 'A4', orgId: 'ORG_900000', avatarUrl: '/uploads/ORG_777777/symbols/d.png' }
          ];
        },
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      },
      packageDataOwnershipService: {
        async listOwnershipByPackage() { return []; }
      }
    });

    await assert.rejects(
      () => service.preflightBuild({ packageId: 'pte' }, {
        backendMode: 'json',
        packageRootDir: path.join(tempRoot, 'packages')
      }),
      /origin organization is required/i
    );

    const report = await service.preflightBuild({
      packageId: 'pte',
      originOrgId: 'ORG_900000',
      selectedDataEntities: ['pteApplicants']
    }, {
      backendMode: 'json',
      packageRootDir: path.join(tempRoot, 'packages')
    });

    assert.equal(report.originOrgId, 'ORG_900000');
    assert.equal(report.originScopeSummary.inspectedRows, 4);
    assert.equal(report.originScopeSummary.includedRows, 2);
    assert.equal(report.originScopeSummary.excludedOtherOrgRows, 2);
    assert.equal(report.originScopeSummary.includedUnscopedRows, 1);
    assert.equal(report.scopeValidation?.blocking, true);
    assert.equal(Array.isArray(report.scopeValidation?.files), true);
    assert.equal(report.scopeValidation.files.length, 1);
    const catalogRow = report.entityCatalog.find((row) => row.entityType === 'pteApplicants');
    assert.ok(catalogRow);
    assert.equal(catalogRow.rowCount, 2);
  });
});

test('preflightBuild respects fileFieldSelection when extracting upload refs', async () => {
  await withTempCwd('pkg-builder-file-fields-', async (tempRoot) => {
    writeJson(path.join(tempRoot, 'packages', 'pte', 'package.manifest.json'), createBaseManifest('1.0.0'));
    const service = packageBuilderModule.createService({
      dataService: {
        async fetchData(entityType) {
          if (entityType !== 'pteApplicants') return [];
          return [
            {
              id: 'A1',
              orgId: 'ORG_900000',
              avatarUrl: '/uploads/ORG_900000/symbols/avatar.png',
              resumePath: '/uploads/ORG_900000/docs/resume.pdf'
            }
          ];
        },
        async getDataById(entityType, id) {
          if (entityType === 'organizations' && id === 'ORG_900000') return { id };
          return null;
        }
      }
    });

    const report = await service.preflightBuild({
      packageId: 'pte',
      originOrgId: 'ORG_900000',
      selectedDataEntities: ['pteApplicants'],
      fileFieldSelection: {
        pteApplicants: ['resumePath']
      }
    }, {
      backendMode: 'json',
      packageRootDir: path.join(tempRoot, 'packages')
    });

    assert.equal(report.filePlan.detectedFromData.length, 1);
    assert.match(String(report.filePlan.detectedFromData[0]), /resume\.pdf/i);
    assert.equal(Array.isArray(report.filePlan.provenance), true);
    assert.equal(report.filePlan.provenance.every((row) => String(row?.fieldPath || '') === 'resumePath'), true);
    assert.deepEqual(report.fileFieldSelection?.pteApplicants, ['resumePath']);
  });
});

test('applyBuilderPayloadIfPresent keeps backward compatibility with legacy payload.json format', async () => {
  await withTempCwd('pkg-builder-apply-legacy-', async (tempRoot) => {
    const packageDir = path.join(tempRoot, 'packages', 'pte');
    fs.mkdirSync(path.join(packageDir, '__builder_payload__', 'files', 'ORG_900000', 'symbols'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, '__builder_payload__', 'files', 'ORG_900000', 'symbols', 'logo.png'), 'png', 'utf8');
    writeJson(path.join(packageDir, '__builder_payload__', 'payload.json'), {
      schema: 'core.package-builder.payload.v1',
      orgRemapRequired: true,
      data: {
        pteApplicants: [{ id: 'A1', orgId: '{{ORG_ID}}', avatarUrl: '/uploads/{{ORG_ID}}/symbols/logo.png' }]
      }
    });

    const updates = [];
    const service = packageBuilderModule.createService({
      dataService: {
        async getDataById() { return { id: 'A1' }; },
        async updateData(entityType, id, row) {
          updates.push({ entityType, id, row });
          return row;
        },
        async addData() { return null; }
      }
    });

    const report = await service.applyBuilderPayloadIfPresent({
      manifestPath: path.join(packageDir, 'package.manifest.json')
    }, {
      backendMode: 'json',
      targetOrgId: 'ORG_777'
    });

    assert.equal(report.applied, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].row.orgId, 'ORG_777');
    const copiedPath = path.join(tempRoot, 'uploads', 'ORG_777', 'symbols', 'logo.png');
    assert.equal(await fsp.access(copiedPath).then(() => true).catch(() => false), true);
  });
});

test('applyBuilderPayloadIfPresent fails fast with structured details on import error', async () => {
  await withTempCwd('pkg-builder-apply-failfast-', async (tempRoot) => {
    const packageDir = path.join(tempRoot, 'packages', 'pte');
    fs.mkdirSync(path.join(packageDir, '__builder_payload__', 'tables'), { recursive: true });
    writeJson(path.join(packageDir, '__builder_payload__', 'tables', 'pteApplicants.json'), [
      { id: 'A1', orgId: 'ORG_900000' }
    ]);
    writeJson(path.join(packageDir, '__builder_payload__', 'manifest.json'), {
      schema: 'core.package-builder.payload.v2',
      orgRemapRequired: false,
      artifactsRoot: 'artifacts',
      tables: [{ entityType: 'pteApplicants', file: 'tables/pteApplicants.json', rowCount: 1 }]
    });

    const service = packageBuilderModule.createService({
      dataService: {
        async getDataById() {
          return { id: 'A1' };
        },
        async updateData() {
          throw new Error('duplicate key conflict');
        },
        async addData() {
          throw new Error('should not run add path');
        }
      }
    });

    await assert.rejects(
      () => service.applyBuilderPayloadIfPresent({
        manifestPath: path.join(packageDir, 'package.manifest.json')
      }, {
        backendMode: 'json'
      }),
      (error) => {
        assert.equal(error?.code, 'BUILDER_PAYLOAD_IMPORT_FAILED');
        assert.equal(error?.details?.entityType, 'pteApplicants');
        assert.equal(error?.details?.rowId, 'A1');
        assert.match(String(error?.message || ''), /duplicate key conflict/i);
        return true;
      }
    );
  });
});
