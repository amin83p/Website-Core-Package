// MVC/controllers/taskController.js
const taskRepository = require('../repositories/taskRepository');
const { idsEqual } = require('../utils/idAdapter');
const { buildDataServiceQuery } = require('../utils/generalTools');

const {isAdmin} = require('../services/adminChekersService');
const path = require('path');
const coreFilesService = require('../services/coreFilesService');
const TASK_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'status', 'priority', 'projectName', 'phaseName'],
  allowedSearchFields: ['id', 'title', 'description', 'status', 'priority', 'projectName', 'phaseName', 'assignments.name', 'assignments.userId'],
  defaultSearchFields: ['id', 'title', 'description', 'status', 'priority', 'projectName', 'phaseName'],
  allowMetaKeys: true
});

// --- HELPER: Permissions Matrix ---
function getTaskPermissions(user, task) {
    if (isAdmin(user)) return { canEdit: true, canSubmit: true, canApprove: true, canComment: true, canFeedback: true };
    if (!task) return { canEdit: true, canSubmit: true, canApprove: true, canComment: true, canFeedback: true };
    const assignment = (task.assignments || []).find(a => idsEqual(a.userId, user.id) && a.status !== 'disabled');
    const role = assignment ? assignment.role : null;
    const matrix = {
        'owner': { edit: true, submit: true, approve: true, comment: true, feedback: true },
        'coordinator': { edit: true, submit: true, approve: false, comment: true, feedback: true },
        'approver': { edit: false, submit: false, approve: true, comment: true, feedback: true },
        'executor': { edit: false, submit: true, approve: false, comment: true, feedback: false },
        'operator': { edit: false, submit: true, approve: false, comment: true, feedback: false },
        'support': { edit: false, submit: false, approve: false, comment: true, feedback: false },
        'viewer': { edit: false, submit: false, approve: false, comment: false, feedback: false }
    };
    const p = matrix[role] || matrix['viewer'];
    return { canEdit: p.edit, canSubmit: p.submit, canApprove: p.approve, canComment: p.comment, canFeedback: p.feedback };
}

function getWebUrl(physicalPath) {
    return coreFilesService.fromDiskPathToUploadsUrl(physicalPath);
}

function parseJsonSafe(jsonString) {
  if (!jsonString) return [];
  try { return JSON.parse(jsonString); } catch { return []; }
}

function buildTaskFromBody(body, reqUserId, existing = null) {
  const assignments = parseJsonSafe(body.assignments);
  const steps = parseJsonSafe(body.steps);
  return {
    title: (body.title || '').trim(),
    description: (body.description || '').trim(),
    projectName: (body.projectName || 'General').trim(),
    phaseName: (body.phaseName || 'Planning').trim(),
    priority: (body.priority || 'medium').toLowerCase(),
    status: (body.status || 'todo').toLowerCase(),
    dates: { start: body.startDate || null, due: body.dueDate || null },
    assignments: assignments.map(a => ({ userId: a.userId, name: a.name, role: a.role || 'viewer', status: a.status || 'active' })),
    checkpoints: steps.map(s => ({ 
        id: s.id, 
        title: s.title, 
        date: s.date, 
        weight: s.weight, 
        criteria: s.criteria,
        lockStep: s.lockStep || '',
        lockStatus: s.lockStatus || ''
    }))
  };
}

/* ---------------- CONTROLLERS ---------------- */

async function listTasks(req, res) {
    try {
        const query = await buildDataServiceQuery(req.query, TASK_LIST_QUERY_OPTIONS);
        if (req.query.status) query.status__eq = String(req.query.status || '').trim();
        const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
        const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;

        const pageResult = await taskRepository.listPaged({
            query: {
              ...query,
              page,
              limit
            },
            scope: isAdmin(req.user)
                ? { canViewAll: true, userId: req.user?.id }
                : { canViewAll: false, userId: req.user?.id }
        });
        const data = Array.isArray(pageResult?.rows) ? pageResult.rows : [];
        const pagination = pageResult?.pagination || null;
        if (req.headers['x-ajax-request']) return res.json({ status: 'success', results: data, pagination });
        res.render('task/tasks', { title: 'Task Management', tableName: 'Tasks', data, pagination, newUrl: 'tasks', newLabel: 'Create Task', includeModal: true, includeModal_Table: true, includeModal_FileImport: true, print: true, searchableFields: TASK_LIST_QUERY_OPTIONS.defaultSearchFields, filters: req.query, user: req.user, actionStateId: req.actionStateId });
    } catch (error) { res.status(500).render('error', { error, user: req.user }); }
}

