const express = require('express');
const router = express.Router();

const docsController = require('../controllers/docsController');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/', requireAuth, docsController.docsHome);
router.get('/view', requireAuth, docsController.viewDocument);
router.get('/download', requireAuth, docsController.downloadDocument);

module.exports = router;
