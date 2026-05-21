const express = require('express');
const router = express.Router();
const styleController = require('../controllers/styleController'); // Single Controller
const { evaluateAccess } = require('../services/security/accessControl');

// Middleware to protect style routes
const protect = async (req, res, next) => {
    // Permission ID: THEME001 (Ensure this exists in your sections.json)
    const access = await evaluateAccess({ user: req.user, sectionId: '265881' });
    if(access.allowed) next();
    else res.status(403).render('error', { message: access.reason });
};

// --- Theme Editor (Variables) ---
router.get('/', protect, styleController.showStyleEditor);
router.post('/save', protect, styleController.saveStyles);

// --- Button Studio (Buttons) ---
router.get('/buttons', protect, styleController.listButtons);
router.post('/buttons/save', protect, styleController.saveButton);
router.post('/buttons/delete', protect, styleController.deleteButton);


// Table Styler Route
router.get('/tables', protect, styleController.showTableStyler);
// We reuse the generic saveStyles since it just updates variables
router.post('/tables/save', protect, styleController.saveStyles);

// Footer Styler Route
router.get('/footer', protect, styleController.showFooterStyler);
router.post('/footer/save', protect, styleController.saveStyles); // Reuse generic save

// Header Styler
router.get('/header', protect, styleController.showHeaderStyler);
router.post('/header/save', protect, styleController.saveStyles); // Reuse saveStyles

// Dashboard Styler
router.get('/dashboard', protect, styleController.showDashboardStyler);
router.post('/dashboard/save', protect, styleController.saveStyles);

// Modal Styler
router.get('/modals', protect, styleController.showModalStyler);
router.post('/modals/save', protect, styleController.saveStyles);

// Search Styler
router.get('/search', protect, styleController.showSearchStyler);
router.post('/search/save', protect, styleController.saveStyles);

module.exports = router;