async function showAddTaskForm(req, res) { 
    const permissions = getTaskPermissions(req.user, null);
    res.render('task/taskForm', { title: 'Create New Task', task: null, user: req.user, permissions, includeModal: true, actionStateId: req.actionStateId }); 
}

async function showEditTaskForm(req, res) {
    try {
        const task = await taskRepository.getById(req.params.id);
        if (!task) return res.status(404).render('404', { user: req.user });
        const permissions = getTaskPermissions(req.user, task);
        if (req.headers['x-ajax-request']) {
            return res.json({ 
                status: 'success',
                title: 'Edit Task', 
                task, 
                user: req.user, 
                permissions, 
                actionStateId: req.actionStateId 
            });
        }
        res.render('task/taskForm', { title: 'Edit Task', task, user: req.user, permissions, includeModal: true, actionStateId: req.actionStateId });
    } catch (error) { res.status(500).render('error', { error, user: req.user }); }
}

async function createTask(req, res) {
    try {
        const taskData = buildTaskFromBody(req.body, req.user.id);
        const newTask = await taskRepository.create(taskData, { userId: req.user.id });
        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Task created.', taskId: newTask.id, task: newTask });
        }
        res.redirect('/tasks');
    } catch (error) {
         if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
         res.status(500).render('error', { error, user: req.user });
    }
}

async function editTask(req, res) {
    try {
        const task = await taskRepository.getById(req.params.id);
        if(!isAdmin(req.user)){
            const permissions = getTaskPermissions(req.user, task);
            if(!permissions.canEdit) throw new Error("<b>Access Denied</b><br>You cannot edit this task structure.");
        }
        const updates = buildTaskFromBody(req.body, req.user.id);
        const updatedTask = await taskRepository.update(req.params.id, updates, { userId: req.user.id });
        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Task updated.', taskId: req.params.id, task: updatedTask });
        }
        res.redirect('/tasks');
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(500).render('error', { error, user: req.user });
    }
}

async function deleteTask(req, res) {
  try {
    await taskRepository.remove(req.params.id);
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Task deleted.' });
    res.redirect('/tasks');
  } catch (error) { res.status(500).render('error', { error, user: req.user }); }
}

async function viewTask(req, res) {
    try {
        const task = await taskRepository.getById(req.params.id);
        if (!task) return res.status(404).render('404', { user: req.user, title: 'Not Found' });
        const permissions = getTaskPermissions(req.user, task);
        res.render('task/taskView', { 
            title: 'Task Overview', 
            task, 
            user: req.user, 
            permissions, 
            includeModal: true, 
            actionStateId: req.actionStateId 
        });
    } catch (error) { res.status(500).render('error', { title: 'Error', error, user: req.user }); }
}

