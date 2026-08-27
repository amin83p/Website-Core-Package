const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadDotEnv();

const { connectMongo, disconnectMongo, getMongoCollection } = require('../../MVC/infrastructure/mongo/mongoConnection');
const fileAssetStorage = require('../../MVC/services/fileAssetStorageService');
const reportPdfRenderService = require('../../packages/school/MVC/services/school/reportPdfRenderService');
const overallReportTemplateModel = require('../../packages/school/MVC/models/school/overallReportTemplateModel');
const { PDFDocument } = require('pdf-lib');

const DEFAULT_TEMPLATE_ID = process.env.SCHOOL_TWO_CLASS_OVERALL_TEMPLATE_ID || '495502';
const DEFAULT_TITLE_PATTERN = /Monthly Attendance Report - Two Classes/i;
const SYSTEM_USER_ID = process.env.SCHOOL_REPORT_TEMPLATE_SEED_USER || 'ROOT_001';
const DAY_COUNT = 31;

function padDay(dayNo) {
  return String(dayNo).padStart(2, '0');
}

function buildDefaultDayPdfFieldMap() {
  const map = {};
  for (let dayNo = 1; dayNo <= DAY_COUNT; dayNo += 1) {
    const day = padDay(dayNo);
    map[`O.day${day}_yn`] = `YN${dayNo}`;
    map[`O.day${day}_note`] = `NOTES${dayNo}`;
  }
  return map;
}

function buildWcbHeaderPdfFieldMap() {
  return {
    'T1.student_last_name': 'Students Surname',
    'T1.student_first_name': 'Students Firstname',
    'T1.student_names_initial': 'Students Initial',
    'T1.student_date_of_birth': 'Date of Birth ddmmyyyy',
    'T1.report_date': 'Report Date ddmmyyyy',
    'T1.report_period_month_name': 'Month attendend',
    'T1.student_address_line1': 'Address',
    'T1.student_city': 'CityTown',
    'T1.student_province': 'Province',
    'T1.student_postal_code': 'Postal Code',
    'T1.student_id_at_funder': 'WCB Claim Number',
    'T1.teacher_name': 'ESL Institution   Contact  Name',
    'T1.student_phone_1_area': 'Area Telephone Number 1',
    'T1.student_phone_1_part_a': 'Telephone Number 1a',
    'T1.student_phone_1_part_b': 'Telephone Number 1b',
    'T1.student_phone_2_area': 'Area Telephone Number_2',
    'T1.student_phone_2_part_a': 'Telephone Number_2 a',
    'T1.student_phone_2_part_b': 'Telephone Number_2b'
  };
}

function buildDefaultPdfFieldMap() {
  return {
    ...buildWcbHeaderPdfFieldMap(),
    ...buildDefaultDayPdfFieldMap()
  };
}

function mergePdfFieldMap(existing = {}, defaults = {}) {
  return {
    ...defaults,
    ...(existing && typeof existing === 'object' ? existing : {})
  };
}

async function main() {
  const templateId = String(process.argv[2] || DEFAULT_TEMPLATE_ID).trim();
  const titleArg = process.argv[3] ? new RegExp(process.argv[3], 'i') : DEFAULT_TITLE_PATTERN;

  await connectMongo();
  const collection = getMongoCollection('schoolOverallReportTemplates');
  const existing = titleArg
    ? await collection.findOne({ title: titleArg })
    : await collection.findOne({ id: templateId });
  if (!existing) {
    throw new Error('Overall report template not found.');
  }
  if (!existing?.pdfTemplate?.path) {
    throw new Error('Attach a PDF template to this overall report before running this script.');
  }

  const defaultDayMap = buildDefaultPdfFieldMap();
  const pdfFieldMap = mergePdfFieldMap(existing.pdfFieldMap, defaultDayMap);
  const { binary } = await reportPdfRenderService.readPdfTemplateBuffer(existing.pdfTemplate);
  const pdfDoc = await PDFDocument.load(binary);
  const form = pdfDoc.getForm();

  const populatedPlaceholders = [];
  const missingMappedFields = [];
  Object.entries(pdfFieldMap).forEach(([sourceKey, pdfFieldName]) => {
    const name = String(pdfFieldName || '').trim();
    if (!name) return;
    let field;
    try {
      field = form.getField(name);
    } catch (_) {
      missingMappedFields.push({ sourceKey, pdfFieldName: name });
      return;
    }
    if (typeof field.setText !== 'function') return;
    const placeholderToken = `{{${sourceKey}}}`;
    if (typeof field.getMaxLength === 'function' && typeof field.removeMaxLength === 'function') {
      const maxLength = Number(field.getMaxLength() || 0);
      if (maxLength > 0 && placeholderToken.length > maxLength) field.removeMaxLength();
    }
    field.setText(placeholderToken);
    populatedPlaceholders.push(name);
  });

  try {
    form.updateFieldAppearances();
  } catch (_) {
    // Some PDFs cannot regenerate every appearance stream.
  }

  const templateBuffer = Buffer.from(await pdfDoc.save());
  const orgId = existing.orgId || process.env.SCHOOL_REPORT_TEMPLATE_ORG_ID || process.env.ACTIVE_ORG_ID || '900000';
  const stored = await fileAssetStorage.saveBuffer({
    scopeKey: orgId,
    relativeDir: 'school-reports/overall',
    fileName: existing.pdfTemplate.fileName || 'Monthly_Attendance_Two_Classes.pdf',
    originalName: existing.pdfTemplate.originalName || existing.pdfTemplate.fileName || 'Monthly_Attendance_Two_Classes.pdf',
    mimeType: 'application/pdf',
    buffer: templateBuffer,
    overwrite: true
  });

  const pdfTemplate = {
    fileName: stored.fileName || existing.pdfTemplate.fileName,
    originalName: stored.originalName || existing.pdfTemplate.originalName,
    path: stored.path || stored.url,
    url: stored.url || stored.path,
    uploadedAt: stored.uploadedAt || new Date().toISOString()
  };

  const inspected = await reportPdfRenderService.inspectPdfTemplateFields(pdfTemplate);
  const sanitized = overallReportTemplateModel.sanitizeTemplate({
    ...existing,
    pdfTemplate,
    pdfFieldMap
  }, { existing, isUpdate: true });

  await collection.updateOne(
    { id: existing.id },
    {
      $set: {
        pdfTemplate: sanitized.pdfTemplate,
        pdfFieldMap: sanitized.pdfFieldMap,
        'audit.lastUpdateUser': SYSTEM_USER_ID,
        'audit.lastUpdateDateTime': new Date().toISOString()
      }
    }
  );

  const saved = await collection.findOne(
    { id: existing.id },
    { projection: { _id: 0, id: 1, title: 1, pdfTemplate: 1, pdfFieldMap: 1 } }
  );

  console.log(JSON.stringify({
    status: 'attached',
    templateId: saved?.id,
    title: saved?.title,
    storedPath: pdfTemplate.path,
    pdfFieldCount: inspected.fields.length,
    mappedFieldCount: Object.keys(saved?.pdfFieldMap || {}).length,
    populatedPlaceholderCount: populatedPlaceholders.length,
    missingMappedFields,
    samplePdfFields: inspected.fields.slice(0, 12).map((field) => field.name),
    sampleMapEntries: Object.entries(saved?.pdfFieldMap || {}).filter(([key]) => !/^O\.day\d{2}_/.test(key)).slice(0, 8)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo().catch(() => {});
  });
