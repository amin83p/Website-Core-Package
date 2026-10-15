#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '482098').trim();
const TOTAL_PAGES = 160;

/** Interchange Level 1 Student's Book — titles/topics (printed page numbers). */
const FULL_TOC_LABELS = [
  {
    level: 1,
    label: 'Unit 1: Where are you from? (Introductions and greetings; names, countries, and nationalities)',
    startPage: 2
  },
  {
    level: 1,
    label: 'Unit 2: What do you do? (Jobs, workplaces, and school; daily schedules; clock time)',
    startPage: 8
  },
  { level: 1, label: 'Progress Check (Units 1–2)', startPage: 14 },
  {
    level: 1,
    label: 'Unit 3: How much are these? (Shopping and prices; clothing and personal items; colors and materials)',
    startPage: 16
  },
  {
    level: 1,
    label: 'Unit 4: Do you play the guitar? (Music, movies, and TV shows; entertainers; invitations and excuses; dates and times)',
    startPage: 22
  },
  { level: 1, label: 'Progress Check (Units 3–4)', startPage: 28 },
  {
    level: 1,
    label: 'Unit 5: What an interesting family! (Family members; typical families)',
    startPage: 30
  },
  {
    level: 1,
    label: 'Unit 6: How often do you run? (Sports, fitness activities, and exercise; routines)',
    startPage: 36
  },
  { level: 1, label: 'Progress Check (Units 5–6)', startPage: 42 },
  {
    level: 1,
    label: 'Unit 7: We went dancing! (Free-time and weekend activities)',
    startPage: 44
  },
  {
    level: 1,
    label: "Unit 8: How's the neighborhood? (Stores and places in a city; neighborhoods; houses and apartments)",
    startPage: 50
  },
  { level: 1, label: 'Progress Check (Units 7–8)', startPage: 56 },
  {
    level: 1,
    label: 'Unit 9: What does she look like? (Appearance and dress; clothing and clothing styles; people)',
    startPage: 58
  },
  {
    level: 1,
    label: 'Unit 10: Have you ever been there? (Past experiences; unusual activities)',
    startPage: 64
  },
  { level: 1, label: 'Progress Check (Units 9–10)', startPage: 70 },
  {
    level: 1,
    label: "Unit 11: It's a really nice city. (Cities; hometowns; countries)",
    startPage: 72
  },
  {
    level: 1,
    label: "Unit 12: It's important to get rest. (Health problems; medication and remedies; products in a pharmacy)",
    startPage: 78
  },
  { level: 1, label: 'Progress Check (Units 11–12)', startPage: 84 },
  {
    level: 1,
    label: 'Unit 13: What would you like? (Food and restaurants)',
    startPage: 86
  },
  {
    level: 1,
    label: "Unit 14: It's the coldest city! (World geography and facts; countries)",
    startPage: 92
  },
  { level: 1, label: 'Progress Check (Units 13–14)', startPage: 98 },
  {
    level: 1,
    label: 'Unit 15: What are you doing later? (Invitations and excuses; free-time activities; telephone messages)',
    startPage: 100
  },
  {
    level: 1,
    label: 'Unit 16: How have you changed? (Life changes; plans and hopes for the future)',
    startPage: 106
  },
  { level: 1, label: 'Progress Check (Units 15–16)', startPage: 112 },
  { level: 1, label: 'Grammar Plus', startPage: 132 }
];

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) return;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function computeEndPages(rows) {
  return rows.map((row, index) => {
    let endPage = row.startPage;
    for (let j = index + 1; j < rows.length; j += 1) {
      if (rows[j].level <= row.level) {
        endPage = Math.max(row.startPage, rows[j].startPage - 1);
        break;
      }
    }
    if (index === rows.length - 1) {
      endPage = TOTAL_PAGES;
    }
    return { ...row, endPage };
  });
}

loadEnvFile(path.join(root, '.env'));
const { resolveDataBackendConfig } = require(path.join(root, 'config/dataBackend'));
const { setActiveDataBackendConfig } = require(path.join(root, 'MVC/infrastructure/runtime/dataBackendRuntime'));
const { connectMongo, disconnectMongo, getMongoCollection } = require(path.join(root, 'MVC/infrastructure/mongo/mongoConnection'));
const bookModel = require(path.join(root, 'packages/school/MVC/models/school/bookModel'));
const schoolRepositories = require(path.join(root, 'packages/school/MVC/repositories/school'));

(async () => {
  const cfg = resolveDataBackendConfig(process.env);
  setActiveDataBackendConfig(cfg);
  if (cfg.mode !== 'mongo') throw new Error('Mongo backend required');
  await connectMongo({ uri: cfg.mongo.uri });

  const col = await getMongoCollection('schoolBooks');
  const book = await col.findOne({ id: BOOK_ID });
  if (!book) throw new Error(`Book ${BOOK_ID} not found`);

  const existingByLabel = new Map((book.tableOfContents || []).map((e) => [String(e.label || '').trim(), e]));

  const withPages = FULL_TOC_LABELS.map((row, index) => {
    const prior = existingByLabel.get(row.label.trim());
    return {
      id: prior?.id || bookModel.generateTocEntryId(),
      label: row.label,
      level: row.level,
      startPage: row.startPage,
      sortOrder: index + 1
    };
  });

  const withEnds = computeEndPages(withPages);
  const tableOfContents = bookModel.normalizeTableOfContents(withEnds, TOTAL_PAGES);

  await schoolRepositories.books.update(BOOK_ID, {
    tableOfContents,
    totalPages: TOTAL_PAGES
  });

  console.log(
    `Updated book ${BOOK_ID} (${book.title}${book.subtitle ? ` — ${book.subtitle}` : ''}): `
    + `${tableOfContents.length} TOC rows, totalPages=${TOTAL_PAGES}`
  );
  await disconnectMongo();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
