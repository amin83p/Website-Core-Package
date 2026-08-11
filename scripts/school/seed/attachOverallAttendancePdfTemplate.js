const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
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

const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const fileAssetStorage = require('../../../MVC/services/fileAssetStorageService');
const reportPdfRenderService = require('../../../packages/school/MVC/services/school/reportPdfRenderService');
const { PDFDocument } = require('pdf-lib');

const TEMPLATE_ID = process.env.SCHOOL_OVERALL_ATTENDANCE_TEMPLATE_ID || 'RPTTPL-2026-OVERALL-ATTENDANCE';
const ORG_ID = process.env.SCHOOL_REPORT_TEMPLATE_ORG_ID || process.env.ACTIVE_ORG_ID || '900000';
const SOURCE_PDF = process.env.SCHOOL_OVERALL_ATTENDANCE_PDF_SOURCE
  || 'C:\\Users\\Amin\\Downloads\\WCB Student Attendance Report - Rodriguez De Souza Marcello.pdf';
const DEST_FILE_NAME = process.env.SCHOOL_OVERALL_ATTENDANCE_PDF_FILE_NAME
  || 'WCB_Student_Attendance_Report_Rodriguez_De_Souza_Marcello.pdf';
const SYSTEM_USER_ID = process.env.SCHOOL_REPORT_TEMPLATE_SEED_USER || 'ROOT_001';

async function main() {
  const sourcePath = path.resolve(SOURCE_PDF);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source PDF was not found: ${sourcePath}`);
  }

  await connectMongo();
  const collection = getMongoCollection('schoolReportTemplates');
  const existing = await collection.findOne({ id: TEMPLATE_ID });
  if (!existing) {
    throw new Error(`Template ${TEMPLATE_ID} was not found. Run seedOverallAttendanceReportTemplate.js first.`);
  }

  const sourceBuffer = fs.readFileSync(sourcePath);
  const pdfDoc = await PDFDocument.load(sourceBuffer);
  const form = pdfDoc.getForm();
  const fieldMap = existing?.pdfFieldMap && typeof existing.pdfFieldMap === 'object' ? existing.pdfFieldMap : {};
  const populatedPlaceholders = [];
  const missingMappedFields = [];
  Object.entries(fieldMap).forEach(([sourceKey, pdfFieldName]) => {
    const name = String(pdfFieldName || '').trim();
    if (!name) return;
    let field;
    try {
      field = form.getField(name);
    } catch (_) {
      missingMappedFields.push(name);
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
    // Some PDFs cannot regenerate every appearance stream; the field values remain available for export.
  }
  const templateBuffer = Buffer.from(await pdfDoc.save());

  const stored = await fileAssetStorage.saveBuffer({
    scopeKey: ORG_ID,
    relativeDir: 'school-reports',
    fileName: DEST_FILE_NAME,
    originalName: path.basename(sourcePath),
    mimeType: 'application/pdf',
    buffer: templateBuffer,
    overwrite: true
  });

  const pdfTemplate = {
    fileName: stored.fileName || DEST_FILE_NAME,
    originalName: stored.originalName || path.basename(sourcePath),
    path: stored.path || stored.url,
    url: stored.url || stored.path,
    uploadedAt: stored.uploadedAt || new Date().toISOString()
  };

  const inspected = await reportPdfRenderService.inspectPdfTemplateFields(pdfTemplate);

  await collection.updateOne(
    { id: TEMPLATE_ID },
    {
      $set: {
        pdfTemplate,
        'audit.lastUpdateUser': SYSTEM_USER_ID,
        'audit.lastUpdateDateTime': new Date().toISOString()
      }
    }
  );

  const saved = await collection.findOne(
    { id: TEMPLATE_ID },
    { projection: { _id: 0, id: 1, title: 1, orgId: 1, pdfTemplate: 1, pdfFieldMap: 1 } }
  );

  console.log(JSON.stringify({
    status: 'attached',
    templateId: saved?.id,
    title: saved?.title,
    orgId: saved?.orgId,
    sourcePath,
    storedPath: pdfTemplate.path,
    storedUrl: pdfTemplate.url,
    pdfFieldCount: inspected.fields.length,
    mappedFieldCount: Object.keys(saved?.pdfFieldMap || {}).length,
    populatedPlaceholderCount: populatedPlaceholders.length,
    missingMappedFields,
    samplePdfFields: inspected.fields.slice(0, 10).map((field) => field.name),
    pdfTemplate: saved?.pdfTemplate
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
