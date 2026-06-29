/**
 * Upsert symbols for school report sections.
 *
 * From repo root:
 *   mongosh "<URI>/<DB>" scripts/insert-school-report-symbols.mongosh.js
 */
const SYMBOLS = [
  {
    id: 'SYM_SYSTEM_124',
    name: 'SCHOOL_REPORTS',
    type: 'class',
    value: 'bi bi-file-earmark-richtext',
    tags: ['SCHOOL_REPORTS', '445571'],
    orgId: 'SYSTEM',
    adoptExisting: true
  },
  {
    id: 'SYM_SYSTEM_125',
    name: 'SCHOOL_REPORTS_TEMPLATE',
    type: 'class',
    value: 'bi bi-journal-richtext',
    tags: ['SCHOOL_REPORTS_TEMPLATE', '446101'],
    orgId: 'SYSTEM',
    adoptExisting: true
  },
  {
    id: 'SYM_SYSTEM_126',
    name: 'SCHOOL_REPORTS_ASSIGNMENT',
    type: 'class',
    value: 'bi bi-list-check',
    tags: ['SCHOOL_REPORTS_ASSIGNMENT', '446102'],
    orgId: 'SYSTEM',
    adoptExisting: true
  },
  {
    id: 'SYM_SYSTEM_127',
    name: 'SCHOOL_REPORTS_INSTANCES',
    type: 'class',
    value: 'bi bi-file-earmark-text-fill',
    tags: ['SCHOOL_REPORTS_INSTANCES', '446103'],
    orgId: 'SYSTEM',
    adoptExisting: true
  }
];

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertSymbol(row) {
  const nameRegex = new RegExp(`^${escapeRegExp(row.name)}$`, 'i');
  db.symbols.updateOne(
    {
      $or: [
        { id: row.id },
        { name: nameRegex }
      ]
    },
    {
      $set: {
        ...row,
        audit: {
          createUser: 'SYS_ROOT_001',
          createDateTime: new Date().toISOString(),
          lastUpdateUser: 'SYS_ROOT_001',
          lastUpdateDateTime: new Date().toISOString()
        }
      },
      $setOnInsert: {
        createdAt: new Date(),
        createdBy: 'system'
      }
    },
    { upsert: true }
  );
  print(`Upserted symbol ${row.name} (${row.id})`);
}

SYMBOLS.forEach(upsertSymbol);
print('School report symbols upsert complete.');
