'use strict';

const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const { createTransactionContext, addDeleteCompensation } = requireCoreModule('MVC/services/transactionContextService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const {
  assertNoDuplicatePersonAccount,
  enrichPersonPickerRowsWithAccountState
} = require('../../services/school/schoolPeopleDuplicateGuardService');
const schoolPersonNameDuplicateService = require('../../services/school/schoolPersonNameDuplicateService');
const schoolPersonSimilarityService = require('../../services/school/schoolPersonSimilarityService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const schoolLinkedPersonProfileService = require('../../services/school/schoolLinkedPersonProfileService');
const personDenormalizedNameSyncService = require('../../services/school/personDenormalizedNameSyncService');
const { buildSchoolInlinePersonPayload, parseJsonSafe } = require('../../services/school/schoolInlinePersonPayload');
const studentReferralLinkService = require('../../services/school/studentReferralLinkService');
const { REFERRAL_STATUSES } = require('../../models/school/referralModel');
const {
  listSchoolReferringOrganizationOptions,
  sanitizeSchoolReferringOrganizationIds,
  formatSchoolReferringOrganizationLabels
} = require('../../../config/schoolReferringOrganizations');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
  canCreateOrgScopedItem,
  assertOrgAccess
} = requireCoreModule('MVC/utils/orgContextUtils');

const REFERRAL_STATUS_LIST = Array.from(REFERRAL_STATUSES);

function routeAccess(req) {
  return dataService.buildRouteAccessContext(req);
}

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'referrals' });
}

