// MVC/controllers/profileController.js
const dataService = require('../services/dataService');
const bcrypt = require('bcryptjs');
const adminTotpService = require('../services/adminTotpService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function denyAuthenticator(req, res, statusCode, message) {
  if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
    return res.status(statusCode).json({ status: 'error', message });
  }
  return res.status(statusCode).render('error', {
    title: statusCode === 403 ? 'Access Needed' : 'Error',
    statusCode,
    message,
    user: req.user || null
  });
}

function requireOwnAuthenticatorAccess(req, res) {
  if (!req.user) {
    denyAuthenticator(req, res, 401, 'Authentication required.');
    return false;
  }
  if (!adminTotpService.canManageOwnTotp(req.user)) {
    denyAuthenticator(
      req,
      res,
      403,
      'Authenticator setup is available to users with admin access on their profile.'
    );
    return false;
  }
  return true;
}

async function saveSession(req) {
  if (typeof req.session?.save !== 'function') return;
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/* ============================================================
   GET: Show Profile Page
============================================================ */
async function showProfile(req, res) {
    try {
        const userId = req.user.id;

        // 1. Fetch Fresh User Data
        // We reload the user to ensure we have the latest state, 
        // specifically for organization memberships and linked person ID.
        const user = await dataService.getDataById('users', userId, req.user);
        if (!user) throw new Error('User account not found.');

        // 2. Fetch Related Person Data
        let person = null;
        if (user.personId) {
            person = await dataService.getDataById('persons', user.personId, req.user, PERSON_QUERY_OPTIONS);
        }

        // 3. Fetch Access Definitions (to display profile names nicely)
        // We use SYSTEM_CONTEXT or req.user depending on visibility rules, 
        // but usually, a user can read 'accesses' to see their own role names.
        const accessDefinitions = await dataService.fetchData('accesses', {}, req.user);

        res.render('user/profile', {
            title: 'My Profile',
            user: user,
            person: person,
            accessDefinitions: accessDefinitions,
            includeModal: true,
            actionStateId: req.actionStateId
        });

    } catch (error) {
        console.error('Profile View Error:', error);
        res.status(500).render('error', { 
            title: 'Error', 
            message: 'Unable to load profile.', 
            user: req.user 
        });
    }
}

/* ============================================================
   POST: Update Profile (Self-Service)
============================================================ */
async function updateProfile(req, res) {
    try {
        const userId = req.user.id;
        const body = req.body;

        // 1. Fetch Current User (Source of Truth)
        const currentUser = await dataService.getDataById('users', userId, req.user);
        if (!currentUser) throw new Error('User account not found.');

        // 2. Prepare Updates (Allowlist Approach)
        // We ONLY pull specific fields. We NEVER merge req.body directly.
        const updates = {
            email: (body.email || '').trim(),
            username: (body.username || '').trim() || currentUser.username, // Keep old if empty
            audit: { 
                lastUpdateUser: userId, 
                lastUpdateDateTime: new Date().toISOString() 
            }
        };

        // 3. Validate Email
        if (!updates.email || !/^\S+@\S+\.\S+$/.test(updates.email)) {
            throw new Error("Invalid email address.");
        }

        // 4. Handle Password Change (Optional)
        if (body.password && body.password.trim().length > 0) {
            const salt = await bcrypt.genSalt(10);
            updates.passwordHash = await bcrypt.hash(body.password.trim(), salt);
        }

        // 5. Handle Default Organization (Context)
        if (body.primaryOrgId) {
            const targetOrgId = String(body.primaryOrgId);
            
            // Security Check: User must actually belong to this Org
            const isMember = (currentUser.organizations || []).some(o => String(o.orgId) === targetOrgId);
            
            // Or be a System Admin/Super Admin who has access to everything
            // (Note: The authService usually populates allowedOrgs, we can check that too)
            const isAllowed = isMember || req.user.allowedOrgs.some(o => String(o.orgId) === targetOrgId);

            if (isAllowed) {
                updates.primaryOrgId = Number(targetOrgId);
            } else {
                // If they tried to switch to an org they aren't part of, ignore it or throw error.
                // We'll ignore it to be safe and just keep the old one.
                console.warn(`User ${userId} tried to set primaryOrgId ${targetOrgId} without membership.`);
            }
        }

        // 6. Persist
        await dataService.updateData('users', userId, updates, req.user);

        // 7. Response
        if (req.headers['x-ajax-request']) {
            return res.json({ 
                status: 'success', 
                message: 'Profile updated successfully. Changes will take effect on next login.' 
            });
        }
        res.redirect('/profile');

    } catch (error) {
        console.error('Profile Update Error:', error);
        
        if (req.headers['x-ajax-request']) {
            return res.status(400).json({ status: 'error', message: error.message });
        }
        res.status(400).render('error', { 
            title: 'Update Failed', 
            message: error.message, 
            user: req.user 
        });
    }
}

/* ============================================================
   GET: Self-serve Authenticator (admin-privilege users)
============================================================ */
async function showAuthenticator(req, res) {
  try {
    if (!requireOwnAuthenticatorAccess(req, res)) return;
    const adminTotpStatus = await adminTotpService.getStatus(req.user.id);
    return res.render('profile/authenticator', {
      title: 'Authenticator',
      user: req.user,
      includeModal: true,
      adminTotpStatus
    });
  } catch (error) {
    console.error('Authenticator View Error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load authenticator settings.',
      user: req.user
    });
  }
}

async function getAuthenticatorStatus(req, res) {
  try {
    if (!requireOwnAuthenticatorAccess(req, res)) return;
    const status = await adminTotpService.getStatus(req.user.id);
    return res.json({ status: 'success', ...status });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to load authenticator status.' });
  }
}

async function beginAuthenticatorEnrollment(req, res) {
  try {
    if (!requireOwnAuthenticatorAccess(req, res)) return;
    const setup = await adminTotpService.beginEnrollment({ req, targetUser: req.user });
    await saveSession(req);
    return res.json({ status: 'success', ...setup });
  } catch (error) {
    const code = error?.code || 'BEGIN_FAILED';
    const statusCode = code === 'ALREADY_ENROLLED' ? 409 : 400;
    return res.status(statusCode).json({ status: 'error', code, message: error.message });
  }
}

async function confirmAuthenticatorEnrollment(req, res) {
  try {
    if (!requireOwnAuthenticatorAccess(req, res)) return;
    const result = await adminTotpService.confirmEnrollment({
      req,
      targetUser: req.user,
      code: req.body?.code
    });
    await saveSession(req);
    return res.json({ status: 'success', ...result });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      code: error?.code || 'CONFIRM_FAILED',
      message: error.message
    });
  }
}

async function disableAuthenticatorEnrollment(req, res) {
  try {
    if (!requireOwnAuthenticatorAccess(req, res)) return;
    const code = String(req.body?.code || '').trim();
    if (!code) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter a current authenticator code to disable enrollment.'
      });
    }
    const result = await adminTotpService.disableEnrollment({
      targetUser: req.user,
      code,
      requireCode: true
    });
    adminTotpService.clearPending(req);
    await saveSession(req);
    return res.json({ status: 'success', ...result });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      code: error?.code || 'DISABLE_FAILED',
      message: error.message
    });
  }
}

module.exports = {
    showProfile,
    updateProfile,
    showAuthenticator,
    getAuthenticatorStatus,
    beginAuthenticatorEnrollment,
    confirmAuthenticatorEnrollment,
    disableAuthenticatorEnrollment
};
