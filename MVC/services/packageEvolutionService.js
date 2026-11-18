'use strict';

const { execSync } = require('child_process');
const packageEvolutionItemRepository = require('../repositories/packageEvolutionItemRepository');
const packageEvolutionItemModel = require('../models/packageEvolutionItemModel');
const packageEvolutionSyncStateModel = require('../models/packageEvolutionSyncStateModel');
const packageEvolutionPathMapperService = require('./packageEvolutionPathMapperService');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeDateOnly(value = '') {
  const token = cleanText(value, 32);
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = Date.parse(token);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}

function runGit(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024
    }).trim();
  } catch (_) {
    return '';
  }
}

function parseCommitLogBlock(block = '') {
  const lines = String(block || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  const [sha, committedAt, ...messageLines] = lines;
  const commitSha = cleanText(sha, 128).toLowerCase();
  if (!commitSha) return null;
  return {
    commitSha,
    committedAt: cleanText(committedAt, 64),
    subject: cleanText(messageLines.join('\n'), 8000)
  };
}

function listCommitsSince(sinceSha = '', options = {}) {
  const since = cleanText(sinceSha, 128);
  const range = since ? `${since}..HEAD` : '-n 50';
  const raw = runGit(`git log ${range} --format=%H%x09%cI%x09%s`, options);
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => {
    const parts = line.split('\t');
    if (parts.length < 3) return null;
    return {
      commitSha: cleanText(parts[0], 128).toLowerCase(),
      committedAt: cleanText(parts[1], 64),
      subject: cleanText(parts.slice(2).join('\t'), 8000)
    };
  }).filter(Boolean);
}

function listCommitChangedFiles(commitSha = '', options = {}) {
  const sha = cleanText(commitSha, 128);
  if (!sha) return [];
  const raw = runGit(`git diff-tree --no-commit-id --name-only -r ${sha}`, options);
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => cleanText(line, 500)).filter(Boolean);
}

function buildStubsFromCommit(commit = {}, options = {}) {
  const files = listCommitChangedFiles(commit.commitSha, options);
  const buckets = packageEvolutionPathMapperService.splitCommitFilesIntoPackageBuckets(files);
  if (!buckets.length) {
    return [{
      packageName: 'CORE',
      commitSha: commit.commitSha,
      commitShortHash: commit.commitSha.slice(-12),
      committedAt: commit.committedAt,
      changeType: 'update',
      title: commit.subject || `Commit ${commit.commitSha.slice(0, 7)}`,
      description: commit.subject || '',
      purpose: '',
      status: 'draft',
      source: 'git-stub',
      technical: {
        files,
        collections: packageEvolutionPathMapperService.suggestCollectionsFromFiles(files),
        other: []
      },
      team: { members: [], approval: { name: '', userId: '' } },
      budget: { amount: null, currency: 'CAD', note: '' },
      taskDuration: { days: 0, hours: 0, minutes: 0 }
    }];
  }
  return buckets.map((bucket) => {
    const collections = packageEvolutionPathMapperService.suggestCollectionsFromFiles(bucket.files);
    const title = buckets.length > 1
      ? `${commit.subject || 'Changes'} (${bucket.packageName})`
      : (commit.subject || `Commit ${commit.commitSha.slice(0, 7)}`);
    return {
      packageName: bucket.packageName,
      commitSha: commit.commitSha,
      commitShortHash: commit.commitSha.slice(-12),
      committedAt: commit.committedAt,
      changeType: 'update',
      title,
      description: commit.subject || '',
      purpose: '',
      status: 'draft',
      source: 'git-stub',
      technical: {
        files: bucket.files,
        collections,
        other: []
      },
      team: { members: [], approval: { name: '', userId: '' } },
      budget: { amount: null, currency: 'CAD', note: '' },
      taskDuration: { days: 0, hours: 0, minutes: 0 }
    };
  });
}

async function scanGitCommits(options = {}) {
  const state = await packageEvolutionSyncStateModel.getState();
  const since = cleanText(options.sinceSha || state.lastScannedCommitSha);
  const commits = listCommitsSince(since, options);
  const stubs = [];
  for (const commit of commits) {
    stubs.push(...buildStubsFromCommit(commit, options));
  }
  return {
    sinceSha: since,
    commitsScanned: commits.length,
    items: stubs,
    newestSha: commits[0]?.commitSha || since
  };
}

async function markScanCursor(commitSha = '') {
  const sha = cleanText(commitSha, 128);
  if (!sha) throw new Error('commitSha is required to mark scan cursor.');
  return packageEvolutionSyncStateModel.saveState({ lastScannedCommitSha: sha });
}

async function importItems(payload = {}, options = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
  if (!items.length) throw new Error('No evolution items to import.');
  const actorUserId = cleanText(options.actorUserId, 120);
  const publish = options.publish === true;
  const results = { created: 0, updated: 0, rows: [] };
  for (const raw of items) {
    const patch = { ...(raw || {}) };
    if (publish && !patch.status) patch.status = 'published';
    if (actorUserId) {
      patch.updatedByUserId = actorUserId;
      if (!patch.createdByUserId) patch.createdByUserId = actorUserId;
    }
  // eslint-disable-next-line no-await-in-loop
    const existing = packageEvolutionItemModel.normalizePackageEvolutionItem(patch, null, { strict: false });
    if (!existing.title || !existing.commitSha || !existing.packageName) continue;
    // eslint-disable-next-line no-await-in-loop
    const prior = await packageEvolutionItemModel.findByUpsertKey(existing.upsertKey);
    // eslint-disable-next-line no-await-in-loop
    const row = await packageEvolutionItemRepository.upsertByKey(patch, options);
    if (prior) results.updated += 1;
    else results.created += 1;
    results.rows.push(row);
  }
  return results;
}

async function listTimelineRows({
  packageNames = [],
  startDate = '',
  endDate = '',
  status = 'published',
  page = 1,
  limit = 50
} = {}, options = {}) {
  const allowed = (Array.isArray(packageNames) ? packageNames : [])
    .map((name) => cleanText(name, 80).toUpperCase())
    .filter(Boolean);
  const query = {
    page: Math.max(1, Number(page) || 1),
    limit: Math.min(200, Math.max(1, Number(limit) || 50)),
    sort: '-committedAt'
  };
  if (status) query.status__eq = cleanText(status, 40).toLowerCase();
  const from = normalizeDateOnly(startDate);
  const to = normalizeDateOnly(endDate);
  if (from) query.committedAt__gte = `${from}T00:00:00.000Z`;
  if (to) query.committedAt__lte = `${to}T23:59:59.999Z`;

  let rows = await packageEvolutionItemRepository.list({ query, ...options });
  if (allowed.length) {
    const allowedSet = new Set(allowed);
    rows = rows.filter((row) => allowedSet.has(String(row?.packageName || '').toUpperCase()));
  }
  return rows;
}

module.exports = {
  listCommitsSince,
  listCommitChangedFiles,
  buildStubsFromCommit,
  scanGitCommits,
  markScanCursor,
  importItems,
  listTimelineRows
};