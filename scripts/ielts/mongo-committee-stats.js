/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!key || process.env[key]) continue;
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile();
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../MVC/infrastructure/mongo/mongoConnection');

async function main() {
  await connectMongo();
  const assessments = getMongoCollection('ieltsMicroAssessments');
  const scoring = getMongoCollection('ieltsScoringHistory');

  const total = await assessments.countDocuments({});
  const active = await assessments.countDocuments({ is_active: true });
  const weights = await assessments.aggregate([
    { $group: { _id: '$weight', n: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  const criteria = await assessments.aggregate([
    { $group: { _id: '$criterion', n: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  const scopes = await assessments.aggregate([
    { $group: { _id: '$scope', n: { $sum: 1 } } }
  ]).toArray();
  const signalKinds = await assessments.aggregate([
    { $group: { _id: '$signal_kind', n: { $sum: 1 } } }
  ]).toArray();
  const orgs = await assessments.aggregate([
    { $group: { _id: '$orgId', n: { $sum: 1 } } },
    { $sort: { n: -1 } }
  ]).toArray();
  const sample = await assessments.findOne(
    { notes: /First version \(v1\) imported via CSV/ },
    { projection: { baseKey: 1, createdAt: 1, notes: 1, orgId: 1 } }
  );
  const createdRange = await assessments.aggregate([
    { $group: { _id: null, minCreated: { $min: '$createdAt' }, maxCreated: { $max: '$createdAt' } } }
  ]).toArray();

  const scoringCount = await scoring.countDocuments({});
  const withGateTrace = await scoring.countDocuments({
    'steps.step4grade.response.json.data.meta.gateTrace': { $exists: true }
  });

  const gateExample = await scoring.findOne(
    {
      'steps.step4grade.response.json.data.meta.gateTrace.CC.evaluatedGates': { $exists: true },
      'steps.step4grade.response.json.data.scores.CC': { $exists: true }
    },
    {
      projection: {
        sessionId: 1,
        id: 1,
        'metadata.sampleName': 1,
        'steps.step4grade.response.json.data.scores': 1,
        'steps.step4grade.response.json.data.overallBand': 1,
        'steps.step4grade.response.json.data.meta.gateTrace.CC': 1
      }
    }
  );

  let ccGateExample = null;
  if (gateExample) {
    const ccTrace = gateExample?.steps?.step4grade?.response?.json?.data?.meta?.gateTrace?.CC;
    const failedGate = (ccTrace?.evaluatedGates || []).find((g) => g.status === 'failed' || g.status === 'partial');
    ccGateExample = {
      sessionId: gateExample.sessionId || gateExample.id,
      sampleName: gateExample?.metadata?.sampleName || null,
      scores: gateExample?.steps?.step4grade?.response?.json?.data?.scores,
      overallBand: gateExample?.steps?.step4grade?.response?.json?.data?.overallBand,
      ccResultingScore: ccTrace?.resultingCriterionScore,
      failedOrPartialGate: failedGate || null,
      evaluatedGatesSummary: (ccTrace?.evaluatedGates || []).map((g) => ({
        band: g.band,
        status: g.status,
        passRatio: g.passRatio,
        passedWeight: g.passedWeight,
        totalWeight: g.totalWeight,
        resultingBandAfterGate: g.resultingBandAfterGate
      }))
    };
    if (!failedGate) {
      const alt = await scoring.findOne(
        {
          'steps.step4grade.response.json.data.meta.gateTrace.CC.evaluatedGates': {
            $elemMatch: { status: 'failed' }
          }
        },
        {
          projection: {
            sessionId: 1,
            id: 1,
            'metadata.sampleName': 1,
            'steps.step4grade.response.json.data.scores': 1,
            'steps.step4grade.response.json.data.overallBand': 1,
            'steps.step4grade.response.json.data.meta.gateTrace.CC': 1
          }
        }
      );
      if (alt) {
        const altCc = alt?.steps?.step4grade?.response?.json?.data?.meta?.gateTrace?.CC;
        const altFailed = (altCc?.evaluatedGates || []).find((g) => g.status === 'failed' || g.status === 'partial');
        ccGateExample = {
          sessionId: alt.sessionId || alt.id,
          sampleName: alt?.metadata?.sampleName || null,
          scores: alt?.steps?.step4grade?.response?.json?.data?.scores,
          overallBand: alt?.steps?.step4grade?.response?.json?.data?.overallBand,
          ccResultingScore: altCc?.resultingCriterionScore,
          failedOrPartialGate: altFailed || null,
          evaluatedGatesSummary: (altCc?.evaluatedGates || []).map((g) => ({
            band: g.band,
            status: g.status,
            passRatio: g.passRatio,
            passedWeight: g.passedWeight,
            totalWeight: g.totalWeight,
            resultingBandAfterGate: g.resultingBandAfterGate
          }))
        };
      }
    }
  }

  console.log(JSON.stringify({
    assessments: { total, active, weights, criteria, scopes, signalKinds, orgs, sample, createdRange: createdRange[0] || null },
    scoring: { scoringCount, withGateTrace },
    ccGateExample
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => {
    try { await disconnectMongo(); } catch (_) {}
  });
