function normalizePrefillKey(rawKey) {
  let key = String(rawKey || '').trim();
  if (!key) return '';
  const wrapped = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(key);
  if (wrapped) key = String(wrapped[1] || '').trim();
  return key;
}

function normalizeFields(fields) {
  let changed = false;
  const nextFields = (Array.isArray(fields) ? fields : []).map((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
    const next = { ...field };
    if (Object.prototype.hasOwnProperty.call(next, 'prefillKey')) {
      const normalized = normalizePrefillKey(next.prefillKey);
      if (normalized !== String(next.prefillKey || '').trim()) {
        next.prefillKey = normalized;
        changed = true;
      }
    }
    if (Array.isArray(next.children)) {
      const result = normalizeFields(next.children);
      if (result.changed) {
        next.children = result.fields;
        changed = true;
      }
    }
    return next;
  });
  return { fields: nextFields, changed };
}

const cursor = db.schoolReportTemplates.find({
  'schema.fields.prefillKey': /\{\{/
});

let scanned = 0;
let updated = 0;

cursor.forEach((template) => {
  scanned += 1;
  const result = normalizeFields(template?.schema?.fields || []);
  if (!result.changed) return;
  const now = new Date().toISOString();
  const writeResult = db.schoolReportTemplates.updateOne(
    { _id: template._id },
    {
      $set: {
        'schema.fields': result.fields,
        'audit.lastUpdateDateTime': now,
        'audit.lastUpdateUser': 'system:normalize-report-prefill-keys'
      }
    }
  );
  if (writeResult.modifiedCount > 0) updated += 1;
});

print(`[report-template-prefill-repair] scanned=${scanned} updated=${updated}`);