function assertReferralOrgAccess(referral, activeOrgId, reqUser) {
  assertOrgAccess(referral, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

async function ensurePersonHasOrgRole(personId, orgId, role, reqUser, options = {}) {
  return schoolPersonAccessService.ensurePersonHasSchoolRole({ personId, orgId, role, reqUser, options });
}

async function removePersonSchoolRole(personId, orgId, role, reqUser, options = {}) {
  const result = await schoolPersonAccessService.removePersonSchoolRole({ personId, orgId, role, reqUser, options });
  const targetRole = String(role || '').trim().toLowerCase();
  return result?.reason === 'school_role_not_attached'
    ? { ...result, reason: `${targetRole}_role_not_attached` }
    : result;
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
      : { status: 'success', message: 'Referral save already completed.' };
    payload.idempotency = { state: 'replayed' };
    if (isAjax(req)) {
      res.json(payload);
    } else {
      const redirectTo = String(payload.redirectTo || '').trim();
      res.redirect(redirectTo || '/school/referrals');
    }
    return true;
  }
  return false;
}

function buildReferralSearchHaystack(row) {
  const firstName = String(row?.firstName || '').trim();
  const lastName = String(row?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return [
    row?.id,
    row?.personId,
    firstName,
    lastName,
    fullName,
    row?.email,
    row?.phone,
    row?.status,
    row?.notes,
    row?.organizationLabels
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function readReferralOrganizationIds(row) {
  if (Array.isArray(row?.organizationIds) && row.organizationIds.length) return row.organizationIds;
  return Array.isArray(row?.funderIds) ? row.funderIds : [];
}

function parseOrganizationIdsFromBody(body) {
  const fromJson = parseJsonSafe(body.organizationIdsJson, null);
  let raw = fromJson;
  if (raw === null) {
    raw = parseJsonSafe(body.funderIdsJson, null);
  }
  if (raw === null) {
    if (Array.isArray(body.organizationIds)) raw = body.organizationIds;
    else if (body.organizationIds) raw = [body.organizationIds];
    else if (Array.isArray(body.funderIds)) raw = body.funderIds;
    else if (body.funderIds) raw = [body.funderIds];
    else raw = [];
  }
  return sanitizeSchoolReferringOrganizationIds(raw);
}

exports.listEligiblePersons = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    const personPayload = await schoolPersonAccessService.listPickerPersons({
      reqUser: req.user,
      q: query.q || '',
      query,
      requireSchoolRole: false
    });
    const mapped = personPayload.allRows || personPayload.rows || [];
    const enriched = await enrichPersonPickerRowsWithAccountState(mapped, {
      entityType: 'referrals',
      orgId: activeOrgId,
      requestingUser: req.user
    });

    const { data, pagination } = paginate(enriched, query);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.listNameMatches = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const payload = await schoolPersonSimilarityService.buildNameMatchApiPayload({
      reqUser: req.user,
      firstName: String(req.query.first || req.query.firstName || '').trim(),
      lastName: String(req.query.last || req.query.lastName || '').trim(),
      middleName: String(req.query.middleName || '').trim(),
      preferredName: String(req.query.preferredName || '').trim(),
      email: String(req.query.email || '').trim(),
      dateOfBirth: String(req.query.dateOfBirth || '').trim(),
      phone: String(req.query.phone || '').trim(),
      excludePersonId: String(req.query.excludePersonId || '').trim()
    });
    return res.json({ status: 'success', ...payload });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.listReferrals = async (req, res) => {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const searchTerm = String(query.q || '').trim().toLowerCase();
    const fetchQuery = { ...query };
    delete fetchQuery.q;
    delete fetchQuery.type;
    delete fetchQuery.searchFields;
    delete fetchQuery.page;
    delete fetchQuery.limit;
    const canCreateReferrals = await canCreateOrgScopedItem(req.user, { scopeLabel: 'referrals' });
    if (String(query.status || '').trim().toLowerCase() === 'archived') {
      delete query.status;
      delete fetchQuery.status;
    }

    const allRows = await dataService.fetchData('referrals', fetchQuery, req.user, routeAccess(req));
    const personById = await schoolPersonAccessService.buildPersonByIdMap({
      reqUser: req.user,
      personIds: (Array.isArray(allRows) ? allRows : []).map((row) => row.personId)
    });
    const enriched = (allRows || []).map((row) => {
      const person = personById.get(toPublicId(row.personId));
      const organizationLabels = formatSchoolReferringOrganizationLabels(readReferralOrganizationIds(row)) || '-';
      return {
        ...row,
        firstName: person?.name?.first || person?.firstName || 'Unknown',
        lastName: person?.name?.last || person?.lastName || 'Person',
        email: schoolPersonAccessService.readPersonEmail(person) || 'N/A',
        phone: person?.contact?.phones?.[0]?.number || 'N/A',
        organizationLabels
      };
    });

    const visible = enriched.filter((row) => String(row?.status || '').trim().toLowerCase() !== 'archived');
    const searched = !searchTerm ? visible : visible.filter((row) => buildReferralSearchHaystack(row).includes(searchTerm));
    const searchableFields = await inferSearchableFields(searched, { exclude: ['audit'] });
    const { data, pagination } = paginate(searched, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/referral/referralList', {
      title: 'Referrals',
      tableName: 'School_Referrals',
      newUrl: 'school/referrals',
      newLabel: canCreateReferrals ? 'Add Referral' : null,
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      statuses: REFERRAL_STATUS_LIST,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listArchivedReferrals = async (req, res) => {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const searchTerm = String(query.q || '').trim().toLowerCase();

    const archivedQuery = { ...query, status: 'Archived' };
    delete archivedQuery.q;
    delete archivedQuery.type;
    delete archivedQuery.searchFields;
    delete archivedQuery.page;
    delete archivedQuery.limit;

    const allRows = await dataService.fetchData('referrals', archivedQuery, req.user, routeAccess(req));
    const personById = await schoolPersonAccessService.buildPersonByIdMap({
      reqUser: req.user,
      personIds: (Array.isArray(allRows) ? allRows : []).map((row) => row.personId)
    });
    const enriched = (allRows || []).map((row) => {
      const person = personById.get(toPublicId(row.personId));
      const organizationLabels = formatSchoolReferringOrganizationLabels(readReferralOrganizationIds(row)) || '-';
      return {
        ...row,
        firstName: person?.name?.first || person?.firstName || 'Unknown',
        lastName: person?.name?.last || person?.lastName || 'Person',
        email: schoolPersonAccessService.readPersonEmail(person) || 'N/A',
        phone: person?.contact?.phones?.[0]?.number || 'N/A',
        organizationLabels
      };
    });

    const archived = enriched.filter((row) => String(row?.status || '').trim().toLowerCase() === 'archived');
    const searched = !searchTerm ? archived : archived.filter((row) => buildReferralSearchHaystack(row).includes(searchTerm));
    const searchableFields = await inferSearchableFields(searched, { exclude: ['audit'] });
    const { data, pagination } = paginate(searched, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/referral/referralRecovery', {
      title: 'Recover Archived Referrals',
      tableName: 'Archived_Referrals',
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

exports.showForm = async (req, res) => {
  try {
    const isEdit = !!req.params.id;
    const activeOrgId = isEdit
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    let referral = {};
    let personName = '';
    let personOrganizations = [];

    if (isEdit) {
      referral = await dataService.getDataById('referrals', req.params.id, req.user, routeAccess(req));
      if (!referral) throw new Error('Referral not found.');
      assertReferralOrgAccess(referral, activeOrgId, req.user);
      const person = await schoolPersonAccessService.getPersonById({
        reqUser: req.user,
        personId: referral.personId,
        requireSchoolRole: false
      });
      if (person) {
        personName = schoolPersonAccessService.formatPersonName(person, '');
        personOrganizations = Array.isArray(person.organizations) ? person.organizations : [];
      }
    }

    const organizations = await dataServiceGlobal.fetchData('organizations', {}, req.user);
    const organizationLookup = {};
    (organizations || []).forEach((org) => {
      const id = String(org?.id || org?.orgId || '').trim();
      if (!id) return;
      organizationLookup[id] = String(
        org?.name ||
        org?.orgName ||
        org?.identity?.displayName ||
        org?.identity?.legalName ||
        id
      ).trim();
    });

    const organizationOptions = listSchoolReferringOrganizationOptions();
    const selectedOrganizationIds = readReferralOrganizationIds(referral).map(String);

    const editFormDisplayName = String(personName || '').trim() || 'Referral contact';
    const editFormRecordId = String(referral.id || referral.personId || '').trim();
    const canEditLinkedPerson = await schoolLinkedPersonProfileService.evaluateCanEditLinkedPerson({
      reqUser: req.user,
      linkType: 'referral',
      isEdit
    });

    res.render('school/referral/referralForm', {
      title: isEdit ? `Edit Referral: ${editFormDisplayName} (${editFormRecordId})` : 'New Referral',
      referral,
      personName,
      personOrganizations,
      organizationLookup,
      organizationOptions,
      selectedOrganizationIds,
      statuses: REFERRAL_STATUS_LIST,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId,
      canEditLinkedPerson,
      linkedPersonLinkType: 'referral',
      linkedPersonLinkId: isEdit ? editFormRecordId : ''
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveReferral = async (req, res) => {
  let txContext = null;
  let guardKey = '';
  try {
    const { id } = req.params;
    const activeOrgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'referral_save',
      String(activeOrgId || '').trim(),
      String(id || '').trim(),
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Referral save is already in progress. Please wait.')) return;

    txContext = createTransactionContext({
      name: 'referral_save',
      metadata: {
        referralId: toPublicId(id),
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    let existingReferral = null;
    if (id) {
      existingReferral = await dataService.getDataById('referrals', id, req.user, routeAccess(req));
      if (!existingReferral) throw new Error('Referral not found.');
      assertReferralOrgAccess(existingReferral, activeOrgId, req.user);
    }

    const personMode = existingReferral ? 'existing' : String(req.body.personMode || 'existing').trim().toLowerCase();
    let personId = toPublicId(req.body.personId);

    if (!existingReferral && personMode === 'new') {
      await schoolPersonNameDuplicateService.assertNoExactNameDuplicateOrThrow({
        reqUser: req.user,
        firstName: String(req.body.newPersonFirstName || '').trim(),
        lastName: String(req.body.newPersonLastName || '').trim(),
        acknowledged: schoolPersonNameDuplicateService.isNameDuplicateAcknowledged(req.body)
      });
      const personPayload = buildSchoolInlinePersonPayload(req.body, req.user, { defaultDateOfBirth: '2000-01-01' });
      const createdPerson = await dataServiceGlobal.addData('persons', personPayload, req.user, { transactionContext: txContext });
      personId = toPublicId(createdPerson?.id);
      if (!personId) throw new Error('Failed to create person profile before referral registration.');
      addDeleteCompensation(txContext, {
        service: dataServiceGlobal,
        entityType: 'persons',
        id: personId,
        requestingUser: req.user,
        label: 'referral_new_person'
      });
    } else if (!existingReferral && personMode === 'existing') {
      if (!personId) throw new Error('A valid Person must be selected.');
      const person = await schoolPersonAccessService.getPersonById({
        reqUser: req.user,
        personId,
        requireSchoolRole: false
      });
      if (!person) throw new Error('Selected person was not found.');
    }

    const organizationIds = parseOrganizationIdsFromBody(req.body);

    const payload = {
      personId,
      orgId: existingReferral?.orgId ? String(existingReferral.orgId) : String(activeOrgId),
      status: String(req.body.status || 'Active').trim(),
      notes: String(req.body.notes || '').trim(),
      organizationIds
    };

    if (!payload.personId) throw new Error('A valid Person must be selected.');
    if (!id && req.body.referralId) payload.id = String(req.body.referralId).trim();

    await assertNoDuplicatePersonAccount({
      entityType: 'referrals',
      orgId: payload.orgId,
      personId: payload.personId,
      excludeId: id,
      requestingUser: req.user
    });

    const roleUpdateResult = await ensurePersonHasOrgRole(
      payload.personId,
      payload.orgId,
      'school_referral',
      req.user,
      { transactionContext: txContext }
    );
    if (roleUpdateResult?.changed && roleUpdateResult?.personId) {
      txContext.addCompensation(async () => {
        await schoolPersonAccessService.restorePersonOrganizations({
          personId: roleUpdateResult.personId,
          organizations: roleUpdateResult.beforeOrganizations || [],
          reqUser: req.user,
          options: { transactionContext: txContext }
        });
      }, { type: 'restore_person_org_roles', personId: roleUpdateResult.personId });
    }

    let savedReferralRecord = null;
    if (id) {
      savedReferralRecord = await dataService.updateData('referrals', id, payload, req.user, { transactionContext: txContext });
    } else {
      const saved = await dataService.addData('referrals', payload, req.user, { transactionContext: txContext });
      const createdId = toPublicId(saved?.id);
      if (!createdId) throw new Error('Referral was saved but no referral id was returned.');
      savedReferralRecord = saved;
      addDeleteCompensation(txContext, {
        service: dataService,
        entityType: 'referrals',
        id: createdId,
        requestingUser: req.user,
        label: 'referral_new_record'
      });
    }

    await txContext.commit({ flow: 'referral_save', referralId: toPublicId(id || savedReferralRecord?.id) });

    let nameSync = null;
    if (id) {
      nameSync = await personDenormalizedNameSyncService.syncPersonDisplayNameForRoleUpdate({
        personId: payload.personId,
        activeOrgId: payload.orgId,
        reqUser: req.user
      });
    }

    const syncErrors = Number(nameSync?.updated?.errors || 0);
    const referralPickerOption = savedReferralRecord
      ? await studentReferralLinkService.buildReferralPickerOptionFromRecord(
        savedReferralRecord,
        req.user,
        routeAccess(req)
      )
      : null;
    const payloadOut = {
      status: 'success',
      partial: syncErrors > 0,
      message: syncErrors > 0
        ? 'Referral saved, but related name synchronization completed with warnings.'
        : 'Referral saved successfully.',
      nameSync,
      referralId: toPublicId(savedReferralRecord?.id || id),
      referral: referralPickerOption,
      redirectTo: '/school/referrals'
    };

    if (isAjax(req)) {
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    }
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.redirect('/school/referrals');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'referral_save', reason: error.message || 'Referral save failed' });
    }
    const statusCode = Number(error?.statusCode || 400);
    const responsePayload = {
      status: 'error',
      code: error?.code || '',
      error,
      message: error.message,
      details: error?.details || null,
      matches: Array.isArray(error?.details?.matches) ? error.details.matches : undefined
    };
    if (isAjax(req)) return res.status(statusCode).json(responsePayload);
    res.status(statusCode).render('error', { title: 'Error', error, message: error.message, user: req.user, statusCode });
  }
};

exports.archiveReferral = async (req, res) => {
  let guardKey = '';
  let txContext = null;
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'referral_archive',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 60000,
      replayTtlMs: 8000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Referral archive is already in progress. Please wait.')) return;

    const referral = await dataService.getDataById('referrals', req.params.id, req.user, routeAccess(req));
    if (!referral) throw new Error('Referral not found.');
    assertReferralOrgAccess(referral, activeOrgId, req.user);

    if (String(referral.status || '').trim().toLowerCase() === 'archived') {
      const payloadOut = {
        status: 'success',
        message: 'Referral is already archived.',
        data: { referralId: toPublicId(referral.id) },
        redirectTo: '/school/referrals'
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      if (isAjax(req)) return res.json(payloadOut);
      return res.redirect('/school/referrals');
    }

    txContext = createTransactionContext({ name: 'referral_archive' });
    await dataService.updateData(
      'referrals',
      referral.id,
      { ...referral, status: 'Archived' },
      req.user,
      { transactionContext: txContext }
    );

    const roleResult = await removePersonSchoolRole(
      referral.personId,
      activeOrgId,
      'school_referral',
      req.user,
      { transactionContext: txContext }
    );
    if (roleResult?.changed && roleResult?.personId) {
      txContext.addCompensation(async () => {
        await schoolPersonAccessService.restorePersonOrganizations({
          personId: roleResult.personId,
          organizations: roleResult.beforeOrganizations || [],
          reqUser: req.user,
          options: { transactionContext: txContext }
        });
      }, { type: 'restore_person_org_roles', personId: roleResult.personId });
    }

    await txContext.commit({ flow: 'referral_archive', referralId: toPublicId(referral.id) });

    const payloadOut = {
      status: 'success',
      message: 'Referral archived successfully.',
      data: { archivedReferralId: toPublicId(referral.id) },
      redirectTo: '/school/referrals'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/referrals');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) await txContext.rollback({ flow: 'referral_archive', reason: error.message });
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.recoverReferral = async (req, res) => {
  let guardKey = '';
  let txContext = null;
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'referral_recover',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Referral recovery is already in progress. Please wait.')) return;

    const referral = await dataService.getDataById('referrals', req.params.id, req.user, routeAccess(req));
    if (!referral) throw new Error('Referral not found.');
    assertReferralOrgAccess(referral, activeOrgId, req.user);

    if (String(referral.status || '') !== 'Archived') {
      throw new Error('Only archived referrals can be recovered.');
    }

    await assertNoDuplicatePersonAccount({
      entityType: 'referrals',
      orgId: referral.orgId,
      personId: referral.personId,
      excludeId: referral.id,
      requestingUser: req.user
    });

    txContext = createTransactionContext({ name: 'referral_recover' });
    await dataService.updateData(
      'referrals',
      req.params.id,
      { ...referral, status: 'Active' },
      req.user,
      { transactionContext: txContext }
    );

    const roleUpdateResult = await ensurePersonHasOrgRole(
      referral.personId,
      referral.orgId,
      'school_referral',
      req.user,
      { transactionContext: txContext }
    );
    if (roleUpdateResult?.changed && roleUpdateResult?.personId) {
      txContext.addCompensation(async () => {
        await schoolPersonAccessService.restorePersonOrganizations({
          personId: roleUpdateResult.personId,
          organizations: roleUpdateResult.beforeOrganizations || [],
          reqUser: req.user,
          options: { transactionContext: txContext }
        });
      }, { type: 'restore_person_org_roles', personId: roleUpdateResult.personId });
    }

    await txContext.commit({ flow: 'referral_recover', referralId: toPublicId(referral.id) });

    const payloadOut = {
      status: 'success',
      message: 'Referral recovered successfully.',
      redirectTo: '/school/referrals/archived'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/referrals/archived');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) await txContext.rollback({ flow: 'referral_recover', reason: error.message });
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};