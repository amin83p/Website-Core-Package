// MVC/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');
const { timeCheckMiddleware } = require('../middleware/timeCheckMiddleware');
const rateLimit = require('express-rate-limit');
const svgCaptcha = require('svg-captcha');

// 1. Define a Limiter (Hard block for spamming IPs)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 credential login requests per window
    message: { status: 'error', message: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

// Microsoft sign-in needs both a redirect start and a callback before a user can
// resolve a session limit. Keep those protocol requests out of the credential
// attempt bucket so the final /force-login request is not blocked by OAuth traffic.
const microsoftLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { status: 'error', message: 'Too many Microsoft sign-in attempts from this IP, please try again after 15 minutes' }
});

const passwordResetRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: { status: 'error', message: 'Too many reset requests. Please try again after 15 minutes.' }
});

const passwordResetVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { status: 'error', message: 'Too many code verification attempts. Please try again later.' }
});

const passwordResetSmsStartLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    message: { status: 'error', message: 'Too many SMS delivery attempts. Please try again later.' }
});
// 2. CAPTCHA Generator Route
router.get('/captcha', (req, res) => {
    const captcha = svgCaptcha.create({
        size: 5, // length of text
        noise: 2, // lines of noise
        color: true,
        background: '#f0f0f0',
        charPreset: '0123456789'  // only numbers 
    });
    // Store the text in session to verify later
    req.session.captcha = captcha.text;
    
    res.type('svg');
    res.status(200).send(captcha.data);
});


router.get('/login', ctrl.showLogin);
router.get('/auth/microsoft', microsoftLoginLimiter, ctrl.startMicrosoftLogin);
router.get('/auth/microsoft/callback', microsoftLoginLimiter, ctrl.microsoftCallback);
router.get('/password-reset', ctrl.showPasswordReset);
router.post('/login', loginLimiter, ctrl.login);
router.post('/force-login', loginLimiter, ctrl.forceLogin);
router.get('/logout', requireAuth ,ctrl.logout);
router.get('/membership-status', requireAuth, ctrl.showMembershipStatus);
router.get('/updates', requireAuth, ctrl.showUpdates);
router.post('/switch-org', requireAuth, ctrl.switchOrg);
router.post('/switch-mode', requireAuth, ctrl.switchProfileMode);
router.post('/password-reset/request', passwordResetRequestLimiter, ctrl.requestPasswordReset);
router.post('/password-reset/sms/start', passwordResetSmsStartLimiter, ctrl.startPasswordResetSms);
router.post('/password-reset/verify', passwordResetVerifyLimiter, ctrl.verifyPasswordReset);
router.post('/password-reset/complete', ctrl.completePasswordReset);

//tempo
router.get('/amin-dash', requireAuth, ctrl.dashboard);

module.exports = router;
