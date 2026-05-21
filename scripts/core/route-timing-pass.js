#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const settingService = require('../../MVC/services/settingService');
const dataService = require('../../MVC/services/dataService');
const taskRepository = require('../../MVC/repositories/taskRepository');
const helpArticleRepository = require('../../MVC/repositories/helpArticleRepository');
const paginate = require('../../MVC/utils/paginationHelper');
const { normalizeScopeDefinition, summarizeScopeDefinition } = require('../../MVC/utils/scopeDefinitionHelper');
const { inferSearchableFields } = require('../../MVC/utils/generalTools');
const { idsEqual } = require('../../MVC/utils/idAdapter');

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > -1) {
      out[token.slice(2, eq).trim()] = token.slice(eq + 1).trim();
      continue;
    }
    const key = token.slice(2).trim();
    const next = String(argv[i + 1] || '').trim();
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function resolveConnectionConfig(args = {}) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const settingsPath = path.join(repoRoot, 'data', 'systemSettings.json');
  const settings = readJsonFileSafe(settingsPath) || {};

  const uri = String(
    args.uri
      || process.env.MONGODB_URI
      || process.env.MONGO_URI
      || ''
  ).trim();

  const dbName = String(
    args.db
      || process.env.MONGODB_DB
      || process.env.MONGO_DB
      || inferDbNameFromUri(uri)
      || 'app'
  ).trim();

  const runs = Math.max(5, Math.min(30, Number.parseInt(String(args.runs || '9'), 10) || 9));
  const page = Math.max(1, Number.parseInt(String(args.page || '1'), 10) || 1);
  const limit = Math.max(1, Number.parseInt(String(args.limit || '20'), 10) || 20);

  return { uri, dbName, runs, page, limit };
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function percentile(sorted = [], ratio = 0.5) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[idx] || 0);
}

