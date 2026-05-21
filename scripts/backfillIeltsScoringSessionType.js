const fs = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'data', 'ielts', 'scoring', 'index.json');
const SESSIONS_DIR = path.join(ROOT, 'data', 'ielts', 'scoring', 'sessions');

function normalizePipelineMode(value) {
  return String(value || '').trim().toLowerCase() === 'step3_tuning' ? 'step3_tuning' : 'full';
}

function isSuccessfulStep(session, stepKey) {
  return session?.steps?.[stepKey]?.response?.json?.status === 'success';
}

function isSessionCompleteForPipeline(session, pipelineMode) {
  const mode = normalizePipelineMode(pipelineMode);
  if (mode === 'step3_tuning') {
    return (
      isSuccessfulStep(session, 'step1freeze') &&
      isSuccessfulStep(session, 'step2analyze') &&
      isSuccessfulStep(session, 'step3extract')
    );
  }
  return Boolean(session?.steps?.step6report) || (
    isSuccessfulStep(session, 'step1freeze') &&
    isSuccessfulStep(session, 'step2analyze') &&
    isSuccessfulStep(session, 'step3extract') &&
    isSuccessfulStep(session, 'step4grade') &&
    isSuccessfulStep(session, 'step5feedback')
  );
}

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

async function main() {
  const indexRows = await readJsonSafe(INDEX_FILE, []);
  if (!Array.isArray(indexRows)) {
    throw new Error('Index file is not a JSON array.');
  }

  let updatedRows = 0;
  let modeUpdated = 0;
  let statusUpdated = 0;
  let missingSessions = 0;

  const nextRows = [];
  for (const row of indexRows) {
    const id = String(row?.id || row?.sessionId || '').trim();
    if (!id) {
      nextRows.push(row);
      continue;
    }

    const sessionPath = path.join(SESSIONS_DIR, `${id}.json`);
    const session = await readJsonSafe(sessionPath, null);
    if (!session) {
      missingSessions += 1;
      nextRows.push(row);
      continue;
    }

    const inferredMode = normalizePipelineMode(
      session?.researchConfig?.pipelineMode ||
      session?.metadata?.pipelineMode ||
      row?.pipelineMode
    );
    const inferredStatus = isSessionCompleteForPipeline(session, inferredMode) ? 'Complete' : 'In Progress';

    let changed = false;
    const next = { ...row };

    if (String(next.pipelineMode || '') !== inferredMode) {
      next.pipelineMode = inferredMode;
      modeUpdated += 1;
      changed = true;
    }
    if (String(next.status || '') !== inferredStatus) {
      next.status = inferredStatus;
      statusUpdated += 1;
      changed = true;
    }

    if (changed) updatedRows += 1;
    nextRows.push(next);
  }

  await fs.writeFile(INDEX_FILE, `${JSON.stringify(nextRows, null, 2)}\n`, 'utf8');

  console.log('IELTS scoring session type/status backfill complete.');
  console.log(`Rows scanned: ${indexRows.length}`);
  console.log(`Rows updated: ${updatedRows}`);
  console.log(`pipelineMode updated: ${modeUpdated}`);
  console.log(`status updated: ${statusUpdated}`);
  console.log(`missing session files: ${missingSessions}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
