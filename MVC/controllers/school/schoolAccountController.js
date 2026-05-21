// MVC/controllers/school/schoolAccountController.js
const dataService = require('../../services/school/schoolDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const paginate = require('../../utils/paginationHelper');
const settingService = require('../../services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = require('../../utils/generalTools');
const adminChekersService = require('../../services/adminChekersService');
const schoolAccountDomainService = require('../../services/school/schoolAccountDomainService');
const dataServiceGlobal = require('../../services/dataService');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { ACCOUNT_TYPES, ACCOUNT_STATUSES, ACCOUNT_PARTY_ROLES, ACCOUNT_HEAD_CATEGORIES } = require('../../models/school/schoolAccountModel');
const OWNER_LOCKED_FIELDS = Object.freeze([
  'code',
  'type',
  'level',
  'parentId',
  'isControl',
  'allowPost',
  'partyRole',
  'headCategory',
  'normalBalance',
  'status'
]);

function getActiveOrgIdOrThrow(reqUser) {
  const activeOrgId = toPublicId(reqUser?.activeOrgId);
  if (!activeOrgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
  return activeOrgId;
}

function assertAccountOrgAccess(account, activeOrgId, reqUser) {
  if (!account) return;
  if (adminChekersService.isSuperAdmin(reqUser)) return;
  if (account.orgId && !idsEqual(account.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function sendGuardedResponse(req, res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    const payload = {
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    };
    if (isAjax(req)) {
      res.status(duplicateStatus).json(payload);
    } else {
      res.status(duplicateStatus).render('error', { title: 'Error', message: payload.message, user: req.user });
    }
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    if (isAjax(req)) {
      res.json(payload);
    } else {
      const redirectTo = String(payload.redirectTo || '').trim();
      if (redirectTo) {
        res.redirect(redirectTo);
      } else {
        res.redirect('/school/accounts');
      }
    }
    return true;
  }
  return false;
}

exports.listAccounts = async (req, res) => {
  try {
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    if (String(query.status || '').trim().toLowerCase() === 'archived') {
      delete query.status;
    }

    const accountQuery = { ...query };
    delete accountQuery.q;
    delete accountQuery.type;
    delete accountQuery.searchFields;
    // Fetch full scoped set, then paginate once in this controller.
    // This keeps picker/list pagination metadata accurate (especially for "Load More").
    delete accountQuery.page;
    delete accountQuery.limit;
    const [allAccounts, ownersByAccount] = await Promise.all([
      dataService.fetchData('schoolAccounts', accountQuery, req.user),
      schoolAccountDomainService.buildAccountOwnerMap(req.user)
    ]);
    const enriched = schoolAccountDomainService
      .enrichAccountsWithOwners(allAccounts, ownersByAccount)
      .filter((account) => schoolAccountDomainService.matchesAccountSearch(account, query.q));

    const visibleAccounts = enriched.filter((a) => {
      const st = String(a?.status || '').trim().toLowerCase();
      return st !== 'archived';
    });
    const searchableFields = await inferSearchableFields(visibleAccounts, { exclude: ['audit'] });
    const { data, pagination } = paginate(visibleAccounts, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/account/accountList', {
      title: 'School Accounts',
      tableName: 'School_Accounts',
      newUrl: 'school/accounts',
      newLabel: 'New Account',
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      accountHeadCategories: ACCOUNT_HEAD_CATEGORIES,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listArchivedAccounts = async (req, res) => {
  try {
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    const archivedQuery = { ...query, status: 'archived' };
    // Fetch full archived set, then paginate once in this controller.
    delete archivedQuery.page;
    delete archivedQuery.limit;
    const all = await dataService.fetchData('schoolAccounts', archivedQuery, req.user);
    const searchableFields = await inferSearchableFields(all, { exclude: ['audit'] });
    const ownerByAccount = await schoolAccountDomainService.buildAccountOwnerMap(req.user);
    const idToName = new Map(all.map((a) => [toPublicId(a.id), `${a.code} - ${a.name}`]));
    const enriched = all.map((a) => {
      const owners = ownerByAccount.get(toPublicId(a.id)) || [];
      return {
        ...a,
        parentName: a.parentId ? (idToName.get(toPublicId(a.parentId)) || a.parentId) : '-',
        ownerLinked: owners.length > 0,
        ownerSummary: owners.map((o) => `${String(o.type || '').toUpperCase()}: ${o.id} (${o.status})`).join(', ')
      };
    });

    const { data, pagination } = paginate(enriched, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/account/accountRecovery', {
      title: 'Recover Archived Accounts',
      tableName: 'Archived_School_Accounts',
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

async function renderAccountFormView(req, res, viewName, titleOverride) {
  try {
    const isEdit = !!req.params.id;
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    let account = {};

    if (isEdit) {
      account = await dataService.getDataById('schoolAccounts', req.params.id, req.user);
      if (!account) throw new Error('Account not found.');
      assertAccountOrgAccess(account, activeOrgId, req.user);
    }
    const ownerConflicts = isEdit ? await schoolAccountDomainService.findAccountOwnerConflicts(account.id, req.user) : [];
    const ownerLock = {
      isLocked: ownerConflicts.length > 0,
      owners: ownerConflicts
    };

    const accounts = await dataService.fetchData('schoolAccounts', {}, req.user);
    const parentAccounts = accounts
      .filter((a) => !isEdit || !idsEqual(a.id, account.id))
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));

    res.render(viewName, {
      title: titleOverride || (isEdit ? `Edit Account: ${account.code || account.id}` : 'Create Account'),
      account,
      parentAccounts,
      accountTypes: ACCOUNT_TYPES,
      accountStatuses: ACCOUNT_STATUSES,
      accountPartyRoles: ACCOUNT_PARTY_ROLES,
      accountHeadCategories: ACCOUNT_HEAD_CATEGORIES,
      ownerLock,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

exports.showForm = async (req, res) => {
  return renderAccountFormView(req, res, 'school/account/accountForm');
};

exports.showAddWizardForm = async (req, res) => {
  return renderAccountFormView(req, res, 'school/account/accountWizardForm', 'School Account Wizard');
};

exports.showEditWizardForm = async (req, res) => {
  return renderAccountFormView(req, res, 'school/account/accountWizardForm', 'School Account Wizard');
};

exports.showHelp = async (req, res) => {
  try {
    res.render('school/account/accountHelp', {
      title: 'School Accounts Help',
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const activeOrgId = getActiveOrgIdOrThrow(req.user);

    let existing = null;
    if (id) {
      existing = await dataService.getDataById('schoolAccounts', id, req.user);
      if (!existing) throw new Error('Account not found.');
      assertAccountOrgAccess(existing, activeOrgId, req.user);
    }

    const payload = schoolAccountDomainService.buildAccountPayload(req.body, existing?.orgId || activeOrgId, existing);
    if (!id && req.body.accountId) payload.id = String(req.body.accountId).trim();

    if (id) {
      const ownerConflicts = await schoolAccountDomainService.findAccountOwnerConflicts(id, req.user);
      if (ownerConflicts.length) {
        const changedLockedFields = OWNER_LOCKED_FIELDS.filter((field) => {
          const beforeVal = existing[field];
          const afterVal = payload[field];
          return JSON.stringify(beforeVal) !== JSON.stringify(afterVal);
        });
        if (changedLockedFields.length) {
          throw new Error(
            `This account is owner-linked and has protected fields. ` +
            `Restricted fields cannot be changed: ${changedLockedFields.join(', ')}.`
          );
        }
      }
      await dataService.updateData('schoolAccounts', id, payload, req.user);
    } else {
      await dataService.addData('schoolAccounts', payload, req.user);
    }

    if (isAjax(req)) return res.json({ status: 'success', message: 'Account saved successfully.' });
    res.redirect('/school/accounts');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deleteAccount = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'school_account_archive',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Account archive is already in progress. Please wait.')) return;

    const existing = await dataService.getDataById('schoolAccounts', req.params.id, req.user);
    if (!existing) throw new Error('Account not found.');
    assertAccountOrgAccess(existing, activeOrgId, req.user);

    const ownerConflicts = await schoolAccountDomainService.findAccountOwnerConflicts(req.params.id, req.user);
    if (ownerConflicts.length) {
      const ownerLabel = ownerConflicts
        .map((o) => `${String(o.type || '').toUpperCase()}: ${o.id} (${o.status})`)
        .join(', ');
      throw new Error(
        `This account has owner linkage (${ownerLabel}).<br>` +
        `Please archive/recover it from the owner screen instead of the Accounts section.`
      );
    }

    await dataService.deleteData('schoolAccounts', req.params.id, req.user);
    const payloadOut = {
      status: 'success',
      message: 'Account archived successfully.',
      redirectTo: '/school/accounts'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/accounts');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.recoverAccount = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'school_account_recover',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Account recovery is already in progress. Please wait.')) return;

    const existing = await dataService.getDataById('schoolAccounts', req.params.id, req.user);
    if (!existing) throw new Error('Account not found.');
    assertAccountOrgAccess(existing, activeOrgId, req.user);

    if (String(existing.status || '').toLowerCase() !== 'archived') {
      throw new Error('Only archived accounts can be recovered.');
    }

    const ownerConflicts = await schoolAccountDomainService.findAccountOwnerConflicts(req.params.id, req.user);
    if (ownerConflicts.length) {
      const ownerLabel = ownerConflicts
        .map((o) => `${String(o.type || '').toUpperCase()}: ${o.id} (${o.status})`)
        .join(', ');
      throw new Error(
        `This account has owner linkage (${ownerLabel}).<br>` +
        `Please recover it from the owner screen instead of the Accounts section.`
      );
    }

    await dataService.updateData(
      'schoolAccounts',
      req.params.id,
      { ...existing, status: 'active', allowPost: true },
      req.user
    );
    const payloadOut = {
      status: 'success',
      message: 'Account recovered successfully.',
      redirectTo: '/school/accounts/archived'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/accounts/archived');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

function buildPersonDisplayName(person, fallback = '') {
  const first = String(person?.name?.first || '').trim();
  const last = String(person?.name?.last || '').trim();
  const preferred = String(person?.name?.preferred || '').trim();
  const base = [first, last].filter(Boolean).join(' ').trim();
  return base || preferred || String(fallback || '').trim();
}

function pickNameSuffixFromAccount(account, fallback) {
  const name = String(account?.name || '').trim();
  if (/\(Self-Funded Student\)$/i.test(name)) return 'Self-Funded Student';
  if (/\(Funded Student\)$/i.test(name)) return 'Funded Student';
  if (/\(Teacher\)$/i.test(name)) return 'Teacher';
  if (/\(Staff\)$/i.test(name)) return 'Staff';
  if (/\(Student\)$/i.test(name)) return 'Student';
  return fallback;
}

/**
 * Updates linked student/teacher/staff sub-account names based on the current Persons directory.
 * This is useful when person name fields were edited after accounts were auto-created.
 */
exports.syncOwnerAccountNamesFromPersons = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'school_accounts_sync_owner_names',
      String(activeOrgId || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Name sync is already running. Please wait.')) return;

    const [students, teachers, staff, persons] = await Promise.all([
      dataService.fetchData('students', { orgId__eq: activeOrgId }, req.user),
      dataService.fetchData('teachers', { orgId__eq: activeOrgId }, req.user),
      dataService.fetchData('staff', { orgId__eq: activeOrgId }, req.user),
      dataServiceGlobal.fetchData('persons', {}, req.user, { enrichment: { includeSchoolRoles: false } })
    ]);

    const personMap = new Map((Array.isArray(persons) ? persons : []).map((p) => [toPublicId(p?.id), p]));

    const updates = [];
    function pushUpdate(ownerType, ownerId, personId, accountId, suffixFallback) {
      const normalizedAccountId = toPublicId(accountId);
      if (!normalizedAccountId) return;
      const person = personMap.get(toPublicId(personId)) || null;
      const displayName = buildPersonDisplayName(person, ownerId);
      updates.push({
        ownerType,
        ownerId: String(ownerId || '').trim(),
        personId: toPublicId(personId),
        accountId: normalizedAccountId,
        displayName,
        suffixFallback
      });
    }

    (Array.isArray(students) ? students : []).forEach((s) => {
      pushUpdate('student', s?.id, s?.personId, s?.studentAccountId, 'Student');
    });
    (Array.isArray(teachers) ? teachers : []).forEach((t) => {
      pushUpdate('teacher', t?.id, t?.personId, t?.teacherAccountId, 'Teacher');
    });
    (Array.isArray(staff) ? staff : []).forEach((m) => {
      pushUpdate('staff', m?.id, m?.personId, m?.staffAccountId, 'Staff');
    });

    const seenAccounts = new Set();
    const uniqueUpdates = updates.filter((u) => {
      if (!u.accountId) return false;
      if (seenAccounts.has(u.accountId)) return false;
      seenAccounts.add(u.accountId);
      return true;
    });

    const results = {
      scanned: {
        students: Array.isArray(students) ? students.length : 0,
        teachers: Array.isArray(teachers) ? teachers.length : 0,
        staff: Array.isArray(staff) ? staff.length : 0,
        linkedAccounts: uniqueUpdates.length
      },
      updated: { students: 0, teachers: 0, staff: 0, total: 0 },
      skipped: { missingAccount: 0, unchanged: 0, errors: 0 },
      errors: []
    };

    for (const row of uniqueUpdates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const account = await dataService.getDataById('schoolAccounts', row.accountId, req.user);
        if (!account) {
          results.skipped.missingAccount += 1;
          continue;
        }

        const suffix = pickNameSuffixFromAccount(account, row.suffixFallback);
        const desiredName = suffix ? `${row.displayName} (${suffix})` : row.displayName;

        if (String(account.name || '').trim() === desiredName) {
          results.skipped.unchanged += 1;
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await dataService.updateData('schoolAccounts', row.accountId, { name: desiredName }, req.user);
        results.updated.total += 1;
        if (row.ownerType === 'student') results.updated.students += 1;
        if (row.ownerType === 'teacher') results.updated.teachers += 1;
        if (row.ownerType === 'staff') results.updated.staff += 1;
      } catch (err) {
        results.skipped.errors += 1;
        results.errors.push(`${row.ownerType}:${row.ownerId} account:${row.accountId} - ${String(err?.message || err)}`);
      }
    }

    const payloadOut = {
      status: 'success',
      message: 'Owner-linked account names synced from Persons.',
      result: results
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message, error });
  }
};
