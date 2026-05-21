#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs/promises');
const path = require('path');
const { resolveDataBackendConfig } = require('../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../MVC/infrastructure/mongo/mongoConnection');
const systemSettingsRepository = require('../../MVC/repositories/systemSettingsRepository');
const pteUploadPathUtils = require('../../MVC/utils/pteUploadPathUtils');

const DEFAULT_REPORT_PATH = path.join(
  __dirname,
  '../../data/pte/pte-uploads-org-pte-migration.report.json'
);

const LEGACY_PTE_FOLDER_MAPPINGS = [
  {
    sourceFolder: 'pte-question-bank',
    targetFolder: 'PTE/Question_Bank',
    kind: 'legacyQuestionBankFolder'
  },
  {
    sourceFolder: 'pte-students',
    targetFolder: 'PTE/Students',
    kind: 'legacyPteStudentsFolder'
  },
  {
    sourceFolder: 'pte-public-applicants',
    targetFolder: 'PTE/Public_Applicants',
    kind: 'legacyPtePublicApplicantsFolder'
  }
];

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => /^--/.test(arg)));
  const getArgValue = (prefix) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${prefix}=`));
    if (!token) return '';
    return String(token.slice(prefix.length + 1)).trim();
  };
  return {
    apply: flags.has('--apply'),
    allowLocal: flags.has('--allow-local'),
    uploadsRoot: getArgValue('--uploads-root') || '',
    reportPath: getArgValue('--report') || DEFAULT_REPORT_PATH
  };
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeRelativePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
}

function isScopeDirectoryName(value = '') {
  const token = cleanText(value, 120);
  return token.toUpperCase() === 'GLOBAL' || /^ORG_[A-Za-z0-9_-]+$/i.test(token);
}

function addMappingRequest(requests, sourceRelative, desiredRelative, context = {}) {
  const source = normalizeRelativePath(sourceRelative);
  const desired = normalizeRelativePath(desiredRelative);
  if (!source || !desired || source === desired) return;
  if (!requests.has(source)) {
    requests.set(source, { desired: new Set(), contexts: [] });
  }
  const row = requests.get(source);
  row.desired.add(desired);
  row.contexts.push(context);
}

function mergeMappingRequests(targetRequests, sourceRequests) {
  for (const [source, payload] of sourceRequests.entries()) {
    if (!targetRequests.has(source)) {
      targetRequests.set(source, { desired: new Set(), contexts: [] });
    }
    const targetPayload = targetRequests.get(source);
    for (const desired of payload.desired || []) {
      targetPayload.desired.add(desired);
    }
    targetPayload.contexts.push(...(Array.isArray(payload.contexts) ? payload.contexts : []));
  }
}

function isPathInsideBase(basePath = '', candidatePath = '') {
  const base = path.resolve(String(basePath || '')).replace(/[\\/]+$/, '');
  const target = path.resolve(String(candidatePath || ''));
  if (!base || !target) return false;
  const baseLower = base.toLowerCase();
  const targetLower = target.toLowerCase();
  return targetLower === baseLower || targetLower.startsWith(`${baseLower}${path.sep.toLowerCase()}`);
}

function isSamePath(left = '', right = '') {
  if (!left || !right) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isRailwayUploadRoot(uploadsRoot = '') {
  const resolvedRoot = path.resolve(String(uploadsRoot || ''));
  const railwayMountPath = cleanText(process.env.RAILWAY_VOLUME_MOUNT_PATH, 500);
  if (railwayMountPath && isSamePath(resolvedRoot, railwayMountPath)) return true;

  const hasRailwayEnv = Object.keys(process.env || {}).some((key) => /^RAILWAY_/i.test(key));
  const cwdIsRailwayApp = process.platform !== 'win32' && isSamePath(process.cwd(), '/app');
  const rootIsDefaultRailwayVolume = process.platform !== 'win32' && isSamePath(resolvedRoot, '/app/uploads');
  return hasRailwayEnv && cwdIsRailwayApp && rootIsDefaultRailwayVolume;
}

function toUploadsUrl(relativePath = '') {
  const normalized = normalizeRelativePath(relativePath);
  return normalized ? `/uploads/${normalized}` : '';
}

function toAbsoluteUploadPath(relativePath = '', uploadsRoot = '') {
  const rel = normalizeRelativePath(relativePath);
  if (!rel || !uploadsRoot) return '';
  return path.resolve(path.join(uploadsRoot, rel));
}

function toNormalizedAbsolutePath(rawPath = '') {
  const token = cleanText(rawPath, 2000);
  if (!token) return '';
  return path.resolve(token);
}

function detectScopeTokenFromRelative(relativePath = '') {
  const normalized = normalizeRelativePath(relativePath);
  const scope = normalized.split('/')[0] || '';
  if (!scope) return '';
  if (scope.toUpperCase() === 'GLOBAL') return 'GLOBAL';
  if (/^ORG_[A-Za-z0-9_-]+$/i.test(scope)) return scope;
  return '';
}

function buildScopeTokenFromOrgId(orgId = '') {
  const token = cleanText(orgId, 120);
  if (!token || token.toUpperCase() === 'SYSTEM') return 'GLOBAL';
  return `ORG_${token}`;
}

function extractRelativeUploadPath(pathValue = '', urlValue = '', uploadsRoot = '') {
  const fromUrl = normalizeRelativePath(cleanText(urlValue, 3000).replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?uploads\//i, ''));
  if (fromUrl && detectScopeTokenFromRelative(fromUrl)) return fromUrl;

  const rawPath = cleanText(pathValue, 3000);
  if (!rawPath) return '';
  const normalizedPath = rawPath.replace(/\\/g, '/');
  if (/^\/?uploads\//i.test(normalizedPath)) {
    const rel = normalizeRelativePath(normalizedPath.replace(/^\/?uploads\//i, ''));
    if (rel && detectScopeTokenFromRelative(rel)) return rel;
  }
  if (/^(ORG_[A-Za-z0-9_-]+|GLOBAL)\//i.test(normalizedPath)) {
    const rel = normalizeRelativePath(normalizedPath);
    if (rel && detectScopeTokenFromRelative(rel)) return rel;
  }

  const absolute = toNormalizedAbsolutePath(rawPath);
  if (!absolute || !uploadsRoot || !isPathInsideBase(uploadsRoot, absolute)) return '';
  const rel = normalizeRelativePath(path.relative(uploadsRoot, absolute));
  if (!rel || !detectScopeTokenFromRelative(rel)) return '';
  return rel;
}

function migrateQuestionBankRelative(relativePath = '') {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return '';
  const oldMatch = normalized.match(/^((?:ORG_[^/]+)|GLOBAL)\/pte-question-bank\/(.+)$/i);
  if (oldMatch) {
    return normalizeRelativePath(`${oldMatch[1]}/PTE/Question_Bank/${oldMatch[2]}`);
  }
  const newMatch = normalized.match(/^((?:ORG_[^/]+)|GLOBAL)\/PTE\/Question_Bank\/(.+)$/i);
  if (newMatch) return normalizeRelativePath(normalized);
  return '';
}

function isPublicApplicantRecord(doc = {}) {
  const token = String(doc?.personRoleToken || '').trim().toLowerCase();
  if (!token) return false;
  return token.includes('pte_student_public') || token.includes('public');
}

function migrateApplicantRelative(relativePath = '', isPublicApplicant = false) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return '';
  const targetBucket = isPublicApplicant
    ? pteUploadPathUtils.PTE_BUCKETS.PUBLIC_APPLICANTS
    : pteUploadPathUtils.PTE_BUCKETS.STUDENTS;
  const oldMatch = normalized.match(/^((?:ORG_[^/]+)|GLOBAL)\/pte-students\/(.+)$/i);
  if (oldMatch) {
    return normalizeRelativePath(`${oldMatch[1]}/PTE/${targetBucket}/${oldMatch[2]}`);
  }
  const newMatch = normalized.match(/^((?:ORG_[^/]+)|GLOBAL)\/PTE\/(Students|Public_Applicants)\/(.+)$/i);
  if (newMatch) return normalizeRelativePath(normalized);
  return '';
}

function resolveAttemptBucket(session = {}) {
  const attemptType = cleanText(session?.attemptType, 80).toLowerCase();
  const metadata = session && typeof session.metadata === 'object' ? session.metadata : {};
  const hasSmartPlan = metadata && typeof metadata.smartPractice === 'object';
  if (attemptType === 'test_run') return pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS;
  if (hasSmartPlan) return pteUploadPathUtils.PTE_BUCKETS.SMART_PRACTICE;
  return pteUploadPathUtils.PTE_BUCKETS.PRACTICE_BY_SKILLS;
}

function resolveAttemptNameToken(session = {}, bucket = '') {
  const metadata = session && typeof session.metadata === 'object' ? session.metadata : {};
  const practiceMeta = metadata && typeof metadata.practice === 'object' ? metadata.practice : {};
  const mockMeta = metadata && typeof metadata.mockExam === 'object' ? metadata.mockExam : {};
  if (bucket === pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS) {
    return pteUploadPathUtils.sanitizeFolderToken(
      mockMeta?.testTitle || mockMeta?.testCode || metadata?.testName || '',
      'test_unspecified'
    );
  }
  return pteUploadPathUtils.sanitizeFolderToken(
    practiceMeta?.name || metadata?.practiceName || '',
    'practice_unspecified'
  );
}

function migrateAttemptRelative(relativePath = '', session = {}, itemId = '') {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return '';
  const canonicalMatch = normalized.match(/^((?:ORG_[^/]+)|GLOBAL)\/PTE\/(Practice_By_Skills|Smart_Practice|Mock_Exams)\/(.+)$/i);
  if (canonicalMatch) return normalized;

  const oldA = normalized.match(/^((?:ORG_[^/]+)|GLOBAL)\/pte-attempts\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  const oldB = normalized.match(/^((?:ORG_[^/]+)|GLOBAL)\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  const oldMatch = oldA || oldB;
  if (!oldMatch) return '';

  const scopeToken = oldMatch[1];
  const fileName = path.basename(normalized);
  const bucket = resolveAttemptBucket(session);
  const userToken = pteUploadPathUtils.sanitizeFolderToken(session?.userId, 'user_unsaved');
  const nameToken = resolveAttemptNameToken(session, bucket);
  const sessionToken = pteUploadPathUtils.sanitizeFolderToken(session?.id, 'session_unsaved');
  const itemToken = pteUploadPathUtils.sanitizeFolderToken(itemId || oldMatch[4], 'item_unsaved');
  return normalizeRelativePath(`${scopeToken}/PTE/${bucket}/${userToken}/${nameToken}/${sessionToken}/${itemToken}/${fileName}`);
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

async function ensureDir(targetDir = '') {
  if (!targetDir) return;
  await fs.mkdir(targetDir, { recursive: true });
}

async function readDirEntriesSafe(absDir = '') {
  try {
    return await fs.readdir(absDir, { withFileTypes: true });
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) return [];
    throw error;
  }
}

async function collectRelativeFiles(absDir = '') {
  const files = [];
  const stack = [{ absDir, relDir: '' }];
  while (stack.length) {
    const current = stack.pop();
    // eslint-disable-next-line no-await-in-loop
    const entries = await readDirEntriesSafe(current.absDir);
    for (const entry of entries) {
      const childAbs = path.join(current.absDir, entry.name);
      const childRel = normalizeRelativePath([current.relDir, entry.name].filter(Boolean).join('/'));
      if (entry.isDirectory()) {
        stack.push({ absDir: childAbs, relDir: childRel });
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  }
  return files;
}

async function resolveUniqueTargetRelative(desiredRelative, uploadsRoot, takenTargets) {
  const normalized = normalizeRelativePath(desiredRelative);
  if (!normalized) return '';
  const dirName = path.posix.dirname(normalized);
  const ext = path.extname(normalized);
  const base = path.basename(normalized, ext);
  let candidate = normalized;
  let index = 1;
  while (true) {
    if (takenTargets.has(candidate)) {
      candidate = `${dirName}/${base}_${index}${ext}`;
      index += 1;
      continue;
    }
    const absCandidate = toAbsoluteUploadPath(candidate, uploadsRoot);
    // If target exists on disk, reserve a suffixed name for the incoming source file.
    // Existing target may already be migrated content.
    // eslint-disable-next-line no-await-in-loop
    const exists = await pathExists(absCandidate);
    if (!exists) {
      takenTargets.add(candidate);
      return normalizeRelativePath(candidate);
    }
    candidate = `${dirName}/${base}_${index}${ext}`;
    index += 1;
  }
}

function buildMappingRequests(questionRows = [], applicantRows = [], artifactRows = [], eventRows = [], sessionsById = new Map(), uploadsRoot = '') {
  const requests = new Map();
  const stats = {
    questionBankCandidates: 0,
    applicantCandidates: 0,
    artifactCandidates: 0,
    eventCandidates: 0
  };

  questionRows.forEach((doc) => {
    const mediaAssets = Array.isArray(doc?.mediaAssets) ? doc.mediaAssets : [];
    mediaAssets.forEach((asset) => {
      const sourceRelative = extractRelativeUploadPath(asset?.path, asset?.url, uploadsRoot);
      const desiredRelative = migrateQuestionBankRelative(sourceRelative);
      if (!desiredRelative) return;
      stats.questionBankCandidates += 1;
      addMappingRequest(requests, sourceRelative, desiredRelative, { kind: 'questionBank', docId: doc.id, rowId: asset?.id || '' });
    });
  });

  applicantRows.forEach((doc) => {
    const isPublic = isPublicApplicantRecord(doc);
    const attachments = Array.isArray(doc?.attachments) ? doc.attachments : [];
    attachments.forEach((asset) => {
      const sourceRelative = extractRelativeUploadPath(asset?.path, asset?.url, uploadsRoot);
      const desiredRelative = migrateApplicantRelative(sourceRelative, isPublic);
      if (!desiredRelative) return;
      stats.applicantCandidates += 1;
      addMappingRequest(requests, sourceRelative, desiredRelative, { kind: 'applicant', docId: doc.id, rowId: asset?.id || '' });
    });
  });

  artifactRows.forEach((doc) => {
    const session = sessionsById.get(cleanText(doc?.attemptSessionId, 120)) || {};
    const sourceRelative = extractRelativeUploadPath(doc?.path, doc?.url, uploadsRoot);
    const desiredRelative = migrateAttemptRelative(sourceRelative, session, cleanText(doc?.attemptItemId, 120));
    if (!desiredRelative) return;
    stats.artifactCandidates += 1;
    addMappingRequest(requests, sourceRelative, desiredRelative, { kind: 'artifact', docId: doc.id });
  });

  eventRows.forEach((doc) => {
    const session = sessionsById.get(cleanText(doc?.attemptSessionId, 120)) || {};
    const refs = Array.isArray(doc?.artifactRefs) ? doc.artifactRefs : [];
    refs.forEach((ref) => {
      const sourceRelative = extractRelativeUploadPath(ref?.path, ref?.url, uploadsRoot);
      const desiredRelative = migrateAttemptRelative(
        sourceRelative,
        session,
        cleanText(ref?.attemptItemId || doc?.attemptItemId, 120)
      );
      if (!desiredRelative) return;
      stats.eventCandidates += 1;
      addMappingRequest(requests, sourceRelative, desiredRelative, { kind: 'event', docId: doc.id });
    });
  });

  return { requests, stats };
}

async function buildLegacyFolderMappingRequests(uploadsRoot = '') {
  const requests = new Map();
  const stats = {
    legacyFolderCandidates: 0,
    legacyFoldersScanned: 0
  };
  const scopeEntries = await readDirEntriesSafe(uploadsRoot);

  for (const scopeEntry of scopeEntries) {
    if (!scopeEntry.isDirectory() || !isScopeDirectoryName(scopeEntry.name)) continue;
    for (const mapping of LEGACY_PTE_FOLDER_MAPPINGS) {
      const sourceDir = path.join(uploadsRoot, scopeEntry.name, mapping.sourceFolder);
      // eslint-disable-next-line no-await-in-loop
      const relativeFiles = await collectRelativeFiles(sourceDir);
      if (!relativeFiles.length) continue;
      stats.legacyFoldersScanned += 1;
      relativeFiles.forEach((relativeFile) => {
        const sourceRelative = normalizeRelativePath(`${scopeEntry.name}/${mapping.sourceFolder}/${relativeFile}`);
        const desiredRelative = normalizeRelativePath(`${scopeEntry.name}/${mapping.targetFolder}/${relativeFile}`);
        stats.legacyFolderCandidates += 1;
        addMappingRequest(requests, sourceRelative, desiredRelative, {
          kind: mapping.kind,
          sourceFolder: mapping.sourceFolder,
          skipIfTargetExists: true
        });
      });
    }
  }

  return { requests, stats };
}

async function resolveMappings(requests = new Map(), uploadsRoot = '') {
  const mapping = new Map();
  const conflicts = [];
  const takenTargets = new Set();
  const skippedExistingTargets = [];

  for (const [source, payload] of requests.entries()) {
    const desiredList = Array.from(payload.desired.values());
    if (!desiredList.length) continue;
    let desired = desiredList[0];
    if (desiredList.length > 1) {
      const sourceMatch = desiredList.find((token) => token === source);
      if (sourceMatch) {
        desired = sourceMatch;
      } else {
        conflicts.push({
          source,
          desired: desiredList,
          contexts: payload.contexts.slice(0, 10)
        });
      }
    }
    mapping.set(source, desired);
  }

  const finalized = new Map();
  for (const [source, desired] of mapping.entries()) {
    const payload = requests.get(source) || { contexts: [] };
    if (source === desired) {
      finalized.set(source, desired);
      takenTargets.add(desired);
      continue;
    }

    const sourceAbs = toAbsoluteUploadPath(source, uploadsRoot);
    const targetAbs = toAbsoluteUploadPath(desired, uploadsRoot);
    const sourceExists = await pathExists(sourceAbs);
    const targetExists = await pathExists(targetAbs);
    const skipIfTargetExists = (payload.contexts || []).some((context) => context?.skipIfTargetExists === true);
    if (sourceExists && targetExists && skipIfTargetExists) {
      skippedExistingTargets.push({
        source,
        target: desired,
        contexts: (payload.contexts || []).slice(0, 10)
      });
      takenTargets.add(desired);
      continue;
    }
    if (!sourceExists && targetExists) {
      finalized.set(source, desired);
      takenTargets.add(desired);
      continue;
    }
    const uniqueTarget = await resolveUniqueTargetRelative(desired, uploadsRoot, takenTargets);
    finalized.set(source, uniqueTarget);
  }

  return {
    finalized,
    conflicts,
    skippedExistingTargets
  };
}

async function applyFileMoves(finalized = new Map(), uploadsRoot = '') {
  const out = {
    moved: 0,
    alreadyAtTarget: 0,
    missingSource: 0,
    failed: 0,
    details: []
  };

  for (const [source, target] of finalized.entries()) {
    if (!source || !target || source === target) continue;
    const sourceAbs = toAbsoluteUploadPath(source, uploadsRoot);
    const targetAbs = toAbsoluteUploadPath(target, uploadsRoot);
    // eslint-disable-next-line no-await-in-loop
    const sourceExists = await pathExists(sourceAbs);
    // eslint-disable-next-line no-await-in-loop
    const targetExists = await pathExists(targetAbs);
    if (!sourceExists && targetExists) {
      out.alreadyAtTarget += 1;
      continue;
    }
    if (!sourceExists && !targetExists) {
      out.missingSource += 1;
      out.details.push({ source, target, status: 'missing-source' });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await ensureDir(path.dirname(targetAbs));
      // eslint-disable-next-line no-await-in-loop
      await fs.rename(sourceAbs, targetAbs);
      out.moved += 1;
    } catch (error) {
      out.failed += 1;
      out.details.push({ source, target, status: 'failed', message: error.message });
    }
  }

  return out;
}

function buildCanonicalFields(relativePath = '', uploadsRoot = '') {
  const rel = normalizeRelativePath(relativePath);
  return {
    path: toUploadsUrl(rel),
    url: toUploadsUrl(rel)
  };
}

function resolveFinalRelative(sourceRelative = '', desiredRelative = '', finalized = new Map()) {
  const source = normalizeRelativePath(sourceRelative);
  const desired = normalizeRelativePath(desiredRelative);
  if (!source || !desired) return '';
  if (source === desired) return desired;
  return normalizeRelativePath(finalized.get(source) || desired);
}

function buildDocUpdates(questionRows = [], applicantRows = [], artifactRows = [], eventRows = [], sessionsById = new Map(), finalized = new Map(), uploadsRoot = '') {
  const updates = {
    questionVersions: [],
    applicants: [],
    attemptArtifacts: [],
    attemptEvents: []
  };
  const counters = {
    questionVersions: 0,
    applicants: 0,
    attemptArtifacts: 0,
    attemptEvents: 0
  };

  questionRows.forEach((doc) => {
    const mediaAssets = Array.isArray(doc?.mediaAssets) ? doc.mediaAssets : [];
    let changed = false;
    const nextAssets = mediaAssets.map((asset) => {
      const sourceRelative = extractRelativeUploadPath(asset?.path, asset?.url, uploadsRoot);
      const desiredRelative = migrateQuestionBankRelative(sourceRelative);
      if (!desiredRelative) return asset;
      const finalRelative = resolveFinalRelative(sourceRelative, desiredRelative, finalized);
      if (!finalRelative) return asset;
      const canonical = buildCanonicalFields(finalRelative, uploadsRoot);
      if (cleanText(asset?.path, 3000) === canonical.path && cleanText(asset?.url, 3000) === canonical.url) {
        return asset;
      }
      changed = true;
      return {
        ...(asset && typeof asset === 'object' ? asset : {}),
        path: canonical.path,
        url: canonical.url
      };
    });
    if (!changed) return;
    counters.questionVersions += 1;
    updates.questionVersions.push({ _id: doc._id, id: doc.id, mediaAssets: nextAssets });
  });

  applicantRows.forEach((doc) => {
    const isPublic = isPublicApplicantRecord(doc);
    const attachments = Array.isArray(doc?.attachments) ? doc.attachments : [];
    let changed = false;
    const nextAttachments = attachments.map((asset) => {
      const sourceRelative = extractRelativeUploadPath(asset?.path, asset?.url, uploadsRoot);
      const desiredRelative = migrateApplicantRelative(sourceRelative, isPublic);
      if (!desiredRelative) return asset;
      const finalRelative = resolveFinalRelative(sourceRelative, desiredRelative, finalized);
      if (!finalRelative) return asset;
      const canonical = buildCanonicalFields(finalRelative, uploadsRoot);
      if (cleanText(asset?.path, 3000) === canonical.path && cleanText(asset?.url, 3000) === canonical.url) {
        return asset;
      }
      changed = true;
      return {
        ...(asset && typeof asset === 'object' ? asset : {}),
        path: canonical.path,
        url: canonical.url
      };
    });
    if (!changed) return;
    counters.applicants += 1;
    updates.applicants.push({ _id: doc._id, id: doc.id, attachments: nextAttachments });
  });

  artifactRows.forEach((doc) => {
    const session = sessionsById.get(cleanText(doc?.attemptSessionId, 120)) || {};
    const sourceRelative = extractRelativeUploadPath(doc?.path, doc?.url, uploadsRoot);
    const desiredRelative = migrateAttemptRelative(sourceRelative, session, cleanText(doc?.attemptItemId, 120));
    if (!desiredRelative) return;
    const finalRelative = resolveFinalRelative(sourceRelative, desiredRelative, finalized);
    if (!finalRelative) return;
    const canonical = buildCanonicalFields(finalRelative, uploadsRoot);
    if (cleanText(doc?.path, 3000) === canonical.path && cleanText(doc?.url, 3000) === canonical.url) return;
    counters.attemptArtifacts += 1;
    updates.attemptArtifacts.push({ _id: doc._id, id: doc.id, path: canonical.path, url: canonical.url });
  });

  eventRows.forEach((doc) => {
    const session = sessionsById.get(cleanText(doc?.attemptSessionId, 120)) || {};
    const refs = Array.isArray(doc?.artifactRefs) ? doc.artifactRefs : [];
    let changed = false;
    const nextRefs = refs.map((ref) => {
      const sourceRelative = extractRelativeUploadPath(ref?.path, ref?.url, uploadsRoot);
      const desiredRelative = migrateAttemptRelative(
        sourceRelative,
        session,
        cleanText(ref?.attemptItemId || doc?.attemptItemId, 120)
      );
      if (!desiredRelative) return ref;
      const finalRelative = resolveFinalRelative(sourceRelative, desiredRelative, finalized);
      if (!finalRelative) return ref;
      const canonical = buildCanonicalFields(finalRelative, uploadsRoot);
      if (cleanText(ref?.path, 3000) === canonical.path && cleanText(ref?.url, 3000) === canonical.url) {
        return ref;
      }
      changed = true;
      return {
        ...(ref && typeof ref === 'object' ? ref : {}),
        path: canonical.path,
        url: canonical.url
      };
    });
    if (!changed) return;
    counters.attemptEvents += 1;
    updates.attemptEvents.push({ _id: doc._id, id: doc.id, artifactRefs: nextRefs });
  });

  return { updates, counters };
}

async function writeMongoUpdates(updates = {}, collections = {}) {
  const result = {
    questionVersions: 0,
    applicants: 0,
    attemptArtifacts: 0,
    attemptEvents: 0
  };

  for (const row of updates.questionVersions || []) {
    // eslint-disable-next-line no-await-in-loop
    await collections.questionVersions.updateOne({ _id: row._id }, { $set: { mediaAssets: row.mediaAssets } });
    result.questionVersions += 1;
  }
  for (const row of updates.applicants || []) {
    // eslint-disable-next-line no-await-in-loop
    await collections.applicants.updateOne({ _id: row._id }, { $set: { attachments: row.attachments } });
    result.applicants += 1;
  }
  for (const row of updates.attemptArtifacts || []) {
    // eslint-disable-next-line no-await-in-loop
    await collections.attemptArtifacts.updateOne({ _id: row._id }, { $set: { path: row.path, url: row.url } });
    result.attemptArtifacts += 1;
  }
  for (const row of updates.attemptEvents || []) {
    // eslint-disable-next-line no-await-in-loop
    await collections.attemptEvents.updateOne({ _id: row._id }, { $set: { artifactRefs: row.artifactRefs } });
    result.attemptEvents += 1;
  }
  return result;
}

async function ensureReportDirectory(reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
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

  const configuredUploadRoot = cleanText(
    args.uploadsRoot ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    settings?.app?.uploadsPath,
    500
  );
  const uploadsRoot = configuredUploadRoot
    ? path.resolve(configuredUploadRoot)
    : path.resolve(process.cwd(), 'uploads');
  const workspaceUploadsRoot = path.resolve(process.cwd(), 'uploads');
  const applyingToWorkspaceUploads = isPathInsideBase(workspaceUploadsRoot, uploadsRoot);
  const applyingToRailwayVolume = isRailwayUploadRoot(uploadsRoot);
  if (args.apply && !args.allowLocal && applyingToWorkspaceUploads && !applyingToRailwayVolume) {
    throw new Error(
      `Refusing to apply migration against local workspace uploads root "${uploadsRoot}". ` +
      'Run inside Railway with --uploads-root=/app/uploads, set RAILWAY_VOLUME_MOUNT_PATH=/app/uploads, ' +
      'or pass --allow-local only for an intentional local test.'
    );
  }

  await connectMongo({ uri: mongoUri });
  try {
    const questionVersions = getMongoCollection('pteQuestionVersions');
    const applicants = getMongoCollection('pteApplicants');
    const attemptSessions = getMongoCollection('pteAttemptSessions');
    const attemptArtifacts = getMongoCollection('pteAttemptArtifacts');
    const attemptEvents = getMongoCollection('pteAttemptLedgerEvents');

    const [
      questionRows,
      applicantRows,
      sessionRows,
      artifactRows,
      eventRows
    ] = await Promise.all([
      questionVersions.find({}, { projection: { _id: 1, id: 1, mediaAssets: 1 } }).toArray(),
      applicants.find({}, { projection: { _id: 1, id: 1, personRoleToken: 1, attachments: 1 } }).toArray(),
      attemptSessions.find({}, { projection: { _id: 1, id: 1, orgId: 1, userId: 1, attemptType: 1, metadata: 1 } }).toArray(),
      attemptArtifacts.find({}, { projection: { _id: 1, id: 1, attemptSessionId: 1, attemptItemId: 1, path: 1, url: 1 } }).toArray(),
      attemptEvents.find({}, { projection: { _id: 1, id: 1, attemptSessionId: 1, attemptItemId: 1, artifactRefs: 1 } }).toArray()
    ]);

    const sessionsById = new Map((Array.isArray(sessionRows) ? sessionRows : [])
      .map((row) => [cleanText(row?.id, 120), row]));

    const requestResult = buildMappingRequests(
      questionRows,
      applicantRows,
      artifactRows,
      eventRows,
      sessionsById,
      uploadsRoot
    );
    const legacyRequestResult = await buildLegacyFolderMappingRequests(uploadsRoot);
    mergeMappingRequests(requestResult.requests, legacyRequestResult.requests);

    const { finalized, conflicts, skippedExistingTargets } = await resolveMappings(requestResult.requests, uploadsRoot);
    const { updates, counters } = buildDocUpdates(
      questionRows,
      applicantRows,
      artifactRows,
      eventRows,
      sessionsById,
      finalized,
      uploadsRoot
    );

    const movePreview = {
      requested: Array.from(finalized.entries()).filter(([source, target]) => source !== target).length
    };

    let moveResult = {
      moved: 0,
      alreadyAtTarget: 0,
      missingSource: 0,
      failed: 0,
      details: []
    };
    let writeResult = {
      questionVersions: 0,
      applicants: 0,
      attemptArtifacts: 0,
      attemptEvents: 0
    };

    if (args.apply) {
      moveResult = await applyFileMoves(finalized, uploadsRoot);
      writeResult = await writeMongoUpdates(updates, {
        questionVersions,
        applicants,
        attemptArtifacts,
        attemptEvents
      });
    }

    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry_run',
      uploadsRoot,
      allowLocal: args.allowLocal === true,
      scanned: {
        questionVersions: questionRows.length,
        applicants: applicantRows.length,
        attemptSessions: sessionRows.length,
        attemptArtifacts: artifactRows.length,
        attemptEvents: eventRows.length
      },
      mappingRequests: {
        totalSourceKeys: requestResult.requests.size,
        questionBankCandidates: requestResult.stats.questionBankCandidates,
        applicantCandidates: requestResult.stats.applicantCandidates,
        artifactCandidates: requestResult.stats.artifactCandidates,
        eventCandidates: requestResult.stats.eventCandidates,
        legacyFolderCandidates: legacyRequestResult.stats.legacyFolderCandidates,
        legacyFoldersScanned: legacyRequestResult.stats.legacyFoldersScanned,
        conflicts: conflicts.length
      },
      fileMoves: {
        requested: movePreview.requested,
        moved: moveResult.moved,
        alreadyAtTarget: moveResult.alreadyAtTarget,
        skippedExistingTarget: skippedExistingTargets.length,
        missingSource: moveResult.missingSource,
        failed: moveResult.failed
      },
      rewrites: {
        questionVersionsPlanned: counters.questionVersions,
        applicantsPlanned: counters.applicants,
        attemptArtifactsPlanned: counters.attemptArtifacts,
        attemptEventsPlanned: counters.attemptEvents,
        questionVersionsApplied: writeResult.questionVersions,
        applicantsApplied: writeResult.applicants,
        attemptArtifactsApplied: writeResult.attemptArtifacts,
        attemptEventsApplied: writeResult.attemptEvents
      },
      samples: {
        mapping: Array.from(finalized.entries()).slice(0, 120),
        conflictSamples: conflicts.slice(0, 50),
        skippedExistingTargetSamples: skippedExistingTargets.slice(0, 50),
        failedMoveSamples: moveResult.details.slice(0, 50)
      }
    };

    await ensureReportDirectory(args.reportPath);
    await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[pte:migrate-uploads] mode=${report.mode}`);
    console.log(`[pte:migrate-uploads] mapping keys=${report.mappingRequests.totalSourceKeys}, conflicts=${report.mappingRequests.conflicts}`);
    console.log(`[pte:migrate-uploads] legacy folder candidates=${report.mappingRequests.legacyFolderCandidates}, folders=${report.mappingRequests.legacyFoldersScanned}`);
    console.log(`[pte:migrate-uploads] fileMoves requested=${report.fileMoves.requested}, moved=${report.fileMoves.moved}, skippedExistingTarget=${report.fileMoves.skippedExistingTarget}, missing=${report.fileMoves.missingSource}, failed=${report.fileMoves.failed}`);
    console.log(`[pte:migrate-uploads] rewrites planned qv=${report.rewrites.questionVersionsPlanned}, app=${report.rewrites.applicantsPlanned}, art=${report.rewrites.attemptArtifactsPlanned}, evt=${report.rewrites.attemptEventsPlanned}`);
    if (args.apply) {
      console.log(`[pte:migrate-uploads] rewrites applied qv=${report.rewrites.questionVersionsApplied}, app=${report.rewrites.applicantsApplied}, art=${report.rewrites.attemptArtifactsApplied}, evt=${report.rewrites.attemptEventsApplied}`);
    }
    console.log(`[pte:migrate-uploads] report=${args.reportPath}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`[pte:migrate-uploads][error] ${error.message}`);
  process.exitCode = 1;
});
