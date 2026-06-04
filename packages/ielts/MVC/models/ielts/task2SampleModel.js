// MVC/models/task2SampleModel.js
const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/ielts/ieltsCoreModuleResolver');
const dataPath = path.join(resolveCoreRoot(), 'data/ielts/task2samples.json');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

// ✅ NEW: Define Valid Sample Types
const VALID_TYPES = ['BOOK', 'ARTICLE', 'ONLINE', 'STUDENT_SUBMISSION', 'MODEL_ANSWER', 'OTHER'];
const DEFAULT_ORG_ID = 'SYSTEM';

// --- HELPERS ---

async function getAllSamples() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    console.error('Error reading task2samples.json:', error);
    throw new Error('Failed to retrieve samples');
  }
}

async function getSampleById(id) {
  const samples = await getAllSamples();
  return samples.find(sample => sample.id === id);
}

function generateId() {
  return `T2S_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

/* ---------------- VALIDATION ---------------- */

function validateData(sample) {
    if (!sample.orgId || typeof sample.orgId !== 'string' || sample.orgId.trim() === '') {
        errors.push('orgId is required.');
    }

    const errors = [];

    if (!sample || typeof sample !== 'object') {
        return { isValid: false, errors: ['Sample data is required.'] };
    }

    if (!sample.type || !VALID_TYPES.includes(sample.type)) {
        errors.push(`Invalid Type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    if (!sample.refName || typeof sample.refName !== 'string' || sample.refName.trim() === '') {
        errors.push('Reference Name (Title) is required.');
    }

    // ✅ NEW: Validate Question
    if (!sample.question || typeof sample.question !== 'string' || sample.question.trim() === '') {
        errors.push('Question prompt is required.');
    }

    if (sample.bandScore !== undefined && sample.bandScore !== '' && sample.bandScore !== null) {
        const score = parseFloat(sample.bandScore);
        if (isNaN(score) || score < 0 || score > 9) {
            errors.push('Band Score must be a number between 0 and 9.');
        }
    }

    // Allow empty text if attachment exists, otherwise require text
    if ((!sample.text || sample.text.trim() === '') && !sample.attachment) {
        errors.push('Sample must contain either text content or an attachment.');
    }

    return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addSample(sampleData) {
    return await queueWrite(async () => {
        const samples = await getAllSamples();

        const newSample = {
            id: generateId(),
            orgId: String(sampleData.orgId || DEFAULT_ORG_ID).trim(),
            type: sampleData.type,
            refName: sampleData.refName.trim(),
            // ✅ NEW: Add Question
            question: sampleData.question ? sampleData.question.trim() : '', 
            refAddress: sampleData.refAddress ? sampleData.refAddress.trim() : '',
            text: sampleData.text || '',
            feedback: sampleData.feedback || '',
            bandScore: sampleData.bandScore ? parseFloat(sampleData.bandScore) : null,
            attachment: sampleData.attachment || null,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = validateData(newSample);
        if (!result.isValid) throw new Error(result.errors.join('<br>'));

        samples.push(newSample);
        await fs.writeFile(dataPath, JSON.stringify(samples, null, 2));
        return newSample;
    });
}    

async function updateSample(id, updates) {
  return await queueWrite(async () => {
    const samples = await getAllSamples();
    const index = samples.findIndex(s => s.id === id);
    if (index === -1) throw new Error('Sample not found');

    const current = samples[index];

    // Merge updates
    const merged = {
      ...current,
      ...updates,
      // Preserve ID and CreatedAt, update UpdatedAt
      id: current.id,
      orgId: current.orgId || DEFAULT_ORG_ID,
      createdAt: current.createdAt,
      updatedAt: new Date()
    };

    // If updating attachment, handle object merging if needed, 
    // usually controller passes full object or null
    if (updates.attachment !== undefined) {
        merged.attachment = updates.attachment;
    }

    const result = validateData(merged);
    if(!result.isValid) throw new Error(result.errors.join("\r\n"));

    samples[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(samples, null, 2));
    return merged;
  });
}

async function deleteSample(id) {
  return await queueWrite(async () => {
    const samples = await getAllSamples();
    const filtered = samples.filter(s => s.id !== id);
    
    if (samples.length === filtered.length) throw new Error('Sample not found');
    
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = { 
  getAllSamples, 
  getSampleById, 
  addSample, 
  updateSample, 
  deleteSample,
  VALID_TYPES 
};
