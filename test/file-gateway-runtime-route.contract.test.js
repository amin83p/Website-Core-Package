const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const express = require('express');
const tar = require('tar');

const fileGatewayRoutes = require('../MVC/routes/internal/fileGatewayRoutes');
const { buildSignedHeaders } = require('../MVC/services/fileGatewayAuthService');

async function withTempRuntimeRoot(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-pkg-gateway-'));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function writeRuntimePackage(root, packageId, version = '1.0.0') {
  const dir = path.join(root, packageId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.manifest.json'), JSON.stringify({
    id: packageId,
    name: packageId.toUpperCase(),
    version,
    mountPath: `/${packageId}`
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(dir, 'sample.txt'), `runtime-${packageId}`, 'utf8');
}

function signedHeaders(method, routePath) {
  return buildSignedHeaders({
    method,
    routePath,
    sharedKey: process.env.FILE_GATEWAY_SHARED_KEY
  });
}

test('runtime package list/download gateway endpoints enforce auth and return expected payload', async () => {
  await withTempRuntimeRoot(async (runtimeRoot) => {
    await writeRuntimePackage(runtimeRoot, 'pte', '1.0.1');
    await fs.mkdir(path.join(runtimeRoot, 'broken'), { recursive: true });
    await fs.writeFile(path.join(runtimeRoot, 'broken', 'package.manifest.json'), JSON.stringify({
      id: 'broken',
      name: 'BROKEN'
    }, null, 2), 'utf8');

    const originalSharedKey = process.env.FILE_GATEWAY_SHARED_KEY;
    const originalPackageStorageRoot = process.env.PACKAGE_STORAGE_ROOT;
    try {
      process.env.FILE_GATEWAY_SHARED_KEY = 'test-file-gateway-key';
      process.env.PACKAGE_STORAGE_ROOT = runtimeRoot;

      const app = express();
      app.use(express.json());
      app.use('/internal/file-gateway', fileGatewayRoutes);

      await withServer(app, async (baseUrl) => {
        const unauthorized = await fetch(`${baseUrl}/internal/file-gateway/packages/runtime/list`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        });
        assert.equal(unauthorized.status, 401);

        const listResponse = await fetch(`${baseUrl}/internal/file-gateway/packages/runtime/list`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...signedHeaders('POST', '/internal/file-gateway/packages/runtime/list')
          },
          body: JSON.stringify({})
        });
        assert.equal(listResponse.status, 200);
        const listPayload = await listResponse.json();
        assert.equal(listPayload.status, 'success');
        assert.equal(Number(listPayload.packageCount), 2);
        assert.equal(Number(listPayload.validCount), 1);
        assert.equal(Number(listPayload.invalidCount), 1);
        assert.equal(Boolean(listPayload.packages.find((row) => row.packageId === 'pte')), true);

        const downloadResponse = await fetch(`${baseUrl}/internal/file-gateway/packages/runtime/download`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...signedHeaders('POST', '/internal/file-gateway/packages/runtime/download')
          },
          body: JSON.stringify({ packageId: 'pte' })
        });
        assert.equal(downloadResponse.status, 200);
        assert.match(String(downloadResponse.headers.get('content-type') || ''), /application\/gzip/i);
        const archiveBuffer = Buffer.from(await downloadResponse.arrayBuffer());
        assert.equal(archiveBuffer.length > 0, true);

        const archivePath = path.join(runtimeRoot, 'downloaded-pte.tar.gz');
        await fs.writeFile(archivePath, archiveBuffer);
        const entries = [];
        await tar.t({
          file: archivePath,
          onentry: (entry) => {
            entries.push(String(entry.path || ''));
          }
        });
        await fs.rm(archivePath, { force: true });
        assert.equal(entries.some((entry) => entry === 'pte/package.manifest.json'), true);

        const missingResponse = await fetch(`${baseUrl}/internal/file-gateway/packages/runtime/download`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...signedHeaders('POST', '/internal/file-gateway/packages/runtime/download')
          },
          body: JSON.stringify({ packageId: 'does-not-exist' })
        });
        assert.equal(missingResponse.status, 404);
      });
    } finally {
      if (originalSharedKey === undefined) delete process.env.FILE_GATEWAY_SHARED_KEY;
      else process.env.FILE_GATEWAY_SHARED_KEY = originalSharedKey;
      if (originalPackageStorageRoot === undefined) delete process.env.PACKAGE_STORAGE_ROOT;
      else process.env.PACKAGE_STORAGE_ROOT = originalPackageStorageRoot;
    }
  });
});
