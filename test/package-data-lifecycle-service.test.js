const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { createService } = require('../MVC/services/packageDataLifecycleService');

async function writeScript(filePath, body) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, 'utf8');
}

async function createPackageFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-data-lifecycle-'));
  const packageRootDir = path.join(root, 'packages');
  const packageDir = path.join(packageRootDir, 'addon');
  await fs.mkdir(packageDir, { recursive: true });

  await writeScript(
    path.join(packageDir, 'migrations/001-up.js'),
    "module.exports = { up: async () => ({ status: 'success', artifacts: { step: 'm1-up' } }), down: async () => ({ status: 'success', artifacts: { step: 'm1-down' } }) };"
  );
  await writeScript(
    path.join(packageDir, 'migrations/002-up.js'),
    "module.exports = { up: async () => ({ status: 'success', artifacts: { step: 'm2-up' } }), down: async () => ({ status: 'success', artifacts: { step: 'm2-down' } }) };"
  );
  await writeScript(
    path.join(packageDir, 'seeders/001-run.js'),
    "module.exports = { run: async () => ({ status: 'success', artifacts: { step: 's1-run' } }), revert: async () => ({ status: 'success', artifacts: { step: 's1-revert' } }) };"
  );

  const manifest = {
    id: 'addon',
    name: 'Addon',
    version: '1.2.0',
    migrations: [
      { id: 'm1', version: '1.0.0', up: 'migrations/001-up.js', down: 'migrations/001-up.js', backendModes: ['json'] },
      { id: 'm2', version: '1.2.0', up: 'migrations/002-up.js', down: 'migrations/002-up.js', backendModes: ['json'] }
    ],
    seeders: [
      { id: 's1', version: '1.0.0', run: 'seeders/001-run.js', revert: 'seeders/001-run.js', mode: 'upsert', backendModes: ['json'] }
    ]
  };

  return {
    root,
    packageRootDir,
    packageDir,
    manifest,
    cleanup: async () => fs.rm(root, { recursive: true, force: true })
  };
}

function createLedgerStub() {
  const rows = [];
  return {
    rows,
    hashChecksum(input = '') {
      return `hash:${input}`;
    },
    async createStepEntry(input = {}) {
      const row = { id: `LEDGER_${rows.length + 1}`, status: 'running', ...input };
      rows.push(row);
      return row;
    },
    async completeStepEntry(id, patch = {}) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...patch };
      return rows[index];
    },
    async findLatestSuccessfulEntry(criteria = {}) {
      const filtered = rows.filter((row) => (
        row.packageId === criteria.packageId
        && row.stepId === criteria.stepId
        && row.stepType === criteria.stepType
        && row.direction === criteria.direction
        && row.status === 'success'
      ));
      return filtered[filtered.length - 1] || null;
    }
  };
}

