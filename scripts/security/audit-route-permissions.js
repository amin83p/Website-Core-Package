'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ACCESS_GUARD_PATTERN = new RegExp([
  'requireAccess\\s*\\(',
  'requireAccessAny\\s*\\(',
  'requireChatAccessAny\\s*\\(',
  'requireNotificationCenterOperation\\s*\\(',
  'requireEvolutionViewer',
  'requireDebugAccess\\s*\\(',
  'requireSystemSettingsDownloadAccess',
  'require[A-Za-z0-9_]+(?:Access|Operation|Guard|OperationAny)\\b',
  'require[A-Za-z]*RouteGuard\\s*\\(',
  '\\.\\.\\.withAccess\\s*\\(',
  'withAccess\\s*\\(',
  '\\.\\.\\.[A-Za-z0-9_]+(?:Access|Operation|Guard)'
].join('|'));

function stripLineComments(content = '') {
  return String(content || '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

function extractRouteBlocks(content = '') {
  const cleaned = stripLineComments(content);
  const blocks = [];
  const pattern = /router\.(get|post|put|patch|delete|use)\s*\([\s\S]*?\);\s*/g;
  let match;
  while ((match = pattern.exec(cleaned)) !== null) {
    if (match[1] === 'use') continue;
    const blockText = String(match[0] || '');
    const method = String(match[1] || '').toLowerCase();
    const pathMatch = blockText.match(/router\.\w+\s*\(\s*(?:\[[^\]]+\]|(['"`])([^'"`]+)\1)/);
    const routePath = String(pathMatch?.[2] || pathMatch?.[0] || '').trim();
    blocks.push({ method, routePath: routePath || '/', blockText });
  }
  return blocks;
}

function loadAllowlist(repoRoot) {
  const filePath = path.join(repoRoot, 'scripts', 'security', 'route-permission-allowlist.json');
  if (!fs.existsSync(filePath)) {
    return { files: [], routes: [], routePatterns: [] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    files: Array.isArray(raw.files) ? raw.files : [],
    routes: Array.isArray(raw.routes) ? raw.routes : [],
    routePatterns: Array.isArray(raw.routePatterns) ? raw.routePatterns : []
  };
}

function relativePath(repoRoot, abs) {
  return path.relative(repoRoot, abs).replace(/\\/g, '/');
}

function collectRouteFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(abs, output);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(abs);
    }
  }
  return output;
}

function isAllowlisted(allowlist, fileRel, method, routePath) {
  if (allowlist.files.includes(fileRel)) return true;
  for (const row of allowlist.routes) {
    if (row.file === fileRel && row.method === method && row.routePath === routePath) return true;
  }
  for (const pattern of allowlist.routePatterns) {
    if (pattern.file !== fileRel) continue;
    if (pattern.method && pattern.method !== method) continue;
    if (pattern.routePathRegex && new RegExp(pattern.routePathRegex).test(routePath)) return true;
  }
  return false;
}

function routeWindowHasGuard(fileContent, routePath, method = 'get') {
  const token = String(routePath || '').trim();
  if (!token) return false;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const routeRe = new RegExp(
    `router\\.${String(method || 'get').toLowerCase()}\\s*\\(\\s*['"\`]${esc}['"\`]`,
    'i'
  );
  const match = routeRe.exec(fileContent);
  const idx = match ? match.index : fileContent.indexOf(token);
  if (idx < 0) return false;
  const window = fileContent.slice(Math.max(0, idx - 400), Math.min(fileContent.length, idx + 1200));
  return ACCESS_GUARD_PATTERN.test(window);
}

function auditRouteFile(repoRoot, absPath, allowlist) {
  const content = fs.readFileSync(absPath, 'utf8');
  const fileRel = relativePath(repoRoot, absPath);
  const fileUsesAuth = /router\.use\(\s*requireAuth\s*\)/.test(content);
  const findings = [];

  for (const block of extractRouteBlocks(content)) {
    const needsAuth = /requireAuth/.test(block.blockText) || fileUsesAuth;
    if (!needsAuth) continue;
    const hasAccessGuard = ACCESS_GUARD_PATTERN.test(block.blockText)
      || routeWindowHasGuard(content, block.routePath, block.method);
    if (hasAccessGuard) continue;
    const method = block.method.toUpperCase();
    const routePath = block.routePath || '/';
    if (isAllowlisted(allowlist, fileRel, method, routePath)) continue;
    findings.push({
      file: fileRel,
      method,
      routePath,
      missing: ['requireAccessOrCustomGuard']
    });
  }

  return findings;
}

function runRoutePermissionAudit(repoRoot, options = {}) {
  const enforceCore = options.enforceCore !== false;
  const enforcePackages = options.enforcePackages === true;
  const allowlist = loadAllowlist(repoRoot);

  const roots = [path.join(repoRoot, 'MVC', 'routes')];
  if (enforcePackages) {
    roots.push(path.join(repoRoot, 'packages'));
  }

  const allFindings = [];
  const scannedFiles = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = root.endsWith('packages')
      ? collectRouteFiles(root).filter((f) => f.includes(`${path.sep}MVC${path.sep}routes${path.sep}`))
      : collectRouteFiles(root);
    for (const abs of files) {
      scannedFiles.push(relativePath(repoRoot, abs));
      allFindings.push(...auditRouteFile(repoRoot, abs, allowlist));
    }
  }

  const coreFindings = allFindings.filter((f) => f.file.startsWith('MVC/routes'));
  const packageFindings = allFindings.filter((f) => f.file.startsWith('packages/'));

  return {
    scannedFiles: scannedFiles.length,
    findings: allFindings,
    coreFindings,
    packageFindings,
    enforceCore,
    enforcePackages,
    ok: (enforceCore ? coreFindings.length === 0 : true) && (enforcePackages ? packageFindings.length === 0 : true)
  };
}

function auditDeleteDataWithoutUser(repoRoot) {
  const controllerDirs = [
    path.join(repoRoot, 'MVC', 'controllers'),
    path.join(repoRoot, 'packages')
  ];
  const findings = [];
  const pattern = /deleteData\s*\(\s*['"][^'"]+['"]\s*,\s*[^,\n)]+\s*\)/g;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const content = fs.readFileSync(abs, 'utf8');
        let match;
        while ((match = pattern.exec(content)) !== null) {
          findings.push({
            file: relativePath(repoRoot, abs),
            snippet: match[0].slice(0, 120)
          });
        }
      }
    }
  }

  for (const dir of controllerDirs) walk(dir);
  return findings;
}

