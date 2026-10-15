#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '867989').trim();
/** Printed workbook page count (5th ed.); answer key begins on p. 205. */
const TOTAL_PAGES = 240;

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

const FULL_TOC_LABELS = [
  { level: 1, label: 'Part 1: Be: Present and Past', startPage: 1 },
  { level: 2, label: 'Unit 1: Present of Be: Statements', startPage: 1 },
  { level: 2, label: 'Unit 2: Present of Be: Questions', startPage: 6 },
  { level: 2, label: 'Unit 3: Past of Be', startPage: 12 },
  { level: 1, label: 'Part 2: Nouns, Adjectives, Prepositions', startPage: 17 },
  { level: 2, label: 'Unit 4: Count Nouns and Proper Nouns', startPage: 17 },
  { level: 2, label: 'Unit 5: Descriptive Adjectives', startPage: 22 },
  { level: 2, label: 'Unit 6: Prepositions of Place', startPage: 26 },
  { level: 1, label: 'Part 3: Imperatives and the Simple Present', startPage: 30 },
  { level: 2, label: "Unit 7: Imperatives; Suggestions with Let's, Why don't we...?", startPage: 30 },
  { level: 2, label: 'Unit 8: Simple Present: Affirmative and Negative Statements', startPage: 37 },
  { level: 2, label: 'Unit 9: Simple Present: Yes/No Questions and Short Answers', startPage: 41 },
  { level: 2, label: 'Unit 10: Simple Present: Wh- Questions', startPage: 46 },
  { level: 1, label: 'Part 4: There is / There are; Possessives', startPage: 51 },
  { level: 2, label: 'Unit 11: There is / There are', startPage: 51 },
  { level: 2, label: 'Unit 12: Possessive Nouns and Adjectives; Pronouns; Questions with Whose', startPage: 60 },
  { level: 1, label: 'Part 5: Modals: Ability and Permission', startPage: 71 },
  { level: 2, label: 'Unit 13: Ability: Can or Could', startPage: 71 },
  { level: 2, label: 'Unit 14: Permission: Can or May', startPage: 76 },
  { level: 1, label: 'Part 6: Present Progressive', startPage: 80 },
  { level: 2, label: 'Unit 15: Present Progressive: Affirmative and Negative Statements', startPage: 80 },
  { level: 2, label: 'Unit 16: Present Progressive: Yes/No and Wh- Questions', startPage: 87 },
  { level: 2, label: 'Unit 17: Simple Present and Present Progressive; Non-Action Verbs', startPage: 96 },
  { level: 1, label: 'Part 7: Simple Past', startPage: 101 },
  { level: 2, label: 'Unit 18: Simple Past: Statements with Regular Verbs', startPage: 101 },
  { level: 2, label: 'Unit 19: Simple Past: Statements with Irregular Verbs', startPage: 106 },
  { level: 2, label: 'Unit 20: Simple Past: Questions', startPage: 111 },
  { level: 2, label: 'Unit 21: Simple Past: Review', startPage: 118 },
  { level: 1, label: 'Part 8: The Future', startPage: 126 },
  { level: 2, label: 'Unit 22: Be going to for the Future', startPage: 126 },
  { level: 2, label: 'Unit 23: Will for the Future', startPage: 136 },
  { level: 2, label: 'Unit 24: May or Might for Possibility', startPage: 143 },
  { level: 2, label: 'Unit 25: Gerunds and Infinitives', startPage: 148 },
  { level: 1, label: 'Part 9: Count / Non-Count Nouns; Much / Many; Quantifiers', startPage: 151 },
  { level: 2, label: 'Unit 26: Articles with Count and Non-Count Nouns; Some / Any', startPage: 151 },
  { level: 2, label: 'Unit 27: How much and How many; Quantifiers', startPage: 158 },
  { level: 2, label: 'Unit 28: Too many and Too much; Enough + Noun', startPage: 165 },
  { level: 1, label: 'Part 10: Modals: Advice and Necessity', startPage: 170 },
  { level: 2, label: 'Unit 29: Advice: Should and Had better', startPage: 170 },
  { level: 2, label: 'Unit 30: Necessity: Have to and Must', startPage: 176 },
  { level: 1, label: 'Part 11: Comparisons', startPage: 184 },
  { level: 2, label: 'Unit 31: The Comparative', startPage: 184 },
  { level: 2, label: 'Unit 32: Adverbs of Manner', startPage: 188 },
  { level: 2, label: 'Unit 33: Adjective + Enough; Too and Very; As + Adjective + As', startPage: 192 },
  { level: 2, label: 'Unit 34: The Superlative', startPage: 201 },
  { level: 1, label: 'Workbook Answer Key', startPage: 205 }
];

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
    totalPages: TOTAL_PAGES,
    audit: { lastUpdateUser: 'focus-on-grammar-2-workbook-toc-pages', lastUpdateDateTime: new Date().toISOString() }
  });

  console.log(`Updated book ${BOOK_ID} (${book.title} — ${book.subtitle || ''}): ${tableOfContents.length} TOC rows, totalPages=${TOTAL_PAGES}`);
  await disconnectMongo();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
