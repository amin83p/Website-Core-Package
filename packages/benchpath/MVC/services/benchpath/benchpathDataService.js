const entityGatewayService = require('./data/entityGatewayService');
const accessScopeService = require('./data/accessScopeService');
const domainOpsService = require('./data/domainOpsService');

function buildBenchpathDataServiceFacade() {
  const merged = {
    ...entityGatewayService,
    ...accessScopeService,
    ...domainOpsService
  };

  const duplicateKeys = [];
  const sourceMaps = [
    ['entityGatewayService', Object.keys(entityGatewayService)],
    ['accessScopeService', Object.keys(accessScopeService)],
    ['domainOpsService', Object.keys(domainOpsService)]
  ];
  const seen = new Map();
  sourceMaps.forEach(([name, keys]) => {
    keys.forEach((key) => {
      if (seen.has(key)) duplicateKeys.push(`${key} (${seen.get(key)}, ${name})`);
      else seen.set(key, name);
    });
  });

  if (duplicateKeys.length) {
    throw new Error(`benchpathDataService facade has duplicate method keys: ${duplicateKeys.join(', ')}`);
  }

  return merged;
}

module.exports = buildBenchpathDataServiceFacade();
