#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { DEFAULT_LEVELS } = require('../packages/school/MVC/services/school/teachingOutlineSeedData');
const { generateLevelId } = require('../packages/school/MVC/models/school/teachingOutlineLevelModel');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const COLLECTION = 'schoolTeachingOutlineLevels';
const DEFAULT_ORG_ID = '900000';

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

function parseArgs(argv) {
  const result = { uri: '', db: '', org: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (['--uri', '-u'].includes(token)) result.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(token)) result.db = argv[++index] || '';
    else if (['--org', '-o'].includes(token)) result.org = argv[++index] || '';
    else if (token.startsWith('--org=')) result.org = token.slice(6);
  }
  return result;
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

function buildAudit(existing = null) {
  return {
    createUser: existing?.audit?.createUser || ACTOR,
    createDateTime: existing?.audit?.createDateTime || NOW,
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function buildLevelDoc(seed, orgId, existing = null) {
  return {
    id: String(existing?.id || generateLevelId()),
    orgId: String(orgId),
    code: seed.code,
    title: seed.title,
    shortTitle: seed.shortTitle || seed.title,
    levelKind: seed.levelKind || 'benchmark',
    sortOrder: Number(seed.sortOrder || 100),
    matchAliases: Array.isArray(seed.matchAliases) ? seed.matchAliases : [],
    description: seed.description || '',
    isActive: seed.isActive !== false,
    audit: buildAudit(existing)
  };
}

async function upsertLevels(db, orgId) {
  const collection = db.collection(COLLECTION);
  let inserted = 0;
  let updated = 0;

  for (const seed of DEFAULT_LEVELS) {
    const existing = await collection.findOne({ orgId: String(orgId), code: seed.code });
    const doc = buildLevelDoc(seed, orgId, existing);

    if (existing) {
      await collection.updateOne(
        { _id: existing._id },
        { $set: doc }
      );
      updated += 1;
    } else {
      await collection.insertOne(doc);
      inserted += 1;
    }
  }

  return { inserted, updated, total: DEFAULT_LEVELS.length };
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(
    args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app'
  ).trim();
  const orgId = String(args.org || process.env.SCHOOL_DEFAULT_ORG_ID || DEFAULT_ORG_ID).trim();
  if (!orgId) throw new Error('Organization id is required. Pass --org or set SCHOOL_DEFAULT_ORG_ID.');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const result = await upsertLevels(db, orgId);
    console.log(`Teaching outline levels seed complete for org=${orgId}.`);
    console.log(`Inserted: ${result.inserted}, Updated: ${result.updated}, Total levels: ${result.total}`);
    console.log(`Levels: ${DEFAULT_LEVELS.map((row) => row.code).join(', ')}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Teaching outline levels seed failed: ${error.message}`);
  process.exit(1);
});
