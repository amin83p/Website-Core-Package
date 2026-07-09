const express = require('express');
const ctrl = require('../controllers/school/deletionGuardController');

const router = express.Router();

router.get('/api/deletion-preview/:entityKey/:id', ctrl.previewDeletion);
router.delete('/api/delete/:entityKey/:id', ctrl.executeDeletion);

module.exports = router;
