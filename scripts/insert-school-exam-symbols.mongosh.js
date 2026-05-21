/**
 * Insert symbols for school exam sections (dashboard icons via mapSymbolsToSections).
 * Section ids must match your DB: 446000–446004 (see data/mongoInsert-schoolExamSections.json).
 *
 * From repo root:
 *   mongosh "<URI>/<DB>" scripts/insert-school-exam-symbols.mongosh.js
 */
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(process.cwd(), 'data', 'mongoInsert-schoolExamSymbols.json');
if (!fs.existsSync(jsonPath)) {
  print('ERROR: File not found:', jsonPath);
  print('Run mongosh from the repository root.');
  quit(1);
}

const docs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const coll = db.getCollection('symbols');
const ids = docs.map((d) => d.id);
const conflict = coll.find({ $or: [{ id: { $in: ids } }, { name: { $in: docs.map((d) => d.name) } }] }).toArray();
if (conflict.length) {
  print('ERROR: Symbol id or name already exists — aborting:', conflict.map((c) => `${c.name}(${c.id})`));
  quit(1);
}

const result = coll.insertMany(docs);
print('Inserted', result.insertedCount, 'school exam symbol documents.');
