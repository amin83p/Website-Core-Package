#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadArgValue(argv, flags) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (flags.includes(token)) {
      const next = String(argv[i + 1] || '').trim();
      if (next) return next;
    }
    for (const flag of flags) {
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
    }
  }
  return '';
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function printUsage() {
  console.log(`Usage:
  node scripts/package-evolution.js scan [--since <sha>] [--mark] [--out <file.json>]
  node scripts/package-evolution.js import --file <enriched.json> [--publish]
  node scripts/package-evolution.js collections-hint --file <paths.txt|json>
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = String(argv[0] || '').trim().toLowerCase();
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }

  const packageEvolutionService = require(path.join(ROOT, 'MVC/services/packageEvolutionService'));
  const packageEvolutionPathMapperService = require(path.join(ROOT, 'MVC/services/packageEvolutionPathMapperService'));

  if (cmd === 'scan') {
    const sinceSha = loadArgValue(argv, ['--since']);
    const outFile = loadArgValue(argv, ['--out']);
    const mark = hasFlag(argv, '--mark');
    const result = await packageEvolutionService.scanGitCommits({ sinceSha, cwd: ROOT });
    const payload = {
      scannedAt: new Date().toISOString(),
      sinceSha: result.sinceSha,
      commitsScanned: result.commitsScanned,
      newestSha: result.newestSha,
      items: result.items
    };
    const json = JSON.stringify(payload, null, 2);
    if (outFile) {
      fs.writeFileSync(path.resolve(outFile), json, 'utf8');
      console.log(`Wrote ${result.items.length} stub item(s) to ${outFile}`);
    } else {
      console.log(json);
    }
    if (mark && result.newestSha) {
      await packageEvolutionService.markScanCursor(result.newestSha);
      console.error(`Marked scan cursor at ${result.newestSha}`);
    }
    return;
  }

  if (cmd === 'import') {
    const filePath = loadArgValue(argv, ['--file', '-f']);
    if (!filePath) throw new Error('--file is required for import.');
    const publish = hasFlag(argv, '--publish');
    const abs = path.resolve(filePath);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const items = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);
    const result = await packageEvolutionService.importItems({ items }, { publish });
    console.log(JSON.stringify({
      status: 'success',
      created: result.created,
      updated: result.updated,
      total: result.rows.length
    }, null, 2));
    return;
  }

  if (cmd === 'collections-hint') {
    const filePath = loadArgValue(argv, ['--file', '-f']);
    let paths = [];
    if (filePath) {
      const abs = path.resolve(filePath);
      const text = fs.readFileSync(abs, 'utf8').trim();
      if (text.startsWith('[')) paths = JSON.parse(text);
      else paths = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } else {
      paths = argv.slice(1).filter((token) => !token.startsWith('-'));
    }
    const collections = packageEvolutionPathMapperService.suggestCollectionsFromFiles(paths);
    console.log(JSON.stringify({ paths: paths.length, collections }, null, 2));
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});