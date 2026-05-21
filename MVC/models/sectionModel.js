// MVC/models/sectionModel.js
const fs = require('fs').promises;
const path = require('path');
const dataPath = path.join(__dirname, '../../data/sections.json');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toIdArray, toPublicId } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

// ✅ NEW: Define Valid Categories
const VALID_CATEGORIES = [
  'SYSTEM', 
  'ORGANIZATION', 
  'SECURITY', 
  'GENERAL', 
  'DATA', 
  'LOGGING', 
  'IELTS',
  'SCHOOL',
  'CREDIT_LOANS',
  'BENCHPATH'
];

/**
 * Returns the canonical list of valid section categories.
 * Keep this as the single source of truth; controllers/views should consume it.
 */
async function getCategories() {
  // Return a new array to prevent accidental mutation by callers.
  return [...VALID_CATEGORIES];
}

async function getAllSections() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    console.error('Error reading sections.json:', error);
    throw new Error('Failed to retrieve sections');
  }
}

function applySectionScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const adminCategories = Array.isArray(scope?.categories)
    ? new Set(scope.categories.map((cat) => String(cat)))
    : new Set();

  const explicitSectionIds = Array.isArray(scope?.sectionIds)
    ? new Set(toIdArray(scope.sectionIds))
    : new Set();
  const excludedSectionIds = Array.isArray(scope?.excludedSectionIds)
    ? new Set(toIdArray(scope.excludedSectionIds))
    : new Set();

  return list.filter((row) => {
    const category = String(row?.category || '');
    const sectionId = toPublicId(row?.id);
    if (excludedSectionIds.has(sectionId)) return false;
    return adminCategories.has(category) || explicitSectionIds.has(sectionId);
  });
}

function buildSectionQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'sections',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      categories: Array.isArray(incomingScope?.categories)
        ? incomingScope.categories.map((cat) => String(cat))
        : [],
      sectionIds: Array.isArray(incomingScope?.sectionIds) ? toIdArray(incomingScope.sectionIds) : [],
      excludedSectionIds: Array.isArray(incomingScope?.excludedSectionIds) ? toIdArray(incomingScope.excludedSectionIds) : []
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'category', 'description'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function querySections(options = {}) {
  const plan = buildSectionQueryPlan(options);
  const executor = getEntityQueryExecutor('sections');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allSections = await getAllSections();
  const scopedSections = applySectionScope(allSections, plan.scope);
  return applyGenericFilter(scopedSections, plan.query, plan.fallback);
}

async function getSectionById(id) {
  const sections = await getAllSections();
  return sections.find(section => section.id === id);
}
async function getSectionByName(name) {
  const sections = await getAllSections();
  return sections.find(section => section.name === name);
}

function generateId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ---------------- VALIDATION ---------------- */

function validateData(config) {
  const errors = [];
  const nameRegex = /^[A-Z][A-Z_]*[A-Z]$/;

  if (!config || typeof config !== 'object') {
    return { isValid: false, errors: ['Configuration object is required.'] };
  }

  // Name Validation
  if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
    errors.push('Name is required.');
  } else if (!nameRegex.test(config.name)) {
    errors.push('Name must be uppercase, use underscores, and no special chars.');
  }

  // ✅ NEW: Category Validation
  if (!config.category || !VALID_CATEGORIES.includes(config.category)) {
      errors.push(`Category is invalid. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  if (!config.description || !config.description.trim()) {
    errors.push('Description is required.');
  }

  if (typeof config.active !== 'boolean') {
    errors.push('Active must be a boolean.');
  }
  if (config.trackState !== undefined && typeof config.trackState !== 'boolean') {
    errors.push('Track State must be a boolean.');
  }

  if (typeof config.minimumAccessRequirement !== 'number' || config.minimumAccessRequirement < 1 || config.minimumAccessRequirement > 10) {
    errors.push('minimumAccessRequirement must be 1-10.');
  }

  // Operations Validation
  if (!Array.isArray(config.operations)) {
    errors.push('Operations array is required.');
  } else {
    config.operations.forEach((op, index) => {
      const prefix = `Operation ${index}: `;
      if (!op.id) errors.push(prefix + 'ID is required.');
      if (op.sessionAttempts > 50) errors.push(prefix + 'Max attempts is 50.');
      if (op.sessionTime > 1440) errors.push(prefix + 'Max time is 24 hours.');
    });

    const ids = config.operations.map(o => o.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push('Duplicate operation IDs.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addSection(section) {
  await queueWrite(async () => {
    const sections = await getAllSections();
    if(sections.find(s => s.name === section.name)) throw new Error('Name exists');

    section.id = generateId();
    
    // Default legacy records if needed (handled in controller usually, but safe here)
    if(!section.category) section.category = 'GENERAL';
    if(section.trackState === undefined) section.trackState = true;
    
    const result = validateData(section);
    if(!result.isValid) throw new Error(result.errors.join('<br>'));

    sections.push(section);
    await fs.writeFile(dataPath, JSON.stringify(sections, null, 2));
    return section;
  });
}

async function updateSection(id, updates) {
  await queueWrite(async () => {
    const sections = await getAllSections();
    const index = sections.findIndex(section => section.id === id);
    if (index === -1) throw new Error('Section not found');

    const current = sections[index];

    if (updates.name) {
      const dup = sections.find(s => s.id !== id && s.name === updates.name);
      if (dup) throw new Error('Name exists.');
    }

    const merged = {
      ...current,
      ...updates,
      audit: { ...current.audit, ...(updates.audit || {}) },
      operations: updates.operations ?? current.operations,
      subsections: updates.subsections ?? current.subsections,
      related: updates.related ?? current.related
    };

    const result = validateData(merged);
    if(!result.isValid) throw new Error(result.errors.join("\r\n"));

    sections[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(sections, null, 2));
  });
}

async function deleteSection(id) {
  await queueWrite(async () => {
    const sections = await getAllSections();
    const filtered = sections.filter(s => s.id !== id);
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = { 
  getAllSections,
  querySections,
  buildSectionQueryPlan,
  getSectionById,
  getSectionByName,
  addSection, updateSection, deleteSection,
  getCategories,
  VALID_CATEGORIES // kept for backward compatibility; prefer getCategories()
};
