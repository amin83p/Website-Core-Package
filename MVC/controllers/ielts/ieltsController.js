// MVC/controllers/ielts/ieltsController.js
const ieltsService = require('../../services/ielts/ieltsDataService');
const { getDashboardSection } = require('../dashboardController');

const paginate = require('../../utils/paginationHelper');
const aiService = require('../../services/ielts/aiService'); // Import the service
const essayPreprocessingService = require('../../services/ielts/essayPreprocessingService');
const essayAnalysisService = require('../../services/ielts/essayAnalysisService');
const aiExtractionService = require('../../services/ielts/aiExtractionService');
const step3ScoringService = require('../../services/ielts/step3ScoringService');
const step5FeedbackService = require('../../services/ielts/step5FeedbackService');
const repeatedRunAnalysisService = require('../../services/ielts/repeatedRunAnalysisService');
const calibrationEvaluationService = require('../../services/ielts/calibrationEvaluationService');
const scoringRunControlService = require('../../services/ielts/scoringRunControlService');
const { buildDataServiceQuery, inferSearchableFields } = require('../../utils/generalTools');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
    assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
    canCreateOrgScopedItem
} = require('../../utils/orgContextUtils');
const adminChekersService = require('../../services/adminChekersService');
const uploadPathUtils = require('../../utils/uploadPathUtils');

const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');

const IELTS_PROJECT_ROOT = path.join(__dirname, '../../../');
const IELTS_COMMIT_HELPER_SCRIPT = path.join(IELTS_PROJECT_ROOT, 'scripts/ieltsCommitHelper.ps1');
const IELTS_RESEARCH_DIR = path.join(IELTS_PROJECT_ROOT, 'data/ielts/research');
const IELTS_LAST_PROMPT_FILE = path.join(IELTS_RESEARCH_DIR, 'last_commit_prompt.md');
const IELTS_COMMIT_HISTORY_FILE = path.join(IELTS_RESEARCH_DIR, 'commit_message_history.md');
const THREE_RUN_SESSION_META_CACHE = new Map();
const IELTS_SCORING_HISTORY_SECTION_ID = SECTIONS.IELTS_SCORING_HISTORY || 'IELTS_SCORING_HISTORY';

function extractScoringCancelToken(req) {
    const body = req?.body && typeof req.body === 'object' ? req.body : {};
    const nestedOptions = body?.options && typeof body.options === 'object' ? body.options : {};
    const token = String(
        body.cancelToken ||
        nestedOptions.cancelToken ||
        ''
    ).trim();
    return token || '';
}

function buildRunCancelledMessage(stepLabel) {
    return `${String(stepLabel || 'Operation')} was cancelled by user.`;
}

function buildScoringHistoryAccessContext(req, operationId = OPERATIONS.READ_ALL) {
    return {
        sectionId: IELTS_SCORING_HISTORY_SECTION_ID,
        operationId,
        scopeId: req?.accessScope || null
    };
}

function normalizeRunCategoryColor(value, fallback = '') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const match = raw.match(/^#?([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/);
    if (!match) return fallback;
    const hex = String(match[1] || '').trim().toUpperCase();
    if (hex.length === 3) {
        return `#${hex.split('').map((ch) => `${ch}${ch}`).join('')}`;
    }
    return `#${hex}`;
}

function normalizeRunCategoryLabel(value, fallback = '') {
    const txt = String(value || '').replace(/\s+/g, ' ').trim();
    if (!txt) return fallback;
    return txt.slice(0, 60);
}

function buildRunCategoryKey(label = '', color = '') {
    const normalizedLabel = normalizeRunCategoryLabel(label, '').toLowerCase();
    const slug = normalizedLabel
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    const normalizedColor = normalizeRunCategoryColor(color, '').replace('#', '').toLowerCase();
    const fallbackSlug = slug || 'category';
    if (!normalizedColor) return fallbackSlug;
    return `${fallbackSlug}-${normalizedColor}`.slice(0, 80);
}

function resolveRunCategoryFromSession(item = {}) {
    const metadataCategory = item?.metadata?.runCategory && typeof item.metadata.runCategory === 'object'
        ? item.metadata.runCategory
        : {};
    const nestedCategory = item?.runCategory && typeof item.runCategory === 'object'
        ? item.runCategory
        : {};

    const color = normalizeRunCategoryColor(
        item?.runCategoryColor ||
        nestedCategory?.color ||
        metadataCategory?.color,
        ''
    );
    if (!color) return null;

    const label = normalizeRunCategoryLabel(
        item?.runCategoryLabel ||
        nestedCategory?.label ||
        metadataCategory?.label,
        `Category ${color}`
    );
    const key = String(
        item?.runCategoryKey ||
        nestedCategory?.key ||
        metadataCategory?.key ||
        ''
    ).trim() || buildRunCategoryKey(label, color);
    const assignedRaw =
        item?.runCategoryAssigned ??
        nestedCategory?.assigned ??
        metadataCategory?.assigned;
    const assigned = assignedRaw === true || String(assignedRaw || '').trim().toLowerCase() === 'true';
    if (!assigned && !color) return null;

    return {
        assigned: assigned || Boolean(color),
        key,
        label,
        color
    };
}

function buildRunCategoryRowStyle(color = '') {
    const normalized = normalizeRunCategoryColor(color, '');
    if (!normalized) return '';
    const r = Number.parseInt(normalized.slice(1, 3), 16);
    const g = Number.parseInt(normalized.slice(3, 5), 16);
    const b = Number.parseInt(normalized.slice(5, 7), 16);
    if (![r, g, b].every(Number.isFinite)) return '';
    return `background-color: rgba(${r}, ${g}, ${b}, 0.12); border-left: 4px solid ${normalized};`;
}

function buildScoringHistoryCategoryPayload(session, id, category = {}, actorId = 'system', nowIso = null) {
    const existing = session && typeof session === 'object' ? session : {};
    const metadata = existing?.metadata && typeof existing.metadata === 'object'
        ? { ...existing.metadata }
        : {};
    const timestamp = String(nowIso || new Date().toISOString()).trim() || new Date().toISOString();
    const updatedBy = String(actorId || 'system').trim() || 'system';
    const shouldClear = category?.clear === true || String(category?.mode || '').trim().toLowerCase() === 'clear';

    if (shouldClear) {
        const clearedCategory = {
            assigned: false,
            key: '',
            label: '',
            color: '',
            updatedAt: timestamp,
            updatedBy
        };

        metadata.runCategory = clearedCategory;
        return {
            ...existing,
            id,
            sessionId: id,
            metadata,
            runCategory: clearedCategory,
            runCategoryAssigned: false,
            runCategoryKey: '',
            runCategoryLabel: '',
            runCategoryColor: ''
        };
    }

    const color = normalizeRunCategoryColor(category?.color, '');
    if (!color) throw new Error('Please select a valid color.');
    const label = normalizeRunCategoryLabel(category?.label, '');
    if (!label) throw new Error('Please enter a category label.');
    const key = String(category?.key || '').trim() || buildRunCategoryKey(label, color);

    const runCategory = {
        assigned: true,
        key,
        label,
        color,
        updatedAt: timestamp,
        updatedBy
    };

    metadata.runCategory = runCategory;

    return {
        ...existing,
        id,
        sessionId: id,
        metadata,
        runCategory,
        runCategoryAssigned: true,
        runCategoryKey: key,
        runCategoryLabel: label,
        runCategoryColor: color
    };
}

// Helper to convert physical path to web URL
function getWebUrl(physicalPath) {
    if (!physicalPath) return null;
    return uploadPathUtils.fromDiskPathToUploadsUrl(physicalPath);
}

function runIeltsCommitHelper(scriptArgs = []) {
    return new Promise((resolve, reject) => {
        const psArgs = [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', IELTS_COMMIT_HELPER_SCRIPT,
            ...scriptArgs
        ];

        const child = spawn('powershell.exe', psArgs, {
            cwd: IELTS_PROJECT_ROOT,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                const err = new Error(`Commit helper failed with code ${code}.`);
                err.stdout = stdout;
                err.stderr = stderr;
                return reject(err);
            }
            resolve({ stdout, stderr });
        });
    });
}

function extractCommitMessageFromOutput(stdoutText = '') {
    const marker = 'Commit message:';
    const idx = stdoutText.indexOf(marker);
    if (idx === -1) return '';
    return stdoutText.slice(idx + marker.length).trim();
}

function toRepoRelativePath(absPath) {
    return path.relative(IELTS_PROJECT_ROOT, absPath).split(path.sep).join('/');
}

function parseModelJsonText(modelText = '') {
    const raw = String(modelText || '').trim();
    if (!raw) {
        throw new Error('Model returned empty content.');
    }

    try {
        return JSON.parse(raw);
    } catch (e) {
        // Try extracting fenced JSON first
    }

    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
        try {
            return JSON.parse(fenced[1]);
        } catch (e) {
            // Fall through to object slice
        }
    }

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const sliced = raw.slice(firstBrace, lastBrace + 1);
        return JSON.parse(sliced);
    }

    throw new Error('Could not parse valid JSON from model output.');
}

function parseHistoryListSection(blockText = '', sectionTitle = '') {
    const sectionRegex = new RegExp(`###\\s+${sectionTitle}\\s*[\\r\\n]+([\\s\\S]*?)(?=\\n###\\s+|$)`, 'i');
    const match = String(blockText).match(sectionRegex);
    if (!match || !match[1]) return [];

    return match[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim())
        .filter(Boolean);
}

