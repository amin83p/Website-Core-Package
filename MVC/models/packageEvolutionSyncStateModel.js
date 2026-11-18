'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');

const DATA_PATH = path.join(__dirname, '../../data/packageEvolutionSyncState.json');

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, JSON.stringify({ lastScannedCommitSha: '', updatedAt: '' }, null, 2));
}

function cleanText(value, max = 128) {
  const out = String(value || '').replace(/\0/g, '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

async function readState() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      lastScannedCommitSha: cleanText(parsed?.lastScannedCommitSha),
      updatedAt: cleanText(parsed?.updatedAt, 64)
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { lastScannedCommitSha: '', updatedAt: '' };
    }
    throw error;
  }
}

async function writeState(patch = {}) {
  return queueWrite(async () => {
    const current = await readState();
    const next = {
      lastScannedCommitSha: cleanText(
        patch.lastScannedCommitSha !== undefined ? patch.lastScannedCommitSha : current.lastScannedCommitSha
      ),
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(DATA_PATH, JSON.stringify(next, null, 2));
    return next;
  });
}

module.exports = {
  getState: readState,
  saveState: writeState
};