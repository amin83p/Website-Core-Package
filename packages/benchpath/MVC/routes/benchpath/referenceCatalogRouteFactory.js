const express = require('express');
const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { OPERATIONS } = require('../../../config/accessConstants');
const { createClbReferenceEntityController } = require('../../controllers/benchpath/clbReferenceController');

function createReferenceCatalogRouter(entityKey, sectionId) {
  const router = express.Router();
  const ctrl = createClbReferenceEntityController(entityKey);

  router.use(requireAuth);

  router.get('/',
    requireAccess(sectionId, OPERATIONS.READ_ALL),
    trackActionState(sectionId, OPERATIONS.READ_ALL),
    ctrl.listItems);
  router.get('/new',
    requireAccess(sectionId, OPERATIONS.CREATE),
    trackActionState(sectionId, OPERATIONS.CREATE),
    ctrl.showAddForm);
  router.post('/new',
    requireAccess(sectionId, OPERATIONS.CREATE),
    trackActionState(sectionId, OPERATIONS.CREATE, { requireToken: true }),
    ctrl.addItem);
  router.get('/edit/:id',
    requireAccess(sectionId, OPERATIONS.UPDATE),
    trackActionState(sectionId, OPERATIONS.UPDATE),
    ctrl.showEditForm);
  router.post('/edit/:id',
    requireAccess(sectionId, OPERATIONS.UPDATE),
    trackActionState(sectionId, OPERATIONS.UPDATE, { requireToken: true }),
    ctrl.editItem);
  router.get('/delete/:id',
    requireAccess(sectionId, OPERATIONS.DELETE),
    trackActionState(sectionId, OPERATIONS.DELETE),
    ctrl.deleteItem);

  return router;
}

module.exports = { createReferenceCatalogRouter };
