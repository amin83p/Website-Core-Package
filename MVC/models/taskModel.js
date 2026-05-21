// MVC/models/taskModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const fileService = require('../services/fileService'); // ✅ IMPORT SERVICE

const REGISTRY_FILE = path.join(__dirname, '../../data/tasks.json');
const TASK_DIR = path.join(__dirname, '../../data/tasks/');

if (!fsSync.existsSync(TASK_DIR)) fsSync.mkdirSync(TASK_DIR, { recursive: true });

// --- HELPERS ---
function normalizeCheckpoint(cp, index) {
    if (!cp.id) cp.id = `CP_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`;
    if (cp.date && !cp.dates) {
        cp.dates = { original: cp.date, current: cp.date };
        delete cp.date;
    } else if (!cp.dates) {
        cp.dates = { original: null, current: null };
    }
    if (!cp.updates) cp.updates = [];
    if (!cp.deliverables) cp.deliverables = [];
    if (!cp.status) cp.status = 'active';
    if (!cp.lockStep) cp.lockStep = '';
    if (!cp.lockStatus) cp.lockStatus = '';
    return cp;
}

function calculateProgress(checkpoints) {
    if (!checkpoints || checkpoints.length === 0) return 0;
    const activeSteps = checkpoints.filter(cp => cp.status !== 'deleted' && cp.status !== 'merged');
    if (activeSteps.length === 0) return 0;
    const totalWeight = activeSteps.reduce((sum, cp) => sum + (parseInt(cp.weight) || 0), 0);
    if (totalWeight > 0) {
        const completedWeight = activeSteps
            .filter(cp => cp.status === 'completed')
            .reduce((sum, cp) => sum + (parseInt(cp.weight) || 0), 0);
        return Math.min(100, Math.round((completedWeight / totalWeight) * 100));
    }
    const completedCount = activeSteps.filter(cp => cp.status === 'completed').length;
    return Math.round((completedCount / activeSteps.length) * 100);
}

// --- CORE FUNCTIONS ---
exports.getAllTasks = async (user) => {
    try {
        const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8').catch(() => '[]'));
        if (!user) return [];
        if (user.isSuperAdmin) return registry;
        return registry.filter((t) => t.assignees && t.assignees.some((u) => idsEqual(u.userId, user.id)));
    } catch { return []; }
};

function applyTaskScope(rows, scope = {}) {
    const list = Array.isArray(rows) ? rows : [];
    if (scope?.canViewAll === true) return list;
    if (scope?.denyAll === true) return [];

    const scopedUserId = toPublicId(scope?.userId);
    if (!scopedUserId) return [];

    return list.filter((task) => {
        const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
        return assignees.some((assignee) => idsEqual(assignee?.userId, scopedUserId));
    });
}

function buildTaskQueryPlan(options = {}) {
    const query = options?.query || {};
    const incomingScope = options?.scope || {};

    return {
        entity: 'tasks',
        query,
        scope: {
            canViewAll: incomingScope?.canViewAll === true,
            denyAll: incomingScope?.denyAll === true,
            userId: toPublicId(incomingScope?.userId) || null
        },
        projection: options?.projection || null,
        pagination: options?.pagination || null,
        sort: options?.sort || null,
        fallback: {
            defaultSearchFields: ['id', 'title', 'projectName', 'phaseName', 'status', 'priority'],
            dateFields: ['updatedAt', 'createdAt', 'dates.start', 'dates.due']
        }
    };
}

exports.queryTasks = async (options = {}) => {
    const plan = buildTaskQueryPlan(options);
    const executor = getEntityQueryExecutor('tasks');

    if (typeof executor === 'function') {
        const result = await executor(plan);
        if (Array.isArray(result)) return result;
        if (result && Array.isArray(result.items)) return result.items;
    }

    const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8').catch(() => '[]'));
    const scoped = applyTaskScope(registry, plan.scope);
    return applyGenericFilter(scoped, plan.query, plan.fallback);
};

exports.buildTaskQueryPlan = buildTaskQueryPlan;

