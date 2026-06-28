// MVC/controllers/contactController.js

const gtools = require('../utils/generalTools');
const dataService = require('../services/dataService');
const resendEmailService = require('../services/resendEmailService');
const appBrandingService = require('../services/appBrandingService');
const uploadMiddleware = require('../middleware/upload');
const fileAssetStorage = require('../services/fileAssetStorageService');
const CONTACT_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'email', 'subject', 'type', 'status'],
  allowedSearchFields: ['id', 'name', 'email', 'subject', 'message', 'type', 'status'],
  defaultSearchFields: ['id', 'name', 'email', 'subject', 'message', 'type', 'status'],
  allowMetaKeys: true
});

// function isAjax(req) {
//   // scopes.ejs sends 'X-AJAX-Request': 'true' which becomes lowercased in Node headers [file:8]
//   return !!(req.headers['x-ajax-request'] || req.headers['X-AJAX-Request']);
// }

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function normalizeFiles(req) {
  const files = req.files || [];
  return files.map(f => ({
    originalName: f.originalname,
    fileName: f.filename,
    mimeType: f.mimetype,
    size: f.size,
    path: uploadMiddleware.getStoredFilePath(f),
    url: uploadMiddleware.getStoredFileUrl(f)
  }));
}

function includesCI(haystack, needle) {
  return String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function filterMessages(list, { q, status }) {
  let out = Array.isArray(list) ? list : [];

  if (status && status !== 'All') {
    out = out.filter(m => String(m.status || 'Unread') === String(status));
  }

  if (q) {
    out = out.filter(m => (
      includesCI(m.id, q) ||
      includesCI(m.name, q) ||
      includesCI(m.email, q) ||
      includesCI(m.subject, q) ||
      includesCI(m.message, q) ||
      includesCI(m.type, q)
    ));
  }

  // newest first
  out.sort((a, b) => {
    const ad = a?.audit?.createDateTime ? Date.parse(a.audit.createDateTime) : 0;
    const bd = b?.audit?.createDateTime ? Date.parse(b.audit.createDateTime) : 0;
    return bd - ad;
  });

  return out;
}

/* =========================================================
   PUBLIC
   ========================================================= */

async function showContactPage(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // If your view is /views/contact.ejs, change to: res.render('contact', ...) instead.
  return res.render('contact/contact', {
    title: 'Contact Us',
    includeModal: true,
    htmlClass: 'pte-public-root',
    bodyClass: 'pte-public-body public-zoom-centered-body contact-public-body',
    mainClass: 'container pte-public-main contact-public-main',
    appContact: appBrandingService.getContact(),
    appContactPage: appBrandingService.getContactPage(),
    user: req.user || null
  });
}

async function submitContact(req, res) {
  try {
    // Supports:
    // - JSON: req.body = { ... }
    // - multipart: req.body.payload = JSON string
    const body = req.body?.payload
      ? (safeJsonParse(req.body.payload) || {})
      : (req.body || {});

    const now = new Date().toISOString();

    // Reviewer-only fields are set here (client can't set them)
    const msg = {
      name: String(body.name || '').trim(),
      email: String(body.email || '').trim(),
      type: String(body.type || '').trim(),
      timeline: String(body.timeline || '').trim(),
      subject: String(body.subject || '').trim(),
      message: String(body.message || '').trim(),

      attachments: normalizeFiles(req),

      status: 'Unread',
      note: '',

      meta: body.meta || {},
      audit: {
        createDateTime: now,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || '',
        userId: req.user ? req.user.id : null
      }
    };

    const saved = await dataService.addData('contactMessages',msg,req.user);

    const contactRecord = {
      ...msg,
      id: saved?.id || msg?.id || ''
    };
    if (resendEmailService.isConfigured()) {
      try {
        await resendEmailService.sendContactTask(contactRecord);
      } catch (notifyError) {
        console.warn('[CONTACT][EMAIL_NOTIFY_FAIL]', notifyError?.message || notifyError);
      }
    }

    return res.json({
      status: 'success',
      result: { id: saved.id },
      message: `Thanks—your message was sent (Ref: ${saved.id}).`
    });
  } catch (error) {
    // Follow your pattern: 400 for user/validation errors so session can stay active [file:6]
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

/* =========================================================
   ADMIN PAGES
   ========================================================= */

async function listMessages(req, res) {
  try {
    const q = req.query.q || '';
    const status = req.query.status || 'All';

    const query = await gtools.buildDataServiceQuery(req.query, CONTACT_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;
    query.q = q;
    query.sort = 'audit.createDateTime';
    query.order = 'desc';
    if (status && status !== 'All') {
      query.status__eq = status;
    }

    const paged = await dataService.fetchDataPaged('contactMessages', {
      ...query,
      page,
      limit
    }, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;

    // Optional AJAX mode (if you ever want it)
    console.log(gtools.isAjax(req), req.headers['x-ajax-request']);
    if (gtools.isAjax(req)) {
      return res.json({ status: 'success', result: data, pagination });
    }

    return res.render('contact/messages', {
      title: 'Contact Messages',
      tableName: 'Contact_Messages',
      newLabel: 'Contact',
      newUrl: 'contact/messages',
      messages: data,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      searchableFields: CONTACT_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query, 
      user: req.user || null
    });
  } catch (error) {
    if (gtools.isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function viewMessage(req, res) {
  try {
    const id = req.params.id;    
    const msg = await dataService.getDataById('contactMessages', id, req.user);
    if (!msg) throw new Error('Message not found.');

    return res.render('contact/messageView', {
      title: `Message ${msg.id}`,
      message: msg,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if(gtools.isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user});
  }
}

async function deleteMessage(req, res) {
  try {
    const id = req.params.id;
    const existing = await dataService.getDataById('contactMessages', id, req.user).catch(() => null);
    const result = await dataService.deleteData('contactMessages', id, req.user);
    const attachments = Array.isArray(existing?.attachments) ? existing.attachments : [];
    await Promise.all(attachments.map((file) => (
      uploadMiddleware.deleteFilePaths(file?.url || file?.path).catch(() => {})
    )));

    if (gtools.isAjax(req)) {
      return res.json({ status: 'success', result, message: 'Message deleted successfully.' });
    }

    return res.redirect('/contact/messages');
  } catch (error) {
    if (gtools.isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function updateReviewFields(req, res) {
  try {
    const { id, status, note, userNote } = req.body || {};

    const allowed = new Set(['Unread', 'Under view', 'Done']);
    if (!id) throw new Error('Missing id.');
    if (!allowed.has(String(status))) throw new Error('Invalid status.');
    if (note !== undefined && typeof note !== 'string') throw new Error('Invalid note.');

    const updates = {
      status: String(status),
      note: String(note || ''),
      userNote: String(userNote || '')
    };
    const result = await dataService.updateData('contactMessages', id, updates, req.user);

    return res.json({ status: 'success', result, message: 'Saved.' });
  } catch (error) {
    // return res.status(400).json({ status: 'error', message: error.message });
    if (gtools.isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* =========================================================
   OPTIONAL: Attachment download
   ========================================================= */

async function downloadAttachment(req, res) {
  try {
    const { id, fileName } = req.params;

    const msg = await dataService.getDataById('contactMessages', id, req.user);
    if (!msg) throw new Error('Message not found.');

    const files = msg.attachments || [];
    const hit = files.find(f => String(f.fileName) === String(fileName));
    if (!hit) throw new Error('File not found.');
    const ref = String(hit.url || hit.path || '').trim();
    if (!ref) throw new Error('File not found.');

    return await fileAssetStorage.sendDownload(res, ref, hit.originalName || hit.fileName);
  } catch (error) {
    if (gtools.isAjax(req)) return res.status(404).json({ status: 'error', error, message: error.message });
    res.status(404).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    // if (isAjax(req)) {
    //   return res.status(404).json({ status: 'error', message: error.message });
    // }
    // return res.status(404).send('Not found');
  }
}
async function trackMessage(req, res){
  try{
    const { code, email } = req.body || {};
    const result = await dataService.getPublicContactMessageStatus(code, email);

    if (!result) {
      return res.status(404).json({ status: 'error', message: 'Message not found (check code + email).' });
    }

    return res.json({ status: 'success', result });
  }catch(err){
    return res.status(400).json({ status: 'error', message: err.message });
  }
}
module.exports = {
  showContactPage,
  submitContact,

  listMessages,
  viewMessage,
  deleteMessage,
  updateReviewFields,
  downloadAttachment,
  trackMessage
};
