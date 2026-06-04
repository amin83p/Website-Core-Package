// MVC/models/ielts/scoringSessionModel.js
const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/ielts/ieltsCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const BASE_DIR = path.join(resolveCoreRoot(), 'data/ielts/scoring');
const INDEX_FILE = path.join(BASE_DIR, 'index.json');
const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');
const DEFAULT_ORG_ID = 'SYSTEM';

// --- Helpers ---
function clampInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function normalizePromptVersionIds(value) {
    if (Array.isArray(value)) return value.filter((v) => String(v || '').trim().length > 0);
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return {};
}

function inferProviderFromSession(fullSessionData = {}) {
    const modelHints = [
        fullSessionData?.steps?.step3extract?.response?.json?.meta?.modelUsed,
        fullSessionData?.steps?.step4grade?.response?.json?.data?.meta?.modelUsed,
        fullSessionData?.steps?.step5feedback?.response?.json?.data?.meta?.modelUsed
    ]
        .map((v) => String(v || '').toLowerCase())
        .filter(Boolean)
        .join(' ');

    if (modelHints.includes('gemini')) return 'gemini';
    if (modelHints.includes('copilot') || modelHints.includes('gpt') || modelHints.includes('openai')) return 'copilot';
    return 'unknown';
}

function toPositiveInt(value, fallback = 1) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function normalizeScoringView(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'scoringstandard' || normalized === 'standard' || normalized === 'scoring-standard' || normalized === 'scoringstandard.ejs') {
        return 'scoringStandard';
    }
    if (normalized === 'scoringv0323' || normalized === 'v0323') return 'scoringV0323';
    return 'scoringV0225';
}

function normalizeRunCategoryColor(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^#?([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/);
    if (!match) return '';
    const hex = String(match[1] || '').trim().toUpperCase();
    if (hex.length === 3) {
        return `#${hex.split('').map((ch) => `${ch}${ch}`).join('')}`;
    }
    return `#${hex}`;
}

function normalizeRunCategoryLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function buildRunCategoryKey(label = '', color = '') {
    const normalizedLabel = normalizeRunCategoryLabel(label).toLowerCase();
    const slug = normalizedLabel
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    const normalizedColor = normalizeRunCategoryColor(color).replace('#', '').toLowerCase();
    if (!normalizedColor) return slug || 'category';
    return `${slug || 'category'}-${normalizedColor}`.slice(0, 80);
}