exports.getTaskSummaryById = async (taskId) => {
    try {
        const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8').catch(() => '[]'));
        return registry.find((task) => idsEqual(task?.id, taskId)) || null;
    } catch {
        return null;
    }
};

exports.getTaskById = async (taskId) => {
    const filePath = path.join(TASK_DIR, `${taskId}.json`);
    try {
        const task = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if(task.checkpoints) task.checkpoints = task.checkpoints.map(normalizeCheckpoint);
        task.progress = calculateProgress(task.checkpoints);
        return task;
    } catch { return null; }
};

exports.createTask = async (taskData, creatorId) => {
    return await queueWrite(async () => {
        const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8').catch(() => '[]'));
        const taskId = `TASK_${Date.now()}`;
        const now = new Date();

        const fullTask = {
            id: taskId,
            ...taskData,
            assignments: (taskData.assignments || []).map(a => ({ ...a, joinedAt: now })),
            checkpoints: (taskData.checkpoints || []).map((cp, i) => normalizeCheckpoint(cp, i)),
            activityLog: [{ action: 'created', userId: creatorId, timestamp: now, details: 'Task created' }],
            progress: 0,
            updatedAt: now,
            createdAt: now
        };

        await fs.writeFile(path.join(TASK_DIR, `${taskId}.json`), JSON.stringify(fullTask, null, 2));
        
        registry.push({
            id: taskId,
            title: fullTask.title,
            projectName: fullTask.projectName,
            phaseName: fullTask.phaseName,
            status: fullTask.status,
            priority: fullTask.priority,
            assignees: fullTask.assignments.map(a => ({ userId: a.userId, role: a.role })),
            progress: 0,
            updatedAt: now
        });
        await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
        return fullTask;
    });
};

exports.updateTaskFull = async (taskId, updates, userId) => {
    return await queueWrite(async () => {
        const taskPath = path.join(TASK_DIR, `${taskId}.json`);
        let task = JSON.parse(await fs.readFile(taskPath, 'utf8'));

        ['title', 'description', 'projectName', 'phaseName', 'priority', 'status', 'dates'].forEach(field => {
            if (updates[field] !== undefined) task[field] = updates[field];
        });

        if (updates.assignments) {
            task.assignments = updates.assignments.map(newA => {
                const oldA = (task.assignments || []).find(a => a.userId === newA.userId);
                return { ...newA, joinedAt: oldA ? oldA.joinedAt : new Date() };
            });
        }

        if (updates.checkpoints) {
            task.checkpoints = updates.checkpoints.map((newCp, i) => {
                let oldCp = (task.checkpoints || []).find((cp) => idsEqual(cp?.id, newCp?.id));
                if (oldCp) {
                    oldCp.title = newCp.title;
                    oldCp.weight = parseInt(newCp.weight) || 0;
                    oldCp.criteria = newCp.criteria;
                    if (newCp.status) oldCp.status = newCp.status;
                    oldCp.lockStep = newCp.lockStep;
                    oldCp.lockStatus = newCp.lockStatus;

                    const inputDate = newCp.date || (newCp.dates ? newCp.dates.current : null);
                    if (inputDate && (!oldCp.dates || inputDate !== oldCp.dates.current)) {
                        if (!oldCp.dates) oldCp.dates = { original: inputDate, current: inputDate };
                        else oldCp.dates.current = inputDate;
                    }
                    if (newCp.updates) oldCp.updates = newCp.updates;
                    if (newCp.deliverables) oldCp.deliverables = newCp.deliverables; 
                    return oldCp;
                } else {
                    return normalizeCheckpoint(newCp, i);
                }
            });
        }

        if(updates.activityLog) task.activityLog = updates.activityLog;

        task.progress = calculateProgress(task.checkpoints);
        task.updatedAt = new Date();
        
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

        const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8'));
        const idx = registry.findIndex((t) => idsEqual(t?.id, taskId));
        
        const summary = {
            id: taskId,
            title: task.title,
            projectName: task.projectName,
            phaseName: task.phaseName,
            status: task.status,
            priority: task.priority,
            assignees: task.assignments.filter(a => a.status === 'active').map(a => ({ userId: a.userId, role: a.role })),
            progress: task.progress,
            updatedAt: task.updatedAt
        };

        if (idx > -1) registry[idx] = summary;
        else registry.push(summary);

        await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
        return task;
    });
};

