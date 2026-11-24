#!/usr/bin/env node
'use strict';

/**
 * Copy files from local upload root or Railway gateway into Azure Blob using the same /uploads key layout.
 * Usage:
 *   UPLOAD_MODE=local node scripts/maintenance/migrate-uploads-to-azure-blob.js --dry-run
 *   UPLOAD_MODE=railway_proxy ... node scripts/maintenance/migrate-uploads-to-azure-blob.js
 *
 * Target Azure must be configured (AZURE_STORAGE_*). This script forces azure_blob driver for writes only.
 */

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

process.chdir(path.resolve(__dirname, '../..'));

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');

async function walkLocalUploads(uploadRoot = '') {
  const files = [];
  async function walk(current, relativeFromRoot = '') {
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = [relativeFromRoot, entry.name].filter(Boolean).join('/');
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(abs, rel);
      } else if (entry.isFile()) {
        files.push({ abs, rel: rel.split(path.sep).join('/') });
      }
    }
  }
  await walk(uploadRoot, '');
  return files;
}

async function main() {
  if (DRY_RUN) console.log('[dry-run] No blobs will be written.');
  const uploadPathUtils = require('../../MVC/utils/uploadPathUtils');
  const azureBlob = require('../../MVC/services/azureBlobUploadClientService');
  const connectionString = String(process.env.AZURE_STORAGE_CONNECTION_STRING || '').trim();
  const account = String(process.env.AZURE_STORAGE_ACCOUNT || '').trim();
  if (!connectionString && !(account && process.env.AZURE_STORAGE_ACCOUNT_KEY)) {
    throw new Error('Configure AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_ACCOUNT_KEY.');
  }

  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  const localFiles = await walkLocalUploads(uploadRoot);
  let copied = 0;
  for (const row of localFiles) {
    const parts = row.rel.split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const scopeFolder = parts.shift();
    const fileName = parts.pop();
    const relativeDir = parts.join('/');
    const scopeKey = scopeFolder.toUpperCase() === 'GLOBAL' ? 'GLOBAL' : scopeFolder.replace(/^ORG_/i, '');
    if (DRY_RUN) {
      console.log(`[dry-run] would upload ${scopeKey}/${relativeDir}/${fileName}`);
      copied += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await azureBlob.uploadFile({
      scopeKey,
      relativeDir,
      desiredName: fileName,
      localFilePath: row.abs,
      mimeType: 'application/octet-stream',
      overwrite: false
    });
    copied += 1;
  }
  console.log(`Migration finished. Processed ${copied} file(s).`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});