// ✅ UPDATED: Delete Deliverable (Uses Model + FileService)
async function deleteDeliverable(req, res) {
    try {
        const { taskId, fileUrl, checkpointId } = req.body;
        const task = await taskRepository.getById(taskId);
        if(!isAdmin(req.user)){
            const permissions = getTaskPermissions(req.user, task);
            if(!permissions.canEdit) throw new Error("Access Denied.");
        }
        
        await taskRepository.deleteDeliverable(taskId, fileUrl, checkpointId);
        
        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'File deleted.' });
        res.redirect(`/tasks/${taskId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(500).render('error', { error, user: req.user });
    }
}

async function uploadDeliverable(req, res) {
    try {
        if (!req.file) throw new Error('I could  not find and uploaded files.');
        const { taskId, checkpointId, description } = req.body;
        const task = await taskRepository.getById(taskId);
        if(!isAdmin(req.user)){
           const permissions = getTaskPermissions(req.user, task);
            if(!permissions.canSubmit && !permissions.canEdit) throw new Error("Access Denied.");
        }
        const webUrl = getWebUrl(req.file.path);
        const deliverableData = { filename: req.file.originalname, url: webUrl, size: req.file.size, mimetype: req.file.mimetype, description: description || '', checkpointId: checkpointId || null, uploadedAt: new Date() };
        await taskRepository.addDeliverable(taskId, deliverableData, req.user.id);
        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'File uploaded successfully.', file: deliverableData });
        res.redirect(`/tasks/${taskId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
}

async function updateCheckpointStatus(req, res) {
    try {
        const { taskId, checkpointId, status } = req.body;
        const task = await taskRepository.getById(taskId);
        if(!isAdmin(req.user)){
            const permissions = getTaskPermissions(req.user, task);
            if(status === 'completed' && !permissions.canApprove) throw new Error("Access Denied: Only Approvers/Owners can complete steps.");
            if(status === 'submitted' && !permissions.canSubmit) throw new Error("Access Denied: You cannot submit steps.");
        }
        const cpIndex = task.checkpoints.findIndex(c => idsEqual(c.id, checkpointId));
        if (cpIndex === -1) throw new Error(`Checkpoint not found`);
        task.checkpoints[cpIndex].status = status;
        await taskRepository.update(taskId, task, { userId: req.user.id });
        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: `Status updated to ${status}` });
        res.redirect(`/tasks/${taskId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(500).render('error', { error, user: req.user });
    }
}

async function updateCheckpointProperties(req, res) {
    try {
        const { taskId, checkpointId, newDate, newWeight, newCriteria, note } = req.body;
        const task = await taskRepository.getById(taskId);
        if(!isAdmin(req.user)){
            const permissions = getTaskPermissions(req.user, task);
            if(!permissions.canEdit) throw new Error("Access Denied.");
        }
        const cp = task.checkpoints.find((c) => idsEqual(c?.id, checkpointId));
        if (!cp) throw new Error("Checkpoint not found");
        const changes = {};
        if (newDate && newDate !== cp.dates.current) { changes.newDate = newDate; cp.dates.current = newDate; }
        if (newWeight && parseInt(newWeight) !== cp.weight) { changes.newWeight = parseInt(newWeight); cp.weight = parseInt(newWeight); }
        if (newCriteria !== cp.criteria) cp.criteria = newCriteria;
        cp.updates.push({ timestamp: new Date(), userId: req.user.id, userName: req.user.username || req.user.email, note: note, changes });
        await taskRepository.update(taskId, task, { userId: req.user.id });
        res.redirect(`/tasks/${taskId}`);
    } catch (error) { res.status(500).render('error', { error, user: req.user }); }
}

// ✅ UPDATED: Add Comment (Delegates to Model)
async function addComment(req, res) {
    try {
        const { taskId, comment, parentId, checkpointId } = req.body; 
        const task = await taskRepository.getById(taskId);
        if(!isAdmin(req.user)){
            const permissions = getTaskPermissions(req.user, task);
            if(!permissions.canComment) throw new Error("Access Denied.");
        }
        
        let fileData = null;
        if (req.file) fileData = { 
            filename: req.file.originalname, 
            url: getWebUrl(req.file.path), 
            mimetype: req.file.mimetype 
        };
        
        const activityEntry = { 
            id: `ACT_${Date.now()}`, 
            action: 'comment', 
            userId: req.user.id, 
            userName: req.user.name || req.user.username || 'User', 
            timestamp: new Date(), 
            details: comment, 
            parentId: parentId || null, 
            checkpointId: checkpointId || null, 
            file: fileData 
        };

        await taskRepository.addComment(taskId, activityEntry);
        
        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Posted.', entry: activityEntry });
        res.redirect(`/tasks/${taskId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(500).render('error', { error, user: req.user });
    }
}

// ✅ UPDATED: Delete Comment (Checks Perms, then delegates to Model + FileService)
async function deleteComment(req, res) {
    try {
        const { taskId, commentId } = req.body; 
        const task = await taskRepository.getById(taskId);
        if (!task) throw new Error("Task not found.");

        const targetComment = (task.activityLog || []).find((c) => idsEqual(c?.id, commentId));
        if(!targetComment) throw new Error("Comment not found.");

        // Permissions Check: Owner or Admin
        const isOwner = idsEqual(targetComment.userId, req.user.id);
        if (!isOwner && !isAdmin(req.user)) {
            throw new Error("Access Denied. You can only delete your own comments.");
        }

        await taskRepository.deleteComment(taskId, commentId);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Comment deleted.' });
        }
        res.redirect(`/tasks/${taskId}`);

    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(400).json({ status: 'error', message: error.message });
        }
        res.status(500).render('error', { error, user: req.user });
    }
}

module.exports = { 
    listTasks, 
    showAddTaskForm, 
    createTask, 
    showEditTaskForm, 
    editTask, 
    deleteTask, 
    viewTask, 
    uploadDeliverable, 
    deleteDeliverable, 
    updateCheckpointStatus, 
    updateCheckpointProperties, 
    addComment,
    deleteComment
};
