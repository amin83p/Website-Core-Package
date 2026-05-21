const express = require("express");
const router = express.Router();
const { verifyAdminCode, getAdminVerificationStatus } = require("../controllers/securityController");
const { requireAuth } = require("../middleware/authMiddleware");

router.get("/status", requireAuth, getAdminVerificationStatus);
router.post("/", requireAuth, verifyAdminCode);
//router.post('/verify-admin', requireAuth, verifyAdminCode);
module.exports = router;
