const { resolveDataBackendConfig } = require('../config/dataBackend');
const { setActiveDataBackendConfig } = require('../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../MVC/infrastructure/mongo/mongoConnection');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const questionTypeRegistry = require('../MVC/services/pte/questionTypeRegistry');

function countByStatus(rows = []) {
  const map = {};
  for (const row of rows) {
    const s = String(row?.status || 'unknown').toLowerCase();
    map[s] = Number(map[s] || 0) + 1;
  }
  return map;
}

async function main() {
  const settings = await systemSettingsRepository.getSettings({ backendMode: 'json' });
  const backend = resolveDataBackendConfig(process.env, {
    preferredMode: 'mongo',
    preferredMongoUri: settings?.app?.mongoUri
  });
  setActiveDataBackendConfig(backend);

  if (backend.mode !== 'mongo' || !backend.mongo?.uri) {
    throw new Error('Mongo backend is required for this audit.');
  }

  const activeOrgId = String(settings?.organization?.freeOrgId || '').trim() || '900000';

  await connectMongo({ uri: backend.mongo.uri });
  try {
    const c = getMongoCollection('pteQuestionVersions');
    const allRows = await c.find(
      { questionType: 'speaking_describe_image' },
      { projection: { id: 1, orgId: 1, status: 1, questionType: 1, payload: 1, scoringConfig: 1 } }
    ).toArray();

    const activeOrgRows = allRows.filter((row) => String(row?.orgId || '') === activeOrgId);

    function validateRows(rows) {
      const invalid = [];
      for (const row of rows) {
        const errors = questionTypeRegistry.validateQuestionContracts(
          'speaking_describe_image',
          row?.payload || {},
          row?.scoringConfig || {}
        );
        if (Array.isArray(errors) && errors.length) {
          invalid.push({
            id: row?.id || '',
            orgId: row?.orgId || '',
            status: row?.status || '',
            errors
          });
        }
      }
      return invalid;
    }

    const invalidAll = validateRows(allRows);
    const invalidActive = validateRows(activeOrgRows);

    const activeOrgScoringRows = activeOrgRows.map((row) => ({
      id: row?.id || '',
      status: row?.status || '',
      scoringConfig: row?.scoringConfig || {}
    }));

    const uniqueScoringConfigs = new Map();
    activeOrgScoringRows.forEach((row) => {
      const key = JSON.stringify(row.scoringConfig || {});
      if (!uniqueScoringConfigs.has(key)) uniqueScoringConfigs.set(key, []);
      uniqueScoringConfigs.get(key).push(row.id);
    });

    const report = {
      auditAt: new Date().toISOString(),
      activeOrgId,
      describeImage: {
        allOrgs: {
          total: allRows.length,
          byStatus: countByStatus(allRows),
          invalidCount: invalidAll.length,
          invalidSamples: invalidAll.slice(0, 20)
        },
        activeOrg: {
          total: activeOrgRows.length,
          byStatus: countByStatus(activeOrgRows),
          invalidCount: invalidActive.length,
          invalidSamples: invalidActive.slice(0, 20),
          scoringRows: activeOrgScoringRows,
          uniqueScoringConfigShapes: Array.from(uniqueScoringConfigs.entries()).map(([json, ids]) => ({
            ids,
            scoringConfig: JSON.parse(json)
          }))
        }
      }
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
