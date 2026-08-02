#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { connectMongo, disconnectMongo } = require('../MVC/infrastructure/mongo/mongoConnection');
const teachingOutlineCatalogService = require('../packages/school/MVC/services/school/teachingOutlineCatalogService');
const { WRITING_ITEMS_BY_LEVEL } = require('../packages/school/MVC/services/school/teachingOutlineSeedData');
const schoolRepositories = require('../packages/school/MVC/repositories/school');

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

async function main() {
  loadEnv();
  const orgId = String(process.env.SCHOOL_DEFAULT_ORG_ID || DEFAULT_ORG_ID).trim();
  process.env.DATA_BACKEND = process.env.DATA_BACKEND || 'mongo';
  await connectMongo({ dbName: process.env.MONGODB_DB || 'app' });
  try {
    const levels = await schoolRepositories.teachingOutlineLevels.list({
      query: { orgId__eq: orgId },
      scope: { canViewAll: true }
    });
    const level = (levels || []).find((row) => row.code === 'clb_1');
    if (!level) throw new Error(`CLB 1 level not found for org ${orgId}`);
    const seed = WRITING_ITEMS_BY_LEVEL.clb_1;
    const imported = await teachingOutlineCatalogService.importItemsForSkillLevel(
      orgId,
      'writing',
      level.id,
      seed,
      ACTOR
    );
    const items = await schoolRepositories.teachingOutlineItems.list({
      query: { orgId__eq: orgId, skillId__eq: 'writing', levelId__eq: level.id },
      scope: { canViewAll: true }
    });
    const selectable = (items || []).filter((row) => row.isSelectable);
    console.log(`Writing CLB 1 re-import complete for org=${orgId}.`);
    console.log(`Level id: ${level.id}`);
    console.log(`Seed rows: ${seed.length}, imported: ${imported.length}, in Mongo: ${items.length}, selectable: ${selectable.length}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`Writing CLB 1 re-import failed: ${error.message}`);
  process.exit(1);
});
