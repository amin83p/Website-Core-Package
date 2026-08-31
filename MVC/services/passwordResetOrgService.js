const userOrgAccessService = require('./userOrgAccessService');

const emailOrgCapabilityService = require('./emailOrgCapabilityService');

const { toPublicId } = require('../utils/idAdapter');



const RESET_EVENT_KEY = 'AUTH_PASSWORD_RESET_CODE';



const passwordResetOrgService = {

  async listEligibleResetOrgsForUser(user = {}) {

    const memberships = await userOrgAccessService.listActiveMemberOrganizationsForUser(user, {

      includeSystem: false,

      skipEntitlementCheck: true

    });

    const eligible = [];

    for (const org of memberships) {

      const orgId = toPublicId(org?.orgId);

      if (!orgId) continue;

      // eslint-disable-next-line no-await-in-loop

      const canSend = await emailOrgCapabilityService.canOrgSendEmail(orgId, {

        eventKey: RESET_EVENT_KEY

      });

      if (!canSend) continue;

      eligible.push({

        orgId,

        name: String(org?.name || org?.orgName || orgId).trim() || orgId

      });

    }

    return eligible;

  }

};



module.exports = passwordResetOrgService;

