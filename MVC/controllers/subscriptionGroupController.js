// MVC/controllers/subscriptionGroupController.js
const dataService = require('../services/dataService');
const newsletterRepository = require('../repositories/newsletterRepository');
const { idsEqual } = require('../utils/idAdapter');

const settingService = require('../services/settingService'); // ✅ Use Dynamic Service
const { getDashboardSection } = require('./dashboardController');
const paginate = require('../utils/paginationHelper');
const {isAjax, buildDataServiceQuery, inferSearchableFields} = require('../utils/generalTools');

/* ---------------- HELPERS ---------------- */

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true' || String(v) === 'on';
}

function buildGroupFromBody(body, reqUser, existing = null) {
  const now = new Date().toISOString();

  return {
    // If existing, keep OrgId. If new, use activeOrgId.
    orgId: existing ? existing.orgId : reqUser.activeOrgId,
    name: body.name,
    description: body.description,
    active: parseBool(body.active),
    audit: {
      createUser: existing?.audit?.createUser ?? reqUser.id,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUser.id,
      lastUpdateDateTime: now,
    }
  };
}

/* ---------------- CONTROLLERS ---------------- */
exports.dashboard = async (req, res) => {
  const dashboardSections = [
    {
      priority: 10,
      title: 'Subscription Groups',
      description: 'Manage newsletter categories and audience segments.',
      href: '/subscriptiongroup',
      buttonLabel: 'Manage Groups',
      icon: 'bi-collection-fill',
      subtleClass: 'bg-primary-subtle text-primary',
      buttonClass: 'btn btn-primary'
    },
    {
      priority: 20,
      title: 'Create Group',
      description: 'Launch the form to define a new subscription list.',
      href: '/subscriptiongroup/new',
      buttonLabel: 'Add New Group',
      icon: 'bi-plus-lg',
      subtleClass: 'bg-success-subtle text-success',
      buttonClass: 'btn btn-success'
    },
    {
      priority: 30,
      title: 'All Subscribers',
      description: 'View registered emails, search subscribers, and export data.',
      href: '/newsletter/admin',
      buttonLabel: 'View Subscribers',
      icon: 'bi-people-fill',
      subtleClass: 'bg-info-subtle text-info',
      buttonClass: 'btn btn-info text-white'
    },
    {
      priority: 40,
      title: 'Import Subscribers',
      description: 'Bulk add emails via CSV, JSON, or manual entry to a specific group.',
      href: '/newsletter/admin/import',
      buttonLabel: 'Import Data',
      icon: 'bi-cloud-upload-fill',
      subtleClass: 'bg-warning-subtle text-warning',
      buttonClass: 'btn btn-warning text-dark'
    },
    {
      priority: 50,
      title: 'Unsubscribe Page',
      description: 'Public-facing page for users to manage their opt-outs.',
      href: '/newsletter/unsubscribe',
      buttonLabel: 'Public Link',
      icon: 'bi-envelope-slash-fill',
      subtleClass: 'bg-secondary-subtle text-secondary',
      buttonClass: 'btn btn-secondary'
    }
  ].sort((a, b) => (Number(a.priority || 0) - Number(b.priority || 0)));

  const dashboardSection = await getDashboardSection('/subscriptionGroup/dashboard', req.user);
  res.render('newsletter/dashboard', {
    title: 'Newsletter Dashboard',
    dashboardSections,
    dashboardSection,
    user: req.user
  });
};