function summarizeSamples(samples = []) {
  const rows = (Array.isArray(samples) ? samples : [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value));
  if (!rows.length) return { min: 0, p50: 0, p95: 0, max: 0, avg: 0, count: 0 };

  const sorted = rows.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    min: Number(sorted[0].toFixed(2)),
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number((sum / sorted.length).toFixed(2)),
    count: sorted.length
  };
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function includesCI(haystack, needle) {
  return String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function filterMessagesLegacy(list, { q, status }) {
  let out = Array.isArray(list) ? list : [];

  if (status && status !== 'All') {
    out = out.filter((m) => String(m.status || 'Unread') === String(status));
  }

  if (q) {
    out = out.filter((m) => (
      includesCI(m.id, q)
      || includesCI(m.name, q)
      || includesCI(m.email, q)
      || includesCI(m.subject, q)
      || includesCI(m.message, q)
      || includesCI(m.type, q)
    ));
  }

  out.sort((a, b) => {
    const ad = a?.audit?.createDateTime ? Date.parse(a.audit.createDateTime) : 0;
    const bd = b?.audit?.createDateTime ? Date.parse(b.audit.createDateTime) : 0;
    return bd - ad;
  });

  return out;
}

function buildRouteChecks({ page = 1, limit = 20, sampleGroupId = '' } = {}) {
  const base = { page, limit };
  return [
    { key: 'users', routePath: '/users', query: { q: '', type: '', searchFields: 'email,username,id,name', ...base } },
    { key: 'persons', routePath: '/persons', query: { q: '', type: '', searchFields: 'id,name.first,name.last,contact.emails[0].email', ...base } },
    { key: 'organizations', routePath: '/organizations', query: { q: '', type: '', searchFields: 'identity.displayName,identity.legalName,contact.email,domain.primaryDomain,billing.plan,billing.status,notes', ...base } },
    { key: 'sections', routePath: '/sections', query: { q: '', type: '', searchFields: 'name,id,description,category', ...base } },
    { key: 'symbols', routePath: '/symbols', query: { q: '', type: '', searchFields: 'id,name,tags,value', ...base } },
    { key: 'accessPolicies', routePath: '/accessPolicies', query: { ...base } },
    { key: 'tableSettings', routePath: '/tableSettings', query: { q: '', type: '', searchFields: 'userId,tableId', ...base } },
    { key: 'accesses', routePath: '/accesses', query: { q: '', type: '', searchFields: 'id,name,description', ...base } },
    { key: 'operations', routePath: '/operations', query: { q: '', type: '', searchFields: 'id,name,active,system,trackState,keepActive', ...base } },
    { key: 'scopes', routePath: '/scopes', query: { q: '', type: '', searchFields: 'name,description,id', ...base } },
    { key: 'sessions', routePath: '/sessions', query: { q: '', type: '', searchFields: 'userId,deviceFingerprint.ip', ...base } },
    { key: 'logs', routePath: '/logs', query: { q: '', type: '', searchFields: 'id,sectionId,operationId,status,user', ...base } },
    { key: 'contracts', routePath: '/contracts', query: { ...base } },
    { key: 'orgPolicies', routePath: '/orgPolicies', query: { ...base } },
    { key: 'contactMessages', routePath: '/contact/messages', query: { q: '', type: '', status: 'All', ...base } },
    { key: 'newsFeed', routePath: '/news', query: { q: '', searchFields: 'meta.title,meta.category,content.summary,meta.tags,meta.author.displayName', ...base } },
    { key: 'newsManage', routePath: '/news/manage', query: { ...base } },
    { key: 'newsletterAdmin', routePath: '/newsletter/admin', query: { q: '', type: '', searchFields: 'id,email,status,groupId', ...base } },
    { key: 'subscriptionGroups', routePath: '/subscriptiongroup', query: { q: '', type: '', searchFields: 'id,name,description', ...base } },
    { key: 'subscriptionGroupMembers', routePath: '/subscriptiongroup/:id/members', query: { groupId: sampleGroupId || '__NO_MATCH__', ...base } },
    { key: 'tasks', routePath: '/tasks', query: { q: '', ...base } },
    { key: 'memberships', routePath: '/memberships', query: { q: '', type: '', searchFields: 'id,userId,orgId,status,notes', ...base } },
    { key: 'helpManage', routePath: '/help/manage', query: { q: '', type: '', ...base } }
  ];
}

async function findSampleOrgId(db) {
  const orgRow = await db.collection('organizations')
    .find({ id: { $exists: true, $type: 'string', $gt: '' } }, { projection: { id: 1, _id: 0 } })
    .limit(1)
    .toArray();
  const orgId = String(orgRow?.[0]?.id || '').trim();
  if (orgId) return orgId;

  const policyRow = await db.collection('orgPolicies')
    .find({ orgId: { $exists: true, $type: 'string', $gt: '' } }, { projection: { orgId: 1, _id: 0 } })
    .limit(1)
    .toArray();
  const fromPolicy = String(policyRow?.[0]?.orgId || '').trim();
  if (fromPolicy) return fromPolicy;

  return 'SYSTEM';
}

async function findSampleGroupId(db) {
  const groupRow = await db.collection('subscriptionGroups')
    .find({ id: { $exists: true, $type: 'string', $gt: '' } }, { projection: { id: 1, _id: 0 } })
    .limit(1)
    .toArray();
  const groupId = String(groupRow?.[0]?.id || '').trim();
  if (groupId) return groupId;

  const subRow = await db.collection('newsletterSubscriptions')
    .find({ groupId: { $exists: true, $type: 'string', $gt: '' } }, { projection: { groupId: 1, _id: 0 } })
    .limit(1)
    .toArray();
  return String(subRow?.[0]?.groupId || '').trim();
}

function makeUserLookupMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = String(row?.id || '').trim();
    if (!id) return;
    map.set(id, row);
  });
  return map;
}

function makeOrgLookupMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = String(row?.id || '').trim();
    if (!id) return;
    map.set(id, row);
  });
  return map;
}

function paginateRows(rows = [], page = 1, limit = 20) {
  const paged = paginate(Array.isArray(rows) ? rows : [], page, limit);
  return {
    rows: Array.isArray(paged?.data) ? paged.data : [],
    totalRows: Number(paged?.pagination?.totalItems || 0)
  };
}

