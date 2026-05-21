const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const uploadFolderSettingsService = require('../MVC/services/uploadFolderSettingsService');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPORT_DIR = path.join('GLOBAL', 'migration-reports');

function hasFlag(name) {
  return process.argv.includes(name);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => String(arg || '').startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function resolvePathFromProject(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  return path.isAbsolute(token) ? path.resolve(token) : path.resolve(PROJECT_ROOT, token);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

async function pathExists(targetPath = '') {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function resolveUploadsRoot() {
  const explicit = getArgValue('--uploads-root');
  if (explicit) return resolvePathFromProject(explicit);

  const settings = await readJson(path.join(PROJECT_ROOT, 'data/systemSettings.json'), {});
  const configured = String(settings?.app?.uploadsPath || 'uploads').trim() || 'uploads';
  return resolvePathFromProject(configured);
}

function safeScopeFolder(orgId = '') {
  const token = String(orgId || '').trim();
  if (!token || token.toUpperCase() === 'GLOBAL' || token.toUpperCase() === 'SYSTEM') return 'GLOBAL';
  return `ORG_${token.replace(/^ORG_/i, '')}`;
}

async function copyDirectoryIfNeeded(sourcePath, targetPath, apply, report, label) {
  const sourceExists = await pathExists(sourcePath);
  if (!sourceExists) {
    report.missing.push({ label, sourcePath });
    return;
  }
  const targetExists = await pathExists(targetPath);
  if (targetExists) {
    report.skipped.push({ label, sourcePath, targetPath, reason: 'target_exists' });
    return;
  }
  report.planned.push({ label, sourcePath, targetPath });
  if (!apply) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true });
  report.copied.push({ label, sourcePath, targetPath });
}

async function copyFileIfNeeded(sourcePath, targetPath, apply, report, label) {
  const sourceExists = await pathExists(sourcePath);
  if (!sourceExists) return;
  const targetExists = await pathExists(targetPath);
  if (targetExists) {
    report.skipped.push({ label, sourcePath, targetPath, reason: 'target_exists' });
    return;
  }
  report.planned.push({ label, sourcePath, targetPath });
  if (!apply) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  report.copied.push({ label, sourcePath, targetPath });
}

async function migrateClassStorage({ uploadsRoot, apply, report }) {
  const classes = await readJson(path.join(PROJECT_ROOT, 'data/school/classes.json'), []);
  const sourceRoot = path.join(PROJECT_ROOT, 'data/school/classes_storage');
  for (const row of Array.isArray(classes) ? classes : []) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    const scopeFolder = safeScopeFolder(row?.orgId);
    await copyDirectoryIfNeeded(
      path.join(sourceRoot, id),
      path.join(uploadsRoot, scopeFolder, uploadFolderSettingsService.resolveUploadFolder('school.classWorkspace', { classId: id })),
      apply,
      report,
      `class:${id}`
    );
  }
}

async function migrateSubjectStorage({ uploadsRoot, apply, report }) {
  const subjects = await readJson(path.join(PROJECT_ROOT, 'data/school/subjects.json'), []);
  const sourceRoot = path.join(PROJECT_ROOT, 'data/school/subjects_storage');
  for (const row of Array.isArray(subjects) ? subjects : []) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    const scopeFolder = safeScopeFolder(row?.orgId);
    await copyDirectoryIfNeeded(
      path.join(sourceRoot, id),
      path.join(uploadsRoot, scopeFolder, uploadFolderSettingsService.resolveUploadFolder('school.subjectWorkspace', { subjectId: id })),
      apply,
      report,
      `subject:${id}`
    );
  }
}

async function migrateBenchpathReports({ uploadsRoot, apply, report }) {
  const sourceRoot = path.join(PROJECT_ROOT, 'Reports');
  if (!fsSync.existsSync(sourceRoot)) return;
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^benchpath-migration-(dry-run|apply)-[A-Za-z0-9._-]+\.json$/.test(entry.name)) continue;
    await copyFileIfNeeded(
      path.join(sourceRoot, entry.name),
      path.join(uploadsRoot, 'GLOBAL', uploadFolderSettingsService.resolveUploadFolder('generated.benchpathReports'), entry.name),
      apply,
      report,
      `benchpath-report:${entry.name}`
    );
  }
}

async function writeReport({ uploadsRoot, report }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(uploadsRoot, DEFAULT_REPORT_DIR, `file-asset-migration-${stamp}.json`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

async function main() {
  const apply = hasFlag('--apply');
  const uploadsRoot = await resolveUploadsRoot();
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    uploadsRoot,
    planned: [],
    copied: [],
    skipped: [],
    missing: [],
    errors: []
  };

  await migrateClassStorage({ uploadsRoot, apply, report });
  await migrateSubjectStorage({ uploadsRoot, apply, report });
  await migrateBenchpathReports({ uploadsRoot, apply, report });

  const reportPath = await writeReport({ uploadsRoot, report });
  report.reportPath = reportPath;
  console.log(JSON.stringify({
    mode: report.mode,
    uploadsRoot,
    planned: report.planned.length,
    copied: report.copied.length,
    skipped: report.skipped.length,
    missing: report.missing.length,
    reportPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
