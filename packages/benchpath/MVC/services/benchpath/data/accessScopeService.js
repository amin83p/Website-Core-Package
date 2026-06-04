const entityGatewayService = require('./entityGatewayService');

const accessScopeService = {
  getAccessibleSources: async (requestingUser) => entityGatewayService.fetchData('sources', {}, requestingUser),
  getAccessibleSourceFragments: async (requestingUser) => entityGatewayService.fetchData('sourceFragments', {}, requestingUser),
  getAccessibleClbFrameworks: async (requestingUser) => entityGatewayService.fetchData('clbFrameworks', {}, requestingUser),
  getAccessibleClbStages: async (requestingUser) => entityGatewayService.fetchData('clbStages', {}, requestingUser),
  getAccessibleClbSkills: async (requestingUser) => entityGatewayService.fetchData('clbSkills', {}, requestingUser),
  getAccessibleClbCompetencyAreas: async (requestingUser) => entityGatewayService.fetchData('clbCompetencyAreas', {}, requestingUser),
  getAccessibleClbBenchmarks: async (requestingUser) => entityGatewayService.fetchData('clbBenchmarks', {}, requestingUser),
  getAccessibleClbCompetencies: async (requestingUser) => entityGatewayService.fetchData('clbCompetencies', {}, requestingUser),
  getAccessibleClbIndicators: async (requestingUser) => entityGatewayService.fetchData('clbIndicators', {}, requestingUser),
  getAccessibleClbProfileOfAbility: async (requestingUser) => entityGatewayService.fetchData('clbProfileOfAbility', {}, requestingUser),
  getAccessibleClbFeaturesOfCommunication: async (requestingUser) => entityGatewayService.fetchData('clbFeaturesOfCommunication', {}, requestingUser),
  getAccessibleClbSampleTaskLabels: async (requestingUser) => entityGatewayService.fetchData('clbSampleTaskLabels', {}, requestingUser),
  getAccessibleBenchpathTasks: async (requestingUser) => entityGatewayService.fetchData('benchpathTasks', {}, requestingUser)
};

module.exports = accessScopeService;