function resolveRunCategoryFromSessionPayload(fullSessionData = {}) {
    const metadataCategory = fullSessionData?.metadata?.runCategory && typeof fullSessionData.metadata.runCategory === 'object'
        ? fullSessionData.metadata.runCategory
        : {};
    const nestedCategory = fullSessionData?.runCategory && typeof fullSessionData.runCategory === 'object'
        ? fullSessionData.runCategory
        : {};

    const color = normalizeRunCategoryColor(
        fullSessionData?.runCategoryColor ||
        nestedCategory?.color ||
        metadataCategory?.color
    );
    if (!color) return null;

    const label = normalizeRunCategoryLabel(
        fullSessionData?.runCategoryLabel ||
        nestedCategory?.label ||
        metadataCategory?.label
    ) || `Category ${color}`;
    const key = String(
        fullSessionData?.runCategoryKey ||
        nestedCategory?.key ||
        metadataCategory?.key ||
        ''
    ).trim() || buildRunCategoryKey(label, color);
    const assignedRaw =
        fullSessionData?.runCategoryAssigned ??
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

function extractStepStabilityMeta(fullSessionData = {}, stepKey = '') {
    if (stepKey === 'step3extract') {
        return (
            fullSessionData?.steps?.step3stability?.response?.json?.data ||
            fullSessionData?.steps?.step3extract?.response?.json?.meta?.stabilityGate ||
            null
        );
    }
    if (stepKey === 'step4grade') {
        return (
            fullSessionData?.steps?.step4stability?.response?.json?.data ||
            fullSessionData?.steps?.step4grade?.response?.json?.data?.meta?.stabilityGate ||
            null
        );
    }
    return null;
}

function extractStepRunProfile(fullSessionData = {}, stepKey = '') {
    const reqMeta = fullSessionData?.steps?.[stepKey]?.request || {};
    const stabilityMeta = extractStepStabilityMeta(fullSessionData, stepKey) || {};
    const metrics = stabilityMeta?.metrics || {};
    const runCount = toPositiveInt(
        reqMeta?.runCount ?? metrics?.runCount ?? stabilityMeta?.runCount,
        1
    );
    const modeRaw = String(reqMeta?.mode || '').trim();
    const mode = modeRaw || (runCount >= 3 ? 'stability_gate_auto_consensus' : 'single_run');
    return {
        mode,
        runCount,
        usedThreeRuns: runCount >= 3,
        unstableCount: Number(metrics?.unstableCount ?? 0),
        totalCount: Number(metrics?.totalItems ?? metrics?.totalSignals ?? 0),
        meanAgreement: Number.isFinite(Number(metrics?.meanAgreement)) ? Number(metrics.meanAgreement) : null,
        flipRate: Number.isFinite(Number(metrics?.flipRate)) ? Number(metrics.flipRate) : null
    };
}

function isStepSuccessful(fullSessionData = {}, stepKey = '') {
    return fullSessionData?.steps?.[stepKey]?.response?.json?.status === 'success';
}

function isSessionCompleteByPipeline(fullSessionData = {}, pipelineMode = 'full') {
    const modeRaw = String(pipelineMode || '').trim().toLowerCase();
    const normalized = modeRaw === 'step3_tuning'
        ? 'step3_tuning'
        : modeRaw === 'step4_tuning'
            ? 'step4_tuning'
            : 'full';

    if (normalized === 'step3_tuning') {
        return (
            isStepSuccessful(fullSessionData, 'step1freeze') &&
            isStepSuccessful(fullSessionData, 'step2analyze') &&
            isStepSuccessful(fullSessionData, 'step3extract')
        );
    }
    if (normalized === 'step4_tuning') {
        return (
            isStepSuccessful(fullSessionData, 'step1freeze') &&
            isStepSuccessful(fullSessionData, 'step2analyze') &&
            isStepSuccessful(fullSessionData, 'step3extract') &&
            isStepSuccessful(fullSessionData, 'step4grade')
        );
    }

    return (
        Boolean(fullSessionData?.steps?.step6report) ||
        (
            isStepSuccessful(fullSessionData, 'step1freeze') &&
            isStepSuccessful(fullSessionData, 'step2analyze') &&
            isStepSuccessful(fullSessionData, 'step3extract') &&
            isStepSuccessful(fullSessionData, 'step4grade') &&
            isStepSuccessful(fullSessionData, 'step5feedback')
        )
    );
}

function buildResearchConfigSnapshot(fullSessionData = {}) {
    const incoming = (fullSessionData.researchConfig && typeof fullSessionData.researchConfig === 'object')
        ? fullSessionData.researchConfig
        : {};

    const metadata = (fullSessionData.metadata && typeof fullSessionData.metadata === 'object')
        ? fullSessionData.metadata
        : {};
    const uiState = (fullSessionData.uiState && typeof fullSessionData.uiState === 'object')
        ? fullSessionData.uiState
        : {};
    const gradingSettings = (uiState.gradingSettings && typeof uiState.gradingSettings === 'object')
        ? uiState.gradingSettings
        : {};

    const createdAt = incoming.createdAt || fullSessionData.savedAt || new Date().toISOString();
    const schemaVersion = incoming.schemaVersion || metadata.schemaVersion || `${fullSessionData.schema || 'ielts-scoring-session'}@v${fullSessionData.version || 1}`;

    return {
        pipelineMode: incoming.pipelineMode || metadata.pipelineMode || 'full',
        scoringView: normalizeScoringView(incoming.scoringView || metadata.scoringView || fullSessionData?.uiState?.scoringView),
        provider: incoming.provider || metadata.provider || inferProviderFromSession(fullSessionData),
        mode: incoming.mode || metadata.mode || 'hybrid_extension',
        promptVersionIds: normalizePromptVersionIds(
            incoming.promptVersionIds || metadata.promptVersionIds || {}
        ),
        schemaVersion,
        microBankVersion: incoming.microBankVersion || metadata.microBankVersion || 'unspecified',
        rulesVersion: incoming.rulesVersion || metadata.rulesVersion || 'unspecified',
        batchSize: clampInt(incoming.batchSize ?? gradingSettings.batchSize, 5),
        concurrency: clampInt(incoming.concurrency ?? gradingSettings.concurrency, 2),
        cachingEnabled: incoming.cachingEnabled ?? metadata.cachingEnabled ?? true,
        frozen: incoming.frozen ?? isStepSuccessful(fullSessionData, 'step1freeze'),
        studyRunId: incoming.studyRunId || metadata.studyRunId || '',
        runLabel: incoming.runLabel || metadata.runLabel || metadata.sampleName || '',
        createdAt
    };
}

async function ensureDirs() {
    try { await fs.access(SESSIONS_DIR); } 
    catch { await fs.mkdir(SESSIONS_DIR, { recursive: true }); }
}

async function readIndex() {
    await ensureDirs();
    try {
        const data = await fs.readFile(INDEX_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

async function writeIndex(index) {
    await ensureDirs();
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

// --- Public API ---

const scoringSessionModel = {
    
    // 1. LIST (Fast, reads only index)
    getAllSessions: async () => {
        const index = await readIndex();
        // Sort by date desc
        return index.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    },

    // 2. GET SINGLE (Reads heavy file)
    getSessionById: async (id) => {
        const filePath = path.join(SESSIONS_DIR, `${id}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error(`Session file not found: ${id}`, e);
            return null;
        }
    },

    // 3. SAVE (Updates Index + Writes File)
    saveSession: async (fullSessionData) => {
        return await queueWrite(async () => {
            await ensureDirs();
            fullSessionData.researchConfig = buildResearchConfigSnapshot(fullSessionData);
            const orgId = String(fullSessionData.orgId || fullSessionData.metadata?.orgId || DEFAULT_ORG_ID).trim() || DEFAULT_ORG_ID;
            fullSessionData.orgId = orgId;
            fullSessionData.metadata = {
                ...(fullSessionData.metadata || {}),
                orgId
            };

            // Generate ID if not present or create new version
            const sessionId = fullSessionData.sessionId || `sess_${Date.now()}`;
            const step3Profile = extractStepRunProfile(fullSessionData, 'step3extract');
            const step4Profile = extractStepRunProfile(fullSessionData, 'step4grade');
            const isThreeRun = step3Profile.usedThreeRuns || step4Profile.usedThreeRuns;
            const pipelineStrategy = isThreeRun ? 'three_run_consensus' : 'single_run';
            const runCategory = resolveRunCategoryFromSessionPayload(fullSessionData);
            const scoringView = normalizeScoringView(
                fullSessionData?.scoringView ||
                fullSessionData?.metadata?.scoringView ||
                fullSessionData?.researchConfig?.scoringView ||
                fullSessionData?.uiState?.scoringView
            );
            const pipelineModeRaw = String(
                fullSessionData?.researchConfig?.pipelineMode ||
                fullSessionData?.metadata?.pipelineMode ||
                'full'
            ).trim().toLowerCase();
            const pipelineMode = pipelineModeRaw === 'step3_tuning'
                ? 'step3_tuning'
                : pipelineModeRaw === 'step4_tuning'
                    ? 'step4_tuning'
                    : 'full';
            const isComplete = isSessionCompleteByPipeline(fullSessionData, pipelineMode);
            
            // 1. Create Summary for Index
            const summary = {
                id: sessionId,
                orgId,
                pipelineMode,
                scoringView,
                sampleId: fullSessionData.metadata?.sampleId || 'N/A',
                sampleName: fullSessionData.metadata?.sampleName || 'Untitled Essay',
                savedAt: new Date().toISOString(),
                overallBand: fullSessionData.steps?.step4grade?.response?.json?.data?.overallBand || 'N/A',
                examinerBandScore: fullSessionData.metadata?.examinerBandScore ?? null,
                status: isComplete ? 'Complete' : 'In Progress',
                pipelineStrategy,
                isThreeRun,
                step3Mode: step3Profile.mode,
                step3RunCount: step3Profile.runCount,
                step3UnstableCount: step3Profile.unstableCount,
                step3TotalSignals: step3Profile.totalCount,
                step3MeanAgreement: step3Profile.meanAgreement,
                step3FlipRate: step3Profile.flipRate,
                step4Mode: step4Profile.mode,
                step4RunCount: step4Profile.runCount,
                step4UnstableCount: step4Profile.unstableCount,
                step4TotalItems: step4Profile.totalCount,
                step4MeanAgreement: step4Profile.meanAgreement,
                step4FlipRate: step4Profile.flipRate,
                runCategoryAssigned: Boolean(runCategory?.assigned),
                runCategoryKey: String(runCategory?.key || '').trim(),
                runCategoryLabel: String(runCategory?.label || '').trim(),
                runCategoryColor: String(runCategory?.color || '').trim()
            };

            // 2. Update Index List
            const index = await readIndex();
            const existingIdx = index.findIndex(i => i.id === sessionId);
            
            if (existingIdx >= 0) {
                index[existingIdx] = summary; // Update existing summary
            } else {
                index.push(summary); // Add new
            }
            await writeIndex(index);

            // 3. Save Large File
            const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
            // Ensure ID is in the bundle
            fullSessionData.sessionId = sessionId; 
            fullSessionData.scoringView = scoringView;
            fullSessionData.metadata = {
                ...(fullSessionData.metadata || {}),
                scoringView
            };
            fullSessionData.researchConfig = {
                ...(fullSessionData.researchConfig || {}),
                scoringView
            };
            await fs.writeFile(filePath, JSON.stringify(fullSessionData, null, 2));

            return { success: true, id: sessionId };
        });
    },

    // 4. DELETE
    deleteSession: async (id) => {
        return await queueWrite(async () => {
            // Remove from Index
            const index = await readIndex();
            const newIndex = index.filter(i => i.id !== id);
            await writeIndex(newIndex);

            // Remove File
            const filePath = path.join(SESSIONS_DIR, `${id}.json`);
            try {
                await fs.unlink(filePath);
            } catch (e) {
                console.warn("File already deleted or missing:", id);
            }
            return { success: true };
        });
    }
};

module.exports = scoringSessionModel;