async function executeRouteLegacy(check, requestingUser) {
  const query = check?.query && typeof check.query === 'object' ? { ...check.query } : {};
  const queryNoPage = stripPaginationFromQuery(query);

  switch (check.key) {
    case 'users': {
      const all = await dataService.fetchData('users', queryNoPage, requestingUser);
      return paginateRows(all, query.page, query.limit);
    }
    case 'persons': {
      const all = await dataService.fetchData('persons', queryNoPage, requestingUser, { enrichment: { includeSchoolRoles: true } });
      return paginateRows(all, query.page, query.limit);
    }
    case 'organizations': {
      const [orgs, contracts] = await Promise.all([
        dataService.fetchData('organizations', queryNoPage, requestingUser),
        dataService.fetchData('contracts', {}, requestingUser)
      ]);
      const contractCountByOrgId = new Map();
      (contracts || []).forEach((item) => {
        const orgId = String(item?.orgId || '').trim();
        if (!orgId) return;
        contractCountByOrgId.set(orgId, (contractCountByOrgId.get(orgId) || 0) + 1);
      });
      const enriched = (orgs || []).map((org) => ({
        ...org,
        contractCount: contractCountByOrgId.get(String(org?.id || '').trim()) || 0
      }));
      return paginateRows(enriched, query.page, query.limit);
    }
    case 'sections': {
      const [sections, operations] = await Promise.all([
        dataService.fetchData('sections', queryNoPage, requestingUser),
        dataService.fetchData('operations', {}, requestingUser)
      ]);
      const opMap = new Map((operations || []).map((row) => [String(row?.id || '').trim(), row]));
      const enriched = (sections || []).map((section) => ({
        ...section,
        operations: (section?.operations || []).map((op) => ({
          ...op,
          name: opMap.get(String(op?.id || '').trim())?.name || 'Unknown'
        }))
      }));
      return paginateRows(enriched, query.page, query.limit);
    }
    case 'symbols': {
      const all = await dataService.fetchData('symbols', queryNoPage, requestingUser);
      return paginateRows(all, query.page, query.limit);
    }
    case 'accessPolicies': {
      const [policies, users, orgs] = await Promise.all([
        dataService.fetchData('accessPolicies', queryNoPage, requestingUser),
        dataService.fetchData('users', {}, requestingUser),
        dataService.fetchData('organizations', {}, requestingUser)
      ]);
      const userMap = makeUserLookupMap(users);
      const orgMap = makeOrgLookupMap(orgs);
      const enriched = (policies || []).map((p) => {
        const u = userMap.get(String(p?.userId || '').trim());
        const orgId = String(p?.orgId || '').trim();
        let orgName = 'Global / System';
        if (orgId) {
          const o = orgMap.get(orgId);
          orgName = o ? o.name : `Org #${orgId}`;
        }
        return {
          ...p,
          userName: u ? (u.username || u.email) : 'Unknown User',
          orgName
        };
      });
      return paginateRows(enriched, query.page, query.limit);
    }
    case 'tableSettings': {
      const all = await dataService.fetchData('tableSettings', queryNoPage, requestingUser);
      return paginateRows(all, query.page, query.limit);
    }
    case 'accesses': {
      const all = await dataService.fetchData('accesses', queryNoPage, requestingUser);
      return paginateRows(all, query.page, query.limit);
    }
    case 'operations': {
      const all = await dataService.fetchData('operations', queryNoPage, requestingUser);
      return paginateRows(all, query.page, query.limit);
    }
    case 'scopes': {
      const all = await dataService.fetchData('scopes', queryNoPage, requestingUser);
      const enriched = (all || []).map((item) => {
        const definition = normalizeScopeDefinition(item?.definition, item?.name);
        return {
          ...item,
          definition,
          definitionSummary: summarizeScopeDefinition(definition)
        };
      });
      return paginateRows(enriched, query.page, query.limit);
    }
    case 'sessions': {
      const allSessions = await dataService.fetchData('sessions', queryNoPage, requestingUser);
      const enriched = await Promise.all((allSessions || []).map(async (s) => {
        const user = await dataService.getDataById('users', s?.userId, requestingUser);
        return {
          ...s,
          username: user ? user.username : 'Unknown',
          userEmail: user ? user.email : 'Unknown'
        };
      }));
      return paginateRows(enriched, query.page, query.limit);
    }
    case 'logs': {
      const allLogs = await dataService.fetchData('logs', queryNoPage, requestingUser);
      const [sections, operations] = await Promise.all([
        dataService.fetchData('sections', {}, requestingUser),
        dataService.fetchData('operations', {}, requestingUser)
      ]);
      const sectionMap = new Map((sections || []).map((row) => [String(row?.id || '').trim(), row]));
      const opMap = new Map((operations || []).map((row) => [String(row?.id || '').trim(), row]));
      const paged = paginateRows(allLogs, query.page, query.limit);
      const enriched = (paged.rows || []).map((log) => {
        const sec = sectionMap.get(String(log?.sectionId || '').trim());
        const op = opMap.get(String(log?.operationId || '').trim());
        return {
          ...log,
          sectionName: sec ? sec.name : (log.sectionId === '000000' ? 'SYSTEM' : log.sectionId),
          operationName: op ? op.name : log.operationId
        };
      });
      return {
        rows: enriched,
        totalRows: paged.totalRows
      };
    }
    case 'contracts': {
      const [contracts, orgs] = await Promise.all([
        dataService.fetchData('contracts', queryNoPage, requestingUser),
        dataService.fetchData('organizations', {}, requestingUser)
      ]);
      const orgMap = makeOrgLookupMap(orgs);
      const enriched = (contracts || []).map((c) => {
        const org = orgMap.get(String(c?.orgId || '').trim());
        return {
          ...c,
          orgName: org ? org?.identity?.displayName : `Unknown Org (#${c?.orgId})`
        };
      });
      return paginateRows(enriched, query.page, query.limit);
    }
    case 'orgPolicies': {
      const [policies, orgs] = await Promise.all([
        dataService.fetchData('orgPolicies', queryNoPage, requestingUser),
        dataService.fetchData('organizations', {}, requestingUser)
      ]);
      const orgMap = makeOrgLookupMap(orgs);
      const enriched = (policies || []).map((p) => {
        const org = orgMap.get(String(p?.orgId || '').trim());
        return {
          ...p,
          orgName: org ? org?.identity?.displayName : 'Unknown Org'
        };
      });
      return paginateRows(enriched, query.page, query.limit);
    }
    case 'contactMessages': {
      const all = await dataService.fetchData('contactMessages', {}, requestingUser);
      const filtered = filterMessagesLegacy(all, { q: query.q || '', status: query.status || 'All' });
      return paginateRows(filtered, query.page, query.limit);
    }
    case 'newsFeed': {
      const allNews = await dataService.fetchData('news', stripPaginationFromQuery(query), requestingUser);
      allNews.sort((a, b) => new Date(b?.meta?.publishDate || 0) - new Date(a?.meta?.publishDate || 0));
      return paginateRows(allNews, query.page, query.limit);
    }
    case 'newsManage': {
      const allNews = await dataService.fetchData('news', {}, requestingUser);
      return paginateRows(allNews, query.page, query.limit);
    }
    case 'newsletterAdmin': {
      const [subs] = await Promise.all([
        dataService.fetchData('newsletter', stripPaginationFromQuery(query), requestingUser),
        dataService.fetchData('subscriptionGroups', {}, requestingUser)
      ]);
      await inferSearchableFields(subs, { exclude: ['audit', 'attachments'] });
      subs.sort((a, b) => String(b?.subscribedAt || '').localeCompare(String(a?.subscribedAt || '')));
      return paginateRows(subs, query.page, query.limit);
    }
    case 'subscriptionGroups': {
      const groups = await dataService.fetchData('subscriptionGroups', stripPaginationFromQuery(query), requestingUser);
      await inferSearchableFields(groups, { exclude: ['audit', 'attachments'] });
      return paginateRows(groups, query.page, query.limit);
    }
    case 'subscriptionGroupMembers': {
      const allMembers = await dataService.fetchData('newsletter', {
        ...stripPaginationFromQuery(query),
        groupId: query.groupId
      }, requestingUser);
      return paginateRows(allMembers, query.page, query.limit);
    }
    case 'tasks': {
      const listQuery = {
        q: query.q || '',
        ...(query.status ? { status__eq: query.status } : {})
      };
      const rows = await taskRepository.list({
        query: listQuery,
        scope: {
          canViewAll: true,
          userId: requestingUser?.id
        }
      });
      return paginateRows(rows, query.page, query.limit);
    }
    case 'memberships': {
      const listQuery = {
        q: query.q || '',
        type: query.type,
        searchFields: 'id,userId,orgId,status,notes'
      };
      const memberships = await dataService.fetchData('userMemberships', listQuery, requestingUser);
      const users = await dataService.fetchData('users', {}, requestingUser);
      const userById = new Map((Array.isArray(users) ? users : []).map((u) => [String(u?.id || '').trim(), u]));
      const hydrated = (Array.isArray(memberships) ? memberships : []).map((row) => ({
        ...row,
        linkedUser: userById.get(String(row?.userId || '').trim()) || null
      }));
      return paginateRows(hydrated, query.page, query.limit);
    }
    case 'helpManage': {
      const raw = await helpArticleRepository.list({
        query: {
          ...(query.q ? { q: query.q } : {}),
          ...(query.type ? { type: query.type } : {})
        },
        scope: {
          canViewAll: true,
          isAuthenticated: Boolean(requestingUser)
        }
      });
      const rows = Array.isArray(raw) ? raw : [];
      rows.sort((a, b) => {
        const p = (Number.parseInt(b?.priority, 10) || 0) - (Number.parseInt(a?.priority, 10) || 0);
        if (p !== 0) return p;
        return String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''));
      });
      return paginateRows(rows, query.page, query.limit);
    }
    default:
      return { rows: [], totalRows: 0 };
  }
}

