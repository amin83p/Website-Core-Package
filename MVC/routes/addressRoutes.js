const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/authMiddleware');
const addressAutocompleteController = require('../controllers/addressAutocompleteController');

const router = express.Router();

const addressSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many address searches. Please wait a moment and try again.' }
});

router.get(
  '/search',
  requireAuth,
  addressSearchLimiter,
  addressAutocompleteController.searchAddresses
);

router.get(
  '/retrieve',
  requireAuth,
  addressSearchLimiter,
  addressAutocompleteController.retrieveAddress
);

module.exports = router;
