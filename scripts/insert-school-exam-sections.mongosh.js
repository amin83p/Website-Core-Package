/**
 * Insert school exam navigator + 4 leaf sections into MongoDB collection `sections`.
 *
 * Did NOT auto-update your database — run this when you are ready.
 *
 * From repo root (so data/mongoInsert-schoolExamSections.json resolves):
 *   mongosh "<YOUR_CONNECTION_STRING>/<YOUR_DB_NAME>" scripts/insert-school-exam-sections.mongosh.js
 *
 * Or in mongosh after `use yourDb`, paste the insertMany block from
 * data/mongoInsert-schoolExamSections.json (see file header there).
 *
 * Before insert: ensure string ids 446000–446004 do not already exist in `sections`.
 */
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(process.cwd(), 'data', 'mongoInsert-schoolExamSections.json');
if (!fs.existsSync(jsonPath)) {
  print('ERROR: File not found:', jsonPath);
  print('Run mongosh from the Website-Node-Express-Core repository root.');
  quit(1);
}

const docs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const coll = db.getCollection('sections');
const conflict = coll.find({ id: { $in: docs.map((d) => d.id) } }).toArray();
if (conflict.length) {
  print('ERROR: Section id(s) already exist — aborting. Existing:', conflict.map((c) => c.id));
  quit(1);
}

const result = coll.insertMany(docs);
print('Inserted', result.insertedCount, 'school exam section documents.');
printjson(result.insertedIds);
