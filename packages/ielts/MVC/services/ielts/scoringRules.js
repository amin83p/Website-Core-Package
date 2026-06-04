'use strict';

const trRules = require('./scoringRules/trRules');
const ccRules = require('./scoringRules/ccRules');
const lrRules = require('./scoringRules/lrRules');
const graRules = require('./scoringRules/graRules');
const {
  applyRulePatchGroupGuards,
  currentParagraphProfile,
  getCurrentParagraphRole,
  getCurrentParagraphSentenceCount,
  isRulePatchGroupEnabled,
  RULE_PATCH_GROUP_META,
  RULE_PATCH_GROUP_NAME_BY_KEY
} = require('./scoringRules/shared');

const scoringRules = {
  ...trRules,
  ...ccRules,
  ...lrRules,
  ...graRules
};

applyRulePatchGroupGuards(scoringRules);

const scoringRuleHelpers = {
  currentParagraphProfile,
  getCurrentParagraphRole,
  getCurrentParagraphSentenceCount,
  isRulePatchGroupEnabled,
  patchGroupMeta: RULE_PATCH_GROUP_META,
  patchGroupByRuleKey: RULE_PATCH_GROUP_NAME_BY_KEY
};

module.exports = { scoringRules, scoringRuleHelpers };
