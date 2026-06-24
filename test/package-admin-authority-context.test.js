const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packagesRoot = path.join(root, 'packages');
const forbiddenPatterns = [
  /\badminChekersService\.isAdmin\s*\(\s*[^,\n\r)]+\s*\)/g,
  /\badminChekersService\.isOrgAdmin\s*\(\s*[^,\n\r)]+\s*\)/g,
  /\badminAuthorityService\.isAdmin\s*\(\s*[^,\n\r)]+\s*\)/g,
  /\badminAuthorityService\.isOrgAdmin\s*\(\s*[^,\n\r)]+\s*\)/g
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(abs, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    if (/^packages\/[^/]+\/test\//.test(rel)) continue;
    out.push(abs);
  }
  return out;
}

const offenders = [];
for (const file of walk(packagesRoot)) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      offenders.push(`${rel}:${line}: ${match[0]}`);
    }
  }
}

assert.deepStrictEqual(offenders, [], `Package admin checks must pass section context:\n${offenders.join('\n')}`);
console.log('package-admin-authority-context tests passed');