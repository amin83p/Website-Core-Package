const fs = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IELTS_DIR = path.join(ROOT, 'data', 'ielts');
const SYSTEM_ORG_ID = 'SYSTEM';

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function ensureArrayOrg(items) {
  if (!Array.isArray(items)) return { changed: false, value: items };
  let changed = false;
  const next = items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    if (String(item.orgId || '').trim()) return item;
    changed = true;
    return { ...item, orgId: SYSTEM_ORG_ID };
  });
  return { changed, value: next };
}

function ensureSessionOrg(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return { changed: false, value: session };
  }
  let changed = false;
  const next = { ...session };
  if (!String(next.orgId || '').trim()) {
    next.orgId = SYSTEM_ORG_ID;
    changed = true;
  }
  const metadata = (next.metadata && typeof next.metadata === 'object' && !Array.isArray(next.metadata))
    ? { ...next.metadata }
    : {};
  if (!String(metadata.orgId || '').trim()) {
    metadata.orgId = next.orgId || SYSTEM_ORG_ID;
    changed = true;
  }
  next.metadata = metadata;
  return { changed, value: next };
}

async function writeIfChanged(filePath, changed, value) {
  if (!changed) return false;
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  return true;
}

async function backfillArrayFile(filePath) {
  const current = await readJson(filePath, []);
  const { changed, value } = ensureArrayOrg(current);
  return await writeIfChanged(filePath, changed, value);
}

async function backfillSessionFile(filePath) {
  const current = await readJson(filePath, null);
  const { changed, value } = ensureSessionOrg(current);
  return await writeIfChanged(filePath, changed, value);
}

async function listSessionFiles() {
  const sessionsDir = path.join(IELTS_DIR, 'scoring', 'sessions');
  try {
    const names = await fs.readdir(sessionsDir);
    return names
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .map((name) => path.join(sessionsDir, name));
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function main() {
  const arrayFiles = [
    path.join(IELTS_DIR, 'task2samples.json'),
    path.join(IELTS_DIR, 'microAssessments.json'),
    path.join(IELTS_DIR, 'prompts.json'),
    path.join(IELTS_DIR, 'assessmentSessions.json'),
    path.join(IELTS_DIR, 'scoring', 'index.json')
  ];

  let touched = 0;
  for (const filePath of arrayFiles) {
    if (await backfillArrayFile(filePath)) touched += 1;
  }

  const sessionFiles = await listSessionFiles();
  for (const filePath of sessionFiles) {
    if (await backfillSessionFile(filePath)) touched += 1;
  }

  process.stdout.write(`IELTS orgId backfill complete. Updated files: ${touched}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