test('data lifecycle install runs migration/seed steps and records applied summary', async () => {
  const fixture = await createPackageFixture();
  const executionLedgerService = createLedgerStub();
  const ownershipService = {
    async registerOwnershipRecords() { return []; },
    async listOwnershipByPackage() { return []; },
    async detectOwnershipConflicts() { return []; }
  };
  const service = createService({ executionLedgerService, ownershipService });

  try {
    const report = await service.runPackageDataInstallLifecycle({
      packageId: 'addon',
      packageVersion: '1.2.0',
      manifest: fixture.manifest,
      manifestPath: path.join(fixture.packageDir, 'package.manifest.json')
    }, {
      backendMode: 'json',
      packageRootDir: fixture.packageRootDir
    });

    assert.equal(report.failedStep, null);
    assert.equal(report.appliedSteps.length, 3);
    assert.deepEqual(report.appliedSteps.map((row) => row.direction), ['up', 'up', 'run']);
    assert.equal(report.dataSummary.migrations.applied, 2);
    assert.equal(report.dataSummary.seeders.applied, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('data lifecycle upgrade runs only steps newer than previous version', async () => {
  const fixture = await createPackageFixture();
  const executionLedgerService = createLedgerStub();
  const service = createService({
    executionLedgerService,
    ownershipService: {
      async registerOwnershipRecords() { return []; },
      async listOwnershipByPackage() { return []; },
      async detectOwnershipConflicts() { return []; }
    }
  });

  try {
    const report = await service.runPackageDataUpgradeLifecycle({
      packageId: 'addon',
      packageVersion: '1.2.0',
      previousVersion: '1.0.0',
      manifest: fixture.manifest,
      manifestPath: path.join(fixture.packageDir, 'package.manifest.json')
    }, {
      backendMode: 'json',
      packageRootDir: fixture.packageRootDir
    });

    assert.equal(report.failedStep, null);
    assert.equal(report.appliedSteps.length, 1);
    assert.equal(report.appliedSteps[0].stepId, 'm2');
  } finally {
    await fixture.cleanup();
  }
});

test('data lifecycle uninstall safe mode skips destructive steps and force runs reverse steps', async () => {
  const fixture = await createPackageFixture();
  const executionLedgerService = createLedgerStub();
  const service = createService({
    executionLedgerService,
    ownershipService: {
      async registerOwnershipRecords() { return []; },
      async listOwnershipByPackage() { return []; },
      async detectOwnershipConflicts() { return []; }
    }
  });

  try {
    await service.runPackageDataInstallLifecycle({
      packageId: 'addon',
      packageVersion: '1.2.0',
      manifest: fixture.manifest,
      manifestPath: path.join(fixture.packageDir, 'package.manifest.json')
    }, {
      backendMode: 'json',
      packageRootDir: fixture.packageRootDir
    });

    const safeReport = await service.runPackageDataUninstallLifecycle({
      packageId: 'addon',
      packageVersion: '1.2.0',
      manifest: fixture.manifest,
      manifestPath: path.join(fixture.packageDir, 'package.manifest.json')
    }, {
      backendMode: 'json',
      packageRootDir: fixture.packageRootDir,
      force: false
    });
    assert.equal(safeReport.appliedSteps.length, 0);
    assert.equal(safeReport.skippedSteps.length >= 1, true);

    const forceReport = await service.runPackageDataUninstallLifecycle({
      packageId: 'addon',
      packageVersion: '1.2.0',
      manifest: fixture.manifest,
      manifestPath: path.join(fixture.packageDir, 'package.manifest.json')
    }, {
      backendMode: 'json',
      packageRootDir: fixture.packageRootDir,
      force: true
    });

    assert.equal(forceReport.failedStep, null);
    assert.equal(forceReport.rollbackApplied, true);
    assert.deepEqual(forceReport.appliedSteps.map((row) => row.direction), ['revert', 'down', 'down']);
  } finally {
    await fixture.cleanup();
  }
});

test('data uninstall preview reports modified records using ownership baseline/current hashes', async () => {
  const fixture = await createPackageFixture();
  const service = createService({
    executionLedgerService: createLedgerStub(),
    ownershipService: {
      async registerOwnershipRecords() { return []; },
      async listOwnershipByPackage() {
        return [{
          entityType: 'collections',
          identityKey: 'attempts',
          packageId: 'addon',
          packageVersion: '1.2.0',
          baselineHash: 'abc123',
          metadata: {
            currentHash: 'def999',
            currentSnapshot: { count: 4 }
          },
          baselineSnapshot: { count: 2 }
        }];
      },
      async detectOwnershipConflicts() { return []; }
    }
  });

  try {
    const preview = await service.previewPackageDataUninstallImpact({
      packageId: 'addon',
      manifest: fixture.manifest
    }, { backendMode: 'json' });

    assert.equal(preview.blocked, true);
    assert.equal(preview.modifiedRecords.length, 1);
    assert.equal(preview.dataImpact.modifiedCount, 1);
  } finally {
    await fixture.cleanup();
  }
});
