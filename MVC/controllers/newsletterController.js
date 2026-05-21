// MVC/controllers/newsletterController.js
const fs = require('fs').promises;
const newsletterRepository = require('../repositories/newsletterRepository');
const dataService = require('../services/dataService');
const {isAjax, buildDataServiceQuery, inferSearchableFields} = require('../utils/generalTools');
const resendEmailService = require('../services/resendEmailService');

// ✅ NEW IMPORTS
const settingService = require('../services/settingService');

function wantsJson(req) {
  return req.headers['x-ajax-request'] || (req.headers.accept || '').includes('application/json');
}

function buildBaseUrl(req) {
  const envBase = String(
    process.env.APP_PUBLIC_URL
    || process.env.PUBLIC_APP_URL
    || process.env.WEBSITE_BASE_URL
    || ''
  ).trim();
  if (envBase) return envBase.replace(/\/+$/, '');

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  if (!host) return '';
  return `${protocol}://${host}`;
}

exports.apiSubscribe = async (req, res) => {
  try {
    const email = req.body?.email;
    const meta = { page: req.body?.meta?.page || req.headers.referer || null, ts: new Date().toISOString() };
    
    // ✅ GET DEFAULT GROUP FROM SETTINGS
    const defaultGroupId = settingService.getValue('newsletter', 'defaultGroupId');

    // ✅ PASS GROUP ID TO MODEL
    const sub = await newsletterRepository.subscribeEmail(email, meta, defaultGroupId);

    const shouldSendWelcome = settingService.getValue('newsletter', 'sendWelcomeEmail') !== false;
    if (shouldSendWelcome && resendEmailService.isConfigured()) {
      try {
        const baseUrl = buildBaseUrl(req);
        const unsubscribeUrl = baseUrl
          ? `${baseUrl}/newsletter/unsubscribe/${encodeURIComponent(String(sub?.email || email || '').trim())}`
          : '';
        await resendEmailService.sendNewsletterWelcome({
          toEmail: sub?.email || email,
          unsubscribeUrl
        });
      } catch (welcomeError) {
        console.warn('[NEWSLETTER][WELCOME_EMAIL_FAIL]', welcomeError?.message || welcomeError);
      }
    }

    return res.json({
      status: 'success',
      message: 'Subscribed successfully.',
      result: { id: sub.id, email: sub.email, manageCode: sub.manageCode, active: sub.active, statusText: sub.status }
    });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message || 'Subscribe failed.' });
  }
};

exports.apiUnsubscribe = async (req, res) => {
  try {
    const email = req.body?.email;
    const mode = 'deactivate';

    await newsletterRepository.unsubscribeEmail(
      email,
      null,
      { mode, page: req.body?.meta?.page || req.headers.referer || null, ts: new Date().toISOString() }
    );

    return res.json({
      status: 'success',
      message: 'If this email exists in our system, it has been unsubscribed.'
    });
  } catch (err) {
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Unsubscribe failed.'
    });
  }
};

// Admin pages
exports.listAdmin = async (req, res) => {
    const query = await buildDataServiceQuery(req.query);
    query.page = req.query.page;
    query.limit = req.query.limit;
    if (!query.sort) query.sort = 'subscribedAt';
    if (!query.order) query.order = 'desc';

    const paged = await dataService.fetchDataPaged('newsletter', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;

    // ✅ FETCH GROUPS TO MAP NAMES
    const groups = await dataService.fetchData('subscriptionGroups', {}, req.user);
    const groupMap = {};
    groups.forEach(g => { groupMap[g.id] = g.name; });

    const searchableFields = await inferSearchableFields(data, { exclude: ['audit', 'attachments'] });

  return res.render('newsletter/subscriptions', {
    title: 'Newsletter Subscriptions',
    data,
    searchableFields,
    groupMap, // ✅ PASS GROUP MAP TO VIEW
    tableName: 'newletters_Management',
    newLabel: 'Add New',
    newUrl: 'newsletter/admin',
    includeModal: true,
    includeModal_Table: true,
    includeModal_FileImport: true,
    print: true,
    pagination,
    filters: req.query, 
    user: req.user || null,
    actionStateId: req.actionStateId
  });
};

exports.updateAdmin = async (req, res) => {
  try {
    const id = req.params.id;

    const updates = {
      email: req.body.email,
      active: req.body.active === 'true' || req.body.active === true || req.body.active === 'on',
      status: req.body.status || undefined,
      note: typeof req.body.note === 'string' ? req.body.note : undefined
    };

    await newsletterRepository.update(id, updates);

    if (wantsJson(req)) return res.json({ status: 'success', message: 'Updated.' });
    return res.redirect('/newsletter/admin');
  } catch (err) {
    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: err.message || 'Update failed.' });
    return res.redirect('/newsletter/admin');
  }
};

