'use strict';

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
const { SAMPLE_WORD_OF_DAY_ENTRIES, DEFAULT_ORG_ID } = require('./wordOfDaySampleData');

const COLLECTION = 'schoolWordOfDay';

function parseArgs(argv) {
  const out = { apply: false, orgId: process.env.ORG_ID || process.env.ACTIVE_ORG_ID || DEFAULT_ORG_ID };
  for (const token of argv) {
    if (token === '--apply') out.apply = true;
    else if (token.startsWith('--org=')) out.orgId = token.slice('--org='.length).trim() || out.orgId;
  }
  return out;
}

function rowsForOrg(orgId) {
  return SAMPLE_WORD_OF_DAY_ENTRIES.map((row) => ({
    ...row,
    orgId: String(orgId || row.orgId || DEFAULT_ORG_ID).trim()
  }));
}

async function main() {
  const { apply, orgId } = parseArgs(process.argv.slice(2));
  const rows = rowsForOrg(orgId);

  if (!apply) {
    console.log(JSON.stringify({
      status: 'dry_run',
      collection: COLLECTION,
      orgId,
      count: rows.length,
      ids: rows.map((r) => r.id),
      hint: 'Re-run with --apply to upsert into MongoDB.'
    }, null, 2));
    return;
  }

  await connectMongo();
  const collection = getMongoCollection(COLLECTION);
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    const existing = await collection.findOne({ id });
    const next = { ...(existing || {}), ...row, id };
    if (existing) {
      await collection.replaceOne({ id }, next);
      updated += 1;
    } else {
      await collection.insertOne(next);
      inserted += 1;
    }
  }

  const count = await collection.countDocuments({ orgId, id: { $in: rows.map((r) => r.id) } });
  console.log(JSON.stringify({
    status: 'ok',
    collection: COLLECTION,
    orgId,
    inserted,
    updated,
    verifiedSampleCount: count,
    words: rows.map((r) => ({ id: r.id, word: r.word, status: r.status }))
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