#!/usr/bin/env node
'use strict';

/**
 * Compare live MongoDB indexes against mongoIndexManager definitions.
 * Read-only audit — does not create or drop indexes.
 *
 * Usage:
 *   node scripts/core/audit-mongo-indexes.js
 *   node scripts/core/audit-mongo-indexes.js --db=app
 */

const { MongoClient } = require('mongodb');
const { getIndexDefinitions } = require('../../MVC/infrastructure/mongo/mongoIndexManager');
const { buildMongoClientOptions } = require('../../MVC/infrastructure/mongo/mongoConnection');
const { loadLocalEnvFile } = require('./ensure-core-list-indexes');

function parseArgs(argv = []) {
  const out = {};
  for (const token of argv) {
    if (!String(token).startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > -1) out[token.slice(2, eq)] = token.slice(eq + 1);
    else out[token.slice(2)] = 'true';
  }
  return out;
}

async function auditMongoIndexes(options = {}) {
  const args = options.args || parseArgs(process.argv.slice(2));
  const env = options.env || process.env;
  const uri = env.MONGODB_URI || env.MONGO_URI;
  if (!uri) {
    console.log('[audit-mongo-indexes] skipped (Mongo URI missing).');
    return { skipped: true, reason: 'missing-uri' };
  }

  const dbName = String(args.db || env.MONGODB_DB || env.MONGO_DB || 'app').trim();
  const defs = getIndexDefinitions({ includePackageIndexes: true });
  const expected = new Map();
  for (const [coll, specs] of Object.entries(defs)) {
    const names = (Array.isArray(specs) ? specs : [])
      .map((spec) => String(spec?.options?.name || '').trim())
      .filter(Boolean);
    expected.set(coll, new Set(names));
  }

  const client = new MongoClient(uri, buildMongoClientOptions({ maxPoolSize: 5 }, uri));
  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();

    const extra = [];
    const missing = [];
    const unknownCollections = [];
    let totalIndexes = 0;
    let extraCount = 0;

    for (const row of collections) {
      const name = row.name;
      const coll = db.collection(name);
      const indexes = await coll.listIndexes().toArray();
      totalIndexes += indexes.length;
      const indexNames = indexes.map((i) => i.name).filter((n) => n !== '_id_');
      const exp = expected.get(name) || new Set();
      const extraNames = indexNames.filter((n) => !exp.has(n));
      const missingNames = [...exp].filter((n) => !indexNames.includes(n));
      const docs = await coll.estimatedDocumentCount();

      if (extraNames.length) {
        extraCount += extraNames.length;
        extra.push({ collection: name, docs, extra: extraNames });
      }
      if (missingNames.length) {
        missing.push({ collection: name, docs, missing: missingNames });
      }
      if (!expected.has(name) && indexNames.length > 0) {
        unknownCollections.push({ collection: name, docs, indexes: indexNames.length });
      }
    }

    const missingCollections = [];
    for (const coll of expected.keys()) {
      if (!collections.find((c) => c.name === coll)) {
        missingCollections.push({
          collection: coll,
          missing: [...expected.get(coll)]
        });
      }
    }

    return {
      skipped: false,
      dbName,
      collectionCount: collections.length,
      totalIndexes,
      extraCount,
      extra,
      missing,
      unknownCollections,
      missingCollections
    };
  } finally {
    await client.close();
  }
}

function printReport(report) {
  if (report.skipped) return;
  console.log(`[audit-mongo-indexes] database=${report.dbName} collections=${report.collectionCount} indexes=${report.totalIndexes} extra=${report.extraCount}`);

  if (report.extra.length) {
    console.log('\nExtra indexes (present in DB, not in code definitions):');
    report.extra
      .sort((a, b) => b.extra.length - a.extra.length)
      .forEach((row) => {
        console.log(`  ${row.collection} (${row.docs} docs): ${row.extra.join(', ')}`);
      });
  } else {
    console.log('\nNo extra indexes outside code definitions (except _id).');
  }

  if (report.missing.length) {
    console.log('\nMissing indexes (defined in code, absent from DB):');
    report.missing
      .sort((a, b) => b.missing.length - a.missing.length)
      .forEach((row) => {
        console.log(`  ${row.collection} (${row.docs} docs): ${row.missing.join(', ')}`);
      });
  } else {
    console.log('\nAll defined indexes exist on collections that are present.');
  }

  if (report.unknownCollections.length) {
    console.log('\nCollections without index definitions (have custom indexes):');
    report.unknownCollections
      .sort((a, b) => b.indexes - a.indexes)
      .slice(0, 25)
      .forEach((row) => {
        console.log(`  ${row.collection}: ${row.indexes} custom index(es), ${row.docs} docs`);
      });
  }

  if (report.missingCollections.length) {
    console.log(`\nCollections not yet created in DB: ${report.missingCollections.length} (indexes will be created on first app connect).`);
  }
}

async function main() {
  loadLocalEnvFile();
  const report = await auditMongoIndexes();
  printReport(report);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[audit-mongo-indexes][error] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  auditMongoIndexes,
  printReport
};
