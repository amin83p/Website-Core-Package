/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TARGET = path.join(ROOT, 'packages', 'school');

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(filePath);
    else if (entry.name.endsWith('.js') && entry.name !== 'bulk-fetch-all-data.js') {
      const content = fs.readFileSync(filePath, 'utf8');
      const next = content
        .replace(/schoolDataService\.fetchData\(([^,\n]+),\s*\{\s*\}/g, 'schoolDataService.fetchAllData($1, {}')
        .replace(/dataService\.fetchData\(([^,\n]+),\s*\{\s*\}/g, 'dataService.fetchAllData($1, {}');
      if (next !== content) {
        fs.writeFileSync(filePath, next);
        console.log('updated', path.relative(TARGET, filePath));
      }
    }
  }
}

walk(TARGET);
