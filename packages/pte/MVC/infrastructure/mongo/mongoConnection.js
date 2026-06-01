const { requireCoreModule } = require('../../services/pte/pteCoreModuleResolver');

module.exports = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
