const dataService = require('./dataService');

const { SYSTEM_CONTEXT } = require('../../config/constants');

const { idsEqual, toPublicId } = require('../utils/idAdapter');

const { normalizeOrgRoles, getPrimaryOrgRole } = require('../utils/orgContextUtils');

const { evaluateUserEntitlement } = require('./security/entitlementService');

const {

  resolveOrganizationTimezoneFromRow,

  getTodayDateKeyInTimezone

} = require('../utils/timezoneUtils');



const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });



function cleanString(value, { max = 500, allowEmpty = true } = {}) {

  if (value === undefined || value === null) return allowEmpty ? '' : null;

  const out = String(value).replace(/\0/g, '').trim();

  if (!allowEmpty && !out) return null;

  return out.length > max ? out.slice(0, max) : out;

}



async function fetchUserMembershipRows(userId = '') {

  const normalizedUserId = toPublicId(userId);

  if (!normalizedUserId) return [];

  return dataService.fetchData('userMemberships', {

    q: normalizedUserId,

    type: 'exact_match',

    searchFields: 'userId',

    page: 1,

    limit: 5000

  }, SYSTEM_CONTEXT);

}



async function collectUserMembershipSources(user = {}) {

  let mergedOrgs = [];

  if (user?.personId) {

    const person = await dataService.getDataById('persons', user.personId, SYSTEM_CONTEXT, PERSON_QUERY_OPTIONS);

    if (person && Array.isArray(person.organizations)) {

      mergedOrgs = [...person.organizations];

    }

  }

  if (Array.isArray(user?.organizations)) {

    user.organizations.forEach((uOrg) => {

      const idx = mergedOrgs.findIndex((pOrg) => idsEqual(pOrg?.orgId, uOrg?.orgId));

      if (idx > -1) mergedOrgs[idx] = { ...mergedOrgs[idx], ...uOrg };

      else mergedOrgs.push(uOrg);

    });

  }

  return mergedOrgs;

}



function resolveOrgDisplayName(orgRow = {}, orgData = null) {

  return String(

    orgData?.identity?.displayName

    || orgData?.identity?.legalName

    || orgRow?.name

    || orgRow?.orgName

    || orgRow?.organizationName

    || `Org #${orgData?.id || orgRow?.orgId || ''}`

  ).trim();

}



const userOrgAccessService = {

  async listActiveMemberOrganizationsForUser(user = {}, options = {}) {

    const includeSystem = options?.includeSystem === true;

    const userId = toPublicId(user?.id);

    if (!userId) return [];



    const isVirtualSuperAdmin = user?.isVirtualSuperAdmin === true;

    const hasSystemProfile = Boolean(user?.systemAccessProfileId);

    const membershipSources = await collectUserMembershipSources(user);

    const membershipRows = (!isVirtualSuperAdmin && !hasSystemProfile)

      ? await fetchUserMembershipRows(userId)

      : [];



    const allowedOrgs = [];

    for (const org of membershipSources) {

      if (String(org?.memberStatus || 'active').toLowerCase() !== 'active') continue;

      const orgId = toPublicId(org?.orgId);

      if (!orgId) continue;

      if (!includeSystem && String(orgId).toUpperCase() === 'SYSTEM') continue;



      const orgData = await dataService.getDataById('organizations', orgId, SYSTEM_CONTEXT);

      if (!orgData || orgData.active !== true) continue;

      if (!(await dataService.OrgHasActiveContract(orgData.id, SYSTEM_CONTEXT))) continue;



      const timeZone = resolveOrganizationTimezoneFromRow(orgData);

      const nextOrg = {

        orgId,

        name: resolveOrgDisplayName(org, orgData),

        orgName: resolveOrgDisplayName(org, orgData),

        roles: normalizeOrgRoles(org),

        role: getPrimaryOrgRole(org),

        timeZone,

        isSelectable: true

      };



      if (!isVirtualSuperAdmin && !hasSystemProfile && options?.skipEntitlementCheck !== true) {

        const orgEntitlement = evaluateUserEntitlement(membershipRows, userId, orgId, {

          today: getTodayDateKeyInTimezone(timeZone || 'UTC')

        });

        if (orgEntitlement.enforced && orgEntitlement.active === false) {

          continue;

        }

      }



      allowedOrgs.push(nextOrg);

    }



    return allowedOrgs.sort((a, b) => String(a.name || a.orgId).localeCompare(String(b.name || b.orgId)));

  }

};



module.exports = userOrgAccessService;

