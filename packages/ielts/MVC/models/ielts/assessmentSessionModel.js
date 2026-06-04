// MVC/models/ielts/assessmentSessionModel.js
const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/ielts/ieltsCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/ielts/assessmentSessions.json');

// Ensure file exists
async function ensureDataDir() {
    const dir = path.dirname(dataPath);
    try { await fs.access(dir); } 
    catch { await fs.mkdir(dir, { recursive: true }); }
}

async function getAllSessions() {
    await ensureDataDir();
    try {
        const data = await fs.readFile(dataPath, 'utf8');
        return JSON.parse(data);
    } catch (error) { return []; }
}

function generateId() {
    return `SESS_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

/* ---------------- ACTIONS ---------------- */

// 1. SAVE THE ATTEMPT (The "Set" of answers)
async function saveSession(data) {
    return await queueWrite(async () => {
        const list = await getAllSessions();

        const newSession = {
            id: generateId(),
            userId: data.userId,
            assessmentId: data.assessmentId,
            assessmentTitle: data.assessmentTitle, // Snapshot in case original changes
            
            // The Core Data: Array of { questionId, questionText, userAnswer, type, ... }
            answers: data.answers || [],
            
            // Scoring Results (Calculated later or immediately)
            computedBand: null,  // e.g., "6.5 - 7.0"
            aiFeedback: null,
            status: 'PENDING', // PENDING, COMPLETED, GRADED
            
            createdAt: new Date()
        };

        list.push(newSession);
        await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
        return newSession;
    });
}

// 2. UPDATE WITH GRADE (The "Analysis" step)
async function updateSessionGrade(id, gradingResult) {
    return await queueWrite(async () => {
        const list = await getAllSessions();
        const session = list.find(s => s.id === id);
        if (!session) throw new Error("Session not found");

        session.computedBand = gradingResult.band;
        session.aiFeedback = gradingResult.feedback;
        session.status = 'GRADED';
        session.gradedAt = new Date();

        await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
        return session;
    });
}

async function getSessionById(id) {
    const list = await getAllSessions();
    return list.find(s => s.id === id);
}

module.exports = { getAllSessions, getSessionById, saveSession, updateSessionGrade };
