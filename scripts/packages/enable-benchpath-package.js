#!/usr/bin/env node

const enableBenchpathPackage = require('../../packages/benchpath/scripts/maintenance/enable-benchpath-package');

async function main() {
  await enableBenchpathPackage.runEnableBenchpathPackage(process.argv.slice(2), { emit: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[BENCHPATH_PACKAGE_ENABLE][ERROR] ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = enableBenchpathPackage;
