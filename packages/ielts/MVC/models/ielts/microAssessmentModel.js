// MVC/models/ielts/microAssessmentModel.js
const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/ielts/ieltsCoreModuleResolver');
const dataPath = path.join(resolveCoreRoot(), 'data/ielts/microAssessments.json');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { getActiveDataBackendMode } = requireCoreModule('MVC/infrastructure/runtime/dataBackendRuntime');

// --- Signal Metadata (UI + Step 3 routing) ---
// Keep as small, stable enums so controller/routes do not need changes.
const PROMPT_GROUPS = ['PROMPT_A_TR_CC', 'PROMPT_B_LR_GRA'];
const SIGNAL_KINDS = ['deterministic', 'hybrid', 'ai', 'external'];
const DEFAULT_ORG_ID = 'SYSTEM';
const MICRO_SCOPES = ['essay', 'paragraph'];
const EXPECTED_EVIDENCE_TYPES = ['sentence_indices', 'none'];
const SIGNAL_CLASSIFICATIONS = ['deterministic', 'hybrid', 'ai_only'];
const PARAGRAPH_ROLE_CONSTRAINTS = ['any', 'intro', 'body', 'conclusion'];
const FEEDBACK_ROLES = ['general', 'strength', 'issue'];

function assertJsonModelAccessAllowed(actionLabel = 'operation') {
    const mode = String(getActiveDataBackendMode() || 'json').trim().toLowerCase();
    if (mode === 'mongo') {
        throw new Error(
            `[IELTS microAssessmentModel] File-based ${actionLabel} is disabled while DATA_BACKEND=mongo. ` +
            'Use ieltsDataService/ieltsRepositories for Mongo-backed access.'
        );
    }
}

function inferPromptGroup(criterion) {
    return (criterion === 'TR' || criterion === 'CC') ? 'PROMPT_A_TR_CC' : 'PROMPT_B_LR_GRA';
}

function parseSignals(signal_signals) {
    // Accept array, JSON string, comma-separated, or newline-separated.
    if (!signal_signals) return [];
    if (Array.isArray(signal_signals)) return signal_signals.filter(Boolean);
    const raw = String(signal_signals).trim();
    if (!raw) return [];
    // JSON array support
    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr.map(s => String(s).trim()).filter(Boolean);
        } catch (e) {}
    }
    return raw
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function parseScoringAnswerList(rawValue) {
    if (rawValue === undefined || rawValue === null) return [];
    if (Array.isArray(rawValue)) {
        return dedupeScoringAnswerTokens(rawValue);
    }
    const raw = String(rawValue).trim();
    if (!raw) return [];
    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return dedupeScoringAnswerTokens(parsed);
        } catch (e) {}
    }
    return dedupeScoringAnswerTokens(raw.split(/[\n,]+/));
}

function dedupeScoringAnswerTokens(values) {
    const out = [];
    const seen = new Set();
    for (const value of values || []) {
        const token = String(value ?? '').trim();
        if (!token) continue;
        const normalizedToken = token.toLowerCase();
        if (seen.has(normalizedToken)) continue;
        seen.add(normalizedToken);
        out.push(normalizedToken);
    }
    return out;
}

function normalizeSignalKind(kind, criterion) {
    if (SIGNAL_KINDS.includes(kind)) return kind;
    // sensible defaults (can be overridden in UI)
    if (criterion === 'GRA') return 'deterministic';
    if (criterion === 'CC' || criterion === 'TR') return 'hybrid';
    if (criterion === 'LR') return 'hybrid';
    return 'hybrid';
}

function normalizePromptGroup(group, criterion) {
    if (PROMPT_GROUPS.includes(group)) return group;
    return inferPromptGroup(criterion);
}

function normalizeScope(scope) {
    const s = String(scope || '').trim().toLowerCase();
    return MICRO_SCOPES.includes(s) ? s : 'essay';
}

function normalizeExpectedEvidenceType(value) {
    const v = String(value || '').trim().toLowerCase();
    return EXPECTED_EVIDENCE_TYPES.includes(v) ? v : 'sentence_indices';
}

