const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const overallReportTemplateModel = require('../../packages/school/MVC/models/school/overallReportTemplateModel');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
}

function padDay(dayNum) {
  return String(dayNum).padStart(2, '0');
}

function cloneDayField(templateField, dayNum) {
  const day = padDay(dayNum);
  const fromDay = templateField.id.match(/day(\d{2})_/)[1];
  const field = JSON.parse(JSON.stringify(templateField));
  field.id = field.id.replace(fromDay, day);
  field.label = field.label.replace(new RegExp(`Day ${fromDay}`, 'g'), `Day ${day}`);
  field.docxAlias = '';
  if (field.calculationRule?.expression) {
    field.calculationRule.expression = field.calculationRule.expression
      .replace(new RegExp(`attendance_presence_${fromDay}`, 'g'), `attendance_presence_${day}`)
      .replace(new RegExp(`attendance_note_${fromDay}`, 'g'), `attendance_note_${day}`);
  }
  delete field.sourceReferences;
  delete field.calculationDependencies;
  return field;
}

async function main() {
  loadEnv();
  const templateId = String(process.argv[2] || '495502').trim();
  const titleMatch = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured.');

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || 'app').collection('schoolOverallReportTemplates');

  const existing = titleMatch
    ? await col.findOne({ title: titleMatch })
    : await col.findOne({ id: templateId });
  if (!existing) throw new Error('Overall report template not found.');

  const day01Yn = existing.schema?.fields?.find((field) => field.id === 'day01_yn');
  const day01Note = existing.schema?.fields?.find((field) => field.id === 'day01_note');
  if (!day01Yn || !day01Note) throw new Error('day01_yn/day01_note pattern fields were not found.');

  const baseFields = (existing.schema?.fields || []).filter((field) => {
    const match = String(field.id || '').match(/^day(\d{2})_/);
    if (!match) return true;
    return Number(match[1]) <= 2;
  });

  const newDayFields = [];
  for (let day = 3; day <= 31; day += 1) {
    newDayFields.push(cloneDayField(day01Yn, day));
    newDayFields.push(cloneDayField(day01Note, day));
  }

  const sanitized = overallReportTemplateModel.sanitizeTemplate({
    ...existing,
    schema: {
      ...(existing.schema || {}),
      fields: [...baseFields, ...newDayFields]
    }
  }, { existing, isUpdate: true });

  const result = await col.updateOne(
    { id: existing.id },
    {
      $set: {
        schema: sanitized.schema,
        placeholderMap: sanitized.placeholderMap,
        'audit.lastUpdateDateTime': new Date().toISOString()
      }
    }
  );

  console.log(JSON.stringify({
    templateId: existing.id,
    title: existing.title,
    matched: result.matchedCount,
    modified: result.modifiedCount,
    fieldCount: sanitized.schema.fields.length,
    dayFieldCount: sanitized.schema.fields.filter((field) => /^day\d{2}_/.test(String(field.id))).length
  }, null, 2));

  await client.close();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
