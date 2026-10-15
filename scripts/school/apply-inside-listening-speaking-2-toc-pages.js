#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const BOOK_ID = String(process.argv[2] || '354910').trim();
const TOTAL_PAGES = 126;

/** Inside Listening and Speaking 2 student book contents (printed page numbers). */
const FULL_TOC_LABELS = [
  { level: 1, label: 'Media Track List (p. i)', startPage: 1 },
  { level: 1, label: 'Acknowledgements (p. iii)', startPage: 3 },
  { level: 1, label: 'The Inside Track to Academic Success (p. vi)', startPage: 6 },
  { level: 1, label: 'Unit 1: Solving a Mystery (Engineering)', startPage: 1 },
  { level: 2, label: 'Vocabulary activities', startPage: 2 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 6 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 4 },
  { level: 3, label: 'Cause and Effect Relationships', startPage: 4 },
  { level: 3, label: 'Facilitating Group Discussions', startPage: 8 },
  { level: 2, label: 'Pronunciation', startPage: 10 },
  { level: 3, label: 'Intonation and Chunking Sentences', startPage: 10 },
  { level: 1, label: 'Unit 2: A Marketplace of Ideas (Business)', startPage: 13 },
  { level: 2, label: 'Vocabulary activities', startPage: 14 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 18 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 16 },
  { level: 3, label: 'Abbreviations and Symbols', startPage: 16 },
  { level: 3, label: 'Supporting Opinions', startPage: 21 },
  { level: 2, label: 'Pronunciation', startPage: 22 },
  { level: 3, label: 'Stress in Numbers', startPage: 22 },
  { level: 1, label: 'Unit 3: Enhancing Reality (Technology)', startPage: 25 },
  { level: 2, label: 'Vocabulary activities', startPage: 26 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 30 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 28 },
  { level: 3, label: 'Signal Phrases', startPage: 28 },
  { level: 3, label: 'Sharing Opinions Politely', startPage: 32 },
  { level: 2, label: 'Pronunciation', startPage: 34 },
  { level: 3, label: 'Sentence Stress', startPage: 34 },
  { level: 1, label: 'Unit 4: Literary Symbols (Literature)', startPage: 37 },
  { level: 2, label: 'Vocabulary activities', startPage: 38 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 42 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 40 },
  { level: 3, label: 'Outlining Notes', startPage: 40 },
  { level: 3, label: 'Giving Short Oral Summaries', startPage: 44 },
  { level: 2, label: 'Pronunciation', startPage: 46 },
  { level: 3, label: 'Dropping the /h/ Sound', startPage: 46 },
  { level: 1, label: 'Unit 5: Creative Solutions (Meteorology)', startPage: 49 },
  { level: 2, label: 'Vocabulary activities', startPage: 50 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 54 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 53 },
  { level: 3, label: 'Listening for Proposals', startPage: 53 },
  { level: 3, label: 'Giving and Responding to Proposals', startPage: 56 },
  { level: 2, label: 'Pronunciation', startPage: 58 },
  { level: 3, label: 'Pronouncing Nasal Sounds', startPage: 58 },
  { level: 1, label: 'Unit 6: What to Eat (Nutrition)', startPage: 61 },
  { level: 2, label: 'Vocabulary activities', startPage: 62 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 66 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 64 },
  { level: 3, label: 'The Cornell Method to Take Notes', startPage: 64 },
  { level: 3, label: 'Preparing Well-Organized Presentations', startPage: 68 },
  { level: 2, label: 'Pronunciation', startPage: 70 },
  { level: 3, label: 'Dropping Syllables', startPage: 70 },
  { level: 1, label: 'Unit 7: Working in the Field (Geology)', startPage: 73 },
  { level: 2, label: 'Vocabulary activities', startPage: 74 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 78 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 76 },
  { level: 3, label: 'Listening for Implications', startPage: 76 },
  { level: 3, label: 'Polite Requests and Interruptions', startPage: 80 },
  { level: 2, label: 'Pronunciation', startPage: 82 },
  { level: 3, label: 'Three-Word Phrasal Verbs', startPage: 82 },
  { level: 1, label: 'Unit 8: The Happiness Formula (Sociology)', startPage: 85 },
  { level: 2, label: 'Vocabulary activities', startPage: 86 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 90 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 89 },
  { level: 3, label: 'Using Mind Maps', startPage: 89 },
  { level: 3, label: 'Checking for Understanding', startPage: 92 },
  { level: 2, label: 'Pronunciation', startPage: 94 },
  { level: 3, label: 'The /h/ Sound in Auxiliary Verbs', startPage: 94 },
  { level: 1, label: 'Unit 9: Stop the Presses (Journalism)', startPage: 97 },
  { level: 2, label: 'Vocabulary activities', startPage: 98 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 102 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 100 },
  { level: 3, label: 'Facts and Opinions', startPage: 100 },
  { level: 3, label: 'Being Persuasive in Academic Discussions', startPage: 104 },
  { level: 2, label: 'Pronunciation', startPage: 106 },
  { level: 3, label: 'Common Reductions', startPage: 106 },
  { level: 1, label: 'Unit 10: Artificial Retina (Medicine)', startPage: 109 },
  { level: 2, label: 'Vocabulary activities', startPage: 110 },
  { level: 3, label: 'Vocabulary activities (continued)', startPage: 114 },
  { level: 2, label: 'Listening and Speaking Skills', startPage: 113 },
  { level: 3, label: 'Using Context to Follow a Lecture', startPage: 113 },
  { level: 3, label: 'Nonverbal Communication', startPage: 116 },
  { level: 2, label: 'Pronunciation', startPage: 118 },
  { level: 3, label: 'Contrastive and Emphatic Stress', startPage: 118 },
  { level: 1, label: 'Index: Academic Word List', startPage: 121 }
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
