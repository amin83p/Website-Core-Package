const { MongoClient } = require('mongodb');
const { seedSchoolActivitiesSection } = require('../scripts/maintenance/seedSchoolActivitiesSection');

function inferDbNameFromUri(uri = '') {
  const safe = String(uri || '').trim();
  if (!safe) return '';
  try {
    const normalized = safe.startsWith('mongodb://') || safe.startsWith('mongodb+srv://')
      ? safe
      : `mongodb://${safe}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

async function run(context = {}) {
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) {
    return {
      status: 'failed',
      message: 'MONGODB_URI is not configured; School Activities section seed was skipped.'
    };
  }
  const dbName = String(
    process.env.MONGODB_DB
    || process.env.MONGO_DB
    || inferDbNameFromUri(uri)
    || 'app'
  ).trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const result = await seedSchoolActivitiesSection(client.db(dbName));
    return {
      status: 'success',
      artifacts: result,
      ownershipRecords: [{
        entityType: 'sections',
        identityKey: result.sectionId,
        packageId: String(context.packageId || 'school'),
        packageVersion: String(context.packageVersion || ''),
        metadata: {
          sectionName: result.sectionName,
          homeURL: result.homeURL
        }
      }]
    };
  } finally {
    await client.close();
  }
}

module.exports = { run };
