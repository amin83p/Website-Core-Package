#!/usr/bin/env node

const enableIeltsPackage = require('../../packages/ielts/scripts/maintenance/enable-ielts-package');

async function main() {
  await enableIeltsPackage.runEnableIeltsPackage(process.argv.slice(2), { emit: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[IELTS_PACKAGE_ENABLE][ERROR] ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = enableIeltsPackage;