function inferSignalClassification(signalKind) {
    const kind = String(signalKind || '').trim().toLowerCase();
    if (kind === 'deterministic' || kind === 'external') return 'deterministic';
    if (kind === 'ai') return 'ai_only';
    return 'hybrid';
}

function normalizeSignalClassification(value, signalKind) {
    const v = String(value || '').trim().toLowerCase();
    if (SIGNAL_CLASSIFICATIONS.includes(v)) return v;
    return inferSignalClassification(signalKind);
}

function parseBooleanish(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (['true', '1', 'yes', 'y', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(raw)) return false;
    return fallback;
}

function normalizeParagraphRoleConstraint(value) {
    const v = String(value || '').trim().toLowerCase();
    return PARAGRAPH_ROLE_CONSTRAINTS.includes(v) ? v : 'any';
}

function normalizeFeedbackRole(value) {
    const v = String(value || '').trim().toLowerCase();
    return FEEDBACK_ROLES.includes(v) ? v : 'general';
}

async function ensureDataDir() {
    const dir = path.dirname(dataPath);
    try { await fs.access(dir); } 
    catch { await fs.mkdir(dir, { recursive: true }); }
}

// --- HELPER: Normalize Data ---
function enhanceItem(item) {
    const criterion = item.criterion || 'TR';
    const prompt_group = normalizePromptGroup(item.prompt_group, criterion);
    const signal_kind = normalizeSignalKind(item.signal_kind || (item.signal_source && item.signal_source.kind), criterion);
    const signals = parseSignals(item.signal_signals || (item.signal_source && item.signal_source.signals));
    const baseKey = String(item.baseKey || item.question_key || item.id || '').trim();
    const signalClassification = normalizeSignalClassification(item.signalClassification, signal_kind);
    const scoredAnswers = parseScoringAnswerList(item.scoredAnswers ?? item.scored_answers);
    const notScoredAnswers = parseScoringAnswerList(item.notScoredAnswers ?? item.not_scored_answers);

    // Keep a nested object (used later by Step 3), but also store flat fields for easy form binding.
    const signal_source = {
        kind: signal_kind,
        signals,
        upstream_steps: Array.isArray(item.signal_source?.upstream_steps) ? item.signal_source.upstream_steps : []
    };

    return {
        ...item,
        id: item.id || item.question_key, // Fallback ID
        orgId: String(item.orgId || DEFAULT_ORG_ID),
        band: parseInt(item.band) || 0,
        weight: parseFloat(item.weight) || 1,
        baseKey: baseKey || '',
        question_key: baseKey || item.question_key || '', // Compatibility alias
        title: item.title || 'General',
        atomic_question: item.atomic_question || '',
        rubric_anchor: item.rubric_anchor || '',
        criterion: item.criterion || 'TR',
        subconstruct: item.subconstruct || item.title || item.criterion || 'General',
        scope: normalizeScope(item.scope),
        expectedEvidenceType: normalizeExpectedEvidenceType(item.expectedEvidenceType),
        signalClassification,
        operationalizedOnlyEligible: parseBooleanish(
            item.operationalizedOnlyEligible,
            signalClassification === 'deterministic'
        ),
        paragraphRoleConstraint: normalizeParagraphRoleConstraint(item.paragraphRoleConstraint),
        feedbackRole: normalizeFeedbackRole(item.feedbackRole),
        answer_type: item.answer_type || 'Boolean',
        scoredAnswers,
        notScoredAnswers,
        is_active: item.is_active !== false,

        // --- Routing / signals (new) ---
        prompt_group,
        signal_kind,
        signal_signals: signals, // array
        signal_source
    };
}

async function getAllAssessments() {
    assertJsonModelAccessAllowed('read');
    await ensureDataDir();
    try {
        const raw = await fs.readFile(dataPath, 'utf8');
        const list = JSON.parse(raw);
        // Sort by Title (Group) then Key
        return list.map(enhanceItem).sort((a, b) => {
             return a.title.localeCompare(b.title) || a.question_key.localeCompare(b.question_key);
        });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        return [];
    }
}

async function getAssessmentById(id) {
    const list = await getAllAssessments();
    return list.find(item => item.id === id);
}

function generateId() {
    return `MA_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

    // --- CONFIGURATION ---
const SYSTEM_FIELDS = [
        { key: 'baseKey', label: 'Base Key', required: true },
        { key: 'question_key', label: 'Question Key', required: true },
        { key: 'title', label: 'Group Title', required: true },
        { key: 'subconstruct', label: 'Subconstruct', required: false },
        { key: 'scope', label: 'Scope', required: true },
        { key: 'expectedEvidenceType', label: 'Expected Evidence Type', required: true },
        { key: 'signalClassification', label: 'Signal Classification', required: true },
        { key: 'operationalizedOnlyEligible', label: 'Operationalized-only Eligible', required: false },
        { key: 'paragraphRoleConstraint', label: 'Paragraph Role Constraint', required: false },
        { key: 'feedbackRole', label: 'Feedback Role', required: false },
        { key: 'atomic_question', label: 'Question Text', required: true },
        { key: 'rubric_anchor', label: 'Rubric Anchor', required: true },
        { key: 'band', label: 'Band', required: true },
        { key: 'criterion', label: 'Criterion', required: true },
        { key: 'answer_type', label: 'Answer Type', required: false },
        { key: 'scoredAnswers', label: 'Scored Answers', required: false },
        { key: 'notScoredAnswers', label: 'Not Scored Answers', required: false },
        { key: 'weight', label: 'Weight', required: false },
        { key: 'prompt_group', label: 'Prompt Group', required: false },
        { key: 'signal_kind', label: 'Signal Kind', required: false },
        { key: 'signal_signals', label: 'Signals', required: false },
        { key: 'tags', label: 'Tags', required: false },
        { key: 'notes', label: 'Notes', required: false }
];

/* ---------------- VALIDATION (FLAT STRUCTURE) ---------------- */

function validateData(data) {
    const errors = [];
    const baseKey = String(data.baseKey || data.question_key || '').trim();

    if (!data.orgId || String(data.orgId).trim() === '') {
        errors.push('orgId is required.');
    }
    if (!baseKey) errors.push('Base Key is required.');
    if (!data.atomic_question) errors.push('Question Text is required.');
    if (!data.rubric_anchor) errors.push('Rubric Anchor is required.');
    
    const b = parseInt(data.band);
    if (isNaN(b) || b < 0 || b > 9) errors.push('Band must be between 0 and 9.');

    const validCriteria = ['TR', 'CC', 'LR', 'GRA'];
    if (!data.criterion || !validCriteria.includes(data.criterion)) {
        errors.push(`Criterion must be one of: ${validCriteria.join(', ')}`);
    }

    if (data.prompt_group && !PROMPT_GROUPS.includes(data.prompt_group)) {
        errors.push(`Prompt Group must be one of: ${PROMPT_GROUPS.join(', ')}`);
    }

    if (data.signal_kind && !SIGNAL_KINDS.includes(data.signal_kind)) {
        errors.push(`Signal Kind must be one of: ${SIGNAL_KINDS.join(', ')}`);
    }
    if (data.scope && !MICRO_SCOPES.includes(String(data.scope).toLowerCase())) {
        errors.push(`Scope must be one of: ${MICRO_SCOPES.join(', ')}`);
    }
    if (
        data.expectedEvidenceType &&
        !EXPECTED_EVIDENCE_TYPES.includes(String(data.expectedEvidenceType).toLowerCase())
    ) {
        errors.push(`Expected Evidence Type must be one of: ${EXPECTED_EVIDENCE_TYPES.join(', ')}`);
    }
    if (
        data.signalClassification &&
        !SIGNAL_CLASSIFICATIONS.includes(String(data.signalClassification).toLowerCase())
    ) {
        errors.push(`Signal Classification must be one of: ${SIGNAL_CLASSIFICATIONS.join(', ')}`);
    }
    if (
        data.paragraphRoleConstraint &&
        !PARAGRAPH_ROLE_CONSTRAINTS.includes(String(data.paragraphRoleConstraint).toLowerCase())
    ) {
        errors.push(`Paragraph Role Constraint must be one of: ${PARAGRAPH_ROLE_CONSTRAINTS.join(', ')}`);
    }
    if (data.feedbackRole && !FEEDBACK_ROLES.includes(String(data.feedbackRole).toLowerCase())) {
        errors.push(`Feedback Role must be one of: ${FEEDBACK_ROLES.join(', ')}`);
    }

    const scoredAnswers = Array.isArray(data.scoredAnswers) ? data.scoredAnswers : [];
    const notScoredAnswers = Array.isArray(data.notScoredAnswers) ? data.notScoredAnswers : [];
    if (scoredAnswers.length || notScoredAnswers.length) {
        const scoredSet = new Set(scoredAnswers.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean));
        const overlap = notScoredAnswers
            .map((v) => String(v || '').trim())
            .find((v) => v && scoredSet.has(v.toLowerCase()));
        if (overlap) {
            errors.push(`Scoring contract conflict: "${overlap}" exists in both scored and not-scored answers.`);
        }
    }

    return errors.length ? { isValid: false, errors } : { isValid: true };
}

function normalizeAssessmentRecord(data = {}, existing = null) {
    const base = (existing && typeof existing === 'object') ? existing : {};
    const now = new Date().toISOString();
    const criterion = String(data.criterion ?? base.criterion ?? 'TR').trim().toUpperCase() || 'TR';
    const baseKey = String(data.baseKey || data.question_key || base.baseKey || base.question_key || '').trim();
    const signalKind = normalizeSignalKind(
        data.signal_kind || data.signal_source?.kind || base.signal_kind || base.signal_source?.kind,
        criterion
    );
    const signalClassification = normalizeSignalClassification(
        data.signalClassification ?? base.signalClassification,
        signalKind
    );
    const signalSignalsRaw = (
        data.signal_signals !== undefined
            ? data.signal_signals
            : (base.signal_signals !== undefined ? base.signal_signals : base.signal_source?.signals)
    );
    const signalSignals = parseSignals(signalSignalsRaw);
    const upstreamStepsRaw = (
        data.signal_source && Array.isArray(data.signal_source.upstream_steps)
            ? data.signal_source.upstream_steps
            : (Array.isArray(base.signal_source?.upstream_steps) ? base.signal_source.upstream_steps : [])
    );
    const scoredAnswersRaw = (
        data.scoredAnswers !== undefined || data.scored_answers !== undefined
            ? (data.scoredAnswers ?? data.scored_answers)
            : (base.scoredAnswers ?? base.scored_answers)
    );
    const notScoredAnswersRaw = (
        data.notScoredAnswers !== undefined || data.not_scored_answers !== undefined
            ? (data.notScoredAnswers ?? data.not_scored_answers)
            : (base.notScoredAnswers ?? base.not_scored_answers)
    );

    return {
        ...base,
        ...data,
        id: String(data.id || base.id || '').trim(),
        orgId: String(data.orgId || base.orgId || DEFAULT_ORG_ID).trim() || DEFAULT_ORG_ID,
        title: String(data.title ?? base.title ?? 'General'),
        description: String(data.description ?? base.description ?? ''),
        baseKey,
        question_key: baseKey,
        band: parseInt(data.band ?? base.band),
        criterion,
        subconstruct: String(data.subconstruct ?? base.subconstruct ?? data.title ?? base.title ?? criterion ?? 'General'),
        scope: normalizeScope(data.scope ?? base.scope),
        expectedEvidenceType: normalizeExpectedEvidenceType(data.expectedEvidenceType ?? base.expectedEvidenceType),
        signalClassification,
        operationalizedOnlyEligible: parseBooleanish(
            data.operationalizedOnlyEligible ?? base.operationalizedOnlyEligible,
            signalClassification === 'deterministic'
        ),
        paragraphRoleConstraint: normalizeParagraphRoleConstraint(data.paragraphRoleConstraint ?? base.paragraphRoleConstraint),
        feedbackRole: normalizeFeedbackRole(data.feedbackRole ?? base.feedbackRole),
        atomic_question: String(data.atomic_question ?? base.atomic_question ?? ''),
        rubric_anchor: String(data.rubric_anchor ?? base.rubric_anchor ?? ''),
        answer_type: String(data.answer_type ?? base.answer_type ?? 'Boolean'),
        scoredAnswers: parseScoringAnswerList(scoredAnswersRaw),
        notScoredAnswers: parseScoringAnswerList(notScoredAnswersRaw),
        weight: parseFloat(data.weight ?? base.weight) || 1,
        prompt_group: normalizePromptGroup(data.prompt_group ?? base.prompt_group, criterion),
        signal_kind: signalKind,
        signal_signals: signalSignals,
        signal_source: {
            kind: signalKind,
            signals: signalSignals,
            upstream_steps: Array.isArray(upstreamStepsRaw) ? upstreamStepsRaw : []
        },
        is_active: parseBooleanish(data.is_active ?? base.is_active, true),
        tags: String(data.tags ?? base.tags ?? ''),
        notes: String(data.notes ?? base.notes ?? ''),
        createdAt: base.createdAt || now,
        updatedAt: now
    };
}

function validateAssessmentRecordOrThrow(record) {
    const result = validateData(record);
    if (!result.isValid) throw new Error(result.errors.join('<br>'));
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addAssessment(data) {
    assertJsonModelAccessAllowed('create');
    return await queueWrite(async () => {
        let list = [];
        try { list = JSON.parse(await fs.readFile(dataPath, 'utf8')); } catch (e) {}
        const normalizedBaseKey = String(data.baseKey || data.question_key || '').trim();

        const scopedOrgId = String(data.orgId || DEFAULT_ORG_ID).trim() || DEFAULT_ORG_ID;
        // Check duplicates within the same organization scope.
        if (list.some((i) =>
            String(i.baseKey || i.question_key || '').trim() === normalizedBaseKey
            && String(i.orgId || DEFAULT_ORG_ID) === scopedOrgId
        )) {
            throw new Error(`Duplicate Base Key: ${normalizedBaseKey} already exists.`);
        }
        const newItem = normalizeAssessmentRecord({
            ...data,
            id: generateId(),
            orgId: scopedOrgId,
            baseKey: normalizedBaseKey
        });
        validateAssessmentRecordOrThrow(newItem);

        list.push(newItem);
        await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
        return newItem;
    });
}

async function updateAssessment(id, updates) {
    assertJsonModelAccessAllowed('update');
    return await queueWrite(async () => {
        let list = [];
        try { list = JSON.parse(await fs.readFile(dataPath, 'utf8')); } catch (e) {}

        const index = list.findIndex(item => item.id === id);
        if (index === -1) throw new Error('Item not found');

        const current = list[index];
        
        const merged = normalizeAssessmentRecord(
            {
                ...updates,
                id: current.id,
                orgId: current.orgId || DEFAULT_ORG_ID
            },
            current
        );

        const duplicate = list.find(
            (item) =>
                item.id !== id &&
                String(item.baseKey || item.question_key || '').trim() === merged.baseKey &&
                String(item.orgId || DEFAULT_ORG_ID) === String(merged.orgId || DEFAULT_ORG_ID)
        );
        if (duplicate) {
            throw new Error(`Duplicate Base Key: ${merged.baseKey} already exists.`);
        }
        validateAssessmentRecordOrThrow(merged);

        list[index] = merged;
        await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
        return merged;
    });
}

async function deleteAssessment(id) {
    assertJsonModelAccessAllowed('delete');
    return await queueWrite(async () => {
        let list = [];
        try { list = JSON.parse(await fs.readFile(dataPath, 'utf8')); } catch (e) {}
        const filtered = list.filter(item => item.id !== id);
        await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
        return true;
    });
}

module.exports = {
    getAllAssessments,
    getAssessmentById,
    addAssessment,
    updateAssessment,
    deleteAssessment,
    SYSTEM_FIELDS,
    normalizeAssessmentRecord,
    validateAssessmentRecordOrThrow
};
