// MVC/routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { requireAuth } = require('../middleware/authMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');

// Define Section/Op IDs for tracking
// You can define a generic 'USER_PROFILE' section in your config if you want granular auditing
const SECTION_ID = 'USER_PROFILE';
const OP_READ = 'VIEW';
const OP_UPDATE = 'UPDATE';

// GET /profile
router.get('/', 
    requireAuth, 
    // Optional: trackActionState(SECTION_ID, OP_READ),
    profileController.showProfile
);

// POST /profile
router.post('/', 
    requireAuth, 
    // Optional: trackActionState(SECTION_ID, OP_UPDATE),
    profileController.updateProfile
);

// Self-serve Admin Authenticator (any admin privilege on active profile)
router.get('/authenticator',
    requireAuth,
    profileController.showAuthenticator
);
router.get('/authenticator/status',
    requireAuth,
    profileController.getAuthenticatorStatus
);
router.post('/authenticator/begin',
    requireAuth,
    profileController.beginAuthenticatorEnrollment
);
router.post('/authenticator/confirm',
    requireAuth,
    profileController.confirmAuthenticatorEnrollment
);
router.post('/authenticator/disable',
    requireAuth,
    profileController.disableAuthenticatorEnrollment
);

router.get('/authenticator/usage',
    requireAuth,
    profileController.showAuthenticatorUsageAdmin
);
router.post('/authenticator/usage/:userId/reset',
    requireAuth,
    profileController.resetAuthenticatorUsage
);

module.exports = router;
