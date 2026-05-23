#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs').promises;
const path = require('path');
const { resolveDataBackendConfig } = require('../../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../../MVC/infrastructure/mongo/mongoConnection');
const systemSettingsRepository = require('../../../../MVC/repositories/systemSettingsRepository');

const DEFAULT_REPORT_PATH = path.join(
  __dirname,
  '../../../..',
  'data/pte/hard-delete-all-pte-attempts.report.json'
);

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => /^--/.test(arg)));
  const getArgValue = (prefix) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${prefix}=`));
    if (!token) return '';
    return String(token.slice(prefix.length + 1)).trim();
  };

  return {
    apply: flags.has('--apply'),
    reportPath: getArgValue('--report') || DEFAULT_REPORT_PATH
  };
}

function sanitizePathToken(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || fallback;
}

function isPathInsideBase(basePath = '', candidatePath = '') {
  const base = path.resolve(String(basePath || '')).replace(/[\\/]+$/, '');
  const target = path.resolve(String(candidatePath || ''));
  if (!base || !target) return false;
  const baseLower = base.toLowerCase();
  const targetLower = target.toLowerCase();
  return targetLower === baseLower || targetLower.startsWith(`${baseLower}${path.sep.toLowerCase()}`);
}

function toAbsoluteUploadPath(rawPath = '', uploadsRoot = '') {
  const token = String(rawPath || '').trim();
  if (!token || !uploadsRoot) return '';
  const normalizedRoot = path.resolve(uploadsRoot);
  const candidate = token.replace(/^\/+/, '');
  const withoutUploadsPrefix = candidate.replace(/^uploads[\\/]/i, '');
  const resolved = path.isAbsolute(token)
    ? path.resolve(token)
    : path.resolve(path.join(normalizedRoot, withoutUploadsPrefix));
  return isPathInsideBase(normalizedRoot, resolved) ? resolved : '';
}

async function pathExists(targetPath = '') {
  const resolved = path.resolve(String(targetPath || ''));
  if (!resolved) return false;
  try {
    await fs.access(resolved);
    return true;
  } catch (_) {
    return false;
  }
}

async function removePathIfExists(targetPath = '', { recursive = false } = {}) {
  const resolved = path.resolve(String(targetPath || ''));
  if (!resolved) return false;
  if (!(await pathExists(resolved))) return false;
  await fs.rm(resolved, { recursive: Boolean(recursive), force: true });
  return true;
}

async function ensureReportDirectory(reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
}

function collectArtifactFilePaths({ uploadsRoot, artifacts = [], events = [] } = {}) {
  const filePaths = new Set();
  const addPath = (value) => {
    const absolute = toAbsoluteUploadPath(value, uploadsRoot);
    if (absolute) filePaths.add(absolute);
  };

  (Array.isArray(artifacts) ? artifacts : []).forEach((artifact) => {
    addPath(artifact?.path);
  });
  (Array.isArray(events) ? events : []).forEach((event) => {
    const refs = Array.isArray(event?.artifactRefs) ? event.artifactRefs : [];
    refs.forEach((row) => addPath(row?.path));
  });
  return Array.from(filePaths);
}

function collectSessionDirectories({ uploadsRoot, sessions = [] } = {}) {
  const directories = new Set();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const userToken = sanitizePathToken(session?.userId, 'user_unsaved');
    const sessionToken = sanitizePathToken(session?.id, 'session_unsaved');
    const relativeCandidates = [
      path.join(userToken, sessionToken),
      path.join('pte-attempts', userToken, sessionToken)
    ];
    const baseRoots = [
      session?.orgId ? path.join(uploadsRoot, `ORG_${String(session.orgId).trim()}`) : '',
      path.join(uploadsRoot, 'GLOBAL')
    ].filter(Boolean);

    baseRoots.forEach((baseRoot) => {
      const normalizedBaseRoot = path.resolve(baseRoot);
      if (!isPathInsideBase(uploadsRoot, normalizedBaseRoot)) return;
      relativeCandidates.forEach((relativePath) => {
        const targetDirectory = path.resolve(path.join(normalizedBaseRoot, relativePath));
        if (!isPathInsideBase(uploadsRoot, targetDirectory)) return;
        directories.add(targetDirectory);
      });
    });
  });
  return Array.from(directories);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const settings = await systemSettingsRepository.getSettings({ backendMode: 'json' });
  const backend = resolveDataBackendConfig(process.env, {
    preferredMode: 'mongo',
  });
  setActiveDataBackendConfig(backend);
  const mongoConfig = backend.mongo || {};
  const mongoUri = String(mongoConfig.uri || '').trim();
  if (backend.mode !== 'mongo' || !mongoUri) {
    throw new Error('This migration requires Mongo mode and a configured Mongo URI.');
  }

  const uploadsRootRaw = String(settings?.app?.uploadsPath || '').trim();
  const uploadsRoot = uploadsRootRaw ? path.resolve(uploadsRootRaw) : '';

  await connectMongo({ uri: mongoUri });
  try {
    const sessionCollection = getMongoCollection('pteAttemptSessions');
    const itemCollection = getMongoCollection('pteAttemptItems');
    const eventCollection = getMongoCollection('pteAttemptLedgerEvents');
    const artifactCollection = getMongoCollection('pteAttemptArtifacts');

    const [sessions, events, artifacts, totalSessions, totalItems, totalEvents, totalArtifacts] = await Promise.all([
      sessionCollection.find({}, { projection: { id: 1, orgId: 1, userId: 1 } }).toArray(),
      eventCollection.find({}, { projection: { id: 1, artifactRefs: 1 } }).toArray(),
      artifactCollection.find({}, { projection: { id: 1, path: 1 } }).toArray(),
      sessionCollection.countDocuments({}),
      itemCollection.countDocuments({}),
      eventCollection.countDocuments({}),
      artifactCollection.countDocuments({})
    ]);

    const candidateFilePaths = uploadsRoot
      ? collectArtifactFilePaths({ uploadsRoot, artifacts, events })
      : [];
    const candidateDirectories = uploadsRoot
      ? collectSessionDirectories({ uploadsRoot, sessions })
      : [];

    let existingFileCount = 0;
    for (const filePath of candidateFilePaths) {
      // eslint-disable-next-line no-await-in-loop
      if (await pathExists(filePath)) existingFileCount += 1;
    }
    let existingDirectoryCount = 0;
    for (const dirPath of candidateDirectories) {
      // eslint-disable-next-line no-await-in-loop
      if (await pathExists(dirPath)) existingDirectoryCount += 1;
    }

    let removedFileCount = 0;
    let removedDirectoryCount = 0;
    if (args.apply) {
      for (const filePath of candidateFilePaths) {
        // eslint-disable-next-line no-await-in-loop
        if (await removePathIfExists(filePath)) removedFileCount += 1;
      }
      for (const dirPath of candidateDirectories) {
        // eslint-disable-next-line no-await-in-loop
        if (await removePathIfExists(dirPath, { recursive: true })) removedDirectoryCount += 1;
      }
    }

    let deletedSessions = 0;
    let deletedItems = 0;
    let deletedEvents = 0;
    let deletedArtifacts = 0;
    if (args.apply) {
      const [artifactsDeleteResult, eventsDeleteResult, itemsDeleteResult, sessionsDeleteResult] = await Promise.all([
        artifactCollection.deleteMany({}),
        eventCollection.deleteMany({}),
        itemCollection.deleteMany({}),
        sessionCollection.deleteMany({})
      ]);
      deletedArtifacts = Number(artifactsDeleteResult?.deletedCount || 0);
      deletedEvents = Number(eventsDeleteResult?.deletedCount || 0);
      deletedItems = Number(itemsDeleteResult?.deletedCount || 0);
      deletedSessions = Number(sessionsDeleteResult?.deletedCount || 0);
    }

    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry_run',
      collections: {
        sessions: {
          existingCount: totalSessions,
          deletedCount: deletedSessions
        },
        items: {
          existingCount: totalItems,
          deletedCount: deletedItems
        },
        events: {
          existingCount: totalEvents,
          deletedCount: deletedEvents
        },
        artifacts: {
          existingCount: totalArtifacts,
          deletedCount: deletedArtifacts
        }
      },
      uploadCleanup: {
        uploadsRoot,
        candidateFilePaths: candidateFilePaths.length,
        existingFilePaths: existingFileCount,
        removedFilePaths: removedFileCount,
        candidateDirectories: candidateDirectories.length,
        existingDirectories: existingDirectoryCount,
        removedDirectories: removedDirectoryCount
      }
    };

    await ensureReportDirectory(args.reportPath);
    await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[pte:hard-delete-all-pte-attempts] mode=${report.mode}`);
    console.log(`[pte:hard-delete-all-pte-attempts] sessions=${totalSessions} items=${totalItems} events=${totalEvents} artifacts=${totalArtifacts}`);
    console.log(`[pte:hard-delete-all-pte-attempts] uploadCandidates files=${candidateFilePaths.length} dirs=${candidateDirectories.length}`);
    if (args.apply) {
      console.log(`[pte:hard-delete-all-pte-attempts] deleted sessions=${deletedSessions} items=${deletedItems} events=${deletedEvents} artifacts=${deletedArtifacts}`);
      console.log(`[pte:hard-delete-all-pte-attempts] removedUpload files=${removedFileCount} dirs=${removedDirectoryCount}`);
    }
    console.log(`[pte:hard-delete-all-pte-attempts] report=${args.reportPath}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`[pte:hard-delete-all-pte-attempts][error] ${error.message}`);
  process.exitCode = 1;
});