function parseCommitHistoryEntries(markdownText = '') {
    const text = String(markdownText || '');
    const headingRegex = /^##\s+([^\n|]+?)\s*\|\s*([^\n]+)\s*$/gm;
    const headings = [];
    let headingMatch;

    while ((headingMatch = headingRegex.exec(text)) !== null) {
        headings.push({
            index: headingMatch.index,
            timestamp: headingMatch[1].trim(),
            tweakId: headingMatch[2].trim()
        });
    }

    if (headings.length === 0) return [];

    const entries = [];
    for (let i = 0; i < headings.length; i += 1) {
        const current = headings[i];
        const next = headings[i + 1];
        const block = text.slice(current.index, next ? next.index : text.length);

        const getField = (label) => {
            const fieldRegex = new RegExp(`^-\\s+${label}:\\s*(.+)$`, 'mi');
            const m = block.match(fieldRegex);
            return m && m[1] ? m[1].trim() : '';
        };

        const commitMatch = block.match(/###\s+Commit Message\s*[\r\n]+~~~text\s*[\r\n]([\s\S]*?)\s*[\r\n]~~~/i);
        const commitMessage = commitMatch && commitMatch[1] ? commitMatch[1].trim() : '';
        const commitSubject = commitMessage.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
        const commitBody = commitMessage.split(/\r?\n/).slice(1).join('\n').trim();

        const parsedDate = Number.isNaN(Date.parse(current.timestamp)) ? null : new Date(current.timestamp).toISOString();

        entries.push({
            id: `${current.timestamp}|${current.tweakId}`,
            timestamp: current.timestamp,
            parsedDate,
            tweakId: current.tweakId,
            branch: getField('Branch'),
            head: getField('HEAD'),
            type: getField('Type'),
            scope: getField('Scope'),
            summary: getField('Summary'),
            reason: getField('Reason'),
            dissertationImpact: getField('Dissertation Impact'),
            files: parseHistoryListSection(block, 'Files'),
            validation: parseHistoryListSection(block, 'Validation'),
            commitMessage,
            commitSubject,
            commitBody
        });
    }

    entries.sort((a, b) => {
        const ta = a.parsedDate ? Date.parse(a.parsedDate) : 0;
        const tb = b.parsedDate ? Date.parse(b.parsedDate) : 0;
        return tb - ta;
    });

    return entries;
}

async function readCommitHistoryEntries() {
    try {
        const raw = await fs.readFile(IELTS_COMMIT_HISTORY_FILE, 'utf8');
        return parseCommitHistoryEntries(raw);
    } catch (error) {
        if (error && error.code === 'ENOENT') return [];
        throw error;
    }
}

exports.showDashboard = async (req, res) => {
    const dashboardSections = [
        {
            priority: 10,
            title: 'Writing Task II',
            description: 'Access high-scoring essay samples, structure guides, and model answers.',
            href: '/ielts/task2samples',
            buttonLabel: 'View Samples',
            icon: 'bi-pen-fill',
            subtleClass: 'bg-primary-subtle text-primary',
            buttonClass: 'btn btn-primary'
        },
        {
            priority: 20,
            title: 'Micro Assessments',
            description: 'Quick-fire questions to test grammar, vocabulary, and coherence.',
            href: '/ielts/task2microassessment',
            buttonLabel: 'View Items',
            icon: 'bi-ui-checks',
            subtleClass: 'bg-success-subtle text-success',
            buttonClass: 'btn btn-success'
        },
        {
            priority: 30,
            title: 'Scoring Pipeline',
            description: 'Open the scoring tools dashboard for classic, V0225, and tuning workflows.',
            href: '/ielts/scoring/dashboard',
            buttonLabel: 'Open Scoring Dashboard',
            icon: 'bi-bezier2',
            subtleClass: 'bg-secondary-subtle text-secondary',
            buttonClass: 'btn btn-secondary'
        },
        {
            priority: 40,
            title: 'Scoring History',
            description: 'Browse saved scoring sessions, reload evaluations, and view reports.',
            href: '/ielts/scoring/history',
            buttonLabel: 'Saved Sessions',
            icon: 'bi-archive-fill',
            subtleClass: '',
            iconStyle: 'background-color: #e0cffc; color: #6f42c1;',
            buttonClass: 'btn',
            buttonStyle: 'background-color: #6f42c1; color: white;'
        },
        {
            priority: 50,
            title: 'Prompt Tuning',
            description: 'Customize the AI system instructions and response templates.',
            href: '/ielts/prompts',
            buttonLabel: 'Configure AI',
            icon: 'bi-sliders',
            subtleClass: 'bg-dark-subtle text-dark',
            buttonClass: 'btn btn-dark'
        },
        {
            priority: 55,
            title: 'API Providers',
            description: 'Save your own provider/API keys so each tester can run AI features on their own account.',
            href: '/ielts/api-providers',
            buttonLabel: 'Manage Keys',
            icon: 'bi-key-fill',
            subtleClass: 'bg-warning-subtle text-warning-emphasis',
            buttonClass: 'btn btn-warning'
        },
        {
            priority: 56,
            title: 'AI Token Usage',
            description: 'Track AI token consumption per user, provider, and model for billing and governance.',
            href: '/ielts/ai-token-usage',
            buttonLabel: 'View Usage',
            icon: 'bi-activity',
            subtleClass: 'bg-info-subtle text-info-emphasis',
            buttonClass: 'btn btn-info text-white'
        },
        {
            priority: 60,
            title: 'Commit Helper',
            description: 'Record and compare scoring tweaks with committee-ready commit notes.',
            href: '/ielts/commit-helper',
            buttonLabel: 'Open Helper',
            icon: 'bi-journal-check',
            subtleClass: 'bg-danger-subtle text-danger',
            buttonClass: 'btn btn-danger'
        }
    ].sort((a, b) => (Number(a.priority || 0) - Number(b.priority || 0)));

    const dashboardSection = await getDashboardSection('/ielts', req.user);
    res.render('ielts/dashboard', {
        title: 'IELTS AI Feedback',
        dashboardSections,
        dashboardSection,
        user: req.user
    });
};

exports.showScoringDashboard = (req, res) => {
    const dashboardSections = [
        {
            priority: 10,
            title: 'Scoring (Classic)',
            description: 'Open the classic scoring flow for standard IELTS evaluation runs.',
            href: '/ielts/scoring/classic',
            buttonLabel: 'Open Scoring',
            icon: 'bi-bezier2',
            subtleClass: 'bg-secondary-subtle text-secondary',
            buttonClass: 'btn btn-secondary'
        },
        {
            priority: 20,
            title: 'Scoring V0225',
            description: 'Run the locked-step V0225 pipeline with detailed prompt controls.',
            href: '/ielts/scoringV0225',
            buttonLabel: 'Open V0225',
            icon: 'bi-cpu-fill',
            subtleClass: 'bg-primary-subtle text-primary',
            buttonClass: 'btn btn-primary'
        },
        {
            priority: 30,
            title: 'Scoring V0323',
            description: 'Run the latest V0323 pipeline with report token usage and version-aware history loading.',
            href: '/ielts/scoringV0323',
            buttonLabel: 'Open V0323',
            icon: 'bi-cpu',
            subtleClass: 'bg-warning-subtle text-warning',
            buttonClass: 'btn btn-warning'
        },
        {
            priority: 35,
            title: 'Standard Scoring',
            description: 'Run the simplified standard scoring flow with built-in prompts and focused controls.',
            href: '/ielts/scoring-standard',
            buttonLabel: 'Open Standard',
            icon: 'bi-ui-radios-grid',
            subtleClass: 'bg-info-subtle text-info',
            buttonClass: 'btn btn-info text-white'
        },
        {
            priority: 36,
            title: 'Scoring V0326',
            description: 'Run V0326 with Step 1 canonical output explorer and responsive sentence-index viewer.',
            href: '/ielts/scoringV0326',
            buttonLabel: 'Open V0326',
            icon: 'bi-journal-richtext',
            subtleClass: 'bg-primary-subtle text-primary',
            buttonClass: 'btn btn-primary'
        },
        {
            priority: 40,
            title: 'Step 3 Tuning',
            description: 'Tune extraction behavior and evidence signals in Step 3.',
            href: '/ielts/scoring/tuning/step3',
            buttonLabel: 'Open Step 3 Tuning',
            icon: 'bi-sliders2-vertical',
            subtleClass: 'bg-info-subtle text-info',
            buttonClass: 'btn btn-info text-white'
        },
        {
            priority: 50,
            title: 'Step 4 Tuning',
            description: 'Tune grading logic and scoring consistency in Step 4.',
            href: '/ielts/scoring/tuning/step4',
            buttonLabel: 'Open Step 4 Tuning',
            icon: 'bi-funnel-fill',
            subtleClass: 'bg-success-subtle text-success',
            buttonClass: 'btn btn-success'
        }
    ].sort((a, b) => (Number(a.priority || 0) - Number(b.priority || 0)));

    res.render('ielts/scoringDashboard', {
        title: 'Scoring Pipeline Dashboard',
        dashboardSections,
        user: req.user || null
    });
};

/* ----------------------------------------------------------------*/
//#region   TASK 2 SAMPLES
/* ----------------------------------------------------------------*/

// 1. LIST
exports.showTask2Samples = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', req.query, req.user);
        const canCreateTask2Samples = await canCreateOrgScopedItem(req.user, { scopeLabel: 'Writing Task II samples' });

        const { data, pagination } = paginate(samples, req.query.page, req.query.limit);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', data, pagination });
        }

        res.render('ielts/task2samples', { 
            title: 'Writing Task II Samples', 
            data: samples,
            newUrl: 'ielts/task2samples', // Base for pagination/sorting links
            newLabel: canCreateTask2Samples ? 'Add Sample' : null,
            tableName: 'Task 2 Samples',
            //
            includeModal: true,
            includeModal_Table: true,
            includeModal_FileImport: true,
            print: true,
            pagination,
            filters: req.query, 
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 2. SHOW ADD FORM
exports.showAddSampleForm = async (req, res) => {
    try {
        await assertCreateOrgContextOrThrowShared(req.user, { scopeLabel: 'Writing Task II samples' });
        res.render('ielts/task2sampleForm', { 
            title: 'Create New Sample', 
            user: req.user,
            sample: null, // Empty for new
            actionStateId: req.actionStateId 
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 3. HANDLE ADD (POST)
exports.addSample = async (req, res) => {
    try {
        const sampleData = { ...req.body };

        // Handle File Upload
        if (req.file) {
            sampleData.attachment = {
                filename: req.file.originalname,
                url: getWebUrl(req.file.path),
                mimetype: req.file.mimetype,
                size: req.file.size
            };
        }

        await ieltsService.addData('task2Samples', sampleData, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Sample created successfully.' });
        }
        res.redirect('/ielts/task2samples');

    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 4. SHOW EDIT FORM
exports.showEditSampleForm = async (req, res) => {
    try {
        const sample = await ieltsService.getDataById('task2Samples', req.params.id, req.user);
        if (!sample) return res.status(404).render('404', { user: req.user });

        res.render('ielts/task2sampleForm', { 
            title: 'Edit Sample', 
            user: req.user,
            sample: sample,
            actionStateId: req.actionStateId
        });
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 5. HANDLE EDIT (POST)
exports.editSample = async (req, res) => {
    try {
        const updates = { ...req.body };

        // Handle File Upload
        if (req.file) {
            updates.attachment = {
                filename: req.file.originalname,
                url: getWebUrl(req.file.path),
                mimetype: req.file.mimetype,
                size: req.file.size
            };
        }

        await ieltsService.updateData('task2Samples', req.params.id, updates, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Sample updated successfully.' });
        }
        res.redirect('/ielts/task2samples');

    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 6. DELETE
exports.deleteSample = async (req, res) => {
    try {
        // Optional: Get sample first to delete physical file if needed
        // const sample = await ieltsService.getDataById('task2Samples', req.params.id);
        
        await ieltsService.deleteData('task2Samples', req.params.id, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Sample deleted.' });
        }
        res.redirect('/ielts/task2samples');
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};
/* ----------------------------------------------------------------*/
//#endregion 
/* ----------------------------------------------------------------*/

/* ----------------------------------------------------------------*/
// #region  MICRO ASSESSMENTS (CRUD)
/* ----------------------------------------------------------------*/

// 1. LIST
exports.showMicroAssessments = async (req, res) => {
    try {
        const dataQuery = await buildDataServiceQuery(req.query, {
            allowedExactKeys: ['id', 'criterion', 'prompt_group', 'signal_kind', 'status', 'is_active'],
            allowedSearchFields: ['id', 'question_key', 'title', 'atomic_question', 'criterion', 'prompt_group', 'signal_kind', 'band'],
            defaultSearchFields: ['id', 'question_key', 'title', 'atomic_question', 'criterion', 'prompt_group', 'signal_kind', 'band']
        });
        // Keep pagination consistent with Section Management: fetch full filtered set,
        // then paginate once in-controller so total pages render correctly.
        const fetchQuery = { ...(dataQuery || {}) };
        delete fetchQuery.page;
        delete fetchQuery.limit;
        const assessments = await ieltsService.fetchData('microAssessments', fetchQuery, req.user);
        const canCreateMicroAssessments = await canCreateOrgScopedItem(req.user, { scopeLabel: 'micro assessments' });
        const systemFields = await ieltsService.getMicroAssessmentFields();
        const inferredSearchableFields = await inferSearchableFields(assessments, { exclude: ['audit', 'attachments'] });
        const searchableFields = inferredSearchableFields.length
            ? inferredSearchableFields
            : ['id', 'question_key', 'title', 'atomic_question', 'criterion', 'prompt_group', 'signal_kind', 'band'];
        // Paginate
        const { data, pagination } = paginate(assessments, req.query.page, req.query.limit);
        
        // Handle AJAX (e.g., search/sort updates)
        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', data, pagination, searchableFields });
        }

        res.render('ielts/microAssessments', { 
            title: 'Micro Assessments', 
            data: data,
            searchableFields,
            systemFields,
            newUrl: 'ielts/microAssessments', // Base URL for pagination
            newLabel: canCreateMicroAssessments ? 'Create Assessment' : null,
            tableName: 'Assessment Modules',
            // Standard Table Options
            includeModal: true, 
            includeModal_Table: true,
            //includeModal_FileImport: true,
            print: true,
            pagination,
            filters: req.query, 
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 2. SHOW ADD FORM
exports.showAddMicroAssessmentForm = async (req, res) => {
    try {
        await assertCreateOrgContextOrThrowShared(req.user, { scopeLabel: 'micro assessments' });
        res.render('ielts/microAssessmentForm', { 
            title: 'Create Micro Assessment', 
            assessment: null, // Empty for new entry
            includeModal: true, 
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 3. HANDLE ADD (POST)
exports.addMicroAssessment = async (req, res) => {
    try {
        const data = { ...req.body };
        
        // Compatibility: If questions arrived as string (Form) vs Object (JSON API)
        if (typeof data.questions === 'string') {
            try { data.questions = JSON.parse(data.questions); } catch(e) {}
        }

        await ieltsService.addData('microAssessments', data, req.user);

        // This header check is crucial for the Modal to know it worked
        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Assessment created successfully.' });
        }
        res.redirect('/ielts/microAssessments');

    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};
// 4. SHOW EDIT FORM
exports.showEditMicroAssessmentForm = async (req, res) => {
    try {
        const assessment = await ieltsService.getDataById('microAssessments', req.params.id, req.user);
        if (!assessment) return res.status(404).render('404', { user: req.user });

        res.render('ielts/microAssessmentForm', { 
            title: 'Edit Micro Assessment', 
            assessment: assessment,
            //
            includeModal: true, 
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 4.b SHOW COPY FORM (NEW ITEM PRE-FILLED FROM EXISTING)
exports.showCopyMicroAssessmentForm = async (req, res) => {
    try {
        await assertCreateOrgContextOrThrowShared(req.user, { scopeLabel: 'micro assessments' });
        const assessment = await ieltsService.getDataById('microAssessments', req.params.id, req.user);
        if (!assessment) return res.status(404).render('404', { user: req.user });

        const { id, createdAt, updatedAt, audit, ...copied } = assessment;
        copied.question_key = copied.question_key ? `${copied.question_key}-COPY` : '';
        copied.title = copied.title ? `${copied.title} (Copy)` : '';

        res.render('ielts/microAssessmentForm', {
            title: 'Copy Micro Assessment',
            assessment: copied,
            copySourceId: id,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 5. HANDLE EDIT (POST)
exports.editMicroAssessment = async (req, res) => {
    try {
        const updates = { ...req.body };

        // Parse questions if sent as JSON string
        if (typeof updates.questions === 'string') {
            try { updates.questions = JSON.parse(updates.questions); } catch(e) {}
        }

        await ieltsService.updateData('microAssessments', req.params.id, updates, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Assessment updated successfully.' });
        }
        res.redirect('/ielts/microAssessments');

    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

// 6. DELETE
exports.deleteMicroAssessment = async (req, res) => {
    try {
        await ieltsService.deleteData('microAssessments', req.params.id, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Assessment deleted.' });
        }
        res.redirect('/ielts/microAssessments');
    } catch (error) {
      if (req.headers['x-ajax-request']) {
        return res.status(500).json({ status: 'error', error, message: error.message });
      }
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};
/* ----------------------------------------------------------------*/
// #endregion
/* ----------------------------------------------------------------*/

/* ----------------------------------------------------------------*/
//#region  SCORING & FEEDBACK (5-STEP PROCESS)
/* ----------------------------------------------------------------*/

// 1. Show the Scoring Page
exports.showScoringPage = async (req, res) => {
    try {
        // Fetch samples to populate the dropdown
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        
        res.render('ielts/scoring', { 
            title: 'IELTS Scoring Pipeline', 
            user: req.user,
            samples: samples,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''

        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

// 1.b Show the Scoring V0225 Page
exports.showScoringPageV0225 = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        } catch (_) {
            aiModels = [];
        }

        res.render('ielts/scoringV0225', {
            title: 'IELTS Scoring Pipeline V0225',
            pipelineMode: 'full',
            samples: samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

// 1.c Show the Scoring V0323 Page
exports.showScoringPageV0323 = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        } catch (_) {
            aiModels = [];
        }

        res.render('ielts/scoringV0323', {
            title: 'IELTS Scoring Pipeline V0323',
            pipelineMode: 'full',
            samples: samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

// 1.e Show the Scoring V0326 Page
exports.showScoringPageV0326 = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({
                requestingUser: req.user,
                includeAllActiveProviders: true
            });
        } catch (_) {
            aiModels = [];
        }

        res.render('ielts/scoringV0326', {
            title: 'IELTS Scoring Pipeline V0326',
            pipelineMode: 'full',
            samples: samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

// 1.d Show the Standard Scoring Page
exports.showScoringPageStandard = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        } catch (_) {
            aiModels = [];
        }

        res.render('ielts/scoringStandard', {
            title: 'IELTS Standard Scoring',
            pipelineMode: 'full',
            samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.showStep3TuningPage = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        } catch (_) {
            aiModels = [];
        }
        res.render('ielts/scoringV0225', {
            title: 'IELTS Step 3 Tuning',
            pipelineMode: 'step3_tuning',
            samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.showStep3TuningPageV0323 = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        } catch (_) {
            aiModels = [];
        }
        res.render('ielts/scoringV0323', {
            title: 'IELTS Step 3 Tuning',
            pipelineMode: 'step3_tuning',
            samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.showStep4TuningPage = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        } catch (_) {
            aiModels = [];
        }
        res.render('ielts/scoringV0225', {
            title: 'IELTS Step 4 Tuning',
            pipelineMode: 'step4_tuning',
            samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.showStep4TuningPageV0323 = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        } catch (_) {
            aiModels = [];
        }
        res.render('ielts/scoringV0323', {
            title: 'IELTS Step 4 Tuning',
            pipelineMode: 'step4_tuning',
            samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.showStep3TuningPageV0326 = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({
                requestingUser: req.user,
                includeAllActiveProviders: true
            });
        } catch (_) {
            aiModels = [];
        }
        res.render('ielts/scoringV0326', {
            title: 'IELTS Step 3 Tuning',
            pipelineMode: 'step3_tuning',
            samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.showStep4TuningPageV0326 = async (req, res) => {
    try {
        const samples = await ieltsService.fetchData('task2Samples', {}, req.user);
        let aiModels = [];
        try {
            aiModels = await aiService.discoverAvailableModels({
                requestingUser: req.user,
                includeAllActiveProviders: true
            });
        } catch (_) {
            aiModels = [];
        }
        res.render('ielts/scoringV0326', {
            title: 'IELTS Step 4 Tuning',
            pipelineMode: 'step4_tuning',
            samples,
            aiModels,
            includeModal: true,
            print: false,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

// 1.c Show the Commit Helper Page
exports.showCommitHelperPage = async (req, res) => {
    try {
        const aiModels = await aiService.discoverAvailableModels({ requestingUser: req.user });
        res.render('ielts/commitHelper', {
            title: 'IELTS Commit Helper',
            promptPath: toRepoRelativePath(IELTS_LAST_PROMPT_FILE),
            historyPath: toRepoRelativePath(IELTS_COMMIT_HISTORY_FILE),
            aiModels,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user || null });
    }
};

// 1.d Show Commit Helper Compare Page
exports.showCommitHelperComparePage = async (req, res) => {
    try {
        const entries = await readCommitHistoryEntries();
        res.render('ielts/commitHelperCompare', {
            title: 'IELTS Commit History Compare',
            entries,
            historyPath: toRepoRelativePath(IELTS_COMMIT_HISTORY_FILE),
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user || null });
    }
};

// 1.e Generate Commit Prompt from Reason
exports.generateCommitPrompt = async (req, res) => {
    try {
        const researchContext = String(req.body.researchContext || '').trim();
        if (!researchContext) {
            return res.status(400).json({ status: 'error', message: 'Research context is required.' });
        }

        await runIeltsCommitHelper(['-GeneratePrompt', '-ResearchContext', researchContext]);
        const promptText = await fs.readFile(IELTS_LAST_PROMPT_FILE, 'utf8');

        res.json({
            status: 'success',
            message: 'Prompt generated successfully.',
            promptPath: toRepoRelativePath(IELTS_LAST_PROMPT_FILE),
            promptText
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to generate prompt.',
            details: error.stderr || ''
        });
    }
};

// 1.f Generate model JSON from prompt
exports.generateCommitModelJson = async (req, res) => {
    try {
        const modelId = String(req.body.modelId || '').trim() || null;
        const incomingPromptText = String(req.body.promptText || '').trim();
        let promptText = incomingPromptText;

        if (!promptText) {
            try {
                promptText = String(await fs.readFile(IELTS_LAST_PROMPT_FILE, 'utf8')).trim();
            } catch (readErr) {
                promptText = '';
            }
        }

        if (!promptText) {
            return res.status(400).json({ status: 'error', message: 'Prompt text is required. Run Step 1 first.' });
        }

        const aiResult = await aiService.sendMessage(
            [{ role: 'user', content: promptText }],
            modelId,
            {
                temperature: 0,
                requestingUser: req.user
            }
        );

        const modelRawText = String(aiResult.text || '').trim();
        const modelJson = parseModelJsonText(modelRawText);

        res.json({
            status: 'success',
            modelUsed: aiResult.modelUsed || modelId,
            modelJson,
            modelRawText
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to generate model JSON.',
            details: error.stderr || ''
        });
    }
};

// 1.g Ingest Model JSON and Append to History
exports.ingestCommitModelOutput = async (req, res) => {
    let tempFilePath = null;

    try {
        const modelJsonRaw = String(req.body.modelJson || '').trim();
        if (!modelJsonRaw) {
            return res.status(400).json({ status: 'error', message: 'Model JSON output is required.' });
        }

        let parsed;
        try {
            parsed = JSON.parse(modelJsonRaw);
        } catch (parseErr) {
            return res.status(400).json({ status: 'error', message: `Invalid JSON: ${parseErr.message}` });
        }

        await fs.mkdir(IELTS_RESEARCH_DIR, { recursive: true });
        tempFilePath = path.join(IELTS_RESEARCH_DIR, `model_output_ui_${Date.now()}.json`);
        await fs.writeFile(tempFilePath, JSON.stringify(parsed, null, 2), 'utf8');

        const { stdout } = await runIeltsCommitHelper(['-ModelResponsePath', tempFilePath, '-NoCopyCommit']);
        const commitMessage = extractCommitMessageFromOutput(stdout);

        res.json({
            status: 'success',
            message: 'Model output ingested and history updated.',
            commitMessage,
            historyPath: toRepoRelativePath(IELTS_COMMIT_HISTORY_FILE)
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to ingest model output.',
            details: error.stderr || ''
        });
    } finally {
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
            } catch (cleanupErr) {
                // Ignore temporary cleanup errors
            }
        }
    }
};

// 1.h Run full flow: generate prompt -> call AI -> append commit history
exports.runCommitHelperAuto = async (req, res) => {
    let tempFilePath = null;

    try {
        const researchContext = String(req.body.researchContext || '').trim();
        const modelId = String(req.body.modelId || '').trim() || null;

        if (!researchContext) {
            return res.status(400).json({ status: 'error', message: 'Research context is required.' });
        }

        // Step 1: Generate prompt file using your existing helper
        await runIeltsCommitHelper(['-GeneratePrompt', '-ResearchContext', researchContext]);
        const promptText = await fs.readFile(IELTS_LAST_PROMPT_FILE, 'utf8');

        // Step 2: Send prompt directly to AI service
        const aiResult = await aiService.sendMessage(
            [{ role: 'user', content: promptText }],
            modelId,
            {
                temperature: 0,
                requestingUser: req.user
            }
        );

        const modelRawText = String(aiResult.text || '').trim();
        const parsedJson = parseModelJsonText(modelRawText);

        // Step 3: Reuse helper ingestion so history format remains consistent
        await fs.mkdir(IELTS_RESEARCH_DIR, { recursive: true });
        tempFilePath = path.join(IELTS_RESEARCH_DIR, `model_output_auto_${Date.now()}.json`);
        await fs.writeFile(tempFilePath, JSON.stringify(parsedJson, null, 2), 'utf8');

        const { stdout } = await runIeltsCommitHelper(['-ModelResponsePath', tempFilePath, '-NoCopyCommit']);
        const commitMessage = extractCommitMessageFromOutput(stdout);

        res.json({
            status: 'success',
            message: 'Prompt generated, AI response ingested, and history updated.',
            modelUsed: aiResult.modelUsed || modelId,
            promptPath: toRepoRelativePath(IELTS_LAST_PROMPT_FILE),
            historyPath: toRepoRelativePath(IELTS_COMMIT_HISTORY_FILE),
            promptText,
            modelJson: parsedJson,
            modelRawText,
            commitMessage
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Automatic commit helper flow failed.',
            details: error.stderr || ''
        });
    } finally {
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
            } catch (cleanupErr) {
                // Ignore temporary cleanup errors
            }
        }
    }
};

// 2. Step 1: Freeze Inputs (API)
exports.freezeEssayInput = async (req, res) => {
    try {
        const { sampleId } = req.body;
        
        // Fetch the raw text from the database
        const sample = await ieltsService.getDataById('task2Samples', sampleId, req.user);
        if(!sample) throw new Error("Sample not found");

        // Use the deterministic service
        const essayObject = essayPreprocessingService.buildEssayObject(sample.text);

        res.json({ 
            status: 'success', 
            data: essayObject,
            meta: {
                refName: sample.refName,
                type: sample.type,
                sampleBandScore: (sample.bandScore !== undefined && sample.bandScore !== null && sample.bandScore !== '')
                    ? Number(sample.bandScore)
                    : null,
                sampleFeedback: sample.feedback || ''
            }
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// 3. Step 2: Feature Analysis (API)
exports.analyzeEssayFeatures = async (req, res) => {
    try {
        const { essayObject } = req.body; // Expecting the full object from Step 1
        
        if(!essayObject || !essayObject.normalizedText) {
            throw new Error("Invalid Essay Object provided. Please run Step 1 first.");
        }

        // Run deterministic analysis
        const analysisResults = essayAnalysisService.computeStep2Features(essayObject);

        res.json({ 
            status: 'success', 
            data: analysisResults 
        });

    } catch (error) {
        console.error("Step 2 Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// 4. Step 3: AI Extraction (API)
exports.extractEssayEvidence = async (req, res) => {
    const cancelToken = extractScoringCancelToken(req);
    const runHandle = scoringRunControlService.registerRun({
        token: cancelToken,
        userId: req?.user?.id,
        stepKey: 'step3extract'
    });
    try {
        const { sampleId, essayObject, customPrompt } = req.body;
        const promptSource = String(req.body.promptSource || '').trim().toLowerCase();
        const promptTemplateId = String(req.body.promptTemplateId || '').trim();
        const modelId = String(req.body.modelId || '').trim() || null;
        const incomingOptions = req.body.options || {};
        const disableCacheRaw = incomingOptions.disableCache ?? req.body.disableCache;
        const disableCache = disableCacheRaw === true || String(disableCacheRaw || '').trim().toLowerCase() === 'true';
        const stabilityProfile = String(
            incomingOptions.stabilityProfile || req.body.stabilityProfile || 'standard'
        ).trim().toLowerCase() === 'strict' ? 'strict' : 'standard';
        const clampInt = (value, min, max, fallback) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed)) return fallback;
            return Math.max(min, Math.min(max, parsed));
        };

        if (!essayObject || !sampleId) {
            throw new Error("Missing Essay Object or Sample ID.");
        }

        // 1. Fetch data
        const sample = await ieltsService.getDataById('task2Samples', sampleId, req.user);
        if (!sample) throw new Error("Sample not found.");

        // 2. Re-calculate Paragraph Roles (Step 2 Logic)
        const step2Features = essayAnalysisService.computeStep2Features(essayObject);
        const paragraphRoles = step2Features.structure.paragraphRoles;
        const taskDefinition = aiExtractionService.prepareTask2Prompt(sample.question || '');
        const wantsTemplatePrompt = promptSource === 'template' || Boolean(promptTemplateId);

        let resolvedPrompt = String(customPrompt || '').trim();
        if (!resolvedPrompt && wantsTemplatePrompt) {
            if (!promptTemplateId) {
                throw new Error('A Step 3 template must be selected when prompt source is template.');
            }
            const promptTemplate = await ieltsService.getDataById('prompts', promptTemplateId, req.user);
            if (!promptTemplate) {
                throw new Error('Selected prompt template was not found.');
            }
            const category = String(promptTemplate.category || '').trim().toLowerCase();
            if (category !== 'step3extract') {
                throw new Error('Selected template is not compatible with Step 3.');
            }
            resolvedPrompt = aiExtractionService.buildExtractionPromptFromTemplate({
                templateContent: promptTemplate.content || '',
                taskDefinition,
                essayObj: essayObject,
                paragraphRoles,
                stabilityProfile
            });
        }

        // âœ… HANDLE PREVIEW REQUEST
        if (req.query.preview === 'true') {
             const promptText = resolvedPrompt || aiExtractionService.buildExtractionPrompt({
                 taskDefinition,
                 essayObj: essayObject,
                 paragraphRoles,
                 stabilityProfile
             });
             
             return res.json({
                 status: 'success',
                 data: { promptPreview: promptText },
                });
        }
        const requestedMode = String(
            incomingOptions.mode ||
            incomingOptions.executionMode ||
            req.body.mode ||
            ''
        ).trim().toLowerCase();
        const requestedRunCount = clampInt(
            incomingOptions.runCount ?? incomingOptions.step3RunCount ?? req.body.runCount,
            1,
            10,
            1
        );
        const stabilityGateRequested = (
            requestedMode === 'stability_gate_auto_consensus' ||
            incomingOptions.stabilityGate === true ||
            String(incomingOptions.stabilityGate || '').trim().toLowerCase() === 'true' ||
            incomingOptions.consensus === true ||
            String(incomingOptions.consensus || '').trim().toLowerCase() === 'true'
        ) && requestedRunCount >= 2;
        const runInParallel = stabilityGateRequested && !(
            incomingOptions.parallel === false ||
            String(incomingOptions.parallel || '').trim().toLowerCase() === 'false'
        );

        const providerId = String(incomingOptions.providerId || req.body.providerId || '').trim().toLowerCase() || null;
        const apiProviderId = String(incomingOptions.apiProviderId || req.body.apiProviderId || '').trim() || null;

        const runSingleExtraction = async () => {
            return aiExtractionService.runAiExtraction({
                essayObj: essayObject,
                samplePrompt: sample.question || "Discuss both views.",
                paragraphRoles: paragraphRoles,
                customPrompt: resolvedPrompt,
                model: modelId,
                // Stability gate should always run live to avoid cache replay masquerading as agreement.
                disableCache: stabilityGateRequested ? true : disableCache,
                stabilityProfile,
                requestingUser: req.user,
                providerId,
                apiProviderId,
                abortSignal: runHandle?.signal || null
            });
        };

        const toClientRunResponse = (result) => ({
            status: 'success',
            data: result.extraction,
            meta: {
                cacheKey: result.cacheKey,
                generatedKeys: result.meta.subquestion_keys,
                executedPrompt: result.executedPrompt,
                promptHash: result.meta.promptHash,
                schemaVersion: result.meta.schemaVersion,
                fromCache: result.meta.fromCache ?? result.fromCache ?? false,
                modelUsed: result.meta.modelUsed,
                usage: result.meta.usage || null,
                requestMeta: result.meta.requestMeta || null,
                languageCalibration: result.meta.languageCalibration || {
                    applied: false,
                    adjustmentCount: 0,
                    adjustments: []
                }
            }
        });

        if (stabilityGateRequested) {
            let runResults = [];

            if (runInParallel) {
                const runTasks = Array.from({ length: requestedRunCount }, () => runSingleExtraction());
                const settled = await Promise.allSettled(runTasks);
                const failed = settled.findIndex((entry) => entry.status === 'rejected');
                if (failed >= 0) {
                    const reason = settled[failed].reason;
                    const message = String(reason?.message || reason || 'Step 3 stability run failed.');
                    throw new Error(`Step 3 stability run ${failed + 1}/${requestedRunCount} failed: ${message}`);
                }
                runResults = settled.map((entry) => entry.value);
            } else {
                for (let i = 0; i < requestedRunCount; i += 1) {
                    runResults.push(await runSingleExtraction());
                }
            }

            const runResponses = runResults.map(toClientRunResponse);
            const firstRun = runResponses[0];
            const generatedKeys = Array.from(new Set(
                runResponses.flatMap((run) => Array.isArray(run?.meta?.generatedKeys) ? run.meta.generatedKeys : [])
            ));
            const promptHashes = Array.from(new Set(
                runResponses.map((run) => String(run?.meta?.promptHash || '').trim()).filter(Boolean)
            ));
            const modelList = Array.from(new Set(
                runResponses.map((run) => String(run?.meta?.modelUsed || '').trim()).filter(Boolean)
            ));

            return res.json({
                status: 'success',
                data: firstRun?.data || {},
                meta: {
                    ...(firstRun?.meta || {}),
                    generatedKeys,
                    promptHashes,
                    modelUsed: modelList.length <= 1
                        ? (modelList[0] || firstRun?.meta?.modelUsed || '')
                        : 'multi-model',
                    stabilityExecution: {
                        mode: 'stability_gate_auto_consensus',
                        runCount: requestedRunCount,
                        parallel: runInParallel
                    },
                    stabilityRuns: runResponses
                }
            });
        }

        // 3. Run AI Service (single extraction)
        const result = await runSingleExtraction();
        const response = toClientRunResponse(result);

        res.json({
            status: 'success',
            data: response.data,
            meta: response.meta
        });

    } catch (error) {
        if (scoringRunControlService.isAbortError(error)) {
            return res.status(499).json({
                status: 'error',
                code: 'RUN_CANCELLED',
                message: buildRunCancelledMessage('Step 3 extraction')
            });
        }
        console.error("Step 3 Extraction Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        if (runHandle?.token) {
            scoringRunControlService.finishRun(runHandle.token);
        }
    }
};

// 5. Step 4: Grading (API)
exports.calculateGrades = async (req, res) => {
    const cancelToken = extractScoringCancelToken(req);
    const runHandle = scoringRunControlService.registerRun({
        token: cancelToken,
        userId: req?.user?.id,
        stepKey: 'step4grade'
    });
    try {
        const { essayObject, step2Features, extraction, sampleId } = req.body;
        const promptSource = String(req.body.promptSource || '').trim().toLowerCase();
        const promptTemplateId = String(req.body.promptTemplateId || '').trim();
        const customPrompt = String(req.body.customPrompt || '').trim();
        const modelId = String(req.body.modelId || req.body.options?.modelId || '').trim() || null;

        // Optional runtime tuning from UI
        const incomingOptions = req.body.options || req.body.gradingOptions || {};
        const clampInt = (v, min, max, fallback) => {
            const n = parseInt(v, 10);
            if (Number.isNaN(n)) return fallback;
            return Math.max(min, Math.min(max, n));
        };
        const scoringOptions = {
            batchSize: clampInt(incomingOptions.batchSize, 1, 20, 5),
            concurrency: clampInt(incomingOptions.concurrency, 1, 10, 2),
            modelId,
            providerId: String(incomingOptions.providerId || req.body.providerId || '').trim().toLowerCase() || null,
            apiProviderId: String(incomingOptions.apiProviderId || req.body.apiProviderId || '').trim() || null,
            requestingUser: req.user,
            promptSource,
            promptTemplateId,
            customPrompt,
            promptTemplateContent: '',
            disableCache: incomingOptions.disableCache === true || String(incomingOptions.disableCache || '').trim().toLowerCase() === 'true',
            stabilityProfile: String(incomingOptions.stabilityProfile || 'standard').trim().toLowerCase() === 'strict' ? 'strict' : 'standard',
            mode: String(
                incomingOptions.mode ||
                req.body.mode ||
                req.body.researchConfig?.mode ||
                'hybrid_extension'
            ).trim().toLowerCase() === 'operationalized_only'
                ? 'operationalized_only'
                : 'hybrid_extension',
            step4RetryLimit: incomingOptions.step4RetryLimit ?? incomingOptions.aiRetryLimit,
            step4RetryBackoffMs: incomingOptions.step4RetryBackoffMs ?? incomingOptions.aiRetryBackoffMs,
            step4RetryBackoffMultiplier: incomingOptions.step4RetryBackoffMultiplier ?? incomingOptions.aiRetryBackoffMultiplier,
            step4RetryBackoffMaxMs: incomingOptions.step4RetryBackoffMaxMs ?? incomingOptions.aiRetryBackoffMaxMs,
            step4FallbackRoutes: incomingOptions.step4FallbackRoutes ?? incomingOptions.fallbackRoutes ?? null,
            step4FallbackModelIds: incomingOptions.step4FallbackModelIds ?? incomingOptions.fallbackModelIds ?? incomingOptions.step4FallbackModelId ?? incomingOptions.fallbackModelId ?? null,
            step4FallbackProviderId: String(incomingOptions.step4FallbackProviderId || incomingOptions.fallbackProviderId || '').trim().toLowerCase() || null,
            step4FallbackApiProviderId: String(incomingOptions.step4FallbackApiProviderId || incomingOptions.fallbackApiProviderId || '').trim() || null,
            cancelToken: cancelToken || null,
            abortSignal: runHandle?.signal || null
        };

        const wantsTemplatePrompt = promptSource === 'template' || Boolean(promptTemplateId);
        if (wantsTemplatePrompt) {
            if (!promptTemplateId) {
                throw new Error('A Step 4 template must be selected when prompt source is template.');
            }
            const promptTemplate = await ieltsService.getDataById('prompts', promptTemplateId, req.user);
            if (!promptTemplate) {
                throw new Error('Selected Step 4 prompt template was not found.');
            }
            const category = String(promptTemplate.category || '').trim().toLowerCase();
            if (category !== 'step4grade') {
                throw new Error('Selected template is not compatible with Step 4.');
            }
            scoringOptions.promptTemplateContent = String(promptTemplate.content || '').trim();
        }

        
        // 1. Fetch the Original Question (Crucial for Task Response)
        let taskPrompt = "Topic unknown";
        if (sampleId) {
            const sample = await ieltsService.getDataById('task2Samples', sampleId, req.user);
            if (sample && sample.question) {
                taskPrompt = sample.question;
            }
        }

        // 2. Fetch Rules
        const allAssessments = await ieltsService.fetchData('microAssessments', { is_active: true }, req.user);
        
        // 3. Run Service with Prompt
        const result = await step3ScoringService.runStep3Scoring({
            essayObj: essayObject,
            step2Features: step2Features,
            extraction: extraction,
            microAssessments: allAssessments,
            taskPrompt: taskPrompt, // âœ… PASSING THE QUESTION
            options: scoringOptions
        });

        res.json({
            status: 'success',
            data: result 
        });
    } catch (error) {
        if (scoringRunControlService.isAbortError(error)) {
            return res.status(499).json({
                status: 'error',
                code: 'RUN_CANCELLED',
                message: buildRunCancelledMessage('Step 4 grading')
            });
        }
        console.error("Grading Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        if (runHandle?.token) {
            scoringRunControlService.finishRun(runHandle.token);
        }
    }
};

exports.previewStep4Prompt = async (req, res) => {
    try {
        const { essayObject, step2Features, extraction, sampleId } = req.body;
        const promptSource = String(req.body.promptSource || '').trim().toLowerCase();
        const promptTemplateId = String(req.body.promptTemplateId || '').trim();
        const customPrompt = String(req.body.customPrompt || '').trim();
        const modelId = String(req.body.modelId || '').trim() || null;
        const incomingOptions = req.body.options || {};
        const clampInt = (v, min, max, fallback) => {
            const n = parseInt(v, 10);
            if (Number.isNaN(n)) return fallback;
            return Math.max(min, Math.min(max, n));
        };
        const scoringOptions = {
            batchSize: clampInt(incomingOptions.batchSize, 1, 20, 5),
            concurrency: clampInt(incomingOptions.concurrency, 1, 10, 2),
            modelId,
            providerId: String(incomingOptions.providerId || req.body.providerId || '').trim().toLowerCase() || null,
            apiProviderId: String(incomingOptions.apiProviderId || req.body.apiProviderId || '').trim() || null,
            requestingUser: req.user,
            promptSource,
            promptTemplateId,
            customPrompt,
            promptTemplateContent: '',
            disableCache: true,
            stabilityProfile: String(incomingOptions.stabilityProfile || 'standard').trim().toLowerCase() === 'strict' ? 'strict' : 'standard',
            mode: String(incomingOptions.mode || 'hybrid_extension').trim().toLowerCase() === 'operationalized_only'
                ? 'operationalized_only'
                : 'hybrid_extension',
            step4RetryLimit: incomingOptions.step4RetryLimit ?? incomingOptions.aiRetryLimit,
            step4RetryBackoffMs: incomingOptions.step4RetryBackoffMs ?? incomingOptions.aiRetryBackoffMs,
            step4RetryBackoffMultiplier: incomingOptions.step4RetryBackoffMultiplier ?? incomingOptions.aiRetryBackoffMultiplier,
            step4RetryBackoffMaxMs: incomingOptions.step4RetryBackoffMaxMs ?? incomingOptions.aiRetryBackoffMaxMs,
            step4FallbackRoutes: incomingOptions.step4FallbackRoutes ?? incomingOptions.fallbackRoutes ?? null,
            step4FallbackModelIds: incomingOptions.step4FallbackModelIds ?? incomingOptions.fallbackModelIds ?? incomingOptions.step4FallbackModelId ?? incomingOptions.fallbackModelId ?? null,
            step4FallbackProviderId: String(incomingOptions.step4FallbackProviderId || incomingOptions.fallbackProviderId || '').trim().toLowerCase() || null,
            step4FallbackApiProviderId: String(incomingOptions.step4FallbackApiProviderId || incomingOptions.fallbackApiProviderId || '').trim() || null
        };
        const wantsTemplatePrompt = promptSource === 'template' || Boolean(promptTemplateId);
        if (wantsTemplatePrompt) {
            if (!promptTemplateId) {
                throw new Error('A Step 4 template must be selected when prompt source is template.');
            }
            const promptTemplate = await ieltsService.getDataById('prompts', promptTemplateId, req.user);
            if (!promptTemplate) {
                throw new Error('Selected Step 4 prompt template was not found.');
            }
            const category = String(promptTemplate.category || '').trim().toLowerCase();
            if (category !== 'step4grade') {
                throw new Error('Selected template is not compatible with Step 4.');
            }
            scoringOptions.promptTemplateContent = String(promptTemplate.content || '').trim();
        }

        let taskPrompt = "Topic unknown";
        if (sampleId) {
            const sample = await ieltsService.getDataById('task2Samples', sampleId, req.user);
            if (sample && sample.question) taskPrompt = sample.question;
        }
        const allAssessments = await ieltsService.fetchData('microAssessments', { is_active: true }, req.user);
        const preview = await step3ScoringService.buildStep4PromptPreview({
            essayObj: essayObject,
            step2Features,
            extraction,
            microAssessments: allAssessments,
            taskPrompt,
            options: scoringOptions
        });
        res.json({ status: 'success', data: preview });
    } catch (error) {
        console.error("Step 4 Prompt Preview Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.previewStep5Prompt = async (req, res) => {
    try {
        const { essayObject, gradingResult } = req.body;
        const promptSource = String(req.body.promptSource || '').trim().toLowerCase();
        const promptTemplateId = String(req.body.promptTemplateId || '').trim();
        const customPrompt = String(req.body.customPrompt || '').trim();
        if (!essayObject || !gradingResult) {
            throw new Error("Missing Step 1 or Step 4 data.");
        }
        let promptTemplateContent = '';
        const wantsTemplatePrompt = promptSource === 'template' || Boolean(promptTemplateId);
        if (wantsTemplatePrompt) {
            if (!promptTemplateId) {
                throw new Error('A Step 5 template must be selected when prompt source is template.');
            }
            const promptTemplate = await ieltsService.getDataById('prompts', promptTemplateId, req.user);
            if (!promptTemplate) {
                throw new Error('Selected Step 5 prompt template was not found.');
            }
            const category = String(promptTemplate.category || '').trim().toLowerCase();
            if (category !== 'step5feedback') {
                throw new Error('Selected template is not compatible with Step 5.');
            }
            promptTemplateContent = String(promptTemplate.content || '').trim();
        }
        const preview = await step5FeedbackService.previewFeedbackPrompt(essayObject, gradingResult, {
            promptSource,
            promptTemplateId,
            promptTemplateContent,
            customPrompt
        });
        res.json({ status: 'success', data: preview });
    } catch (error) {
        console.error("Step 5 Prompt Preview Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};


exports.generateFeedback = async (req, res) => {
    const cancelToken = extractScoringCancelToken(req);
    const runHandle = scoringRunControlService.registerRun({
        token: cancelToken,
        userId: req?.user?.id,
        stepKey: 'step5feedback'
    });
    try {
        const { essayObject, gradingResult } = req.body;
        const promptSource = String(req.body.promptSource || '').trim().toLowerCase();
        const promptTemplateId = String(req.body.promptTemplateId || '').trim();
        const customPrompt = String(req.body.customPrompt || '').trim();
        const modelId = String(req.body.modelId || '').trim() || null;

        if (!essayObject || !gradingResult) {
            throw new Error("Missing Step 1 or Step 4 data.");
        }

        let promptTemplateContent = '';
        const wantsTemplatePrompt = promptSource === 'template' || Boolean(promptTemplateId);
        if (wantsTemplatePrompt) {
            if (!promptTemplateId) {
                throw new Error('A Step 5 template must be selected when prompt source is template.');
            }
            const promptTemplate = await ieltsService.getDataById('prompts', promptTemplateId, req.user);
            if (!promptTemplate) {
                throw new Error('Selected Step 5 prompt template was not found.');
            }
            const category = String(promptTemplate.category || '').trim().toLowerCase();
            if (category !== 'step5feedback') {
                throw new Error('Selected template is not compatible with Step 5.');
            }
            promptTemplateContent = String(promptTemplate.content || '').trim();
        }

        const feedback = await step5FeedbackService.generateFeedback(essayObject, gradingResult, {
            promptSource,
            promptTemplateId,
            promptTemplateContent,
            customPrompt,
            modelId,
            providerId: String(req.body.providerId || '').trim().toLowerCase() || null,
            apiProviderId: String(req.body.apiProviderId || '').trim() || null,
            requestingUser: req.user,
            abortSignal: runHandle?.signal || null
        });

        res.json({
            status: 'success',
            data: feedback
        });

    } catch (error) {
        if (scoringRunControlService.isAbortError(error)) {
            return res.status(499).json({
                status: 'error',
                code: 'RUN_CANCELLED',
                message: buildRunCancelledMessage('Step 5 feedback generation')
            });
        }
        console.error("Step 5 Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        if (runHandle?.token) {
            scoringRunControlService.finishRun(runHandle.token);
        }
    }
};

exports.cancelScoringRun = async (req, res) => {
    try {
        const cancelToken = extractScoringCancelToken(req) || String(req.body?.token || '').trim();
        if (!cancelToken) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing cancel token.'
            });
        }

        const result = scoringRunControlService.abortRun({
            token: cancelToken,
            userId: req?.user?.id
        });

        if (result?.reason === 'forbidden') {
            return res.status(403).json({
                status: 'error',
                message: 'You are not allowed to cancel this run.'
            });
        }

        return res.json({
            status: 'success',
            data: result
        });
    } catch (error) {
        console.error('Scoring cancel error:', error);
        return res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to cancel scoring run.'
        });
    }
};
/* ----------------------------------------------------------------*/
//#endregion 
/* ----------------------------------------------------------------*/

/* ----------------------------------------------------------------*/
//#region   SCORING HISTORY (SESSIONS) - NEW
/* ----------------------------------------------------------------*/

const SCORING_SYNTHETIC_PRIMARY_STEPS = ['step1freeze', 'step2analyze', 'step3extract', 'step4grade'];
const SCORING_SYNTHETIC_DEFAULT_DURATIONS = Object.freeze({
    step1freeze: 1800,
    step2analyze: 2600,
    step3extract: 7200,
    step4grade: 6400
});
const SCORING_PARTIAL_CLONE_PRIMARY_STEPS = ['step1freeze', 'step2analyze', 'step3extract', 'step4grade', 'step5feedback'];

function cloneAsJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function toTimestampMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const token = String(value ?? '').trim();
    if (!token) return null;
    if (/^\d+$/.test(token)) {
        const n = Number(token);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    const parsed = Date.parse(token);
    return Number.isFinite(parsed) ? parsed : null;
}

function toIsoTimestamp(ms, fallback = null) {
    if (!Number.isFinite(ms) || ms <= 0) return fallback;
    try {
        return new Date(ms).toISOString();
    } catch (_) {
        return fallback;
    }
}

function createSeededRng(seedInput = '') {
    let seed = 0;
    const text = String(seedInput || '');
    for (let i = 0; i < text.length; i += 1) {
        seed = ((seed * 31) + text.charCodeAt(i)) >>> 0;
    }
    if (!seed) seed = 0x9e3779b9;
    return () => {
        seed += 0x6D2B79F5;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomInRange(rng, min, max) {
    const next = typeof rng === 'function' ? rng() : Math.random();
    return min + ((max - min) * next);
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function looksLikeTimeKey(key = '') {
    const token = String(key || '').trim();
    if (!token) return false;
    const lower = token.toLowerCase();
    if ([
        'savedat', 'createdat', 'updatedat', 'startedat', 'endedat', 'consumedat', 'billedat',
        'timestamp', 'datetime', 'createdatetime', 'updatedatetime', 'lastupdatedatetime',
        'date', 'time'
    ].includes(lower)) {
        return true;
    }
    if (lower.endsWith('datetime') || lower.endsWith('timestamp') || lower.endsWith('createdat') || lower.endsWith('updatedat') || lower.endsWith('savedat')) {
        return true;
    }
    if (lower.endsWith('startedat') || lower.endsWith('endedat') || lower.endsWith('consumedat') || lower.endsWith('billedat')) {
        return true;
    }
    if (lower.endsWith('date') || lower.endsWith('time')) return true;
    if (lower.endsWith('at') && !lower.endsWith('format') && !lower.endsWith('stat')) return true;
    return false;
}

function shiftTemporalFieldsInPlace(node, context = {}, parentKey = '') {
    if (!node || typeof node !== 'object') return;
    const deltaMs = Number(context.deltaMs || 0);
    const nowMs = Number(context.nowMs || Date.now());
    const maxAllowedMs = Math.max(0, nowMs - 1000);

    if (Array.isArray(node)) {
        node.forEach((item) => shiftTemporalFieldsInPlace(item, context, parentKey));
        return;
    }

    Object.keys(node).forEach((key) => {
        const value = node[key];
        const temporalKey = looksLikeTimeKey(key) || looksLikeTimeKey(parentKey);
        if (temporalKey && typeof value === 'string') {
            const isDateLike = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value.trim()) || /^\d{13,}$/.test(value.trim());
            if (isDateLike) {
                const parsed = toTimestampMs(value);
                if (Number.isFinite(parsed)) {
                    const shifted = clampNumber(parsed + deltaMs, 1, maxAllowedMs);
                    node[key] = /T/.test(value) || value.includes(':')
                        ? toIsoTimestamp(shifted, value)
                        : String(Math.round(shifted));
                }
            }
        } else if (temporalKey && typeof value === 'number' && Number.isFinite(value) && value > 0) {
            const shifted = clampNumber(Math.round(value + deltaMs), 1, maxAllowedMs);
            node[key] = shifted;
        } else if (value && typeof value === 'object') {
            shiftTemporalFieldsInPlace(value, context, key);
        }
    });
}

function extractStepDurationMs(step = null) {
    const startedAt = Number(step?.timing?.startedAt);
    const endedAt = Number(step?.timing?.endedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
    const duration = Math.round(endedAt - startedAt);
    return duration > 0 ? duration : null;
}

function applySyntheticPrimaryStepTimings(session, targetSavedAtMs, nowMs, rng) {
    const steps = session?.steps;
    if (!steps || typeof steps !== 'object') return;

    const presentPrimary = SCORING_SYNTHETIC_PRIMARY_STEPS.filter((stepKey) => steps[stepKey] && typeof steps[stepKey] === 'object');
    if (!presentPrimary.length) return;

    const durations = presentPrimary.map((stepKey) => {
        const base = extractStepDurationMs(steps[stepKey]) || SCORING_SYNTHETIC_DEFAULT_DURATIONS[stepKey] || 2500;
        const factor = randomInRange(rng, 0.82, 1.24);
        return Math.max(400, Math.round(base * factor));
    });
    const gaps = presentPrimary.map((_, idx) => (idx === presentPrimary.length - 1 ? 0 : Math.round(randomInRange(rng, 120, 1200))));
    const totalRuntimeMs = durations.reduce((sum, d) => sum + d, 0) + gaps.reduce((sum, g) => sum + g, 0);

    const saveLagMs = Math.round(randomInRange(rng, 5000, 90000));
    const pipelineEndMs = Math.min(targetSavedAtMs - saveLagMs, nowMs - 2000);
    let cursor = Math.max(1, pipelineEndMs - totalRuntimeMs);

    presentPrimary.forEach((stepKey, idx) => {
        const duration = durations[idx];
        const startedAt = cursor;
        const endedAt = startedAt + duration;
        steps[stepKey].timing = { startedAt, endedAt };
        cursor = endedAt + (gaps[idx] || 0);
    });

    if (steps.step3stability && steps.step3extract?.timing) {
        const base = steps.step3extract.timing;
        const span = Math.max(400, Number(base.endedAt) - Number(base.startedAt));
        const overlapStart = Math.round(Number(base.startedAt) + (span * randomInRange(rng, 0.15, 0.45)));
        steps.step3stability.timing = { startedAt: overlapStart, endedAt: Number(base.endedAt) };
    }
    if (steps.step4stability && steps.step4grade?.timing) {
        const base = steps.step4grade.timing;
        const span = Math.max(400, Number(base.endedAt) - Number(base.startedAt));
        const overlapStart = Math.round(Number(base.startedAt) + (span * randomInRange(rng, 0.15, 0.45)));
        steps.step4stability.timing = { startedAt: overlapStart, endedAt: Number(base.endedAt) };
    }
}

function stripStep5Artifacts(session) {
    if (!session || typeof session !== 'object') return;
    if (!session.steps || typeof session.steps !== 'object') session.steps = {};
    delete session.steps.step5feedback;
    delete session.steps.step5stability;
    delete session.steps.step6report;

    if (Array.isArray(session.tweakLog)) {
        session.tweakLog = session.tweakLog.filter((entry) => {
            const action = String(entry?.action || '').toLowerCase();
            return !(action.includes('step5') || action.includes('feedback'));
        });
    }

    if (session.freezePoints && typeof session.freezePoints === 'object') {
        Object.keys(session.freezePoints).forEach((key) => {
            const normalized = String(key || '').toLowerCase();
            if (normalized.includes('step5') || normalized.includes('feedback')) {
                delete session.freezePoints[key];
            }
        });
    }

    if (!session.uiState || typeof session.uiState !== 'object') session.uiState = {};
    session.uiState.readOnlyOnLoad = false;
    session.uiState.currentStep = '5';

    if (!session.metadata || typeof session.metadata !== 'object') session.metadata = {};
    session.metadata.isComplete = false;

    session.status = 'In Progress';
}

function resolveSyntheticSavedAtMs(sourceSavedAtMs, nowMs, copyIndex, totalCopies, rng) {
    const safeNow = Math.max(10000, Number(nowMs || Date.now()));
    const upperBound = safeNow - 5000;
    let sourceMs = Number(sourceSavedAtMs || (safeNow - (2 * 60 * 60 * 1000)));
    if (!Number.isFinite(sourceMs) || sourceMs <= 0) {
        sourceMs = safeNow - (2 * 60 * 60 * 1000);
    }
    if (sourceMs >= upperBound) {
        sourceMs = upperBound - Math.max(1000, Math.min(4000, Number(totalCopies || 1) * 100));
    }
    sourceMs = Math.min(sourceMs, upperBound - 1000);
    sourceMs = Math.max(1, sourceMs);

    const usableWindow = Math.max(1000, upperBound - sourceMs);
    const baseFraction = Number(copyIndex || 1) / (Number(totalCopies || 1) + 1);
    const jitter = randomInRange(rng, -0.08, 0.08);
    const fraction = clampNumber(baseFraction + jitter, 0.03, 0.97);
    const targetMs = sourceMs + (usableWindow * fraction);
    return Math.round(clampNumber(targetMs, sourceMs + 200, upperBound));
}

function buildSyntheticScoringHistoryCopy(sourceSession, options = {}) {
    const copyIndex = Number(options.copyIndex || 1);
    const totalCopies = Number(options.totalCopies || 1);
    const nowMs = Number(options.nowMs || Date.now());

    const source = cloneAsJson(sourceSession);
    if (!source || typeof source !== 'object') {
        throw new Error('Selected scoring session is invalid for cloning.');
    }

    const sourceId = String(source?.id || source?.sessionId || '').trim();
    const seed = `${sourceId}:${copyIndex}:${totalCopies}`;
    const rng = createSeededRng(seed);

    const sourceSavedAtMs =
        toTimestampMs(source?.savedAt) ||
        toTimestampMs(source?.metadata?.savedAt) ||
        (nowMs - (2 * 60 * 60 * 1000));
    const targetSavedAtMs = resolveSyntheticSavedAtMs(sourceSavedAtMs, nowMs, copyIndex, totalCopies, rng);
    const shiftMs = targetSavedAtMs - sourceSavedAtMs;

    shiftTemporalFieldsInPlace(source, { deltaMs: shiftMs, nowMs });
    stripStep5Artifacts(source);
    applySyntheticPrimaryStepTimings(source, targetSavedAtMs, nowMs, rng);

    const savedAtIso = toIsoTimestamp(targetSavedAtMs, new Date(nowMs).toISOString());
    source.savedAt = savedAtIso;
    source.id = null;
    source.sessionId = null;
    delete source._id;

    if (!source.metadata || typeof source.metadata !== 'object') source.metadata = {};
    source.metadata.savedAt = savedAtIso;
    source.metadata.isComplete = false;
    source.metadata.syntheticCopy = true;
    source.metadata.syntheticCopySourceSessionId = sourceId || null;
    source.metadata.syntheticCopyOrdinal = copyIndex;
    source.metadata.syntheticCopyTotal = totalCopies;

    if (!source.researchConfig || typeof source.researchConfig !== 'object') source.researchConfig = {};
    source.researchConfig.updatedAt = savedAtIso;

    return source;
}

function parseSyntheticCopyCount(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
}

function parsePartialCloneUpToStep(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
}

function trimSessionToStepInPlace(session, upToStep) {
    if (!session || typeof session !== 'object') return;
    const targetStep = Math.max(1, Math.min(4, Number.parseInt(upToStep, 10) || 1));

    if (!session.steps || typeof session.steps !== 'object') session.steps = {};
    const keepPrimary = SCORING_PARTIAL_CLONE_PRIMARY_STEPS.slice(0, targetStep);
    const keepKeys = new Set(keepPrimary);
    if (targetStep >= 3) keepKeys.add('step3stability');
    if (targetStep >= 4) keepKeys.add('step4stability');
    Object.keys(session.steps).forEach((key) => {
        if (!keepKeys.has(key)) delete session.steps[key];
    });

    if (Array.isArray(session.tweakLog)) {
        session.tweakLog = session.tweakLog.filter((entry) => {
            const action = String(entry?.action || '').toLowerCase();
            if (targetStep < 4 && (action.includes('step4') || action.includes('grading') || action.includes('stability_gate'))) return false;
            if (targetStep < 3 && (action.includes('step3') || action.includes('extraction'))) return false;
            if (targetStep < 2 && (action.includes('step2') || action.includes('analysis'))) return false;
            if (action.includes('step5') || action.includes('feedback') || action.includes('step6') || action.includes('report')) return false;
            return true;
        });
    }

    if (session.freezePoints && typeof session.freezePoints === 'object') {
        Object.keys(session.freezePoints).forEach((key) => {
            const normalized = String(key || '').toLowerCase();
            if (normalized.includes('step5') || normalized.includes('feedback') || normalized.includes('step6') || normalized.includes('report')) {
                delete session.freezePoints[key];
                return;
            }
            if (targetStep < 4 && (normalized.includes('step4') || normalized.includes('grading') || normalized.includes('stability_gate'))) {
                delete session.freezePoints[key];
                return;
            }
            if (targetStep < 3 && (normalized.includes('step3') || normalized.includes('extract'))) {
                delete session.freezePoints[key];
                return;
            }
            if (targetStep < 2 && (normalized.includes('step2') || normalized.includes('analyze'))) {
                delete session.freezePoints[key];
            }
        });
    }

    if (!session.uiState || typeof session.uiState !== 'object') session.uiState = {};
    session.uiState.readOnlyOnLoad = false;
    session.uiState.currentStep = String(Math.min(targetStep + 1, 5));
    session.uiState.scoringView = 'scoringV0326';

    if (!session.metadata || typeof session.metadata !== 'object') session.metadata = {};
    session.metadata.isComplete = false;
    session.metadata.scoringView = 'scoringV0326';
    session.metadata.pipelineMode = 'full';

    if (!session.researchConfig || typeof session.researchConfig !== 'object') session.researchConfig = {};
    session.researchConfig.pipelineMode = 'full';
    session.researchConfig.scoringView = 'scoringV0326';

    session.scoringView = 'scoringV0326';
    session.status = 'In Progress';
}

// 1. LIST SAVED SESSIONS (View)
exports.showScoringHistory = async (req, res) => {
    try {
        const isAjaxRequest = Boolean(req?.headers?.['x-ajax-request']);
        const pickerMode = String(req?.query?.pickerMode || '').trim().toLowerCase();
        const isStep3PickerMode = pickerMode === 'step3copy';
        const pickerSampleId = String(req?.query?.sampleId || '').trim();
        const scoringHistorySearchFieldAliases = {
            id: ['id'],
            sampleName: ['sampleName', 'metadata.sampleName', 'metadata.sampleRefName'],
            sampleId: ['sampleId', 'metadata.sampleId'],
            status: ['status'],
            pipelineMode: ['pipelineMode', 'metadata.pipelineMode', 'researchConfig.pipelineMode'],
            scoringView: ['scoringView', 'metadata.scoringView', 'researchConfig.scoringView', 'uiState.scoringView'],
            overallBand: ['overallBand', 'steps.step4grade.response.json.data.overallBand', 'steps.step4grade.response.json.data.overall.band'],
            examinerBandScore: ['examinerBandScore', 'metadata.examinerBandScore', 'steps.step1freeze.response.json.meta.sampleBandScore'],
            savedAt: ['savedAt', 'metadata.savedAt', 'audit.lastUpdateDateTime', 'audit.createDateTime'],
            step3ModelUsed: ['step3ModelUsed', 'steps.step3extract.response.json.meta.modelUsed'],
            runCategory: ['runCategoryLabel', 'runCategoryKey', 'metadata.runCategory.label', 'metadata.runCategory.key']
        };
        const scoringHistoryAllowedSearchFields = Array.from(new Set(
            Object.values(scoringHistorySearchFieldAliases).flat()
        ));
        const scoringHistorySearchableFields = Object.keys(scoringHistorySearchFieldAliases);

        const rawTypeFilter = req.query?.resultType ?? req.query?.historyType ?? req.query?.pipelineType;
        let typeFilter = normalizeHistoryTypeFilter(rawTypeFilter);
        const rawScoringViewFilter = req.query?.scoringView;
        const scoringViewFilter = normalizeScoringViewFilter(rawScoringViewFilter);
        const rawRunCategoryFilter = String(
            req.query?.runCategory ||
            req.query?.runCategoryKey ||
            ''
        ).trim();
        const runCategoryFilter = rawRunCategoryFilter.toLowerCase() === 'uncategorized'
            ? 'uncategorized'
            : (rawRunCategoryFilter || 'all');
        const rawArchiveViewFilter = req.query?.archiveView ?? req.query?.historyView ?? req.query?.view;
        const archiveViewFilter = normalizeArchiveViewFilter(rawArchiveViewFilter);
        const queryTypeLower = String(req.query?.type || '').trim().toLowerCase();
        const hasLegacyTypeFilter = ['full', 'step3_tuning', 'step4_tuning'].includes(queryTypeLower);
        if (typeFilter === 'all' && hasLegacyTypeFilter) {
            typeFilter = normalizeHistoryTypeFilter(queryTypeLower);
        }

        const dataQuerySource = { ...(req.query || {}) };
        delete dataQuerySource.resultType;
        delete dataQuerySource.historyType;
        delete dataQuerySource.pipelineType;
        delete dataQuerySource.scoringView;
        delete dataQuerySource.runCategory;
        delete dataQuerySource.runCategoryKey;
        delete dataQuerySource.archiveView;
        delete dataQuerySource.historyView;
        delete dataQuerySource.view;
        if (hasLegacyTypeFilter) delete dataQuerySource.type;
        if (isStep3PickerMode) delete dataQuerySource.sampleId;

        const dataQuery = await buildDataServiceQuery(dataQuerySource, {
            allowedExactKeys: [
                'id',
                'userId',
                'sampleId',
                'status',
                'pipelineMode',
                'scoringView',
                'runCategoryAssigned',
                'runCategoryKey',
                'runCategoryColor',
                'isArchived',
                'isArchived__eq',
                'isArchived__neq',
                'runCategoryAssigned__eq',
                'runCategoryAssigned__neq',
                'runCategoryKey__eq'
            ],
            allowedSearchFields: scoringHistoryAllowedSearchFields,
            defaultSearchFields: scoringHistoryAllowedSearchFields
        });
        const requestedSearchFieldsRaw = String(dataQuerySource?.searchFields ?? dataQuerySource?.searchField ?? '').trim();
        if (requestedSearchFieldsRaw && requestedSearchFieldsRaw.toLowerCase() !== 'all') {
            const requestedSearchTokens = requestedSearchFieldsRaw
                .split(',')
                .map((token) => String(token || '').trim())
                .filter(Boolean);
            const expandedSearchFields = [];
            requestedSearchTokens.forEach((token) => {
                const aliasFields = scoringHistorySearchFieldAliases[token];
                if (Array.isArray(aliasFields) && aliasFields.length) {
                    expandedSearchFields.push(...aliasFields);
                } else {
                    expandedSearchFields.push(token);
                }
            });
            const uniqueExpanded = Array.from(new Set(expandedSearchFields));
            if (uniqueExpanded.length) {
                dataQuery.searchFields = uniqueExpanded.join(',');
            }
        }
        if (!String(dataQuery?.sort || '').trim()) {
            dataQuery.sort = 'savedAt';
            dataQuery.order = 'desc';
        }
        if (isStep3PickerMode) {
            dataQuery['steps.step3extract.response.json.status__in'] = 'success';
            if (pickerSampleId) {
                dataQuery['metadata.sampleId__eq'] = pickerSampleId;
            }
        }
        if (typeFilter !== 'all') {
            dataQuery.pipelineMode__in = typeFilter;
        }
        if (scoringViewFilter !== 'all') {
            dataQuery.scoringView__in = scoringViewFilter;
        }
        if (runCategoryFilter !== 'all') {
            if (runCategoryFilter === 'uncategorized') {
                dataQuery.runCategoryAssigned__neq = 'true';
            } else {
                dataQuery.runCategoryKey__eq = runCategoryFilter;
            }
        }
        if (archiveViewFilter === 'archived') {
            dataQuery.isArchived__eq = 'true';
        } else {
            // Include legacy sessions that do not have isArchived field yet.
            dataQuery.isArchived__neq = 'true';
        }

        const requestedLimit = Number.parseInt(dataQuery?.limit, 10);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;

        const countQuery = { ...(dataQuery || {}) };
        delete countQuery.page;
        delete countQuery.limit;

        const totalItems = Number(await ieltsService.countData(
            'scoringHistory',
            countQuery,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.READ_ALL)
        )) || 0;
        const totalPages = Math.max(1, Math.ceil(totalItems / limit) || 1);
        const requestedPage = Number.parseInt(dataQuery?.page, 10);
        const currentPage = Number.isFinite(requestedPage) && requestedPage > 0
            ? Math.min(requestedPage, totalPages)
            : 1;

        const pagedQuery = {
            ...(dataQuery || {}),
            page: currentPage,
            limit
        };
        const listAccessContext = {
            ...buildScoringHistoryAccessContext(req, OPERATIONS.READ_ALL),
            listProfile: 'summary'
        };

        const history = await ieltsService.fetchData(
            'scoringHistory',
            pagedQuery,
            req.user,
            listAccessContext
        );

        const resolveSavedAt = (item = {}) => (
            item?.savedAt ||
            item?.metadata?.savedAt ||
            item?.audit?.lastUpdateDateTime ||
            item?.audit?.createDateTime ||
            null
        );
        const resolveSampleName = (item = {}) => {
            const primary = String(item?.sampleName || '').trim();
            const metadataName = String(item?.metadata?.sampleName || item?.metadata?.sampleRefName || '').trim();
            const looksLikeSessionId = /^sess_\d+$/i.test(primary);
            if (primary && !looksLikeSessionId) return primary;
            if (metadataName) return metadataName;
            return primary && !looksLikeSessionId ? primary : 'Untitled Essay';
        };
        const resolveOverallBand = (item = {}) => {
            const candidates = [
                item?.overallBand,
                item?.steps?.step4grade?.response?.json?.data?.overallBand,
                item?.steps?.step4grade?.response?.json?.data?.overall?.band
            ];
            for (const value of candidates) {
                if (value !== undefined && value !== null && String(value).trim() !== '') return value;
            }
            return 'N/A';
        };
        const resolveCriterionScores = (item = {}) => {
            const scoreCandidates = [
                item?.steps?.step4grade?.response?.json?.data?.scores,
                item?.scores,
                item?.summary?.scores,
                item?.steps?.step4grade?.response?.json?.data?.overall?.scores
            ];
            const gateTrace = item?.steps?.step4grade?.response?.json?.data?.meta?.gateTrace || {};
            scoreCandidates.push({
                TR: gateTrace?.TR?.resultingCriterionScore,
                CC: gateTrace?.CC?.resultingCriterionScore,
                LR: gateTrace?.LR?.resultingCriterionScore,
                GRA: gateTrace?.GRA?.resultingCriterionScore
            });

            const normalizeScore = (value) => {
                if (value === undefined || value === null || String(value).trim() === '') return null;
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : null;
            };

            for (const candidate of scoreCandidates) {
                if (!candidate || typeof candidate !== 'object') continue;
                const TR = normalizeScore(candidate?.TR);
                const CC = normalizeScore(candidate?.CC);
                const LR = normalizeScore(candidate?.LR);
                const GRA = normalizeScore(candidate?.GRA);
                if ([TR, CC, LR, GRA].some((score) => score !== null)) {
                    return { TR, CC, LR, GRA };
                }
            }

            return { TR: null, CC: null, LR: null, GRA: null };
        };
        const resolveExaminerBand = (item = {}) => {
            const candidates = [
                item?.examinerBandScore,
                item?.metadata?.examinerBandScore,
                item?.steps?.step1freeze?.response?.json?.meta?.sampleBandScore
            ];
            for (const value of candidates) {
                if (value !== undefined && value !== null && String(value).trim() !== '') return value;
            }
            return null;
        };
        const resolveStep3ModelUsed = (item = {}) => {
            const candidates = [
                item?.step3ModelUsed,
                item?.steps?.step3extract?.response?.json?.meta?.modelUsed,
                item?.steps?.step3extract?.response?.json?.meta?.selectedModel,
                item?.steps?.step3extract?.response?.json?.meta?.providerModel,
                item?.uiState?.selectedModels?.step3,
                item?.researchConfig?.selectedModels?.step3
            ];
            for (const value of candidates) {
                const txt = String(value || '').trim();
                if (txt) return txt;
            }
            return '';
        };
        const resolveStep4ModelUsed = (item = {}) => {
            const candidates = [
                item?.step4ModelUsed,
                item?.steps?.step4grade?.response?.json?.data?.meta?.modelUsed,
                item?.steps?.step4grade?.response?.json?.data?.meta?.selectedModel,
                item?.steps?.step4grade?.request?.payload?.modelId,
                item?.uiState?.selectedModels?.step4,
                item?.researchConfig?.selectedModels?.step4
            ];
            for (const value of candidates) {
                const txt = String(value || '').trim();
                if (txt) return txt;
            }
            return '';
        };
        const resolveStep5ModelUsed = (item = {}) => {
            const candidates = [
                item?.step5ModelUsed,
                item?.steps?.step5feedback?.response?.json?.data?.meta?.modelUsed,
                item?.steps?.step5feedback?.request?.payload?.modelId,
                item?.uiState?.selectedModels?.step5,
                item?.researchConfig?.selectedModels?.step5
            ];
            for (const value of candidates) {
                const txt = String(value || '').trim();
                if (txt) return txt;
            }
            return '';
        };
        const hasSuccessfulStep3 = (item = {}) => (
            String(item?.steps?.step3extract?.response?.json?.status || '').trim().toLowerCase() === 'success'
        );

        const taggedHistory = await Promise.all((Array.isArray(history) ? history : []).map(async (item) => {
            const id = String(item?.id || item?.sessionId || '').trim();
            let pipelineMode = normalizePipelineMode(item?.pipelineMode || item?.researchConfig?.pipelineMode || item?.metadata?.pipelineMode);
            let scoringView = normalizeScoringView(
                item?.uiState?.scoringView ||
                item?.scoringView ||
                item?.researchConfig?.scoringView ||
                item?.metadata?.scoringView ||
                null
            );
            let status = String(item?.status || '').trim();
            if (isSessionCompleteForPipeline(item, pipelineMode)) {
                status = 'Complete';
            } else if (!status) {
                status = 'In Progress';
            }

            // Backward-compatible fix for old rows without pipelineMode and stale status.
            const looksLegacyScoringView = normalizeScoringView(item?.scoringView) === 'scoringV0225';
            const shouldHydrateLegacyRow = String(req?.query?.hydrateLegacy || '').trim() === '1';
            if (shouldHydrateLegacyRow && id && (!item?.pipelineMode || status !== 'Complete' || !item?.scoringView || looksLegacyScoringView)) {
                try {
                    const session = await ieltsService.getDataById(
                        'scoringHistory',
                        id,
                        req.user,
                        buildScoringHistoryAccessContext(req, OPERATIONS.READ)
                    );
                    if (session) {
                        pipelineMode = normalizePipelineMode(session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode || pipelineMode);
                        scoringView = normalizeScoringView(
                            session?.uiState?.scoringView ||
                            session?.scoringView ||
                            session?.researchConfig?.scoringView ||
                            session?.metadata?.scoringView ||
                            scoringView
                        );
                        if (isSessionCompleteForPipeline(session, pipelineMode)) {
                            status = 'Complete';
                        } else if (!status) {
                            status = 'In Progress';
                        }
                    }
                } catch (_) {}
            }
            return {
                ...item,
                id,
                sampleId: item?.sampleId || item?.metadata?.sampleId || '',
                sampleName: resolveSampleName(item),
                savedAt: resolveSavedAt(item),
                overallBand: resolveOverallBand(item),
                criterionScores: resolveCriterionScores(item),
                examinerBandScore: resolveExaminerBand(item),
                pipelineMode,
                pipelineLabel: getPipelineLabel(pipelineMode),
                scoringView,
                scoringViewLabel: `${scoringView}.ejs`,
                status,
                loadUrl: getLoadUrlForPipeline(pipelineMode, item?.id || item?.sessionId || '', scoringView),
                step3ModelUsed: resolveStep3ModelUsed(item),
                step4ModelUsed: resolveStep4ModelUsed(item),
                step5ModelUsed: resolveStep5ModelUsed(item),
                step3HasSuccessfulExtraction: hasSuccessfulStep3(item),
                runCategory: resolveRunCategoryFromSession(item),
                isArchived: (
                    item?.isArchived === true ||
                    String(item?.isArchived || '').trim().toLowerCase() === 'true' ||
                    item?.metadata?.isArchived === true ||
                    String(item?.metadata?.isArchived || '').trim().toLowerCase() === 'true'
                )
            };
        }));
        const data = (isStep3PickerMode && pickerSampleId)
            ? taggedHistory.filter((row) => String(row?.sampleId || '').trim() === pickerSampleId && row?.step3HasSuccessfulExtraction === true)
            : taggedHistory;
        const dataWithCategory = data.map((row) => {
            const category = row?.runCategory || null;
            return {
                ...row,
                runCategoryAssigned: Boolean(category?.assigned),
                runCategoryKey: String(category?.key || '').trim(),
                runCategoryLabel: String(category?.label || '').trim(),
                runCategoryColor: normalizeRunCategoryColor(category?.color, ''),
                rowStyle: buildRunCategoryRowStyle(category?.color)
            };
        });
        const categoryOptionsMap = new Map();
        dataWithCategory.forEach((row) => {
            const key = String(row?.runCategoryKey || '').trim();
            const color = normalizeRunCategoryColor(row?.runCategoryColor, '');
            if (!key || !color) return;
            if (categoryOptionsMap.has(key)) return;
            categoryOptionsMap.set(key, {
                key,
                label: String(row?.runCategoryLabel || '').trim() || key,
                color
            });
        });
        if (runCategoryFilter !== 'all' && runCategoryFilter !== 'uncategorized' && !categoryOptionsMap.has(runCategoryFilter)) {
            categoryOptionsMap.set(runCategoryFilter, {
                key: runCategoryFilter,
                label: runCategoryFilter,
                color: ''
            });
        }
        const runCategoryOptions = Array.from(categoryOptionsMap.values())
            .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
        const searchableFields = scoringHistorySearchableFields;
        const pagination = {
            currentPage,
            totalPages,
            totalItems,
            limit,
            startItem: totalItems > 0 ? ((currentPage - 1) * limit) + 1 : 0,
            endItem: totalItems > 0 ? Math.min(currentPage * limit, totalItems) : 0
        };

        if (req.headers['x-ajax-request']) {
            return res.json({
                status: 'success',
                data: dataWithCategory,
                pagination,
                resultType: typeFilter,
                searchableFields,
                runCategoryOptions,
                filters: {
                    runCategory: runCategoryFilter
                }
            });
        }

        const pageTitle = archiveViewFilter === 'archived' ? 'Archived Scoring History' : 'Scoring History';
        res.render('ielts/scoringHistory', {
            title: pageTitle,
            data: dataWithCategory,
            searchableFields,
            newUrl: 'ielts/scoring/history', // Base for Start New
            newLabel: 'Start New Scoring',
            tableName: 'Saved Sessions',
            includeModal: true,
            includeModal_Table: true,
            includeModal_FileImport: true,
            print: true,
            pagination,
            filters: {
                ...req.query,
                resultType: typeFilter,
                scoringView: scoringViewFilter,
                runCategory: runCategoryFilter,
                archiveView: archiveViewFilter
            },
            runCategoryOptions,
            isSuperUser: adminChekersService.isSuperAdmin(req.user),
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
        res.status(500).render('error', { error, user: req.user });
    }
};

// 2. SAVE SESSION (API)
exports.saveScoringSession = async (req, res) => {
    try {
        const sessionData = req.body && typeof req.body === 'object' ? { ...req.body } : null;
        
        // Basic validation
        if (!sessionData || !sessionData.schema) {
            throw new Error("Invalid session data format.");
        }

        // Add user info if needed
        sessionData.userId = req.user ? req.user.id : 'anonymous';
        const pipelineModeForSave = normalizePipelineMode(
            sessionData?.pipelineMode ||
            sessionData?.researchConfig?.pipelineMode ||
            sessionData?.metadata?.pipelineMode
        );
        sessionData.pipelineMode = pipelineModeForSave;
        sessionData.status = isSessionCompleteForPipeline(sessionData, pipelineModeForSave)
            ? 'Complete'
            : 'In Progress';
        const requestedSessionId = String(
            sessionData.sessionId ||
            sessionData.id ||
            ''
        ).trim();

        let result = null;
        let mode = 'created';

        if (requestedSessionId) {
            const existing = await ieltsService.getDataById(
                'scoringHistory',
                requestedSessionId,
                req.user,
                buildScoringHistoryAccessContext(req, OPERATIONS.READ)
            );
            if (existing) {
                const existingArchived = (
                    existing?.isArchived === true ||
                    String(existing?.isArchived || '').trim().toLowerCase() === 'true' ||
                    existing?.metadata?.isArchived === true ||
                    String(existing?.metadata?.isArchived || '').trim().toLowerCase() === 'true'
                );
                if (sessionData.isArchived === undefined) {
                    sessionData.isArchived = existingArchived;
                }
                const existingMetadata = existing?.metadata && typeof existing.metadata === 'object'
                    ? existing.metadata
                    : {};
                const incomingMetadata = sessionData?.metadata && typeof sessionData.metadata === 'object'
                    ? sessionData.metadata
                    : {};
                sessionData.metadata = {
                    ...existingMetadata,
                    ...incomingMetadata
                };
                if (!Object.prototype.hasOwnProperty.call(incomingMetadata, 'isArchived')) {
                    sessionData.metadata.isArchived = sessionData.isArchived === true;
                }
                if (!Object.prototype.hasOwnProperty.call(incomingMetadata, 'runCategory') && existingMetadata?.runCategory) {
                    sessionData.metadata.runCategory = existingMetadata.runCategory;
                }
                if (sessionData.runCategoryAssigned === undefined && existing?.runCategoryAssigned !== undefined) {
                    sessionData.runCategoryAssigned = existing.runCategoryAssigned;
                }
                if (!String(sessionData.runCategoryKey || '').trim() && String(existing?.runCategoryKey || '').trim()) {
                    sessionData.runCategoryKey = existing.runCategoryKey;
                }
                if (!String(sessionData.runCategoryLabel || '').trim() && String(existing?.runCategoryLabel || '').trim()) {
                    sessionData.runCategoryLabel = existing.runCategoryLabel;
                }
                if (!String(sessionData.runCategoryColor || '').trim() && String(existing?.runCategoryColor || '').trim()) {
                    sessionData.runCategoryColor = existing.runCategoryColor;
                }
                if ((!sessionData.runCategory || typeof sessionData.runCategory !== 'object') && existing?.runCategory && typeof existing.runCategory === 'object') {
                    sessionData.runCategory = existing.runCategory;
                }
                result = await ieltsService.updateData(
                    'scoringHistory',
                    requestedSessionId,
                    {
                        ...sessionData,
                        id: requestedSessionId,
                        sessionId: requestedSessionId
                    },
                    req.user,
                    buildScoringHistoryAccessContext(req, OPERATIONS.UPDATE)
                );
                mode = 'updated';
            } else {
                result = await ieltsService.addData(
                    'scoringHistory',
                    {
                        ...sessionData,
                        isArchived: sessionData.isArchived === true,
                        id: requestedSessionId,
                        sessionId: requestedSessionId
                    },
                    req.user,
                    buildScoringHistoryAccessContext(req, OPERATIONS.CREATE)
                );
                mode = 'created';
            }
        } else {
            result = await ieltsService.addData(
                'scoringHistory',
                {
                    ...sessionData,
                    isArchived: sessionData.isArchived === true
                },
                req.user,
                buildScoringHistoryAccessContext(req, OPERATIONS.CREATE)
            );
            mode = 'created';
        }

        const savedId = String(result?.id || result?.sessionId || requestedSessionId || '').trim();
        res.json({ status: 'success', id: savedId, mode });

    } catch (error) {
        console.error("Save Session Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// 3. GET SINGLE SESSION (API)
exports.getScoringSession = async (req, res) => {
    try {
        const id = req.params.id;
        const session = await ieltsService.getDataById(
            'scoringHistory',
            id,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.READ)
        );

        if (!session) {
            return res.status(404).json({ status: 'error', message: "Session not found." });
        }

        res.json(session);

    } catch (error) {
        console.error("Get Session Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// 4. DELETE SESSION (API)
exports.deleteScoringSession = async (req, res) => {
    try {
        const id = req.params.id;
        await ieltsService.deleteData(
            'scoringHistory',
            id,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.DELETE)
        );
        res.json({ status: 'success', message: "Session deleted." });

    } catch (error) {
        console.error("Delete Session Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// 4.b DELETE MULTIPLE SESSIONS (API)
exports.deleteScoringSessionsBulk = async (req, res) => {
    try {
        const rawIds = Array.isArray(req?.body?.ids) ? req.body.ids : [];
        const ids = Array.from(
            new Set(
                rawIds
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )
        );

        if (!ids.length) {
            return res.status(400).json({
                status: 'error',
                message: 'Select at least one session to delete.'
            });
        }

        let deletedCount = 0;
        const failed = [];
        for (const id of ids) {
            try {
                await ieltsService.deleteData(
                    'scoringHistory',
                    id,
                    req.user,
                    buildScoringHistoryAccessContext(req, OPERATIONS.DELETE)
                );
                deletedCount += 1;
            } catch (error) {
                failed.push({
                    id,
                    message: error?.message || 'Delete failed.'
                });
            }
        }

        if (deletedCount === 0) {
            return res.status(500).json({
                status: 'error',
                message: failed[0]?.message || 'No selected sessions were deleted.',
                deletedCount,
                failed
            });
        }

        const failedCount = failed.length;
        const message = failedCount > 0
            ? `${deletedCount} session${deletedCount === 1 ? '' : 's'} deleted. ${failedCount} failed.`
            : `${deletedCount} session${deletedCount === 1 ? '' : 's'} deleted successfully.`;

        return res.json({
            status: 'success',
            message,
            deletedCount,
            failed
        });
    } catch (error) {
        console.error('Bulk Delete Sessions Error:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

async function setScoringSessionArchiveState(req, res, shouldArchive = true) {
    try {
        const id = String(req?.body?.id || req?.params?.id || '').trim();
        if (!id) {
            return res.status(400).json({ status: 'error', message: 'A session id is required.' });
        }

        const session = await ieltsService.getDataById(
            'scoringHistory',
            id,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.READ)
        );
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found or not accessible.' });
        }

        const nowIso = new Date().toISOString();
        const actorId = String(req?.user?.id || req?.user?.username || 'system').trim();
        const updatedPayload = buildScoringHistoryArchivePayload(session, id, shouldArchive, actorId, nowIso);

        await ieltsService.updateData(
            'scoringHistory',
            id,
            updatedPayload,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.UPDATE)
        );

        const actionLabel = shouldArchive ? 'archived' : 'restored';
        return res.json({
            status: 'success',
            id,
            isArchived: shouldArchive,
            message: `Session ${actionLabel} successfully.`
        });
    } catch (error) {
        console.error('Set Scoring Session Archive State Error:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
}

function buildScoringHistoryArchivePayload(session, id, shouldArchive, actorId, nowIso) {
    const metadata = session?.metadata && typeof session.metadata === 'object'
        ? { ...session.metadata }
        : {};
    metadata.isArchived = shouldArchive;
    if (shouldArchive) {
        metadata.archivedAt = nowIso;
        metadata.archivedBy = actorId;
    } else {
        metadata.restoredAt = nowIso;
        metadata.restoredBy = actorId;
    }

    const updatedPayload = {
        ...session,
        id,
        sessionId: id,
        isArchived: shouldArchive,
        metadata
    };
    if (shouldArchive) {
        updatedPayload.archivedAt = nowIso;
        updatedPayload.archivedBy = actorId;
    } else {
        updatedPayload.restoredAt = nowIso;
        updatedPayload.restoredBy = actorId;
    }

    return updatedPayload;
}

// 4.c ARCHIVE SESSION (API)
exports.archiveScoringSession = async (req, res) => setScoringSessionArchiveState(req, res, true);

// 4.d RESTORE SESSION (API)
exports.unarchiveScoringSession = async (req, res) => setScoringSessionArchiveState(req, res, false);

async function setScoringSessionsArchiveStateBulk(req, res, shouldArchive = true) {
    try {
        const rawIds = Array.isArray(req?.body?.ids) ? req.body.ids : [];
        const ids = Array.from(
            new Set(
                rawIds
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )
        );

        if (ids.length < 2) {
            return res.status(400).json({
                status: 'error',
                message: 'Please select at least 2 sessions.'
            });
        }

        const nowIso = new Date().toISOString();
        const actorId = String(req?.user?.id || req?.user?.username || 'system').trim();
        let updatedCount = 0;
        const failed = [];

        for (const id of ids) {
            try {
                const session = await ieltsService.getDataById(
                    'scoringHistory',
                    id,
                    req.user,
                    buildScoringHistoryAccessContext(req, OPERATIONS.READ)
                );
                if (!session) throw new Error('Session not found or not accessible.');

                const updatedPayload = buildScoringHistoryArchivePayload(session, id, shouldArchive, actorId, nowIso);
                await ieltsService.updateData(
                    'scoringHistory',
                    id,
                    updatedPayload,
                    req.user,
                    buildScoringHistoryAccessContext(req, OPERATIONS.UPDATE)
                );
                updatedCount += 1;
            } catch (error) {
                failed.push({
                    id,
                    message: error?.message || 'Archive state update failed.'
                });
            }
        }

        if (updatedCount === 0) {
            return res.status(500).json({
                status: 'error',
                message: failed[0]?.message || 'No selected sessions were updated.',
                updatedCount,
                failed
            });
        }

        const failedCount = failed.length;
        const actionWord = shouldArchive ? 'archived' : 'restored';
        const message = failedCount > 0
            ? `${updatedCount} session${updatedCount === 1 ? '' : 's'} ${actionWord}. ${failedCount} failed.`
            : `${updatedCount} session${updatedCount === 1 ? '' : 's'} ${actionWord} successfully.`;

        return res.json({
            status: 'success',
            message,
            updatedCount,
            failed,
            isArchived: shouldArchive
        });
    } catch (error) {
        console.error('Bulk Archive State Update Error:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
}

// 4.e ARCHIVE MULTIPLE SESSIONS (API)
exports.archiveScoringSessionsBulk = async (req, res) => setScoringSessionsArchiveStateBulk(req, res, true);

// 4.f RESTORE MULTIPLE SESSIONS (API)
exports.unarchiveScoringSessionsBulk = async (req, res) => setScoringSessionsArchiveStateBulk(req, res, false);

// 4.g ASSIGN CATEGORY TO MULTIPLE SESSIONS (API)
exports.assignScoringSessionsCategoryBulk = async (req, res) => {
    try {
        const rawIds = Array.isArray(req?.body?.ids) ? req.body.ids : [];
        const ids = Array.from(new Set(
            rawIds
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        ));

        if (!ids.length) {
            return res.status(400).json({
                status: 'error',
                message: 'Please select at least one session.'
            });
        }

        const shouldClear = req?.body?.clear === true || String(req?.body?.mode || '').trim().toLowerCase() === 'clear';
        const normalizedColor = normalizeRunCategoryColor(req?.body?.color, '');
        const normalizedLabel = normalizeRunCategoryLabel(req?.body?.label, '');
        if (!shouldClear) {
            if (!normalizedColor) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Please select a valid category color.'
                });
            }
            if (!normalizedLabel) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Please enter a category label.'
                });
            }
        }

        const nowIso = new Date().toISOString();
        const actorId = String(req?.user?.id || req?.user?.username || 'system').trim();
        let updatedCount = 0;
        const failed = [];

        for (const id of ids) {
            try {
                const session = await ieltsService.getDataById(
                    'scoringHistory',
                    id,
                    req.user,
                    buildScoringHistoryAccessContext(req, OPERATIONS.READ)
                );
                if (!session) throw new Error('Session not found or not accessible.');

                const payload = buildScoringHistoryCategoryPayload(
                    session,
                    id,
                    shouldClear
                        ? { clear: true }
                        : { color: normalizedColor, label: normalizedLabel },
                    actorId,
                    nowIso
                );
                await ieltsService.updateData(
                    'scoringHistory',
                    id,
                    payload,
                    req.user,
                    buildScoringHistoryAccessContext(req, OPERATIONS.UPDATE)
                );
                updatedCount += 1;
            } catch (error) {
                failed.push({
                    id,
                    message: error?.message || 'Category update failed.'
                });
            }
        }

        if (updatedCount === 0) {
            return res.status(500).json({
                status: 'error',
                message: failed[0]?.message || 'No selected sessions were updated.',
                updatedCount,
                failed
            });
        }

        const failedCount = failed.length;
        const actionLabel = shouldClear ? 'category cleared' : 'categorized';
        const successLabel = shouldClear ? 'category cleared successfully' : 'categorized successfully';
        const message = failedCount > 0
            ? `${updatedCount} session${updatedCount === 1 ? '' : 's'} ${actionLabel}. ${failedCount} failed.`
            : `${updatedCount} session${updatedCount === 1 ? '' : 's'} ${successLabel}.`;

        return res.json({
            status: 'success',
            message,
            updatedCount,
            failed,
            cleared: shouldClear,
            category: shouldClear
                ? null
                : {
                    assigned: true,
                    key: buildRunCategoryKey(normalizedLabel, normalizedColor),
                    label: normalizedLabel,
                    color: normalizedColor
                }
        });
    } catch (error) {
        console.error('Bulk Category Assignment Error:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

// 5. DUPLICATE SESSION WITH SYNTHETIC TIMINGS (SUPERUSER ONLY)
exports.duplicateScoringSessionSynthetic = async (req, res) => {
    try {
        if (!adminChekersService.isSuperAdmin(req.user)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only superusers can create synthetic scoring copies.'
            });
        }

        const sourceSessionId = String(req.body?.sessionId || req.body?.id || '').trim();
        const copyCountRaw = req.body?.copies ?? req.body?.count ?? 1;
        const copyCount = parseSyntheticCopyCount(copyCountRaw, 1);

        if (!sourceSessionId) {
            return res.status(400).json({ status: 'error', message: 'A source session id is required.' });
        }
        if (!Number.isFinite(copyCount) || copyCount < 1 || copyCount > 100) {
            return res.status(400).json({ status: 'error', message: 'Copy count must be between 1 and 100.' });
        }

        const sourceSession = await ieltsService.getDataById(
            'scoringHistory',
            sourceSessionId,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.READ)
        );
        if (!sourceSession) {
            return res.status(404).json({ status: 'error', message: 'Source session not found or not accessible.' });
        }
        const sourcePipelineMode = normalizePipelineMode(
            sourceSession?.pipelineMode ||
            sourceSession?.researchConfig?.pipelineMode ||
            sourceSession?.metadata?.pipelineMode
        );
        if (sourcePipelineMode !== 'full') {
            return res.status(400).json({
                status: 'error',
                message: 'Synthetic copies are available for Full Pipeline sessions only.'
            });
        }

        const nowMs = Date.now();
        const created = [];
        for (let i = 1; i <= copyCount; i += 1) {
            const clonedPayload = buildSyntheticScoringHistoryCopy(sourceSession, {
                copyIndex: i,
                totalCopies: copyCount,
                nowMs
            });
            clonedPayload.isArchived = false;
            if (!clonedPayload.metadata || typeof clonedPayload.metadata !== 'object') clonedPayload.metadata = {};
            clonedPayload.metadata.isArchived = false;

            const saved = await ieltsService.addData(
                'scoringHistory',
                clonedPayload,
                req.user,
                buildScoringHistoryAccessContext(req, OPERATIONS.CREATE)
            );

            created.push({
                id: String(saved?.id || saved?.sessionId || '').trim(),
                savedAt: saved?.savedAt || clonedPayload?.savedAt || null
            });
        }

        return res.json({
            status: 'success',
            message: `${created.length} synthetic ${created.length === 1 ? 'copy' : 'copies'} created successfully.`,
            sourceSessionId,
            created
        });
    } catch (error) {
        console.error('Synthetic duplicate session error:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

// 6. CREATE A NEW SESSION PRE-COMPLETED UP TO STEP N
exports.cloneScoringSessionUpToStep = async (req, res) => {
    try {
        const sourceSessionId = String(req.body?.sessionId || req.body?.id || '').trim();
        const upToStep = parsePartialCloneUpToStep(req.body?.upToStep ?? req.body?.step ?? 1, 1);

        if (!sourceSessionId) {
            return res.status(400).json({ status: 'error', message: 'A source session id is required.' });
        }
        if (!Number.isFinite(upToStep) || upToStep < 1 || upToStep > 4) {
            return res.status(400).json({ status: 'error', message: 'Target step must be between 1 and 4.' });
        }

        const sourceSession = await ieltsService.getDataById(
            'scoringHistory',
            sourceSessionId,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.READ)
        );
        if (!sourceSession) {
            return res.status(404).json({ status: 'error', message: 'Source session not found or not accessible.' });
        }

        const sourcePipelineMode = normalizePipelineMode(
            sourceSession?.pipelineMode ||
            sourceSession?.researchConfig?.pipelineMode ||
            sourceSession?.metadata?.pipelineMode
        );
        if (sourcePipelineMode !== 'full') {
            return res.status(400).json({
                status: 'error',
                message: 'Create-up-to-step is currently available for Full Pipeline sessions only.'
            });
        }
        const requiredSteps = SCORING_PARTIAL_CLONE_PRIMARY_STEPS.slice(0, upToStep);
        const firstMissingStep = requiredSteps.find((stepKey) => (
            String(sourceSession?.steps?.[stepKey]?.response?.json?.status || '').trim().toLowerCase() !== 'success'
        ));
        if (firstMissingStep) {
            return res.status(400).json({
                status: 'error',
                message: `Source session is missing a completed ${firstMissingStep} result. Choose a lower step or a more complete session.`
            });
        }

        const clonedPayload = cloneAsJson(sourceSession);
        if (!clonedPayload || typeof clonedPayload !== 'object') {
            throw new Error('Selected scoring session is invalid for cloning.');
        }

        trimSessionToStepInPlace(clonedPayload, upToStep);

        const savedAtIso = new Date().toISOString();
        clonedPayload.savedAt = savedAtIso;
        clonedPayload.isArchived = false;
        clonedPayload.id = null;
        clonedPayload.sessionId = null;
        delete clonedPayload._id;

        clonedPayload.metadata = clonedPayload.metadata && typeof clonedPayload.metadata === 'object'
            ? clonedPayload.metadata
            : {};
        clonedPayload.metadata.savedAt = savedAtIso;
        clonedPayload.metadata.isComplete = false;
        clonedPayload.metadata.isArchived = false;
        clonedPayload.metadata.partialClone = true;
        clonedPayload.metadata.partialCloneSourceSessionId = sourceSessionId;
        clonedPayload.metadata.partialCloneUpToStep = upToStep;

        clonedPayload.researchConfig = clonedPayload.researchConfig && typeof clonedPayload.researchConfig === 'object'
            ? clonedPayload.researchConfig
            : {};
        clonedPayload.researchConfig.updatedAt = savedAtIso;

        const saved = await ieltsService.addData(
            'scoringHistory',
            clonedPayload,
            req.user,
            buildScoringHistoryAccessContext(req, OPERATIONS.CREATE)
        );

        const savedId = String(saved?.id || saved?.sessionId || '').trim();
        const loadUrl = savedId ? `/ielts/scoringV0326?loadId=${encodeURIComponent(savedId)}` : '/ielts/scoringV0326';

        return res.json({
            status: 'success',
            message: `A new session was created with Steps 1 to ${upToStep} pre-completed.`,
            id: savedId,
            upToStep,
            loadUrl
        });
    } catch (error) {
        console.error('Clone scoring session up-to-step error:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

function toPositiveInt(value, fallback = 1) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function extractStepStabilityMeta(session, stepKey) {
    if (stepKey === 'step3extract') {
        return (
            session?.steps?.step3stability?.response?.json?.data ||
            session?.steps?.step3extract?.response?.json?.meta?.stabilityGate ||
            null
        );
    }
    if (stepKey === 'step4grade') {
        return (
            session?.steps?.step4stability?.response?.json?.data ||
            session?.steps?.step4grade?.response?.json?.data?.meta?.stabilityGate ||
            null
        );
    }
    return null;
}

function normalizeExecutionModeToken(value) {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'single_run' || token === 'stability_gate_auto_consensus') return token;
    return '';
}

function deriveStepRunProfileFromMeta(requestMeta = {}, stabilityMeta = null, fallbackRunCount = 1) {
    const metrics = stabilityMeta?.metrics || {};
    const stabilityRunCount = toPositiveInt(metrics?.runCount ?? stabilityMeta?.runCount, fallbackRunCount);
    const stabilityEnabled = Boolean(stabilityMeta && (
        stabilityMeta?.enabled === true ||
        stabilityMeta?.autoConsensus === true ||
        stabilityRunCount >= 2
    ));
    if (stabilityEnabled) {
        return {
            mode: 'stability_gate_auto_consensus',
            runCount: Math.max(2, stabilityRunCount),
            usedThreeRuns: Math.max(2, stabilityRunCount) >= 3
        };
    }

    const modeToken = normalizeExecutionModeToken(requestMeta?.mode);
    if (modeToken === 'single_run') {
        return { mode: 'single_run', runCount: 1, usedThreeRuns: false };
    }
    if (modeToken === 'stability_gate_auto_consensus') {
        const requestRunCount = Math.max(2, toPositiveInt(requestMeta?.runCount, 2));
        return {
            mode: 'stability_gate_auto_consensus',
            runCount: requestRunCount,
            usedThreeRuns: requestRunCount >= 3
        };
    }

    const requestRunCount = toPositiveInt(requestMeta?.runCount, fallbackRunCount);
    const mode = requestRunCount >= 3 ? 'stability_gate_auto_consensus' : 'single_run';
    const runCount = mode === 'single_run' ? 1 : Math.max(2, requestRunCount);
    return {
        mode,
        runCount,
        usedThreeRuns: runCount >= 3
    };
}

function extractStepRunProfile(session, stepKey) {
    const reqMeta = session?.steps?.[stepKey]?.request || {};
    const stabilityMeta = extractStepStabilityMeta(session, stepKey) || null;
    return deriveStepRunProfileFromMeta(reqMeta, stabilityMeta, 1);
}

function normalizeUnstableRows(stepKey, rows = []) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
        if (stepKey === 'step3extract') {
            return {
                key: String(row?.key || '-'),
                criterion: String(row?.criterion || '-'),
                runValues: Array.isArray(row?.runValues) ? row.runValues.map((v) => String(v ?? '-')) : [],
                consensusValue: String(row?.consensusValue || row?.majorityValue || '-'),
                changed: Boolean(row?.changed),
                tie: Boolean(row?.tie)
            };
        }
        return {
            key: String(row?.key || row?.itemKey || row?.baseKey || '-'),
            criterion: String(row?.criterion || '-'),
            runValues: Array.isArray(row?.runValues) ? row.runValues.map((v) => String(v ?? '-')) : [],
            consensusValue: String(row?.majorityValue || row?.consensusValue || '-'),
            changed: Boolean(row?.changed),
            tie: Boolean(row?.tie)
        };
    });
}

function normalizeStep3SignalRows(rows = []) {
    if (!Array.isArray(rows)) return [];
    return rows
        .map((row) => ({
            key: String(row?.key || '-'),
            criterion: String(row?.criterion || 'GENERAL').trim().toUpperCase(),
            runValues: Array.isArray(row?.runValues) ? row.runValues.map((v) => String(v ?? '-')) : [],
            consensusValue: String(row?.consensusValue || row?.majorityValue || '-'),
            changed: Boolean(row?.changed),
            tie: Boolean(row?.tie)
        }))
        .filter((row) => row.key && row.key !== '-');
}

function getStep4Rows(session = {}) {
    const step4 = session?.steps?.step4grade?.response?.json?.data || {};
    if (Array.isArray(step4?.aggregatedResults) && step4.aggregatedResults.length > 0) {
        return step4.aggregatedResults;
    }
    if (Array.isArray(step4?.results)) return step4.results;
    return [];
}

function normalizeQuestionKey(row = {}) {
    return String(row?.baseKey || row?.question_key || row?.instanceKey || '').trim();
}

function buildQuestionCatalog(session = {}) {
    const rows = getStep4Rows(session);
    const map = new Map();
    for (const row of rows) {
        const key = normalizeQuestionKey(row);
        if (!key) continue;
        if (!map.has(key)) {
            map.set(key, {
                key,
                criterion: String(row?.criterion || 'General').trim().toUpperCase(),
                band: Number.isFinite(Number(row?.band)) ? Number(row.band) : null,
                atomicQuestion: String(row?.atomic_question || '').trim(),
                value: String(row?.value ?? row?.result ?? row?.score ?? '').trim()
            });
        }
    }
    return Array.from(map.values());
}

function buildThreeRunFluctuationRecord(session, options = {}) {
    const sessionId = String(session?.sessionId || session?.id || '').trim();
    if (!sessionId) return null;

    const sampleName = session?.metadata?.sampleName || 'Untitled Sample';
    const sampleRefName = session?.metadata?.sampleRefName || '';
    const savedAt = session?.savedAt || null;
    const step4Data = session?.steps?.step4grade?.response?.json?.data || {};
    const overallBand = step4Data?.overallBand ?? null;
    const pipelineMode = normalizePipelineMode(session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode);
    const scoringView = normalizeScoringView(
        session?.uiState?.scoringView ||
        session?.scoringView ||
        session?.researchConfig?.scoringView ||
        session?.metadata?.scoringView
    );
    const examinerBand =
        session?.metadata?.examinerBandScore ??
        session?.steps?.step1freeze?.response?.json?.meta?.sampleBandScore ??
        null;

    const step3Profile = extractStepRunProfile(session, 'step3extract');
    const step4Profile = extractStepRunProfile(session, 'step4grade');
    const hasThreeRun = step3Profile.usedThreeRuns || step4Profile.usedThreeRuns;
    if (!hasThreeRun) return null;

    const step3Stability = extractStepStabilityMeta(session, 'step3extract') || {};
    const step4Stability = extractStepStabilityMeta(session, 'step4grade') || {};
    const step3Metrics = step3Stability?.metrics || {};
    const step4Metrics = step4Stability?.metrics || {};
    const questionCatalog = options?.includeQuestionCatalog ? buildQuestionCatalog(session) : [];
    const step4UnstableRows = normalizeUnstableRows('step4grade', step4Stability?.topUnstable || []);
    const step4UnstableKeys = Array.from(new Set(step4UnstableRows.map((row) => row.key).filter(Boolean)));
    const step3UnstableRows = normalizeUnstableRows('step3extract', step3Stability?.topUnstable || []);
    const step3AllSignalRows = normalizeStep3SignalRows(step3Stability?.allSignals || []);
    const uiState = session?.uiState && typeof session.uiState === 'object' ? session.uiState : {};
    const research = session?.researchConfig && typeof session.researchConfig === 'object' ? session.researchConfig : {};
    const selectedModels = (uiState?.selectedModels && typeof uiState.selectedModels === 'object')
        ? uiState.selectedModels
        : (research?.selectedModels && typeof research.selectedModels === 'object')
            ? research.selectedModels
            : {};
    const gradingSettings = (uiState?.gradingSettings && typeof uiState.gradingSettings === 'object')
        ? uiState.gradingSettings
        : {};
    const stabilityConfig = (uiState?.stabilityConfig && typeof uiState.stabilityConfig === 'object')
        ? uiState.stabilityConfig
        : (research?.stabilityConfig && typeof research.stabilityConfig === 'object')
            ? research.stabilityConfig
            : {};

    return {
        id: sessionId,
        sampleName,
        sampleRefName,
        savedAt,
        overallBand,
        examinerBand,
        pipelineMode,
        scoringView,
        loadUrl: getLoadUrlForPipeline(pipelineMode, sessionId, scoringView),
        strategy: {
            step3: step3Profile,
            step4: step4Profile,
            overall: (step3Profile.usedThreeRuns || step4Profile.usedThreeRuns)
                ? 'three_run_consensus'
                : 'single_run'
        },
        step3: {
            mode: step3Profile.mode,
            runCount: step3Profile.runCount,
            gatePassed: typeof step3Metrics?.gatePassed === 'boolean' ? step3Metrics.gatePassed : null,
            meanAgreement: step3Metrics?.meanAgreement ?? null,
            flipRate: step3Metrics?.flipRate ?? null,
            unstableCount: step3Metrics?.unstableCount ?? 0,
            totalCount: step3Metrics?.totalSignals ?? 0,
            topUnstable: step3UnstableRows,
            allSignals: step3AllSignalRows
        },
        step4: {
            mode: step4Profile.mode,
            runCount: step4Profile.runCount,
            gatePassed: typeof step4Metrics?.gatePassed === 'boolean' ? step4Metrics.gatePassed : null,
            meanAgreement: step4Metrics?.meanAgreement ?? null,
            flipRate: step4Metrics?.flipRate ?? null,
            unstableCount: step4Metrics?.unstableCount ?? 0,
            totalCount: step4Metrics?.totalItems ?? 0,
            topUnstable: step4UnstableRows,
            unstableKeys: step4UnstableKeys,
            questionCatalog
        },
        summary: {
            inconsistentQuestionCount: step4UnstableKeys.length
        },
        settings: {
            stabilityProfile: String(stabilityConfig?.profile || gradingSettings?.stabilityProfile || research?.stabilityProfile || 'standard').trim().toLowerCase() === 'strict' ? 'strict' : 'standard',
            step3RunCount: toPositiveInt(
                stabilityConfig?.step3?.runCount ?? gradingSettings?.step3RunCount ?? research?.step3RunCount ?? step3Profile.runCount,
                step3Profile.runCount
            ),
            step4RunCount: toPositiveInt(
                stabilityConfig?.step4?.runCount ?? gradingSettings?.step4RunCount ?? research?.step4RunCount ?? step4Profile.runCount,
                step4Profile.runCount
            ),
            step3Model: String(selectedModels?.step3 || '').trim(),
            step4Model: String(selectedModels?.step4 || '').trim(),
            step5Model: String(selectedModels?.step5 || '').trim(),
            step3PromptSource: String(research?.promptSources?.step3 || '').trim().toLowerCase(),
            step4PromptSource: String(research?.promptSources?.step4 || '').trim().toLowerCase(),
            step5PromptSource: String(research?.promptSources?.step5 || '').trim().toLowerCase(),
            batchSize: toPositiveInt(gradingSettings?.batchSize ?? research?.batchSize, 5),
            concurrency: toPositiveInt(gradingSettings?.concurrency ?? research?.concurrency, 2),
            gradingMode: String(gradingSettings?.mode || research?.mode || '').trim()
        }
    };
}

function toLower(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeHistoryTypeFilter(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'full') return 'full';
    if (normalized === 'step3_tuning') return 'step3_tuning';
    if (normalized === 'step4_tuning') return 'step4_tuning';
    return 'all';
}

function normalizeScoringViewFilter(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'scoringstandard' || normalized === 'standard' || normalized === 'scoring-standard' || normalized === 'scoringstandard.ejs') {
        return 'scoringStandard';
    }
    if (normalized === 'scoringv0326' || normalized === 'v0326' || normalized === 'scoringv0326.ejs') {
        return 'scoringV0326';
    }
    if (normalized === 'scoringv0323' || normalized === 'v0323' || normalized === 'scoringv0323.ejs') {
        return 'scoringV0323';
    }
    if (normalized === 'scoringv0225' || normalized === 'v0225' || normalized === 'scoringv0225.ejs') {
        return 'scoringV0225';
    }
    return 'all';
}

function normalizeArchiveViewFilter(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'archived' || normalized === 'archive') return 'archived';
    return 'active';
}

function normalizePipelineMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'step3_tuning') return 'step3_tuning';
    if (normalized === 'step4_tuning') return 'step4_tuning';
    return 'full';
}

function normalizeScoringView(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'scoringstandard' || normalized === 'standard' || normalized === 'scoring-standard') return 'scoringStandard';
    if (normalized === 'scoringv0326' || normalized === 'v0326') return 'scoringV0326';
    if (normalized === 'scoringv0323' || normalized === 'v0323') return 'scoringV0323';
    return 'scoringV0225';
}

function getPipelineLabel(mode) {
    const normalized = normalizePipelineMode(mode);
    if (normalized === 'step3_tuning') return 'Step 3 Tuning';
    if (normalized === 'step4_tuning') return 'Step 4 Tuning';
    return 'Full Pipeline';
}

function getLoadUrlForPipeline(mode, sessionId, scoringView = 'scoringV0225') {
    const id = encodeURIComponent(String(sessionId || ''));
    const normalized = normalizePipelineMode(mode);
    const view = normalizeScoringView(scoringView);
    if (normalized === 'step3_tuning') {
        if (view === 'scoringV0326') return `/ielts/scoringV0326/tuning/step3?loadId=${id}`;
        if (view === 'scoringV0323') return `/ielts/scoringV0323/tuning/step3?loadId=${id}`;
        return `/ielts/scoring/tuning/step3?loadId=${id}`;
    }
    if (normalized === 'step4_tuning') {
        if (view === 'scoringV0326') return `/ielts/scoringV0326/tuning/step4?loadId=${id}`;
        if (view === 'scoringV0323') return `/ielts/scoringV0323/tuning/step4?loadId=${id}`;
        return `/ielts/scoring/tuning/step4?loadId=${id}`;
    }
    if (view === 'scoringStandard') return `/ielts/scoring-standard?loadId=${id}`;
    return `/ielts/${view}?loadId=${id}`;
}

function isSessionCompleteForPipeline(session = {}, pipelineMode = 'full') {
    const isSuccess = (stepKey) => session?.steps?.[stepKey]?.response?.json?.status === 'success';
    const normalized = normalizePipelineMode(pipelineMode);
    if (normalized === 'step3_tuning') {
        return isSuccess('step1freeze') && isSuccess('step2analyze') && isSuccess('step3extract');
    }
    if (normalized === 'step4_tuning') {
        return isSuccess('step1freeze') && isSuccess('step2analyze') && isSuccess('step3extract') && isSuccess('step4grade');
    }
    return Boolean(session?.steps?.step6report) || (
        isSuccess('step1freeze') &&
        isSuccess('step2analyze') &&
        isSuccess('step3extract') &&
        isSuccess('step4grade') &&
        isSuccess('step5feedback')
    );
}

function isThreeRunFromSummary(summary = {}) {
    if (typeof summary?.isThreeRun === 'boolean') return summary.isThreeRun;
    const strategy = toLower(summary?.pipelineStrategy);
    if (strategy === 'three_run_consensus') return true;
    const step3RunCount = toPositiveInt(summary?.step3RunCount, 1);
    const step4RunCount = toPositiveInt(summary?.step4RunCount, 1);
    return step3RunCount >= 3 || step4RunCount >= 3;
}

function matchesHistoryQuery(item, q = '') {
    const query = toLower(q);
    if (!query) return true;
    return (
        toLower(item?.sampleName).includes(query) ||
        toLower(item?.sampleRefName).includes(query) ||
        toLower(item?.id).includes(query) ||
        toLower(item?.sampleId).includes(query)
    );
}

function buildThreeRunComparisonAnalysis(records = []) {
    const sessions = Array.isArray(records) ? records : [];
    const sessionIds = sessions.map((s) => s.id);
    const questionMap = new Map();
    const signalMap = new Map();

    for (const session of sessions) {
        const catalog = Array.isArray(session?.step4?.questionCatalog) ? session.step4.questionCatalog : [];
        const unstableKeys = new Set(Array.isArray(session?.step4?.unstableKeys) ? session.step4.unstableKeys : []);

        for (const item of catalog) {
            const key = String(item?.key || '').trim();
            if (!key) continue;
            if (!questionMap.has(key)) {
                questionMap.set(key, {
                    key,
                    criterion: String(item?.criterion || 'General').trim().toUpperCase(),
                    atomicQuestion: String(item?.atomicQuestion || '').trim(),
                    perSession: {},
                    perSessionValue: {},
                    totalOccurrences: 0
                });
            }
            const entry = questionMap.get(key);
            const normalizedValue = String(item?.value ?? '').trim();
            if (normalizedValue) {
                entry.perSessionValue[session.id] = normalizedValue;
            }
        }

        for (const unstableKey of unstableKeys) {
            const key = String(unstableKey || '').trim();
            if (!key) continue;
            if (!questionMap.has(key)) {
                questionMap.set(key, {
                    key,
                    criterion: 'General',
                    atomicQuestion: '',
                    perSession: {},
                    perSessionValue: {},
                    totalOccurrences: 0
                });
            }
        }

        for (const [key, entry] of questionMap.entries()) {
            const hit = unstableKeys.has(key) ? 1 : 0;
            entry.perSession[session.id] = hit;
        }

        const signalRows = Array.isArray(session?.step3?.allSignals) ? session.step3.allSignals : [];
        for (const row of signalRows) {
            const key = String(row?.key || '').trim();
            if (!key) continue;
            if (!signalMap.has(key)) {
                signalMap.set(key, {
                    key,
                    criterion: String(row?.criterion || 'GENERAL').trim().toUpperCase(),
                    perSessionConsensus: {},
                    perSessionOutcome: {},
                    perSessionRunValues: {},
                    totalVariated: 0
                });
            }
            const entry = signalMap.get(key);
            const changed = row?.changed === true;
            entry.perSessionConsensus[session.id] = String(row?.consensusValue || '').trim();
            entry.perSessionOutcome[session.id] = changed ? 'Variated' : 'Stable';
            entry.perSessionRunValues[session.id] = Array.isArray(row?.runValues) ? row.runValues.map((v) => String(v ?? '-')).join(' | ') : '';
            if (changed) entry.totalVariated += 1;
        }
    }

    const matrixRows = Array.from(questionMap.values()).map((entry) => {
        const counts = sessionIds.map((id) => Number(entry?.perSession?.[id] || 0));
        const totalOccurrences = counts.reduce((sum, n) => sum + n, 0);
        return {
            key: entry.key,
            criterion: entry.criterion || 'General',
            atomicQuestion: entry.atomicQuestion || '',
            counts,
            totalOccurrences,
            occurrenceRate: sessionIds.length > 0 ? totalOccurrences / sessionIds.length : 0
        };
    });

    const crossSampleRows = Array.from(questionMap.values()).map((entry) => {
        const values = sessionIds.map((id) => String(entry?.perSessionValue?.[id] || '').trim());
        const comparableValues = values.filter(Boolean);
        const uniqueValues = Array.from(new Set(comparableValues.map((v) => v.toLowerCase())));
        const uniqueDisplayValues = Array.from(new Set(comparableValues));
        const inconsistentRuns = sessionIds.reduce((sum, id) => sum + Number(entry?.perSession?.[id] || 0), 0);
        return {
            key: entry.key,
            criterion: entry.criterion || 'General',
            atomicQuestion: entry.atomicQuestion || '',
            values,
            inconsistentRuns,
            comparableCount: comparableValues.length,
            interSampleDifferent: uniqueValues.length > 1,
            uniqueDisplayValues
        };
    }).filter((row) => row.comparableCount > 1)
      .sort((a, b) => {
          if (Number(b.interSampleDifferent) !== Number(a.interSampleDifferent)) return Number(b.interSampleDifferent) - Number(a.interSampleDifferent);
          if (b.inconsistentRuns !== a.inconsistentRuns) return b.inconsistentRuns - a.inconsistentRuns;
          return a.key.localeCompare(b.key);
      });

    matrixRows.sort((a, b) => {
        if (b.totalOccurrences !== a.totalOccurrences) return b.totalOccurrences - a.totalOccurrences;
        return a.key.localeCompare(b.key);
    });

    const signalMatrixRows = Array.from(signalMap.values())
        .map((entry) => {
            const values = sessionIds.map((id) => String(entry?.perSessionConsensus?.[id] || '').trim());
            const outcomes = sessionIds.map((id) => String(entry?.perSessionOutcome?.[id] || 'Stable').trim());
            const runValues = sessionIds.map((id) => String(entry?.perSessionRunValues?.[id] || '').trim());
            const comparable = values.filter(Boolean);
            const unique = Array.from(new Set(comparable.map((v) => v.toLowerCase())));
            return {
                key: entry.key,
                criterion: entry.criterion || 'GENERAL',
                perSessionConsensus: values,
                perSessionOutcome: outcomes,
                perSessionRunValues: runValues,
                totalVariated: Number(entry.totalVariated || 0),
                interSampleDifferent: unique.length > 1
            };
        })
        .sort((a, b) => {
            if (Number(b.interSampleDifferent) !== Number(a.interSampleDifferent)) return Number(b.interSampleDifferent) - Number(a.interSampleDifferent);
            if (b.totalVariated !== a.totalVariated) return b.totalVariated - a.totalVariated;
            return a.key.localeCompare(b.key);
        });

    const mostFluctuating = matrixRows.slice(0, 25);
    const mostConsistent = matrixRows
        .slice()
        .sort((a, b) => {
            if (a.totalOccurrences !== b.totalOccurrences) return a.totalOccurrences - b.totalOccurrences;
            return a.key.localeCompare(b.key);
        })
        .slice(0, 25);

    const avgStep3Unstable = sessions.length
        ? Number((sessions.reduce((sum, s) => sum + Number(s?.step3?.unstableCount || 0), 0) / sessions.length).toFixed(2))
        : 0;
    const avgStep4Unstable = sessions.length
        ? Number((sessions.reduce((sum, s) => sum + Number(s?.step4?.unstableCount || 0), 0) / sessions.length).toFixed(2))
        : 0;

    return {
        sessionCount: sessions.length,
        questionCount: matrixRows.length,
        signalCount: signalMatrixRows.length,
        matrixRows,
        signalMatrixRows,
        crossSampleRows,
        mostFluctuating,
        mostConsistent,
        avgStep3Unstable,
        avgStep4Unstable
    };
}

function buildStep3TuningComparisonAnalysis(records = []) {
    const sessions = Array.isArray(records) ? records : [];
    const signalMap = new Map();

    sessions.forEach((session, sessionIndex) => {
        const allSignals = Array.isArray(session?.allSignals) && session.allSignals.length
            ? session.allSignals
            : (Array.isArray(session?.topUnstable) ? session.topUnstable : []);
        allSignals.forEach((row) => {
            const key = String(row?.key || '').trim();
            if (!key) return;
            if (!signalMap.has(key)) {
                signalMap.set(key, {
                    key,
                    criterion: String(row?.criterion || 'GENERAL').trim().toUpperCase(),
                    counts: new Array(sessions.length).fill(0),
                    perSessionConsensus: new Array(sessions.length).fill(''),
                    perSessionOutcome: new Array(sessions.length).fill('No data'),
                    perSessionRunValues: new Array(sessions.length).fill(''),
                    totalOccurrences: 0
                });
            }
            const item = signalMap.get(key);
            const changed = row?.changed === true;
            const consensusValue = String(row?.consensusValue ?? '').trim();
            const runValues = Array.isArray(row?.runValues)
                ? row.runValues.map((v) => String(v ?? '').trim()).filter(Boolean).join(' | ')
                : '';

            item.counts[sessionIndex] = changed ? 1 : 0;
            item.perSessionConsensus[sessionIndex] = consensusValue;
            item.perSessionOutcome[sessionIndex] = changed ? 'Variated' : 'Stable';
            item.perSessionRunValues[sessionIndex] = runValues;
            if (changed) item.totalOccurrences += 1;
        });
    });

    const matrixRows = Array.from(signalMap.values())
        .map((row) => {
            const comparableValues = row.perSessionConsensus
                .map((v) => String(v || '').trim())
                .filter(Boolean);
            const uniqueDisplayValues = Array.from(new Set(comparableValues));
            const normalizedValues = Array.from(new Set(comparableValues.map((v) => v.toLowerCase())));
            return {
                ...row,
                interSampleDifferent: normalizedValues.length > 1,
                uniqueDisplayValues
            };
        })
        .sort((a, b) => {
            if (Number(b.interSampleDifferent) !== Number(a.interSampleDifferent)) return Number(b.interSampleDifferent) - Number(a.interSampleDifferent);
            if (b.totalOccurrences !== a.totalOccurrences) return b.totalOccurrences - a.totalOccurrences;
            return a.key.localeCompare(b.key);
        });

    const avgUnstable = sessions.length
        ? Number((sessions.reduce((sum, s) => sum + Number(s?.unstableCount || 0), 0) / sessions.length).toFixed(2))
        : 0;
    const agreementRows = sessions
        .map((s) => Number(s?.meanAgreement))
        .filter((v) => Number.isFinite(v));
    const avgAgreement = agreementRows.length
        ? Number((agreementRows.reduce((sum, v) => sum + v, 0) / agreementRows.length).toFixed(4))
        : null;
    const flipRows = sessions
        .map((s) => Number(s?.flipRate))
        .filter((v) => Number.isFinite(v));
    const avgFlipRate = flipRows.length
        ? Number((flipRows.reduce((sum, v) => sum + v, 0) / flipRows.length).toFixed(4))
        : null;

    const mostFluctuating = matrixRows.slice(0, 25);
    const mostConsistent = matrixRows
        .filter((r) => Number(r.totalOccurrences || 0) > 0)
        .slice()
        .sort((a, b) => {
            if (a.totalOccurrences !== b.totalOccurrences) return a.totalOccurrences - b.totalOccurrences;
            return a.key.localeCompare(b.key);
        })
        .slice(0, 25);

    return {
        sessionCount: sessions.length,
        signalCount: matrixRows.length,
        avgUnstable,
        avgAgreement,
        avgFlipRate,
        matrixRows,
        mostFluctuating,
        mostConsistent
    };
}

exports.showThreeRunFluctuationPage = async (req, res) => {
    try {
        const summaries = await ieltsService.fetchData('scoringHistory', {}, req.user);
        const all = Array.isArray(summaries) ? summaries : [];
        const threeRunRows = [];
        const unresolved = [];

        for (const summary of all) {
            const id = String(summary?.id || summary?.sessionId || '').trim();
            if (!id) continue;
            if (isThreeRunFromSummary(summary)) {
                const pipelineMode = normalizePipelineMode(summary?.pipelineMode || summary?.researchConfig?.pipelineMode || summary?.metadata?.pipelineMode);
                const scoringView = normalizeScoringView(
                    summary?.uiState?.scoringView ||
                    summary?.scoringView ||
                    summary?.researchConfig?.scoringView ||
                    summary?.metadata?.scoringView
                );
                threeRunRows.push({
                    id,
                    pipelineMode,
                    scoringView,
                    sampleId: summary?.sampleId || '',
                    sampleName: summary?.sampleName || 'Untitled Essay',
                    sampleRefName: summary?.sampleRefName || '',
                    savedAt: summary?.savedAt || '',
                    overallBand: summary?.overallBand || 'N/A',
                    examinerBandScore: summary?.examinerBandScore ?? null,
                    status: summary?.status || 'In Progress',
                    step3RunCount: toPositiveInt(summary?.step3RunCount, 1),
                    step3UnstableCount: Number(summary?.step3UnstableCount ?? 0),
                    step4RunCount: toPositiveInt(summary?.step4RunCount, 1),
                    step4UnstableCount: Number(summary?.step4UnstableCount ?? 0),
                    pipelineStrategy: summary?.pipelineStrategy || 'three_run_consensus',
                    loadUrl: getLoadUrlForPipeline(pipelineMode, id, scoringView)
                });
            } else {
                unresolved.push({ id, summary });
            }
        }

        const unresolvedResults = await Promise.all(
            unresolved.map(async ({ id, summary }) => {
                if (THREE_RUN_SESSION_META_CACHE.has(id)) {
                    return { id, summary, record: THREE_RUN_SESSION_META_CACHE.get(id) };
                }
                const session = await ieltsService.getDataById('scoringHistory', id, req.user);
                const record = session ? buildThreeRunFluctuationRecord(session) : null;
                THREE_RUN_SESSION_META_CACHE.set(id, record);
                return { id, summary, record };
            })
        );

        for (const item of unresolvedResults) {
            if (!item?.record) continue;
            threeRunRows.push({
                id: item.id,
                pipelineMode: item.record?.pipelineMode || normalizePipelineMode(item?.summary?.pipelineMode),
                scoringView: normalizeScoringView(item.record?.scoringView || item?.summary?.scoringView),
                sampleId: item?.summary?.sampleId || '',
                sampleName: item?.summary?.sampleName || item.record.sampleName || 'Untitled Essay',
                sampleRefName: item.record.sampleRefName || '',
                savedAt: item?.summary?.savedAt || item.record.savedAt || '',
                overallBand: item?.summary?.overallBand || item.record.overallBand || 'N/A',
                examinerBandScore: item?.summary?.examinerBandScore ?? item.record.examinerBand ?? null,
                status: item?.summary?.status || 'In Progress',
                step3RunCount: item.record?.step3?.runCount ?? 1,
                step3UnstableCount: item.record?.step3?.unstableCount ?? 0,
                step4RunCount: item.record?.step4?.runCount ?? 1,
                step4UnstableCount: item.record?.step4?.unstableCount ?? 0,
                pipelineStrategy: item.record?.strategy?.overall || 'three_run_consensus',
                loadUrl: item.record?.loadUrl || getLoadUrlForPipeline(
                    item.record?.pipelineMode || item?.summary?.pipelineMode,
                    item.id,
                    item.record?.scoringView || item?.summary?.scoringView
                )
            });
        }

        const filtered = threeRunRows
            .filter((row) => matchesHistoryQuery(row, req.query?.q))
            .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
        const { data, pagination } = paginate(filtered, req.query.page, req.query.limit);

        return res.render('ielts/scoringThreeRunFluctuation', {
            title: 'Three-Run Fluctuation History',
            data,
            pagination,
            filters: req.query,
            user: req.user || null,
            includeModal: true
        });
    } catch (error) {
        return res.status(500).render('error', {
            title: 'Error',
            error,
            message: error.message,
            user: req.user || null
        });
    }
};

exports.showThreeRunFluctuationComparePage = async (req, res) => {
    try {
        const ids = String(req.query.ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);

        if (ids.length < 1) {
            throw new Error('Select at least one session for fluctuation analysis.');
        }

        const sessions = await Promise.all(
            ids.map((id) => ieltsService.getDataById('scoringHistory', id, req.user))
        );
        const sessionTypes = Array.from(new Set(
            sessions.filter(Boolean).map((session) => normalizePipelineMode(
                session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode
            ))
        ));
        if (sessionTypes.length > 1) {
            throw new Error('Mixed session types cannot be compared. Please select sessions from the same pipeline type.');
        }

        const records = sessions
            .filter(Boolean)
            .map((session) => buildThreeRunFluctuationRecord(session, { includeQuestionCatalog: true }))
            .filter(Boolean)
            .sort((a, b) => new Date(a.savedAt || 0) - new Date(b.savedAt || 0));

        if (!records.length) {
            throw new Error('No three-run sessions were found for the selected IDs.');
        }

        const analysis = buildThreeRunComparisonAnalysis(records);

        return res.render('ielts/scoringThreeRunFluctuationCompare', {
            title: 'Three-Run Fluctuation Comparison',
            records,
            analysis,
            user: req.user || null,
            includeModal: true
        });
    } catch (error) {
        return res.status(500).render('error', {
            title: 'Error',
            error,
            message: error.message,
            user: req.user || null
        });
    }
};

exports.compareScoringSessions = async (req, res) => {
    try {
        const ids = (req.query.ids || '').split(',').filter(Boolean);
        if(ids.length < 2) throw new Error("At least 2 IDs required for comparison.");

        // Fetch all sessions in parallel
        const promises = ids.map(id => ieltsService.getDataById('scoringHistory', id, req.user));
        const sessions = await Promise.all(promises);

        // Filter out any nulls (deleted sessions)
        const validSessions = sessions.filter(s => s);
        const sessionTypes = Array.from(new Set(validSessions.map((session) => normalizePipelineMode(
            session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode
        ))));
        if (sessionTypes.length > 1) {
            throw new Error("Mixed session types cannot be compared. Please select sessions from the same pipeline type.");
        }
        const sessionType = sessionTypes[0] || 'full';
        if (sessionType !== 'full' && sessionType !== 'step3_tuning') {
            if (sessionType === 'step4_tuning') {
                throw new Error("Step 4 tuning sessions must be compared in the Step 4 Tuning compare page.");
            }
            throw new Error("This comparison page currently supports Full Pipeline and Step 3 Tuning sessions only.");
        }

        // Sort by Date (Oldest -> Newest) so we read evolution left-to-right
        validSessions.sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));

        res.render('ielts/compareScoring', {
            title: 'Compare Sessions',
            sessions: validSessions,
            user: req.user,
            includeModal: true
        });

    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.compareScoringSessionsVisual = async (req, res) => {
    try {
        const ids = String(req.query.ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);

        if (ids.length < 2) {
            throw new Error('At least 2 IDs required for visual comparison.');
        }

        const sessions = await Promise.all(
            ids.map((id) => ieltsService.getDataById('scoringHistory', id, req.user))
        );

        const validSessions = sessions.filter((s) => s);
        if (validSessions.length < 2) {
            throw new Error('Could not load at least 2 valid sessions.');
        }
        const sessionTypes = Array.from(new Set(validSessions.map((session) => normalizePipelineMode(
            session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode
        ))));
        if (sessionTypes.length > 1) {
            throw new Error("Mixed session types cannot be compared. Please select sessions from the same pipeline type.");
        }
        const sessionType = sessionTypes[0] || 'full';
        if (sessionType !== 'full' && sessionType !== 'step3_tuning') {
            if (sessionType === 'step4_tuning') {
                throw new Error("Step 4 tuning sessions must be compared in the Step 4 Tuning compare page.");
            }
            throw new Error("This visual comparison page currently supports Full Pipeline and Step 3 Tuning sessions only.");
        }

        validSessions.sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));

        res.render('ielts/compareScoringVisual', {
            title: 'Visual Session Comparison',
            sessions: validSessions,
            ids: validSessions.map((s) => s?.sessionId || s?.id).filter(Boolean),
            user: req.user,
            includeModal: true
        });
    } catch (error) {
        res.status(500).render('error', { error, user: req.user });
    }
};

exports.exportRepeatedRunAnalysis = async (req, res) => {
    try {
        const ids = String(req.query.ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);

        if (ids.length < 2) {
            return res.status(400).json({
                status: 'error',
                message: 'At least 2 session IDs are required.'
            });
        }

        const sessions = await Promise.all(
            ids.map((id) => ieltsService.getDataById('scoringHistory', id, req.user))
        );

        const validSessions = sessions.filter((session) => session);
        if (validSessions.length < 2) {
            return res.status(400).json({
                status: 'error',
                message: 'Could not load at least 2 valid sessions.'
            });
        }
        const sessionTypes = Array.from(new Set(validSessions.map((session) => normalizePipelineMode(
            session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode
        ))));
        if (sessionTypes.length > 1) {
            return res.status(400).json({
                status: 'error',
                message: 'Mixed session types cannot be compared/exported together.'
            });
        }

        const report = repeatedRunAnalysisService.buildReport(validSessions);
        return res.json({ status: 'success', data: report });
    } catch (error) {
        console.error('Repeated-run export error:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Failed to export repeated-run analysis.' });
    }
};

exports.exportBenchmarkCalibration = async (req, res) => {
    try {
        const ids = String(req.query.ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        const limitRaw = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(limitRaw, 200)
            : 50;

        let sessions = [];
        if (ids.length > 0) {
            sessions = await Promise.all(
                ids.map((id) => ieltsService.getDataById('scoringHistory', id, req.user))
            );
            sessions = sessions.filter(Boolean);
        } else {
            const all = await ieltsService.fetchData(
                'scoringHistory',
                {},
                req.user,
                buildScoringHistoryAccessContext(req, OPERATIONS.READ_ALL)
            );
            sessions = (Array.isArray(all) ? all : [])
                .slice()
                .sort((a, b) => new Date(b?.savedAt || 0) - new Date(a?.savedAt || 0))
                .slice(0, limit);
        }

        if (!sessions.length) {
            return res.status(400).json({
                status: 'error',
                message: 'No scoring sessions found for benchmark calibration.'
            });
        }

        const records = sessions.map((session) =>
            calibrationEvaluationService.buildEvaluationRecordFromSession(session)
        );
        const calibration = calibrationEvaluationService.buildCalibrationReport(records, {
            scoringVersion: String(req.query.scoringVersion || 'scoringV0326').trim() || 'scoringV0326',
            promptSourceSummary: String(req.query.promptSourceSummary || '').trim()
        });

        return res.json({
            status: 'success',
            data: {
                schema: 'ielts-benchmark-calibration-export',
                version: 1,
                generatedAt: new Date().toISOString(),
                sessionCount: sessions.length,
                calibration,
                records
            }
        });
    } catch (error) {
        console.error('Benchmark calibration export error:', error);
        return res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to export benchmark calibration report.'
        });
    }
};

exports.showStep3TuningComparePage = async (req, res) => {
    try {
        const ids = String(req.query.ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        if (ids.length < 2) throw new Error('Select at least two Step 3 tuning sessions to compare.');

        const sessions = await Promise.all(ids.map((id) => ieltsService.getDataById('scoringHistory', id, req.user)));
        const validSessions = sessions.filter(Boolean);
        if (validSessions.length < 2) throw new Error('Could not load at least two valid sessions.');

        const sessionTypes = Array.from(new Set(validSessions.map((session) => normalizePipelineMode(
            session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode
        ))));
        if (sessionTypes.length > 1 || sessionTypes[0] !== 'step3_tuning') {
            throw new Error('Only Step 3 tuning sessions can be compared on this page.');
        }

        const records = validSessions
            .map((session) => {
                const id = String(session?.sessionId || session?.id || '');
                const stability = (
                    session?.steps?.step3stability?.response?.json?.data ||
                    session?.steps?.step3extract?.response?.json?.meta?.stabilityGate ||
                    {}
                );
                const metrics = stability?.metrics || {};
                const step3Meta = session?.steps?.step3extract?.response?.json?.meta || {};
                const step3Req = session?.steps?.step3extract?.request || {};
                const allSignals = Array.isArray(stability?.allSignals) ? stability.allSignals : [];
                return {
                    id,
                    sampleName: session?.metadata?.sampleName || 'Untitled Essay',
                    savedAt: session?.savedAt || null,
                    runCount: toPositiveInt(metrics?.runCount || session?.steps?.step3extract?.request?.runCount, 1),
                    meanAgreement: Number.isFinite(Number(metrics?.meanAgreement)) ? Number(metrics.meanAgreement) : null,
                    flipRate: Number.isFinite(Number(metrics?.flipRate)) ? Number(metrics.flipRate) : null,
                    unstableCount: Number(metrics?.unstableCount || 0),
                    totalSignals: Number(metrics?.totalSignals || 0),
                    gatePassed: typeof metrics?.gatePassed === 'boolean' ? metrics.gatePassed : null,
                    topUnstable: Array.isArray(stability?.topUnstable) ? stability.topUnstable.slice(0, 20) : [],
                    allSignals: allSignals.map((row) => ({
                        key: String(row?.key || '').trim(),
                        criterion: String(row?.criterion || 'GENERAL').trim().toUpperCase(),
                        runValues: Array.isArray(row?.runValues) ? row.runValues.map((v) => String(v ?? '').trim()) : [],
                        consensusValue: String(row?.consensusValue ?? '').trim(),
                        changed: row?.changed === true,
                        tie: row?.tie === true
                    })).filter((row) => row.key),
                    modelUsed: String(step3Meta?.modelUsed || '').trim(),
                    selectedModelId: String(step3Req?.payload?.modelId || '').trim(),
                    promptUsed: String(
                        step3Meta?.executedPrompt ||
                        step3Req?.payload?.customPrompt ||
                        ''
                    ),
                    loadUrl: getLoadUrlForPipeline(
                        'step3_tuning',
                        id,
                        session?.uiState?.scoringView ||
                        session?.scoringView ||
                        session?.researchConfig?.scoringView ||
                        session?.metadata?.scoringView
                    )
                };
            })
            .sort((a, b) => new Date(a.savedAt || 0) - new Date(b.savedAt || 0));
        const analysis = buildStep3TuningComparisonAnalysis(records);

        const compareIdsQuery = validSessions.map((s) => encodeURIComponent(s?.sessionId || s?.id || '')).filter(Boolean).join(',');
        return res.render('ielts/step3TuningCompare', {
            title: 'Step 3 Tuning Comparison',
            records,
            analysis,
            compareIdsQuery,
            user: req.user || null,
            includeModal: true
        });
    } catch (error) {
        return res.status(500).render('error', {
            title: 'Error',
            error,
            message: error.message,
            user: req.user || null
        });
    }
};

exports.showStep4TuningComparePage = async (req, res) => {
    try {
        const ids = String(req.query.ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        if (ids.length < 2) throw new Error('Select at least two Step 4 tuning sessions to compare.');

        const sessions = await Promise.all(ids.map((id) => ieltsService.getDataById('scoringHistory', id, req.user)));
        const validSessions = sessions.filter(Boolean);
        if (validSessions.length < 2) throw new Error('Could not load at least two valid sessions.');

        const sessionTypes = Array.from(new Set(validSessions.map((session) => normalizePipelineMode(
            session?.researchConfig?.pipelineMode || session?.metadata?.pipelineMode
        ))));
        if (sessionTypes.length > 1 || sessionTypes[0] !== 'step4_tuning') {
            throw new Error('Only Step 4 tuning sessions can be compared on this page.');
        }

        const records = validSessions
            .map((session) => buildThreeRunFluctuationRecord(session, { includeQuestionCatalog: true }))
            .filter(Boolean)
            .sort((a, b) => new Date(a.savedAt || 0) - new Date(b.savedAt || 0));

        if (!records.length) {
            throw new Error('No Step 4 tuning sessions were found for the selected IDs.');
        }

        const analysis = buildThreeRunComparisonAnalysis(records);

        return res.render('ielts/step4TuningCompare', {
            title: 'Step 4 Tuning Comparison',
            records,
            analysis,
            user: req.user || null,
            includeModal: true
        });
    } catch (error) {
        return res.status(500).render('error', {
            title: 'Error',
            error,
            message: error.message,
            user: req.user || null
        });
    }
};
/* ----------------------------------------------------------------*/
//#endregion 
/* ----------------------------------------------------------------*/
