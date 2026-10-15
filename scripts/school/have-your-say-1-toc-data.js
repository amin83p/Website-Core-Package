'use strict';

const fs = require('fs');
const path = require('path');

const LINES_PATH = path.join(__dirname, 'have-your-say-1-toc-lines.txt');

function buildHaveYourSay1TocLabels() {
  const raw = fs.readFileSync(LINES_PATH, 'utf8');
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length < 3) continue;
    const level = Number(parts[0]);
    const startPage = Number(parts[parts.length - 1]);
    const label = parts.slice(1, -1).join('|').trim();
    if (!Number.isFinite(level) || level < 1 || level > 4) continue;
    if (!Number.isFinite(startPage) || !label) continue;
    rows.push({ level, label, startPage });
  }
  return rows;
}

module.exports = { buildHaveYourSay1TocLabels };
