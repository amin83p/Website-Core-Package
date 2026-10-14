#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnvFile(path.join(__dirname, '../../.env'));
const { resolveDataBackendConfig } = require('../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../MVC/infrastructure/mongo/mongoConnection');
const { runByRepositoryBackend } = require('../../MVC/repositories/backend/repositoryBackendSelector');
const { normalizeMongoDocument } = require('../../MVC/repositories/backend/mongoRepositoryUtils');
const bookModel = require('../../packages/school/MVC/models/school/bookModel');
const schoolRepositories = require('../../packages/school/MVC/repositories/school');
const { convertGeminiBookTocSource, findBookByTitle } = require('./bookTocImportLib');

async function bootstrapActiveBackend() {
  const backendConfig = resolveDataBackendConfig(process.env);
  setActiveDataBackendConfig(backendConfig);
  if (backendConfig.mode === 'mongo') {
    const uri = String(backendConfig?.mongo?.uri || '').trim();
    if (!uri) throw new Error('Mongo is the active backend but no Mongo URI is configured (MONGODB_URI).');
    await connectMongo({ uri });
  }
  return backendConfig.mode;
}

async function listBooksForImport() {
  return runByRepositoryBackend({}, {
    json: async () => bookModel.getAllBooks(),
    mongo: async () => {
      const rows = await getMongoCollection('schoolBooks').find({}).toArray();
      return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
    }
  }, 'school.books.listForImport');
}

async function updateBookToc(target, normalizedToc, totalPages) {
  const payload = {
    tableOfContents: normalizedToc,
    totalPages: totalPages || target.totalPages,
    audit: { lastUpdateUser: 'book-toc-import' }
  };
  return runByRepositoryBackend({}, {
    json: async () => bookModel.updateBook(target.id, payload),
    mongo: async () => schoolRepositories.books.update(target.id, payload)
  }, 'school.books.applyToc');
}

async function main() {
  const sourcePath = path.resolve(process.argv[2] || '');
  const bookIdArg = String(process.argv[3] || '').trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    console.error('Usage: node scripts/school/apply-book-toc-from-source.js <source.json> [bookId]');
    process.exit(1);
  }

  const backendMode = await bootstrapActiveBackend();

  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const converted = convertGeminiBookTocSource(source);
  const books = await listBooksForImport();

  const importDir = path.join(path.dirname(sourcePath), '..', 'book-toc-imports');
  fs.mkdirSync(importDir, { recursive: true });
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const exportPath = path.join(importDir, `${baseName}.tableOfContents.json`);
  fs.writeFileSync(exportPath, JSON.stringify({
    bookTitle: converted.bookTitle,
    suggestedTotalPages: converted.suggestedTotalPages,
    tableOfContents: converted.tableOfContents
  }, null, 2));

  let target = bookIdArg ? books.find((row) => String(row.id) === bookIdArg) : findBookByTitle(books, converted.bookTitle);
  if (!target) {
    console.log(`Converted ${converted.tableOfContents.length} TOC rows for "${converted.bookTitle}".`);
    console.log(`Saved: ${exportPath}`);
    console.log(`Active backend: ${backendMode}. No matching book — pass the book id as the second argument.`);
    process.exit(2);
  }

  const totalPages = converted.suggestedTotalPages || target.totalPages || null;
  const normalizedToc = bookModel.normalizeTableOfContents(converted.tableOfContents, totalPages);
  const updated = await updateBookToc(target, normalizedToc, totalPages);

  console.log(`Updated book "${updated.title}" (${updated.id}) with ${normalizedToc.length} TOC entries.`);
  console.log(`Backend: ${backendMode}`);
  console.log(`Suggested total pages: ${totalPages || '(unchanged)'}`);
  console.log(`Export copy: ${exportPath}`);
}

if (require.main === module) {
  main()
    .then(async () => {
      await disconnectMongo().catch(() => {});
      process.exit(0);
    })
    .catch(async (error) => {
      await disconnectMongo().catch(() => {});
      console.error(error.message || error);
      process.exit(1);
    });
}

module.exports = {
  bootstrapActiveBackend,
  listBooksForImport,
  updateBookToc,
  main
};
