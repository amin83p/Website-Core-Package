const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');

function listGuardModules() {
  if (!fs.existsSync(PACKAGES_DIR)) return [];
  return fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name, 'config', 'personDeletionGuard.js'))
    .filter((candidate) => fs.existsSync(candidate));
}

async function collectPersonDeleteBlocks(person, context = {}) {
  const blocks = [];
  for (const modulePath of listGuardModules()) {
    try {
      const guard = require(modulePath);
      if (typeof guard.collectPersonDeleteBlocks !== 'function') continue;
      const result = await guard.collectPersonDeleteBlocks(person, context);
      if (Array.isArray(result)) {
        blocks.push(...result.filter(Boolean));
      } else if (result) {
        blocks.push(result);
      }
    } catch (error) {
      blocks.push({
        statusCode: 500,
        message: `Person dependency guard failed: ${error.message}`
      });
    }
  }
  return blocks;
}

module.exports = {
  collectPersonDeleteBlocks
};