async function executeRouteCurrent(check, requestingUser) {
  const query = check?.query && typeof check.query === 'object' ? { ...check.query } : {};

  switch (check.key) {
    case 'users': {
      const paged = await dataService.fetchDataPaged('users', query, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'persons': {
      const paged = await dataService.fetchDataPaged('persons', query, requestingUser, { enrichment: { includeSchoolRoles: true } });
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'organizations': {
      const [pagedOrgs, contracts] = await Promise.all([
        dataService.fetchDataPaged('organizations', query, requestingUser),
        dataService.fetchData('contracts', {}, requestingUser)
      ]);
      const contractCountByOrgId = new Map();
      (contracts || []).forEach((item) => {
        const orgId = String(item?.orgId || '').trim();
        if (!orgId) return;
        contractCountByOrgId.set(orgId, (contractCountByOrgId.get(orgId) || 0) + 1);
      });
      const rows = (pagedOrgs?.rows || []).map((org) => ({
        ...org,
        contractCount: contractCountByOrgId.get(String(org?.id || '').trim()) || 0
      }));
      return { rows, totalRows: Number(pagedOrgs?.totalRows || 0) };
    }
    case 'sections': {
      const [pagedSections, operations] = await Promise.all([
        dataService.fetchDataPaged('sections', query, requestingUser),
        dataService.fetchData('operations', {}, requestingUser)
      ]);
      const opMap = new Map((operations || []).map((row) => [String(row?.id || '').trim(), row]));
      const rows = (pagedSections?.rows || []).map((section) => ({
        ...section,
        operations: (section?.operations || []).map((op) => ({
          ...op,
          name: opMap.get(String(op?.id || '').trim())?.name || 'Unknown'
        }))
      }));
      return { rows, totalRows: Number(pagedSections?.totalRows || 0) };
    }
    case 'symbols': {
      const paged = await dataService.fetchDataPaged('symbols', query, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'accessPolicies': {
      const [pagedPolicies, users, orgs] = await Promise.all([
        dataService.fetchDataPaged('accessPolicies', query, requestingUser),
        dataService.fetchData('users', {}, requestingUser),
        dataService.fetchData('organizations', {}, requestingUser)
      ]);
      const userMap = makeUserLookupMap(users);
      const orgMap = makeOrgLookupMap(orgs);
      const rows = (pagedPolicies?.rows || []).map((p) => {
        const u = userMap.get(String(p?.userId || '').trim());
        const orgId = String(p?.orgId || '').trim();
        let orgName = 'Global / System';
        if (orgId) {
          const o = orgMap.get(orgId);
          orgName = o ? o.name : `Org #${orgId}`;
        }
        return {
          ...p,
          userName: u ? (u.username || u.email) : 'Unknown User',
          orgName
        };
      });
      return { rows, totalRows: Number(pagedPolicies?.totalRows || 0) };
    }
    case 'tableSettings': {
      const paged = await dataService.fetchDataPaged('tableSettings', query, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'accesses': {
      const paged = await dataService.fetchDataPaged('accesses', query, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'operations': {
      const paged = await dataService.fetchDataPaged('operations', query, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'scopes': {
      const paged = await dataService.fetchDataPaged('scopes', query, requestingUser);
      const rows = (paged?.rows || []).map((item) => {
        const definition = normalizeScopeDefinition(item?.definition, item?.name);
        return {
          ...item,
          definition,
          definitionSummary: summarizeScopeDefinition(definition)
        };
      });
      return { rows, totalRows: Number(paged?.totalRows || 0) };
    }
    case 'sessions': {
      const pagedSessions = await dataService.fetchDataPaged('sessions', query, requestingUser);
      const pageRows = Array.isArray(pagedSessions?.rows) ? pagedSessions.rows : [];
      const userIds = Array.from(new Set(pageRows.map((row) => String(row?.userId || '').trim()).filter(Boolean)));
      const users = await Promise.all(userIds.map((id) => dataService.getDataById('users', id, requestingUser)));
      const userMap = makeUserLookupMap(users);
      const rows = pageRows.map((session) => {
        const user = userMap.get(String(session?.userId || '').trim());
        return {
          ...session,
          username: user ? user.username : 'Unknown',
          userEmail: user ? user.email : 'Unknown'
        };
      });
      return { rows, totalRows: Number(pagedSessions?.totalRows || 0) };
    }
    case 'logs': {
      const [pagedLogs, sections, operations] = await Promise.all([
        dataService.fetchDataPaged('logs', query, requestingUser),
        dataService.fetchData('sections', {}, requestingUser),
        dataService.fetchData('operations', {}, requestingUser)
      ]);
      const sectionMap = new Map((sections || []).map((row) => [String(row?.id || '').trim(), row]));
      const opMap = new Map((operations || []).map((row) => [String(row?.id || '').trim(), row]));
      const rows = (pagedLogs?.rows || []).map((log) => {
        const sec = sectionMap.get(String(log?.sectionId || '').trim());
        const op = opMap.get(String(log?.operationId || '').trim());
        return {
          ...log,
          sectionName: sec ? sec.name : (log.sectionId === '000000' ? 'SYSTEM' : log.sectionId),
          operationName: op ? op.name : log.operationId
        };
      });
      return { rows, totalRows: Number(pagedLogs?.totalRows || 0) };
    }
    case 'contracts': {
      const [pagedContracts, orgs] = await Promise.all([
        dataService.fetchDataPaged('contracts', query, requestingUser),
        dataService.fetchData('organizations', {}, requestingUser)
      ]);
      const orgMap = makeOrgLookupMap(orgs);
      const rows = (pagedContracts?.rows || []).map((c) => {
        const org = orgMap.get(String(c?.orgId || '').trim());
        return {
          ...c,
          orgName: org ? org?.identity?.displayName : `Unknown Org (#${c?.orgId})`
        };
      });
      return { rows, totalRows: Number(pagedContracts?.totalRows || 0) };
    }
    case 'orgPolicies': {
      const [pagedPolicies, orgs] = await Promise.all([
        dataService.fetchDataPaged('orgPolicies', query, requestingUser),
        dataService.fetchData('organizations', {}, requestingUser)
      ]);
      const orgMap = makeOrgLookupMap(orgs);
      const rows = (pagedPolicies?.rows || []).map((p) => {
        const org = orgMap.get(String(p?.orgId || '').trim());
        return {
          ...p,
          orgName: org ? org?.identity?.displayName : 'Unknown Org'
        };
      });
      return { rows, totalRows: Number(pagedPolicies?.totalRows || 0) };
    }
    case 'contactMessages': {
      const currentQuery = {
        q: query.q || '',
        type: query.type,
        searchFields: 'id,name,email,subject,message,type',
        page: query.page,
        limit: query.limit,
        sort: 'audit.createDateTime',
        order: 'desc'
      };
      if (query.status && query.status !== 'All') currentQuery.status__eq = query.status;
      const paged = await dataService.fetchDataPaged('contactMessages', currentQuery, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'newsFeed': {
      const paged = await dataService.fetchDataPaged('news', {
        ...stripPaginationFromQuery(query),
        page: query.page,
        limit: query.limit,
        sort: 'meta.publishDate',
        order: 'desc'
      }, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'newsManage': {
      const paged = await dataService.fetchDataPaged('news', {
        ...stripPaginationFromQuery(query),
        page: query.page,
        limit: query.limit,
        sort: 'audit.lastUpdateDateTime',
        order: 'desc'
      }, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'newsletterAdmin': {
      const [pagedSubs] = await Promise.all([
        dataService.fetchDataPaged('newsletter', {
          ...stripPaginationFromQuery(query),
          page: query.page,
          limit: query.limit,
          sort: 'subscribedAt',
          order: 'desc'
        }, requestingUser),
        dataService.fetchData('subscriptionGroups', {}, requestingUser)
      ]);
      const rows = Array.isArray(pagedSubs?.rows) ? pagedSubs.rows : [];
      await inferSearchableFields(rows, { exclude: ['audit', 'attachments'] });
      return { rows, totalRows: Number(pagedSubs?.totalRows || 0) };
    }
    case 'subscriptionGroups': {
      const paged = await dataService.fetchDataPaged('subscriptionGroups', {
        ...stripPaginationFromQuery(query),
        page: query.page,
        limit: query.limit
      }, requestingUser);
      const rows = Array.isArray(paged?.rows) ? paged.rows : [];
      await inferSearchableFields(rows, { exclude: ['audit', 'attachments'] });
      return { rows, totalRows: Number(paged?.totalRows || 0) };
    }
    case 'subscriptionGroupMembers': {
      const paged = await dataService.fetchDataPaged('newsletter', {
        groupId__eq: String(query.groupId || '').trim(),
        page: query.page,
        limit: query.limit
      }, requestingUser);
      return { rows: paged?.rows || [], totalRows: Number(paged?.totalRows || 0) };
    }
    case 'tasks': {
      const pageResult = await taskRepository.listPaged({
        query: {
          q: query.q || '',
          ...(query.status ? { status__eq: query.status } : {}),
          page: query.page,
          limit: query.limit
        },
        scope: {
          canViewAll: true,
          userId: requestingUser?.id
        }
      });
      return { rows: pageResult?.rows || [], totalRows: Number(pageResult?.totalRows || 0) };
    }
    case 'memberships': {
      const pagedMemberships = await dataService.fetchDataPaged('userMemberships', {
        q: query.q || '',
        type: query.type,
        searchFields: 'id,userId,orgId,status,notes',
        page: query.page,
        limit: query.limit
      }, requestingUser);
      const memberships = Array.isArray(pagedMemberships?.rows) ? pagedMemberships.rows : [];
      const userIds = Array.from(new Set(memberships.map((row) => String(row?.userId || '').trim()).filter(Boolean)));
      const users = await Promise.all(userIds.map((userId) => dataService.getDataById('users', userId, requestingUser)));
      const userById = new Map((Array.isArray(users) ? users : []).filter(Boolean).map((u) => [String(u?.id || '').trim(), u]));
      const rows = memberships.map((row) => ({
        ...row,
        linkedUser: userById.get(String(row?.userId || '').trim()) || null
      }));
      return { rows, totalRows: Number(pagedMemberships?.totalRows || 0) };
    }
    case 'helpManage': {
      const pageResult = await helpArticleRepository.listPaged({
        query: {
          ...(query.q ? { q: query.q } : {}),
          ...(query.type ? { type: query.type } : {}),
          sort: 'priority',
          order: 'desc',
          page: query.page,
          limit: query.limit
        },
        scope: {
          canViewAll: true,
          isAuthenticated: Boolean(requestingUser)
        }
      });
      const rows = Array.isArray(pageResult?.rows) ? pageResult.rows : [];
      rows.sort((a, b) => {
        const p = (Number.parseInt(b?.priority, 10) || 0) - (Number.parseInt(a?.priority, 10) || 0);
        if (p !== 0) return p;
        return String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''));
      });
      return { rows, totalRows: Number(pageResult?.totalRows || 0) };
    }
    default:
      return { rows: [], totalRows: 0 };
  }
}

async function measureRoute(check, mode, requestingUser, runs = 9) {
  const timings = [];
  const runner = mode === 'before' ? executeRouteLegacy : executeRouteCurrent;

  let rowCount = 0;
  let totalRows = 0;

  await runner(check, requestingUser);

  for (let i = 0; i < runs; i += 1) {
    const start = nowMs();
    // eslint-disable-next-line no-await-in-loop
    const result = await runner(check, requestingUser);
    const duration = nowMs() - start;
    timings.push(duration);
    rowCount = Array.isArray(result?.rows) ? result.rows.length : 0;
    totalRows = Number(result?.totalRows || 0);
  }

  return {
    stats: summarizeSamples(timings),
    rowCount,
    totalRows
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConnectionConfig(args);

  if (!config.uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

  try {
    await settingService.init();
  } catch (_) {}

  const client = new MongoClient(config.uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);
    const orgId = await findSampleOrgId(db);
    const sampleGroupId = await findSampleGroupId(db);

    const requestingUser = {
      id: 'CORE_ROUTE_BENCH_AGENT',
      activeOrgId: orgId,
      isVirtualSuperAdmin: true,
      activeProfile: { fullAdmin: true }
    };

    const checks = buildRouteChecks({ page: config.page, limit: config.limit, sampleGroupId });

    console.log(`[core:route-timing] db=${config.dbName} orgId=${orgId} runs=${config.runs} page=${config.page} limit=${config.limit}`);

    const rows = [];
    for (const check of checks) {
      // eslint-disable-next-line no-await-in-loop
      const before = await measureRoute(check, 'before', requestingUser, config.runs);
      // eslint-disable-next-line no-await-in-loop
      const after = await measureRoute(check, 'after', requestingUser, config.runs);
      const p50Speedup = after.stats.p50 > 0 ? Number((before.stats.p50 / after.stats.p50).toFixed(2)) : 0;
      const p95Speedup = after.stats.p95 > 0 ? Number((before.stats.p95 / after.stats.p95).toFixed(2)) : 0;
      rows.push({
        routePath: check.routePath,
        key: check.key,
        rowsReturned: after.rowCount,
        totalRows: after.totalRows,
        before,
        after,
        p50Speedup,
        p95Speedup
      });
    }

    console.log('\n[core:route-timing] results');
    rows.forEach((row) => {
      console.log(`  - ${row.routePath} (${row.key})`);
      console.log(`    beforeMs[min/p50/p95/max/avg]=${row.before.stats.min}/${row.before.stats.p50}/${row.before.stats.p95}/${row.before.stats.max}/${row.before.stats.avg}`);
      console.log(`    afterMs[min/p50/p95/max/avg]=${row.after.stats.min}/${row.after.stats.p50}/${row.after.stats.p95}/${row.after.stats.max}/${row.after.stats.avg}`);
      console.log(`    speedup[p50/p95]=${row.p50Speedup}x/${row.p95Speedup}x rows=${row.rowsReturned}/${row.totalRows}`);
    });

    const avgBeforeP50 = summarizeSamples(rows.map((row) => row.before.stats.p50));
    const avgAfterP50 = summarizeSamples(rows.map((row) => row.after.stats.p50));
    const avgBeforeP95 = summarizeSamples(rows.map((row) => row.before.stats.p95));
    const avgAfterP95 = summarizeSamples(rows.map((row) => row.after.stats.p95));
    const aggregateP50Speedup = avgAfterP50.avg > 0 ? Number((avgBeforeP50.avg / avgAfterP50.avg).toFixed(2)) : 0;
    const aggregateP95Speedup = avgAfterP95.avg > 0 ? Number((avgBeforeP95.avg / avgAfterP95.avg).toFixed(2)) : 0;

    console.log('\n[core:route-timing] aggregate');
    console.log(`  - avgP50 before=${avgBeforeP50.avg}ms after=${avgAfterP50.avg}ms speedup=${aggregateP50Speedup}x`);
    console.log(`  - avgP95 before=${avgBeforeP95.avg}ms after=${avgAfterP95.avg}ms speedup=${aggregateP95Speedup}x`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[core:route-timing][error] ${error.message}`);
  process.exitCode = 1;
});