if (require.main === module) {
  const repoRoot = path.join(__dirname, '..', '..');
  const enforcePackages = process.argv.includes('--packages');
  const report = runRoutePermissionAudit(repoRoot, { enforceCore: true, enforcePackages });
  const deleteFindings = auditDeleteDataWithoutUser(repoRoot);

  console.log(`Scanned ${report.scannedFiles} route files.`);
  console.log(`Core findings: ${report.coreFindings.length}`);
  console.log(`Package findings: ${report.packageFindings.length}${enforcePackages ? '' : ' (report-only)'}`);
  if (report.coreFindings.length) {
    console.log('\nCore MVC routes missing access guards:');
    report.coreFindings.forEach((row) => {
      console.log(`  ${row.method} ${row.routePath} — ${row.file}`);
    });
  }
  if (enforcePackages && report.packageFindings.length) {
    console.log('\nPackage routes missing access guards:');
    report.packageFindings.slice(0, 50).forEach((row) => {
      console.log(`  ${row.method} ${row.routePath} — ${row.file}`);
    });
    if (report.packageFindings.length > 50) {
      console.log(`  ... and ${report.packageFindings.length - 50} more`);
    }
  }
  if (deleteFindings.length) {
    console.log(`\ndeleteData without requestingUser: ${deleteFindings.length}`);
    deleteFindings.forEach((row) => console.log(`  ${row.file}: ${row.snippet}`));
  }

  const exitCode = report.ok && deleteFindings.length === 0 ? 0 : 1;
  process.exit(exitCode);
}

module.exports = {
  runRoutePermissionAudit,
  auditDeleteDataWithoutUser,
  extractRouteBlocks,
  ACCESS_GUARD_PATTERN
};