'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const teachingOutlineCatalogService = require('../../services/school/teachingOutlineCatalogService');
const studentTeachingCoverageService = require('../../services/school/studentTeachingCoverageService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function getActiveOrgIdOrThrow(reqUser) {
  const activeOrgId = reqUser?.activeOrgId ? String(reqUser.activeOrgId) : '';
  if (!activeOrgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
  return activeOrgId;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(fallback);
}

function parseJsonBody(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_e) {
    return fallback;
  }
}

async function ensureDefaults(req) {
  const orgId = getActiveOrgIdOrThrow(req.user);
  return teachingOutlineCatalogService.ensureOrgTeachingOutlineDefaults(orgId, req.user?.id || 'SYSTEM');
}

exports.listDashboard = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: ['skillId'] });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    await ensureDefaults(req);
    const [levels, items, templates] = await Promise.all([
      schoolDataService.fetchAllData('teachingOutlineLevels', {}, req.user),
      schoolDataService.fetchAllData('teachingOutlineItems', {}, req.user),
      schoolDataService.fetchAllData('teachingOutlineSectionTemplates', {}, req.user)
    ]);
    const orgLevels = teachingOutlineCatalogService.listActiveLevels(
      (levels || []).filter((row) => idsEqual(row.orgId, orgId))
    );
    const orgItems = (items || []).filter((row) => idsEqual(row.orgId, orgId));
    const orgTemplates = (templates || []).filter((row) => idsEqual(row.orgId, orgId));
    const matrix = teachingOutlineCatalogService.buildDashboardMatrix(orgLevels, orgItems, orgTemplates);

    const skillOptions = teachingOutlineCatalogService.CLB_SKILLS.map((skillId) => ({
      id: skillId,
      label: skillId.charAt(0).toUpperCase() + skillId.slice(1)
    }));
    const requestedSkillId = String(req.query.skillId || query.skillId || '').trim().toLowerCase();
    const selectedSkillId = teachingOutlineCatalogService.CLB_SKILLS.includes(requestedSkillId)
      ? requestedSkillId
      : teachingOutlineCatalogService.CLB_SKILLS[0];
    const skillRow = matrix.find((row) => row.skillId === selectedSkillId) || matrix[0] || null;

    let dataRows = (skillRow?.cells || []).map((cell) => ({
      id: `${selectedSkillId}:${cell.levelId}`,
      skillId: selectedSkillId,
      skillLabel: skillRow?.skillLabel || selectedSkillId,
      sectionCount: Number(skillRow?.sectionCount || 0),
      levelId: cell.levelId,
      levelCode: cell.levelCode,
      levelTitle: cell.levelTitle,
      itemCount: Number(cell.itemCount || 0)
    }));

    const searchableFields = ['levelTitle', 'levelCode', 'levelId', 'skillLabel'];
    dataRows = applyGenericFilter(dataRows, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(dataRows, query.page, query.limit);
    const filters = { ...req.query, skillId: selectedSkillId };

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination,
        selectedSkillId,
        skillOptions,
        sectionCount: skillRow?.sectionCount || 0
      });
    }

    return res.render('school/teachingOutline/dashboard', {
      title: 'Teaching Content Outlines',
      tableName: 'Teaching_Content_Outlines',
      data,
      searchableFields,
      selectedSkillId,
      skillOptions,
      sectionCount: skillRow?.sectionCount || 0,
      listUrl: 'school/teaching-outlines',
      btn_export: true,
      print: true,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      pagination,
      filters,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.listLevels = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    await ensureDefaults(req);

    const paged = await schoolDataService.fetchDataPaged('teachingOutlineLevels', query, req.user);
    const dataRows = (paged.rows || [])
      .filter((row) => idsEqual(row.orgId, orgId))
      .sort((a, b) => {
        const orderA = Number(a?.sortOrder || 0);
        const orderB = Number(b?.sortOrder || 0);
        if (orderA !== orderB) return orderA - orderB;
        return String(a?.title || a?.code || '').localeCompare(String(b?.title || b?.code || ''));
      });

    const searchableFields = await inferSearchableFields(dataRows, { exclude: ['audit'] });
    const data = dataRows;
    const pagination = paged.pagination;

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    return res.render('school/teachingOutline/levelList', {
      title: 'Teaching Outline Levels',
      tableName: 'Teaching_Outline_Levels',
      data,
      searchableFields,
      newUrl: 'school/teaching-outlines/levels',
      newLabel: 'New Level',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showLevelForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params.id || '').trim();
    let levelItem = { orgId, isActive: true, levelKind: 'benchmark', sortOrder: 100, matchAliases: [] };
    if (id && id !== 'new') {
      const row = await schoolDataService.getDataById('teachingOutlineLevels', id, req.user);
      if (!row || !idsEqual(row.orgId, orgId)) throw new Error('Level not found.');
      levelItem = row;
    }
    return res.render('school/teachingOutline/levelForm', {
      title: levelItem.id ? 'Edit Teaching Outline Level' : 'New Teaching Outline Level',
      levelItem,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveLevel = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params.id || '').trim();
    const aliases = parseJsonBody(req.body.matchAliasesJson, null);
    const payload = {
      orgId,
      code: String(req.body.code || '').trim(),
      title: String(req.body.title || '').trim(),
      shortTitle: String(req.body.shortTitle || '').trim(),
      levelKind: String(req.body.levelKind || 'custom').trim(),
      sortOrder: Number(req.body.sortOrder || 100),
      description: String(req.body.description || '').trim(),
      isActive: toBoolean(req.body.isActive, true),
      matchAliases: Array.isArray(aliases)
        ? aliases
        : String(req.body.matchAliases || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
      audit: { createUser: req.user?.id || 'SYSTEM', lastUpdateUser: req.user?.id || 'SYSTEM' }
    };
    let saved;
    if (id && id !== 'new') {
      saved = await schoolDataService.updateData('teachingOutlineLevels', id, payload, req.user);
    } else {
      saved = await schoolDataService.addData('teachingOutlineLevels', payload, req.user);
    }
    const message = (id && id !== 'new') ? 'Teaching outline level updated successfully.' : 'Teaching outline level created successfully.';
    const payloadOut = { status: 'success', message, result: saved, redirectTo: '/school/teaching-outlines/levels' };
    if (isAjax(req)) return res.json(payloadOut);
    return res.redirect('/school/teaching-outlines/levels');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showSectionTemplateEditor = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const skillId = String(req.params.skillId || '').trim().toLowerCase();
    if (!teachingOutlineCatalogService.CLB_SKILLS.includes(skillId)) throw new Error('Invalid skill.');
    await ensureDefaults(req);
    const templates = await schoolDataService.fetchAllData('teachingOutlineSectionTemplates', {}, req.user);
    const template = (templates || []).find((row) => idsEqual(row.orgId, orgId) && row.skillId === skillId);
    return res.render('school/teachingOutline/sectionTemplateEditor', {
      title: `Section Template — ${skillId}`,
      skillId,
      template: template || { skillId, sections: teachingOutlineCatalogService.DEFAULT_SECTION_TEMPLATES[skillId] || [] },
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveSectionTemplate = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const skillId = String(req.params.skillId || '').trim().toLowerCase();
    const sections = parseJsonBody(req.body.sectionsJson, []);
    const templates = await schoolDataService.fetchAllData('teachingOutlineSectionTemplates', {}, req.user);
    const existing = (templates || []).find((row) => idsEqual(row.orgId, orgId) && row.skillId === skillId);
    const payload = {
      orgId,
      skillId,
      sections,
      audit: { createUser: req.user?.id || 'SYSTEM', lastUpdateUser: req.user?.id || 'SYSTEM' }
    };
    if (existing) {
      await schoolDataService.updateData('teachingOutlineSectionTemplates', existing.id, payload, req.user);
    } else {
      await schoolDataService.addData('teachingOutlineSectionTemplates', payload, req.user);
    }
    if (isAjax(req)) return res.json({ status: 'success' });
    return res.redirect(`/school/teaching-outlines/${skillId}/sections`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showOutlineEditor = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const skillId = String(req.params.skillId || '').trim().toLowerCase();
    const levelId = String(req.params.levelId || '').trim();
    await ensureDefaults(req);
    const [levels, items, templates] = await Promise.all([
      schoolDataService.fetchAllData('teachingOutlineLevels', {}, req.user),
      schoolDataService.fetchAllData('teachingOutlineItems', {}, req.user),
      schoolDataService.fetchAllData('teachingOutlineSectionTemplates', {}, req.user)
    ]);
    const level = (levels || []).find((row) => String(row.id) === levelId && idsEqual(row.orgId, orgId));
    if (!level) throw new Error('Level not found.');
    const template = teachingOutlineCatalogService.getSectionTemplateForSkill(
      (templates || []).filter((row) => idsEqual(row.orgId, orgId)),
      skillId,
      orgId
    );
    const levelItems = (items || []).filter((row) => (
      idsEqual(row.orgId, orgId) && row.skillId === skillId && String(row.levelId) === levelId
    ));
    const tree = teachingOutlineCatalogService.buildItemTree(levelItems, template, { includeInactive: true });
    const skillLabel = skillId.charAt(0).toUpperCase() + skillId.slice(1);
    const exportPayload = teachingOutlineCatalogService.buildOutlineExportPayload(
      skillId,
      level,
      template,
      levelItems
    );
    return res.render('school/teachingOutline/outlineEditor', {
      title: `${skillLabel} — ${level.title}`,
      skillId,
      skillLabel,
      level,
      template,
      tree,
      exportPayload,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveOutlineItem = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const payload = parseJsonBody(req.body.itemJson, req.body);
    const id = String(payload.id || req.params.id || '').trim();
    const data = {
      orgId,
      skillId: String(payload.skillId || '').trim().toLowerCase(),
      levelId: String(payload.levelId || '').trim(),
      sectionKey: String(payload.sectionKey || '').trim(),
      parentId: payload.parentId || null,
      itemKind: String(payload.itemKind || 'checklist').trim(),
      label: String(payload.label || '').trim(),
      description: String(payload.description || '').trim(),
      displayOrder: Number(payload.displayOrder || 100),
      isSelectable: toBoolean(payload.isSelectable, true),
      isActive: toBoolean(payload.isActive, true),
      audit: { createUser: req.user?.id || 'SYSTEM', lastUpdateUser: req.user?.id || 'SYSTEM' }
    };
    let saved;
    if (id) {
      saved = await schoolDataService.updateData('teachingOutlineItems', id, data, req.user);
    } else {
      saved = await schoolDataService.addData('teachingOutlineItems', data, req.user);
    }
    if (isAjax(req)) return res.json({ status: 'success', result: saved });
    return res.redirect(`/school/teaching-outlines/${data.skillId}/${data.levelId}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.toggleOutlineItem = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params.id || '').trim();
    const row = await schoolDataService.getDataById('teachingOutlineItems', id, req.user);
    if (!row || !idsEqual(row.orgId, orgId)) throw new Error('Item not found.');
    const currentlyActive = row.isActive !== false && String(row.isActive).toLowerCase() !== 'false';
    const saved = await schoolDataService.updateData('teachingOutlineItems', id, {
      isActive: !currentlyActive,
      audit: { lastUpdateUser: req.user?.id || 'SYSTEM' }
    }, req.user);
    return res.json({ status: 'success', result: saved });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.importSeed = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const skillId = String(req.body.skillId || req.params.skillId || '').trim().toLowerCase();
    const levelCode = String(req.body.levelCode || '').trim();
    await ensureDefaults(req);
    const levels = await schoolDataService.fetchAllData('teachingOutlineLevels', {}, req.user);
    const level = (levels || []).find((row) => idsEqual(row.orgId, orgId) && row.code === levelCode);
    if (!level) throw new Error('Level not found.');
    const seed = teachingOutlineCatalogService.WRITING_ITEMS_BY_LEVEL?.[levelCode]
      || (skillId !== 'writing' ? require('../../services/school/teachingOutlineSeedData').buildLsrPlaceholderItems(skillId, levelCode) : null);
    if (!seed) throw new Error('No seed data for this skill/level.');
    await teachingOutlineCatalogService.importItemsForSkillLevel(orgId, skillId, level.id, seed, req.user?.id || 'SYSTEM');
    return res.json({ status: 'success' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.importOutlineData = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const skillId = String(req.body.skillId || '').trim().toLowerCase();
    const levelId = String(req.body.levelId || '').trim();
    if (!skillId || !levelId) throw new Error('Skill and level are required.');
    const payload = parseJsonBody(req.body.exportJson, req.body);
    const exportSkill = String(payload?.skillId || '').trim().toLowerCase();
    const exportLevel = String(payload?.levelCode || '').trim();
    if (exportSkill && exportSkill !== skillId) {
      throw new Error('Import file skill does not match this outline.');
    }
    const levels = await schoolDataService.fetchAllData('teachingOutlineLevels', {}, req.user);
    const level = (levels || []).find((row) => String(row.id) === levelId && idsEqual(row.orgId, orgId));
    if (!level) throw new Error('Level not found.');
    if (exportLevel && exportLevel !== level.code) {
      throw new Error('Import file level does not match this outline.');
    }
    const seedRows = teachingOutlineCatalogService.normalizeOutlineImportRows(payload);
    if (!seedRows.length) throw new Error('No items found in import file.');
    await teachingOutlineCatalogService.importItemsForSkillLevel(
      orgId,
      skillId,
      level.id,
      seedRows,
      req.user?.id || 'SYSTEM'
    );
    return res.json({ status: 'success', count: seedRows.length });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.studentCoverage = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const classId = String(req.params.classId || '').trim();
    const personId = String(req.params.personId || '').trim();
    const enrollmentPeriodId = String(req.query.enrollmentPeriodId || '').trim();
    await ensureDefaults(req);
    const [levels, items, templates, sessions, periods] = await Promise.all([
      schoolDataService.fetchAllData('teachingOutlineLevels', {}, req.user),
      schoolDataService.fetchAllData('teachingOutlineItems', {}, req.user),
      schoolDataService.fetchAllData('teachingOutlineSectionTemplates', {}, req.user),
      schoolDataService.getClassSessions(classId, req.user),
      schoolDataService.fetchData('classEnrollmentPeriods', { classId }, req.user)
    ]);
    const period = (periods || []).find((row) => String(row.id) === enrollmentPeriodId)
      || (periods || []).find((row) => String(row.personId) === personId);
    const report = await studentTeachingCoverageService.buildEnrollmentCoverageReport({
      classId,
      personId,
      enrollmentPeriod: period || {},
      sessions,
      levels: (levels || []).filter((row) => idsEqual(row.orgId, orgId)),
      items: (items || []).filter((row) => idsEqual(row.orgId, orgId)),
      templates: (templates || []).filter((row) => idsEqual(row.orgId, orgId)),
      orgId,
      reqUser: req.user
    });
    if (isAjax(req)) return res.json({ status: 'success', report });
    return res.render('school/teachingOutline/studentCoverage', {
      title: 'Curriculum Covered',
      classId,
      personId,
      period,
      report,
      user: req.user
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};