exports.addDeliverable = async (taskId, deliverableData, userId) => {
    return await queueWrite(async () => {
        const taskPath = path.join(TASK_DIR, `${taskId}.json`);
        let task = JSON.parse(await fs.readFile(taskPath, 'utf8'));

        const finalDeliverable = {
            id: `DEL_${Date.now()}`,
            ...deliverableData,
            uploadedBy: userId,
            uploadedAt: new Date()
        };

        if (deliverableData.checkpointId) {
            const cp = task.checkpoints.find((c) => idsEqual(c?.id, deliverableData?.checkpointId));
            if (cp) {
                if (!cp.deliverables) cp.deliverables = [];
                cp.deliverables.push(finalDeliverable);
            }
        } else {
            if (!task.deliverables) task.deliverables = [];
            task.deliverables.push(finalDeliverable);
        }

        task.activityLog.push({
            action: 'upload',
            userId: userId,
            timestamp: new Date(),
            details: `Uploaded file: ${finalDeliverable.filename}`,
            file: { url: finalDeliverable.url, filename: finalDeliverable.filename }
        });

        task.updatedAt = new Date();
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
        return finalDeliverable;
    });
};

exports.deleteDeliverable = async (taskId, fileUrl, checkpointId) => {
    return await queueWrite(async () => {
        const taskPath = path.join(TASK_DIR, `${taskId}.json`);
        let task = JSON.parse(await fs.readFile(taskPath, 'utf8'));
        let deleted = false;

        if (checkpointId) {
            const cp = task.checkpoints.find((c) => idsEqual(c?.id, checkpointId));
            if (cp && cp.deliverables) {
                const initialLen = cp.deliverables.length;
                cp.deliverables = cp.deliverables.filter(f => f.url !== fileUrl);
                if (cp.deliverables.length !== initialLen) deleted = true;
            }
        } else {
            if (task.deliverables) {
                const initialLen = task.deliverables.length;
                task.deliverables = task.deliverables.filter(f => f.url !== fileUrl);
                if (task.deliverables.length !== initialLen) deleted = true;
            }
        }

        if (deleted) {
            // ✅ USE CENTRALIZED SERVICE
            await fileService.deleteFile(fileUrl);

            task.updatedAt = new Date();
            await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
        }
        return deleted;
    });
};

// ✅ Uses Model + Service
exports.addComment = async (taskId, commentData) => {
    return await queueWrite(async () => {
        const taskPath = path.join(TASK_DIR, `${taskId}.json`);
        let task = JSON.parse(await fs.readFile(taskPath, 'utf8'));

        if (!task.activityLog) task.activityLog = [];
        task.activityLog.push(commentData);
        
        task.updatedAt = new Date();
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
        return commentData;
    });
};

// ✅ Uses Model + Service
exports.deleteComment = async (taskId, commentId) => {
    return await queueWrite(async () => {
        const taskPath = path.join(TASK_DIR, `${taskId}.json`);
        let task = JSON.parse(await fs.readFile(taskPath, 'utf8'));

        if (!task.activityLog) return false;

        const idx = task.activityLog.findIndex((c) => idsEqual(c?.id, commentId) && c.action === 'comment');
        if (idx === -1) return false;

        const comment = task.activityLog[idx];

        // 1. Delete associated file using SERVICE
        if (comment.file && comment.file.url) {
            await fileService.deleteFile(comment.file.url);
        }

        // 2. Remove entry
        task.activityLog.splice(idx, 1);

        task.updatedAt = new Date();
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
        return true;
    });
};

exports.deleteTask = async (taskId) => {
    return await queueWrite(async () => {
        try { await fs.unlink(path.join(TASK_DIR, `${taskId}.json`)); } catch(e){}
        const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8'));
        const newReg = registry.filter((t) => !idsEqual(t?.id, taskId));
        await fs.writeFile(REGISTRY_FILE, JSON.stringify(newReg, null, 2));
        return true;
    });
};