exports.listGroups = async (req, res) => {
  try {
    const query = await buildDataServiceQuery(req.query);
    // const query = {
    //     q: req.query.q || '',
    //     type: req.query.type,
    //     // Allow filtering via dataService if needed
    //     searchFields: 'id,name,description' 
    // };

    // Use dataService to fetch accessible groups (filters by OrgId automatically)
      const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
      if(query.q===searchDefaultKeyword) query.q='';
      query.page = req.query.page;
      query.limit = req.query.limit;

    const paged = await dataService.fetchDataPaged('subscriptionGroups', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const searchableFields = await inferSearchableFields(data, { exclude: ['audit', 'attachments'] });

    const pagination = paged?.pagination || null;
    if (isAjax(req)) {
      return res.json({ status: 'success', results: data, pagination });
    }

    res.render('newsletter/groupList', {
      title: 'Subscription Groups',
      tableName: 'subscriptionGroup',
      newLabel: 'Add Group',
      newUrl: 'subscriptionGroup',
      data, searchableFields,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      filters: req.query, 
      user: req.user || null,
      actionStateId: req.actionStateId
    });

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showAddForm = (req, res) => {
  try {
    res.render('newsletter/groupForm', {
      title: 'Add Subscription Group',
      group: null,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.addGroup = async (req, res) => {
  try {
    if (!req.user.activeOrgId) throw new Error('No active Organization found for user.');

    const groupData = buildGroupFromBody(req.body, req.user);
    
    // Use dataService to add
    const result = await dataService.addData('subscriptionGroups', groupData, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Group created successfully.' });
    }
    res.redirect('/subscriptionGroup');

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // Use 400 for logic errors (e.g. duplicate name)
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    // Use dataService to get by ID
    const group = await dataService.getDataById('subscriptionGroups', req.params.id, req.user);

    // Strict Security: Ensure group belongs to user's Active Org
    if (!group || !idsEqual(group.orgId, req.user.activeOrgId)) {
      throw new Error('Group not found or access denied.');
    }

    res.render('newsletter/groupForm', {
      title: 'Edit Subscription Group',
      group: group,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.editGroup = async (req, res) => {
  try {
    // 1. Fetch Existing via dataService
    const existing = await dataService.getDataById('subscriptionGroups', req.params.id, req.user);
    
    if (!existing || !idsEqual(existing.orgId, req.user.activeOrgId)) {
      throw new Error('Group not found or access denied.');
    }

    // 2. Build Updates
    const updates = buildGroupFromBody(req.body, req.user, existing);
    
    // 3. Update via dataService
    await dataService.updateData('subscriptionGroups', req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Group updated successfully.' });
    }
    res.redirect('/subscriptionGroup');

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    // Use dataService to delete
    await dataService.deleteData('subscriptionGroups', req.params.id, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Group deleted successfully.' });
    }
    res.redirect('/subscriptionGroup');

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   ✅ NEW: MEMBERSHIP MANAGEMENT
========================================================= */

exports.listGroupMembers = async (req, res) => {
  try {
    const groupId = req.params.id;

    // 1. Fetch Group Details
    const group = await dataService.getDataById('subscriptionGroups', groupId, req.user);
    if (!group || !idsEqual(group.orgId, req.user.activeOrgId)) {
        throw new Error('Group not found or access denied.');
    }

    // 2. Fetch Members (Subscriptions filtered by this groupId)
    // We use dataService.fetchData with a filter object.
    const query = {
      ...(req.query || {}),
      groupId__eq: groupId,
      page: req.query.page,
      limit: req.query.limit
    };
    const paged = await dataService.fetchDataPaged('newsletter', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;

    res.render('newsletter/members', {
      title: `Manage Members: ${group.name}`,
      group,
      members: data,
      pagination,
      filters: req.query,
      user: req.user,
      includeModal: true, // For Generic Picker
      actionStateId: req.actionStateId
    });

  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.addGroupMember = async (req, res) => {
  try {
    const groupId = req.params.id;
    const subscriptionId = req.body.subscriptionId;

    if (!subscriptionId) throw new Error('Subscription ID is required.');

    // 1. Verify Access to Group
    const group = await dataService.getDataById('subscriptionGroups', groupId, req.user);
    if (!group || !idsEqual(group.orgId, req.user.activeOrgId)) {
        throw new Error('Group not found or access denied.');
    }

    // 2. Update Subscription
    await newsletterRepository.update(subscriptionId, { groupId });

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Member added to group successfully.' });
    }
    res.redirect(`/subscriptiongroup/${groupId}/members`);

  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.removeGroupMember = async (req, res) => {
  try {
    const groupId = req.params.id; // Not strictly needed for logic, but good for redirect/verify
    const subscriptionId = req.body.subscriptionId;

    if (!subscriptionId) throw new Error('Subscription ID is required.');

    // 1. Update Subscription (Set groupId to null)
    await newsletterRepository.update(subscriptionId, { groupId: null });

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Member removed from group.' });
    }
    res.redirect(`/subscriptiongroup/${groupId}/members`);

  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};
