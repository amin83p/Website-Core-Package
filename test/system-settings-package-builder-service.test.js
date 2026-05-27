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

function createBaseManifest(version = '1.0.0') {
  return {
    id: 'pte',
    name: 'PTE',
    version,
    mountPath: '/pte',
    routes: [],
    operations: [],
    roles: [],
    sections: [],
    symbols: [],
    accesses: [],
    uploadFolders: [],
    dataEntities: [
      { entityType: 'pteApplicants', label: 'PTE Applicants' }
    ]
  };
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
            return [{ id: 'A1', orgId: 'ORG_900000', avatarUrl: '/uploads/ORG_900000/symbols/logo.png' }];
          }
          return [];
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
      selectedDataEntities: ['pteApplicants']
    }, {
      backendMode: 'json',
      packageRootDir: path.join(tempRoot, 'packages')
    });

    assert.equal(report.package.packageId, 'pte');
    assert.equal(report.selectedDataEntities.length, 1);
    assert.equal(report.filePlan.detectedFromData.length, 1);
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
      assert.equal(fs.existsSync(report.artifacts.zip), true);
      assert.equal(fs.existsSync(report.artifacts.signature), true);
      assert.equal(fs.existsSync(report.artifacts.publicKeyPem), true);

      const zipBuffer = fs.readFileSync(report.artifacts.zip);
      const zip = new PizZip(zipBuffer);
      const names = Object.keys(zip.files || {});
      assert.equal(names.includes('pte/package.manifest.json'), true);
      assert.equal(names.includes('pte/__builder_payload__/payload.json'), true);
      const payload = JSON.parse(zip.file('pte/__builder_payload__/payload.json').asText());
      assert.equal(payload.orgRemapRequired, true);
      assert.equal(payload.packageVersion, '1.0.1');
    } finally {
      if (originalKeyFile === undefined) delete process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE;
      else process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE = originalKeyFile;
    }
  });
});

test('applyBuilderPayloadIfPresent enforces target org for remap and applies data/files when provided', async () => {
  await withTempCwd('pkg-builder-apply-', async (tempRoot) => {
    const packageDir = path.join(tempRoot, 'packages', 'pte');
    fs.mkdirSync(path.join(packageDir, '__builder_payload__', 'files', 'ORG_900000', 'symbols'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, '__builder_payload__', 'files', 'ORG_900000', 'symbols', 'logo.png'), 'png', 'utf8');
    writeJson(path.join(packageDir, '__builder_payload__', 'payload.json'), {
      schema: 'core.package-builder.payload.v1',
      orgRemapRequired: true,
      data: {
        pteApplicants: [
          { id: 'A1', orgId: '{{ORG_ID}}', avatarUrl: '/uploads/{{ORG_ID}}/symbols/logo.png' }
        ]
      }
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
