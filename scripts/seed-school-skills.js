#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../MVC/infrastructure/mongo/mongoConnection');
const skillCatalogService = require('../packages/school/MVC/services/school/skillCatalogService');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_ORG_ID = '900000';
const ACTOR = 'SYS_ROOT_001';

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) continue;
    const key = text.slice(0, index).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = text.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function parseArgs(argv = []) {
  const output = { uri: '', db: '', orgId: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    if (['--uri', '-u'].includes(token)) output.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(token)) output.db = argv[++index] || '';
    else if (['--org', '-o'].includes(token)) output.orgId = argv[++index] || '';
    else if (token.startsWith('--uri=')) output.uri = token.slice(6);
    else if (token.startsWith('--db=')) output.db = token.slice(5);
    else if (token.startsWith('--org=')) output.orgId = token.slice(6);
  }
  return output;
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
  const orgId = String(args.orgId || process.env.SCHOOL_DEFAULT_ORG_ID || DEFAULT_ORG_ID).trim();
  if (!orgId) throw new Error('Organization id is required.');

  process.env.DATA_BACKEND = 'mongo';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;

  await connectMongo({ uri, dbName });
  try {
    const rows = await skillCatalogService.ensureOrgDefaultSkills(orgId, ACTOR);
    const codes = rows.map((row) => String(row?.code || '').trim()).filter(Boolean);
    const expected = skillCatalogService.DEFAULT_SKILL_DEFINITIONS.map((row) => row.code);
    const missing = expected.filter((code) => !codes.includes(code));
    const duplicateRows = await getMongoCollection('schoolSkills').aggregate([
      { $match: { orgId } },
      { $group: { _id: '$code', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    if (missing.length) throw new Error(`Missing seeded skill codes: ${missing.join(', ')}`);
    if (duplicateRows.length) throw new Error(`Duplicate skill codes found: ${duplicateRows.map((row) => row._id).join(', ')}`);
    console.log(`School skills seed complete for org=${orgId}.`);
    console.log(`Catalog rows: ${rows.length}; default codes verified: ${expected.length}.`);
    rows.forEach((row) => {
      console.log(`  ${row.code}: ${row.label} (${row.kind}, ${row.active === false ? 'inactive' : 'active'})`);
    });
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`School skills seed failed: ${error.message}`);
  process.exit(1);
});
