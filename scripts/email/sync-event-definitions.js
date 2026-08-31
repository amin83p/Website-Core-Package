/* eslint-disable no-console */
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
} catch (_) {
  // dotenv is optional for JSON-backed local sync runs
}

const emailEventDefinitionService = require(path.join(__dirname, '../../MVC/services/emailEventDefinitionService'));

async function main() {
  const result = await emailEventDefinitionService.syncFromCodeCatalog();
  console.log(`Synced ${result.upserted} email event definition(s) from code catalog.`);
}

main().catch((error) => {
  console.error('Email event definition sync failed:', error?.message || error);
  process.exitCode = 1;
});
