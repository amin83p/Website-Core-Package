'use strict';



const fs = require('fs');

const path = require('node:path');



const ROOT = path.resolve(__dirname, '../../..');

const DATA_PATH = path.join(ROOT, 'data/school/timesheetPeriods.json');



const { buildBiMonthlyPeriods } = require('../../../packages/school/MVC/services/school/timesheetPeriodScheduleService');



const ORG_ID = String(process.env.ORG_ID || process.env.ACTIVE_ORG_ID || '900000').trim();

const YEAR = Number(process.env.YEAR || process.env.TIMESHEET_PERIOD_YEAR || 2026);



// Production Mongo deployments should use the Timesheet Periods admin UI

// (/school/timesheetPeriods → Generate Year) which writes through schoolDataService.



function readPeriods() {

  if (!fs.existsSync(DATA_PATH)) return [];

  const raw = fs.readFileSync(DATA_PATH, 'utf8');

  const parsed = JSON.parse(raw || '[]');

  return Array.isArray(parsed) ? parsed : [];

}



function writePeriods(rows) {

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });

  fs.writeFileSync(DATA_PATH, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

}



function isTargetOrgPeriod(row, orgId, year) {

  if (String(row?.orgId || '').trim() !== orgId) return false;

  const startDate = String(row?.startDate || '').trim();

  return startDate.startsWith(`${year}-`);

}



function upsertGeneratedPeriods(existingRows, generatedRows) {

  const generatedById = new Map(generatedRows.map((row) => [String(row.id), row]));

  const preserved = (Array.isArray(existingRows) ? existingRows : []).filter((row) => !generatedById.has(String(row?.id || '')));

  const merged = [...preserved];



  generatedRows.forEach((row) => {

    const existing = (Array.isArray(existingRows) ? existingRows : []).find((candidate) => String(candidate?.id || '') === String(row.id));

    merged.push({

      ...row,

      audit: {

        ...(existing?.audit || {}),

        createDateTime: existing?.audit?.createDateTime || new Date().toISOString(),

        lastUpdateDateTime: new Date().toISOString()

      }

    });

  });



  return merged.sort((a, b) => String(a?.startDate || '').localeCompare(String(b?.startDate || '')));

}



async function seedViaGenerationService() {

  const { connectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');

  const generationService = require('../../../packages/school/MVC/services/school/timesheetPeriodGenerationService');



  await connectMongo();

  const summary = await generationService.generateYearPeriods({

    orgId: ORG_ID,

    year: YEAR,

    cadence: 'semi_monthly',

    reqUser: { activeOrgId: ORG_ID, isSystemSuperAdmin: true }

  });



  console.log(`Generated ${summary.createdCount} period(s); skipped ${summary.skippedCount} for org ${ORG_ID} in ${YEAR} via Mongo.`);

  return summary;

}



function main() {

  if (String(process.env.DATA_BACKEND || '').toLowerCase() === 'mongo') {

    return seedViaGenerationService();

  }



  const generated = buildBiMonthlyPeriods({

    orgId: ORG_ID,

    year: YEAR,

    status: 'open'

  });



  const existing = readPeriods();

  const withoutTargetYear = existing.filter((row) => !isTargetOrgPeriod(row, ORG_ID, YEAR));

  const nextRows = upsertGeneratedPeriods(withoutTargetYear, generated);



  writePeriods(nextRows);



  const seededCount = nextRows.filter((row) => isTargetOrgPeriod(row, ORG_ID, YEAR)).length;

  console.log(`Seeded ${seededCount} timesheet periods for org ${ORG_ID} in ${YEAR} (JSON file only).`);

  console.log(`For Mongo deployments, use /school/timesheetPeriods → Generate Year instead.`);

  console.log(`Wrote ${nextRows.length} total rows to ${DATA_PATH}`);

}



if (require.main === module) {

  main().catch((error) => {

    console.error(error);

    process.exitCode = 1;

  });

}



module.exports = {

  readPeriods,

  writePeriods,

  upsertGeneratedPeriods,

  seedViaGenerationService,

  main

};

