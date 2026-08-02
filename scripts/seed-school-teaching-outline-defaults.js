#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { connectMongo, disconnectMongo } = require('../MVC/infrastructure/mongo/mongoConnection');
const teachingOutlineCatalogService = require('../packages/school/MVC/services/school/teachingOutlineCatalogService');

const ACTOR = 'SYS_ROOT_001';
const ROOT_DIR = path.resolve(__dirname, '..');
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
  const result = { uri: '', db: '', org: '', forceItems: false, reconcileSections: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (['--uri', '-u'].includes(token)) result.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(token)) result.db = argv[++index] || '';
    else if (['--org', '-o'].includes(token)) result.org = argv[++index] || '';
    else if (token === '--force-items') result.forceItems = true;
    else if (token === '--reconcile-sections') result.reconcileSections = true;
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

  process.env.DATA_BACKEND = process.env.DATA_BACKEND || 'mongo';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;

  await connectMongo({ uri, dbName });
  try {
    const result = await teachingOutlineCatalogService.ensureOrgTeachingOutlineDefaults(
      orgId,
      ACTOR,
      {
        forceItems: args.forceItems,
        reconcileSectionPolicies: args.reconcileSections,
        sectionPolicySkillIds: ['writing']
      }
    );
    const levels = result?.levels || [];
    const templates = result?.templates || [];
    const items = result?.items || [];
    console.log(`Teaching outline defaults seed complete for org=${orgId}.`);
    console.log(`Levels: ${levels.length}, Section templates: ${templates.length}, Items: ${items.length}`);
    if (args.forceItems) console.log('Item seed was forced (--force-items).');
    if (args.reconcileSections) {
      const writingTemplate = templates.find((row) => row.skillId === 'writing');
      const writingPolicy = Object.fromEntries(
        (writingTemplate?.sections || []).map((section) => [section.key, section.isSelectable === true])
      );
      console.log(`Writing section session-selectability policy: ${JSON.stringify(writingPolicy)}`);
    }
    teachingOutlineCatalogService.CLB_SKILLS.forEach((skillId) => {
      const skillItems = items.filter((row) => row.skillId === skillId);
      const byLevel = levels.map((level) => {
        const count = skillItems.filter((row) => String(row.levelId) === String(level.id)).length;
        return `${level.code}=${count}`;
      });
      console.log(`  ${skillId}: ${byLevel.join(', ')}`);
    });
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`Teaching outline defaults seed failed: ${error.message}`);
  process.exit(1);
});
