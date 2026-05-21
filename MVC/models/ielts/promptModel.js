// MVC/models/ielts/promptModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../../models/fileQueue'); 

const dataPath = path.join(__dirname, '../../../data/ielts/prompts.json');
const DEFAULT_ORG_ID = 'SYSTEM';
const DEFAULT_CATEGORY = 'NO_CATEGORY';
const DEFAULT_TARGET_STEP = 'general';

function normalizeString(value, fallback = '') {
    const v = String(value ?? '').trim();
    return v || fallback;
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    const raw = String(value || '').trim();
    if (!raw) return [];
    return raw.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function normalizePromptRecord(payload = {}, existing = null, strict = false) {
    const base = existing && typeof existing === 'object' ? existing : {};
    const id = normalizeString(payload.id ?? base.id);
    if (!id) {
        if (strict) throw new Error('Prompt ID is required.');
        return null;
    }

    const content = String(payload.content ?? base.content ?? '').trim();
    if (!content) {
        if (strict) throw new Error('Prompt content is required.');
        return null;
    }

    const configInput = payload.config && typeof payload.config === 'object'
        ? payload.config
        : (base.config && typeof base.config === 'object' ? base.config : {});

    return {
        ...base,
        id,
        name: normalizeString(payload.name ?? base.name, id),
        content,
        orgId: normalizeString(payload.orgId ?? base.orgId, DEFAULT_ORG_ID),
        description: normalizeString(payload.description ?? base.description, ''),
        category: normalizeString(payload.category ?? base.category, DEFAULT_CATEGORY),
        targetStep: normalizeString(payload.targetStep ?? base.targetStep, DEFAULT_TARGET_STEP),
        variables: normalizeStringArray(payload.variables ?? base.variables),
        tags: normalizeStringArray(payload.tags ?? base.tags),
        isActive: payload.isActive === undefined ? (base.isActive !== false) : Boolean(payload.isActive),
        isDefault: payload.isDefault === undefined ? Boolean(base.isDefault) : Boolean(payload.isDefault),
        config: {
            modelHint: normalizeString(configInput.modelHint, ''),
            temperature: clampNumber(configInput.temperature, 0, 2, 0),
            topP: clampNumber(configInput.topP, 0, 1, 1),
            topK: clampNumber(configInput.topK, 0, 100, 1)
        },
        updatedAt: new Date().toISOString(),
        createdAt: base.createdAt || new Date().toISOString()
    };
}

// Extended Defaults for your new Exam Mode
const DEFAULTS = [
    {
        id: 'task2_analysis',
        name: 'Single Analysis (Default)',
        content: `You are an expert IELTS Examiner.\n\nTASK:\nAnalyze the "Student Essay" against the "Assessment Question".\n\n[ASSESSMENT QUESTION]\n{{question}}\n\n[CRITERIA]\n{{criteria}}\n\n[STUDENT ESSAY]\n"{{essay_text}}"\n\nINSTRUCTIONS:\n1. Determine if the essay meets the criteria.\n2. Provide a direct answer.\n3. Explain reasoning with quotes.`
    },
    {
        id: 'chat_context',
        name: 'General Chat Tutor',
        content: `You are an expert IELTS Writing Tutor.\nThe student is asking questions about a specific essay sample.\n\n--- CONTEXT DATA ---\nQuestion Prompt: "{{question}}"\nEssay Type: {{type}}\nBand Score: {{score}}\n\nEssay Content:\n"{{essay_text}}"\n\nExaminer Feedback:\n"{{feedback}}"\n\nINSTRUCTIONS:\n1. Answer specifically referencing the essay above.\n2. Use the Examiner Feedback as a guide.`
    },
    // ✅ NEW: Exam Mode - Context Setter
    {
        id: 'exam_system_context',
        name: 'Exam Mode: System Context',
        content: `You are an IELTS Examiner conducting a granular assessment.\n\nI will provide you with a Student Essay. I will then ask you a series of specific questions about it.\n\n[STUDENT ESSAY START]\n{{essay_text}}\n[STUDENT ESSAY END]\n\nWait for my first question.`
    },
    // ✅ NEW: Exam Mode - Question Asker
    {
        id: 'exam_question_item',
        name: 'Exam Mode: Question Item',
        content: `[QUESTION #{{order}}]\n{{question}}\n\n[PASSING CRITERIA]\n{{criteria}}\n\nDoes the essay meet this criteria? (Yes/No) and explain why.`
    }
];

async function ensureDataDir() {
    const dir = path.dirname(dataPath);
    try { await fs.access(dir); } 
    catch { await fs.mkdir(dir, { recursive: true }); }
}

async function getAllPrompts() {
    await ensureDataDir();
    try {
        const data = await fs.readFile(dataPath, 'utf8');
        const parsed = JSON.parse(data);
        return Array.isArray(parsed)
            ? parsed.map((item) => normalizePromptRecord(item)).filter(Boolean)
            : [];
    } catch (error) {
        if (error.code === 'ENOENT') {
            const seeded = DEFAULTS
                .map((item) => normalizePromptRecord({ ...item, orgId: DEFAULT_ORG_ID }))
                .filter(Boolean);
            await fs.writeFile(dataPath, JSON.stringify(seeded, null, 2));
            return seeded;
        }
        return [];
    }
}

async function getPromptById(id) {
    const list = await getAllPrompts();
    return list.find(p => p.id === id);
}

// ✅ Save or Update
async function savePrompt(idOrPayload, content, name, orgId = DEFAULT_ORG_ID) {
    return await queueWrite(async () => {
        let list = await getAllPrompts();
        const payload = (idOrPayload && typeof idOrPayload === 'object')
            ? { ...idOrPayload }
            : {
                id: idOrPayload,
                content,
                name,
                orgId
            };
        const scopedOrgId = normalizeString(payload.orgId, DEFAULT_ORG_ID);
        payload.orgId = scopedOrgId;
        const scopedId = normalizeString(payload.id);
        const index = list.findIndex((p) =>
            p.id === scopedId && String(p.orgId || DEFAULT_ORG_ID) === scopedOrgId
        );

        if (index >= 0) {
            list[index] = normalizePromptRecord(payload, list[index], true);
        } else {
            list.push(normalizePromptRecord(payload, null, true));
        }

        await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
        return index >= 0 ? list[index] : list[list.length - 1];
    });
}

// ✅ Delete
async function deletePrompt(id, orgId = null) {
    return await queueWrite(async () => {
        let list = await getAllPrompts();
        const scopedOrgId = orgId ? String(orgId || '').trim() : '';
        const filtered = list.filter((p) => {
            if (p.id !== id) return true;
            if (!scopedOrgId) return false;
            return String(p.orgId || DEFAULT_ORG_ID) !== scopedOrgId;
        });
        await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
        return true;
    });
}

module.exports = { getAllPrompts, getPromptById, savePrompt, deletePrompt };