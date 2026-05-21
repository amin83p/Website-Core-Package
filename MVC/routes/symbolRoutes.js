// MVC/routes/symbolRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/symbolController');
const upload = require('../middleware/upload'); // Ensure your upload middleware handles generic files/images
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

// Define Access Constants for Symbols if not already in your config
// If SECTIONS.SYMBOLS doesn't exist yet, you should add it to config/accessConstants.js
// For now, assuming you might map it to 'SETTINGS' or 'OPERATIONS' or a new 'SYMBOLS' section.
// Example: const SECTIONS = { ... SYMBOLS: 'SYMBOLS', ... };

// List
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.SYMBOLS, OPERATIONS.READ), 
    trackActionState(SECTIONS.SYMBOLS, OPERATIONS.READ), 
    ctrl.listSymbols
);

// New Form (GET)
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.SYMBOLS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.SYMBOLS, OPERATIONS.CREATE), 
    ctrl.showAddSymbolForm
);

// New Action (POST) - Supports file upload for 'image' type
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.SYMBOLS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.SYMBOLS, OPERATIONS.CREATE), 
    upload('symbols', true).single('imageFile'), 
    upload.cleanupUploadedFileOnFail,
    ctrl.addSymbol
);

// Edit Form (GET)
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SYMBOLS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.SYMBOLS, OPERATIONS.UPDATE), 
    ctrl.showEditSymbolForm
);

// Edit Action (POST)
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SYMBOLS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.SYMBOLS, OPERATIONS.UPDATE), 
    upload('symbols', true).single('imageFile'), 
    upload.cleanupUploadedFileOnFail,
    ctrl.editSymbol,
);

// Delete
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SYMBOLS, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.SYMBOLS, OPERATIONS.DELETE), 
    ctrl.deleteSymbol
);

module.exports = router;