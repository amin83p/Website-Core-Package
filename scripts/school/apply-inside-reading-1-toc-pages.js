#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '555115').trim();
const TOTAL_PAGES = 180;

/** Inside Reading 1 student book contents (printed page numbers). */
const FULL_TOC_LABELS = [
  { level: 1, label: 'Acknowledgements (p. iii)', startPage: 3 },
  { level: 1, label: "An Insider's Guide to Academic Reading (p. vi)", startPage: 6 },
  { level: 1, label: 'Unit 1: Riding Through History (Engineering)', startPage: 1 },
  { level: 2, label: 'Reading Skill: Previewing', startPage: 2 },
  { level: 2, label: 'Reading 1: The History of Bicycles', startPage: 3 },
  { level: 2, label: 'Reading 2: Segway Into the Future', startPage: 10 },
  { level: 2, label: 'Vocabulary activities', startPage: 5 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 12 },
  { level: 1, label: 'Unit 2: Fighting Diseases (Medicine)', startPage: 17 },
  { level: 2, label: 'Reading Skill: Finding the Main Idea', startPage: 17 },
  { level: 2, label: 'Reading 1: The Battle Against Malaria', startPage: 18 },
  { level: 2, label: 'Reading 2: Searching for New Medicines', startPage: 26 },
  { level: 2, label: 'Vocabulary activities', startPage: 22 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 29 },
  { level: 1, label: 'Unit 3: They Know What You Want (Marketing)', startPage: 33 },
  { level: 2, label: 'Reading Skill: Scanning for Specific Information', startPage: 33 },
  { level: 2, label: 'Reading 1: They Know What You Want', startPage: 34 },
  { level: 2, label: "Reading 2: What's in a Name?", startPage: 42 },
  { level: 2, label: 'Vocabulary activities', startPage: 37 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 45 },
  { level: 1, label: 'Unit 4: Identifying People (Sociology)', startPage: 49 },
  { level: 2, label: 'Reading Skill: Identifying Cause and Result', startPage: 49 },
  { level: 2, label: 'Reading 1: Who Are You?', startPage: 50 },
  { level: 2, label: 'Reading 2: Symbolic Clothing', startPage: 58 },
  { level: 2, label: 'Vocabulary activities', startPage: 53 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 61 },
  { level: 1, label: 'Unit 5: Success Story (Psychology)', startPage: 65 },
  { level: 2, label: 'Reading Skill: Identifying Examples', startPage: 65 },
  { level: 2, label: 'Reading 1: What is Success?', startPage: 66 },
  { level: 2, label: 'Reading 2: I Love Me', startPage: 73 },
  { level: 2, label: 'Vocabulary activities', startPage: 69 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 76 },
  { level: 1, label: 'Unit 6: Solving Crimes with Science (Science)', startPage: 81 },
  { level: 2, label: 'Reading Skill: Categorizing Information', startPage: 81 },
  { level: 2, label: 'Reading 1: Solving a Crime with Science: A True Story', startPage: 82 },
  { level: 2, label: 'Reading 2: Forensic Science', startPage: 89 },
  { level: 2, label: 'Vocabulary activities', startPage: 85 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 92 },
  { level: 1, label: 'Unit 7: The Fast-Food Revolution (Business)', startPage: 97 },
  { level: 2, label: 'Reading Skill: Summarizing a Text', startPage: 97 },
  { level: 2, label: 'Reading 1: The Fast-Food Revolution', startPage: 98 },
  { level: 2, label: 'Reading 2: Franchising', startPage: 105 },
  { level: 2, label: 'Vocabulary activities', startPage: 101 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 108 },
  { level: 1, label: 'Unit 8: The Autism Puzzle (Neuroscience)', startPage: 113 },
  { level: 2, label: 'Reading Skill: Making Inferences', startPage: 113 },
  { level: 2, label: 'Reading 1: The Autism Puzzle', startPage: 114 },
  { level: 2, label: 'Reading 2: Looking for Answers', startPage: 121 },
  { level: 2, label: 'Vocabulary activities', startPage: 118 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 124 },
  { level: 1, label: 'Unit 9: Sea of Life (Oceanography)', startPage: 129 },
  { level: 2, label: 'Reading Skill: Reading Statistical Tables', startPage: 129 },
  { level: 2, label: 'Reading 1: Saving the Oceans', startPage: 130 },
  { level: 2, label: 'Reading 2: Exploring the Deep Ocean', startPage: 137 },
  { level: 2, label: 'Vocabulary activities', startPage: 134 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 140 },
  { level: 1, label: 'Unit 10: Giving Nature a Hand (Physiology)', startPage: 145 },
  { level: 2, label: 'Reading Skill: Fact Versus Opinion', startPage: 145 },
  { level: 2, label: 'Reading 1: Giving Nature a Hand', startPage: 146 },
  { level: 2, label: 'Reading 2: Bionic People', startPage: 154 },
  { level: 2, label: 'Vocabulary activities', startPage: 149 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 157 },
  { level: 1, label: 'Index: Academic Word List', startPage: 161 }
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
