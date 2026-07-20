// MVC/routes/organizationRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/organizationController');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware'); // ✅ Added
const { trackActionState } = require('../middleware/actionStateMiddleware'); // ✅ Added
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants'); // ✅ Added

// CRUD

// List
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.READ), 
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.READ), 
    ctrl.listOrganizations
);

// New Form (GET) -> Keep Active
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.CREATE), // ✅ Keep Active
    ctrl.showAddOrganizationForm
);

// New Action (POST)
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.CREATE), 
    ctrl.addOrganization
);

// Edit Form (GET) -> Keep Active
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.UPDATE), // ✅ Keep Active
    ctrl.showEditOrganizationForm
);

// Edit Action (POST)
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.UPDATE), 
    ctrl.editOrganization
);

// Delete (legacy — blocked; use purge wizard)
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.DELETE), 
    ctrl.deleteOrganization
);

// Cascade purge plan + execute
router.get('/:id/purge-plan',
    requireAuth,
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.DELETE),
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.DELETE),
    ctrl.getOrganizationPurgePlan
);

router.post('/:id/purge',
    requireAuth,
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.DELETE),
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.DELETE),
    adminApproval,
    ctrl.purgeOrganization
);

// Export
router.post('/export', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.EXPORT), 
    trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.EXPORT), 
    adminApproval, 
    generalExportCtrl.performExport
);

// Import (Disabled but tracked for attempts)
router.post('/import', 
    requireAuth, 
    // requireAccess(SECTIONS.ORGANIZATIONS, OPERATIONS.IMPORT), 
    // trackActionState(SECTIONS.ORGANIZATIONS, OPERATIONS.IMPORT), 
    adminApproval, 
    (req, res) => {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'Error', message: 'This module is not available for this section.' });
        }
        return res.status(500).json({ status: 'Error', message: 'This module is not available for this section.' });
    }
);

module.exports = router;