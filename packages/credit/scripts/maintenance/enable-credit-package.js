#!/usr/bin/env node

const enableCreditPackage = require('../../../scripts/packages/enable-credit-package');

async function main() {
  await enableCreditPackage.runEnableCreditPackage(process.argv.slice(2), { emit: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[CREDIT_PACKAGE_ENABLE][ERROR] ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = enableCreditPackage;
