const REQUIRED_WEBSITE_POLICY_METHODS = Object.freeze(['getPolicy', 'updatePolicy']);

function assertWebsitePolicyRepository(name, repository) {
  const repoName = String(name || 'websitePolicyRepository');
  if (!repository || typeof repository !== 'object') {
    throw new Error(`${repoName} must be an object.`);
  }

  const missing = REQUIRED_WEBSITE_POLICY_METHODS.filter((methodName) => typeof repository?.[methodName] !== 'function');
  if (missing.length > 0) {
    throw new Error(`${repoName} is missing required website-policy method(s): ${missing.join(', ')}.`);
  }
}

module.exports = {
  REQUIRED_WEBSITE_POLICY_METHODS,
  assertWebsitePolicyRepository
};