exports.deleteAdmin = async (req, res) => {
  try {
    const deleted_item = await newsletterRepository.remove(req.params.id);
    if (isAjax(req))// req.headers['x-ajax-request']) 
      return res.json({ status: 'success' ,results:deleted_item, message:'Item deleted successfully.', result: deleted_item});
    return res.redirect('/newsletter/admin');
  } catch (err) {
    return res.redirect('/newsletter/admin');
  }
};

exports.showUnsubscribePage = (req, res) => {  
  return res.render('newsletter/unsubscribe', 
    {   
        title: 'Unsubscribe',
        email: req.params?.id || '',
        homeUrl: req.params?.id ? '/newsletter/admin' :req.referer,
        includeModal: true,
        user: req.user
    });
};

exports.showImportPage = async (req, res) => {
  try {
    // Groups are now fetched dynamically via the Picker on the client-side
    
    res.render('newsletter/import', {
      title: 'Import Subscribers',
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message, user: req.user });
  }
};

exports.processImport = async (req, res) => {
  try {
    const { groupId, manualEmails } = req.body;
    const file = req.file;
    const candidates = [];

    if (manualEmails && typeof manualEmails === 'string') {
        const manualList = manualEmails.split(/[\r\n,]+/).map(e => e.trim()).filter(e => e);
        candidates.push(...manualList);
    }

    if (file) {
        const content = await fs.readFile(file.path, 'utf8');
        if (file.mimetype.includes('json') || file.originalname.endsWith('.json')) {
            try {
                const json = JSON.parse(content);
                if (Array.isArray(json)) {
                    json.forEach(item => {
                        if (typeof item === 'string') candidates.push(item);
                        else if (item.email) candidates.push(item.email);
                    });
                }
            } catch (e) { throw new Error('Invalid JSON format.'); }
        } else {
            const lines = content.split(/[\r\n]+/);
            lines.forEach(line => {
                const parts = line.split(',');
                const potentialEmail = parts[0].trim();
                if (potentialEmail) candidates.push(potentialEmail);
            });
        }
        await fs.unlink(file.path).catch(() => {});
    }

    if (candidates.length === 0) throw new Error('No valid emails found to import.');

    let successCount = 0;
    let failCount = 0;
    const errors = [];
    const meta = { source: 'admin_import', importedBy: req.user.id };

    for (const email of candidates) {
        try {
            await newsletterRepository.subscribeEmail(email, meta, groupId);
            successCount++;
        } catch (err) {
            failCount++;
            if (errors.length < 10) errors.push(`${email}: ${err.message}`);
        }
    }

    const responseMsg = `Import Complete. Added/Updated: ${successCount}, Failed: ${failCount}`;

    if (wantsJson(req)) {
        return res.json({ status: 'success', message: responseMsg, details: { successCount, failCount, errors } });
    }
    
    res.redirect('/newsletter/admin');

  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: err.message });
    res.status(500).render('error', { title: 'Import Error', message: err.message, user: req.user });
  }
};

// ✅ NEW: Show Add Form
exports.showAddForm = async (req, res) => {
  try {
    res.render('newsletter/subscriptionForm', {
      title: 'Add Subscriber',
      subscription: null, // New mode
      user: req.user,
      includeModal: true, // For Generic Picker
      actionStateId: req.actionStateId
    });
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: err.message, user: req.user });
  }
};

// ✅ NEW: Process Add
exports.addSubscription = async (req, res) => {
  try {
    const { email, groupId, active, note } = req.body;

    await newsletterRepository.adminCreateSubscription({
      email,
      groupId,
      active: active === 'true' || active === 'on', // Checkbox handling
      note,
      auditUser: req.user ? req.user.id : 'admin'
    });

    if (wantsJson(req)) {
      return res.json({ status: 'success', message: 'Subscriber added successfully.' });
    }
    res.redirect('/newsletter/admin');

  } catch (err) {
    if (wantsJson(req)) {
      return res.status(400).json({ status: 'error', message: err.message });
    }
    res.status(500).render('error', { title: 'Error', message: err.message, user: req.user });
  }
};
